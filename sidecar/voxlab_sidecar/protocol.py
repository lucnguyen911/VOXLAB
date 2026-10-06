"""Structured errors and message helpers for the VoxLab sidecar JSON Lines protocol."""
from __future__ import annotations

import json
import sys
import threading
from typing import Any

PROTOCOL_VERSION = 1

ERROR_CODES = frozenset(
    {
        "INVALID_REQUEST",
        "UNKNOWN_METHOD",
        "BUSY",
        "CANCELLED",
        "MODEL_NOT_FOUND",
        "MODEL_NOT_LOADED",
        "MODEL_LOAD_FAILED",
        "DEVICE_UNAVAILABLE",
        "INPUT_NOT_FOUND",
        "INFERENCE_FAILED",
        "OUT_OF_MEMORY",
        "ENGINE_NOT_INSTALLED",
        "INTERNAL",
    }
)


class SidecarError(Exception):
    """An error that is reported to the host as a structured error response."""

    def __init__(self, code: str, message: str):
        if code not in ERROR_CODES:
            raise ValueError(f"unknown error code {code}")
        super().__init__(message)
        self.code = code
        self.message = message


class Cancelled(SidecarError):
    def __init__(self, message: str = "Request cancelled"):
        super().__init__("CANCELLED", message)


class Writer:
    """Thread-safe writer: stdout is reserved for protocol lines only."""

    def __init__(self, stream=None):
        self._stream = stream or sys.stdout
        self._lock = threading.Lock()

    def send(self, message: dict[str, Any]) -> None:
        line = json.dumps(message, ensure_ascii=False, separators=(",", ":"))
        with self._lock:
            self._stream.write(line + "\n")
            self._stream.flush()

    def ok(self, req_id: str, result: dict[str, Any]) -> None:
        self.send({"id": req_id, "ok": True, "result": result})

    def error(self, req_id: str | None, code: str, message: str) -> None:
        self.send({"id": req_id, "ok": False, "error": {"code": code, "message": message}})

    def progress(self, req_id: str, pct: float, stage: str) -> None:
        pct = max(0.0, min(100.0, float(pct)))
        self.send({"id": req_id, "event": "progress", "data": {"pct": round(pct, 1), "stage": stage}})


def log(message: str) -> None:
    """Diagnostics go to stderr only. Callers must never pass secrets or user text bodies."""
    sys.stderr.write(f"[sidecar] {message}\n")
    sys.stderr.flush()


def require(params: dict[str, Any], key: str, kind: type) -> Any:
    value = params.get(key)
    if not isinstance(value, kind) or (kind is str and not value.strip()):
        raise SidecarError("INVALID_REQUEST", f"param '{key}' must be a non-empty {kind.__name__}")
    return value
