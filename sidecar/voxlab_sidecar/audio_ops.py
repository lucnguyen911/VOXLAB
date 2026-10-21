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


def apply_clarity_time_stretch(audio: np.ndarray, sr: int, rate: float = 0.95) -> np.ndarray:
    """Applies pitch-preserving time stretch to expand micro-transitions between words and syllables.
    Default rate 0.95x lengthens audio duration by ~5.26% without modifying pitch (F0) or speaker timbre.
    """
    if rate == 1.0 or audio.size == 0:
        return audio
    import librosa

    mono = np.ascontiguousarray(audio, dtype=np.float32)
    if mono.ndim > 1:
        mono = mono.mean(axis=1)

    stretched = librosa.effects.time_stretch(mono, rate=rate)
    return np.clip(stretched, -1.0, 1.0).astype(np.float32)


def detect_and_filter_leading_artifact(
    audio: np.ndarray,
    sr: int,
) -> tuple[np.ndarray, dict[str, Any]]:
    """Detects and filters isolated leading micro-transients / pre-speech artifacts
    before the first spoken word of an audio segment.

    Multi-feature evaluation combines:
    1. Burst duration (`burst_dur_ms`: 10ms - 95ms)
    2. Relative RMS & peak energy vs. the first word's syllable nucleus (`rel_rms_ratio <= 0.12`)
    3. Separation silence valley duration & depth (`valley_dur_ms >= 25ms`)
    4. Spectral zero-crossing rate (`zcr`) to distinguish real unvoiced initial
       consonants (e.g. /s/, /f/, /t/, /k/ before stop closures) from TTS prompt/breath artifacts.

    Policy:
    - High confidence (`confidence == "high"`): trims the isolated pre-pulse up to a safe
      25ms lead-in before true speech onset and applies a 10ms Hann raised-cosine fade-in.
    - Ambiguous (`confidence == "low"`): preserves original audio untouched and emits a
      diagnostic `leading_artifact_suspected` warning.
    - Normal speech onset (`confidence == "none"`): preserves original audio untouched.
    """
    mono = np.ascontiguousarray(audio, dtype=np.float32)
    if mono.ndim > 1:
        mono = mono.mean(axis=1)

    if mono.size == 0 or sr <= 0 or mono.size < int(0.35 * sr):
        return mono, {"action": "none", "confidence": "none"}

    peak = float(np.max(np.abs(mono)))
    if peak < 1e-4:
        return mono, {"action": "none", "confidence": "none"}

    frame_len = max(1, int(round(0.010 * sr)))  # 10ms frame
    num_frames = mono.size // frame_len
    if num_frames < 20:
        return mono, {"action": "none", "confidence": "none"}

    frames = mono[: num_frames * frame_len].reshape(num_frames, frame_len)
    frame_rms = np.sqrt(np.mean(frames ** 2, axis=1))

    silence_thresh = max(0.0012, min(0.0035, peak * 0.012))
    active_rms = frame_rms[frame_rms >= silence_thresh * 2.0]
    if active_rms.size == 0:
        return mono, {"action": "none", "confidence": "none"}

    ref_rms = float(np.percentile(active_rms, 75))
    main_onset_thresh = max(silence_thresh * 3.0, ref_rms * 0.20)

    # Scan within the first 500ms for the earliest above-silence activity
    max_lead_frames = min(num_frames, 50)
    b_start = -1
    for f in range(max_lead_frames):
        if frame_rms[f] >= silence_thresh:
            b_start = f
            break

    if b_start < 0:
        return mono, {"action": "none", "confidence": "none"}

    # Find the first sustained main speech nucleus onset
    main_start = -1
    for f in range(b_start, min(num_frames - 1, b_start + 45)):
        if frame_rms[f] >= main_onset_thresh and frame_rms[f + 1] >= silence_thresh * 2.0:
            main_start = f
            break

    # Need at least 30ms (3 frames) between b_start and main_start to have a pre-pulse + valley
    if main_start < 0 or (main_start - b_start) < 3:
        return mono, {"action": "none", "confidence": "none"}

    # Inspect [b_start, main_start) for either:
    # (a) a strict silence valley (frame_rms <= silence_thresh * 1.15), or
    # (b) a local double-onset dip (local peak followed by a dip <= 0.68 * peak_rms before rising again)
    b_end = -1
    valley_end = -1

    # Check (a): strict silence valley after initial burst
    cur_end = b_start + 1
    while cur_end < main_start and frame_rms[cur_end] >= silence_thresh * 0.85:
        cur_end += 1
    if cur_end < main_start:
        v_end = cur_end
        while v_end < main_start and frame_rms[v_end] < main_onset_thresh:
            v_end += 1
        if v_end > cur_end:
            b_end = cur_end
            valley_end = v_end

    # Check (b): local energy dip inside pre-nucleus region (e.g. pre-pulse at 0.16-0.19s -> dip at 0.20-0.22s -> consonant at 0.23s)
    if b_end < 0 and (main_start - b_start) >= 5:
        pre_rms = frame_rms[b_start:main_start]
        for p_rel in range(min(6, pre_rms.size - 3)):
            peak_val = float(pre_rms[p_rel])
            if peak_val < silence_thresh:
                continue
            dip_thresh = min(silence_thresh * 1.50, peak_val * 0.68)
            dip_start_rel = -1
            dip_end_rel = -1
            min_dip_val = peak_val
            for r_idx in range(p_rel + 1, pre_rms.size - 1):
                val = float(pre_rms[r_idx])
                if val <= dip_thresh:
                    if dip_start_rel < 0:
                        dip_start_rel = r_idx
                    dip_end_rel = r_idx + 1
                    if val < min_dip_val:
                        min_dip_val = val
                elif dip_start_rel >= 0:
                    break
            if (
                dip_start_rel > 0
                and dip_end_rel > dip_start_rel
                and dip_end_rel < pre_rms.size
                and float(np.max(pre_rms[dip_end_rel:])) >= min_dip_val * 1.25
            ):
                b_end = b_start + dip_start_rel
                valley_end = b_start + dip_end_rel
                break

    if b_end <= b_start or valley_end <= b_end:
        return mono, {"action": "none", "confidence": "none"}

    s_b0 = b_start * frame_len
    s_b1 = b_end * frame_len
    s_v1 = valley_end * frame_len
    s_m0 = main_start * frame_len
    s_m1 = min(mono.size, s_m0 + int(round(0.150 * sr)))

    burst_slice = mono[s_b0:s_b1]
    valley_slice = mono[s_b1:s_v1]
    nucleus_slice = mono[s_m0:s_m1]

    if burst_slice.size == 0 or valley_slice.size == 0 or nucleus_slice.size == 0:
        return mono, {"action": "none", "confidence": "none"}

    burst_dur_ms = round((b_end - b_start) * 10.0, 1)
    valley_dur_ms = round((valley_end - b_end) * 10.0, 1)
    burst_rms = float(np.sqrt(np.mean(burst_slice ** 2)))
    burst_peak = float(np.max(np.abs(burst_slice)))
    valley_rms = float(np.sqrt(np.mean(valley_slice ** 2)))
    nucleus_rms = float(np.sqrt(np.mean(nucleus_slice ** 2)))
    rel_rms_ratio = burst_rms / max(1e-6, nucleus_rms)
    zcr = float(np.mean(np.diff(np.signbit(burst_slice)))) if burst_slice.size > 1 else 0.0

    burst_start_sec = round(s_b0 / sr, 4)
    burst_end_sec = round(s_b1 / sr, 4)
    speech_onset_sec = round(s_v1 / sr, 4)

    # Protect real unvoiced sibilant/fricative consonants (/s/, /f/, /sh/, aspirated /t/)
    is_likely_initial_fricative = (zcr >= 0.22 and rel_rms_ratio >= 0.04) or (burst_dur_ms > 95.0)

    is_high_confidence_artifact = (
        10.0 <= burst_dur_ms <= 95.0
        and valley_dur_ms >= 25.0
        and valley_rms <= silence_thresh * 1.25
        and valley_end == main_start
        and rel_rms_ratio <= 0.12
        and burst_peak <= 0.065
        and not is_likely_initial_fricative
    )

    if is_high_confidence_artifact:
        safety_head = int(round(0.025 * sr))
        cut_sample = max(s_b1, s_m0 - safety_head)
        trimmed = mono[cut_sample:].copy()
        fade_len = min(trimmed.size, max(1, int(round(0.010 * sr))))
        if fade_len > 0:
            win = 0.5 * (1.0 - np.cos(np.pi * np.arange(fade_len, dtype=np.float32) / fade_len))
            trimmed[:fade_len] *= win
        return trimmed, {
            "action": "trimmed",
            "confidence": "high",
            "trimmedDurationSec": round(cut_sample / sr, 4),
            "burstStartSec": burst_start_sec,
            "burstEndSec": burst_end_sec,
            "speechOnsetSec": round(s_m0 / sr, 4),
            "burstDurationMs": burst_dur_ms,
            "valleyDurationMs": valley_dur_ms,
            "relativeRmsRatio": round(rel_rms_ratio, 4),
            "zcr": round(zcr, 4),
        }

    # Ambiguous isolated pre-onset burst or double-onset pulse: do NOT cut, emit diagnostic warning
    if 10.0 <= burst_dur_ms <= 130.0 and valley_dur_ms >= 10.0 and rel_rms_ratio <= 0.25:
        return mono, {
            "action": "kept_with_warning",
            "confidence": "low",
            "burstStartSec": burst_start_sec,
            "burstEndSec": burst_end_sec,
            "speechOnsetSec": speech_onset_sec,
            "burstDurationMs": burst_dur_ms,
            "valleyDurationMs": valley_dur_ms,
            "relativeRmsRatio": round(rel_rms_ratio, 4),
            "zcr": round(zcr, 4),
            "message": (
                f"Phát hiện xung âm nghi vấn đầu đoạn ({burst_start_sec:.2f}s–{burst_end_sec:.2f}s, "
                f"{burst_dur_ms:.0f}ms, tỷ lệ năng lượng {rel_rms_ratio:.2f}) trước từ đầu tiên tại "
                f"{speech_onset_sec:.2f}s; giữ nguyên âm gốc để bảo toàn phụ âm đầu."
            ),
        }

    return mono, {"action": "none", "confidence": "none"}


def normalize_internal_breath_seams(
    audio: np.ndarray,
    sr: int,
) -> tuple[np.ndarray, dict[str, Any]]:
    """Normalizes internal double-breath pauses and stitched sub-chunk silence seams
    (e.g. from internal TTS chunking/crossfading) without clipping any speech onset/offset.

    1. Pass 1 (Soft Breath Attenuation): Inside internal non-speech pauses (>= 380ms) that
       contain both a deep silence valley (< -47 dB) and secondary breath/inhale energy
       (> -44 dB), applies a smooth raised-cosine ducking envelope (gain 0.35 / -9.1 dB)
       while strictly preserving 40ms after the preceding word and 30ms before the next word.
    2. Pass 2 (Dead-Silence Valley Compaction): Inside stretched internal pauses (>= 570ms),
       compacts only the contiguous dead-silence valley (< -47 dB) using a 15ms raised-cosine
       crossfade so comma/clause seams settle around ~380ms and oversized sentence pauses
       settle around ~600ms, leaving normal 500-550ms sentence pauses untouched.
    """
    mono = np.ascontiguousarray(audio, dtype=np.float32)
    if mono.ndim > 1:
        mono = mono.mean(axis=1)
    if mono.size < int(0.6 * sr) or sr <= 0:
        return mono, {"compactedMs": 0.0, "attenuatedBreaths": 0}

    frame_len = max(1, int(round(0.010 * sr)))  # 10ms frame
    n_frames = mono.size // frame_len
    if n_frames < 60:
        return mono, {"compactedMs": 0.0, "attenuatedBreaths": 0}

    frames = mono[: n_frames * frame_len].reshape(n_frames, frame_len)
    rms = np.sqrt(np.mean(frames ** 2, axis=1))
    rms_db = 20.0 * np.log10(np.maximum(rms, 1e-7))

    quiet_mask = rms_db < -34.0
    changes = np.diff(quiet_mask.astype(int))
    q_starts = np.where(changes == 1)[0] + 1
    q_ends = np.where(changes == -1)[0] + 1
    if quiet_mask[0]:
        q_starts = np.insert(q_starts, 0, 0)
    if quiet_mask[-1]:
        q_ends = np.append(q_ends, n_frames)

    out = mono.copy()
    attenuated_count = 0

    for qs, qe in zip(q_starts, q_ends):
        if qs <= 10 or qe >= n_frames - 10:
            continue
        dur_frames = int(qe - qs)
        if dur_frames < 38:
            continue

        inner_s = int(qs + 4)
        safe_e = int(qe - 3)
        if safe_e <= inner_s + 4:
            continue

        valley_min_db = float(np.min(rms_db[inner_s:safe_e]))
        valley_max_db = float(np.max(rms_db[inner_s:safe_e]))
        if valley_min_db < -47.0 and valley_max_db > -44.0:
            s0 = inner_s * frame_len
            s1 = safe_e * frame_len
            span = s1 - s0
            if span > 0:
                ramp = min(span // 3, int(round(0.035 * sr)))
                env = np.full(span, 0.35, dtype=np.float32)
                if ramp > 0:
                    curve = 0.5 * (1.0 - np.cos(np.pi * np.arange(ramp, dtype=np.float32) / ramp))
                    env[:ramp] = 1.0 - 0.65 * curve
                    env[-ramp:] = 0.35 + 0.65 * curve
                out[s0:s1] *= env
                attenuated_count += 1

    pieces: list[np.ndarray] = []
    cursor = 0
    compacted_samples = 0
    fade_samples = max(1, int(round(0.015 * sr)))

    for qs, qe in zip(q_starts, q_ends):
        if qs <= 10 or qe >= n_frames - 10:
            continue
        dur_frames = int(qe - qs)
        if dur_frames < 57:
            continue

        inner_s = int(qs + 5)
        inner_e = int(qe - 6)
        if inner_e - inner_s < 16:
            continue

        dead_mask = rms_db[inner_s:inner_e] < -47.0
        best_len = 0
        best_ds = -1
        cur_len = 0
        cur_ds = -1
        for idx_rel, is_dead in enumerate(dead_mask):
            if is_dead:
                if cur_len == 0:
                    cur_ds = inner_s + idx_rel
                cur_len += 1
                if cur_len > best_len:
                    best_len = cur_len
                    best_ds = cur_ds
            else:
                cur_len = 0

        target_total_frames = 38 if dur_frames <= 86 else 60
        excess_frames = dur_frames - target_total_frames
        removable_frames = min(excess_frames, max(0, best_len - 10))
        if removable_frames >= 8 and best_ds >= 0:
            keep_before = (best_len - removable_frames) // 2
            cut_start_frame = best_ds + keep_before
            cut_end_frame = cut_start_frame + removable_frames
            cut_s = cut_start_frame * frame_len
            cut_e = cut_end_frame * frame_len
            if cut_e > cut_s + fade_samples * 2 and cut_s > cursor:
                pieces.append(out[cursor:cut_s])
                if pieces[-1].size >= fade_samples and (out.size - cut_e) >= fade_samples:
                    w_out = 0.5 * (1.0 + np.cos(np.pi * np.arange(fade_samples, dtype=np.float32) / fade_samples))
                    w_in = 1.0 - w_out
                    pieces[-1][-fade_samples:] = (
                        pieces[-1][-fade_samples:] * w_out + out[cut_e : cut_e + fade_samples] * w_in
                    )
                    cursor = cut_e + fade_samples
                else:
                    cursor = cut_e
                compacted_samples += cut_e - cut_s

    if cursor < out.size:
        pieces.append(out[cursor:])
    final_audio = np.concatenate(pieces) if pieces else out
    return final_audio, {
        "compactedMs": round((compacted_samples / sr) * 1000.0, 1),
        "attenuatedBreaths": attenuated_count,
    }


def attenuate_leading_breath_and_measure_edges(
    audio: np.ndarray,
    sr: int,
    silence_threshold_rms: float = 0.006,
) -> tuple[np.ndarray, dict[str, Any]]:
    """Measures leading/trailing silence (in ms) and softly attenuates pre-speech inhale
    breaths at the start of a chunk (preserving the final 30ms before main speech onset
    at full gain so initial consonants are never clipped).
    """
    mono = np.ascontiguousarray(audio, dtype=np.float32)
    if mono.ndim > 1:
        mono = mono.mean(axis=1)
    if mono.size == 0 or sr <= 0:
        return mono, {"leadingSilenceMs": 0, "trailingSilenceMs": 0, "leadingBreathAttenuated": False}

    frame_len = max(1, int(round(0.010 * sr)))
    n_frames = mono.size // frame_len
    if n_frames < 10:
        return mono, {"leadingSilenceMs": 0, "trailingSilenceMs": 0, "leadingBreathAttenuated": False}

    frames = mono[: n_frames * frame_len].reshape(n_frames, frame_len)
    rms = np.sqrt(np.mean(frames ** 2, axis=1))
    rms_db = 20.0 * np.log10(np.maximum(rms, 1e-7))

    lead_frames = 0
    for val in rms:
        if val < silence_threshold_rms:
            lead_frames += 1
        else:
            break

    trail_frames = 0
    for val in rms[::-1]:
        if val < silence_threshold_rms:
            trail_frames += 1
        else:
            break

    out = mono.copy()
    breath_attenuated = False

    # Locate first sustained main speech nucleus (rms_db >= -24 dB) within the first 700ms
    main_onset = -1
    search_limit = min(n_frames - 1, 70)
    for f in range(search_limit):
        if rms_db[f] >= -24.0 and rms_db[f + 1] >= -28.0:
            main_onset = f
            break

    if main_onset >= 8:
        safe_end = main_onset - 3  # Leave 30ms before main nucleus untouched for initial consonants
        # Check if frames before safe_end contain a pre-speech breath (-44 dB to -28 dB) preceded by silence
        breath_zone = rms_db[:safe_end]
        if safe_end >= 5 and float(np.min(breath_zone[: max(1, safe_end - 3)])) < -46.0:
            active_breath = np.where((breath_zone >= -44.0) & (breath_zone <= -28.0))[0]
            if active_breath.size >= 4:
                b0 = int(active_breath[0]) * frame_len
                b1 = safe_end * frame_len
                span = b1 - b0
                if span > 0:
                    ramp = min(span // 2, int(round(0.030 * sr)))
                    env = np.full(span, 0.38, dtype=np.float32)
                    if ramp > 0:
                        curve = 0.5 * (1.0 - np.cos(np.pi * np.arange(ramp, dtype=np.float32) / ramp))
                        env[-ramp:] = 0.38 + 0.62 * curve
                    out[b0:b1] *= env
                    breath_attenuated = True

    return out, {
        "leadingSilenceMs": int(round((lead_frames * frame_len / sr) * 1000.0)),
        "trailingSilenceMs": int(round((trail_frames * frame_len / sr) * 1000.0)),
        "leadingBreathAttenuated": breath_attenuated,
    }


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
    boundary_warnings: list[dict[str, Any]] = []
    if mode == "sequential":
        parts: list[np.ndarray] = []
        cursor = 0
        processed_clips: list[np.ndarray] = []
        edge_metrics: list[dict[str, Any]] = []
        for i, raw_clip in enumerate(clips):
            clip, lead_info = detect_and_filter_leading_artifact(raw_clip, sr)
            if lead_info.get("action") == "kept_with_warning":
                boundary_warnings.append({
                    "type": "leading_artifact_suspected",
                    "chunkIndex": i,
                    "position": "start",
                    "burstStartSec": lead_info.get("burstStartSec"),
                    "burstEndSec": lead_info.get("burstEndSec"),
                    "speechOnsetSec": lead_info.get("speechOnsetSec"),
                    "message": lead_info.get("message", f"Phát hiện xung âm nghi vấn đầu đoạn {i + 1}."),
                })
            clip, _seam_info = normalize_internal_breath_seams(clip, sr)
            clip, edge_info = attenuate_leading_breath_and_measure_edges(clip, sr)
            processed_clips.append(clip)
            edge_metrics.append(edge_info)

        for i, (item, clip) in enumerate(zip(inputs, processed_clips)):
            raw_gap_ms = float(item.get("gapAfterMs") or 0)
            # Compensate for unsubtracted leading silence of the following chunk so boundary
            # pauses never stack trailing + inserted gap + next chunk's leading silence.
            if i < len(processed_clips) - 1 and raw_gap_ms > 0 and not item.get("leadingSilenceCompensated"):
                next_lead_ms = float(edge_metrics[i + 1].get("leadingSilenceMs") or 0)
                already_deducted_lead_ms = float(inputs[i + 1].get("leadingSilenceMs") or 0)
                uncompensated_lead_ms = max(0.0, next_lead_ms - already_deducted_lead_ms)
                gap_ms = max(0.0, raw_gap_ms - uncompensated_lead_ms)
            else:
                gap_ms = raw_gap_ms
            gap = max(0, int(round(gap_ms * sr / 1000.0)))
            segments.append({"index": i, "startSec": round(cursor / sr, 4),
                             "endSec": round((cursor + clip.size) / sr, 4), "durationSec": round(clip.size / sr, 4)})

            # Master Audio Boundary Check: non-zero crossing clicks/pops or excessive silence gap (> 4.0s)
            # TUNING REQUIRED (CONSTRAINTS.md section 7.2)
            if clip.size > 0:
                if abs(float(clip[0])) > 0.15:
                    boundary_warnings.append({
                        "type": "click_pop_risk",
                        "chunkIndex": i,
                        "position": "start",
                        "amplitude": round(float(abs(clip[0])), 3),
                        "message": f"Vết cắt đầu đoạn {i + 1} có biên độ lệch zero ({abs(clip[0]):.2f}), có thể gây tiếng click.",
                    })
                if abs(float(clip[-1])) > 0.15:
                    boundary_warnings.append({
                        "type": "click_pop_risk",
                        "chunkIndex": i,
                        "position": "end",
                        "amplitude": round(float(abs(clip[-1])), 3),
                        "message": f"Vết cắt cuối đoạn {i + 1} có biên độ lệch zero ({abs(clip[-1]):.2f}), có thể gây tiếng click.",
                    })

            if i < len(inputs) - 1 and gap_ms > 4000.0:
                boundary_warnings.append({
                    "type": "gap_too_long",
                    "chunkIndex": i,
                    "gapMs": round(gap_ms, 1),
                    "message": f"Khoảng lặng giữa đoạn {i + 1} và {i + 2} quá dài ({gap_ms / 1000.0:.1f}s > 4.0s).",
                })

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
            "peakAmplitude": round(float(np.abs(out).max()) if out.size else 0.0, 4), "segments": segments,
            "boundaryWarnings": boundary_warnings}


def probe(params: dict[str, Any]) -> dict[str, Any]:
    import soundfile as sf

    raw_path = params.get("path") or params.get("audioPath")
    path = raw_path if isinstance(raw_path, str) and raw_path.strip() else require(params, "path", str)
    if not os.path.isfile(path):
        raise SidecarError("INPUT_NOT_FOUND", "path does not exist")
    try:
        info = sf.info(path)
        return {
            "durationSec": round(float(info.duration), 4),
            "sampleRate": int(info.samplerate),
            "channels": int(info.channels),
            "format": str(info.format),
            "hasAudioTrack": True,
        }
    except Exception as sf_err:  # noqa: BLE001
        try:
            import av

            with av.open(path) as container:
                audio_streams = list(container.streams.audio)
                video_streams = list(container.streams.video)
                if not audio_streams:
                    if video_streams:
                        raise SidecarError("NO_AUDIO_STREAM", "Không tìm thấy track âm thanh trong video.")
                    raise SidecarError("INVALID_REQUEST", f"cannot read audio stream: {sf_err}")

                a_stream = audio_streams[0]
                dur_sec = 0.0
                if container.duration is not None and container.duration > 0:
                    dur_sec = float(container.duration) / 1_000_000.0
                elif a_stream.duration is not None and a_stream.time_base is not None:
                    dur_sec = float(a_stream.duration * a_stream.time_base)

                sr = int(getattr(a_stream, "rate", 0) or getattr(a_stream.codec_context, "sample_rate", 0) or 44100)
                ch = int(getattr(a_stream, "channels", 0) or getattr(a_stream.codec_context, "channels", 0) or 2)
                ext = os.path.splitext(path)[1].lstrip(".").upper() or "MEDIA"
                res: dict[str, Any] = {
                    "durationSec": round(max(0.0, dur_sec), 4),
                    "sampleRate": sr,
                    "channels": ch,
                    "format": ext,
                    "hasAudioTrack": True,
                }
                if video_streams:
                    v_stream = video_streams[0]
                    w = int(getattr(v_stream, "width", 0) or getattr(v_stream.codec_context, "width", 0) or 0)
                    h = int(getattr(v_stream, "height", 0) or getattr(v_stream.codec_context, "height", 0) or 0)
                    if w > 0 and h > 0:
                        res["resolution"] = f"{w}×{h}"
                return res
        except SidecarError:
            raise
        except Exception as e:  # noqa: BLE001
            raise SidecarError("INVALID_REQUEST", f"cannot read media header: {e}") from e


def prepare_clone_reference(
    ref_audio_path: str,
    ref_text: str | None = None,
    language: str | None = None,
    models_dir: str | None = None,
    max_duration: float = 15.5,
    skip_transcribe: bool = False,
    engine: str | None = None,
) -> tuple[str, str]:
    """Ensures reference audio passed to zero-shot voice cloning engines (OmniVoice, Chatterbox, Qwen)
    is within each model's empirically verified duration limit and has an exact matching transcript.

    Empirical per-engine duration limits (verified on RTX GPU at 6s, 8s, 10s, 15s):
      - OmniVoice: min 3.0s, sweet spot 6.0s - 10.0s, max 15.0s (beyond 15s increases latency by ~25% with no timbre gain)
      - Qwen3-TTS 1.7B Base: min 3.0s, sweet spot 6.0s - 10.0s, max 15.0s (requires exact transcript synchronization)
      - Chatterbox Turbo: min 5.5s (upstream > 5.0s), sweet spot 8.0s - 15.0s, max 20.0s

    When a reference clip is already within `max_duration` (e.g. user trimmed it in the UI), the clip
    and user-supplied `ref_text` are preserved intact. Only when an un-trimmed raw audio exceeds
    `max_duration` does this function slice to the model's sweet spot and re-transcribe the slice.
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

    # If within the allowed model duration limit, preserve user's exact audio and transcript
    if duration <= max_duration:
        user_txt = (ref_text or "").strip()
        if not user_txt and not skip_transcribe:
            from .asr_engine import auto_transcribe_sample
            user_txt = auto_transcribe_sample(ref_audio_path, language=language, models_dir=models_dir)
        return ref_audio_path, user_txt

    # Raw audio exceeds max_duration: slice to the engine's empirical sweet spot
    is_chatterbox = (engine or "").lower().startswith("chatterbox")
    slice_min_sec = 8.0 if is_chatterbox else 6.0
    slice_max_sec = 13.5 if is_chatterbox else 10.0
    slice_default_sec = 10.5 if is_chatterbox else 8.0

    abs_path = os.path.abspath(ref_audio_path)
    try:
        stat = os.stat(abs_path)
        cache_key = hashlib.md5(
            f"{abs_path}_{stat.st_mtime}_{stat.st_size}_{slice_min_sec}_{slice_max_sec}".encode()
        ).hexdigest()[:12]
    except Exception:
        cache_key = hashlib.md5(f"{abs_path}_{slice_min_sec}_{slice_max_sec}".encode()).hexdigest()[:12]

    cache_dir = os.path.join(tempfile.gettempdir(), "voxlab_ref_cache")
    os.makedirs(cache_dir, exist_ok=True)
    cached_wav = os.path.join(cache_dir, f"ref_{cache_key}_trimmed.wav")
    cached_txt_path = os.path.join(cache_dir, f"ref_{cache_key}_trimmed.txt")
    try:
        cached_exists = os.path.isfile(cached_wav) and os.path.getsize(cached_wav) > 0
    except OSError:
        cached_exists = False

    if not cached_exists:
        log(
            f"[prepare_clone_reference] Audio is {duration:.1f}s (>{max_duration:.1f}s). "
            f"Auto-trimming to optimal [{slice_min_sec:.1f}s, {slice_max_sec:.1f}s] slice..."
        )
        sr = int(info.samplerate)
        read_frames = min(int((slice_max_sec + 1.5) * sr), int(info.frames))
        data, sr = sf.read(abs_path, stop=read_frames, dtype="float32", always_2d=True)
        mono = data.mean(axis=1)

        min_idx = int(slice_min_sec * sr)
        max_idx = min(int(slice_max_sec * sr), len(mono))
        window_len = int(0.05 * sr)  # 50ms window

        best_idx = int(min(slice_default_sec * sr, len(mono)))
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

