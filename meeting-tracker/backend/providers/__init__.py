"""Provider registry / factory."""
from __future__ import annotations

from ..config import Settings
from ..errors import AnalysisError
from .anthropic import AnthropicProvider
from .gemini import GeminiProvider
from .openai_compat import OpenAICompatProvider

REGISTRY = {"anthropic": AnthropicProvider, "gemini": GeminiProvider, "openai": OpenAICompatProvider}


def build_provider(settings: Settings, transport=None):
    if not settings.ai_configured:
        raise AnalysisError(
            "ai_not_configured",
            "Live AI analysis is not configured on the server. Set an API key (see .env.example) and restart, "
            "or choose Demo mode.", 503)
    cls = REGISTRY[settings.provider]
    return cls(api_key=settings.api_key, model=settings.model, timeout=settings.timeout,
               base_url=settings.base_url if settings.provider == "openai" else None, transport=transport)
