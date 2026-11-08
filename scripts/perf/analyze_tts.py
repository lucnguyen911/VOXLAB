"""Aggregate chunk-size sweep results across runs: throughput per k, QC flag rate per k and per
chunk-length bin. Usage:
    python scripts/perf/analyze_tts.py scripts/perf/results/tts_omnivoice_en scripts/perf/results/tts_omnivoice_en_x6 ...
"""
from __future__ import annotations

import json
import math
import os
import statistics
import sys
from collections import defaultdict


def fisher_one_sided(a: int, n1: int, b: int, n2: int) -> float:
    """P(X >= a) for flagged count a in group 1 under H0 (hypergeometric), group sizes n1, n2."""
    k, n = a + b, n1 + n2

    def c(x, y):
        return math.comb(x, y) if 0 <= y <= x else 0

    tot = c(n, k)
    return sum(c(n1, i) * c(n2, k - i) for i in range(a, min(k, n1) + 1)) / tot if tot else 1.0


def main(dirs: list[str]) -> None:
    per_k = defaultdict(lambda: {"rtf": [], "chunks": 0, "flagged": 0, "share": [], "chars": []})
    chunks = []
    for d in dirs:
        synth = json.load(open(os.path.join(d, "synth_report.json"), encoding="utf-8"))
        qc = json.load(open(os.path.join(d, "qc_report.json"), encoding="utf-8"))
        qc_by = {(c["k"], c["rep"]): c for c in qc["configs"]}
        for cfg in synth["configs"]:
            q = qc_by.get((cfg["k"], cfg["rep"]))
            if not q:
                continue
            s = per_k[cfg["k"]]
            s["rtf"].append(cfg["rtfTotal"])
            s["chunks"] += q["chunks"]
            s["flagged"] += q["warning"] + q["error"]
            s["share"].append(q["flaggedAudioShare"])
            s["chars"].append(cfg["charsMean"])
        # per-chunk: re-read qc details from synth items that QC annotated? qc_report has aggregates only,
        # so recompute per chunk from the qc_report detail file if present
        detail = os.path.join(d, "qc_items.json")
        if os.path.exists(detail):
            chunks += json.load(open(detail, encoding="utf-8"))
    print("k | reps | RTF median | chunks | flagged | flag% | mean flagged-audio share | effective RTF (1 regen)")
    base = per_k.get(3)
    for k in sorted(per_k):
        s = per_k[k]
        rtf = statistics.median(s["rtf"])
        share = statistics.mean(s["share"])
        p = ""
        if base and k != 3:
            p = f" | p(k{k} worse than k3)={fisher_one_sided(s['flagged'], s['chunks'], base['flagged'], base['chunks']):.3f}"
        print(f"{k} | {len(s['rtf'])} | {rtf:.3f} | {s['chunks']} | {s['flagged']} | "
              f"{100 * s['flagged'] / s['chunks']:.1f}% | {share:.3f} | {rtf * (1 + share):.3f}{p}")
    if chunks:
        bins = defaultdict(lambda: [0, 0])
        for c in chunks:
            b = min(600, (c["chars"] // 100) * 100)
            bins[b][0] += 1
            bins[b][1] += 1 if c["status"] in ("warning", "error") else 0
        print("\nchars bin | chunks | flagged | flag%")
        for b in sorted(bins):
            n, f = bins[b]
            print(f"{b}-{b + 99} | {n} | {f} | {100 * f / n:.1f}%")
        dbins = defaultdict(lambda: [0, 0])
        for c in chunks:
            b = min(40, int(c["dur"] // 10) * 10)
            dbins[b][0] += 1
            dbins[b][1] += 1 if c["status"] in ("warning", "error") else 0
        print("\naudio-sec bin | chunks | flagged | flag%")
        for b in sorted(dbins):
            n, f = dbins[b]
            print(f"{b}-{b + 9}s | {n} | {f} | {100 * f / n:.1f}%")


if __name__ == "__main__":
    main(sys.argv[1:])
