"""
Error shape shared by every endpoint.

Matches the FastAPI build's `{"detail": {"code", "message"}}` envelope so the
existing frontend error handling keeps working unchanged.
"""

from typing import Any, Dict, Optional


class ApiError(Exception):
    """An error that is safe to show a caller."""

    def __init__(self, status: int, code: str, message: str, extra: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.extra = extra or {}

    def to_response(self) -> Dict[str, Any]:
        body: Dict[str, Any] = {"detail": {"code": self.code, "message": self.message}}
        if self.extra:
            body["detail"].update(self.extra)
        return body
