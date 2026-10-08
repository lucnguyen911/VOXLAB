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
) -> list[dict[str, Any]]:
    """Analyzes ASR words with timestamps against source text to identify abnormal pauses and anomalies."""
    issues: list[dict[str, Any]] = []
    if not text.strip() or not asr_words:
        return issues

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

    # 2. Tokenize source text
    source_words, delimiters = tokenize_text_with_delimiters(text)
    source_words_clean = [clean_word(w) for w in source_words]
    asr_words_clean = [clean_word(w.get("word", "")) for w in asr_words]

    # 3. Align source words and ASR words using SequenceMatcher
    matcher = difflib.SequenceMatcher(None, source_words_clean, asr_words_clean)
    matching_blocks = matcher.get_matching_blocks()

    # Map each ASR word index to its matching source word index
    asr_to_source: dict[int, int] = {}
    for block in matching_blocks:
        for offset in range(block.size):
            asr_to_source[block.b + offset] = block.a + offset

    # 4. Check for abnormal pauses between consecutive ASR words
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
            # Check delimiters between src_idx1 and src_idx2 in source text
            # delimiters[k] is before source_words[k], so delimiters between src_idx1 and src_idx2
            # are delimiters[src_idx1 + 1] through delimiters[src_idx2]
            combined_delimiter = "".join(delimiters[k] for k in range(src_idx1 + 1, src_idx2 + 1))
            if has_punctuation_boundary(combined_delimiter):
                is_natural_pause = True
        else:
            # Fallback heuristic: check if w1 or w2 in raw ASR string has trailing/leading punctuation
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

    return issues


def validate_audio_quality(
    audio_path: str,
    text: str,
    language: str | None = None,
    models_dir: str | None = None,
    force_skip_whisper: bool = False,
) -> dict[str, Any]:
    """Complete audio quality validation pipeline.
    Returns:
    {
        "status": "pass" | "warning" | "error" | "unverified",
        "issues": list[dict],
        "summary": str,
        "durationSec": float,
        "sampleRate": int,
        "checkedAt": float,
        "audioPath": str,
    }
    """
    checked_at = time.time()

    # Step 1: Technical Audio Validation
    valid, tech_issues, info = validate_audio_file(audio_path, text)
    if not valid:
        summary = tech_issues[0]["message"] if tech_issues else "Lỗi tệp âm thanh"
        return {
            "status": "error",
            "issues": tech_issues,
            "summary": summary,
            "durationSec": info.get("durationSec", 0.0),
            "sampleRate": info.get("sampleRate", 0),
            "checkedAt": checked_at,
            "audioPath": audio_path,
        }

    # Step 2: Speech Alignment & Prosody Validation
    if force_skip_whisper:
        return {
            "status": "unverified",
            "issues": [],
            "summary": "Chưa kiểm chứng (không sử dụng mô hình ASR cục bộ)",
            "durationSec": info.get("durationSec", 0.0),
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
            "summary": "Chưa kiểm chứng (không tìm thấy mô hình faster-whisper cục bộ)",
            "durationSec": info.get("durationSec", 0.0),
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
            "summary": "Chưa kiểm chứng (không thể khởi tạo mô hình ASR)",
            "durationSec": info.get("durationSec", 0.0),
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

        alignment_issues = analyze_word_alignment_issues(text, detected_words)

        if alignment_issues:
            return {
                "status": "warning",
                "issues": alignment_issues,
                "summary": alignment_issues[0]["message"],
                "durationSec": info.get("durationSec", 0.0),
                "sampleRate": info.get("sampleRate", 0),
                "checkedAt": checked_at,
                "audioPath": audio_path,
            }

        return {
            "status": "pass",
            "issues": [],
            "summary": "Đạt",
            "durationSec": info.get("durationSec", 0.0),
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
            "summary": f"Chưa kiểm chứng (lỗi phân tích giọng nói: {e})",
            "durationSec": info.get("durationSec", 0.0),
            "sampleRate": info.get("sampleRate", 0),
            "checkedAt": checked_at,
            "audioPath": audio_path,
        }
