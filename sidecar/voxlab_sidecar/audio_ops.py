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


def _resample_numpy_fallback(x: np.ndarray, sr_from: int, sr_to: int) -> np.ndarray:
    if sr_from == sr_to or x.size == 0:
        return x.astype(np.float32, copy=False)
    n_out = max(1, int(round(x.shape[0] * float(sr_to) / float(sr_from))))
    if x.shape[0] == 1:
        return np.repeat(x.astype(np.float32), n_out)
    t_old = np.linspace(0.0, 1.0, num=x.shape[0], endpoint=False, dtype=np.float64)
    t_new = np.linspace(0.0, 1.0, num=n_out, endpoint=False, dtype=np.float64)
    return np.interp(t_new, t_old, x).astype(np.float32)


def _resample(x: np.ndarray, sr_from: int, sr_to: int) -> np.ndarray:
    if sr_from == sr_to or x.size == 0:
        return x
    try:
        from scipy.signal import resample_poly

        g = math.gcd(sr_from, sr_to)
        return resample_poly(x, sr_to // g, sr_from // g).astype(np.float32)
    except ImportError:
        return _resample_numpy_fallback(x, sr_from, sr_to)


def apply_clarity_time_stretch(audio: np.ndarray, sr: int, rate: float = 0.95) -> np.ndarray:
    """Applies pitch-preserving time stretch to expand micro-transitions between words and syllables.
    Default rate 0.95x lengthens audio duration by ~5.26% without modifying pitch (F0) or speaker timbre.
    """
    if rate == 1.0 or audio.size == 0:
        return audio

    mono = np.ascontiguousarray(audio, dtype=np.float32)
    if mono.ndim > 1:
        mono = mono.mean(axis=1)

    try:
        import librosa

        stretched = librosa.effects.time_stretch(mono, rate=rate)
        return np.clip(stretched, -1.0, 1.0).astype(np.float32)
    except ImportError:
        # Lightweight Hann overlap-add fallback when librosa is unavailable (e.g. unit test venv)
        win = max(256, int(round(sr * 0.025)))
        hop_s = max(64, win // 4)
        hop_a = max(1, int(round(hop_s * rate)))
        if mono.shape[0] <= win:
            return mono
        window = np.hanning(win).astype(np.float32)
        n_frames = max(1, 1 + (mono.shape[0] - win) // hop_a)
        out_len = (n_frames - 1) * hop_s + win
        out = np.zeros(out_len, dtype=np.float32)
        norm = np.zeros(out_len, dtype=np.float32)
        for idx in range(n_frames):
            a_start = idx * hop_a
            if a_start + win > mono.shape[0]:
                break
            s_start = idx * hop_s
            out[s_start : s_start + win] += mono[a_start : a_start + win] * window
            norm[s_start : s_start + win] += window * window
        mask = norm > 1e-6
        out[mask] /= norm[mask]
        return np.clip(out, -1.0, 1.0).astype(np.float32)


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


def _max_allowed_pause_from_config(punctuation_pauses: dict[str, Any] | None) -> float | None:
    if not isinstance(punctuation_pauses, dict):
        return None
    vals: list[float] = []
    for k in ("comma", "period", "questionExclamation", "colonSemicolon"):
        v = punctuation_pauses.get(k)
        if isinstance(v, (int, float)) and not math.isnan(float(v)):
            vals.append(max(0.0, min(5.0, float(v))))
    if not vals:
        return None
    return max(0.65, max(vals) + 0.15)


def normalize_internal_breath_seams(
    audio: np.ndarray,
    sr: int,
    max_allowed_pause_sec: float | None = None,
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

    min_trigger_frames = 57
    if max_allowed_pause_sec is not None and max_allowed_pause_sec > 0:
        min_trigger_frames = max(57, int(round(float(max_allowed_pause_sec) * 100.0)))

    for qs, qe in zip(q_starts, q_ends):
        if qs <= 10 or qe >= n_frames - 10:
            continue
        dur_frames = int(qe - qs)
        if dur_frames < min_trigger_frames:
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
        if max_allowed_pause_sec is not None and max_allowed_pause_sec > 0:
            target_total_frames = max(
                target_total_frames,
                int(round(max(0.38, float(max_allowed_pause_sec) - 0.08) * 100.0)),
            )
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
        assemble_max_pause = _max_allowed_pause_from_config(params.get("punctuationPauses"))
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
            clip, _seam_info = normalize_internal_breath_seams(
                clip, sr, max_allowed_pause_sec=assemble_max_pause
            )
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
        safety_gap_samples = int(round(0.02 * sr))
        starts = []
        min_next_start = 0
        for i, (item, clip) in enumerate(zip(inputs, clips)):
            st = item.get("startSec")
            if not isinstance(st, (int, float)) or st < 0:
                raise SidecarError("INVALID_REQUEST", f"inputs[{i}].startSec must be >= 0 in timeline mode")
            req_start = int(round(float(st) * sr))
            actual_start = max(req_start, min_next_start) if i > 0 else req_start
            starts.append(actual_start)
            min_next_start = actual_start + clip.size + safety_gap_samples
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


_MAJOR_PROTECT_PATTERN = (
    r"(?:\[[^\]]+\]"
    r"|https?://[^\s]+|www\.[^\s]+|[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+"
    r"|(?:[A-Z]\.){2,6}"
    r"|\b(?:Ph\.D|M\.D|B\.A|M\.A|U\.S\.A|U\.S|U\.K|E\.U|U\.N|W\.H\.O)\."
    r"|\b(?:e\.g|i\.e|a\.m|p\.m|E\.G|I\.E|A\.M|P\.M)\."
    r"|\b(?:Dr|Mr|Mrs|Ms|Prof|Rev|Gen|Sen|Rep|St|Jr|Sr|vs|etc|al|TP|ThS|TS|PGS|GS|BS|KS)\."
    r"|\b\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?\b"
    r"|\b\d{1,2}:\d{2}(?::\d{2})?\b"
    r"|\bv?\d+(?:\.\d+)+[a-zA-Z0-9._-]*\b"
    r"|\$\d+(?:,\d{3})*(?:\.\d+)?[BMKbmk]?\b)"
)


def _classify_major_boundary_mark(mark_str: str) -> str:
    if any(c in mark_str for c in ("?", "!", "？", "！")):
        return "questionExclamation"
    if any(c in mark_str for c in (":", ";", "：", "；")):
        return "colonSemicolon"
    if "…" in mark_str or "." in mark_str or "。" in mark_str:
        return "period"
    return ""


def split_tts_chunk_by_major_punctuation(text: str) -> list[tuple[str, str]]:
    """Splits a chunk text into major prosodic units at sentence/clause marks (`.`, `!`, `?`, `…`, `:`, `;`)
    while protecting abbreviations (`Dr.`, `U.S.`), decimals/versions (`3.0`, `13.5`), currencies (`$10,000`),
    clock times (`10:30`), and inline control tags (`[B EY1 S]`).

    Returns `[(segment_text, boundary_kind), ...]`, where `boundary_kind` is `"period"`,
    `"questionExclamation"`, `"colonSemicolon"`, or `""` on the final segment.
    """
    import re

    trimmed = (text or "").strip()
    if not trimmed:
        return []

    protected_items: list[str] = []

    def _mask(m: re.Match[str]) -> str:
        protected_items.append(m.group(0))
        return f"VOXMAJTOK{len(protected_items) - 1}ENDTOK"

    masked = re.sub(_MAJOR_PROTECT_PATTERN, _mask, trimmed)

    def _restore(s: str) -> str:
        return re.sub(
            r"VOXMAJTOK(\d+)ENDTOK",
            lambda m: protected_items[int(m.group(1))],
            s,
        )

    # Match major punctuation (+ optional closing quotes/brackets) followed by whitespace
    split_rx = re.compile(r'([.!?…:;。！？：；]+["\'”’»›)\]}]*)\s+')
    raw_parts: list[tuple[str, str]] = []
    last_idx = 0
    for m in split_rx.finditer(masked):
        end_punct = m.end(1)
        seg_masked = masked[last_idx:end_punct].strip()
        seg_restored = _restore(seg_masked).strip()
        kind = _classify_major_boundary_mark(m.group(1))
        if seg_restored and kind:
            raw_parts.append((seg_restored, kind))
            last_idx = m.end()

    tail_restored = _restore(masked[last_idx:]).strip()
    if tail_restored:
        raw_parts.append((tail_restored, ""))
    elif raw_parts:
        raw_parts[-1] = (raw_parts[-1][0], "")

    if len(raw_parts) <= 1:
        return [(trimmed, "")]

    # Merge tiny 1-word fragments across ':' / ';' so neural TTS always receives natural multi-word phrases
    merged: list[tuple[str, str]] = []
    idx = 0
    while idx < len(raw_parts):
        seg_txt, b_kind = raw_parts[idx]
        word_cnt = len(re.findall(r"[\w\u00C0-\u1EF9]+", seg_txt))
        if b_kind == "colonSemicolon" and word_cnt < 2 and idx + 1 < len(raw_parts):
            nxt_txt, nxt_kind = raw_parts[idx + 1]
            raw_parts[idx + 1] = (f"{seg_txt} {nxt_txt}".strip(), nxt_kind)
            idx += 1
            continue
        merged.append((seg_txt, b_kind))
        idx += 1

    # Also ensure the final segment has >= 2 words if preceded by ':' / ';'
    if len(merged) >= 2 and merged[-2][1] == "colonSemicolon":
        tail_words = len(re.findall(r"[\w\u00C0-\u1EF9]+", merged[-1][0]))
        if tail_words < 2:
            prev_txt, _ = merged[-2]
            tail_txt, tail_kind = merged[-1]
            merged[-2] = (f"{prev_txt} {tail_txt}".strip(), tail_kind)
            merged.pop()

    if merged:
        merged[-1] = (merged[-1][0], "")
    return merged


def _apply_edge_cosine_taper(clip: np.ndarray, sr: int, fade_ms: float = 10.0) -> np.ndarray:
    if clip.size == 0 or sr <= 0:
        return clip
    out = clip.astype(np.float32, copy=True)
    fade_n = min(out.size // 2, max(1, int(round((fade_ms / 1000.0) * sr))))
    if fade_n > 1:
        curve = 0.5 * (1.0 - np.cos(np.pi * np.arange(fade_n, dtype=np.float32) / float(fade_n)))
        out[:fade_n] *= curve
        out[-fade_n:] *= curve[::-1]
    return out


def stitch_tts_segments_with_pauses(
    clips: list[np.ndarray],
    sr: int,
    boundary_kinds: list[str],
    punctuation_pauses: dict[str, Any] | None = None,
) -> np.ndarray:
    """Stitches synthesized major clauses/sentences with exact user-configured punctuation pauses,
    accounting for existing trailing/leading silence and applying raised-cosine fades to prevent clicks.
    """
    if not clips:
        return np.zeros(0, dtype=np.float32)
    if len(clips) == 1:
        return _apply_edge_cosine_taper(clips[0], sr, fade_ms=8.0)

    cfg = punctuation_pauses if isinstance(punctuation_pauses, dict) else {}
    defaults = {
        "comma": 0.2,
        "period": 0.6,
        "questionExclamation": 0.5,
        "colonSemicolon": 0.4,
    }

    prepared: list[np.ndarray] = []
    edges: list[dict[str, Any]] = []
    for raw in clips:
        mono = np.ascontiguousarray(raw, dtype=np.float32)
        if mono.ndim > 1:
            mono = mono.mean(axis=1)
        mono, edge_info = attenuate_leading_breath_and_measure_edges(mono, sr)
        prepared.append(_apply_edge_cosine_taper(mono, sr, fade_ms=8.0))
        edges.append(edge_info)

    safety_pad = max(1, int(round(0.020 * sr)))  # keep >= 20ms natural consonant release/onset pad
    out_parts: list[np.ndarray] = []

    for i, clip in enumerate(prepared):
        cur = clip
        if i < len(prepared) - 1:
            b_kind = boundary_kinds[i] if i < len(boundary_kinds) else "period"
            raw_val = cfg.get(b_kind, defaults.get(b_kind, 0.5))
            target_sec = max(0.0, min(5.0, float(raw_val if isinstance(raw_val, (int, float)) else 0.5)))
            target_samples = int(round(target_sec * sr))

            trail_samples = int(round((float(edges[i].get("trailingSilenceMs", 0)) / 1000.0) * sr))
            next_lead_samples = int(round((float(edges[i + 1].get("leadingSilenceMs", 0)) / 1000.0) * sr))
            existing_total = trail_samples + next_lead_samples

            if existing_total <= target_samples:
                gap_samples = target_samples - existing_total
                out_parts.append(cur)
                if gap_samples > 0:
                    out_parts.append(np.zeros(gap_samples, dtype=np.float32))
            else:
                # Existing trailing + leading silence exceeds configured target pause: trim excess dead silence safely
                excess = existing_total - target_samples
                trim_trail = min(excess, max(0, trail_samples - safety_pad))
                rem_excess = excess - trim_trail
                if trim_trail > 0 and cur.size > trim_trail + safety_pad:
                    cur = _apply_edge_cosine_taper(cur[: cur.size - trim_trail], sr, fade_ms=8.0)
                if rem_excess > 0:
                    trim_lead = min(rem_excess, max(0, next_lead_samples - safety_pad))
                    if trim_lead > 0 and prepared[i + 1].size > trim_lead + safety_pad:
                        prepared[i + 1] = _apply_edge_cosine_taper(prepared[i + 1][trim_lead:], sr, fade_ms=8.0)
                        edges[i + 1]["leadingSilenceMs"] = max(
                            0, int(round(((next_lead_samples - trim_lead) / float(sr)) * 1000.0))
                        )
                out_parts.append(cur)
        else:
            out_parts.append(cur)

    return np.concatenate(out_parts) if out_parts else np.zeros(0, dtype=np.float32)


def shape_internal_punctuation_pauses(
    audio: np.ndarray,
    sr: int,
    text: str,
    punctuation_pauses: dict[str, Any],
    asr_words: list[dict[str, Any]],
    speed: float = 1.0,
    major_already_split: bool = False,
) -> tuple[np.ndarray, list[dict[str, Any]], list[dict[str, Any]]]:
    """Shapes in-chunk punctuation pauses (especially in-sentence clause/list commas `,`, plus any unsplit
    `. ! ? : ;` marks) directly at minimum-energy zero-crossings without altering pitch or prosody.

    Returns `(shaped_audio, updated_asr_words, applied_edits)`.
    """
    import difflib
    import re
    from . import audio_quality as aq

    mono = np.ascontiguousarray(audio, dtype=np.float32)
    if mono.ndim > 1:
        mono = mono.mean(axis=1)
    updated_words = [dict(w) for w in asr_words]
    if mono.size == 0 or sr <= 0 or not text or len(updated_words) < 2 or not isinstance(punctuation_pauses, dict):
        return mono, updated_words, []

    source_words, delimiters = aq.tokenize_text_with_delimiters(text)
    if len(source_words) < 2:
        return mono, updated_words, []

    src_clean = [aq.clean_word(w) for w in source_words]
    asr_raw = [str(w.get("word", "")) for w in updated_words]
    asr_clean = [aq.clean_word(w) for w in asr_raw]
    eff_lang = aq.resolve_script_language(text, None)

    src_spans = aq._collapse_multiplied_letter_spans(
        aq.collapse_number_tokens(source_words, eff_lang, delimiters=delimiters),
        source_words,
        delimiters=delimiters,
        counterpart_clean=set(asr_clean),
    )
    asr_spans = aq._collapse_multiplied_letter_spans(
        aq.collapse_number_tokens(asr_raw, eff_lang),
        asr_raw,
        counterpart_clean=set(src_clean),
    )

    src_boundary_to_asr: dict[int, int] = {}
    matcher = difflib.SequenceMatcher(
        None, [s.canonical for s in src_spans], [a.canonical for a in asr_spans], autojunk=False
    )
    opcodes = matcher.get_opcodes()
    aligned_pairs: list[tuple[int, int]] = []
    for tag, i1, i2, j1, j2 in opcodes:
        if tag == "equal":
            for off in range(i2 - i1):
                aligned_pairs.append((i1 + off, j1 + off))
        elif tag == "replace" and (i2 - i1) == (j2 - j1):
            for off in range(i2 - i1):
                sc = src_spans[i1 + off].canonical
                ac = asr_spans[j1 + off].canonical
                if aq.are_words_equivalent(sc, ac):
                    aligned_pairs.append((i1 + off, j1 + off))

    for idx_p, (sp_i, ap_j) in enumerate(aligned_pairs):
        s_cur = src_spans[sp_i]
        a_cur = asr_spans[ap_j]
        s_len = s_cur.orig_end - s_cur.orig_start
        a_len = a_cur.orig_end - a_cur.orig_start
        if not s_cur.is_number and not a_cur.is_number and s_len >= 2 and s_len == a_len:
            for sub in range(s_len - 1):
                src_boundary_to_asr[s_cur.orig_start + sub] = a_cur.orig_start + sub
        if idx_p + 1 < len(aligned_pairs):
            sp_next, ap_next = aligned_pairs[idx_p + 1]
            s_right = src_spans[sp_next]
            a_right = asr_spans[ap_next]
            i_b = s_cur.orig_end - 1
            j_b = a_cur.orig_end - 1
            if s_right.orig_start == i_b + 1 and a_right.orig_start == j_b + 1:
                src_boundary_to_asr[i_b] = j_b

    abbrev_stems = {
        "dr", "mr", "mrs", "ms", "prof", "rev", "gen", "sen", "rep", "st", "jr", "sr",
        "vs", "etc", "al", "eg", "ie", "am", "pm", "us", "uk", "usa", "eu", "tp", "ths", "ts", "pgs", "gs", "bs", "ks",
    }
    comma_cfg = max(0.0, min(5.0, float(punctuation_pauses.get("comma", 0.2) or 0.0)))
    period_cfg = max(0.0, min(5.0, float(punctuation_pauses.get("period", 0.6) or 0.0)))
    qe_cfg = max(0.0, min(5.0, float(punctuation_pauses.get("questionExclamation", 0.5) or 0.0)))
    cs_cfg = max(0.0, min(5.0, float(punctuation_pauses.get("colonSemicolon", 0.4) or 0.0)))

    total_dur = mono.size / float(sr)
    win_10ms = max(1, int(round(0.010 * sr)))
    planned_edits: list[dict[str, Any]] = []
    last_cut_sample = 0

    for i in range(len(source_words) - 1):
        delim = delimiters[i + 1] if (i + 1) < len(delimiters) else ""
        if not delim or not re.search(r"[,.;:!?…，、。；：！？]", delim):
            continue
        if major_already_split and re.search(r"[.!?…！？。]", delim) and not re.search(r"[,，、:;：；]", delim):
            continue
        j = src_boundary_to_asr.get(i)
        if j is None or j < 0 or j + 1 >= len(updated_words):
            continue
        if aq._is_numeric_scope_word(src_clean[i]) and aq._is_numeric_scope_word(src_clean[i + 1]):
            continue
        if "." in delim and not re.search(r"[,;:!?…]", delim):
            if src_clean[i] in abbrev_stems or re.match(r"^(?:[A-Za-z]\.){1,5}[A-Za-z]?$", source_words[i].strip()):
                continue

        # Determine punctuation category & target pause duration in seconds
        if re.search(r"[!?！？]", delim):
            p_kind = "questionExclamation"
            target_sec = qe_cfg
        elif re.search(r"[.…。]", delim):
            p_kind = "period"
            target_sec = period_cfg
        elif re.search(r"[:;：；]", delim):
            p_kind = "colonSemicolon"
            target_sec = cs_cfg
        else:
            p_kind = "comma"
            if comma_cfg <= 0.0:
                continue
            left_len = 1
            for k in range(i - 1, -1, -1):
                if aq.has_punctuation_boundary(delimiters[k + 1], source_words[k + 1]):
                    break
                left_len += 1
            right_len = 1
            for k in range(i + 1, len(source_words) - 1):
                if aq.has_punctuation_boundary(delimiters[k + 1], source_words[k + 1]):
                    break
                right_len += 1
            is_clause_conj = src_clean[i + 1] in (
                "but", "yet", "while", "though", "although", "whereas", "so", "for", "nor",
                "nhưng", "mà", "tuy", "dù", "vì", "nên", "song",
            )
            is_oxford_list = src_clean[i + 1] in ("and", "or", "va", "và", "hoặc") and any(
                "," in delimiters[k] for k in range(max(1, i - 4), i + 1)
            )
            is_clause_comma = (is_clause_conj and left_len >= 2 and right_len >= 2) or (
                left_len >= 3 and right_len >= 3 and not is_oxford_list
            )
            target_sec = comma_cfg if is_clause_comma else min(comma_cfg, max(0.10, 0.65 * comma_cfg))

        w_cur = updated_words[j]
        w_next = updated_words[j + 1]
        if min(float(w_cur.get("probability", 1.0)), float(w_next.get("probability", 1.0))) < 0.40:
            continue
        s1, e1 = float(w_cur.get("startSec", 0.0)), float(w_cur.get("endSec", 0.0))
        s2, e2 = float(w_next.get("startSec", 0.0)), float(w_next.get("endSec", 0.0))
        if e2 <= s1 or e1 > s2 + 0.08:
            continue

        guard_l = min(0.055, 0.32 * max(0.04, e1 - s1))
        guard_r = min(0.055, 0.32 * max(0.04, e2 - s2))
        win_lo = max(0.0, max(s1 + guard_l, e1 - 0.09))
        win_hi = min(total_dur, min(e2 - guard_r, max(e1, s2) + 0.09))
        if win_hi <= win_lo + 0.012:
            mid_b = 0.5 * (e1 + s2)
            win_lo = max(0.0, mid_b - 0.025)
            win_hi = min(total_dur, mid_b + 0.025)
        if win_hi <= win_lo + 0.008:
            continue

        # Reference local speech energy around the two words
        ref_lo = int(max(0.0, s1 - 0.10) * sr)
        ref_hi = int(min(total_dur, e2 + 0.10) * sr)
        ref_slice = mono[ref_lo:ref_hi]
        if ref_slice.size < win_10ms * 4:
            continue
        ref_frames = ref_slice[: (ref_slice.size // win_10ms) * win_10ms].reshape(-1, win_10ms)
        ref_rms = float(np.percentile(np.sqrt(np.mean(ref_frames * ref_frames, axis=1) + 1e-12), 90))
        quiet_ceil = max(0.008, min(0.014, 0.08 * ref_rms))

        b_lo_idx = int(round(win_lo * sr))
        b_hi_idx = int(round(win_hi * sr))
        b_seg = mono[b_lo_idx:b_hi_idx]
        n_bf = b_seg.size // win_10ms
        best_q_len = 0
        best_q_start = -1
        cur_q_len = 0
        cur_q_start = -1
        if n_bf >= 1:
            bf = b_seg[: n_bf * win_10ms].reshape(n_bf, win_10ms)
            bf_rms = np.sqrt(np.mean(bf * bf, axis=1) + 1e-12)
            bf_zcr = np.mean(np.abs(np.diff(np.signbit(bf), axis=1)), axis=1)
            for f_idx, (rv, zv) in enumerate(zip(bf_rms, bf_zcr)):
                is_fric = (rv >= 0.006 and zv >= 0.24) or (rv >= 0.001 and zv >= 0.42)
                if rv < quiet_ceil and not is_fric:
                    if cur_q_len == 0:
                        cur_q_start = f_idx
                    cur_q_len += 1
                    if cur_q_len > best_q_len:
                        best_q_len = cur_q_len
                        best_q_start = cur_q_start
                else:
                    cur_q_len = 0

        # Also include explicit timestamp gap if silence frames exceed win_lo..win_hi
        existing_pause_sec = best_q_len * 0.010
        if s2 > e1:
            gap_slice = mono[int(round(e1 * sr)) : int(round(s2 * sr))]
            if gap_slice.size >= win_10ms:
                gf = gap_slice[: (gap_slice.size // win_10ms) * win_10ms].reshape(-1, win_10ms)
                gf_rms = np.sqrt(np.mean(gf * gf, axis=1) + 1e-12)
                gf_zcr = np.mean(np.abs(np.diff(np.signbit(gf), axis=1)), axis=1)
                gf_fric = ((gf_rms >= 0.006) & (gf_zcr >= 0.24)) | ((gf_rms >= 0.001) & (gf_zcr >= 0.42))
                gap_quiet_sec = float(np.sum((gf_rms < quiet_ceil) & ~gf_fric)) * 0.010
                existing_pause_sec = max(existing_pause_sec, gap_quiet_sec)

        needed_sec = target_sec - existing_pause_sec
        if needed_sec >= 0.035:
            # Locate minimum-RMS point inside existing quiet valley or boundary transition
            if best_q_len >= 2 and best_q_start >= 0:
                q_mid_f = best_q_start + best_q_len // 2
                center_idx = b_lo_idx + q_mid_f * win_10ms + (win_10ms // 2)
            else:
                fine_w = max(4, int(round(0.006 * sr)))
                fine_hop = max(1, int(round(0.001 * sr)))
                if b_seg.size > fine_w:
                    min_e = float("inf")
                    best_off = b_seg.size // 2
                    for off in range(0, b_seg.size - fine_w + 1, fine_hop):
                        sub = b_seg[off : off + fine_w]
                        e_val = float(np.dot(sub, sub))
                        if e_val < min_e:
                            min_e = e_val
                            best_off = off + fine_w // 2
                    center_idx = b_lo_idx + best_off
                else:
                    center_idx = (b_lo_idx + b_hi_idx) // 2

            # Snap to nearest zero-crossing within ±3ms
            zc_rad = max(2, int(round(0.003 * sr)))
            z_lo = max(last_cut_sample + int(0.02 * sr), max(1, center_idx - zc_rad))
            z_hi = min(mono.size - 2, center_idx + zc_rad)
            if z_hi <= z_lo:
                continue
            cut_idx = center_idx
            best_zc_dist = zc_rad + 1
            for k_idx in range(z_lo, z_hi + 1):
                if mono[k_idx - 1] * mono[k_idx] <= 0.0:
                    d = abs(k_idx - center_idx)
                    if d < best_zc_dist:
                        best_zc_dist = d
                        cut_idx = k_idx
            if best_zc_dist > zc_rad:
                cut_idx = z_lo + int(np.argmin(np.abs(mono[z_lo : z_hi + 1])))

            delta_samples = int(round(needed_sec * sr))
            if delta_samples > 0 and cut_idx > last_cut_sample + int(0.02 * sr):
                planned_edits.append({
                    "mode": "insert",
                    "cutIdx": cut_idx,
                    "deltaSamples": delta_samples,
                    "asrIndex": j,
                    "kind": p_kind,
                    "targetSec": round(target_sec, 3),
                    "existingSec": round(existing_pause_sec, 3),
                })
                last_cut_sample = cut_idx
        elif existing_pause_sec - target_sec >= 0.18 and target_sec >= 0.05 and best_q_len >= 22 and best_q_start >= 0:
            # Safe dead-silence compaction when TTS left a huge pause far exceeding user's tight setting
            q_s_idx = b_lo_idx + (best_q_start + 3) * win_10ms
            q_e_idx = b_lo_idx + (best_q_start + best_q_len - 3) * win_10ms
            avail = q_e_idx - q_s_idx
            trim_samples = min(int(round((existing_pause_sec - target_sec) * sr)), max(0, avail - int(round(target_sec * sr))))
            if trim_samples >= int(round(0.08 * sr)) and q_s_idx > last_cut_sample + int(0.02 * sr):
                keep_left = (avail - trim_samples) // 2
                cut_s = q_s_idx + keep_left
                cut_e = cut_s + trim_samples
                planned_edits.append({
                    "mode": "trim",
                    "cutIdx": cut_s,
                    "cutEndIdx": cut_e,
                    "deltaSamples": -trim_samples,
                    "asrIndex": j,
                    "kind": p_kind,
                    "targetSec": round(target_sec, 3),
                    "existingSec": round(existing_pause_sec, 3),
                })
                last_cut_sample = cut_e

    if not planned_edits:
        return mono, updated_words, []

    # Assemble shaped waveform in a single linear pass with smooth 8ms raised-cosine tapers
    fade_n = max(2, int(round(0.008 * sr)))
    fade_in_curve = 0.5 * (1.0 - np.cos(np.pi * np.arange(fade_n, dtype=np.float32) / float(fade_n)))
    fade_out_curve = fade_in_curve[::-1]

    out_pieces: list[np.ndarray] = []
    cursor = 0
    for ed in planned_edits:
        if ed["mode"] == "insert":
            c_idx = int(ed["cutIdx"])
            d_samp = int(ed["deltaSamples"])
            seg = mono[cursor:c_idx].copy()
            if cursor > 0 and seg.size >= fade_n:
                seg[:fade_n] *= fade_in_curve
            if seg.size >= fade_n:
                seg[-fade_n:] *= fade_out_curve
            out_pieces.append(seg)
            out_pieces.append(np.zeros(d_samp, dtype=np.float32))
            cursor = c_idx
        else:
            c_s = int(ed["cutIdx"])
            c_e = int(ed["cutEndIdx"])
            seg = mono[cursor:c_s].copy()
            if cursor > 0 and seg.size >= fade_n:
                seg[:fade_n] *= fade_in_curve
            if seg.size >= fade_n:
                seg[-fade_n:] *= fade_out_curve
            out_pieces.append(seg)
            cursor = c_e

    tail = mono[cursor:].copy()
    if cursor > 0 and tail.size >= fade_n:
        tail[:fade_n] *= fade_in_curve
    out_pieces.append(tail)
    shaped_audio = np.concatenate(out_pieces) if out_pieces else mono

    # Shift updated_words timestamps accurately across all applied edits
    cum_shift = 0.0
    edit_ptr = 0
    for w_idx, w_obj in enumerate(updated_words):
        orig_s = float(w_obj.get("startSec", 0.0))
        orig_e = float(w_obj.get("endSec", orig_s))
        new_s = orig_s + cum_shift
        new_e = orig_e + cum_shift

        if edit_ptr < len(planned_edits) and planned_edits[edit_ptr]["asrIndex"] == w_idx:
            ed = planned_edits[edit_ptr]
            cut_sec = float(ed["cutIdx"]) / float(sr)
            delta_sec = float(ed["deltaSamples"]) / float(sr)
            if ed["mode"] == "insert":
                new_e = min(new_e, cut_sec + cum_shift)
                if new_e < new_s + 0.02:
                    new_e = max(new_s, cut_sec + cum_shift)
            cum_shift += delta_sec
            edit_ptr += 1
            # Ensure the immediately following word starts after the newly inserted silence
            if ed["mode"] == "insert" and w_idx + 1 < len(updated_words):
                nxt_orig_s = float(updated_words[w_idx + 1].get("startSec", cut_sec))
                if nxt_orig_s < cut_sec:
                    updated_words[w_idx + 1]["startSec"] = round(cut_sec, 3)

        w_obj["startSec"] = round(max(0.0, new_s), 3)
        w_obj["endSec"] = round(max(w_obj["startSec"], new_e), 3)

    return shaped_audio, updated_words, planned_edits


def enforce_punctuation_pauses(_m: str, params: dict[str, Any], ctx: RequestContext) -> dict[str, Any]:
    """Core sidecar handler (`audio.enforce_punctuation_pauses`) that enforces user-configured
    `punctuationPauses` (`comma`, `period`, `questionExclamation`, `colonSemicolon`) inside a synthesized
    chunk file (WAV or MP3) and caches the post-shaped ASR word alignment so immediate Post-QC
    validation reuses it in ~0ms without running Whisper twice.
    """
    import re
    from . import audio_quality as aq
    from .asr_engine import (
        AsrLifecycleManager,
        _is_cuda_runtime_error,
        find_whisper_model_dir,
        resolve_whisper_model_dir,
    )
    from .protocol import log

    audio_path = require(params, "audioPath", str)
    text = str(params.get("text") or "").strip()
    pauses = params.get("punctuationPauses")
    if not os.path.isfile(audio_path):
        raise SidecarError("INPUT_NOT_FOUND", f"audioPath not found: {os.path.basename(audio_path)}")

    mono, sr = _read_mono(audio_path)
    orig_dur = round(mono.size / float(sr), 3) if sr > 0 else 0.0
    _, edge_initial = attenuate_leading_breath_and_measure_edges(mono, sr)

    if not text or not isinstance(pauses, dict) or sr <= 0 or mono.size == 0:
        return {
            "shaped": False,
            "audioPath": audio_path,
            "durationSec": orig_dur,
            "sampleRate": sr,
            "leadingSilenceMs": edge_initial.get("leadingSilenceMs", 0),
            "trailingSilenceMs": edge_initial.get("trailingSilenceMs", 0),
            "editsCount": 0,
        }

    source_words, delimiters = aq.tokenize_text_with_delimiters(text)
    major_already_split = bool(params.get("majorAlreadySplit"))
    internal_delims = delimiters[1:-1] if len(delimiters) >= 3 else []
    if major_already_split:
        has_target_punct = any(re.search(r"[,，、:;：；]", d) for d in internal_delims)
    else:
        has_target_punct = any(re.search(r"[,.;:!?…，、。；：！？]", d) for d in internal_delims)

    if len(source_words) < 2 or not has_target_punct:
        return {
            "shaped": False,
            "audioPath": audio_path,
            "durationSec": orig_dur,
            "sampleRate": sr,
            "leadingSilenceMs": edge_initial.get("leadingSilenceMs", 0),
            "trailingSilenceMs": edge_initial.get("trailingSilenceMs", 0),
            "editsCount": 0,
        }

    language = params.get("language")
    eff_language = aq.resolve_script_language(text, language)
    lang_code = None if (not eff_language or eff_language == "auto") else eff_language
    speed = float(params.get("speed") or 1.0)
    models_dir = params.get("modelsDir")
    model_id = params.get("modelId") or params.get("asrModelId") or "large-v3-turbo"
    active_model_id = str(model_id)

    mgr_model_id: str | None = None
    precomputed = params.get("_precomputedAsrWords")
    detected_words: list[dict[str, Any]] = []
    if isinstance(precomputed, list) and precomputed:
        detected_words = aq.reanchor_asr_word_timestamps(
            [dict(w) for w in precomputed], mono, sr, text=text
        )
    else:
        target_model_dir, canonical_id = resolve_whisper_model_dir(model_id, models_dir)
        if not target_model_dir:
            target_model_dir = find_whisper_model_dir(models_dir, model_id)
        if not target_model_dir:
            return {
                "shaped": False,
                "reason": "asr_unavailable",
                "audioPath": audio_path,
                "durationSec": orig_dur,
                "sampleRate": sr,
                "leadingSilenceMs": edge_initial.get("leadingSilenceMs", 0),
                "trailingSilenceMs": edge_initial.get("trailingSilenceMs", 0),
                "editsCount": 0,
            }
        active_model_id = canonical_id or active_model_id
        ctx.check_cancelled()
        try:
            mgr = AsrLifecycleManager.get_instance()
            whisper_model = mgr.get_or_load(model_dir_or_id=target_model_dir, models_dir=models_dir)
            mgr_model_id = getattr(mgr, "current_model_id", None)
            qc_hotwords = aq.extract_qc_vocabulary_hotwords(text, language=eff_language)
            kw_extra: dict[str, Any] = {}
            if qc_hotwords:
                kw_extra["hotwords"] = qc_hotwords
            try:
                segs, _ = whisper_model.transcribe(
                    audio_path,
                    language=lang_code,
                    beam_size=5,
                    word_timestamps=True,
                    vad_filter=True,
                    vad_parameters=dict(min_silence_duration_ms=200),
                    condition_on_previous_text=False,
                    **kw_extra,
                )
                segs = list(segs)
            except TypeError:
                segs, _ = whisper_model.transcribe(
                    audio_path,
                    language=lang_code,
                    beam_size=5,
                    word_timestamps=True,
                    vad_filter=True,
                )
                segs = list(segs)
            except Exception as inf_err:
                if _is_cuda_runtime_error(inf_err):
                    whisper_model = mgr.get_or_load(
                        model_dir_or_id=target_model_dir,
                        models_dir=models_dir,
                        device="cpu",
                        compute_type="int8",
                    )
                    segs, _ = whisper_model.transcribe(
                        audio_path,
                        language=lang_code,
                        beam_size=5,
                        word_timestamps=True,
                        vad_filter=True,
                        condition_on_previous_text=False,
                    )
                    segs = list(segs)
                else:
                    raise

            for seg in segs:
                if getattr(seg, "words", None):
                    for w in seg.words:
                        detected_words.append({
                            "word": w.word,
                            "startSec": round(float(w.start), 3),
                            "endSec": round(float(w.end), 3),
                            "probability": round(float(w.probability), 4),
                            "tokenSource": "primary_asr",
                        })

            if detected_words:
                detected_words = aq.reanchor_asr_word_timestamps(detected_words, mono, sr, text=text)
                detected_words = aq.recover_unaligned_words(
                    audio_path,
                    detected_words,
                    orig_dur,
                    whisper_model,
                    language=eff_language,
                    slice_budget=[2],
                    audio_data=mono,
                    sample_rate=sr,
                )
        except Exception as e:
            log(f"[enforce_punctuation_pauses] ASR alignment skipped: {e}")
            return {
                "shaped": False,
                "reason": str(e),
                "audioPath": audio_path,
                "durationSec": orig_dur,
                "sampleRate": sr,
                "leadingSilenceMs": edge_initial.get("leadingSilenceMs", 0),
                "trailingSilenceMs": edge_initial.get("trailingSilenceMs", 0),
                "editsCount": 0,
            }

    if not detected_words:
        return {
            "shaped": False,
            "audioPath": audio_path,
            "durationSec": orig_dur,
            "sampleRate": sr,
            "leadingSilenceMs": edge_initial.get("leadingSilenceMs", 0),
            "trailingSilenceMs": edge_initial.get("trailingSilenceMs", 0),
            "editsCount": 0,
        }

    shaped_audio, updated_words, edits = shape_internal_punctuation_pauses(
        mono, sr, text, pauses, detected_words, speed=speed, major_already_split=major_already_split
    )

    if edits:
        out_fmt = "mp3" if audio_path.lower().endswith(".mp3") else "wav"
        write_audio_atomic(audio_path, shaped_audio, sr=sr, fmt=out_fmt)
        final_dur = round(shaped_audio.size / float(sr), 3)
        _, edge_final = attenuate_leading_breath_and_measure_edges(shaped_audio, sr)
    else:
        final_dur = orig_dur
        edge_final = edge_initial

    # Cache primary ASR words against the final file on disk so immediate Post-QC skips primary Whisper
    aq.cache_primary_asr_words(audio_path, active_model_id, lang_code, updated_words)
    if str(model_id) != active_model_id:
        aq.cache_primary_asr_words(audio_path, str(model_id), lang_code, updated_words)
    if mgr_model_id and mgr_model_id not in {active_model_id, str(model_id)}:
        aq.cache_primary_asr_words(audio_path, mgr_model_id, lang_code, updated_words)

    return {
        "shaped": bool(edits),
        "audioPath": audio_path,
        "durationSec": final_dur,
        "sampleRate": sr,
        "leadingSilenceMs": edge_final.get("leadingSilenceMs", 0),
        "trailingSilenceMs": edge_final.get("trailingSilenceMs", 0),
        "editsCount": len(edits),
        "edits": edits,
    }


