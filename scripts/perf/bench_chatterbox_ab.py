"""Chatterbox Turbo A/B experiments (Phase 11). Runs the real adapter directly inside .venv-chatterbox.

  --mode cudnn   : cudnn.benchmark True (current) vs False -> first-synth latency + per-chunk RTF
  --mode split   : whole chunk vs internal sentence-group split (<= N chars) -> written WAVs for QC scoring

    sidecar\\.venv-chatterbox\\Scripts\\python.exe scripts/perf/bench_chatterbox_ab.py --mode cudnn
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "sidecar"))
sys.path.insert(0, os.path.join(ROOT, "scripts", "perf"))
from bench_tts import DOCS, ENGINES, MODELS_DIR, VOICES, chunk_document

SENT_RE = re.compile(r"(?<=[.!?])\s+")


def load_adapter(benchmark: bool):
    from voxlab_sidecar.tts.chatterbox_adapter import ChatterboxAdapter
    import torch
    a = ChatterboxAdapter()
    t0 = time.perf_counter()
    a.load(os.path.join(MODELS_DIR, "chatterbox-turbo"), "cuda")
    load_sec = time.perf_counter() - t0
    torch.backends.cudnn.benchmark = benchmark  # override what load() set
    return a, load_sec


def synth(a, text: str):
    from voxlab_sidecar.tts.base import SynthesisRequest
    import torch
    ref, _ = VOICES["en"]
    req = SynthesisRequest(text=text, language="en", ref_audio_path=ref, ref_text=None, speed=None,
                           extra=dict(ENGINES["chatterbox"][2]))
    torch.cuda.synchronize()
    t0 = time.perf_counter()
    audio, sr = a.synthesize(req)
    torch.cuda.synchronize()
    return audio, sr, time.perf_counter() - t0


def mode_cudnn(a_args) -> None:
    import torch
    out = {}
    chunks = chunk_document(DOCS["en"], 1) + chunk_document(DOCS["en"], 3)
    for bench in (True, False):
        adapter, load_sec = load_adapter(bench)
        times, audio_total = [], 0.0
        first = None
        for i, c in enumerate(chunks):
            audio, sr, dt = synth(adapter, c)
            if i == 0:
                first = dt
            times.append(dt)
            audio_total += audio.shape[-1] / sr
        out[f"cudnn_benchmark_{bench}"] = {"loadSec": round(load_sec, 2), "firstSynthSec": round(first, 2),
                                           "restInferSec": round(sum(times[1:]), 2),
                                           "rtfExcludingFirst": round(sum(times[1:]) / max(0.01, audio_total), 4),
                                           "peakVramMb": int(torch.cuda.max_memory_allocated() / 1048576)}
        print(json.dumps(out[f"cudnn_benchmark_{bench}"]), flush=True)
        adapter.unload()
        torch.cuda.reset_peak_memory_stats()
    json.dump(out, open(os.path.join(ROOT, "scripts", "perf", "results", "chatterbox_cudnn_ab.json"), "w"), indent=2)


def split_text(text: str, max_chars: int) -> list[str]:
    sents = [s.strip() for s in SENT_RE.split(text) if s.strip()]
    groups, cur = [], ""
    for s in sents:
        cand = (cur + " " + s).strip()
        if cur and len(cand) > max_chars:
            groups.append(cur)
            cur = s
        else:
            cur = cand
    if cur:
        groups.append(cur)
    return groups


def trim_edges(x, sr, thr_db: float = -40.0, keep_ms: int = 20):
    import numpy as np
    hop = max(1, int(0.01 * sr))
    n = len(x) // hop
    if n == 0:
        return x
    rms = np.sqrt(np.mean(x[: n * hop].reshape(n, hop) ** 2, axis=1) + 1e-12)
    db = 20 * np.log10(rms / (rms.max() + 1e-12))
    voiced = np.where(db >= thr_db)[0]
    if voiced.size == 0:
        return x
    keep = int(keep_ms / 10)
    s = max(0, (voiced[0] - keep) * hop)
    e = min(len(x), (voiced[-1] + 1 + keep) * hop)
    return x[s:e]


def mode_split(a_args) -> None:
    import numpy as np
    import soundfile as sf
    adapter, _ = load_adapter(False)
    synth(adapter, "Warm up sentence for the model.")
    out_dir = os.path.join(ROOT, "scripts", "perf", "results", f"tts_chatterbox_en_split{a_args.max_chars}")
    os.makedirs(out_dir, exist_ok=True)
    report = {"engine": "chatterbox", "lang": "en", "maxChars": a_args.max_chars, "gapSec": a_args.gap, "configs": []}
    for k in (3, 4):
        chunks = chunk_document(DOCS["en"], k)
        for rep in range(a_args.reps):
            items, t_all, audio_all = [], 0.0, 0.0
            for i, c in enumerate(chunks):
                parts = split_text(c, a_args.max_chars)
                pieces, sr, t_chunk = [], 24000, 0.0
                for j, p in enumerate(parts):
                    audio, sr, dt = synth(adapter, p)
                    t_chunk += dt
                    if len(parts) > 1:
                        audio = trim_edges(audio, sr)
                    pieces.append(audio)
                    if j < len(parts) - 1:
                        pieces.append(np.zeros(int(a_args.gap * sr), dtype=np.float32))
                wav = np.concatenate(pieces)
                path = os.path.join(out_dir, f"k{k}_r{rep}_{i:02d}.wav")
                sf.write(path, wav, sr, subtype="PCM_16")
                dur = wav.shape[-1] / sr
                items.append({"ok": True, "chars": len(c), "parts": len(parts), "durationSec": round(dur, 3),
                              "inferenceSec": round(t_chunk, 3), "path": path, "text": c})
                t_all += t_chunk
                audio_all += dur
            cfg = {"k": k, "rep": rep, "chunks": len(chunks), "audioSec": round(audio_all, 2),
                   "inferenceSec": round(t_all, 2), "rtfTotal": round(t_all / audio_all, 4),
                   "charsMean": round(sum(len(c) for c in chunks) / len(chunks), 1), "items": items}
            report["configs"].append(cfg)
            print(json.dumps({k2: v for k2, v in cfg.items() if k2 != "items"}), flush=True)
    json.dump(report, open(os.path.join(out_dir, "synth_report.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    adapter.unload()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser()
    p.add_argument("--mode", choices=["cudnn", "split"], required=True)
    p.add_argument("--max-chars", type=int, default=380)
    p.add_argument("--gap", type=float, default=0.30)
    p.add_argument("--reps", type=int, default=4)
    a = p.parse_args()
    mode_cudnn(a) if a.mode == "cudnn" else mode_split(a)
