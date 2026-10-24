"""Runtime configuration, read from environment variables (and an optional .env file).

API keys live only here, on the server. They are never sent to the browser, never logged
and are excluded from the dataclass repr.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_MODELS = {
    "anthropic": "claude-sonnet-5-5",
    "gemini": "gemini-2.5-flash",
    "openai": "gpt-4.1-mini",
}
KEY_VARS = {
    "anthropic": "ANTHROPIC_API_KEY",
    "gemini": "GEMINI_API_KEY",
    "openai": "OPENAI_API_KEY",
}
PROVIDER_LABELS = {"anthropic": "Anthropic", "gemini": "Google Gemini", "openai": "OpenAI-compatible"}


def load_env_file(path: Path | None = None) -> None:
    """Tiny .env loader (KEY=VALUE per line). Real environment variables always win."""
    path = path or Path(__file__).resolve().parent.parent / ".env"
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and value and key not in os.environ:
            os.environ[key] = value


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "") or default)
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, "") or default)
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    provider: str | None
    model: str | None
    api_key: str | None = field(default=None, repr=False)
    base_url: str | None = None
    timeout: float = 45.0
    max_retries: int = 1
    retry_backoff: float = 0.5
    max_transcript_chars: int = 60000
    force_demo: bool = False

    @property
    def ai_configured(self) -> bool:
        return bool(self.provider and self.api_key) and not self.force_demo

    @property
    def provider_label(self) -> str | None:
        return PROVIDER_LABELS.get(self.provider or "")

    @classmethod
    def from_env(cls) -> "Settings":
        provider = (os.environ.get("AI_PROVIDER") or "").strip().lower() or None
        if provider and provider not in KEY_VARS:
            provider = None  # unknown provider name -> treated as not configured
        if provider is None and not (os.environ.get("AI_PROVIDER") or "").strip():
            for name, var in KEY_VARS.items():  # auto-detect from whichever key is present
                if os.environ.get(var):
                    provider = name
                    break
        api_key = os.environ.get(KEY_VARS[provider]) if provider else None
        model = (os.environ.get("AI_MODEL") or "").strip() or (DEFAULT_MODELS.get(provider) if provider else None)
        return cls(
            provider=provider,
            model=model,
            api_key=(api_key or "").strip() or None,
            base_url=(os.environ.get("OPENAI_BASE_URL") or "").strip() or None,
            timeout=_float("AI_TIMEOUT_SECONDS", 45.0),
            max_retries=max(0, _int("AI_MAX_RETRIES", 1)),
            retry_backoff=_float("AI_RETRY_BACKOFF", 0.5),
            max_transcript_chars=max(1000, _int("MAX_TRANSCRIPT_CHARS", 60000)),
            force_demo=(os.environ.get("FORCE_DEMO_MODE") or "0").strip().lower() in {"1", "true", "yes"},
        )
