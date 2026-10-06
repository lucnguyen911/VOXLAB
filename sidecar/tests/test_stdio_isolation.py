"""Regression: worker-thread access to process std handles must not deadlock (Windows pipe stdin).

Original bug: `tts.load` for OmniVoice hung forever because `import scipy.special` (Fortran/OpenMP
DLL init) in the worker thread queried the stdin pipe while the main thread had a pending ReadFile.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class StdioIsolationTest(unittest.TestCase):
    def setUp(self):
        self.proc = subprocess.Popen(
            [sys.executable, "-m", "voxlab_sidecar", "--runtime", "core"], cwd=ROOT,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, encoding="utf-8", env=dict(os.environ, PYTHONUNBUFFERED="1"),
        )
        ready = json.loads(self.proc.stdout.readline())
        self.assertEqual(ready["event"], "ready")

    def tearDown(self):
        self.proc.kill()
        self.proc.wait(timeout=10)

    def _request(self, msg: dict, timeout: float) -> dict:
        self.proc.stdin.write(json.dumps(msg) + "\n")
        self.proc.stdin.flush()
        box: dict = {}

        def read():
            for line in self.proc.stdout:
                obj = json.loads(line)
                if obj.get("id") == msg["id"] and "event" not in obj:
                    box["resp"] = obj
                    return

        t = threading.Thread(target=read, daemon=True)
        t.start()
        t.join(timeout)
        self.assertIn("resp", box, f"no response within {timeout}s (deadlock on std handles?)")
        return box["resp"]

    def test_worker_can_query_std_handles_while_main_reads(self):
        resp = self._request({"id": "p1", "method": "system.debug_sleep",
                              "params": {"seconds": 0.1, "probeStdHandles": True}}, timeout=15)
        self.assertTrue(resp["ok"], resp)
        handles = resp["result"]["stdHandles"]
        if os.name == "nt":
            self.assertEqual(handles["stdin"], "char")   # NUL, not the protocol pipe
            self.assertNotEqual(handles["stdout"], "unknown")
        else:
            self.assertFalse(handles["stdinIsPipe"])

    def test_protocol_still_works_after_isolation(self):
        resp = self._request({"id": "x1", "method": "system.ping", "params": {}}, timeout=10)
        self.assertEqual(resp, {"id": "x1", "ok": True, "result": {"pong": True}})


if __name__ == "__main__":
    unittest.main()
