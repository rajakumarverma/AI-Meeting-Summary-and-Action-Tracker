"""Deterministic, rule-based transcript analyzer used for DEMO MODE.

This is NOT AI. It applies transparent regular-expression rules so the whole workflow can be demonstrated
without credentials or network access. Its output is always labelled "Demo mode (rule-based)" by the API/UI.
Same input -> same output (no randomness, no clock reads; relative dates resolve against the meeting date).
"""
from __future__ import annotations

import calendar
import re
from collections import Counter
from datetime import date, datetime, timedelta

UNASSIGNED = "Unassigned"
WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
MONTHS = {m.lower(): i for i, m in enumerate(calendar.month_abbr) if m}
MONTHS.update({m.lower(): i for i, m in enumerate(calendar.month_name) if m})
MONTHS["sept"] = 9
_MON = r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"

SPEAKER_RE = re.compile(r"^\s*(?:\[[^\]]+\]\s*|\(\d{1,2}:\d{2}(?::\d{2})?\)\s*)?(?P<speaker>[A-Z][A-Za-z.'\-]*(?: [A-Z][A-Za-z.'\-]*){0,2})\s*:\s*(?P<text>\S.*)$")
SENT_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z\"'(])")

HEDGE = re.compile(r"\b(maybe|perhaps|might|could|possibly|not sure|what if|should we|do we want|thinking about|"
                   r"wondering|probably|i think we|try)\b", re.I)
DECISION = re.compile(r"\b(we(?:'ve| have)? (?:decided|agreed|resolved)|(?:the )?decision (?:is|was)|we(?:'ll| will) go with|"
                      r"let'?s go with|we(?:'re| are) going (?:with|to go with)|it'?s decided|everyone agreed|team agreed)\b", re.I)
DECISION_LEAD = re.compile(r"(?:we(?:'ve| have)? (?:decided|agreed|resolved) (?:to |that |on )?|(?:the )?decision (?:is|was) (?:to |that )?|"
                           r"we(?:'ll| will) go with |let'?s go with |we(?:'re| are) going (?:with|to go with) )", re.I)
ACK = re.compile(r"\b(sure|yes|yep|yeah|will do|on it|i can|i'll|i will|okay|ok|got it|sounds good|no problem)\b", re.I)
BLOCKER = re.compile(r"\b(blocked|blocker|blocking|waiting (?:on|for)|stuck|can't proceed|cannot proceed|held up|"
                     r"pending approval|no access)\b", re.I)
DEPENDENCY = re.compile(r"\b(depends on|dependent on|dependency|waiting (?:on|for)|once .{3,40} (?:is|are) (?:in|done|ready))\b", re.I)
RISK = re.compile(r"\b(risk|at risk|concern(?:ed)?|worried|may slip|could slip|might miss|delay(?:ed)?)\b", re.I)
UNCERTAIN = re.compile(r"\b(not sure|don't know|do not know|unclear|tbd|to be decided|open question|still need to (?:decide|figure|confirm|check)|"
                       r"haven'?t decided|have not decided|undecided|need to confirm|need to decide)\b", re.I)
WH_Q = re.compile(r"\b(who|when|which|whether)\b", re.I)
HIGH = re.compile(r"\b(urgent|asap|critical|blocker|blocking|immediately|top priority|high priority|p0|p1|"
                  r"before (?:the )?(?:launch|release|go-live))\b", re.I)
LOW = re.compile(r"\b(low priority|nice to have|when (?:you )?(?:get|have) (?:a )?(?:chance|time)|eventually|someday|if time permits)\b", re.I)

# Action patterns -----------------------------------------------------------------------------------------
A_REQUEST = re.compile(r"^(?P<name>[A-Z][a-z]+)[, ]+(?:can|could|would|will) you (?P<task>.+?)\s*[?.]?$")
A_FIRST = re.compile(r"\b(?:i(?:'ll| will| can take| am going to|'m going to| can do| will take care of|'ll take care of)|let me) (?P<task>.+)", re.I)
A_NAMED = re.compile(r"\b(?P<name>[A-Z][a-z]+) (?:will|is going to|'ll|agreed to|owns|to take) (?P<task>.+)")
A_UNOWNED = re.compile(r"\b(?:someone|somebody|the team|we) (?:still )?(?:needs?|has|have|should|must|will need) to (?P<task>.+)", re.I)
A_PREFIX = re.compile(r"^(?:action(?: item)?s?|to-?do)\s*[:\-]\s*(?P<rest>.+)$", re.I)

# Deadlines -----------------------------------------------------------------------------------------------
D_AMBIG = re.compile(r"\b(sometime next week|sometime next month|sometime soon|later this (?:week|month)|next week|next month|"
                     r"next sprint|next quarter|end of (?:the )?quarter|soon|asap|eventually|at some point)\b", re.I)
D_ISO = re.compile(r"\b(?:by |on |before |until |due )?(\d{4}-\d{2}-\d{2})\b", re.I)
D_MD = re.compile(rf"\b(?:by |on |before |until |due )?(({_MON})\.? (\d{{1,2}})(?:st|nd|rd|th)?(?:,? (\d{{4}}))?)\b", re.I)
D_DM = re.compile(rf"\b(?:by |on |before |until |due )?((\d{{1,2}})(?:st|nd|rd|th)? (?:of )?({_MON})(?:,? (\d{{4}}))?)\b", re.I)
D_NEXT_WD = re.compile(rf"\b(?:by |on |before |until |due )?(next ({'|'.join(WEEKDAYS)}))\b", re.I)
D_WD = re.compile(rf"\b(?:by |on |before |until |due )?((?:this |coming )?({'|'.join(WEEKDAYS)}))\b", re.I)
D_REL = re.compile(r"\b(?:by |before |until )?(tomorrow|today|end of (?:the )?day|eod|end of (?:the )?week|eow|end of (?:the )?month|eom)\b", re.I)


def _parse_meeting_date(value: str | None) -> date:
    if value:
        v = value.strip()
        for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d"):
            try:
                return datetime.strptime(v[:19] if "T" in v else v[:10], fmt).date()
            except ValueError:
                continue
        try:
            return datetime.fromisoformat(v.replace("Z", "+00:00")).date()
        except ValueError:
            pass
    return date(2000, 1, 3)  # fixed fallback keeps the analyzer deterministic


def _mk_date(y: int, m: int, d: int) -> date | None:
    try:
        return date(y, m, d)
    except ValueError:
        return None


def find_deadline(sentence: str, meeting: date) -> dict | None:
    """Return {text, date, kind, span} or None. kind: explicit | relative | ambiguous."""
    m = D_ISO.search(sentence)
    if m:
        try:
            d = date.fromisoformat(m.group(1))
            return {"text": m.group(0).strip(), "date": d, "kind": "explicit", "span": m.span()}
        except ValueError:
            pass
    for rx, order in ((D_MD, "md"), (D_DM, "dm")):
        m = rx.search(sentence)
        if m:
            if order == "md":
                mon, day, yr = MONTHS[m.group(2).lower().rstrip(".")], int(m.group(3)), m.group(4)
            else:
                day, mon, yr = int(m.group(2)), MONTHS[m.group(3).lower().rstrip(".")], m.group(4)
            d = _mk_date(int(yr) if yr else meeting.year, mon, day)
            if d and not yr and (meeting - d).days > 180:
                d = _mk_date(meeting.year + 1, mon, day)
            if d:
                return {"text": m.group(0).strip(), "date": d, "kind": "explicit", "span": m.span()}
    m = D_AMBIG.search(sentence)
    if m:
        return {"text": m.group(0), "date": None, "kind": "ambiguous", "span": m.span()}
    m = D_NEXT_WD.search(sentence)
    if m:  # "next Friday" is genuinely ambiguous (this coming Friday or the one after?)
        return {"text": m.group(0).strip(), "date": None, "kind": "ambiguous", "span": m.span()}
    m = D_REL.search(sentence)
    if m:
        w = m.group(1).lower()
        if w == "tomorrow":
            d = meeting + timedelta(days=1)
        elif w in ("today", "eod") or w.startswith("end of day") or w.startswith("end of the day"):
            d = meeting
        elif "week" in w or w == "eow":
            d = meeting + timedelta(days=(4 - meeting.weekday()) % 7)
        else:
            d = _mk_date(meeting.year, meeting.month, calendar.monthrange(meeting.year, meeting.month)[1])
        return {"text": m.group(0).strip(), "date": d, "kind": "relative", "span": m.span()}
    m = D_WD.search(sentence)
    if m:
        target = WEEKDAYS.index(m.group(2).lower())
        delta = (target - meeting.weekday()) % 7 or 7  # strictly after the meeting day
        return {"text": m.group(0).strip(), "date": meeting + timedelta(days=delta), "kind": "relative", "span": m.span()}
    return None


def _clean_task(task: str, span: tuple[int, int] | None, sentence_offset: int = 0) -> str:
    t = task
    if span:
        s, e = span[0] - sentence_offset, span[1] - sentence_offset
        if 0 <= s < e <= len(t):
            t = (t[:s] + t[e:])
    t = re.sub(r"\s+", " ", t).strip(" ,;.:-?!")
    t = re.sub(r"\s+(?:and|but|so)$", "", t, flags=re.I).strip(" ,;.:-")
    return t


def _title(task: str) -> str:
    t = task.strip()
    t = t[0].upper() + t[1:] if t else t
    if len(t) > 90:
        t = t[:90].rsplit(" ", 1)[0] + "…"
    return t


def _norm_cmp(s: str) -> str:
    return re.sub(r"\s+", " ", s.lower()).strip(" .")


def analyze(transcript: str, *, title: str = "", meeting_date: str | None = None,
            participants: list[str] | None = None, project: str = "") -> dict:
    meeting = _parse_meeting_date(meeting_date)
    participants = participants or []

    # ---- tokenise into (speaker, sentence) turns
    turns: list[tuple[str | None, list[str]]] = []
    for raw in transcript.splitlines():
        if not raw.strip():
            continue
        m = SPEAKER_RE.match(raw)
        speaker, text = (m.group("speaker"), m.group("text")) if m else (None, raw.strip())
        sents = [s.strip() for s in SENT_SPLIT.split(text) if s.strip()]
        turns.append((speaker, sents))

    speakers = []
    for sp, _ in turns:
        if sp and sp not in speakers:
            speakers.append(sp)
    first_names = {s.split()[0] for s in speakers} | {p.split()[0] for p in participants if p.split()}
    full_by_first = {}
    for n in participants + speakers:  # prefer the full names the user typed over bare speaker labels
        if n.split():
            full_by_first.setdefault(n.split()[0], n)

    def resolve_name(first: str) -> str | None:
        return full_by_first.get(first) if first in first_names else None

    # ---- topics from the agenda sentence
    topics: list[str] = []
    for _, sents in turns:
        for s in sents:
            m = re.search(r"\bagenda(?: today| for today)?(?: (?:is|covers|includes|has|will cover))?\s+(?P<items>[^.]+)", s, re.I)
            if m:
                parts = re.split(r",\s*(?:and\s+)?|\s+and\s+", m.group("items"))
                for p in parts:
                    p = re.sub(r"^(?:the|our)\s+", "", p.strip(), flags=re.I).strip(" .")
                    if 2 < len(p) < 80 and p not in topics:
                        topics.append(p)
    if not topics and project:
        topics = [project]

    def topic_for(sentence: str) -> str | None:
        words = set(re.findall(r"[a-z]{5,}", sentence.lower()))
        hits = [t for t in topics if words & set(re.findall(r"[a-z]{5,}", t.lower()))]
        return hits[0] if len(hits) == 1 else (project or None)

    decisions: list[dict] = []
    actions: list[dict] = []
    blockers: list[str] = []
    dependencies: list[str] = []
    risks: list[str] = []
    open_questions: list[str] = []
    discussion: list[str] = []
    pending_requests: dict[str, dict] = {}
    seen_actions: set[tuple[str, str]] = set()

    def add_unique(lst: list[str], text: str) -> None:
        if text not in lst:
            lst.append(text)

    for ti, (speaker, sents) in enumerate(turns):
        for si, sent in enumerate(sents):
            words = sent.split()
            if len(words) < 3:
                continue
            is_q = sent.rstrip().endswith("?")
            hedged = bool(HEDGE.search(sent))
            classified = False
            nxt = sents[si + 1] if si + 1 < len(sents) else ""

            # --- signals that do not exclude other classifications
            if BLOCKER.search(sent):
                add_unique(blockers, sent)
            if DEPENDENCY.search(sent):
                add_unique(dependencies, sent)
            if RISK.search(sent) and not BLOCKER.search(sent):
                add_unique(risks, sent)
            if UNCERTAIN.search(sent) or (is_q and WH_Q.search(sent)):
                add_unique(open_questions, sent)
                classified = True

            # --- decisions (never from hedged statements or questions)
            if not is_q and DECISION.search(sent):
                if hedged:
                    add_unique(open_questions, sent)
                else:
                    m = DECISION_LEAD.search(sent)
                    rest = sent[m.end():].strip(" .") if m else ""
                    desc = (rest[0].upper() + rest[1:]) if len(rest.split()) >= 3 else sent
                    decisions.append({"description": desc, "evidence": sent, "topic": topic_for(sent), "status": "confirmed"})
                continue

            # --- acknowledgement of an earlier request (merge instead of duplicating)
            if speaker and speaker in pending_requests and ACK.search(sent) and not is_q:
                req = pending_requests[speaker]
                if not req["acked"] and ti - req["turn"] <= 3:
                    req["acked"] = True
                    req["item"]["confidence"] = 0.9
                    req["item"]["review_reasons"] = [r for r in req["item"]["review_reasons"] if "acknowledg" not in r]
                    req["item"]["needs_review"] = bool(req["item"]["review_reasons"])
                    continue

            if is_q and not A_REQUEST.match(sent.rstrip("?").strip() + "?"):
                continue

            # --- actions
            owner, task, conf, reasons = None, None, 0.8, []
            body = sent
            pm = A_PREFIX.match(sent)
            if pm:
                body = pm.group("rest")
                conf = 0.85
            req_m = A_REQUEST.match(body.strip())
            if req_m and resolve_name(req_m.group("name")):
                owner, task, conf = resolve_name(req_m.group("name")), req_m.group("task"), 0.6
                reasons.append("This was a request; no acknowledgement from the assignee was found.")
            elif not is_q:
                m1 = A_FIRST.search(body)
                m2 = A_NAMED.search(body)
                m3 = A_UNOWNED.search(body)
                if m1 and speaker:
                    owner, task = resolve_name(speaker.split()[0]) or speaker, m1.group("task")
                elif m2 and resolve_name(m2.group("name")):
                    owner, task = resolve_name(m2.group("name")), m2.group("task")
                elif m3:
                    owner, task, conf = UNASSIGNED, m3.group("task"), 0.5
                    reasons.append("No clear owner was identified.")
                elif pm:
                    owner, task, conf = UNASSIGNED, body, 0.6
                    reasons.append("No clear owner was identified.")
            if not task:
                if not classified and re.search(r"\b(update|progress|status|completed|finished|shipped|reported|issue|feedback|results?|metrics?|affects?|drop(?:ping)?)\b", sent, re.I):
                    add_unique(discussion, sent)
                continue

            if hedged and owner != UNASSIGNED:
                conf = min(conf, 0.5)
                reasons.append("The commitment sounds tentative.")

            # deadline: look in the sentence that holds the task
            dl = find_deadline(body, meeting)
            span = dl["span"] if dl else None
            offset = body.find(task) if task in body else 0
            clean = _clean_task(task, span, offset if span else 0)
            if not clean or len(clean.split()) < 2:
                continue
            key = (_norm_cmp(clean), (owner or "").lower())
            if key in seen_actions:
                continue
            seen_actions.add(key)

            due_text = dl["text"] if dl else None
            due_date = dl["date"].isoformat() if dl and dl["date"] else None
            if dl and dl["kind"] == "relative":
                reasons.append(f"The deadline \"{due_text}\" was resolved to {due_date} from the meeting date. Please confirm.")
            if dl and dl["kind"] == "ambiguous":
                reasons.append(f"The deadline is unclear (\"{due_text}\").")

            ctx = sent + " " + nxt
            priority = "Medium"
            if HIGH.search(ctx) or (dl and dl["date"] and (dl["date"] - meeting).days <= 2):
                priority = "High"
            elif LOW.search(ctx):
                priority = "Low"

            item = {
                "title": _title(clean), "description": sent, "owner": owner or UNASSIGNED,
                "due_date": due_date, "due_text": due_text, "priority": priority, "topic": topic_for(sent),
                "evidence": sent, "confidence": conf,
                "needs_review": bool(reasons), "needs_clarification": bool(dl and dl["kind"] == "ambiguous"),
                "review_reasons": reasons,
            }
            actions.append(item)
            if req_m and owner and owner != UNASSIGNED:
                pending_requests[owner.split()[0]] = {"item": item, "turn": ti, "acked": False}
                pending_requests[owner] = pending_requests[owner.split()[0]]
            if conf < 0.6:
                item["needs_review"] = True

    # requests never acknowledged keep their review reason; acknowledged ones were cleared above
    for it in actions:
        if it["review_reasons"]:
            it["needs_review"] = True

    # ---- summary (extractive, built only from what was found)
    names = speakers[:6] or participants[:6]
    parts = []
    head = (title or "The meeting").strip()
    parts.append(f"{head} ({len(speakers) or len(participants) or 'unknown number of'} participant"
                 f"{'' if (len(speakers) or len(participants)) == 1 else 's'}{': ' + ', '.join(names) if names else ''}).")
    if topics:
        parts.append("Topics on the agenda: " + "; ".join(topics) + ".")
    parts.append(f"The transcript contains {len(decisions)} confirmed decision{'s' if len(decisions) != 1 else ''} and "
                 f"{len(actions)} proposed action item{'s' if len(actions) != 1 else ''}"
                 f" ({sum(1 for a in actions if a['needs_review'])} flagged for review).")
    if decisions:
        parts.append("Decisions: " + " ".join(d["description"].rstrip(".") + "." for d in decisions[:3]))
    unresolved = (blockers + [q for q in open_questions if q not in blockers])[:6]
    if blockers:
        parts.append(f"{len(blockers)} blocker{'s' if len(blockers) != 1 else ''} and {len(open_questions)} open question"
                     f"{'s' if len(open_questions) != 1 else ''} were raised.")
    elif open_questions:
        parts.append(f"{len(open_questions)} open question{'s' if len(open_questions) != 1 else ''} were raised.")
    summary = " ".join(parts) + " (Rule-based demo summary, not AI-generated.)"

    return {
        "meeting_summary": summary,
        "main_topics": topics[:6],
        "outcomes": [d["description"] for d in decisions][:10],
        "unresolved": unresolved,
        "decisions": decisions,
        "action_items": actions,
        "discussion_points": discussion[:8],
        "risks": risks[:8],
        "blockers": blockers[:8],
        "dependencies": dependencies[:8],
        "open_questions": open_questions[:10],
        "missing_information": [],
    }
