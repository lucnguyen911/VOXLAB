"""Real audio assembly/encoding for VoxLab outputs (core runtime).

Replaces the frontend placeholders (sine-wave master, fake MP3 bytes). All writes are atomic
(temp file in the target directory + os.replace).
"""
from __future__ import annotations

import math
import os
from typing import Any

import numpy as np

from .protocol import SidecarError, require
from .server import RequestContext

DEFAULT_MP3_KBPS = 192


def _read_mono(path: str) -> tuple[np.ndarray, int]:
    import soundfile as sf

    if not os.path.isfile(path):
        raise SidecarError("INPUT_NOT_FOUND", f"audio input not found: {os.path.basename(path)}")
    try:
        data, sr = sf.read(path, dtype="float32", always_2d=True)
    except Exception as e:  # noqa: BLE001
        raise SidecarError("INVALID_REQUEST", f"cannot decode audio {os.path.basename(path)}: {e}") from e
    return data.mean(axis=1), int(sr)


def _resample(x: np.ndarray, sr_from: int, sr_to: int) -> np.ndarray:
    if sr_from == sr_to or x.size == 0:
        return x
    from scipy.signal import resample_poly

    g = math.gcd(sr_from, sr_to)
    return resample_poly(x, sr_to // g, sr_from // g).astype(np.float32)


def write_audio_atomic(path: str, audio: np.ndarray, sr: int, fmt: str, mp3_kbps: int = DEFAULT_MP3_KBPS) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    pcm = np.clip(audio, -1.0, 1.0)
    try:
        if fmt == "wav":
            import soundfile as sf

            sf.write(tmp, pcm, sr, subtype="PCM_16", format="WAV")
        elif fmt == "mp3":
            import lameenc

            enc = lameenc.Encoder()
            enc.set_bit_rate(int(mp3_kbps))
            enc.set_in_sample_rate(int(sr))
            enc.set_channels(1)
            enc.set_quality(2)
            data = enc.encode((pcm * 32767.0).astype("<i2").tobytes()) + enc.flush()
            with open(tmp, "wb") as f:
                f.write(data)
        else:
            raise SidecarError("INVALID_REQUEST", f"unsupported output format '{fmt}'")
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def assemble(_m: str, params: dict[str, Any], ctx: RequestContext) -> dict[str, Any]:
    """inputs: [{path, gapAfterMs?, startSec?}], mode: sequential|timeline, outputPath, format, sampleRate?"""
    inputs = params.get("inputs")
    if not isinstance(inputs, list) or not inputs:
        raise SidecarError("INVALID_REQUEST", "param 'inputs' must be a non-empty list")
    output_path = require(params, "outputPath", str)
    fmt = params.get("format", "wav")
    mode = params.get("mode", "sequential")
    if mode not in ("sequential", "timeline"):
        raise SidecarError("INVALID_REQUEST", f"unsupported mode '{mode}'")

    decoded: list[tuple[np.ndarray, int]] = []
    for i, item in enumerate(inputs):
        ctx.check_cancelled()
        if not isinstance(item, dict) or not isinstance(item.get("path"), str):
            raise SidecarError("INVALID_REQUEST", f"inputs[{i}].path must be a string")
        decoded.append(_read_mono(item["path"]))
        ctx.progress(5 + 60 * (i + 1) / len(inputs), "decoding")
    sr = int(params.get("sampleRate") or decoded[0][1])
    clips = [_resample(x, s, sr) for x, s in decoded]

    segments: list[dict[str, Any]] = []
    if mode == "sequential":
        parts: list[np.ndarray] = []
        cursor = 0
        for i, (item, clip) in enumerate(zip(inputs, clips)):
            gap = max(0, int(round(float(item.get("gapAfterMs") or 0) * sr / 1000.0)))
            segments.append({"index": i, "startSec": round(cursor / sr, 4),
                             "endSec": round((cursor + clip.size) / sr, 4), "durationSec": round(clip.size / sr, 4)})
            parts.append(clip)
            if gap:
                parts.append(np.zeros(gap, dtype=np.float32))
            cursor += clip.size + gap
        out = np.concatenate(parts) if parts else np.zeros(0, dtype=np.float32)
    else:
        starts = []
        for i, item in enumerate(inputs):
            st = item.get("startSec")
            if not isinstance(st, (int, float)) or st < 0:
                raise SidecarError("INVALID_REQUEST", f"inputs[{i}].startSec must be >= 0 in timeline mode")
            starts.append(int(round(float(st) * sr)))
        end = max(s + c.size for s, c in zip(starts, clips))
        total = params.get("totalDurationSec")
        if isinstance(total, (int, float)) and total > 0:
            end = max(end, int(round(float(total) * sr)))
        out = np.zeros(end, dtype=np.float32)
        for i, (s, clip) in enumerate(zip(starts, clips)):
            out[s:s + clip.size] += clip
            segments.append({"index": i, "startSec": round(s / sr, 4), "endSec": round((s + clip.size) / sr, 4),
                             "durationSec": round(clip.size / sr, 4)})

    ctx.check_cancelled()
    ctx.progress(80, "encoding")
    write_audio_atomic(output_path, out, sr, fmt, int(params.get("mp3BitrateKbps") or DEFAULT_MP3_KBPS))
    ctx.progress(100, "written")
    return {"outputPath": output_path, "format": fmt, "sampleRate": sr, "durationSec": round(out.size / sr, 4),
            "peakAmplitude": round(float(np.abs(out).max()) if out.size else 0.0, 4), "segments": segments}


def probe(params: dict[str, Any]) -> dict[str, Any]:
    import soundfile as sf

    path = require(params, "path", str)
    if not os.path.isfile(path):
        raise SidecarError("INPUT_NOT_FOUND", "path does not exist")
    try:
        info = sf.info(path)
    except Exception as e:  # noqa: BLE001
        raise SidecarError("INVALID_REQUEST", f"cannot read audio header: {e}") from e
    return {"durationSec": round(float(info.duration), 4), "sampleRate": int(info.samplerate),
            "channels": int(info.channels), "format": str(info.format)}
