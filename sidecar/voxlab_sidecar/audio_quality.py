"""Audio quality validation and abnormal pause/glitch detection for VoxLab.

Differentiates between:
- Error (Red): synthesis failure, 0 bytes, missing file, corrupted WAV, total silence, or duration mismatch.
- Warning (Yellow): valid audio, but suspicious unnatural pause (e.g. 'diesel | fuel' where text has no punctuation),
  possible word skipping or excessive repetition requiring listening review.
- Unverified (Neutral): valid audio, but ASR / alignment model is not available locally.
- Pass: valid audio, verified with speech alignment, no anomalies detected.
"""
from __future__ import annotations

import difflib
import os
import re
import time
from typing import Any

import numpy as np

from .protocol import log


PUNCTUATION_CHARS = set(".,!?;:—–-…()[]\"'“”„«»¿¡")

VI_MINOR_STOPWORDS = {
    "và", "của", "là", "thì", "mà", "cho", "ở", "với", "nhưng", "đã", "đang", "sẽ",
    "được", "bị", "các", "những", "một", "về", "trong", "có", "này", "đó", "ra", "vào"
}
EN_MINOR_STOPWORDS = {
    "the", "a", "an", "and", "or", "of", "in", "on", "at", "to", "for", "with", "by",
    "is", "are", "was", "were", "it", "its", "that", "this", "be", "as"
}
IGNORED_OMISSION_WORDS = VI_MINOR_STOPWORDS | EN_MINOR_STOPWORDS


def validate_audio_file(audio_path: str, expected_text: str | None = None) -> tuple[bool, list[dict[str, Any]], dict[str, Any]]:
    """Technical audio validation. Returns (is_valid, error_issues, audio_info)."""
    issues: list[dict[str, Any]] = []
    info: dict[str, Any] = {
        "durationSec": 0.0,
        "sampleRate": 0,
        "channels": 0,
        "rms": 0.0,
        "peak": 0.0,
    }

    if not audio_path or not os.path.exists(audio_path):
        issues.append({
            "severity": "error",
            "code": "FILE_NOT_FOUND",
            "message": "Không tìm thấy tệp âm thanh hoặc tệp đã bị xóa.",
        })
        return False, issues, info

    try:
        size = os.path.getsize(audio_path)
    except Exception as e:
        issues.append({
            "severity": "error",
            "code": "FILE_ACCESS_ERROR",
            "message": f"Không thể đọc thông tin tệp: {e}",
        })
        return False, issues, info

    if size == 0:
        issues.append({
            "severity": "error",
            "code": "FILE_EMPTY",
            "message": "Tệp âm thanh rỗng (0 bytes).",
        })
        return False, issues, info

    import soundfile as sf

    try:
        snd_info = sf.info(audio_path)
        info["durationSec"] = round(float(snd_info.duration), 3)
        info["sampleRate"] = int(snd_info.samplerate)
        info["channels"] = int(snd_info.channels)
    except Exception as e:
        issues.append({
            "severity": "error",
            "code": "FILE_CORRUPTED",
            "message": f"Tệp âm thanh bị hỏng hoặc định dạng không hợp lệ: {e}",
        })
        return False, issues, info

    if info["durationSec"] < 0.2:
        issues.append({
            "severity": "error",
            "code": "DURATION_TOO_SHORT",
            "message": f"Thời lượng âm thanh quá ngắn ({info['durationSec']:.2f}s < 0.2s), nghi ngờ tạo bị ngắt quãng.",
        })
        return False, issues, info

    try:
        data, _ = sf.read(audio_path, dtype="float32", always_2d=True)
        mono = data.mean(axis=1)
        peak = float(np.max(np.abs(mono))) if mono.size > 0 else 0.0
        rms = float(np.sqrt(np.mean(mono ** 2))) if mono.size > 0 else 0.0
        info["peak"] = round(peak, 4)
        info["rms"] = round(rms, 6)

        # Silent audio check (RMS < 1e-4 is approx -80 dBFS)
        if peak < 1e-4 or rms < 1e-4:
            issues.append({
                "severity": "error",
                "code": "AUDIO_SILENT",
                "message": "Tệp âm thanh hoàn toàn im lặng, không có tín hiệu giọng nói.",
            })
            return False, issues, info
    except Exception as e:
        issues.append({
            "severity": "error",
            "code": "READ_ERROR",
            "message": f"Không thể đọc mẫu âm thanh: {e}",
        })
        return False, issues, info

    # Check text-duration reasonableness
    if expected_text:
        words = expected_text.strip().split()
        if len(words) >= 15 and info["durationSec"] < 0.8:
            issues.append({
                "severity": "error",
                "code": "DURATION_MISMATCH_SEVERE",
                "message": f"Thời lượng âm thanh ({info['durationSec']:.2f}s) quá ngắn so với số lượng từ ({len(words)} từ).",
            })
            return False, issues, info

    return True, issues, info


def tokenize_text_with_delimiters(text: str) -> tuple[list[str], list[str]]:
    """Extract words and the delimiters between them.
    delimiters[i] contains characters between words[i-1] and words[i].
    delimiters[0] is text before words[0].
    """
    words: list[str] = []
    delimiters: list[str] = []
    last_end = 0

    # Match letters, digits, accents
    for m in re.finditer(r"[\w\u00C0-\u1EF9]+", text):
        delimiters.append(text[last_end:m.start()])
        words.append(m.group(0))
        last_end = m.end()

    delimiters.append(text[last_end:])
    return words, delimiters


def has_punctuation_boundary(delimiter: str) -> bool:
    """Checks whether the delimiter between words contains any punctuation mark."""
    return any(c in PUNCTUATION_CHARS for c in delimiter)


def clean_word(word: str) -> str:
    """Strip whitespace and punctuation for string comparison."""
    return re.sub(r"[^\w\u00C0-\u1EF9]", "", word).lower()


def analyze_word_alignment_issues(
    text: str,
    asr_words: list[dict[str, Any]],
    min_abnormal_pause_sec: float = 0.50,
    speed: float = 1.0,
    language: str | None = None,
    audio_duration_sec: float = 0.0,
    return_metrics: bool = False,
) -> list[dict[str, Any]] | tuple[list[dict[str, Any]], dict[str, Any]]:
    """Analyzes ASR words with timestamps against source text to identify:
    - Abnormal pauses between unpunctuated words (ABNORMAL_PAUSE)
    - Consecutive rapid/merged words lacking acoustic transition (CROWDED_WORDS)
    - Unusually rushed overall pace (RAPID_PACE)
    - Missing meaningful words bounded by fast transitions (POSSIBLE_OMISSION)
    - Severe word repetitions (REPEATED_WORDS)
    """
    issues: list[dict[str, Any]] = []

    source_words, delimiters = tokenize_text_with_delimiters(text)
    n_src = len(source_words)
    total_dur = float(audio_duration_sec)
    if total_dur <= 0 and asr_words:
        total_dur = float(asr_words[-1].get("endSec", 0.0))

    raw_wpm = (n_src / total_dur * 60.0) if total_dur > 0 and n_src > 0 else 0.0
    eff_speed = float(speed) if (speed and float(speed) > 0) else 1.0
    effective_wpm = raw_wpm / eff_speed

    durations = [
        float(w.get("endSec", 0.0)) - float(w.get("startSec", 0.0))
        for w in asr_words
        if float(w.get("endSec", 0.0)) > float(w.get("startSec", 0.0))
    ]
    pace_variance = float(np.var(durations)) if len(durations) > 1 else 0.0

    metrics: dict[str, Any] = {
        "wpm": round(effective_wpm, 1),
        "rawWpm": round(raw_wpm, 1),
        "paceVariance": round(pace_variance, 4),
        "detectedWordsCount": len(asr_words),
        "sourceWordsCount": n_src,
    }

    if not text.strip() or not asr_words:
        return (issues, metrics) if return_metrics else issues

    # 1. Check for severe word repetition in ASR words (hallucination loop)
    consecutive_repeat_count = 1
    last_word_clean = ""
    for w in asr_words:
        w_clean = clean_word(w.get("word", ""))
        if not w_clean:
            continue
        if w_clean == last_word_clean:
            consecutive_repeat_count += 1
            if consecutive_repeat_count == 4:
                issues.append({
                    "severity": "warning",
                    "code": "REPEATED_WORDS",
                    "message": f"Phát hiện khả năng lặp từ bất thường: '{w_clean}'. Vui lòng nghe lại đoạn này.",
                    "words": [w_clean, w_clean],
                    "timeRange": [w.get("startSec", 0.0), w.get("endSec", 0.0)],
                })
        else:
            consecutive_repeat_count = 1
            last_word_clean = w_clean

    # 2. Check for overall rushing pace (RAPID_PACE)
    is_vietnamese = (language == "vi") or bool(re.search(r"[\u00C0-\u1EF9]", text))
    rapid_threshold = 290.0 if is_vietnamese else 240.0
    if total_dur >= 2.0 and n_src >= 6 and effective_wpm > rapid_threshold:
        issues.append({
            "severity": "warning",
            "code": "RAPID_PACE",
            "message": (
                f"Cảnh báo: Tốc độ đọc dồn dập bất thường ({int(round(effective_wpm))} từ/phút). "
                f"Vui lòng nghe lại hoặc bật Tối ưu độ rõ giọng đọc."
            ),
            "wpm": round(effective_wpm, 1),
            "timeRange": [0.0, round(total_dur, 3)],
        })

    # 3. Align source words and ASR words using SequenceMatcher
    source_words_clean = [clean_word(w) for w in source_words]
    asr_words_clean = [clean_word(w.get("word", "")) for w in asr_words]

    matcher = difflib.SequenceMatcher(None, source_words_clean, asr_words_clean)
    matching_blocks = matcher.get_matching_blocks()

    asr_to_source: dict[int, int] = {}
    for block in matching_blocks:
        for offset in range(block.size):
            asr_to_source[block.b + offset] = block.a + offset

    # 4. Check for crowded/merged words (CROWDED_WORDS: 3+ consecutive words with gap <= 0.02s and dur < 0.09s)
    crowded_group: list[int] = []

    def _record_crowded(indices: list[int]) -> None:
        if len(indices) < 3:
            return
        src_indices = [asr_to_source.get(k) for k in indices if asr_to_source.get(k) is not None]
        for si in range(len(src_indices) - 1):
            idx_a, idx_b = src_indices[si], src_indices[si + 1]
            if idx_b > idx_a:
                delims = "".join(delimiters[idx_a + 1 : idx_b + 1])
                if "-" in delims or "—" in delims or "–" in delims:
                    return

        words_text = [asr_words[k].get("word", "").strip() for k in indices]
        joined_words = " ".join(words_text)
        t_start = float(asr_words[indices[0]].get("startSec", 0.0))
        t_end = float(asr_words[indices[-1]].get("endSec", 0.0))
        issues.append({
            "severity": "warning",
            "code": "CROWDED_WORDS",
            "message": (
                f"Cảnh báo: Phát hiện các từ bị dính vào nhau không có khoảng chuyển tiếp tự nhiên ('{joined_words}'). "
                f"Vui lòng nghe lại hoặc bật Tối ưu độ rõ giọng đọc."
            ),
            "words": [clean_word(words_text[0]), clean_word(words_text[-1])],
            "timeRange": [round(t_start, 3), round(t_end, 3)],
        })

    for idx, w in enumerate(asr_words):
        w_dur = float(w.get("endSec", 0.0)) - float(w.get("startSec", 0.0))
        w_prob = float(w.get("probability", 1.0))
        if w_dur < 0.09 and w_prob >= 0.50:
            if not crowded_group:
                crowded_group.append(idx)
            else:
                prev_w = asr_words[crowded_group[-1]]
                w_gap = float(w.get("startSec", 0.0)) - float(prev_w.get("endSec", 0.0))
                if w_gap <= 0.02:
                    crowded_group.append(idx)
                else:
                    _record_crowded(crowded_group)
                    crowded_group = [idx]
        else:
            _record_crowded(crowded_group)
            crowded_group = []

    _record_crowded(crowded_group)

    # 5. Check for abnormal pauses between consecutive ASR words
    for i in range(len(asr_words) - 1):
        w1 = asr_words[i]
        w2 = asr_words[i + 1]

        end1 = float(w1.get("endSec", 0.0))
        start2 = float(w2.get("startSec", 0.0))
        gap = start2 - end1

        if gap < min_abnormal_pause_sec:
            continue

        w1_prob = float(w1.get("probability", 1.0))
        w2_prob = float(w2.get("probability", 1.0))

        # Only evaluate confident speech detections
        if min(w1_prob, w2_prob) < 0.35:
            continue

        w1_text = clean_word(w1.get("word", ""))
        w2_text = clean_word(w2.get("word", ""))
        if not w1_text or not w2_text:
            continue

        src_idx1 = asr_to_source.get(i)
        src_idx2 = asr_to_source.get(i + 1)

        # Check if these two words appear consecutively or close together in source text
        is_natural_pause = False

        if src_idx1 is not None and src_idx2 is not None and src_idx2 > src_idx1:
            combined_delimiter = "".join(delimiters[k] for k in range(src_idx1 + 1, src_idx2 + 1))
            if has_punctuation_boundary(combined_delimiter):
                is_natural_pause = True
        else:
            raw_w1 = w1.get("word", "")
            raw_w2 = w2.get("word", "")
            if any(c in PUNCTUATION_CHARS for c in raw_w1) or any(c in PUNCTUATION_CHARS for c in raw_w2):
                is_natural_pause = True

        if not is_natural_pause:
            issues.append({
                "severity": "warning",
                "code": "ABNORMAL_PAUSE",
                "message": (
                    f"Cảnh báo: Phát hiện khoảng ngắt có thể bất thường giữa '{w1_text}' và '{w2_text}' "
                    f"({gap:.2f}s). Vui lòng nghe lại đoạn này."
                ),
                "words": [w1_text, w2_text],
                "timeRange": [round(end1, 3), round(start2, 3)],
            })

    # 6. Check for possible omitted words (POSSIBLE_OMISSION)
    for b_idx in range(len(matching_blocks) - 1):
        block_curr = matching_blocks[b_idx]
        block_next = matching_blocks[b_idx + 1]

        end_src = block_curr.a + block_curr.size
        start_src = block_next.a

        if start_src > end_src:
            if block_curr.size > 0 and block_next.b < len(asr_words):
                idx_prev_asr = block_curr.b + block_curr.size - 1
                idx_next_asr = block_next.b
                w_prev = asr_words[idx_prev_asr]
                w_next = asr_words[idx_next_asr]
                p_prev = float(w_prev.get("probability", 1.0))
                p_next = float(w_next.get("probability", 1.0))
                t_end_prev = float(w_prev.get("endSec", 0.0))
                t_start_next = float(w_next.get("startSec", 0.0))
                gap_omission = t_start_next - t_end_prev

                if p_prev >= 0.65 and p_next >= 0.65 and gap_omission < 0.12:
                    for src_pos in range(end_src, start_src):
                        missing_word = source_words[src_pos]
                        m_clean = clean_word(missing_word)
                        if len(m_clean) >= 4 and m_clean not in IGNORED_OMISSION_WORDS:
                            issues.append({
                                "severity": "warning",
                                "code": "POSSIBLE_OMISSION",
                                "message": (
                                    f"Cảnh báo: Nghi vấn nuốt từ hoặc phát âm không đầy đủ tại '{m_clean}'. "
                                    f"Vui lòng nghe lại đoạn này."
                                ),
                                "words": [m_clean],
                                "timeRange": [round(t_end_prev, 3), round(t_start_next, 3)],
                            })

    return (issues, metrics) if return_metrics else issues


def validate_audio_quality(
    audio_path: str,
    text: str,
    language: str | None = None,
    models_dir: str | None = None,
    speed: float = 1.0,
    force_skip_whisper: bool = False,
) -> dict[str, Any]:
    """Complete audio quality validation pipeline.
    Returns:
    {
        "status": "pass" | "warning" | "error" | "unverified",
        "issues": list[dict],
        "metrics": dict,
        "summary": str,
        "durationSec": float,
        "sampleRate": int,
        "checkedAt": float,
        "audioPath": str,
    }
    """
    checked_at = time.time()
    source_words, _ = tokenize_text_with_delimiters(text) if text else ([], [])
    n_src = len(source_words)
    eff_speed = float(speed) if (speed and float(speed) > 0) else 1.0

    # Step 1: Technical Audio Validation
    valid, tech_issues, info = validate_audio_file(audio_path, text)
    dur = float(info.get("durationSec", 0.0))
    raw_wpm = (n_src / dur * 60.0) if dur > 0 and n_src > 0 else 0.0

    default_metrics = {
        "wpm": round(raw_wpm / eff_speed, 1),
        "rawWpm": round(raw_wpm, 1),
        "paceVariance": 0.0,
        "detectedWordsCount": 0,
        "sourceWordsCount": n_src,
    }

    if not valid:
        summary = tech_issues[0]["message"] if tech_issues else "Lỗi tệp âm thanh"
        return {
            "status": "error",
            "issues": tech_issues,
            "metrics": default_metrics,
            "summary": summary,
            "durationSec": dur,
            "sampleRate": info.get("sampleRate", 0),
            "checkedAt": checked_at,
            "audioPath": audio_path,
        }

    # Step 2: Speech Alignment & Prosody Validation
    if force_skip_whisper:
        return {
            "status": "unverified",
            "issues": [],
            "metrics": default_metrics,
            "summary": "Chưa kiểm chứng (không sử dụng mô hình ASR cục bộ)",
            "durationSec": dur,
            "sampleRate": info.get("sampleRate", 0),
            "checkedAt": checked_at,
            "audioPath": audio_path,
        }

    from .asr_engine import find_whisper_model_dir

    model_dir = find_whisper_model_dir(models_dir)
    if not model_dir:
        return {
            "status": "unverified",
            "issues": [],
            "metrics": default_metrics,
            "summary": "Chưa kiểm chứng (không tìm thấy mô hình faster-whisper cục bộ)",
            "durationSec": dur,
            "sampleRate": info.get("sampleRate", 0),
            "checkedAt": checked_at,
            "audioPath": audio_path,
        }

    # Use shared whisper instance for zero-overhead validation
    try:
        from .asr_engine import get_shared_whisper_model

        whisper_model = get_shared_whisper_model(models_dir)
    except Exception as e:
        log(f"[audio_quality] Cannot load whisper model: {e}")
        whisper_model = None

    if whisper_model is None:
        return {
            "status": "unverified",
            "issues": [],
            "metrics": default_metrics,
            "summary": "Chưa kiểm chứng (không thể khởi tạo mô hình ASR)",
            "durationSec": dur,
            "sampleRate": info.get("sampleRate", 0),
            "checkedAt": checked_at,
            "audioPath": audio_path,
        }

    try:
        lang_code = None if not language or language == "auto" else language
        segments_iter, _ = whisper_model.transcribe(
            audio_path,
            language=lang_code,
            beam_size=5,
            word_timestamps=True,
            vad_filter=True,
        )

        detected_words: list[dict[str, Any]] = []
        for seg in segments_iter:
            if seg.words:
                for w in seg.words:
                    detected_words.append({
                        "word": w.word,
                        "startSec": round(float(w.start), 3),
                        "endSec": round(float(w.end), 3),
                        "probability": round(float(w.probability), 4),
                    })

        alignment_issues, metrics = analyze_word_alignment_issues(
            text,
            detected_words,
            speed=speed,
            language=language,
            audio_duration_sec=dur,
            return_metrics=True,
        )

        if alignment_issues:
            return {
                "status": "warning",
                "issues": alignment_issues,
                "metrics": metrics,
                "summary": alignment_issues[0]["message"],
                "durationSec": dur,
                "sampleRate": info.get("sampleRate", 0),
                "checkedAt": checked_at,
                "audioPath": audio_path,
            }

        return {
            "status": "pass",
            "issues": [],
            "metrics": metrics,
            "summary": "Đạt",
            "durationSec": dur,
            "sampleRate": info.get("sampleRate", 0),
            "checkedAt": checked_at,
            "audioPath": audio_path,
        }
    except Exception as e:
        log(f"[audio_quality] Validation error on {audio_path}: {e}")
        # Failure in ASR check does NOT break or discard the audio
        return {
            "status": "unverified",
            "issues": [],
            "metrics": default_metrics,
            "summary": f"Chưa kiểm chứng (lỗi phân tích giọng nói: {e})",
            "durationSec": dur,
            "sampleRate": info.get("sampleRate", 0),
            "checkedAt": checked_at,
            "audioPath": audio_path,
        }
