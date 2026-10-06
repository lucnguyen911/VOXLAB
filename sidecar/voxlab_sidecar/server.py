"""JSON Lines request loop. Light methods run inline; inference runs on one worker thread."""
from __future__ import annotations

import json
import os
import sys
import threading
from typing import Any, Callable

from .protocol import PROTOCOL_VERSION, Cancelled, SidecarError, Writer, log

Handler = Callable[[str, dict[str, Any], "RequestContext"], dict[str, Any]]


class RequestContext:
    def __init__(self, req_id: str, writer: Writer):
        self.req_id = req_id
        self._writer = writer
        self._cancel = threading.Event()

    def progress(self, pct: float, stage: str) -> None:
        self._writer.progress(self.req_id, pct, stage)

    def cancel(self) -> None:
        self._cancel.set()

    @property
    def cancelled(self) -> bool:
        return self._cancel.is_set()

    def check_cancelled(self) -> None:
        if self._cancel.is_set():
            raise Cancelled()


class Server:
    def __init__(self, writer: Writer | None = None):
        self.writer = writer or Writer()
        self._heavy: dict[str, Handler] = {}
        self._light: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {}
        self._active: RequestContext | None = None
        self._active_lock = threading.Lock()
        self._worker: threading.Thread | None = None
        self._running = True
        self.register_light("system.ping", lambda _p: {"pong": True})

    def register_heavy(self, method: str, handler: Handler) -> None:
        self._heavy[method] = handler

    def register_light(self, method: str, handler: Callable[[dict[str, Any]], dict[str, Any]]) -> None:
        self._light[method] = handler

    # ---- request handling -------------------------------------------------
    def handle_line(self, line: str) -> None:
        line = line.strip()
        if not line:
            return
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            self.writer.error(None, "INVALID_REQUEST", "malformed JSON")
            return
        if not isinstance(msg, dict):
            self.writer.error(None, "INVALID_REQUEST", "request must be a JSON object")
            return
        req_id = msg.get("id")
        method = msg.get("method")
        params = msg.get("params") if msg.get("params") is not None else {}
        if not isinstance(req_id, str) or not req_id or not isinstance(method, str) or not isinstance(params, dict):
            self.writer.error(req_id if isinstance(req_id, str) else None, "INVALID_REQUEST",
                              "request requires string 'id', string 'method' and object 'params'")
            return

        if method == "cancel":
            self.writer.ok(req_id, {"cancelRequested": self._cancel(params.get("target"))})
        elif method == "system.shutdown":
            self.writer.ok(req_id, {})
            self._running = False
        elif method in self._light:
            self._run_inline(req_id, method, params)
        elif method in self._heavy:
            self._dispatch(req_id, method, params)
        else:
            self.writer.error(req_id, "UNKNOWN_METHOD", f"unknown method '{method}'")

    def _run_inline(self, req_id: str, method: str, params: dict[str, Any]) -> None:
        try:
            self.writer.ok(req_id, self._light[method](params))
        except SidecarError as e:
            self.writer.error(req_id, e.code, e.message)
        except Exception as e:  # noqa: BLE001 - boundary: never crash the loop
            log(f"internal error in {method}: {type(e).__name__}")
            self.writer.error(req_id, "INTERNAL", f"{type(e).__name__}: {e}")

    def _cancel(self, target: Any) -> bool:
        with self._active_lock:
            if self._active is not None and self._active.req_id == target:
                self._active.cancel()
                return True
        return False

    def _dispatch(self, req_id: str, method: str, params: dict[str, Any]) -> None:
        with self._active_lock:
            if self._active is not None:
                self.writer.error(req_id, "BUSY", f"another inference is running ({self._active.req_id})")
                return
            ctx = RequestContext(req_id, self.writer)
            self._active = ctx
        self._worker = threading.Thread(target=self._run_heavy, args=(ctx, method, params), daemon=True)
        self._worker.start()

    def _run_heavy(self, ctx: RequestContext, method: str, params: dict[str, Any]) -> None:
        try:
            result = self._heavy[method](method, params, ctx)
            # A request cancelled after its last checkpoint still reports CANCELLED.
            if ctx.cancelled:
                raise Cancelled()
            self.writer.ok(ctx.req_id, result)
        except SidecarError as e:
            self.writer.error(ctx.req_id, e.code, e.message)
        except MemoryError:
            self.writer.error(ctx.req_id, "OUT_OF_MEMORY", "host memory exhausted")
        except Exception as e:  # noqa: BLE001
            code = "OUT_OF_MEMORY" if "out of memory" in str(e).lower() else "INFERENCE_FAILED"
            log(f"{method} failed: {type(e).__name__}")
            self.writer.error(ctx.req_id, code, f"{type(e).__name__}: {e}")
        finally:
            with self._active_lock:
                self._active = None

    # ---- main loop ---------------------------------------------------------
    def serve(self, stdin=None) -> int:
        stdin = stdin or sys.stdin
        self.writer.send({"event": "ready", "data": {"protocol": PROTOCOL_VERSION, "pid": os.getpid()}})
        for line in stdin:
            self.handle_line(line)
            if not self._running:
                break
        # stdin closed (host gone) or shutdown requested: let a running job observe cancellation.
        with self._active_lock:
            if self._active is not None:
                self._active.cancel()
        if self._worker is not None:
            self._worker.join(timeout=10)
        return 0
