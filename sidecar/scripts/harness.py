"""Dev/verification harness: spawns the real sidecar process and drives it over JSON Lines.

Used for runtime proofs and the REAL inference benchmark. It is not part of the product.

    python sidecar/scripts/harness.py '<json array of [method, params]>' [--cancel-after SEC]
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def gpu_used_mb() -> int | None:
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
                             capture_output=True, text=True, timeout=5).stdout.strip().splitlines()
        return int(out[0]) if out else None
    except Exception:  # noqa: BLE001
        return None


RUNTIME_VENVS = {"core": ".venv", "chatterbox": ".venv-chatterbox", "qwen": ".venv-qwen"}


class Sidecar:
    def __init__(self, runtime: str = "core"):
        self.vram_baseline_mb = gpu_used_mb() or 0
        env = dict(os.environ, PYTHONUNBUFFERED="1")
        python = os.path.join(ROOT, RUNTIME_VENVS[runtime], "Scripts", "python.exe")
        self.proc = subprocess.Popen(
            [python, "-m", "voxlab_sidecar", "--runtime", runtime], cwd=ROOT, env=env,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8", bufsize=1,
        )
        self.stderr_lines: list[str] = []
        threading.Thread(target=self._drain_stderr, daemon=True).start()
        ready = json.loads(self.proc.stdout.readline())
        assert ready.get("event") == "ready", ready
        self.pid = ready["data"]["pid"]
        self._n = 0
        self.peak_vram_mb = 0
        self.peak_rss_mb = 0.0
        self._sampling = True
        threading.Thread(target=self._sample, daemon=True).start()

    def _drain_stderr(self):
        for line in self.proc.stderr:
            self.stderr_lines.append(line.rstrip())

    def _sample(self):
        # Windows WDDM does not expose per-process VRAM via nvidia-smi, so we record the
        # device-wide used VRAM delta over the baseline captured before the sidecar started.
        while self._sampling and self.proc.poll() is None:
            try:
                used = gpu_used_mb()
                if used is not None:
                    self.peak_vram_mb = max(self.peak_vram_mb, used - self.vram_baseline_mb)
                ps = subprocess.run(
                    ["powershell", "-NoProfile", "-Command", f"(Get-Process -Id {self.pid}).WorkingSet64"],
                    capture_output=True, text=True, timeout=5).stdout.strip()
                if ps.isdigit():
                    self.peak_rss_mb = max(self.peak_rss_mb, int(ps) / 1048576)
            except Exception:  # noqa: BLE001
                pass
            time.sleep(0.25)

    def request(self, method, params=None, cancel_after=None, quiet=False):
        self._n += 1
        rid = f"h-{self._n}"
        self.send({"id": rid, "method": method, "params": params or {}})
        if cancel_after is not None:
            threading.Timer(cancel_after, lambda: self.send(
                {"id": f"{rid}-cancel", "method": "cancel", "params": {"target": rid}})).start()
        started = time.perf_counter()
        while True:
            line = self.proc.stdout.readline()
            if not line:
                return {"id": rid, "ok": False, "error": {"code": "SIDECAR_CRASHED", "message": "stdout closed"},
                        "wallSec": round(time.perf_counter() - started, 3)}
            msg = json.loads(line)
            if msg.get("id") != rid:
                continue
            if msg.get("event") == "progress":
                if not quiet:
                    print(f"  progress {msg['data']['pct']:5.1f}% {msg['data']['stage']}", flush=True)
                continue
            msg["wallSec"] = round(time.perf_counter() - started, 3)
            return msg

    def send(self, obj):
        self.proc.stdin.write(json.dumps(obj, ensure_ascii=False) + "\n")
        self.proc.stdin.flush()

    def close(self):
        self._sampling = False
        try:
            self.request("system.shutdown", quiet=True)
            self.proc.wait(timeout=15)
        except Exception:  # noqa: BLE001
            self.proc.kill()
        return self.proc.returncode


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    arg = sys.argv[1]
    runtime = sys.argv[sys.argv.index("--runtime") + 1] if "--runtime" in sys.argv else "core"
    steps = json.load(open(arg[1:], encoding="utf-8")) if arg.startswith("@") else json.loads(arg)
    sc = Sidecar(runtime)
    print(f"sidecar runtime={runtime} pid={sc.pid}")
    for method, params, *opts in steps:
        cancel_after = opts[0] if opts else None
        resp = sc.request(method, params, cancel_after=cancel_after)
        print(json.dumps({"method": method, **resp}, ensure_ascii=False)[:4000], flush=True)
    rc = sc.close()
    print(json.dumps({"exitCode": rc, "peakVramMb": sc.peak_vram_mb, "peakRssMb": round(sc.peak_rss_mb, 1)}))
    print("--- sidecar stderr ---")
    print("\n".join(sc.stderr_lines[-int(os.environ.get("HARNESS_STDERR_LINES", "20")):]))
