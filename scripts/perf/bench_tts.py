"""Real-inference TTS benchmark for TUNING REQUIRED items (Phase 11).

Drives the real sidecar runtimes through sidecar/scripts/harness.py (the repository's own
verification harness), using the product's official default inference parameters, and measures:

  * chunk-size sweep  — sentences-per-chunk k (hard max 600 chars, same rule as src/services/pause/chunker.ts)
                         -> inference time, audio duration, RTF, per-chunk wall time, throughput
  * model lifecycle    — cold load time, warm first-synth latency, unload, VRAM held while loaded

Quality is scored afterwards (separate process, no VRAM contention with timing) with the product's
own QC pipeline: core runtime `audio.validate_quality` (Whisper alignment + acoustic checks).

    sidecar\\.venv\\Scripts\\python.exe scripts/perf/bench_tts.py synth --engine omnivoice --lang en --k 1,2,3,4,5 --reps 2
    sidecar\\.venv\\Scripts\\python.exe scripts/perf/bench_tts.py qc --run scripts/perf/results/tts_omnivoice_en
"""
from __future__ import annotations

import argparse
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

ENGINES = {
    # engine id -> (runtime, model folder, official product defaults from src/services/ai/ttsAdvancedSettings.ts)
    "omnivoice": ("core", "omnivoice", {
        "num_step": 32, "guidance_scale": 2.0, "position_temperature": 5.0, "class_temperature": 0.0,
        "denoise": True, "t_shift": 0.1, "layer_penalty_factor": 5.0, "duration": None,
        "preprocess_prompt": True, "postprocess_output": True, "pad_duration": 0.1, "fade_duration": 0.1,
        "audio_chunk_duration": 15.0, "audio_chunk_threshold": 30.0,
    }),
    "chatterbox": ("chatterbox", "chatterbox-turbo", {
        "temperature": 0.8, "top_p": 0.95, "repetition_penalty": 1.2, "norm_loudness": True, "top_k": 1000,
    }),
    "qwen": ("qwen", "qwen3-tts-1.7b-base", {
        "temperature": 0.9, "top_p": 1.0, "repetition_penalty": 1.05, "x_vector_only_mode": False,
        "top_k": 50, "do_sample": True, "subtalker_dosample": True, "subtalker_top_k": 50,
        "subtalker_top_p": 1.0, "subtalker_temperature": 0.9, "max_new_tokens": 2048, "non_streaming_mode": False,
    }),
}

VOICES = {
    "en": (os.path.join(APPDATA, "voices", "clones", "clone_1791456235218.wav"),
           "Let me paint you a picture. It's a Tuesday afternoon. A used car lot somewhere in Ohio. "
           "A row of dusty pickups sitting at the back. No balloons."),
    "vi": (os.path.join(APPDATA, "voices", "samples", "thao_trinh.mp3"),
           "Xin chào, đây là bản nghe thử giọng đọc của Thảo Trinh trên VoxLab."),
}

DOCS = {
    "en": (
        "To see why the charging delay myth falls apart in practice, you have to understand how commercial freight "
        "actually moves across America. Critics often imagine an eighteen wheeler pulling into a crowded highway rest "
        "stop and waiting three hours behind family sedans for an open plug. In reality, over eighty percent of regional "
        "and national retail freight runs on predictable, repeatable point to point routes between distribution "
        "warehouses, ports, and grocery fulfillment centers. These trucks do not wander randomly across the map. They "
        "operate from depot to depot on strict schedules. When a Tesla Semi backs into a loading dock at a PepsiCo "
        "distribution center, the truck plugs into a liquid cooled Megacharger. Operating on the new Megawatt Charging "
        "System architecture, these cables deliver one point two megawatts of direct current power. They replenish sixty "
        "to seventy percent of the battery pack in just thirty minutes, right while forklifts unload pallets in the "
        "trailer. By the time the dock doors close, the rig rolls. Even more impressive, fleet operators are discovering "
        "that they do not even need megawatt chargers for every single truck in their yard. For regional delivery fleets "
        "that return to a home warehouse at the end of an eight or ten hour shift, Tesla engineered a turnkey overnight "
        "solution called the Basecharger. A fleet manager can simply plug in twenty or thirty trucks at midnight, soak up "
        "cheap off peak power, and wake up to a fully charged fleet every morning. That vertical integration locks in "
        "stable energy prices for decades. Of course, a revolutionary truck means nothing to the oil industry if it only "
        "exists as a small pilot fleet. For the past three years, diesel executives comforted themselves with the belief "
        "that Tesla could never mass produce a Class eight commercial tractor at industrial volume."
    ),
    "vi": (
        "Buổi sáng ở thành phố bắt đầu từ rất sớm, khi những chuyến xe buýt đầu tiên lăn bánh qua các con phố còn ướt sương. "
        "Người bán hàng rong đã dọn sẵn gánh xôi, nồi phở bốc khói nghi ngút bên vỉa hè. Những chiếc xe máy nối đuôi nhau, "
        "tiếng còi xen lẫn tiếng gọi nhau í ới tạo nên một bản nhạc rất riêng của đô thị. Ở góc ngã tư, một cụ ông chậm rãi "
        "tưới những chậu hoa giấy đỏ rực trước hiên nhà. Cửa hàng tiện lợi bật đèn sáng trưng, đón những vị khách vội vàng "
        "mua ổ bánh mì và ly cà phê sữa đá. Trên tầng cao của tòa nhà văn phòng, nhân viên bảo vệ mở cửa kính, để làn gió mát "
        "ùa vào hành lang. Khoảng bảy giờ, dòng người đổ ra đường đông hơn, học sinh mặc áo trắng đạp xe tới trường. "
        "Giáo viên đứng ở cổng trường, mỉm cười chào từng em. Trong công viên gần đó, nhóm người lớn tuổi tập dưỡng sinh "
        "theo tiếng nhạc nhẹ nhàng. Một chú chó nhỏ chạy quanh hồ nước, đuổi theo đàn chim sẻ đang kiếm ăn. Đến giữa trưa, "
        "nắng lên cao, những quán cơm văn phòng chật kín người. Câu chuyện về giá xăng, về công việc và kế hoạch cuối tuần "
        "được bàn tán rôm rả. Buổi chiều, mưa rào bất chợt đổ xuống, mọi người vội vàng tấp vào mái hiên trú tạm. "
        "Chỉ mười lăm phút sau, trời lại quang đãng, mặt đường loang loáng phản chiếu ánh đèn. Khi hoàng hôn buông xuống, "
        "thành phố khoác lên mình một màu áo mới, rực rỡ và ấm áp hơn bao giờ hết."
    ),
}

SENT_RE = re.compile(r"(?<=[.!?])\s+")


def chunk_document(text: str, k: int, hard_max: int = 600) -> list[str]:
    """k sentences per chunk, never above hard_max chars (mirrors chunker.ts hardMax=600 priority)."""
    sentences = [s.strip() for s in SENT_RE.split(text) if s.strip()]
    chunks, cur = [], []
    for s in sentences:
        candidate = " ".join(cur + [s])
        if cur and (len(cur) >= k or len(candidate) > hard_max):
            chunks.append(" ".join(cur))
            cur = [s]
        else:
            cur.append(s)
    if cur:
        chunks.append(" ".join(cur))
    return chunks


def cmd_synth(a: argparse.Namespace) -> None:
    runtime, model_folder, defaults = ENGINES[a.engine]
    ref_audio, ref_text = VOICES[a.lang]
    out_dir = os.path.join(ROOT, "scripts", "perf", "results", f"tts_{a.engine}_{a.lang}{('_' + a.tag) if a.tag else ''}")
    os.makedirs(out_dir, exist_ok=True)
    vram_before = gpu_used_mb() or 0
    t_spawn = time.perf_counter()
    sc = Sidecar(runtime)
    spawn_sec = time.perf_counter() - t_spawn
    report: dict = {"engine": a.engine, "lang": a.lang, "runtime": runtime, "spawnSec": round(spawn_sec, 2),
                    "vramBeforeMb": vram_before, "params": defaults, "configs": []}
    try:
        load = sc.request("tts.load", {"engine": a.engine, "modelDir": os.path.join(MODELS_DIR, model_folder),
                                       "device": "auto"}, quiet=True)
        assert load.get("ok"), load
        report["loadSec"] = load["result"]["loadSec"]
        report["loadWallSec"] = load["wallSec"]
        time.sleep(1.0)
        report["vramAfterLoadMb"] = (gpu_used_mb() or 0) - vram_before

        def synth(text: str, path: str) -> dict:
            params = {"engine": a.engine, "text": text, "outputPath": path, "language": a.lang,
                      "refAudioPath": ref_audio, "refText": ref_text, "advancedSettings": defaults}
            r = sc.request("tts.synthesize", params, quiet=True)
            if not r.get("ok"):
                return {"ok": False, "error": r.get("error"), "wallSec": r["wallSec"], "chars": len(text)}
            res = r["result"]
            return {"ok": True, "chars": len(text), "durationSec": res["durationSec"], "inferenceSec": res["inferenceSec"],
                    "rtf": res["rtf"], "wallSec": r["wallSec"], "path": path, "text": text}

        # first synth after load = "time to first audio" (includes reference preparation / caches)
        first = synth("This is a short warm up sentence." if a.lang == "en" else "Đây là một câu khởi động ngắn.",
                      os.path.join(out_dir, "warmup_first.wav"))
        report["firstSynthAfterLoad"] = first
        second = synth("This is a short warm up sentence." if a.lang == "en" else "Đây là một câu khởi động ngắn.",
                       os.path.join(out_dir, "warmup_second.wav"))
        report["secondSynthSameText"] = second

        doc = DOCS[a.lang]
        for k in [int(x) for x in a.k.split(",")]:
            chunks = chunk_document(doc, k)
            for rep in range(a.reps):
                t0 = time.perf_counter()
                items = [synth(c, os.path.join(out_dir, f"k{k}_r{rep}_{i:02d}.wav")) for i, c in enumerate(chunks)]
                wall = time.perf_counter() - t0
                ok = [x for x in items if x["ok"]]
                audio = sum(x["durationSec"] for x in ok)
                infer = sum(x["inferenceSec"] for x in ok)
                cfg = {"k": k, "rep": rep, "chunks": len(chunks), "failed": len(items) - len(ok),
                       "charsMean": round(statistics.mean(len(c) for c in chunks), 1),
                       "charsMax": max(len(c) for c in chunks),
                       "wallSec": round(wall, 2), "audioSec": round(audio, 2), "inferenceSec": round(infer, 2),
                       "rtfTotal": round(wall / audio, 4) if audio else None,
                       "rtfInferenceOnly": round(infer / audio, 4) if audio else None,
                       "perChunkOverheadSec": round((wall - infer) / max(1, len(ok)), 3),
                       "chunkWallMaxSec": round(max(x["wallSec"] for x in items), 2),
                       "items": items}
                report["configs"].append(cfg)
                print(json.dumps({k2: v for k2, v in cfg.items() if k2 != "items"}), flush=True)
                json.dump(report, open(os.path.join(out_dir, "synth_report.json"), "w", encoding="utf-8"),
                          ensure_ascii=False, indent=2)

        t_un = time.perf_counter()
        un = sc.request("tts.unload", {}, quiet=True)
        report["unloadSec"] = round(time.perf_counter() - t_un, 2)
        time.sleep(1.5)
        report["vramAfterUnloadMb"] = (gpu_used_mb() or 0) - vram_before
        report["unloadOk"] = un.get("ok")
    finally:
        rc = sc.close()
        report["peakVramMb"] = sc.peak_vram_mb
        report["peakRssMb"] = round(sc.peak_rss_mb, 1)
        report["exitCode"] = rc
        json.dump(report, open(os.path.join(out_dir, "synth_report.json"), "w", encoding="utf-8"),
                  ensure_ascii=False, indent=2)
    print(json.dumps({k: v for k, v in report.items() if k not in ("configs", "params")}, ensure_ascii=False))


def cmd_qc(a: argparse.Namespace) -> None:
    run_dir = os.path.join(ROOT, a.run) if not os.path.isabs(a.run) else a.run
    rep = json.load(open(os.path.join(run_dir, "synth_report.json"), encoding="utf-8"))
    sc = Sidecar("core")
    out = {"engine": rep["engine"], "lang": rep["lang"], "asrModel": a.asr, "configs": []}
    try:
        for cfg in rep["configs"]:
            statuses, codes, qc_secs = [], {}, []
            for it in cfg["items"]:
                if not it.get("ok"):
                    statuses.append("synth_failed")
                    continue
                r = sc.request("audio.validate_quality", {
                    "audioPath": it["path"], "text": it["text"], "language": rep["lang"],
                    "modelsDir": MODELS_DIR, "modelId": a.asr, "speed": 1.0}, quiet=True)
                qc_secs.append(r["wallSec"])
                if not r.get("ok"):
                    statuses.append("qc_failed")
                    continue
                res = r["result"]
                statuses.append(res.get("status"))
                it["qc"] = {"status": res.get("status"), "issues": [i.get("code") for i in res.get("issues", [])],
                            "metrics": res.get("metrics")}
                for i in res.get("issues", []):
                    codes[i.get("code")] = codes.get(i.get("code"), 0) + 1
            n = len(statuses)
            row = {"k": cfg["k"], "rep": cfg["rep"], "chunks": n,
                   "pass": statuses.count("pass"), "warning": statuses.count("warning"),
                   "error": statuses.count("error"), "other": n - statuses.count("pass") - statuses.count("warning") - statuses.count("error"),
                   "flaggedRate": round((statuses.count("warning") + statuses.count("error")) / n, 3) if n else None,
                   "flaggedAudioSec": round(sum(it["durationSec"] for it in cfg["items"] if it.get("qc", {}).get("status") in ("warning", "error")), 2),
                   "audioSec": cfg["audioSec"],
                   "issueCodes": codes, "qcSecMean": round(statistics.mean(qc_secs), 2) if qc_secs else None}
            row["flaggedAudioShare"] = round(row["flaggedAudioSec"] / cfg["audioSec"], 3) if cfg["audioSec"] else None
            out["configs"].append(row)
            print(json.dumps(row, ensure_ascii=False), flush=True)
    finally:
        sc.close()
    items = [{"k": cfg["k"], "rep": cfg["rep"], "chars": it["chars"], "dur": it.get("durationSec", 0),
              "status": (it.get("qc") or {}).get("status", "synth_failed" if not it.get("ok") else "qc_failed"),
              "issues": (it.get("qc") or {}).get("issues", [])}
             for cfg in rep["configs"] for it in cfg["items"]]
    json.dump(items, open(os.path.join(run_dir, "qc_items.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump(out, open(os.path.join(run_dir, "qc_report.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("synth")
    s.add_argument("--engine", choices=list(ENGINES), required=True)
    s.add_argument("--lang", choices=list(VOICES), default="en")
    s.add_argument("--k", default="1,2,3,4,5")
    s.add_argument("--reps", type=int, default=2)
    s.add_argument("--tag", default="")
    q = sub.add_parser("qc")
    q.add_argument("--run", required=True)
    q.add_argument("--asr", default="faster-whisper-large-v3-turbo")
    a = p.parse_args()
    cmd_synth(a) if a.cmd == "synth" else cmd_qc(a)
