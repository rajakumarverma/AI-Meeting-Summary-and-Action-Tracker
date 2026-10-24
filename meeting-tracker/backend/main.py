"""FastAPI app: a tiny, secure proxy for AI analysis + static hosting for the single-page UI.

Run:  python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
"""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import Settings, load_env_file
from .errors import AnalysisError
from .schemas import AnalyzeRequest
from .service import analyze_transcript

load_env_file()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)  # request logs must never expose URLs/headers
log = logging.getLogger("meeting_tracker")

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
MAX_BODY_BYTES = 1_500_000  # transcripts are capped far below this; this stops oversized uploads early

app = FastAPI(title="AI Meeting Summary & Action Tracker", docs_url=None, redoc_url=None, openapi_url=None)


def get_settings() -> Settings:
    return Settings.from_env()


def _err(status: int, code: str, message: str, retryable: bool = False) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message, "retryable": retryable}})


@app.middleware("http")
async def guard(request: Request, call_next):
    cl = request.headers.get("content-length")
    if cl and cl.isdigit() and int(cl) > MAX_BODY_BYTES:
        return _err(413, "request_too_large", "The request is too large. Use a transcript under 60,000 characters.")
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
        "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
    if not request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-cache")
    return response


@app.exception_handler(AnalysisError)
async def _analysis_error(_: Request, exc: AnalysisError):
    headers = {"Retry-After": str(exc.retry_after)} if exc.retry_after else None
    return JSONResponse(status_code=exc.status, content=exc.to_payload(), headers=headers)


@app.exception_handler(RequestValidationError)
async def _validation_error(_: Request, exc: RequestValidationError):
    return _err(422, "invalid_request", "The request was not valid. Check the meeting details and transcript, then try again.")


@app.exception_handler(Exception)
async def _unexpected(_: Request, exc: Exception):
    log.error("unhandled error type=%s", type(exc).__name__)  # never log message/content (may contain meeting data)
    return _err(500, "internal_error", "Something went wrong on the server. Please try again.", True)


@app.get("/api/health")
async def health():
    s = get_settings()
    live = s.ai_configured
    return {
        "status": "ok",
        "ai_configured": live,
        "default_mode": "ai" if live else "demo",
        "provider": s.provider if live else None,
        "provider_label": s.provider_label if live else None,
        "model": s.model if live else None,
        "max_transcript_chars": s.max_transcript_chars,
        "disclosure": (
            f"Live AI analysis is enabled: transcripts are sent from this server to {s.provider_label} "
            f"({s.model}) for processing. Do not submit content you are not allowed to share."
            if live else
            "Demo mode: analysis runs on this server with fixed rules. Transcripts are not sent to any external service."
        ),
    }


@app.post("/api/analyze")
async def analyze(req: AnalyzeRequest):
    return await analyze_transcript(req, get_settings())


# Static UI last so /api/* routes win.
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
