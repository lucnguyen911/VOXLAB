"""Queue-concurrency benchmark (Phase 11 — TUNING REQUIRED "Queue Concurrency").

One sidecar process runs exactly one heavy inference at a time (server.py returns BUSY otherwise), so
concurrency > 1 can only come from N independent model instances (N sidecar processes). This measures
whether that buys real throughput on the GPU, and what it costs in VRAM.

    sidecar\\.venv\\Scripts\\python.exe scripts/perf/bench_concurrency.py --engine omnivoice --n 1,2,3 --k 3 --reps 2
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "scripts", "perf"))
sys.path.insert(0, os.path.join(ROOT, "sidecar", "scripts"))
from bench_tts import DOCS, ENGINES, MODELS_DIR, VOICES, chunk_document
from harness import Sidecar, gpu_used_mb


def run(engine: str, n: int, k: int, reps: int, lang: str) -> dict:
    runtime, folder, defaults = ENGINES[engine]
    ref_audio, ref_text = VOICES[lang]
    out_dir = os.path.join(ROOT, "scripts", "perf", "results", f"conc_{engine}_n{n}")
    os.makedirs(out_dir, exist_ok=True)
    base = gpu_used_mb() or 0
    peak = {"v": 0}
    stop = threading.Event()

    def sample():
        while not stop.is_set():
            u = gpu_used_mb()
            if u is not None:
                peak["v"] = max(peak["v"], u - base)
            time.sleep(0.2)

    threading.Thread(target=sample, daemon=True).start()
    workers = [Sidecar(runtime) for _ in range(n)]
    try:
        for w in workers:
            r = w.request("tts.load", {"engine": engine, "modelDir": os.path.join(MODELS_DIR, folder), "device": "auto"},
                          quiet=True)
            assert r.get("ok"), r
        # warm-up each instance
        for i, w in enumerate(workers):
            w.request("tts.synthesize", {"engine": engine, "text": "Warm up sentence.", "language": lang,
                                         "outputPath": os.path.join(out_dir, f"warm_{i}.wav"),
                                         "refAudioPath": ref_audio, "refText": ref_text, "advancedSettings": defaults},
                      quiet=True)
        vram_loaded = (gpu_used_mb() or 0) - base
        chunks = chunk_document(DOCS[lang], k) * reps  # same total work for every n
        queue = list(enumerate(chunks))
        lock = threading.Lock()
        results: list[dict] = []

        def worker_loop(wi: int, w: Sidecar):
            while True:
                with lock:
                    if not queue:
                        return
                    idx, text = queue.pop(0)
                r = w.request("tts.synthesize", {"engine": engine, "text": text, "language": lang,
                                                 "outputPath": os.path.join(out_dir, f"c{idx:03d}.wav"),
                                                 "refAudioPath": ref_audio, "refText": ref_text,
                                                 "advancedSettings": defaults}, quiet=True)
                with lock:
                    results.append({"ok": r.get("ok"), "dur": (r.get("result") or {}).get("durationSec", 0),
                                    "err": (r.get("error") or {}).get("code")})

        t0 = time.perf_counter()
        threads = [threading.Thread(target=worker_loop, args=(i, w)) for i, w in enumerate(workers)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        wall = time.perf_counter() - t0
    finally:
        for w in workers:
            w.close()
        stop.set()
    audio = sum(r["dur"] for r in results if r["ok"])
    row = {"engine": engine, "n": n, "k": k, "jobs": len(results), "failed": sum(1 for r in results if not r["ok"]),
           "errors": sorted({r["err"] for r in results if r["err"]}),
           "wallSec": round(wall, 2), "audioSec": round(audio, 2),
           "throughputAudioSecPerSec": round(audio / wall, 3) if wall else None,
           "vramLoadedMb": vram_loaded, "peakVramMb": peak["v"]}
    print(json.dumps(row), flush=True)
    return row


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser()
    p.add_argument("--engine", default="omnivoice", choices=list(ENGINES))
    p.add_argument("--n", default="1,2,3")
    p.add_argument("--k", type=int, default=3)
    p.add_argument("--reps", type=int, default=2)
    p.add_argument("--lang", default="en")
    a = p.parse_args()
    rows = [run(a.engine, int(n), a.k, a.reps, a.lang) for n in a.n.split(",")]
    json.dump(rows, open(os.path.join(ROOT, "scripts", "perf", "results", f"concurrency_{a.engine}.json"), "w"), indent=2)
