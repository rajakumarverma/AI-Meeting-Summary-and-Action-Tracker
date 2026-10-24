from __future__ import annotations

from .base import HttpProvider


class AnthropicProvider(HttpProvider):
    name = "anthropic"

    def build_request(self, system: str, user: str):
        url = (self.base_url or "https://api.anthropic.com").rstrip("/") + "/v1/messages"
        headers = {"x-api-key": self._api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"}
        payload = {"model": self.model, "max_tokens": 4096, "temperature": 0, "system": system,
                   "messages": [{"role": "user", "content": user}]}
        return url, headers, payload

    def extract_text(self, data: dict) -> str:
        return "".join(b.get("text", "") for b in data["content"] if b.get("type") == "text")
