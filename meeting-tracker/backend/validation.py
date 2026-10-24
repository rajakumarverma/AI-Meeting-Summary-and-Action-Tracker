"""Validation and hardening of model output before it reaches the UI.

The model is treated as an untrusted producer: we parse leniently, verify what we can against the
transcript (evidence excerpts, owner names), downgrade anything we cannot verify to "needs review",
and reject structurally broken output with a clear, retryable error.
"""
from __future__ import annotations

import difflib
import json
import re
from datetime import date

from pydantic import ValidationError

from .errors import AnalysisError
from .schemas import Analysis

UNASSIGNED = "Unassigned"
_NO_OWNER = {"", "unassigned", "unknown", "none", "n/a", "na", "tbd", "nobody", "no one", "null", "-", "?"}
_PRIORITY = {"high": "High", "medium": "Medium", "med": "Medium", "low": "Low",
             "urgent": "High", "critical": "High", "normal": "Medium"}
_CLARIFY = {"needs_clarification", "unclear", "tentative", "proposed", "pending", "unconfirmed", "needs clarification"}
_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MAX_ITEMS = 50


# ----------------------------------------------------------------------------- JSON extraction
def extract_json(text: str) -> dict:
    """Parse a JSON object out of a model reply (tolerates markdown fences and stray prose)."""
    if not isinstance(text, str) or not text.strip():
        raise _malformed("The AI returned an empty response.")
    s = text.strip()
    s = re.sub(r"^```(?:json)?\s*|\s*```$", "", s, flags=re.IGNORECASE)
    try:
        data = json.loads(s)
    except json.JSONDecodeError:
        start, end = s.find("{"), s.rfind("}")
        if start == -1 or end <= start:
            raise _malformed("The AI response was not valid JSON.")
        try:
            data = json.loads(s[start:end + 1])
        except json.JSONDecodeError:
            raise _malformed("The AI response was not valid JSON.")
    if not isinstance(data, dict):
        raise _malformed("The AI response was not a JSON object.")
    return data


def _malformed(detail: str) -> AnalysisError:
    return AnalysisError(
        "malformed_ai_response",
        f"{detail} Nothing was saved. Click Analyze again to retry, or use Demo mode.",
        502, retryable=True,
    )


# ----------------------------------------------------------------------------- text helpers
def _norm(s: str) -> str:
    s = (s or "").lower()
    s = s.replace("\u2019", "'").replace("\u2018", "'").replace("\u201c", '"').replace("\u201d", '"')
    s = s.replace("\u2013", "-").replace("\u2014", "-")
    return re.sub(r"\s+", " ", s).strip()


_SPEAKER = re.compile(r"^\s*(?:\[[^\]]*\]\s*|\(\d{1,2}:\d{2}(?::\d{2})?\)\s*)?[A-Za-z][\w.'\- ]{0,40}:\s*", re.M)


def transcript_variants(transcript: str) -> tuple[str, str, list[str]]:
    full = _norm(transcript)
    no_labels = _norm(_SPEAKER.sub("", transcript))
    lines = [_norm(_SPEAKER.sub("", ln)) for ln in transcript.splitlines() if ln.strip()]
    return full, no_labels, lines


def evidence_found(evidence: str, full: str, no_labels: str, lines: list[str]) -> bool:
    e = _norm(evidence).strip(" .\"'")
    if len(e) < 6:
        return False
    if e in full or e in no_labels:
        return True
    frags = [f.strip(" .\"'") for f in re.split(r"\.\.\.|\u2026", e) if len(f.strip(" .\"'")) >= 12]
    if frags and all(f in full or f in no_labels for f in frags):
        return True
    return bool(difflib.get_close_matches(e, lines, n=1, cutoff=0.88))


def owner_in_text(owner: str, transcript: str, participants: list[str]) -> bool:
    tokens = [t for t in re.split(r"[\s,/&]+", owner) if len(t) >= 2]
    if not tokens:
        return False
    hay = transcript + "\n" + "\n".join(participants)
    return any(re.search(rf"\b{re.escape(t)}\b", hay, re.IGNORECASE) for t in tokens)


def _iso_or_none(value) -> str | None:
    if not isinstance(value, str):
        return None
    v = value.strip()[:10]
    if not _ISO.match(v):
        return None
    try:
        date.fromisoformat(v)
    except ValueError:
        return None
    return v


def _str_list(value, limit: int = MAX_ITEMS) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for v in value:
        if isinstance(v, str) and v.strip():
            out.append(v.strip()[:600])
        elif isinstance(v, dict):  # tolerate {"text": ...} style items
            t = v.get("text") or v.get("description") or v.get("title")
            if isinstance(t, str) and t.strip():
                out.append(t.strip()[:600])
        if len(out) >= limit:
            break
    return out


def _bool(v) -> bool:
    if isinstance(v, bool):
        return v
    if isinstance(v, str):
        return v.strip().lower() in {"true", "yes", "1"}
    return bool(v) if isinstance(v, (int, float)) else False


def _conf(v) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return max(0.0, min(1.0, f)) if f == f else None


# ----------------------------------------------------------------------------- main entry point
def normalize_analysis(raw: dict, transcript: str, participants: list[str] | None = None) -> tuple[dict, list[str]]:
    """Validate/repair a raw analysis dict. Returns (analysis_dict, warnings)."""
    participants = participants or []
    warnings: list[str] = []
    if not isinstance(raw, dict):
        raise _malformed("The AI response was not a JSON object.")
    if not any(k in raw for k in ("action_items", "decisions", "meeting_summary")):
        raise _malformed("The AI response did not contain the expected fields.")

    full, no_labels, lines = transcript_variants(transcript)

    # ---- decisions
    decisions = []
    for d in (raw.get("decisions") if isinstance(raw.get("decisions"), list) else [])[:MAX_ITEMS]:
        if isinstance(d, str):
            d = {"description": d}
        if not isinstance(d, dict):
            continue
        desc = str(d.get("description") or d.get("decision") or "").strip()
        if not desc:
            continue
        evidence = str(d.get("evidence") or "").strip()
        verified = evidence_found(evidence, full, no_labels, lines) if evidence else False
        status = "confirmed" if str(d.get("status", "")).strip().lower() == "confirmed" else "needs_clarification"
        if status == "confirmed" and not verified:
            # A "confirmed" decision must be traceable to the transcript; otherwise ask a human.
            status = "needs_clarification"
            warnings.append(f"Decision '{desc[:60]}' could not be matched to the transcript and was marked as needing clarification.")
        topic = d.get("topic")
        decisions.append({"description": desc[:1000], "evidence": evidence[:1500], "evidence_verified": verified,
                          "topic": (str(topic).strip()[:200] or None) if topic else None, "status": status})

    # ---- action items
    actions, seen = [], set()
    for a in (raw.get("action_items") if isinstance(raw.get("action_items"), list) else [])[:MAX_ITEMS]:
        if isinstance(a, str):
            a = {"title": a}
        if not isinstance(a, dict):
            continue
        title = str(a.get("title") or a.get("action") or "").strip()
        if not title:
            warnings.append("An action item without a title was discarded.")
            continue
        reasons = [str(r).strip()[:300] for r in a.get("review_reasons", []) if isinstance(r, str) and r.strip()] \
            if isinstance(a.get("review_reasons"), list) else []
        needs_review = _bool(a.get("needs_review"))
        needs_clar = _bool(a.get("needs_clarification")) or str(a.get("status", "")).lower() in _CLARIFY

        # owner: never trust a name that does not appear anywhere in the transcript/participants
        owner = str(a.get("owner") or "").strip()
        if owner.lower() in _NO_OWNER:
            owner = UNASSIGNED
        elif not owner_in_text(owner, transcript, participants):
            reasons.append(f"The AI proposed the owner '{owner[:60]}', who does not appear in the transcript. Owner cleared.")
            warnings.append(f"Owner '{owner[:60]}' for '{title[:50]}' was not found in the transcript and was cleared.")
            owner = UNASSIGNED
        if owner == UNASSIGNED:
            needs_review = True
            if not any("owner" in r.lower() for r in reasons):
                reasons.append("No clear owner was identified.")

        # evidence
        evidence = str(a.get("evidence") or "").strip()
        verified = evidence_found(evidence, full, no_labels, lines) if evidence else False
        if not verified:
            needs_review = True
            reasons.append("No verifiable transcript excerpt." if not evidence
                           else "The excerpt could not be found verbatim in the transcript.")

        # deadline
        due_text = a.get("due_text")
        due_text = str(due_text).strip()[:120] if due_text else None
        due_date = _iso_or_none(a.get("due_date"))
        if a.get("due_date") and not due_date:
            due_text = due_text or str(a["due_date"])[:120]
            reasons.append("The deadline was not a valid date and was cleared.")
            needs_review = True
        if due_date and not due_text:
            reasons.append("The AI gave a date but no matching wording from the transcript. Please confirm it.")
            needs_review = True
        if due_text and _norm(due_text) not in full:
            reasons.append(f"Deadline wording '{due_text}' was not found verbatim in the transcript. Please confirm.")
            needs_review = True
        if due_text and not due_date:
            if not any("unclear" in r.lower() for r in reasons):
                reasons.append(f"The deadline is unclear (\"{due_text}\").")
            needs_review = True

        confidence = _conf(a.get("confidence"))
        if confidence is not None and confidence < 0.6:
            needs_review = True
            reasons.append("Low confidence.")
        if needs_clar:
            needs_review = True

        pr = _PRIORITY.get(str(a.get("priority", "")).strip().lower())
        if pr is None:
            pr = "Medium"
            if a.get("priority"):
                reasons.append("Unrecognised priority; defaulted to Medium.")

        key = (_norm(title), owner.lower())
        if key in seen:
            warnings.append(f"Duplicate action item '{title[:50]}' was merged.")
            continue
        seen.add(key)
        topic = a.get("topic")
        actions.append({
            "title": title[:200], "description": str(a.get("description") or "").strip()[:1500],
            "owner": owner[:120], "due_date": due_date, "due_text": due_text, "priority": pr,
            "topic": (str(topic).strip()[:200] or None) if topic else None,
            "evidence": evidence[:1500], "evidence_verified": verified, "confidence": confidence,
            "needs_review": needs_review, "needs_clarification": needs_clar,
            "review_reasons": list(dict.fromkeys(reasons)),
        })

    # ---- missing information (merge model output with deterministic checks)
    missing = _str_list(raw.get("missing_information"))
    for it in actions:
        if it["owner"] == UNASSIGNED:
            missing.append(f"Action '{it['title']}' has no clear owner.")
        if not it["due_date"]:
            if it["due_text"]:
                missing.append(f"Deadline for '{it['title']}' is unclear (\"{it['due_text']}\").")
            else:
                missing.append(f"Action '{it['title']}' has no stated deadline.")
        if it["needs_clarification"]:
            missing.append(f"Action '{it['title']}' requires clarification.")
    for d in decisions:
        if d["status"] == "needs_clarification":
            missing.append(f"Decision '{d['description'][:80]}' needs clarification before it is treated as confirmed.")

    candidate = {
        "meeting_summary": str(raw.get("meeting_summary") or "").strip()[:4000],
        "main_topics": _str_list(raw.get("main_topics"), 10),
        "outcomes": _str_list(raw.get("outcomes"), 15),
        "unresolved": _str_list(raw.get("unresolved"), 15),
        "decisions": decisions,
        "action_items": actions,
        "discussion_points": _str_list(raw.get("discussion_points")),
        "risks": _str_list(raw.get("risks")),
        "blockers": _str_list(raw.get("blockers")),
        "dependencies": _str_list(raw.get("dependencies")),
        "open_questions": _str_list(raw.get("open_questions")),
        "missing_information": list(dict.fromkeys(missing))[:MAX_ITEMS],
    }
    if not candidate["meeting_summary"]:
        warnings.append("The analysis did not include a summary.")
    try:
        validated = Analysis.model_validate(candidate)
    except ValidationError:
        raise _malformed("The AI response did not match the expected structure.")
    return validated.model_dump(), warnings
