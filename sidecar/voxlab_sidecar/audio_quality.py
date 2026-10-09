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

NUMBER_WORDS = {
    "0": {"zero", "o", "khong", "không"},
    "1": {"one", "mot", "một", "mốt"},
    "2": {"two", "hai"},
    "3": {"three", "ba"},
    "4": {"four", "bon", "bốn", "tư"},
    "5": {"five", "nam", "năm", "lăm"},
    "6": {"six", "sau", "sáu"},
    "7": {"seven", "bay", "bảy"},
    "8": {"eight", "tam", "tám"},
    "9": {"nine", "chin", "chín"},
    "10": {"ten", "muoi", "mười"},
    "100": {"hundred", "tram", "trăm"},
    "1000": {"thousand", "nghin", "nghìn", "ngàn"},
    "1000000": {"million", "trieu", "triệu"},
    "1000000000": {"billion", "ty", "tỷ"},
}

CONTRACTIONS = {
    "cant": "cannot", "can't": "cannot",
    "wont": "willnot", "won't": "willnot",
    "dont": "donot", "don't": "donot",
    "didnt": "didnot", "didn't": "didnot",
    "isnt": "isnot", "isn't": "isnot",
    "arent": "arenot", "aren't": "arenot",
    "gonna": "goingto", "wanna": "wantto", "gotta": "gotto",
    "cuz": "because", "cause": "because", "ok": "okay",
    "theyre": "theyare", "they're": "theyare",
    "we're": "weare",
}


def format_timestamp(seconds: float) -> str:
    """Format seconds into MM:SS for user-facing audio review timestamps."""
    total_seconds = max(0, int(seconds))
    minutes = total_seconds // 60
    secs = total_seconds % 60
    return f"{minutes:02d}:{secs:02d}"


def phonetic_key(word: str) -> str:
    """Simplified phonetic normalization for homophone and sound-alike matching."""
    w = word.lower()
    w = re.sub(r"ph", "f", w)
    w = re.sub(r"c([eiy])", r"s\1", w)
    w = re.sub(r"ck", "k", w)
    w = re.sub(r"q", "k", w)
    w = re.sub(r"x", "ks", w)
    w = re.sub(r"wr", "r", w)
    w = re.sub(r"kn", "n", w)
    w = re.sub(r"y", "i", w)
    w = re.sub(r"ou", "o", w)
    w = re.sub(r"re$", "er", w)
    w = re.sub(r"c", "k", w)
    w = re.sub(r"(.)\1+", r"\1", w)
    return w


def levenshtein_dist(s1: str, s2: str) -> int:
    """Levenshtein edit distance between two strings."""
    if s1 == s2:
        return 0
    if len(s1) < len(s2):
        return levenshtein_dist(s2, s1)
    if len(s2) == 0:
        return len(s1)
    prev = list(range(len(s2) + 1))
    for i, c1 in enumerate(s1):
        curr = [i + 1]
        for j, c2 in enumerate(s2):
            insertions = prev[j + 1] + 1
            deletions = curr[j] + 1
            substitutions = prev[j] + (c1 != c2)
            curr.append(min(insertions, deletions, substitutions))
        prev = curr
    return prev[-1]


def strip_diacritics(text: str) -> str:
    """Strips Vietnamese and Latin accents/diacritics for phonetic and root comparison."""
    import unicodedata
    normalized = unicodedata.normalize("NFD", text)
    stripped = "".join(c for c in normalized if unicodedata.category(c) != "Mn")
    return stripped.replace("đ", "d").replace("Đ", "d").lower()


def is_likely_proper_noun(source_words: list[str], delimiters: list[str], idx: int) -> bool:
    """Checks if the word at idx is likely a proper noun (capitalized, not at sentence start)."""
    if idx < 0 or idx >= len(source_words):
        return False
    w = source_words[idx]
    if not w or not w[0].isupper():
        return False
    if idx == 0:
        return False
    prev_delim = delimiters[idx] if idx < len(delimiters) else ""
    if any(c in ".!?:;" for c in prev_delim):
        return False
    return True


def extract_context_span(source_words: list[str], i1: int, i2: int) -> str:
    """Extracts a natural context span around the suspicious word indices [i1, i2).
    For a single word (i2 - i1 == 1), includes 1 word before and 1 word after.
    For multiple words (i2 - i1 >= 2), includes the suspicious words plus 1 word after for natural phrasing.
    Example:
    source: ["rapid", "response", "mobile", "service"] with i1=1, i2=3
    returns: "response mobile service"
    """
    n = len(source_words)
    if n == 0:
        return ""
    if i2 - i1 <= 1:
        s = max(0, i1 - 1)
        e = min(n, i2 + 1)
    else:
        s = i1
        e = min(n, i2 + 1)
        if e == n and s > 0:
            s = max(0, s - 1)
    return " ".join(source_words[s:e])


def are_words_equivalent(w1: str, w2: str) -> bool:
    """Checks whether two words are orthographically, phonetically, or numerically equivalent."""
    if w1 == w2:
        return True
    c1 = CONTRACTIONS.get(w1, w1)
    c2 = CONTRACTIONS.get(w2, w2)
    if c1 == c2:
        return True
    for num, words in NUMBER_WORDS.items():
        if (w1 == num and w2 in words) or (w2 == num and w1 in words):
            return True
        if w1 in words and w2 in words:
            return True
    if phonetic_key(w1) == phonetic_key(w2):
        return True
    if strip_diacritics(w1) == strip_diacritics(w2):
        return True
    if len(w1) >= 4 and len(w2) >= 4 and levenshtein_dist(w1, w2) <= 1:
        return True
    return False


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
    - Suspected stutter / syllable repetition / adjacent repeats (SUSPECTED_STUTTER)
    - Unintended word repetition (REPEATED_WORD)
    - Meaningful words swallowed / omitted (MISSING_WORD)
    - Extra words detected with high confidence not in script (EXTRA_WORD)
    - Abnormal pauses between unpunctuated words (ABNORMAL_PAUSE)
    - Consecutive rapid/merged words lacking acoustic transition (CROWDED_WORDS)
    - Unusually rushed overall pace (RAPID_PACE)
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

    # 1. Check for overall rushing pace (RAPID_PACE)
    is_vietnamese = (language == "vi") or bool(re.search(r"[\u00C0-\u1EF9]", text))
    rapid_threshold = 290.0 if is_vietnamese else 240.0
    if total_dur >= 2.0 and n_src >= 6 and effective_wpm > rapid_threshold:
        issues.append({
            "severity": "warning",
            "code": "RAPID_PACE",
            "message": (
                f"Cảnh báo: Tốc độ đọc dồn dập bất thường ({int(round(effective_wpm))} từ/phút). "
                f"Vui lòng nghe lại."
            ),
            "wpm": round(effective_wpm, 1),
            "timeRange": [0.0, round(total_dur, 3)],
        })

    # Prepare cleaned word lists
    source_words_clean = [clean_word(w) for w in source_words]
    asr_words_clean = [clean_word(w.get("word", "")) for w in asr_words]

    matcher = difflib.SequenceMatcher(None, source_words_clean, asr_words_clean)
    opcodes = matcher.get_opcodes()

    # Track ASR to source alignment for delimiter & pause checks
    asr_to_source: dict[int, int] = {}
    for tag, i1, i2, j1, j2 in opcodes:
        if tag == "equal":
            for offset in range(i2 - i1):
                asr_to_source[j1 + offset] = i1 + offset
        elif tag == "replace":
            # If phonetically / semantically equivalent, map them
            if (i2 - i1) == (j2 - j1):
                for offset in range(i2 - i1):
                    s_w = source_words_clean[i1 + offset]
                    a_w = asr_words_clean[j1 + offset]
                    if are_words_equivalent(s_w, a_w):
                        asr_to_source[j1 + offset] = i1 + offset

    # 2. Check opcodes for Stutter, Repetition, Missing Word, and Extra Word
    for tag, i1, i2, j1, j2 in opcodes:
        if tag == "insert":
            # Extra words in ASR not present in source text
            for j in range(j1, j2):
                w_obj = asr_words[j]
                w_clean = asr_words_clean[j]
                if not w_clean:
                    continue
                p = float(w_obj.get("probability", 1.0))
                t_end = float(w_obj.get("endSec", 0.0))

                # Check if it's an orthographic split (e.g. source: cannot -> ASR: can not)
                if j > 0 and i1 > 0:
                    prev_asr = asr_words_clean[j - 1]
                    prev_src = source_words_clean[i1 - 1]
                    if prev_asr + w_clean == prev_src:
                        continue

                prev_w = asr_words_clean[j - 1] if j > 0 else ""
                next_w = asr_words_clean[j + 1] if (j + 1 < len(asr_words_clean)) else ""

                # Repetition check (stutter vs repeated word)
                is_repeat = (w_clean == prev_w) or (w_clean == next_w)
                is_prefix_stutter = (
                    bool(next_w and len(w_clean) >= 1 and next_w.startswith(w_clean) and len(next_w) > len(w_clean))
                    or bool(prev_w and len(w_clean) >= 1 and prev_w.startswith(w_clean) and len(prev_w) > len(w_clean))
                )

                # Use start of repetition sequence so timestamp takes user to the start of the event
                if j > 0 and w_clean == prev_w:
                    t_start = float(asr_words[j - 1].get("startSec", 0.0))
                else:
                    t_start = float(w_obj.get("startSec", 0.0))
                ts = format_timestamp(t_start)

                if is_repeat or is_prefix_stutter:
                    if next_w:
                        ctx_words = f"{w_clean} {next_w}"
                    elif prev_w:
                        ctx_words = f"{prev_w} {w_clean}"
                    else:
                        ctx_words = w_clean

                    # Group if consecutive duplicate issue already recorded for same word
                    if issues and issues[-1]["code"] in ("SUSPECTED_STUTTER", "REPEATED_WORD", "REPEATED_WORDS") and w_clean in issues[-1].get("words", []):
                        issues[-1]["timeRange"][1] = round(t_end, 3)
                        # Multiple repeats (> 2) escalate to REPEATED_WORD
                        issues[-1]["code"] = "REPEATED_WORD"
                        continue

                    if is_prefix_stutter or (len(w_clean) <= 5 and not (j > 1 and w_clean == asr_words_clean[j - 2])):
                        issues.append({
                            "severity": "warning",
                            "code": "SUSPECTED_STUTTER",
                            "message": f'Nghi vấn vấp âm gần từ "{ctx_words}" — khoảng {ts}. Vui lòng nghe kiểm tra.',
                            "words": [w_clean, next_w or prev_w],
                            "timeRange": [round(t_start, 3), round(t_end, 3)],
                        })
                    else:
                        issues.append({
                            "severity": "warning",
                            "code": "REPEATED_WORD",
                            "message": f'Nghi vấn lặp từ gần từ "{ctx_words}" — khoảng {ts}. Vui lòng nghe kiểm tra.',
                            "words": [w_clean],
                            "timeRange": [round(t_start, 3), round(t_end, 3)],
                        })
                else:
                    w_raw = w_obj.get("word", "").strip()
                    w_raw = re.sub(r"^[^\w\u00C0-\u1EF9]+|[^\w\u00C0-\u1EF9]+$", "", w_raw)
                    if not w_raw:
                        w_raw = w_clean

                    prev_src_raw = source_words[i1 - 1] if i1 > 0 else ""
                    prev_src_clean = source_words_clean[i1 - 1] if i1 > 0 else ""
                    next_src_raw = source_words[i1] if i1 < len(source_words) else ""
                    next_src_clean = source_words_clean[i1] if i1 < len(source_words) else ""

                    is_letter = (len(w_clean) == 1 and w_clean.isalpha())
                    is_letter_spelling = is_letter and (
                        (prev_src_clean and prev_src_clean.endswith(w_clean))
                        or (prev_src_raw and prev_src_raw.isupper() and len(prev_src_raw) > 1 and w_clean not in ("a", "i"))
                        or (w_clean not in ("a", "i") and p >= 0.40)
                    )

                    if is_letter_spelling:
                        if prev_src_raw:
                            msg = f"Nghi vấn sinh thêm chữ cái '{w_raw}' sau '{prev_src_raw}' — khoảng {ts}. Vui lòng nghe lại."
                        elif next_src_raw:
                            msg = f"Nghi vấn sinh thêm chữ cái '{w_raw}' trước '{next_src_raw}' — khoảng {ts}. Vui lòng nghe lại."
                        else:
                            msg = f"Nghi vấn sinh thêm chữ cái '{w_raw}' — khoảng {ts}. Vui lòng nghe lại."
                        issues.append({
                            "severity": "warning",
                            "code": "UNEXPECTED_LETTER_SPELLING",
                            "message": msg,
                            "words": [w_clean],
                            "timeRange": [round(t_start, 3), round(t_end, 3)],
                        })
                    elif p >= 0.40 and (len(w_clean) >= 2 or w_clean in ("a", "i")):
                        if next_src_raw:
                            msg = f"Nghi vấn phát âm thừa từ '{w_raw}' trước '{next_src_raw}' — khoảng {ts}. Vui lòng nghe lại."
                        elif prev_src_raw:
                            msg = f"Nghi vấn phát âm thừa từ '{w_raw}' sau '{prev_src_raw}' — khoảng {ts}. Vui lòng nghe lại."
                        else:
                            msg = f"Nghi vấn phát âm thừa từ '{w_raw}' — khoảng {ts}. Vui lòng nghe lại."
                        issues.append({
                            "severity": "warning",
                            "code": "EXTRA_WORD",
                            "message": msg,
                            "words": [w_clean],
                            "timeRange": [round(t_start, 3), round(t_end, 3)],
                        })

        elif tag == "delete":
            # Meaningful words in source text swallowed/missing in ASR
            content_indices = [
                i for i in range(i1, i2)
                if source_words_clean[i]
                and len(source_words_clean[i]) >= 3
                and source_words_clean[i] not in IGNORED_OMISSION_WORDS
            ]
            if not content_indices:
                continue

            # Check if merged with adjacent spoken words (e.g. ice cream -> icecream)
            unmerged_indices = []
            for i in content_indices:
                sc = source_words_clean[i]
                if i > 0 and j1 > 0 and (source_words_clean[i - 1] + sc == asr_words_clean[j1 - 1]):
                    continue
                if i + 1 < len(source_words_clean) and j1 < len(asr_words_clean) and (sc + source_words_clean[i + 1] == asr_words_clean[j1]):
                    continue
                unmerged_indices.append(i)

            if not unmerged_indices:
                continue

            if j1 > 0 and j1 < len(asr_words):
                w_prev = asr_words[j1 - 1]
                w_next = asr_words[j1]
                t_end_prev = float(w_prev.get("endSec", 0.0))
                t_start_next = float(w_next.get("startSec", 0.0))
                gap = t_start_next - t_end_prev
                p_prev = float(w_prev.get("probability", 1.0))
                p_next = float(w_next.get("probability", 1.0))
                ts = format_timestamp(t_end_prev)

                # Single missing word bounded by spoken words with gap too narrow (< 0.25s)
                if len(unmerged_indices) == 1 and gap < 0.25 and p_prev >= 0.50 and p_next >= 0.50:
                    src_clean = source_words_clean[unmerged_indices[0]]
                    issues.append({
                        "severity": "warning",
                        "code": "MISSING_WORD",
                        "message": f'Nghi vấn nuốt chữ tại từ "{src_clean}" — khoảng {ts}. Vui lòng nghe kiểm tra.',
                        "words": [src_clean],
                        "timeRange": [round(t_end_prev, 3), round(t_start_next, 3)],
                    })
                elif len(unmerged_indices) >= 2 or gap < 0.40:
                    ctx_span = extract_context_span(source_words, i1, i2)
                    issues.append({
                        "severity": "warning",
                        "code": "SUSPECTED_SWALLOWED",
                        "message": f"Vùng '{ctx_span}' có dấu hiệu phát âm thiếu hoặc không rõ — khoảng {ts}. Vui lòng nghe lại.",
                        "words": [source_words_clean[idx] for idx in unmerged_indices],
                        "timeRange": [round(t_end_prev, 3), round(t_start_next, 3)],
                    })

        elif tag == "replace":
            src_slice_clean = [source_words_clean[k] for k in range(i1, i2)]
            asr_slice_clean = [asr_words_clean[k] for k in range(j1, j2)]

            # Check if all words are equivalent (e.g. Sysco vs Cisco, 10 vs ten, cannot vs can't)
            if len(src_slice_clean) == len(asr_slice_clean) and all(
                are_words_equivalent(s, a) for s, a in zip(src_slice_clean, asr_slice_clean)
            ):
                continue

            # Check if concatenated string matches (e.g. database vs data base, icecream vs ice cream)
            if "".join(src_slice_clean) == "".join(asr_slice_clean):
                continue

            # Find unrepresented content words in source
            unrepresented_content_indices = []
            for idx in range(i1, i2):
                sw = source_words_clean[idx]
                if not sw or len(sw) < 3 or sw in IGNORED_OMISSION_WORDS:
                    continue
                # If matched any ASR word in the replace range, it's represented
                if any(are_words_equivalent(sw, aw) for aw in asr_slice_clean):
                    continue
                # Check if it's a proper noun that might have been phonetically varied
                if is_likely_proper_noun(source_words, delimiters, idx):
                    if any(levenshtein_dist(phonetic_key(sw), phonetic_key(aw)) <= 2 for aw in asr_slice_clean):
                        continue
                unrepresented_content_indices.append(idx)

            t_start = float(asr_words[j1].get("startSec", 0.0)) if j1 < len(asr_words) else 0.0
            t_end = float(asr_words[min(len(asr_words) - 1, j2 - 1)].get("endSec", 0.0)) if asr_words else 0.0
            ts = format_timestamp(t_start)

            # Case 1: Many-to-one / Many-to-few mismatch (e.g. "response mobile" -> "responsible")
            if (i2 - i1) > (j2 - j1) and unrepresented_content_indices:
                ctx_span = extract_context_span(source_words, i1, i2)
                issues.append({
                    "severity": "warning",
                    "code": "SUSPECTED_SWALLOWED",
                    "message": f"Vùng '{ctx_span}' có dấu hiệu phát âm thiếu hoặc không rõ — khoảng {ts}. Vui lòng nghe lại.",
                    "words": [source_words_clean[idx] for idx in unrepresented_content_indices],
                    "timeRange": [round(t_start, 3), round(t_end, 3)],
                })
                continue

            # Case 2: Partial syllable truncation (e.g. "mobile" -> "mo", "building" -> "build")
            if (i2 - i1) == 1 and (j2 - j1) == 1:
                sw = src_slice_clean[0]
                aw = asr_slice_clean[0]
                w_prob = float(asr_words[j1].get("probability", 1.0))
                is_pn = is_likely_proper_noun(source_words, delimiters, i1)

                if (
                    not is_pn
                    and len(sw) >= 4
                    and len(aw) >= 2
                    and len(sw) >= len(aw) + 2
                    and (sw.startswith(aw) or phonetic_key(sw).startswith(phonetic_key(aw)))
                    and w_prob >= 0.40
                ):
                    ctx_span = extract_context_span(source_words, i1, i2)
                    issues.append({
                        "severity": "warning",
                        "code": "PARTIAL_PRONUNCIATION",
                        "message": f"Vùng '{ctx_span}' có dấu hiệu phát âm dở dang hoặc thiếu âm tiết ('{aw}') — khoảng {ts}. Vui lòng nghe lại.",
                        "words": [sw, aw],
                        "timeRange": [round(t_start, 3), round(t_end, 3)],
                    })
                    continue

            # Case 3: Other non-equivalent content word substitution with clear ASR confidence
            if unrepresented_content_indices:
                max_prob = max((float(asr_words[k].get("probability", 0.0)) for k in range(j1, min(j2, len(asr_words)))), default=1.0)
                if max_prob >= 0.55:
                    ctx_span = extract_context_span(source_words, i1, i2)
                    issues.append({
                        "severity": "warning",
                        "code": "SUSPECTED_SWALLOWED",
                        "message": f"Vùng '{ctx_span}' có dấu hiệu phát âm thiếu hoặc không rõ — khoảng {ts}. Vui lòng nghe lại.",
                        "words": [source_words_clean[idx] for idx in unrepresented_content_indices],
                        "timeRange": [round(t_start, 3), round(t_end, 3)],
                    })

    # 3. Check for crowded/merged words (CROWDED_WORDS: 3+ consecutive words with gap <= 0.02s and dur < 0.09s)
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
        ts = format_timestamp(t_start)
        issues.append({
            "severity": "warning",
            "code": "CROWDED_WORDS",
            "message": (
                f"Cảnh báo: Phát hiện các từ bị dính vào nhau không có khoảng chuyển tiếp tự nhiên ('{joined_words}') "
                f"— khoảng {ts}. Vui lòng nghe lại."
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

        if min(w1_prob, w2_prob) < 0.35:
            continue

        w1_text = clean_word(w1.get("word", ""))
        w2_text = clean_word(w2.get("word", ""))
        if not w1_text or not w2_text:
            continue

        src_idx1 = asr_to_source.get(i)
        src_idx2 = asr_to_source.get(i + 1)

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
            ts = format_timestamp(end1)
            issues.append({
                "severity": "warning",
                "code": "ABNORMAL_PAUSE",
                "message": (
                    f'Cảnh báo: Khoảng ngắt bất thường giữa "{w1_text}" và "{w2_text}" '
                    f"({gap:.2f}s) — khoảng {ts}. Vui lòng nghe kiểm tra."
                ),
                "words": [w1_text, w2_text],
                "timeRange": [round(end1, 3), round(start2, 3)],
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
