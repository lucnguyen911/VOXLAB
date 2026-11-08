"""Real-inference faster-whisper benchmark (Phase 11 — Auto Whisper hardware thresholds + ASR default).

For each installed Whisper model: fresh core sidecar -> asr.load -> transcribe a fixed corpus with known
ground truth -> WER, speed (RTF), load time, VRAM held, and VRAM when co-resident with a loaded TTS model
(the real QC situation: Whisper validates chunks while the TTS engine stays loaded).

    sidecar\\.venv\\Scripts\\python.exe scripts/perf/bench_asr.py --corpus scripts/perf/results/tts_omnivoice_en --reps 2
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import statistics
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "sidecar", "scripts"))
from harness import Sidecar, gpu_used_mb

APPDATA = os.path.join(os.environ.get("APPDATA", ""), "com.voxlab.app")
MODELS_DIR = os.path.join(APPDATA, "models")
MODELS = ["small", "medium", "large-v3-turbo", "large-v3"]
NUM_WORDS = {"zero": "0", "one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6", "seven": "7",
             "eight": "8", "nine": "9", "ten": "10", "twenty": "20", "thirty": "30", "sixty": "60", "seventy": "70",
             "eighty": "80"}


def norm_words(text: str) -> list[str]:
    text = text.lower().replace("-", " ")
    text = re.sub(r"[^\w\s']", " ", text)
    return [NUM_WORDS.get(w, w) for w in text.split()]


def wer(ref: str, hyp: str) -> tuple[int, int]:
    r, h = norm_words(ref), norm_words(hyp)
    d = list(range(len(h) + 1))
    for i in range(1, len(r) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(h) + 1):
            cur = d[j]
            d[j] = min(d[j] + 1, d[j - 1] + 1, prev + (r[i - 1] != h[j - 1]))
            prev = cur
    return d[len(h)], len(r)


def load_corpus(corpus_dir: str) -> list[dict]:
    rep = json.load(open(os.path.join(corpus_dir, "synth_report.json"), encoding="utf-8"))
    items = []
    # k=1 rep 0 gives sentence-sized clips; add the user's human reference recording too
    for cfg in rep["configs"]:
        if cfg["k"] == 1 and cfg["rep"] == 0:
            items += [{"path": it["path"], "text": it["text"], "dur": it["durationSec"], "kind": "tts"}
                      for it in cfg["items"] if it.get("ok")]
    items.append({"path": os.path.join(APPDATA, "voices", "clones", "clone_1791456235218.wav"),
                  "text": "Let me paint you a picture. It's a Tuesday afternoon. A used car lot somewhere in Ohio. "
                          "A row of dusty pickups sitting at the back. No balloons.", "dur": 9.79, "kind": "human"})
    return items, rep["lang"]


def bench_model(model: str, corpus: list[dict], lang: str, reps: int, co_tts: bool) -> dict:
    base = gpu_used_mb() or 0
    sc = Sidecar("core")
    row: dict = {"model": model, "coResidentTts": co_tts}
    try:
        if co_tts:
            r = sc.request("tts.load", {"engine": "omnivoice", "modelDir": os.path.join(MODELS_DIR, "omnivoice"),
                                        "device": "auto"}, quiet=True)
            assert r.get("ok"), r
            time.sleep(1.0)
            row["vramTtsOnlyMb"] = (gpu_used_mb() or 0) - base
        r = sc.request("asr.load", {"modelDir": os.path.join(MODELS_DIR, f"faster-whisper-{model}"), "device": "auto"},
                       quiet=True)
        assert r.get("ok"), r
        row["loadSec"] = r["result"].get("loadSec", r["wallSec"])
        row["loadWallSec"] = r["wallSec"]
        row["computeType"] = r["result"].get("computeType")
        time.sleep(1.0)
        row["vramAfterLoadMb"] = (gpu_used_mb() or 0) - base
        errs = tot = 0
        human = None
        speeds, audio_total, infer_total = [], 0.0, 0.0
        for rep in range(reps):
            for it in corpus:
                r = sc.request("asr.transcribe", {"audioPath": it["path"], "language": lang, "wordTimestamps": True},
                               quiet=True)
                if not r.get("ok"):
                    continue
                res = r["result"]
                hyp = " ".join(s["text"] for s in res["segments"])
                if rep == 0:
                    e, n = wer(it["text"], hyp)
                    errs += e
                    tot += n
                    if it["kind"] == "human":
                        human = round(e / max(1, n), 4)
                else:
                    audio_total += res["durationSec"]
                    infer_total += res["inferenceSec"]
                    speeds.append(res["inferenceSec"] / max(0.01, res["durationSec"]))
        row["werCorpus"] = round(errs / max(1, tot), 4)
        row["werHumanRef"] = human
        row["rtfWarm"] = round(infer_total / audio_total, 4) if audio_total else None
        row["rtfWarmMedianPerClip"] = round(statistics.median(speeds), 4) if speeds else None
    finally:
        sc.close()
        row["peakVramMb"] = sc.peak_vram_mb
        row["peakRssMb"] = round(sc.peak_rss_mb, 1)
    print(json.dumps(row), flush=True)
    return row


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser()
    p.add_argument("--corpus", required=True)
    p.add_argument("--reps", type=int, default=2)
    p.add_argument("--models", default=",".join(MODELS))
    p.add_argument("--co-tts", action="store_true", help="also measure Whisper co-resident with OmniVoice")
    a = p.parse_args()
    corpus, lang = load_corpus(os.path.join(ROOT, a.corpus))
    rows = [bench_model(m, corpus, lang, a.reps, False) for m in a.models.split(",")]
    if a.co_tts:
        rows += [bench_model(m, corpus, lang, 1, True) for m in a.models.split(",")]
    out = os.path.join(ROOT, "scripts", "perf", "results", f"asr_bench_{lang}.json")
    json.dump({"corpusClips": len(corpus), "rows": rows}, open(out, "w", encoding="utf-8"), indent=2)
    print("saved", out)
