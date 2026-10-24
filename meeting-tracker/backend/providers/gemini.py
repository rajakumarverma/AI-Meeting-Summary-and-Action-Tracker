from __future__ import annotations

from ..errors import AnalysisError
from .base import HttpProvider


class GeminiProvider(HttpProvider):
    name = "gemini"

    def build_request(self, system: str, user: str):
        base = (self.base_url or "https://generativelanguage.googleapis.com/v1beta").rstrip("/")
        url = f"{base}/models/{self.model}:generateContent"
        headers = {"x-goog-api-key": self._api_key, "content-type": "application/json"}
        payload = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {"temperature": 0, "responseMimeType": "application/json", "maxOutputTokens": 4096},
        }
        return url, headers, payload

    def extract_text(self, data: dict) -> str:
        if data.get("promptFeedback", {}).get("blockReason"):
            raise AnalysisError("ai_blocked", "The AI provider declined to process this transcript.", 502)
        parts = data["candidates"][0]["content"]["parts"]
        return "".join(p.get("text", "") for p in parts)
