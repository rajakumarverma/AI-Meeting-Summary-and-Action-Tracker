"""Provider adapter base class.

To add a provider: subclass HttpProvider, implement `build_request` and `extract_text`, and register it in
`providers/__init__.py`. The rest of the app only sees `complete_json(system, user) -> str`.
"""
from __future__ import annotations

import logging

import httpx

from ..errors import AnalysisError

log = logging.getLogger("meeting_tracker.provider")


class HttpProvider:
    name = "base"

    def __init__(self, *, api_key: str, model: str, timeout: float = 45.0,
                 base_url: str | None = None, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._api_key = api_key
        self.model = model
        self.timeout = timeout
        self.base_url = base_url
        self._transport = transport

    def __repr__(self) -> str:  # never include the key
        return f"<{self.__class__.__name__} model={self.model!r}>"

    # -- to implement
    def build_request(self, system: str, user: str) -> tuple[str, dict, dict]:
        raise NotImplementedError

    def extract_text(self, data: dict) -> str:
        raise NotImplementedError

    # -- shared
    async def complete_json(self, system: str, user: str) -> str:
        url, headers, payload = self.build_request(system, user)
        try:
            async with httpx.AsyncClient(timeout=self.timeout, transport=self._transport) as client:
                resp = await client.post(url, headers=headers, json=payload)
        except httpx.TimeoutException:
            raise AnalysisError("ai_timeout", "The AI service took too long to respond. Please try again, "
                                "or shorten the transcript.", 504, retryable=True)
        except httpx.HTTPError:
            raise AnalysisError("ai_unreachable", "Could not reach the AI service. Check the server's network "
                                "connection, then try again.", 502, retryable=True)

        if resp.status_code == 429:
            ra = resp.headers.get("retry-after", "")
            raise AnalysisError("ai_rate_limited", "The AI service is rate-limiting requests. Wait a moment and "
                                "try again.", 429, retryable=True, retry_after=int(ra) if ra.isdigit() else 20)
        if resp.status_code in (401, 403):
            log.warning("provider=%s rejected credentials (status %s)", self.name, resp.status_code)
            raise AnalysisError("ai_auth_failed", "The AI provider rejected the server's credentials. Ask the "
                                "administrator to check the configured API key.", 502)
        if resp.status_code >= 500:
            raise AnalysisError("ai_provider_error", "The AI service had a temporary problem. Please try again.",
                                502, retryable=True)
        if resp.status_code >= 400:
            log.warning("provider=%s returned status %s", self.name, resp.status_code)
            raise AnalysisError("ai_bad_request", "The AI service could not process this request (the model name "
                                "or request size may be invalid). Check the server configuration.", 502)
        try:
            return self.extract_text(resp.json())
        except (ValueError, KeyError, IndexError, TypeError):
            raise AnalysisError("malformed_ai_response", "The AI service returned an unexpected response format. "
                                "Click Analyze again to retry.", 502, retryable=True)
