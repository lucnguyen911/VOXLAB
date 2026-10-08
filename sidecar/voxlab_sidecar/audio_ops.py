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
CANONICAL_SAMPLE_RATE = 44100
CANONICAL_CHANNELS = 1
CANONICAL_SUBTYPE = "PCM_16"


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


def write_audio_atomic(path: str, audio: np.ndarray, sr: int = CANONICAL_SAMPLE_RATE, fmt: str = "wav", mp3_kbps: int = DEFAULT_MP3_KBPS) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    # Master WAV Canonical Invariant: strictly MONO (1 channel)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    pcm = np.clip(audio, -1.0, 1.0)
    try:
        if fmt == "wav":
            import soundfile as sf

            sf.write(tmp, pcm, sr, subtype=CANONICAL_SUBTYPE, format="WAV")
        elif fmt == "mp3":
            import lameenc

            enc = lameenc.Encoder()
            enc.set_bit_rate(int(mp3_kbps))
            enc.set_in_sample_rate(int(sr))
            enc.set_channels(CANONICAL_CHANNELS)
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
    sr = int(params.get("sampleRate") or CANONICAL_SAMPLE_RATE)
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


def prepare_clone_reference(
    ref_audio_path: str,
    ref_text: str | None = None,
    language: str | None = None,
    models_dir: str | None = None,
    max_duration: float = 10.0,
    skip_transcribe: bool = False,
) -> tuple[str, str]:
    """Ensures reference audio passed to zero-shot voice cloning engines (OmniVoice, Chatterbox, Qwen)
    is within optimal duration (3.0s - 8.5s) and has an exact matching transcript.

    When an audio exceeds max_duration (e.g. 80s podcast or raw recording), zero-shot flow-matching
    models suffer severe attention drift, word dropping, and hallucination. This function automatically:
      1. Finds the optimal silence/breath boundary between 4.5s and 8.5s.
      2. Saves the trimmed slice into a persistent cache.
      3. Transcribes the slice using faster-whisper to guarantee 100% audio-text synchronization (unless skip_transcribe is True).
    """
    import hashlib
    import tempfile
    import soundfile as sf
    from .protocol import log

    if not os.path.isfile(ref_audio_path):
        return ref_audio_path, ref_text or ""

    try:
        info = sf.info(ref_audio_path)
        duration = float(info.duration)
    except Exception as e:
        log(f"[prepare_clone_reference] Could not probe audio header: {e}")
        return ref_audio_path, ref_text or ""

    # If within optimal duration (<= 10.0s), keep original audio file
    if duration <= max_duration:
        user_txt = (ref_text or "").strip()
        if not user_txt and not skip_transcribe:
            from .asr_engine import auto_transcribe_sample
            user_txt = auto_transcribe_sample(ref_audio_path, language=language, models_dir=models_dir)
        return ref_audio_path, user_txt

    # Audio is long (> 10.0s). Cache and trim to an optimal 4.5-8.5s slice.
    abs_path = os.path.abspath(ref_audio_path)
    try:
        stat = os.stat(abs_path)
        cache_key = hashlib.md5(f"{abs_path}_{stat.st_mtime}_{stat.st_size}".encode()).hexdigest()[:12]
    except Exception:
        cache_key = hashlib.md5(abs_path.encode()).hexdigest()[:12]

    cache_dir = os.path.join(tempfile.gettempdir(), "voxlab_ref_cache")
    os.makedirs(cache_dir, exist_ok=True)
    cached_wav = os.path.join(cache_dir, f"ref_{cache_key}_trimmed.wav")
    cached_txt_path = os.path.join(cache_dir, f"ref_{cache_key}_trimmed.txt")
    try:
        cached_exists = os.path.isfile(cached_wav) and os.path.getsize(cached_wav) > 0
    except OSError:
        cached_exists = False

    if not cached_exists:
        log(f"[prepare_clone_reference] Audio is {duration:.1f}s (>10s). Auto-trimming to optimal slice...")
        sr = int(info.samplerate)
        read_frames = min(int(10.0 * sr), int(info.frames))
        data, sr = sf.read(abs_path, stop=read_frames, dtype="float32", always_2d=True)
        mono = data.mean(axis=1)

        # Search for silence / breath pause in [4.5s, 8.5s]
        min_idx = int(4.5 * sr)
        max_idx = min(int(8.5 * sr), len(mono))
        window_len = int(0.05 * sr)  # 50ms window

        best_idx = int(min(6.5 * sr, len(mono)))
        if max_idx > min_idx + window_len:
            step = int(0.01 * sr)
            rms_vals = []
            for idx in range(min_idx, max_idx - window_len, step):
                chunk = mono[idx : idx + window_len]
                rms = float(np.sqrt(np.mean(chunk**2)))
                rms_vals.append((rms, idx))
            if rms_vals:
                _best_rms, best_idx = min(rms_vals, key=lambda x: x[0])

        trimmed = mono[:best_idx]
        write_audio_atomic(cached_wav, trimmed, sr=sr, fmt="wav")
        log(f"[prepare_clone_reference] Extracted {best_idx / sr:.2f}s slice to {cached_wav}")

    if skip_transcribe:
        return cached_wav, ""

    # Requirement 1: When audio is trimmed, the original ref_text corresponds to the full audio
    # and MUST NOT be used for the trimmed slice. We transcribe the exact slice.
    if os.path.isfile(cached_txt_path):
        try:
            with open(cached_txt_path, "r", encoding="utf-8") as f:
                cached_text = f.read().strip()
            if cached_text:
                return cached_wav, cached_text
        except Exception:
            pass

    from .asr_engine import auto_transcribe_sample
    slice_transcript = auto_transcribe_sample(cached_wav, language=language, models_dir=models_dir)
    if slice_transcript:
        try:
            with open(cached_txt_path, "w", encoding="utf-8") as f:
                f.write(slice_transcript)
        except Exception:
            pass
    return cached_wav, slice_transcript

