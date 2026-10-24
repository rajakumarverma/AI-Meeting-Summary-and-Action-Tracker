"""Application errors that map cleanly onto JSON error responses."""
from __future__ import annotations


class AnalysisError(Exception):
    """An error with a stable machine code and a user-facing message.

    Messages must never contain API keys, raw provider responses or transcript text.
    """

    def __init__(self, code: str, message: str, status: int = 500, *,
                 retryable: bool = False, retry_after: int | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.retryable = retryable
        self.retry_after = retry_after

    def to_payload(self) -> dict:
        err = {"code": self.code, "message": self.message, "retryable": self.retryable}
        if self.retry_after is not None:
            err["retry_after"] = self.retry_after
        return {"error": err}
