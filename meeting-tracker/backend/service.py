"""Orchestration: choose demo vs live AI, call the provider, validate, return a labelled result."""
from __future__ import annotations

import asyncio
import logging
import re

from . import demo_analyzer
from .config import Settings
from .errors import AnalysisError
from .prompts import SYSTEM_PROMPT, build_user_prompt
from .providers import build_provider
from .schemas import AnalyzeRequest
from .validation import extract_json, normalize_analysis

log = logging.getLogger("meeting_tracker.service")

DEMO_LABEL = "Demo mode (rule-based, not AI)"


def clean_transcript(text: str) -> str:
    text = (text or "").replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
    return re.sub(r"[ \t]+\n", "\n", text).strip()


def check_transcript(text: str, settings: Settings) -> str:
    t = clean_transcript(text)
    if not t:
        raise AnalysisError("empty_transcript", "The transcript is empty. Paste or upload the meeting transcript, "
                            "then click Analyze.", 422)
    if len(t) < 20:
        raise AnalysisError("transcript_too_short", "The transcript is too short to analyse (minimum 20 characters).", 422)
    if len(t) > settings.max_transcript_chars:
        raise AnalysisError(
            "transcript_too_long",
            f"The transcript has {len(t):,} characters; the limit is {settings.max_transcript_chars:,}. "
            "Split it into parts (for example one per agenda item) and analyse each separately.", 413)
    return t


async def analyze_transcript(req: AnalyzeRequest, settings: Settings, *, provider_factory=None) -> dict:
    transcript = check_transcript(req.transcript, settings)
    use_live = req.mode == "ai" or (req.mode == "auto" and settings.ai_configured)

    if req.mode == "ai" and not settings.ai_configured:
        raise AnalysisError("ai_not_configured",
                            "Live AI analysis is not configured on the server. Set an API key (see .env.example) "
                            "and restart, or choose Demo mode.", 503)

    if not use_live:
        raw = demo_analyzer.analyze(transcript, title=req.title, meeting_date=req.meeting_date,
                                    participants=req.participants, project=req.project)
        analysis, warnings = normalize_analysis(raw, transcript, req.participants)
        return {"mode": "demo", "provider": None, "model": None, "label": DEMO_LABEL,
                "analysis": analysis, "warnings": warnings}

    provider = (provider_factory or build_provider)(settings)
    user_prompt = build_user_prompt(transcript=transcript, title=req.title, meeting_date=req.meeting_date,
                                    participants=req.participants, project=req.project)
    last: AnalysisError | None = None
    for attempt in range(settings.max_retries + 1):
        try:
            text = await provider.complete_json(SYSTEM_PROMPT, user_prompt)
            raw = extract_json(text)
            analysis, warnings = normalize_analysis(raw, transcript, req.participants)
            return {"mode": "ai", "provider": provider.name, "model": provider.model,
                    "label": f"AI analysis ({provider.name}: {provider.model})",
                    "analysis": analysis, "warnings": warnings}
        except AnalysisError as exc:
            last = exc
            if not exc.retryable or attempt >= settings.max_retries:
                break
            log.info("retrying analysis after %s (attempt %d)", exc.code, attempt + 1)  # no content logged
            await asyncio.sleep(settings.retry_backoff * (2 ** attempt))
    assert last is not None
    raise last
