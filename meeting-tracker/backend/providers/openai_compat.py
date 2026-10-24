from __future__ import annotations

from .base import HttpProvider


class OpenAICompatProvider(HttpProvider):
    name = "openai"

    def build_request(self, system: str, user: str):
        url = (self.base_url or "https://api.openai.com/v1").rstrip("/") + "/chat/completions"
        headers = {"authorization": f"Bearer {self._api_key}", "content-type": "application/json"}
        payload = {"model": self.model, "temperature": 0, "response_format": {"type": "json_object"},
                   "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
        return url, headers, payload

    def extract_text(self, data: dict) -> str:
        return data["choices"][0]["message"]["content"] or ""
