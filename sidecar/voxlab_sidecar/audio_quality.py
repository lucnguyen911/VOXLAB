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

from .number_normalizer import (
    are_number_expressions_equivalent,
    collapse_number_tokens,
    is_decimal_number_string,
    split_decimal_parts,
)
from .protocol import log


PUNCTUATION_CHARS = set(".,!?;:—–-…()[]\"'“”„«»¿¡")

WEAK_CLITIC_ARTICLES = {"a", "an", "the"}

VI_MINOR_STOPWORDS = {
    "và", "của", "là", "thì", "mà", "cho", "ở", "với", "nhưng", "đã", "đang", "sẽ",
    "được", "bị", "các", "những", "một", "về", "trong", "có", "này", "đó", "ra", "vào",
    "lại", "rồi", "lên", "xuống", "đến", "tới", "từ", "hay", "hoặc", "khi", "nếu",
    "bởi", "vì", "do", "như", "nhất", "cũng", "nên", "thôi", "nữa", "ngay", "đều"
}
EN_MINOR_STOPWORDS = {
    "the", "a", "an", "and", "or", "of", "in", "on", "at", "to", "for", "with", "by",
    "is", "are", "was", "were", "it", "its", "that", "this", "be", "as", "from",
    "so", "than", "too", "very", "can", "could", "will", "would", "shall", "should"
}
IGNORED_OMISSION_WORDS = VI_MINOR_STOPWORDS | EN_MINOR_STOPWORDS

PROSODIC_CONJUNCTIONS = {
    # English
    "and", "but", "or", "so", "that", "which", "because", "although", "while",
    "since", "if", "when", "where", "who", "whom", "whose", "as", "than", "then",
    # Vietnamese
    "và", "nhưng", "hoặc", "hay", "mà", "bởi", "vì", "do", "nên", "cho",
    "để", "rằng", "là", "thì", "nếu", "khi", "như", "với", "tuy", "dù", "song"
}

CLAUSE_BOUNDARY_CONJUNCTIONS = {
    # English clause-introducing conjunctions where a preceding breath pause is natural
    "and", "but", "or", "so", "that", "which", "because", "although", "while",
    "since", "if", "when", "where", "though", "whereas", "unless",
    # Vietnamese clause-introducing conjunctions
    "và", "nhưng", "hoặc", "hay", "mà", "bởi", "vì", "nên",
    "để", "rằng", "nếu", "khi", "tuy", "dù", "song"
}

# Only match specific multi-word subtitle/YouTube watermark phrases, NEVER single common words
# like 'like', 'share', 'video', 'kênh', 'cảm ơn', 'theo dõi', or 'subscribe'.
WHISPER_HALLUCINATION_PATTERNS = [
    r"\bthank(?:s|\s+you)\s+for\s+watching\b",
    r"\bplease\s+subscribe\b",
    r"\blike\s+and\s+subscribe\b",
    r"\bsubscribe\s+kênh\b",
    r"\bđăng\s+ký\s+kênh\b",
    r"\bghiền\s+mì\s+gõ\b",
    r"\bla\s+la\s+school\b",
    r"\bcảm\s+ơn\s+các\s+bạn\s+đã\s+(?:xem|theo\s+dõi)\b",
    r"\bhẹn\s+gặp\s+lại\s+các\s+bạn\b",
    r"\bchúc\s+các\s+bạn\s+xem\s+video\b",
    r"\bsubtitles\s+by\b",
    r"\bamara(?:\.org)?\b",
]

COMMON_EQUIVALENTS: dict[str, set[str]] = {
    "podcast": {"podcast", "podcasts", "potcast", "cotcac", "cotcat", "botcat"},
    "voxlab": {"voxlab", "voxlabs", "vootlat", "votlat", "voclap"},
    "online": {"online", "onlai"},
    "video": {"video"},
    "ai": {"ai"},
    "bot": {"bot", "bot t"},
    "tesla": {"tesla", "tetla"},
    # US/UK spelling equivalents
    "gray": {"gray", "grey"},
    "tire": {"tire", "tyre"},
    "tires": {"tires", "tyres"},
    "aluminum": {"aluminum", "aluminium"},
    "program": {"program", "programme"},
    "programs": {"programs", "programmes"},
    "check": {"check", "cheque"},
    "checks": {"checks", "cheques"},
    "artifact": {"artifact", "artefact"},
    "artifacts": {"artifacts", "artefacts"},
    "skeptical": {"skeptical", "sceptical"},
    "plow": {"plow", "plough"},
    # Verified exact English homophones (identical IPA pronunciation)
    "sealing": {"sealing", "ceiling"},
    "seal": {"seal", "ceil"},
    "seals": {"seals", "ceils"},
    "sealed": {"sealed", "ceiled"},
    "sensor": {"sensor", "censor"},
    "sensors": {"sensors", "censors"},
    "brake": {"brake", "break"},
    "brakes": {"brakes", "breaks"},
    "braking": {"braking", "breaking"},
    "steel": {"steel", "steal"},
    "phase": {"phase", "faze"},
    "phases": {"phases", "fazes"},
    "serial": {"serial", "cereal"},
    "cell": {"cell", "sell"},
    "cells": {"cells", "sells"},
    "site": {"site", "sight", "cite"},
    "sites": {"sites", "sights", "cites"},
    "pair": {"pair", "pear", "pare"},
    "pairs": {"pairs", "pears"},
    "wait": {"wait", "weight"},
    "waits": {"waits", "weights"},
    "piece": {"piece", "peace"},
    "whole": {"whole", "hole"},
    "role": {"role", "roll"},
    "roles": {"roles", "rolls"},
    "sole": {"sole", "soul"},
    "principal": {"principal", "principle"},
    "principals": {"principals", "principles"},
    "weather": {"weather", "whether"},
    "complement": {"complement", "compliment"},
    "complements": {"complements", "compliments"},
    "stationary": {"stationary", "stationery"},
    "coarse": {"coarse", "course"},
    "seam": {"seam", "seem"},
    "seams": {"seams", "seems"},
    "weak": {"weak", "week"},
    "sun": {"sun", "son"},
    "peak": {"peak", "peek", "pique"},
    "peaks": {"peaks", "peeks"},
    "plain": {"plain", "plane"},
    "plains": {"plains", "planes"},
    "main": {"main", "mane"},
    # Physical unit abbreviations
    "kg": {"kg", "kilogram", "kilograms", "kilo", "kilos"},
    "km": {"km", "kilometer", "kilometers", "kilometre", "kilometres"},
    "cm": {"cm", "centimeter", "centimeters", "centimetre", "centimetres"},
    "mm": {"mm", "millimeter", "millimeters", "millimetre", "millimetres"},
    "mg": {"mg", "milligram", "milligrams"},
    "g": {"g", "gram", "grams"},
    "lb": {"lb", "lbs", "pound", "pounds"},
    "oz": {"oz", "ounce", "ounces"},
}

NUMBER_WORDS = {
    "0": {"zero", "o", "khong", "không"},
    "1": {"one", "mot", "một", "mốt"},
    "2": {"two", "hai", "ii"},
    "3": {"three", "ba", "iii"},
    "4": {"four", "bon", "bốn", "tư", "iv"},
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
    """Conservative phonetic/orthographic normalization for US/UK variants and exact homophones.
    Never collapses distinct root vowels (e.g. 'ship' != 'shop', 'could' != 'cold').
    """
    w = word.lower()
    # US/UK spelling suffixes
    w = re.sub(r"([a-z]{2,})isation(s?)$", r"\1ization\2", w)
    w = re.sub(r"([a-z]{2,})is(e|es|ed|ing)$", r"\1iz\2", w)
    w = re.sub(r"([a-z]{2,})ys(e|es|ed|ing)$", r"\1yz\2", w)
    w = re.sub(r"([a-z]{2,})our(s?|ed|ing|ite|ites)$", r"\1or\2", w)
    w = re.sub(r"([bdfglmnprstvz])re(s?)$", r"\1er\2", w)
    w = re.sub(r"([a-z]{2,})ogue(s?)$", r"\1og\2", w)
    w = re.sub(r"([dfgl])ence(s?)$", r"\1ense\2", w)
    # Homophone digraphs
    w = re.sub(r"ph", "f", w)
    w = re.sub(r"c([eiy])", r"s\1", w)
    w = re.sub(r"ck", "k", w)
    w = re.sub(r"q", "k", w)
    w = re.sub(r"x", "ks", w)
    w = re.sub(r"^wr", "r", w)
    w = re.sub(r"^kn", "n", w)
    w = re.sub(r"y", "i", w)
    w = re.sub(r"ea([mnkltpds]$)", r"ee\1", w)
    w = re.sub(r"c(?!h)", "k", w)
    w = re.sub(r"([bcdfghjklmnpqrstvwxz])\1+", r"\1", w)
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


_VI_TONE_COMBINING_MARKS = {"\u0300", "\u0301", "\u0309", "\u0303", "\u0323"}

_VI_TONE_PLACEMENT_MAP = {
    "oà": "òa", "oá": "óa", "oả": "ỏa", "oã": "õa", "oạ": "ọa",
    "oè": "òe", "oé": "óe", "oẻ": "ỏe", "oẽ": "õe", "oẹ": "ọe",
    "uỳ": "ùy", "uý": "úy", "uỷ": "ủy", "uỹ": "ũy", "uỵ": "ụy",
}

_VI_Y_TO_I_MAP = {
    "y": "i", "ỳ": "ì", "ý": "í", "ỷ": "ỉ", "ỹ": "ĩ", "ỵ": "ị",
}


def strip_tones_keep_vowels(text: str) -> str:
    """Strips only the 5 Vietnamese tone marks while keeping vowel diacritics (ă, â, ê, ô, ơ, ư) and đ."""
    import unicodedata
    nfd = unicodedata.normalize("NFD", text.lower())
    kept = "".join(c for c in nfd if c not in _VI_TONE_COMBINING_MARKS)
    return unicodedata.normalize("NFC", kept)


def normalize_vietnamese_orthography(word: str) -> str:
    """Normalizes Vietnamese orthographic variants that have 100% identical pronunciation and tone
    (e.g. old vs new tone placement 'hoà' == 'hòa', 'thuỷ' == 'thủy', and open 'y'/'i' after consonants 'kỹ' == 'kĩ').
    Preserves all tone marks and vowel qualities so 'bàn' != 'bán' and 'mẹ' != 'mẻ'.
    """
    import unicodedata
    s = unicodedata.normalize("NFC", word.lower())
    for old_pat, new_pat in _VI_TONE_PLACEMENT_MAP.items():
        if old_pat in s:
            s = s.replace(old_pat, new_pat)
    if len(s) >= 2 and s[-1] in _VI_Y_TO_I_MAP and s[-2] not in "aeoơuưăâ":
        s = s[:-1] + _VI_Y_TO_I_MAP[s[-1]]
    return s


def vi_phonetic_normalize_preserve_tone(word: str) -> str:
    """Normalizes Vietnamese dialectal initial consonants (gi/d, tr/ch, x/s, k/c, gh/g, ngh/ng)
    while strictly preserving vowel quality and tone marks."""
    s = normalize_vietnamese_orthography(word)
    if s.startswith("gi") and len(s) > 2:
        s = "d" + s[2:]
    elif s.startswith("tr"):
        s = "ch" + s[2:]
    elif s.startswith("x"):
        s = "s" + s[1:]
    elif s.startswith("ngh"):
        s = "ng" + s[3:]
    elif s.startswith("gh"):
        s = "g" + s[2:]
    elif s.startswith("k") and not s.startswith("kh"):
        s = "c" + s[1:]
    return s


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


def vi_phonetic_normalize(word: str) -> str:
    """Normalizes Vietnamese dialectal initial and final consonant variants for ASR matching."""
    return vi_phonetic_normalize_preserve_tone(word)


def is_whisper_hallucination(text: str) -> bool:
    """Checks whether text contains known repetitive Whisper hallucination phrases (e.g. YouTube subtitles).
    Never flags standalone common words like 'like', 'share', 'video', or 'kênh'.
    """
    t = text.strip().lower()
    if not t:
        return False
    for pat in WHISPER_HALLUCINATION_PATTERNS:
        if re.search(pat, t):
            return True
    return False


def are_words_equivalent(w1: str, w2: str) -> bool:
    """Checks whether two words are orthographically, phonetically, or numerically equivalent.
    Never equates words with different lexical meanings or tones merely due to Levenshtein distance <= 1
    (e.g. 'ship' != 'shop', 'bàn' != 'bán', 'mẹ' != 'mẻ').
    """
    if w1 == w2:
        return True
    if are_number_expressions_equivalent(w1, w2):
        return True
    # CRITICAL: Numbers must NOT be matched via phonetic or Levenshtein fuzzy approximation!
    # (e.g. '2.8' and '2.4', '300' and '500' must NEVER match)
    if re.search(r"\d", w1) or re.search(r"\d", w2):
        return False
    c1 = CONTRACTIONS.get(w1, w1)
    c2 = CONTRACTIONS.get(w2, w2)
    if c1 == c2:
        return True
    for num, words in NUMBER_WORDS.items():
        if (w1 == num and w2 in words) or (w2 == num and w1 in words):
            return True
        if w1 in words and w2 in words:
            return True
    # Loanwords and domain equivalents
    w1_clean = clean_word(w1)
    w2_clean = clean_word(w2)
    if not w1_clean or not w2_clean:
        return w1_clean == w2_clean
    if w1_clean == w2_clean:
        return True
    # CRITICAL: Verified letter-by-letter initialisms (e.g. GVEC, VPP, FBI, CPU, GPU)
    # must NEVER be fuzzy-matched via phonetic_key or Levenshtein distance!
    from .pronunciation import VERIFIED_INITIALISMS

    if w1_clean.upper() in VERIFIED_INITIALISMS or w2_clean.upper() in VERIFIED_INITIALISMS:
        return False
    w1_strip = strip_diacritics(w1_clean)
    w2_strip = strip_diacritics(w2_clean)
    for root, equivs in COMMON_EQUIVALENTS.items():
        m1 = (w1_clean == root or w1_clean in equivs or w1_strip == root or w1_strip in equivs)
        m2 = (w2_clean == root or w2_clean in equivs or w2_strip == root or w2_strip in equivs)
        if m1 and m2:
            return True
    # Vietnamese tone-preserving orthographic & dialectal consonant equivalence
    if not w1_clean.isascii() or not w2_clean.isascii():
        if normalize_vietnamese_orthography(w1_clean) == normalize_vietnamese_orthography(w2_clean):
            return True
        if vi_phonetic_normalize_preserve_tone(w1_clean) == vi_phonetic_normalize_preserve_tone(w2_clean):
            return True
        # Allow unaccented ASCII ASR fallback ONLY when one side is pure ASCII and the accented side
        # contains non-ASCII vowel hats/hooks/đ (e.g. 'tiếng Việt' vs 'tieng Viet'), never for tone swaps!
        if w1_clean.isascii() != w2_clean.isascii() and w1_strip == w2_strip:
            accented = w2_clean if w1_clean.isascii() else w1_clean
            if strip_tones_keep_vowels(accented) != w1_strip:
                return True
        return False
    if phonetic_key(w1_clean) == phonetic_key(w2_clean):
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


TOKEN_PATTERN = re.compile(
    r"(?:\d+(?:[.,:]\d+)+|(?:[A-Z]\.){2,6}|[A-Z]{1,3}&[A-Z]{1,3}|[\w\u00C0-\u1EF9]+(?:[-'’][\w\u00C0-\u1EF9]+)*)"
)


def tokenize_text_with_spans(text: str) -> tuple[list[str], list[str], list[tuple[int, int]]]:
    """Extract words, delimiters between them, and `(start, end)` character spans in `text`."""
    words: list[str] = []
    delimiters: list[str] = []
    spans: list[tuple[int, int]] = []
    last_end = 0

    for m in TOKEN_PATTERN.finditer(text):
        delimiters.append(text[last_end:m.start()])
        words.append(m.group(0))
        spans.append((m.start(), m.end()))
        last_end = m.end()

    delimiters.append(text[last_end:])
    return words, delimiters, spans


def tokenize_text_with_delimiters(text: str) -> tuple[list[str], list[str]]:
    """Extract words and the delimiters between them.
    delimiters[i] contains characters between words[i-1] and words[i].
    delimiters[0] is text before words[0].
    Preserves decimals (e.g. '0.8', '13,5'), ratios/time ('10:30'), and hyphenated compounds.
    """
    words, delimiters, _ = tokenize_text_with_spans(text)
    return words, delimiters


def has_punctuation_boundary(delimiter: str) -> bool:
    """Checks whether the delimiter between words contains any punctuation mark or line break."""
    return any(c in PUNCTUATION_CHARS for c in delimiter) or "\n" in delimiter or "\r" in delimiter


ALL_NUMBER_WORDS_SET: set[str] = {w for words in NUMBER_WORDS.values() for w in words} | {
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
    "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
    "point", "dot", "oh", "chấm", "phẩy", "linh", "lẻ",
}

ENTITY_NON_PROPER_HEADS: set[str] = (
    EN_MINOR_STOPWORDS
    | VI_MINOR_STOPWORDS
    | PROSODIC_CONJUNCTIONS
    | {
        "now", "then", "here", "there", "these", "those", "he", "she", "we", "they", "you", "i",
        "my", "your", "our", "their", "his", "her", "what", "why", "how", "when", "where", "who",
        "before", "after", "during", "until", "unless", "although", "though", "despite", "without",
        "within", "between", "among", "through", "across", "under", "over", "above", "below",
        "many", "most", "some", "any", "every", "each", "other", "another", "such", "both",
        "today", "tomorrow", "yesterday", "tonight", "suddenly", "finally", "ultimately",
        "however", "therefore", "meanwhile", "furthermore", "moreover", "instead", "otherwise",
    }
)

KNOWN_PRODUCT_MODEL_PREFIXES: set[str] = {
    "powerwall", "model", "iphone", "ipad", "macbook", "airpods", "watch", "imac",
    "galaxy", "pixel", "surface", "windows", "android", "ios", "macos", "playstation",
    "xbox", "switch", "ryzen", "core", "geforce", "radeon", "rtx", "gtx", "gpt",
    "claude", "gemini", "llama", "qwen", "deepseek", "starship", "falcon", "optimus",
    "cybercab", "megapack", "supercharger", "nem", "iso", "ieee", "usb", "hdmi",
    "pcie", "wifi", "wi-fi", "bluetooth", "web", "docsis", "wpa", "tls", "http",
    "stage", "phase", "tier", "level", "version", "type", "class", "part", "chapter",
}


def is_version_or_number_token(token: str) -> bool:
    """Checks whether a token represents a version number, digit sequence, or spoken number word."""
    cleaned = token.strip(" .,!?;:—–-…()[]\"'“”„«»¿¡").lower()
    if not cleaned:
        return False
    if re.fullmatch(r"\d+(?:[.,]\d+)*[a-z]?", cleaned):
        return True
    w_clean = clean_word(cleaned)
    return w_clean in ALL_NUMBER_WORDS_SET


def is_protected_entity_pair(
    source_words: list[str],
    delimiters: list[str],
    src_idx1: int | None,
    src_idx2: int | None,
    w1_raw: str,
    w2_raw: str,
) -> tuple[bool, str]:
    """Determines whether two adjacent tokens form a protected semantic entity
    (e.g. Product/Policy + Version like 'Powerwall 3', 'Model 3', 'NEM 3.0',
    or Compound Proper Noun like 'Tesla Powerwall', 'United States') where
    no internal pause is prosodically acceptable.
    """
    if src_idx1 is not None and src_idx2 is not None:
        if src_idx2 > src_idx1:
            combined_delim = "".join(delimiters[k] for k in range(src_idx1 + 1, min(len(delimiters), src_idx2 + 1)))
            if any(c in PUNCTUATION_CHARS for c in combined_delim) or re.search(r"[\r\n]\s*[\r\n]", combined_delim):
                return False, ""
            if ("\n" in combined_delim or "\r" in combined_delim):
                next_src_w = source_words[src_idx2] if 0 <= src_idx2 < len(source_words) else ""
                if next_src_w and next_src_w[0].isupper():
                    return False, ""
            if src_idx2 - src_idx1 > 2:
                return False, ""
        else:
            # Same source span (e.g. decimal '0.8' -> '0', '8' already verified by decimal hypothesis)
            return False, ""

    src_tok1 = source_words[src_idx1] if (src_idx1 is not None and 0 <= src_idx1 < len(source_words)) else w1_raw
    src_tok2 = source_words[src_idx2] if (src_idx2 is not None and 0 <= src_idx2 < len(source_words)) else w2_raw

    tok1_strip = re.sub(r"^[^\w\u00C0-\u1EF9]+|[^\w\u00C0-\u1EF9]+$", "", src_tok1)
    tok2_strip = re.sub(r"^[^\w\u00C0-\u1EF9]+|[^\w\u00C0-\u1EF9]+$", "", src_tok2)
    if not tok1_strip or not tok2_strip:
        return False, ""

    c1 = clean_word(tok1_strip)
    c2 = clean_word(tok2_strip)

    # 1. Product / Brand / Acronym + Version / Number (e.g. 'Powerwall 3', 'Model 3', 'NEM 3.0', 'iPhone 17')
    is_head_product_or_proper = (
        not is_version_or_number_token(tok1_strip)
        and (
            c1 in KNOWN_PRODUCT_MODEL_PREFIXES
            or (
                (tok1_strip[0].isupper() or any(ch.isupper() for ch in tok1_strip[1:]))
                and c1 not in ENTITY_NON_PROPER_HEADS
                and len(c1) >= 2
            )
        )
    )
    if is_head_product_or_proper and (is_version_or_number_token(tok2_strip) or is_version_or_number_token(w2_raw)):
        return True, "product_version"

    # 2. Compound Proper Noun / Brand + Product (e.g. 'Tesla Powerwall', 'North America')
    # Exclude pairs of ALL-CAPS ordinary words (e.g. 'DOLLAR MONEY', 'MONEY EQUATION')
    if (
        src_idx1 is not None
        and src_idx2 == src_idx1 + 1
        and tok1_strip[0].isupper()
        and tok2_strip[0].isupper()
        and not (tok1_strip.isupper() and tok2_strip.isupper() and len(tok1_strip) >= 2 and len(tok2_strip) >= 2)
        and c1 not in ENTITY_NON_PROPER_HEADS
        and c2 not in ENTITY_NON_PROPER_HEADS
        and not is_version_or_number_token(tok1_strip)
    ):
        return True, "compound_proper_noun"

    # 3. Tight Number / Currency + Unit / Rate modifier (e.g. '500 miles', '$1 per', 'per mile', '75 kWh')
    UNIT_AND_RATE_WORDS = {
        "mile", "miles", "kilometer", "kilometers", "km", "meter", "meters", "nanometer", "nanometers",
        "pound", "pounds", "ton", "tons", "kg", "gram", "grams", "liter", "liters", "gallon", "gallons",
        "hour", "hours", "minute", "minutes", "second", "seconds", "day", "days", "week", "weeks",
        "month", "months", "year", "years", "percent", "dollar", "dollars", "cent", "cents",
        "kwh", "mwh", "gwh", "kw", "mw", "gw", "watt", "watts", "volt", "volts", "amp", "amps",
        "unit", "units", "cycle", "cycles", "cell", "cells", "pack", "packs", "truck", "trucks",
        "per", "chiếc", "cái", "người", "năm", "tháng", "ngày", "giờ", "phút", "giây", "đồng", "đô",
    }
    if (
        (is_version_or_number_token(tok1_strip) or is_version_or_number_token(w1_raw) or c1 == "per")
        and c2 in UNIT_AND_RATE_WORDS
    ):
        return True, "number_unit"

    return False, ""


def compute_acoustic_envelope(
    audio_data: np.ndarray | None,
    sample_rate: int,
) -> dict[str, Any] | None:
    """Computes a shared frame-level RMS and ZCR envelope (10ms hop, 20ms window) once per audio file."""
    if audio_data is None or sample_rate <= 0 or audio_data.size == 0:
        return None
    mono = np.ascontiguousarray(audio_data, dtype=np.float32)
    if mono.ndim > 1:
        mono = mono.mean(axis=1)
    hop = max(1, int(round(0.010 * sample_rate)))
    win = max(hop + 1, int(round(0.020 * sample_rate)))
    if mono.size < win * 2:
        return None
    frames = np.lib.stride_tricks.sliding_window_view(mono, win)[::hop]
    rms = np.sqrt(np.mean(frames ** 2, axis=1))
    zcr = np.mean(np.abs(np.diff(np.signbit(frames), axis=1)), axis=1)
    voiced = rms[rms > 0.005]
    has_speech = bool(voiced.size >= 5)
    p10 = float(np.percentile(rms, 10)) if rms.size > 0 else 0.0
    p75 = float(np.percentile(voiced, 75)) if has_speech else 0.05
    sil_th = max(0.006, min(0.016, max(p10 * 2.5, p75 * 0.115)))
    active_th = max(0.018, p75 * 0.24)
    active_indices = np.where(rms >= active_th)[0]
    first_speech_sec = float(active_indices[0] * 0.01) if active_indices.size > 0 else 0.0
    last_speech_sec = float(active_indices[-1] * 0.01) if active_indices.size > 0 else (mono.size / float(sample_rate))
    return {
        "mono": mono,
        "sample_rate": sample_rate,
        "hop": hop,
        "win": win,
        "rms": rms,
        "zcr": zcr,
        "p10": p10,
        "p75": p75,
        "sil_th": sil_th,
        "active_th": active_th,
        "has_speech": has_speech,
        "first_speech_sec": first_speech_sec,
        "last_speech_sec": last_speech_sec,
    }


def extract_global_silent_valleys(
    envelope: dict[str, Any] | None,
    asr_words: list[dict[str, Any]],
) -> tuple[dict[int, tuple[float, float, float]], list[tuple[float, float]]]:
    """Extracts contiguous silent valleys (>= 0.12s) from the shared acoustic envelope and maps each
    valley to at most one inter-word boundary `i` (between `asr_words[i]` and `asr_words[i+1]`).
    Returns `(boundary_valleys, all_boundary_intervals)` where:
      - `boundary_valleys[i] = (gap_dur_sec, gap_start_sec, gap_end_sec)`
      - `all_boundary_intervals` lists all `(gap_start_sec, gap_end_sec)` attributed to inter-word boundaries
        so `detect_intra_word_pause` never misclassifies an inter-word pause as an intra-word break.
    """
    if envelope is None or not envelope.get("has_speech") or len(asr_words) < 2:
        return {}, []

    rms = envelope["rms"]
    zcr = envelope["zcr"]
    sil_th = float(envelope["sil_th"])
    active_th = float(envelope["active_th"])
    first_speech_sec = float(envelope["first_speech_sec"])
    last_speech_sec = float(envelope["last_speech_sec"])

    is_quiet = (rms < sil_th) & ~((rms >= 0.010) & (zcr >= 0.30))
    valleys: list[tuple[float, float, float]] = []
    run_s: int | None = None
    for idx in range(len(is_quiet) + 1):
        q = bool(is_quiet[idx]) if idx < len(is_quiet) else False
        if q and run_s is None:
            run_s = idx
        elif not q and run_s is not None:
            dur = (idx - run_s) * 0.01
            if dur >= 0.12:
                valleys.append((round(run_s * 0.01, 3), round(idx * 0.01, 3), round(dur, 3)))
            run_s = None

    boundary_valleys: dict[int, tuple[float, float, float]] = {}
    all_boundary_intervals: list[tuple[float, float]] = []

    for v_s, v_e, v_dur in valleys:
        if v_s <= first_speech_sec + 0.05 or v_e >= last_speech_sec - 0.05:
            continue
        v_mid = 0.5 * (v_s + v_e)

        matched_b: int | None = None
        best_overlap = 0.0
        for i in range(len(asr_words) - 1):
            e_i = float(asr_words[i].get("endSec", 0.0))
            s_next = float(asr_words[i + 1].get("startSec", 0.0))
            if v_s <= s_next + 0.04 and v_e >= e_i - 0.04:
                ov = min(v_e, max(e_i, s_next) + 0.06) - max(v_s, min(e_i, s_next) - 0.06)
                if ov > best_overlap:
                    best_overlap = ov
                    matched_b = i

        if matched_b is None:
            w_m: int | None = None
            for m, w in enumerate(asr_words):
                if float(w.get("startSec", 0.0)) <= v_mid <= float(w.get("endSec", 0.0)):
                    w_m = m
                    break
            if w_m is not None:
                s_m = float(asr_words[w_m].get("startSec", 0.0))
                e_m = float(asr_words[w_m].get("endSec", 0.0))
                tok_m = clean_word(str(asr_words[w_m].get("word", "")))
                t_vow = strip_tones_keep_vowels(tok_m)
                syl_m = max(1, len(re.findall(r"[aeiouyăâêôơư]+", t_vow))) if t_vow else 1
                if t_vow.endswith("e") and not t_vow.endswith(("le", "ee", "ie", "oe", "ye")) and syl_m > 1:
                    syl_m -= 1

                f_sm = max(0, int(round(s_m * 100)))
                f_vs = max(f_sm, int(round(v_s * 100)))
                f_ve = min(len(rms), int(round(v_e * 100)))
                f_em = min(len(rms), int(round(e_m * 100)))
                left_active = float(np.sum(rms[f_sm:f_vs] >= active_th)) * 0.01
                right_active = float(np.sum(rms[f_ve:f_em] >= active_th)) * 0.01
                dist_left = v_s - s_m
                dist_right = e_m - v_e
                prev_tok = clean_word(str(asr_words[w_m - 1].get("word", ""))) if w_m > 0 else ""
                prev_is_num_or_abbr = bool(
                    re.search(r"\d", prev_tok)
                    or prev_tok in ("kg", "km", "cm", "mm", "mg", "lb", "lbs", "oz", "ii", "iii", "iv", "vi", "vii", "viii", "ix", "x")
                )

                if w_m > 0 and (
                    dist_left <= 0.18
                    or left_active < 0.12
                    or (syl_m == 1 and right_active <= 0.24 and dist_left <= dist_right + 0.14)
                    or (prev_is_num_or_abbr and dist_left <= 0.45)
                ):
                    matched_b = w_m - 1
                elif w_m + 1 < len(asr_words) and (dist_right <= 0.18 or right_active < 0.12):
                    matched_b = w_m

        if matched_b is not None:
            all_boundary_intervals.append((v_s, v_e))
            cur_dur, _, _ = boundary_valleys.get(matched_b, (0.0, 0.0, 0.0))
            if v_dur > cur_dur:
                boundary_valleys[matched_b] = (v_dur, v_s, v_e)

    return boundary_valleys, all_boundary_intervals


def classify_phrase_cohesion_pair(
    source_words: list[str],
    source_words_clean: list[str],
    delimiters: list[str],
    src_idx1: int | None,
    src_idx2: int | None,
    w1_raw: str,
    w2_raw: str,
    eff_speed: float,
    default_min_pause: float,
) -> tuple[bool, str, float]:
    """Classifies whether two adjacent words form a tight syntactic/semantic constituent
    and returns `(is_tight_cohesion, cohesion_kind, adaptive_min_pause_sec)`."""
    is_protected, entity_kind = is_protected_entity_pair(
        source_words, delimiters, src_idx1, src_idx2, w1_raw, w2_raw
    )
    if is_protected:
        if entity_kind == "product_version":
            return True, "product_version", max(0.18, 0.20 / eff_speed)
        if entity_kind == "compound_proper_noun":
            return True, "compound_proper_noun", max(0.22, 0.24 / eff_speed)
        if entity_kind == "number_unit":
            return True, "number_unit", max(0.25, 0.28 / eff_speed)

    if src_idx1 is not None and src_idx2 is not None:
        if src_idx2 <= src_idx1 or (src_idx2 - src_idx1) > 2:
            return False, "", default_min_pause
        combined_delim = "".join(delimiters[k] for k in range(src_idx1 + 1, min(len(delimiters), src_idx2 + 1)))
        if has_punctuation_boundary(combined_delim):
            return False, "", default_min_pause

    c1 = clean_word(w1_raw)
    c2 = clean_word(w2_raw)
    if not c1 or not c2:
        return False, "", default_min_pause

    prev_c = source_words_clean[src_idx1 - 1] if (src_idx1 is not None and src_idx1 > 0) else ""
    next_c = source_words_clean[src_idx2 + 1] if (src_idx2 is not None and src_idx2 + 1 < len(source_words_clean)) else ""
    tok2_raw = source_words[src_idx2] if (src_idx2 is not None and 0 <= src_idx2 < len(source_words)) else w2_raw
    tok2_strip = re.sub(r"^[^\w\u00C0-\u1EF9]+|[^\w\u00C0-\u1EF9]+$", "", tok2_raw)

    # 1. Compound Preposition / Particle Lock (e.g. 'down to', 'up to', 'out of', 'into unified')
    if (
        c1 in ("down", "up", "out", "off", "prior", "according", "due", "close", "next", "instead", "ahead", "apart", "aside")
        and c2 in ("to", "of", "from", "with")
    ) or (
        c1 in ("into", "onto", "within", "without", "upon", "towards", "toward", "across", "through", "throughout", "against", "among")
        and c2 in (WEAK_CLITIC_ARTICLES | {"this", "that", "these", "those", "its", "their", "his", "her", "our", "your", "my", "unified", "one", "single"})
    ):
        return True, "tight_preposition", max(0.22, 0.24 / eff_speed)

    # 2. Preposition + Number / Quantitative Complement (e.g. 'below 40', 'between 200', 'from 60')
    if c1 in (
        "below", "above", "under", "over", "from", "between", "around", "roughly",
        "nearly", "about", "at", "by", "of", "in", "for", "with", "to", "into", "onto"
    ) and (is_version_or_number_token(tok2_strip) or is_version_or_number_token(w2_raw)):
        return True, "tight_preposition_number", max(0.24, 0.26 / eff_speed)

    # 3. Numeric Range Structure (e.g. 'between 200 and 300', 'from 60 to 70')
    if (
        is_version_or_number_token(w1_raw)
        and c2 in ("and", "to", "or")
        and (is_version_or_number_token(next_c) or prev_c in ("between", "from"))
    ) or (
        c1 in ("and", "to")
        and is_version_or_number_token(prev_c)
        and (is_version_or_number_token(tok2_strip) or is_version_or_number_token(w2_raw))
    ):
        return True, "tight_numeric_range", max(0.22, 0.24 / eff_speed)

    # 4. Determiner / Demonstrative / Possessive + Head/Modifier/Number (e.g. 'this 50,000-ton', 'a single', 'the traditional')
    if c1 in ("the", "a", "an", "this", "these", "those", "my", "your", "our", "their", "his", "her", "its", "every", "each", "no") and c2 not in (
        PROSODIC_CONJUNCTIONS
        | {"is", "are", "was", "were", "will", "can", "could", "would", "should", "has", "have", "had", "does", "do", "did", "jumps", "makes", "means", "takes", "works"}
    ):
        return True, "tight_determiner", max(0.22, 0.24 / eff_speed)

    # 5. Tight Comparative Construction (e.g. 'ships faster than')
    if c2 in (
        "faster", "slower", "better", "worse", "harder", "easier", "higher", "lower",
        "larger", "smaller", "bigger", "cheaper", "less", "more", "longer", "shorter",
        "sooner", "further", "closer", "lighter", "heavier", "stronger", "weaker"
    ) and next_c == "than":
        return True, "tight_comparative", max(0.22, 0.23 / eff_speed)

    # 6. Prenominal Modifier / Adjective + Proper Noun or Det-Adj-Noun (e.g. 'single Liberty', 'a traditional body shop')
    if (
        c1 not in (ENTITY_NON_PROPER_HEADS | {"named", "called"})
        and tok2_strip
        and tok2_strip[0].isupper()
        and not tok2_strip.isupper()
        and c2 not in ENTITY_NON_PROPER_HEADS
    ):
        return True, "tight_modifier_noun", max(0.22, 0.23 / eff_speed)

    if (
        prev_c in ("a", "an", "the", "this", "that", "these", "those", "its", "their", "his", "her", "our", "your")
        and c1 not in ENTITY_NON_PROPER_HEADS
        and c2 not in (
            ENTITY_NON_PROPER_HEADS
            | {"is", "are", "was", "were", "will", "can", "could", "would", "should", "has", "have", "had", "found", "built", "made", "used", "called", "named", "designed"}
        )
    ):
        return True, "tight_modifier_noun", max(0.24, 0.26 / eff_speed)

    return False, "", default_min_pause


def measure_boundary_silence_sec(
    audio_data: np.ndarray | None,
    sample_rate: int,
    start1: float,
    end1: float,
    start2: float,
    end2: float,
    silence_rms_threshold: float = 0.012,
) -> tuple[float, float]:
    """Measures acoustic silence between two consecutive words on the waveform.
    Returns (direct_gap_silence_sec, window_contiguous_silence_sec).
    - direct_gap_silence_sec: total silent 20ms frames strictly inside [end1, start2].
    - window_contiguous_silence_sec: longest contiguous silent run inside the boundary window
      around [end1, start2], compensating for Whisper DTW padding into adjacent silence.
    """
    if audio_data is None or sample_rate <= 0 or audio_data.size == 0:
        gap = max(0.0, start2 - end1)
        return gap, gap

    frame_sz = max(1, int(round(0.02 * sample_rate)))

    # 1. Direct gap [end1, start2]
    direct_silence_sec = 0.0
    s1 = max(0, int(round(end1 * sample_rate)))
    s2 = min(audio_data.size, int(round(start2 * sample_rate)))
    if s2 > s1:
        slice_gap = audio_data[s1:s2]
        n_f = slice_gap.size // frame_sz
        if n_f > 0:
            sil_count = sum(
                1
                for k in range(n_f)
                if float(np.sqrt(np.mean(slice_gap[k * frame_sz : (k + 1) * frame_sz] ** 2))) < silence_rms_threshold
            )
            direct_silence_sec = round(sil_count * 0.02, 3)

    # 2. Boundary window around [end1, start2] to capture contiguous silence when Whisper pads word bounds
    w1_dur = max(0.0, end1 - start1)
    w2_dur = max(0.0, end2 - start2)
    pad_before = min(0.12, 0.40 * w1_dur)
    pad_after = min(0.28, 0.75 * w2_dur)
    win_start = max(0.0, end1 - pad_before)
    win_end = max(win_start, start2 + pad_after)

    ws1 = max(0, int(round(win_start * sample_rate)))
    ws2 = min(audio_data.size, int(round(win_end * sample_rate)))
    max_contig_sec = direct_silence_sec
    if ws2 > ws1:
        win_slice = audio_data[ws1:ws2]
        n_wf = win_slice.size // frame_sz
        cur_run = 0
        best_run = 0
        for k in range(n_wf):
            frm = win_slice[k * frame_sz : (k + 1) * frame_sz]
            rms = float(np.sqrt(np.mean(frm ** 2))) if frm.size > 0 else 0.0
            if rms < silence_rms_threshold:
                cur_run += 1
                if cur_run > best_run:
                    best_run = cur_run
            else:
                cur_run = 0
        max_contig_sec = max(direct_silence_sec, round(best_run * 0.02, 3))

    return direct_silence_sec, max_contig_sec



def clean_word(word: str) -> str:
    """Strip whitespace and punctuation for string comparison.
    Preserves decimal notation (e.g. '0.8', '13,5' -> '13.5').
    """
    cleaned = word.strip(" .,!?;:—–-…()[]\"'“”„«»¿¡$€£¥₫").lower()
    if re.fullmatch(r"-?\d+(?:[.,]\d+)+", cleaned):
        return cleaned.replace(",", ".")
    return re.sub(r"[^\w\u00C0-\u1EF9]", "", cleaned)


def verify_decimal_separator_hypothesis(
    audio_path: str | None,
    audio_data: np.ndarray | None,
    sample_rate: int,
    t_start_whole: float,
    t_end_whole: float,
    t_start_frac: float,
    t_end_frac: float,
    whole_exp: str,
    frac_exp: str,
    src_dec_words: list[str],
    whisper_model: Any | None = None,
    language: str | None = None,
    eff_speed: float = 1.0,
    total_audio_duration: float = 0.0,
) -> tuple[str, str]:
    """Rigorous Two-Hypothesis Audio Verification for Decimal Separators.
    Evaluates:
      Hypothesis A: TTS pronounced both digits AND the separator ('point', 'phẩy', 'chấm', 'dot').
                    ASR merely split the formatted number into separated tokens ('0 8').
      Hypothesis B: TTS omitted / swallowed the separator, pronouncing only whole and fraction
                    ('zero eight', 'hai tám'). This is a true TTS synthesis defect.

    Returns:
      (verdict, explanation)
      verdict in ("pass", "missing", "unverified")
    """
    inter_digit_gap = t_start_frac - t_end_whole
    total_dec_dur = t_end_frac - t_start_whole

    # 1. Definite Fast Omission:
    # If the digits are spoken consecutively with no gap and very short duration,
    # there is physically no acoustic space for 'point' or 'phẩy'.
    if inter_digit_gap < 0.06 and total_dec_dur < (0.35 / eff_speed):
        return "missing", "Khoảng cách giữa hai số quá ngắn, không có âm thanh từ ngắt"

    # 2. Targeted Audio Slice Second-Pass Transcription:
    # Extract audio slice around [t_start_whole - 0.06, t_end_frac + 0.06]
    # This evaluates actual phonetic content of the audio slice without guessing from duration alone.
    if whisper_model is not None and (audio_path is not None or audio_data is not None):
        t_slice_start = max(0.0, t_start_whole - 0.06)
        max_dur = total_audio_duration if total_audio_duration > 0 else (t_end_frac + 0.06)
        t_slice_end = min(max_dur, t_end_frac + 0.06)

        slice_mono: np.ndarray | None = None
        sr_used = sample_rate if sample_rate > 0 else 16000

        if audio_data is not None and sample_rate > 0:
            s1 = int(round(t_slice_start * sample_rate))
            s2 = min(audio_data.size, int(round(t_slice_end * sample_rate)))
            if s2 > s1:
                slice_mono = audio_data[s1:s2]
                sr_used = sample_rate
        elif audio_path and os.path.exists(audio_path):
            try:
                import soundfile as sf
                info = sf.info(audio_path)
                sr_used = int(info.samplerate)
                s1 = int(round(t_slice_start * sr_used))
                frames_to_read = int(round((t_slice_end - t_slice_start) * sr_used))
                data, _ = sf.read(audio_path, start=s1, stop=s1 + frames_to_read, dtype="float32", always_2d=True)
                slice_mono = data.mean(axis=1)
            except Exception as rd_err:
                log(f"[audio_quality] Error reading slice from audio_path: {rd_err}")

        if slice_mono is not None and slice_mono.size >= int(0.10 * sr_used):
            import tempfile
            tmp_slice = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
            tmp_slice_name = tmp_slice.name
            tmp_slice.close()
            try:
                import soundfile as sf
                sf.write(tmp_slice_name, slice_mono, sr_used, subtype="PCM_16")
                lang_code = None if not language or language == "auto" else language
                segments_iter, _ = whisper_model.transcribe(
                    tmp_slice_name,
                    language=lang_code,
                    beam_size=5,
                    word_timestamps=True,
                    vad_filter=False,
                )
                slice_segments = list(segments_iter)

                slice_text = " ".join((seg.text or "") for seg in slice_segments).strip().lower()
                slice_words = [clean_word(w.word) for seg in slice_segments for w in (seg.words or []) if w.word]

                sep_tokens = {"point", "dot", "phẩy", "phay", "chấm", "cham"}
                has_separator_word = any(w in sep_tokens for w in slice_words) or any(
                    t in sep_tokens for t in re.findall(r"\w+", slice_text)
                )
                has_decimal_notation = bool(
                    re.search(rf"\b{re.escape(whole_exp)}[.,]{re.escape(frac_exp)}\b", slice_text)
                ) or bool(re.search(r"\b\d+[.,]\d+\b", slice_text))

                if has_separator_word or has_decimal_notation:
                    # Hypothesis A confirmed: Separator was articulated and recognized
                    return "pass", "Xác nhận phát âm từ ngắt qua nhận dạng lát cắt âm thanh"

                # Check gap acoustic energy between digits
                gap_rms = 0.0
                gap_zcr = 0.0
                if audio_data is not None and sample_rate > 0:
                    g1 = int(round(t_end_whole * sample_rate))
                    g2 = int(round(t_start_frac * sample_rate))
                    if g2 > g1 and g1 < audio_data.size:
                        gap_slice = audio_data[g1:min(audio_data.size, g2)]
                        if gap_slice.size > 0:
                            gap_rms = float(np.sqrt(np.mean(gap_slice ** 2)))
                            gap_zcr = float(np.mean(np.abs(np.diff(np.signbit(gap_slice)))))

                # If the slice transcript produced digits without separator:
                # E.g. "zero eight", "0 8", "không tám", or digits matching whole & frac
                if gap_rms < 0.015 or inter_digit_gap < 0.10:
                    # Hypothesis B confirmed: The gap is pure silence / pause, even if slow!
                    return "missing", "Xác nhận nuốt từ ngắt: âm thanh chỉ đọc hai chữ số kèm khoảng lặng"

                if gap_zcr < 0.08:
                    # Low frequency ambient noise / rumble, no consonant articulation
                    return "missing", "Khoảng cách giữa hai chữ số chỉ là tạp âm tần số thấp, không chứa từ ngắt"

                # If slice transcript explicitly gave words without separator:
                return "missing", "Nhận dạng lát cắt xác nhận chỉ phát âm các chữ số, không phát âm từ ngắt"
            except Exception as e:
                log(f"[audio_quality] Error in targeted slice transcription: {e}")
            finally:
                if os.path.exists(tmp_slice_name):
                    try:
                        os.remove(tmp_slice_name)
                    except Exception:
                        pass

    # 3. Fallback when whisper_model is not available:
    if audio_data is not None and sample_rate > 0:
        if inter_digit_gap < 0.08:
            return "missing", "Khoảng cách giữa hai chữ số quá ngắn, nuốt từ ngắt"
        g1 = int(round(t_end_whole * sample_rate))
        g2 = int(round(t_start_frac * sample_rate))
        if g2 > g1 and g1 < audio_data.size:
            gap_slice = audio_data[g1:min(audio_data.size, g2)]
            gap_rms = float(np.sqrt(np.mean(gap_slice ** 2))) if gap_slice.size > 0 else 0.0
            if gap_rms < 0.012:
                return "missing", "Khoảng lặng giữa hai chữ số hoàn toàn im lặng, nuốt từ ngắt"
            else:
                return "unverified", "Chưa kiểm chứng: có năng lượng âm thanh trong khoảng cách nhưng chưa có mô hình nhận dạng để xác minh"
        else:
            return "missing", "Không có khoảng cách giữa hai chữ số"

    # Pure synthetic mock word list without waveform:
    if inter_digit_gap < 0.08 or total_dec_dur < 0.40:
        return "missing", "Thời lượng hoặc khoảng cách quá ngắn"

    return "pass", "Dữ liệu ASR mô phỏng"


def _measure_token_active_duration_sec(
    t_start: float,
    t_end: float,
    next_word_start: float,
    audio_data: np.ndarray | None,
    sample_rate: int,
    total_dur: float,
    silence_rms_threshold: float = 0.015,
) -> float:
    """Measures true active speech duration for an ASR token, extending `t_end` over contiguous
    active frames when Whisper DTW clips sentence-final or pre-pause tokens early.
    """
    base_dur = max(0.0, t_end - t_start)
    if audio_data is None or sample_rate <= 0 or audio_data.size == 0:
        return base_dur

    limit_sec = min(
        total_dur if total_dur > 0 else (audio_data.size / float(sample_rate)),
        next_word_start if next_word_start > t_start else (t_end + 0.75),
        t_end + 0.75,
    )
    if limit_sec <= t_end + 0.02:
        return base_dur

    frame_sz = max(1, int(round(0.02 * sample_rate)))
    scan_start = max(0, int(round(max(t_start, t_end - 0.02) * sample_rate)))
    scan_end = min(audio_data.size, int(round(limit_sec * sample_rate)))
    if scan_end <= scan_start:
        return base_dur

    true_end = t_end
    silent_run = 0
    pos = scan_start
    while pos + frame_sz <= scan_end:
        frm = audio_data[pos : pos + frame_sz]
        rms = float(np.sqrt(np.mean(frm ** 2))) if frm.size > 0 else 0.0
        if rms >= silence_rms_threshold:
            silent_run = 0
            true_end = max(true_end, (pos + frame_sz) / float(sample_rate))
        else:
            silent_run += 1
            if silent_run >= 4:  # >= 80ms contiguous silence ends the word
                break
        pos += frame_sz

    return max(base_dur, true_end - t_start)


def _verify_acronym_slice_with_whisper(
    audio_path: str | None,
    audio_data: np.ndarray | None,
    sample_rate: int,
    asr_words: list[dict[str, Any]],
    j1: int,
    j2: int,
    active_end_sec: float,
    whisper_model: Any,
    language: str | None,
    total_dur: float,
) -> list[dict[str, Any]]:
    """Extracts an isolated audio slice around `asr_words[j1:j2]` (including 1 preceding word
    for local onset framing, without the surrounding sentence so Whisper's LM cannot auto-correct
    a mispronounced acronym) and returns the transcribed slice words for the acronym.
    """
    if whisper_model is None or not asr_words or j1 >= len(asr_words):
        return []

    t_start = float(asr_words[j1].get("startSec", 0.0))
    t_end = max(
        active_end_sec,
        float(asr_words[min(len(asr_words) - 1, max(j1, j2 - 1))].get("endSec", t_start)),
    )

    include_prev = False
    prev_word_clean = ""
    slice_start = max(0.0, t_start - 0.08)
    if j1 > 0:
        prev_w = asr_words[j1 - 1]
        prev_end = float(prev_w.get("endSec", 0.0))
        prev_start = float(prev_w.get("startSec", 0.0))
        if 0.0 <= (t_start - prev_end) <= 0.35 and (t_start - prev_start) <= 0.85:
            slice_start = max(0.0, prev_start - 0.05)
            include_prev = True
            prev_word_clean = clean_word(prev_w.get("word", ""))

    max_dur = total_dur if total_dur > 0 else (t_end + 0.14)
    slice_end = min(max_dur, t_end + 0.14)
    if slice_end - slice_start < 0.12:
        return []

    slice_mono: np.ndarray | None = None
    sr_used = sample_rate if sample_rate > 0 else 16000
    if audio_data is not None and sample_rate > 0:
        s1 = max(0, int(round(slice_start * sample_rate)))
        s2 = min(audio_data.size, int(round(slice_end * sample_rate)))
        if s2 > s1:
            slice_mono = audio_data[s1:s2]
            sr_used = sample_rate
    elif audio_path and os.path.exists(audio_path):
        try:
            import soundfile as sf
            info = sf.info(audio_path)
            sr_used = int(info.samplerate)
            s1 = max(0, int(round(slice_start * sr_used)))
            frames = int(round((slice_end - slice_start) * sr_used))
            data, _ = sf.read(audio_path, start=s1, stop=s1 + frames, dtype="float32", always_2d=True)
            slice_mono = data.mean(axis=1)
        except Exception as e:
            log(f"[audio_quality] Error reading acronym slice: {e}")
            return []

    if slice_mono is None or slice_mono.size < int(0.10 * sr_used):
        return []

    import tempfile
    tmp_f = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp_name = tmp_f.name
    tmp_f.close()
    try:
        import soundfile as sf
        sf.write(tmp_name, slice_mono, sr_used, subtype="PCM_16")
        lang_code = None if not language or language == "auto" else language
        segs_iter, _ = whisper_model.transcribe(
            tmp_name,
            language=lang_code,
            beam_size=5,
            word_timestamps=True,
            vad_filter=False,
        )
        out_words: list[dict[str, Any]] = []
        for seg in segs_iter:
            for w in (seg.words or []):
                if w.word and w.word.strip():
                    out_words.append({
                        "word": w.word,
                        "startSec": round(slice_start + float(w.start), 3),
                        "endSec": round(slice_start + float(w.end), 3),
                        "probability": round(float(w.probability), 4),
                        "tokenSource": "secondary_slice",
                    })
        if include_prev and out_words:
            # Strip any leading context words that precede t_start or match preceding ASR words
            prev_candidates = {prev_word_clean}
            if j1 >= 2:
                prev_candidates.add(clean_word(str(asr_words[j1 - 2].get("word", ""))))
            while len(out_words) >= 2:
                first_c = clean_word(out_words[0]["word"])
                first_end = float(out_words[0].get("endSec", 0.0))
                if (
                    first_c in prev_candidates
                    or any(are_words_equivalent(first_c, pc) for pc in prev_candidates if pc)
                    or (first_end <= t_start + 0.06 and first_c in {"the", "a", "an", "at", "in", "of", "to", "by", "with", "where", "from", "on"})
                ):
                    out_words = out_words[1:]
                else:
                    break
        # Strip any trailing context words that belong to the next word after the acronym (j2)
        if j2 < len(asr_words) and out_words:
            next_c = clean_word(str(asr_words[j2].get("word", "")))
            while len(out_words) >= 2:
                last_c = clean_word(out_words[-1]["word"])
                last_start = float(out_words[-1].get("startSec", 0.0))
                if not last_c or (
                    next_c
                    and (
                        last_c == next_c
                        or are_words_equivalent(last_c, next_c)
                        or (len(last_c) >= 2 and next_c.startswith(last_c) and last_start >= t_end - 0.05)
                    )
                ):
                    out_words = out_words[:-1]
                else:
                    break
        return out_words
    except Exception as e:
        log(f"[audio_quality] Acronym slice transcribe error: {e}")
        return []
    finally:
        if os.path.exists(tmp_name):
            try:
                os.remove(tmp_name)
            except Exception:
                pass


def _is_subsequence_with_diff(sub: list[str], full: list[str]) -> tuple[bool, list[str]]:
    """Checks whether `sub` is an ordered subsequence of `full`.
    If True, returns `(True, unmatched_elements_from_full_in_order)`.
    """
    if not sub or len(sub) > len(full):
        return False, []
    sub_idx = 0
    unmatched: list[str] = []
    for item in full:
        if sub_idx < len(sub) and item == sub[sub_idx]:
            sub_idx += 1
        else:
            unmatched.append(item)
    if sub_idx == len(sub):
        return True, unmatched
    return False, []


def _decompose_asr_slice_for_acronym(
    asr_slice: list[dict[str, Any]],
    expected_letters: list[str],
    source_span: str,
) -> tuple[list[str], bool]:
    """Decomposes a sequence of ASR word objects into observed letters / `<word:...>` tokens."""
    from .pronunciation import decompose_asr_token_to_letters

    observed: list[str] = []
    has_blend = False
    allow_ampersand_and = "&" in source_span
    k = 0
    n = len(asr_slice)
    while k < n:
        raw_w = str(asr_slice[k].get("word", "")).strip()
        c_w = clean_word(raw_w)
        if not c_w:
            k += 1
            continue
        if allow_ampersand_and and c_w == "and":
            k += 1
            continue
        if c_w == "double" and (k + 1) < n and clean_word(str(asr_slice[k + 1].get("word", ""))) in ("u", "you"):
            observed.append("w")
            k += 2
            continue
        lets, is_blend = decompose_asr_token_to_letters(raw_w, expected_letters)
        observed.extend(lets)
        if is_blend:
            has_blend = True
        k += 1
    return observed, has_blend


def _collapse_acronym_letter_spans(
    asr_spans: list[Any],
    asr_words: list[dict[str, Any]],
    pronunciation_mapping: list[dict[str, Any]],
) -> list[Any]:
    """Collapses contiguous runs of ASR letter/letter-name tokens that correspond to
    `letter_by_letter` entries in `pronunciation_mapping` into single spans so `SequenceMatcher`
    aligns spelled-out acronyms cleanly as a unit.
    """
    from .number_normalizer import NormalizedSpan
    from .pronunciation import decompose_asr_token_to_letters

    letter_entries = [
        pm for pm in pronunciation_mapping
        if pm.get("mode") == "letter_by_letter" and len(pm.get("expectedLetters") or []) >= 2
    ]
    if not letter_entries or len(asr_spans) < 2:
        return asr_spans

    out_spans: list[Any] = []
    idx = 0
    n_spans = len(asr_spans)

    while idx < n_spans:
        sp = asr_spans[idx]
        if sp.is_number or (sp.orig_end - sp.orig_start) != 1:
            out_spans.append(sp)
            idx += 1
            continue

        best_end_idx = idx
        best_canonical = ""

        for pm in letter_entries:
            exp_letters: list[str] = list(pm.get("expectedLetters") or [])
            exp_set = set(exp_letters)
            allow_and = "&" in str(pm.get("sourceSpan", ""))

            acc_letters: list[str] = []
            cur = idx
            while cur < n_spans:
                cur_sp = asr_spans[cur]
                if cur_sp.is_number or (cur_sp.orig_end - cur_sp.orig_start) != 1:
                    break
                raw_tok = str(asr_words[cur_sp.orig_start].get("word", "")).strip()
                c_tok = clean_word(raw_tok)
                if not c_tok:
                    break

                if allow_and and c_tok == "and" and acc_letters:
                    cur += 1
                    continue

                if (
                    c_tok == "double"
                    and (cur + 1) < n_spans
                    and (asr_spans[cur + 1].orig_end - asr_spans[cur + 1].orig_start) == 1
                    and clean_word(str(asr_words[asr_spans[cur + 1].orig_start].get("word", ""))) in ("u", "you")
                    and "w" in exp_set
                ):
                    tok_lets, is_blend = ["w"], False
                    step = 2
                else:
                    # Do not let a lowercase article 'a' start or extend an acronym run unless uppercase
                    core_strip = re.sub(r"^[^\w\u00C0-\u1EF9]+|[^\w\u00C0-\u1EF9]+$", "", raw_tok)
                    if core_strip == "a" and not acc_letters:
                        break
                    tok_lets, is_blend = decompose_asr_token_to_letters(raw_tok, exp_letters)
                    step = 1

                if is_blend or not tok_lets or not all(ch in exp_set for ch in tok_lets):
                    break

                # First token in run must match the start of exp_letters
                if not acc_letters and tok_lets[0] != exp_letters[0]:
                    break

                # If we already matched exp_letters completely, only keep consuming if it's a repeated trailing letter
                if acc_letters == exp_letters and not all(ch == exp_letters[-1] for ch in tok_lets):
                    break

                acc_letters.extend(tok_lets)
                cur += step

            if (cur - idx) >= 2 and len(acc_letters) >= 2:
                # Prefer exact match to exp_letters, otherwise longest span run
                cand_canon = "".join(acc_letters)
                if acc_letters == exp_letters or (cur > best_end_idx and best_canonical != "".join(exp_letters)):
                    best_end_idx = cur
                    best_canonical = cand_canon

        if best_end_idx > idx:
            out_spans.append(
                NormalizedSpan(
                    canonical=best_canonical,
                    orig_start=asr_spans[idx].orig_start,
                    orig_end=asr_spans[best_end_idx - 1].orig_end,
                    is_number=False,
                )
            )
            idx = best_end_idx
        else:
            out_spans.append(sp)
            idx += 1

    return out_spans


def _evaluate_pronunciation_entry(
    pm: dict[str, Any],
    asr_words: list[dict[str, Any]],
    j1: int,
    j2: int,
    eff_speed: float,
    audio_data: np.ndarray | None,
    sample_rate: int,
    audio_path: str | None,
    whisper_model: Any | None,
    language: str | None,
    total_dur: float,
) -> tuple[str, dict[str, Any] | None]:
    """Verifies an aligned ASR slice `asr_words[j1:j2]` against a `PronunciationMappingEntry`.
    Returns `(verdict, issue_or_none)` where `verdict` is in `("pass", "warning", "unverified")`.
    """
    source_span = str(pm.get("sourceSpan") or "")
    spoken_form = str(pm.get("spokenForm") or "")
    mode = str(pm.get("mode") or "")
    expected_letters: list[str] = list(pm.get("expectedLetters") or [])
    forbidden_words: set[str] = {str(w).lower() for w in (pm.get("forbiddenWords") or [])}

    asr_slice = asr_words[j1:j2] if (0 <= j1 < j2 <= len(asr_words)) else []

    if asr_slice:
        t_start = float(asr_slice[0].get("startSec", 0.0))
        t_end = float(asr_slice[-1].get("endSec", t_start))
    elif j1 > 0 and j1 - 1 < len(asr_words):
        t_start = float(asr_words[j1 - 1].get("endSec", 0.0))
        t_end = float(asr_words[j1].get("startSec", t_start)) if j1 < len(asr_words) else t_start
    else:
        t_start, t_end = 0.0, 0.0
    ts = format_timestamp(t_start)

    if not asr_slice:
        return "warning", {
            "severity": "warning",
            "code": "MISSING_WORD",
            "message": f'Nghi vấn nuốt chữ tại từ "{source_span}" — khoảng {ts}. Vui lòng nghe kiểm tra.',
            "words": [source_span],
            "timeRange": [round(t_start, 3), round(t_end, 3)],
        }

    probs = [float(w.get("probability", 1.0)) for w in asr_slice]
    min_prob = min(probs) if probs else 1.0
    max_prob = max(probs) if probs else 1.0
    raw_joined = " ".join(str(w.get("word", "")).strip() for w in asr_slice).strip()

    # Mode 1: Custom User Pronunciation Rule (not letter-by-letter)
    if mode == "custom" and not expected_letters:
        exp_words = [clean_word(w) for w in tokenize_text_with_delimiters(spoken_form)[0] if clean_word(w)]
        obs_words = [clean_word(str(w.get("word", ""))) for w in asr_slice if clean_word(str(w.get("word", "")))]
        if exp_words and (
            (len(obs_words) == len(exp_words) and all(are_words_equivalent(e, o) for e, o in zip(exp_words, obs_words)))
            or "".join(obs_words) == "".join(exp_words)
            or "".join(obs_words) == clean_word(source_span)
        ):
            if min_prob < 0.50:
                return "unverified", {
                    "severity": "unverified",
                    "code": "UNVERIFIED_ACRONYM",
                    "message": f'Chưa thể xác minh quy tắc phát âm "{source_span}" → "{spoken_form}" do độ tin cậy ASR thấp ({min_prob:.2f}) — khoảng {ts}.',
                    "words": [source_span],
                    "timeRange": [round(t_start, 3), round(t_end, 3)],
                }
            return "pass", None
        if max_prob < 0.50:
            return "unverified", {
                "severity": "unverified",
                "code": "UNVERIFIED_ACRONYM",
                "message": f'Chưa thể xác minh quy tắc phát âm "{source_span}" → "{spoken_form}" do độ tin cậy ASR thấp ({max_prob:.2f}) — khoảng {ts}.',
                "words": [source_span],
                "timeRange": [round(t_start, 3), round(t_end, 3)],
            }
        return "warning", {
            "severity": "warning",
            "code": "SUSPECTED_MISPRONUNCIATION",
            "message": f'Nghi vấn chưa phát âm đúng quy tắc "{source_span}" → "{spoken_form}" (ASR ghi nhận "{raw_joined}") — khoảng {ts}. Vui lòng nghe kiểm tra.',
            "words": [source_span, raw_joined],
            "timeRange": [round(t_start, 3), round(t_end, 3)],
        }

    # Mode 2: Letter-by-letter Initialism / Acronym
    if mode != "letter_by_letter" or not expected_letters:
        return "pass", None

    joined_expected = "".join(expected_letters)
    num_syllables = sum(2 if ch == "w" else 1 for ch in expected_letters)

    # Check if ASR returned a single collapsed word matching the acronym letters (e.g. "GVEC", "VPP", "WHO", "who")
    if len(asr_slice) == 1 and clean_word(str(asr_slice[0].get("word", ""))) == joined_expected:
        w0 = asr_slice[0]
        raw_w0 = str(w0.get("word", "")).strip()
        raw_core = re.sub(r"^[^\w\u00C0-\u1EF9]+|[^\w\u00C0-\u1EF9]+$", "", raw_w0)
        next_start = float(asr_words[j2].get("startSec", total_dur)) if j2 < len(asr_words) else total_dur
        active_dur = _measure_token_active_duration_sec(
            t_start, t_end, next_start, audio_data, sample_rate, total_dur
        )

        # Check forbidden ordinary-word homographs (e.g. organization "WHO" read as pronoun "who")
        if raw_core.lower() in forbidden_words:
            # In synthetic tests (audio_data is None) or when active acoustic duration is shorter than
            # full multi-letter articulation (< 0.14s * num_syllables), lowercase/titlecase ("who", "Who")
            # confirms the 1-syllable ordinary word reading rather than spelled-out letters.
            if not raw_core.isupper() and (
                audio_data is None or active_dur < (0.14 * num_syllables) / eff_speed
            ):
                return "warning", {
                    "severity": "warning",
                    "code": "SUSPECTED_MISPRONUNCIATION",
                    "message": (
                        f'Nghi vấn đọc từ viết tắt "{source_span}" thành từ thường "{raw_core}" '
                        f'(cần đánh vần "{" ".join(l.upper() for l in expected_letters)}") — khoảng {ts}. Vui lòng nghe kiểm tra.'
                    ),
                    "words": [source_span, raw_core.lower()],
                    "timeRange": [round(t_start, 3), round(t_end, 3)],
                }

        # Real-audio isolated-slice verification when duration is suspiciously short or confidence is low
        min_expected_dur = (0.135 * num_syllables) / eff_speed
        if whisper_model is not None and (audio_data is not None or audio_path is not None):
            needs_slice_check = (
                min_prob < 0.55
                or active_dur < min_expected_dur
            )
            if needs_slice_check:
                slice_words = _verify_acronym_slice_with_whisper(
                    audio_path=audio_path,
                    audio_data=audio_data,
                    sample_rate=sample_rate,
                    asr_words=asr_words,
                    j1=j1,
                    j2=j2,
                    active_end_sec=t_start + active_dur,
                    whisper_model=whisper_model,
                    language=language,
                    total_dur=total_dur,
                )
                if not slice_words:
                    return "unverified", {
                        "severity": "unverified",
                        "code": "UNVERIFIED_ACRONYM",
                        "message": f'Chưa thể xác minh phát âm từ viết tắt "{source_span}" qua lát cắt âm thanh — khoảng {ts}.',
                        "words": [source_span],
                        "timeRange": [round(t_start, 3), round(t_end, 3)],
                    }
                # Check if isolated slice still collapsed to a single uppercase token matching joined_expected
                if len(slice_words) == 1 and clean_word(str(slice_words[0].get("word", ""))) == joined_expected:
                    sw_raw = re.sub(r"^[^\w\u00C0-\u1EF9]+|[^\w\u00C0-\u1EF9]+$", "", str(slice_words[0].get("word", "")).strip())
                    sw_prob = float(slice_words[0].get("probability", min_prob))
                    if sw_raw.lower() in forbidden_words and not sw_raw.isupper():
                        return "warning", {
                            "severity": "warning",
                            "code": "SUSPECTED_MISPRONUNCIATION",
                            "message": (
                                f'Nghi vấn đọc từ viết tắt "{source_span}" thành từ thường "{sw_raw}" '
                                f'(cần đánh vần "{" ".join(l.upper() for l in expected_letters)}") — khoảng {ts}. Vui lòng nghe kiểm tra.'
                            ),
                            "words": [source_span, sw_raw.lower()],
                            "timeRange": [round(t_start, 3), round(t_end, 3)],
                        }
                    if active_dur < (0.105 * num_syllables) / eff_speed:
                        return "warning", {
                            "severity": "warning",
                            "code": "SUSPECTED_MISPRONUNCIATION",
                            "message": (
                                f'Nghi vấn đọc lướt hoặc đọc sai từ viết tắt "{source_span}" '
                                f'(thời lượng phát âm {active_dur:.2f}s quá ngắn cho {len(expected_letters)} chữ cái) — khoảng {ts}. Vui lòng nghe kiểm tra.'
                            ),
                            "words": [source_span],
                            "timeRange": [round(t_start, 3), round(t_end, 3)],
                        }
                    if sw_prob < 0.60:
                        return "unverified", {
                            "severity": "unverified",
                            "code": "UNVERIFIED_ACRONYM",
                            "message": f'Chưa thể xác minh phát âm từ viết tắt "{source_span}" do độ tin cậy ASR thấp ({sw_prob:.2f}) — khoảng {ts}.',
                            "words": [source_span],
                            "timeRange": [round(t_start, 3), round(t_end, 3)],
                        }
                    return "pass", None
                else:
                    # Isolated slice revealed different tokens (e.g. ["GVAC"], ["VP", "people."], ["W.A."], ["G", "V", "E", "C"])!
                    asr_slice = slice_words
                    raw_joined = " ".join(str(w.get("word", "")).strip() for w in asr_slice).strip()
                    probs = [float(w.get("probability", 1.0)) for w in asr_slice]
                    min_prob = min(probs) if probs else min_prob
                    max_prob = max(probs) if probs else max_prob
            else:
                return "pass", None
        else:
            # Synthetic test / no whisper_model available:
            if min_prob < 0.65:
                return "unverified", {
                    "severity": "unverified",
                    "code": "UNVERIFIED_ACRONYM",
                    "message": f'Chưa thể xác minh phát âm từ viết tắt "{source_span}" do độ tin cậy ASR thấp ({min_prob:.2f}) — khoảng {ts}.',
                    "words": [source_span],
                    "timeRange": [round(t_start, 3), round(t_end, 3)],
                }
            if active_dur > 0 and active_dur < (0.095 * num_syllables) / eff_speed:
                return "warning", {
                    "severity": "warning",
                    "code": "SUSPECTED_MISPRONUNCIATION",
                    "message": (
                        f'Nghi vấn đọc lướt hoặc đọc sai từ viết tắt "{source_span}" '
                        f'(thời lượng {active_dur:.2f}s quá ngắn cho {len(expected_letters)} chữ cái) — khoảng {ts}. Vui lòng nghe kiểm tra.'
                    ),
                    "words": [source_span],
                    "timeRange": [round(t_start, 3), round(t_end, 3)],
                }
            return "pass", None

    # Decompose `asr_slice` into observed letters / syllable blends
    observed_letters, has_blend = _decompose_asr_slice_for_acronym(asr_slice, expected_letters, source_span)

    # 1. Exact letter-by-letter match (e.g. ["G", "V", "E", "C"] or ["gee", "vee", "ee", "see"])
    if not has_blend and observed_letters == expected_letters:
        if min_prob < 0.45:
            return "unverified", {
                "severity": "unverified",
                "code": "UNVERIFIED_ACRONYM",
                "message": f'Chưa thể xác minh phát âm từ viết tắt "{source_span}" do độ tin cậy ASR thấp ({min_prob:.2f}) — khoảng {ts}.',
                "words": [source_span],
                "timeRange": [round(t_start, 3), round(t_end, 3)],
            }
        return "pass", None

    # 2. Check forbidden ordinary-word reading (e.g. WHO -> "who")
    for fw in forbidden_words:
        if f"<word:{fw}>" in observed_letters:
            return "warning", {
                "severity": "warning",
                "code": "SUSPECTED_MISPRONUNCIATION",
                "message": (
                    f'Nghi vấn đọc từ viết tắt "{source_span}" thành từ thường "{fw}" '
                    f'(cần đánh vần "{" ".join(l.upper() for l in expected_letters)}") — khoảng {ts}. Vui lòng nghe kiểm tra.'
                ),
                "words": [source_span, fw],
                "timeRange": [round(t_start, 3), round(t_end, 3)],
            }

    # 3. Partial syllable blend (e.g. GVEC -> "G V ek" or "GVAC Key" or "VP people")
    if has_blend:
        if max_prob < 0.45:
            return "unverified", {
                "severity": "unverified",
                "code": "UNVERIFIED_ACRONYM",
                "message": f'Chưa thể xác minh phát âm từ viết tắt "{source_span}" do độ tin cậy ASR thấp ({max_prob:.2f}) — khoảng {ts}.',
                "words": [source_span],
                "timeRange": [round(t_start, 3), round(t_end, 3)],
            }
        return "warning", {
            "severity": "warning",
            "code": "SUSPECTED_MISPRONUNCIATION",
            "message": (
                f'Nghi vấn đọc sai hoặc đọc ghép âm từ viết tắt "{source_span}" '
                f'(ASR ghi nhận "{raw_joined}", cần đọc từng chữ "{" ".join(l.upper() for l in expected_letters)}") — khoảng {ts}. Vui lòng nghe kiểm tra.'
            ),
            "words": [source_span, raw_joined],
            "timeRange": [round(t_start, 3), round(t_end, 3)],
        }

    # 4. Pure letter sequence with missing, extra, or substituted letters
    if len(observed_letters) < len(expected_letters):
        is_sub, missing_list = _is_subsequence_with_diff(observed_letters, expected_letters)
        if is_sub and missing_list:
            missing_str = "".join(missing_list).upper()
            obs_display = "".join(observed_letters).upper() if len(asr_slice) == 1 else " ".join(l.upper() for l in observed_letters)
            return "warning", {
                "severity": "warning",
                "code": "MISSING_WORD",
                "message": (
                    f'Nghi vấn đọc thiếu âm "{missing_str}" trong từ viết tắt "{source_span}" '
                    f'(ASR chỉ ghi nhận "{obs_display}") — khoảng {ts}. Vui lòng nghe kiểm tra.'
                ),
                "words": [source_span, missing_str],
                "timeRange": [round(t_start, 3), round(t_end, 3)],
            }

    if len(observed_letters) > len(expected_letters):
        is_sup, extra_list = _is_subsequence_with_diff(expected_letters, observed_letters)
        if is_sup and extra_list:
            extra_str = "".join(extra_list).upper()
            obs_display = " ".join(l.upper() for l in observed_letters)
            return "warning", {
                "severity": "warning",
                "code": "REPEATED_WORD",
                "message": (
                    f'Nghi vấn đọc thừa hoặc lặp chữ cái "{extra_str}" trong từ viết tắt "{source_span}" '
                    f'(ASR ghi nhận "{obs_display}") — khoảng {ts}. Vui lòng nghe kiểm tra.'
                ),
                "words": [source_span, extra_str],
                "timeRange": [round(t_start, 3), round(t_end, 3)],
            }

    if max_prob < 0.45:
        return "unverified", {
            "severity": "unverified",
            "code": "UNVERIFIED_ACRONYM",
            "message": f'Chưa thể xác minh phát âm từ viết tắt "{source_span}" do độ tin cậy ASR thấp ({max_prob:.2f}) — khoảng {ts}.',
            "words": [source_span],
            "timeRange": [round(t_start, 3), round(t_end, 3)],
        }

    obs_display = raw_joined or " ".join(l.upper() for l in observed_letters)
    return "warning", {
        "severity": "warning",
        "code": "SUSPECTED_MISPRONUNCIATION",
        "message": (
            f'Nghi vấn phát âm sai từ viết tắt "{source_span}" '
            f'(ASR ghi nhận "{obs_display}", cần đọc "{" ".join(l.upper() for l in expected_letters)}") — khoảng {ts}. Vui lòng nghe kiểm tra.'
        ),
        "words": [source_span, obs_display],
        "timeRange": [round(t_start, 3), round(t_end, 3)],
    }


MAX_SECONDARY_SLICE_CHECKS = 3


def _verify_low_confidence_equal_word(
    source_words: list[str],
    source_words_clean: list[str],
    src_idx: int,
    w_obj: dict[str, Any],
    audio_data: np.ndarray | None,
    sample_rate: int,
    audio_path: str | None,
    whisper_model: Any | None,
    language: str | None,
    total_dur: float,
    slice_budget: list[int] | None = None,
) -> dict[str, Any] | None:
    """When Whisper matches a multi-syllable content word in `tag == 'equal'` but with abnormally low
    acoustic confidence (probability < 0.55), Whisper's language model may have auto-corrected a
    truncated/mispronounced word from surrounding context (e.g. 'Austin' pronounced as 'Austs' with prob=0.49).
    Runs a context-free targeted slice re-transcription around [startSec - 0.35s, endSec + 0.35s] to verify
    whether the word was genuinely articulated or truncated/distorted.
    """
    if whisper_model is None or (audio_data is None and audio_path is None):
        return None
    if slice_budget is not None and slice_budget[0] <= 0:
        return None
    if src_idx < 0 or src_idx >= len(source_words_clean):
        return None

    sw = source_words_clean[src_idx]
    if len(sw) < 4 or sw in WEAK_CLITIC_ARTICLES:
        return None

    w_raw = str(w_obj.get("word", "")).strip()
    if w_raw.startswith("-"):
        return None

    w_prob = float(w_obj.get("probability", 1.0))
    if w_prob >= 0.55:
        return None

    t_start = float(w_obj.get("startSec", 0.0))
    t_end = float(w_obj.get("endSec", 0.0))
    if t_end <= t_start:
        return None

    t_slice_start = max(0.0, t_start - 0.35)
    max_dur = total_dur if total_dur > 0 else (t_end + 0.35)
    t_slice_end = min(max_dur, t_end + 0.35)

    slice_mono: np.ndarray | None = None
    sr_used = sample_rate if sample_rate > 0 else 16000

    if audio_data is not None and sample_rate > 0:
        s1 = max(0, int(round(t_slice_start * sample_rate)))
        s2 = min(audio_data.size, int(round(t_slice_end * sample_rate)))
        if s2 > s1:
            slice_mono = audio_data[s1:s2]
            sr_used = sample_rate
    elif audio_path and os.path.exists(audio_path):
        try:
            import soundfile as sf
            info = sf.info(audio_path)
            sr_used = int(info.samplerate)
            s1 = max(0, int(round(t_slice_start * sr_used)))
            frames_to_read = int(round((t_slice_end - t_slice_start) * sr_used))
            data, _ = sf.read(audio_path, start=s1, stop=s1 + frames_to_read, dtype="float32", always_2d=True)
            slice_mono = data.mean(axis=1)
        except Exception:
            return None

    if slice_mono is None or slice_mono.size < int(0.15 * sr_used):
        return None

    if slice_budget is not None:
        slice_budget[0] -= 1

    import tempfile
    tmp_slice = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp_slice_name = tmp_slice.name
    tmp_slice.close()
    try:
        import soundfile as sf
        sf.write(tmp_slice_name, slice_mono, sr_used, subtype="PCM_16")
        lang_code = None if not language or language == "auto" else language
        seg_iter, _ = whisper_model.transcribe(
            tmp_slice_name,
            language=lang_code,
            beam_size=5,
            word_timestamps=True,
            vad_filter=False,
        )
        slice_words = [
            (w.word.strip(), clean_word(w.word), float(w.probability))
            for seg in seg_iter
            for w in (seg.words or [])
            if w.word and clean_word(w.word)
        ]
    except Exception:
        return None
    finally:
        if os.path.exists(tmp_slice_name):
            try:
                os.remove(tmp_slice_name)
            except Exception:
                pass

    if not slice_words:
        return None

    prev_src_clean = source_words_clean[src_idx - 1] if src_idx > 0 else ""
    next_src_clean = source_words_clean[src_idx + 1] if (src_idx + 1) < len(source_words_clean) else ""

    # If any word in the context-free slice matches the expected word with reasonable confidence (>= 0.25),
    # or is a compound concatenation of the neighbor + expected word (e.g. 'solid-state' + 'maker' -> 'StateMaker'),
    # then the low primary probability was just BPE capitalization/tokenization variance.
    for _, sw_clean_cand, sw_prob in slice_words:
        if sw_prob >= 0.25:
            if are_words_equivalent(sw, sw_clean_cand):
                return None
            # Do not override an exact primary ASR match when isolated slice differs only by coarticulated -s/-d/-ed suffix
            if sw_clean_cand in (sw + "s", sw + "d", sw + "ed") or sw in (sw_clean_cand + "s", sw_clean_cand + "d", sw_clean_cand + "ed"):
                return None
            if len(sw) >= 3 and (
                sw_clean_cand == prev_src_clean + sw
                or sw_clean_cand == sw + next_src_clean
                or (prev_src_clean and sw_clean_cand.endswith(sw) and prev_src_clean.endswith(sw_clean_cand[:-len(sw)]))
                or (next_src_clean and sw_clean_cand.startswith(sw) and next_src_clean.startswith(sw_clean_cand[len(sw):]))
            ):
                return None

    # Filter out immediate neighbor context words to inspect what Whisper heard at the target position
    non_ctx = [
        (raw_c, cln_c, pr_c)
        for raw_c, cln_c, pr_c in slice_words
        if cln_c not in (prev_src_clean, next_src_clean)
    ]
    if not non_ctx:
        return None

    best_raw, best_clean, _ = non_ctx[0]
    ts = format_timestamp(t_start)
    ctx_span = extract_context_span(source_words, src_idx, src_idx + 1)

    if (
        len(best_clean) >= 2
        and len(sw) >= len(best_clean) + 2
        and (sw.startswith(best_clean) or phonetic_key(sw).startswith(phonetic_key(best_clean)))
    ):
        return {
            "severity": "warning",
            "code": "PARTIAL_PRONUNCIATION",
            "message": f"Vùng '{ctx_span}' có dấu hiệu phát âm dở dang hoặc thiếu âm tiết ('{best_clean}') — khoảng {ts}. Vui lòng nghe lại.",
            "words": [sw, best_clean],
            "timeRange": [round(t_start, 3), round(t_end, 3)],
        }

    src_raw_tok = re.sub(r"^[^\w\u00C0-\u1EF9]+|[^\w\u00C0-\u1EF9]+$", "", source_words[src_idx]) or sw
    best_display = re.sub(r"^[^\w\u00C0-\u1EF9]+|[^\w\u00C0-\u1EF9]+$", "", best_raw) or best_clean
    return {
        "severity": "warning",
        "code": "SUSPECTED_MISPRONUNCIATION",
        "message": f"Nghi vấn phát âm sai từ '{src_raw_tok}' (ASR ghi nhận '{best_display}') — khoảng {ts}. Vui lòng nghe lại.",
        "words": [sw, best_clean],
        "timeRange": [round(t_start, 3), round(t_end, 3)],
    }


def _numeric_mismatch_review(
    expected: str,
    observed: str,
    asr_words: list[dict[str, Any]],
    j1: int,
    j2: int,
    whisper_model: Any | None,
    audio_data: np.ndarray | None,
    sample_rate: int,
    language: str | None,
    total_dur: float,
    slice_budget: list[int] | None = None,
) -> dict[str, Any] | None:
    """Re-check disagreeing number VALUES on a short audio slice.

    Matching spellings (one million vs 1.000.000) are handled by the
    normalizer before this point. Never declare 1.2 and 0.2 equivalent.
    A second ASR pass can clear a false positive; unresolved 1/0 decimal
    ambiguity is UNVERIFIED rather than a fabricated TTS pronunciation error.
    """
    t0 = float(asr_words[j1].get("startSec", 0.0)) if j1 < len(asr_words) else 0.0
    t1 = float(asr_words[min(j2 - 1, len(asr_words) - 1)].get("endSec", t0)) if asr_words else t0
    verdict = "mismatch"
    can_run_slice = (
        whisper_model is not None
        and audio_data is not None
        and sample_rate > 0
        and t1 > t0
        and (slice_budget is None or slice_budget[0] > 0)
    )
    if can_run_slice:
        import tempfile
        import soundfile as sf

        start = max(0.0, t0 - 0.14)
        end = min(total_dur or len(audio_data) / sample_rate, t1 + 0.14)
        segment = audio_data[max(0, int(start * sample_rate)):min(len(audio_data), int(end * sample_rate))]
        if segment.size >= int(0.12 * sample_rate):
            if slice_budget is not None:
                slice_budget[0] -= 1
            tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
            tmp_name = tmp.name
            tmp.close()
            try:
                sf.write(tmp_name, segment, sample_rate, subtype="PCM_16")
                lang = None if not language or language == "auto" else language
                segments, _ = whisper_model.transcribe(
                    tmp_name, language=lang, beam_size=5, word_timestamps=True, vad_filter=False
                )
                transcript = []
                for seg in segments:
                    seg_words = [w.word for w in (seg.words or []) if w.word]
                    transcript.extend(seg_words or (seg.text or "").split())
                numeric_values = [
                    span.canonical
                    for span in collapse_number_tokens(transcript, language)
                    if span.is_number
                ]
                if len(numeric_values) == 1:
                    found = numeric_values[0]
                    if are_number_expressions_equivalent(expected, found, language):
                        return None  # Secondary recognition confirms spoken number.
                    if not are_number_expressions_equivalent(observed, found, language):
                        verdict = "unverified"  # Two ASR passes disagree.
                else:
                    verdict = "unverified"
            except Exception as exc:
                log(f"[audio_quality] Numeric slice verification failed: {exc}")
                verdict = "unverified"
            finally:
                try:
                    os.remove(tmp_name)
                except OSError:
                    pass

        # Whisper commonly confuses 'one point X' and 'zero point X' even
        # after a second pass. Neither PASS nor WARNING is justified by ASR alone.
        e_parts = split_decimal_parts(expected)
        o_parts = split_decimal_parts(observed)
        if e_parts and o_parts and e_parts[1] == o_parts[1] and {e_parts[0], o_parts[0]} == {"0", "1"}:
            verdict = "unverified"

    t_text = format_timestamp(t0)
    if verdict == "unverified":
        return {
            "severity": "unverified",
            "code": "UNVERIFIED_NUMBER",
            "message": f"Chưa xác minh được số '{expected}' (ASR ghi '{observed}') — khoảng {t_text}. Cần nghe lại.",
            "words": [expected, observed],
            "timeRange": [round(t0, 3), round(t1, 3)],
        }
    return {
        "severity": "warning",
        "code": "SUSPECTED_MISPRONUNCIATION",
        "message": f"Nghi vấn đọc sai số '{expected}' (ASR ghi '{observed}') — khoảng {t_text}. Vui lòng nghe lại.",
        "words": [expected, observed],
        "timeRange": [round(t0, 3), round(t1, 3)],
    }


def analyze_word_alignment_issues(
    text: str,
    asr_words: list[dict[str, Any]],
    min_abnormal_pause_sec: float = 0.50,
    speed: float = 1.0,
    language: str | None = None,
    audio_duration_sec: float = 0.0,
    return_metrics: bool = False,
    audio_data: np.ndarray | None = None,
    sample_rate: int = 16000,
    audio_path: str | None = None,
    whisper_model: Any | None = None,
    pronunciation_mapping: list[dict[str, Any]] | None = None,
    pronunciation_rules: list[dict[str, Any]] | None = None,
    envelope: dict[str, Any] | None = None,
) -> list[dict[str, Any]] | tuple[list[dict[str, Any]], dict[str, Any]]:
    """Analyzes ASR words with timestamps against source text to identify:
    1. Suspected stutter or syllable repetition (SUSPECTED_STUTTER, PARTIAL_PRONUNCIATION)
    2. Meaningful words swallowed / omitted (MISSING_WORD, SUSPECTED_SWALLOWED)
    3. Unintended word repetition (REPEATED_WORD)
    4. Extra words or letter spelling not in script (EXTRA_WORD, UNEXPECTED_LETTER_SPELLING)
    5. Abnormal pauses between unpunctuated words (ABNORMAL_PAUSE)
    Note: Rapid pace and crowded words are recorded in metrics only, without generating standalone warnings.
    """
    issues: list[dict[str, Any]] = []

    source_words, delimiters, source_char_spans = tokenize_text_with_spans(text)
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

    # Build or copy pronunciation mapping for contextual acronym & custom rule QC
    if pronunciation_mapping is None:
        import inspect
        from .tts import service as _tts_service
        if "custom_rules" not in inspect.signature(_tts_service.prepare_spoken_text_for_tts).parameters:
            import importlib
            importlib.reload(_tts_service)
        prep = _tts_service.prepare_spoken_text_for_tts(
            text, language=language, custom_rules=pronunciation_rules
        )
        eff_pron_mapping: list[dict[str, Any]] = [dict(m) for m in prep.get("pronunciationMapping", [])]
    else:
        eff_pron_mapping = [dict(m) for m in pronunciation_mapping]

    src_idx_to_pm: dict[int, dict[str, Any]] = {}
    for pm in eff_pron_mapping:
        if pm.get("mode") not in ("letter_by_letter", "custom"):
            continue
        m_start = int(pm.get("startIndex", -1))
        m_end = int(pm.get("endIndex", -1))
        overlapping = [
            idx for idx, (ws, we) in enumerate(source_char_spans)
            if ws < m_end and we > m_start
        ]
        if overlapping:
            s_i1_pm = min(overlapping)
            s_i2_pm = max(overlapping) + 1
            pm["_src_range"] = (s_i1_pm, s_i2_pm)
            pm["_checked"] = False
            for idx in range(s_i1_pm, s_i2_pm):
                src_idx_to_pm[idx] = pm

    # Prepare cleaned word lists
    source_words_clean = [clean_word(w) for w in source_words]
    asr_words_clean = [clean_word(w.get("word", "")) for w in asr_words]

    # Normalize compound and digit number expressions into canonical spans
    src_spans = collapse_number_tokens(source_words, language, delimiters=delimiters)
    asr_spans = collapse_number_tokens([w.get("word", "") for w in asr_words], language)
    asr_spans = _collapse_acronym_letter_spans(asr_spans, asr_words, eff_pron_mapping)
    src_canonical = [s.canonical for s in src_spans]
    asr_canonical = [a.canonical for a in asr_spans]

    matcher = difflib.SequenceMatcher(None, src_canonical, asr_canonical)
    span_opcodes = matcher.get_opcodes()

    # Track ASR to source alignment for delimiter & pause checks
    slice_budget = [MAX_SECONDARY_SLICE_CHECKS]
    asr_to_source: dict[int, int] = {}
    for tag, s_i1, s_i2, a_j1, a_j2 in span_opcodes:
        if tag == "equal":
            for offset in range(s_i2 - s_i1):
                s_span = src_spans[s_i1 + offset]
                a_span = asr_spans[a_j1 + offset]
                for j in range(a_span.orig_start, a_span.orig_end):
                    src_offset = min(j - a_span.orig_start, (s_span.orig_end - s_span.orig_start) - 1)
                    asr_to_source[j] = s_span.orig_start + src_offset
                pm_eq = src_idx_to_pm.get(s_span.orig_start)
                if pm_eq is not None and not pm_eq.get("_checked"):
                    pm_eq["_checked"] = True
                    verdict, pm_iss = _evaluate_pronunciation_entry(
                        pm=pm_eq,
                        asr_words=asr_words,
                        j1=a_span.orig_start,
                        j2=a_span.orig_end,
                        eff_speed=eff_speed,
                        audio_data=audio_data,
                        sample_rate=sample_rate,
                        audio_path=audio_path,
                        whisper_model=whisper_model,
                        language=language,
                        total_dur=total_dur,
                    )
                    if pm_iss is not None:
                        issues.append(pm_iss)
                elif (
                    pm_eq is None
                    and not s_span.is_number
                    and (s_span.orig_end - s_span.orig_start) == 1
                    and (a_span.orig_end - a_span.orig_start) == 1
                    and a_span.orig_start < len(asr_words)
                ):
                    low_conf_iss = _verify_low_confidence_equal_word(
                        source_words=source_words,
                        source_words_clean=source_words_clean,
                        src_idx=s_span.orig_start,
                        w_obj=asr_words[a_span.orig_start],
                        audio_data=audio_data,
                        sample_rate=sample_rate,
                        audio_path=audio_path,
                        whisper_model=whisper_model,
                        language=language,
                        total_dur=total_dur,
                        slice_budget=slice_budget,
                    )
                    if low_conf_iss is not None:
                        issues.append(low_conf_iss)
        elif tag == "replace":
            # If phonetically / semantically equivalent, map them
            if (s_i2 - s_i1) == (a_j2 - a_j1):
                for offset in range(s_i2 - s_i1):
                    s_span = src_spans[s_i1 + offset]
                    a_span = asr_spans[a_j1 + offset]
                    s_w = s_span.canonical
                    a_w = a_span.canonical
                    if s_span.orig_start not in src_idx_to_pm and are_words_equivalent(s_w, a_w):
                        for j in range(a_span.orig_start, a_span.orig_end):
                            src_offset = min(j - a_span.orig_start, (s_span.orig_end - s_span.orig_start) - 1)
                            asr_to_source[j] = s_span.orig_start + src_offset
            elif (s_i2 - s_i1) == 1 and (a_j2 - a_j1) >= 2:
                s_span = src_spans[s_i1]
                if is_decimal_number_string(s_span.canonical):
                    whole_exp, frac_exp = split_decimal_parts(s_span.canonical) or ("", "")
                    asr_sub_spans = asr_spans[a_j1:a_j2]
                    asr_canonicals = [a.canonical for a in asr_sub_spans]
                    if asr_canonicals and (
                        "".join(asr_canonicals) == s_span.canonical
                        or (asr_canonicals[0] == whole_exp and "".join(asr_canonicals[1:]) == frac_exp)
                    ):
                        for a_s in asr_sub_spans:
                            for j in range(a_s.orig_start, a_s.orig_end):
                                asr_to_source[j] = s_span.orig_start

    # Check intentional repetition in script (e.g. "that that", "rất rất")
    # Also include repeated letters inside letter-by-letter acronyms (e.g. "P" in "VPP")
    intentional_repeats: set[str] = set()
    for idx in range(len(source_words_clean) - 1):
        if source_words_clean[idx] and source_words_clean[idx] == source_words_clean[idx + 1]:
            intentional_repeats.add(source_words_clean[idx])
    for pm in eff_pron_mapping:
        exp_lets = pm.get("expectedLetters") or []
        for idx_l in range(len(exp_lets) - 1):
            if exp_lets[idx_l] == exp_lets[idx_l + 1]:
                intentional_repeats.add(exp_lets[idx_l])

    # Check opcodes for Stutter, Repetition, Missing Word, and Extra Word
    for tag, s_i1, s_i2, a_j1, a_j2 in span_opcodes:
        if tag == "equal":
            continue

        i1 = src_spans[s_i1].orig_start if s_i1 < len(src_spans) else len(source_words)
        i2 = src_spans[s_i2 - 1].orig_end if s_i2 > s_i1 else i1
        j1 = asr_spans[a_j1].orig_start if a_j1 < len(asr_spans) else len(asr_words)
        j2 = asr_spans[a_j2 - 1].orig_end if a_j2 > a_j1 else j1

        # Handle pronunciation_mapping entries (acronyms / custom rules) inside replace / delete opcodes
        if tag in ("replace", "delete"):
            pms_in_op: list[dict[str, Any]] = []
            for idx_src in range(i1, i2):
                cand_pm = src_idx_to_pm.get(idx_src)
                if cand_pm is not None and not cand_pm.get("_checked") and cand_pm not in pms_in_op:
                    pms_in_op.append(cand_pm)
            if pms_in_op:
                handled_all_in_op = True
                for cand_pm in pms_in_op:
                    cand_pm["_checked"] = True
                    pm_i1, pm_i2 = cand_pm.get("_src_range", (i1, i2))
                    pm_j1, pm_j2 = j1, j2
                    # Strip leading ASR words in [j1, j2) that match source_words[i1:pm_i1]
                    if pm_i1 > i1:
                        for pre_idx in range(i1, pm_i1):
                            if pm_j1 < pm_j2 and are_words_equivalent(source_words_clean[pre_idx], asr_words_clean[pm_j1]):
                                asr_to_source[pm_j1] = pre_idx
                                pm_j1 += 1
                            else:
                                handled_all_in_op = False
                    # Strip trailing ASR words in [j1, j2) that match source_words[pm_i2:i2]
                    if pm_i2 < i2:
                        for post_idx in range(i2 - 1, pm_i2 - 1, -1):
                            if pm_j2 > pm_j1 and are_words_equivalent(source_words_clean[post_idx], asr_words_clean[pm_j2 - 1]):
                                asr_to_source[pm_j2 - 1] = post_idx
                                pm_j2 -= 1
                            else:
                                handled_all_in_op = False

                    verdict, pm_iss = _evaluate_pronunciation_entry(
                        pm=cand_pm,
                        asr_words=asr_words,
                        j1=pm_j1,
                        j2=pm_j2,
                        eff_speed=eff_speed,
                        audio_data=audio_data,
                        sample_rate=sample_rate,
                        audio_path=audio_path,
                        whisper_model=whisper_model,
                        language=language,
                        total_dur=total_dur,
                    )
                    for j_map in range(pm_j1, pm_j2):
                        asr_to_source[j_map] = pm_i1
                    if pm_iss is not None:
                        issues.append(pm_iss)

                if handled_all_in_op and len(pms_in_op) == 1:
                    continue

        if tag == "insert":
            insert_phrase = " ".join(w for w in asr_words_clean[j1:j2] if w)
            if insert_phrase and is_whisper_hallucination(insert_phrase):
                continue
            if (i1 == len(source_words) or i1 == 0) and insert_phrase in (
                "thank you",
                "thanks for watching",
                "thank you so much",
                "cam on",
                "cảm ơn",
            ):
                min_span_p = min(
                    (float(asr_words[k].get("probability", 1.0)) for k in range(j1, j2)),
                    default=1.0,
                )
                min_span_dur = min(
                    (
                        float(asr_words[k].get("endSec", 0.0)) - float(asr_words[k].get("startSec", 0.0))
                        for k in range(j1, j2)
                    ),
                    default=0.0,
                )
                span_silent = False
                if audio_data is not None and sample_rate > 0 and j2 > j1:
                    sp_s = max(0, int(round(float(asr_words[j1].get("startSec", 0.0)) * sample_rate)))
                    sp_e = min(len(audio_data), int(round(float(asr_words[j2 - 1].get("endSec", 0.0)) * sample_rate)))
                    if sp_e <= sp_s or float(np.sqrt(np.mean(audio_data[sp_s:sp_e] ** 2))) < 0.012:
                        span_silent = True
                if min_span_p < 0.60 or min_span_dur < 0.06 or span_silent:
                    continue

            # Extra words in ASR not present in source text
            for j in range(j1, j2):
                w_obj = asr_words[j]
                w_clean = asr_words_clean[j]
                if not w_clean:
                    continue
                w_raw = w_obj.get("word", "").strip()
                w_raw = re.sub(r"^[^\w\u00C0-\u1EF9]+|[^\w\u00C0-\u1EF9]+$", "", w_raw)
                if not w_raw:
                    w_raw = w_clean

                # Filter out known Whisper hallucination boilerplate (e.g. YouTube subtitles)
                if is_whisper_hallucination(w_raw) or is_whisper_hallucination(w_clean):
                    continue

                p = float(w_obj.get("probability", 1.0))
                t_end = float(w_obj.get("endSec", 0.0))
                t_start = float(w_obj.get("startSec", 0.0))
                w_dur = t_end - t_start

                # Check if it's an orthographic split (e.g. source: cannot -> ASR: can not)
                if j > 0 and i1 > 0:
                    prev_asr = asr_words_clean[j - 1]
                    prev_src = source_words_clean[i1 - 1]
                    if prev_asr + w_clean == prev_src:
                        continue

                prev_w = asr_words_clean[j - 1] if j > 0 else ""
                next_w = asr_words_clean[j + 1] if (j + 1 < len(asr_words_clean)) else ""

                # Repetition check (stutter vs repeated word, including prefix and suffix stutters like 'generates rates')
                is_repeat = (w_clean == prev_w) or (w_clean == next_w)
                is_prefix_stutter = (
                    bool(next_w and len(w_clean) >= 1 and next_w.startswith(w_clean) and len(next_w) > len(w_clean))
                    or bool(prev_w and len(w_clean) >= 1 and prev_w.startswith(w_clean) and len(prev_w) > len(w_clean))
                )
                is_suffix_stutter = (
                    bool(prev_w and len(w_clean) >= 3 and prev_w.endswith(w_clean) and len(prev_w) > len(w_clean))
                    or bool(next_w and len(w_clean) >= 3 and next_w.endswith(w_clean) and len(next_w) > len(w_clean))
                )

                if is_repeat or is_prefix_stutter or is_suffix_stutter:
                    # Check whether count in ASR exceeds count in source script
                    src_count = source_words_clean.count(w_clean)
                    asr_count = asr_words_clean.count(w_clean)
                    if asr_count <= src_count:
                        continue

                    if j > 0 and (w_clean == prev_w or (is_suffix_stutter and prev_w.endswith(w_clean))):
                        rep_start = float(asr_words[j - 1].get("startSec", 0.0))
                    else:
                        rep_start = t_start
                    ts = format_timestamp(rep_start)

                    if is_suffix_stutter and prev_w.endswith(w_clean):
                        ctx_words = f"{prev_w} {w_clean}"
                    elif next_w:
                        ctx_words = f"{w_clean} {next_w}"
                    elif prev_w:
                        ctx_words = f"{prev_w} {w_clean}"
                    else:
                        ctx_words = w_clean

                    # Group if consecutive duplicate issue already recorded for same word
                    if issues and issues[-1]["code"] in ("SUSPECTED_STUTTER", "REPEATED_WORD", "REPEATED_WORDS") and w_clean in issues[-1].get("words", []):
                        issues[-1]["timeRange"][1] = round(t_end, 3)
                        issues[-1]["code"] = "REPEATED_WORD"
                        continue

                    if is_prefix_stutter or is_suffix_stutter or (len(w_clean) <= 4 and not (j > 1 and w_clean == asr_words_clean[j - 2])):
                        stutter_partner = prev_w if (is_suffix_stutter and prev_w.endswith(w_clean)) else (next_w or prev_w)
                        issues.append({
                            "severity": "warning",
                            "code": "SUSPECTED_STUTTER",
                            "message": f'Nghi vấn vấp âm gần từ "{ctx_words}" — khoảng {ts}. Vui lòng nghe kiểm tra.',
                            "words": [w_clean, stutter_partner],
                            "timeRange": [round(rep_start, 3), round(t_end, 3)],
                        })
                    else:
                        issues.append({
                            "severity": "warning",
                            "code": "REPEATED_WORD",
                            "message": f'Nghi vấn lặp từ gần từ "{ctx_words}" — khoảng {ts}. Vui lòng nghe kiểm tra.',
                            "words": [w_clean],
                            "timeRange": [round(rep_start, 3), round(t_end, 3)],
                        })
                else:
                    prev_src_raw = source_words[i1 - 1] if i1 > 0 else ""
                    prev_src_clean = source_words_clean[i1 - 1] if i1 > 0 else ""
                    next_src_raw = source_words[i1] if i1 < len(source_words) else ""
                    next_src_clean = source_words_clean[i1] if i1 < len(source_words) else ""
                    ts = format_timestamp(t_start)

                    is_letter = (len(w_clean) == 1 and w_clean.isalpha())
                    is_letter_spelling = is_letter and (
                        (prev_src_clean and prev_src_clean.endswith(w_clean))
                        or (prev_src_raw and prev_src_raw.isupper() and len(prev_src_raw) > 1 and w_clean not in ("a", "i"))
                        or (w_clean not in ("a", "i") and p >= 0.40)
                    )

                    if is_letter_spelling:
                        # Ensure the letter has real acoustic articulation duration
                        if w_dur >= 0.08 and p >= 0.40:
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
                    # Extra spoken word (e.g. Test 11 "should", Test 10 "Eat", or extra "like"/"share"/"video")
                    # Require physical duration >= 0.03s (eliminates 0.00s phantom Whisper tokens) and non-silent audio
                    elif w_dur >= 0.03 and p >= 0.55 and (len(w_clean) >= 2 or w_clean in ("a", "i")):
                        if audio_data is not None and sample_rate > 0:
                            s_w = max(0, int(round((t_start - 0.015) * sample_rate)))
                            e_w = min(len(audio_data), int(round((t_end + 0.015) * sample_rate)))
                            if e_w <= s_w or float(np.sqrt(np.mean(audio_data[s_w:e_w] ** 2))) < 0.005:
                                continue
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
            # Evaluate all omitted words (including function words like 'can', 'and', 'đã', 'sẽ')
            # Do not blindly ignore short or function words; only exempt weak articles ('a', 'an', 'the')
            # when coarticulated, or when acoustic/slice evidence shows the word was spoken.
            candidate_indices = [
                i for i in range(i1, i2)
                if source_words_clean[i]
            ]
            if not candidate_indices:
                continue

            # Check if merged with adjacent spoken words (e.g. ice cream -> icecream, can not -> cannot/can't)
            unmerged_indices = []
            for i in candidate_indices:
                sc = source_words_clean[i]
                if i > 0 and j1 > 0:
                    prev_src_c = source_words_clean[i - 1]
                    prev_asr_c = asr_words_clean[j1 - 1]
                    if prev_src_c + sc == prev_asr_c or are_words_equivalent(prev_src_c + sc, prev_asr_c):
                        continue
                if i + 1 < len(source_words_clean) and j1 < len(asr_words_clean):
                    next_src_c = source_words_clean[i + 1]
                    next_asr_c = asr_words_clean[j1]
                    if sc + next_src_c == next_asr_c or are_words_equivalent(sc + next_src_c, next_asr_c):
                        continue
                unmerged_indices.append(i)

            if not unmerged_indices:
                continue

            # Weak English articles ('a', 'an', 'the') coarticulate into neighbors unless isolated
            non_clitic_indices = [i for i in unmerged_indices if source_words_clean[i] not in WEAK_CLITIC_ARTICLES]
            if not non_clitic_indices:
                continue
            unmerged_indices = non_clitic_indices

            if j1 > 0 and j1 < len(asr_words):
                w_prev = asr_words[j1 - 1]
                w_next = asr_words[j1]
                t_end_prev = float(w_prev.get("endSec", 0.0))
                t_start_next = float(w_next.get("startSec", 0.0))
                gap = t_start_next - t_end_prev
                p_prev = float(w_prev.get("probability", 1.0))
                p_next = float(w_next.get("probability", 1.0))
                ts = format_timestamp(t_end_prev)

                # Single missing word bounded by spoken words with high confidence
                if len(unmerged_indices) == 1 and p_prev >= 0.50 and p_next >= 0.50:
                    src_clean = source_words_clean[unmerged_indices[0]]
                    has_silence = True
                    if audio_data is not None and sample_rate > 0 and gap >= 0.12:
                        s1 = int(round(t_end_prev * sample_rate))
                        s2 = int(round(t_start_next * sample_rate))
                        if s2 > s1:
                            slice_gap = audio_data[s1:s2]
                            gap_rms = float(np.sqrt(np.mean(slice_gap ** 2))) if slice_gap.size > 0 else 0.0
                            if gap_rms >= 0.025:
                                has_silence = False
                    # Secondary slice check if acoustic energy is present in the gap and whisper_model is available
                    if not has_silence and whisper_model is not None and audio_data is not None and sample_rate > 0 and slice_budget[0] > 0:
                        import tempfile
                        import soundfile as sf
                        slice_budget[0] -= 1
                        t_s0 = max(0.0, float(w_prev.get("startSec", t_end_prev)) - 0.05)
                        t_s1 = min(total_dur or len(audio_data) / sample_rate, float(w_next.get("endSec", t_start_next)) + 0.05)
                        seg_audio = audio_data[max(0, int(t_s0 * sample_rate)):min(len(audio_data), int(t_s1 * sample_rate))]
                        if seg_audio.size >= int(0.15 * sample_rate):
                            tmp_om = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
                            tmp_om_name = tmp_om.name
                            tmp_om.close()
                            try:
                                sf.write(tmp_om_name, seg_audio, sample_rate, subtype="PCM_16")
                                lang_c = None if not language or language == "auto" else language
                                segs_om, _ = whisper_model.transcribe(
                                    tmp_om_name, language=lang_c, beam_size=5, word_timestamps=True, vad_filter=False
                                )
                                om_words = [clean_word(w.word) for seg in segs_om for w in (seg.words or []) if w.word]
                                if any(are_words_equivalent(src_clean, ow) for ow in om_words):
                                    continue
                                else:
                                    has_silence = True
                            except Exception:
                                pass
                            finally:
                                try:
                                    os.remove(tmp_om_name)
                                except OSError:
                                    pass
                    if has_silence and (gap < 0.85 or (gap < 0.45 and audio_data is None)):
                        issues.append({
                            "severity": "warning",
                            "code": "MISSING_WORD",
                            "message": f'Nghi vấn nuốt chữ tại từ "{src_clean}" — khoảng {ts}. Vui lòng nghe kiểm tra.',
                            "words": [src_clean],
                            "timeRange": [round(t_end_prev, 3), round(t_start_next, 3)],
                        })
                elif len(unmerged_indices) >= 2 or gap < 0.35:
                    ctx_span = extract_context_span(source_words, i1, i2)
                    issues.append({
                        "severity": "warning",
                        "code": "SUSPECTED_SWALLOWED",
                        "message": f"Vùng '{ctx_span}' có dấu hiệu phát âm thiếu hoặc không rõ — khoảng {ts}. Vui lòng nghe lại.",
                        "words": [source_words_clean[idx] for idx in unmerged_indices],
                        "timeRange": [round(t_end_prev, 3), round(t_start_next, 3)],
                    })
            elif j1 == 0 and asr_words and len(unmerged_indices) <= 3:
                t_first = float(asr_words[0].get("startSec", 0.0))
                p_first = float(asr_words[0].get("probability", 1.0))
                if p_first >= 0.60 and t_first < 0.25:
                    src_clean = source_words_clean[unmerged_indices[0]]
                    ts = format_timestamp(0.0)
                    if len(unmerged_indices) == 1:
                        issues.append({
                            "severity": "warning",
                            "code": "MISSING_WORD",
                            "message": f'Nghi vấn nuốt chữ tại từ "{src_clean}" — khoảng {ts}. Vui lòng nghe kiểm tra.',
                            "words": [src_clean],
                            "timeRange": [0.0, round(t_first, 3)],
                        })
                    else:
                        ctx_span = extract_context_span(source_words, i1, i2)
                        issues.append({
                            "severity": "warning",
                            "code": "SUSPECTED_SWALLOWED",
                            "message": f"Vùng '{ctx_span}' có dấu hiệu phát âm thiếu hoặc không rõ — khoảng {ts}. Vui lòng nghe lại.",
                            "words": [source_words_clean[idx] for idx in unmerged_indices],
                            "timeRange": [0.0, round(t_first, 3)],
                        })
            elif j1 == len(asr_words) and asr_words and len(unmerged_indices) <= 3:
                t_last = float(asr_words[-1].get("endSec", 0.0))
                p_last = float(asr_words[-1].get("probability", 1.0))
                if p_last >= 0.60 and (total_dur <= 0 or (total_dur - t_last) < 0.30):
                    src_clean = source_words_clean[unmerged_indices[0]]
                    ts = format_timestamp(t_last)
                    t_end_bound = round(max(t_last, total_dur), 3)
                    if len(unmerged_indices) == 1:
                        issues.append({
                            "severity": "warning",
                            "code": "MISSING_WORD",
                            "message": f'Nghi vấn nuốt chữ tại từ "{src_clean}" — khoảng {ts}. Vui lòng nghe kiểm tra.',
                            "words": [src_clean],
                            "timeRange": [round(t_last, 3), t_end_bound],
                        })
                    else:
                        ctx_span = extract_context_span(source_words, i1, i2)
                        issues.append({
                            "severity": "warning",
                            "code": "SUSPECTED_SWALLOWED",
                            "message": f"Vùng '{ctx_span}' có dấu hiệu phát âm thiếu hoặc không rõ — khoảng {ts}. Vui lòng nghe lại.",
                            "words": [source_words_clean[idx] for idx in unmerged_indices],
                            "timeRange": [round(t_last, 3), t_end_bound],
                        })

        elif tag == "replace":
            # If all spans in the replace opcode are pairwise equivalent, skip
            if (s_i2 - s_i1) == (a_j2 - a_j1) and all(
                are_words_equivalent(src_spans[s_i1 + k].canonical, asr_spans[a_j1 + k].canonical)
                for k in range(s_i2 - s_i1)
            ):
                continue

            # Special Decimal Number Matching & Verification (e.g. '0.8' <=> '0 8', '13.5' <=> '13 5')
            if (s_i2 - s_i1) == 1:
                s_span = src_spans[s_i1]
                if is_decimal_number_string(s_span.canonical):
                    whole_exp, frac_exp = split_decimal_parts(s_span.canonical) or ("", "")
                    asr_sub_spans = asr_spans[a_j1:a_j2]
                    asr_canonicals = [a.canonical for a in asr_sub_spans]
                    # Check if ASR tokens are numbers forming separated digits
                    if len(asr_canonicals) >= 2 and all(
                        a.is_number or re.fullmatch(r"-?\d+", a.canonical) for a in asr_sub_spans
                    ):
                        t_start_whole = float(asr_words[j1].get("startSec", 0.0)) if j1 < len(asr_words) else 0.0
                        t_end_whole = float(asr_words[j1].get("endSec", 0.0)) if j1 < len(asr_words) else 0.0
                        t_start_frac = float(asr_words[j1 + 1].get("startSec", 0.0)) if j1 + 1 < len(asr_words) else t_end_whole
                        t_end_frac = float(asr_words[min(len(asr_words) - 1, j2 - 1)].get("endSec", 0.0)) if asr_words else 0.0
                        total_dec_dur = t_end_frac - t_start_whole
                        inter_digit_gap = t_start_frac - t_end_whole

                        # Case A0: ASR already recognized the decimal point in a split multi-digit decimal (e.g. ['0.8', '1'] == '0.81')
                        if "".join(asr_canonicals) == s_span.canonical and any("." in c for c in asr_canonicals):
                            for j in range(j1, j2):
                                asr_to_source[j] = s_span.orig_start
                            continue

                        # Case A: Digits match candidate decimal
                        if asr_canonicals[0] == whole_exp and "".join(asr_canonicals[1:]) == frac_exp:
                            src_dec_words = source_words[s_span.orig_start : s_span.orig_end]
                            if any(clean_word(w) in ("cent", "cents") for w in src_dec_words):
                                for j in range(j1, j2):
                                    asr_to_source[j] = s_span.orig_start
                                continue
                            verdict, reason = verify_decimal_separator_hypothesis(
                                audio_path=audio_path,
                                audio_data=audio_data,
                                sample_rate=sample_rate,
                                t_start_whole=t_start_whole,
                                t_end_whole=t_end_whole,
                                t_start_frac=t_start_frac,
                                t_end_frac=t_end_frac,
                                whole_exp=whole_exp,
                                frac_exp=frac_exp,
                                src_dec_words=src_dec_words,
                                whisper_model=whisper_model,
                                language=language,
                                eff_speed=eff_speed,
                                total_audio_duration=total_dur,
                            )

                            if verdict == "pass":
                                for j in range(j1, j2):
                                    asr_to_source[j] = s_span.orig_start
                                continue
                            elif verdict == "missing":
                                # TTS omitted or swallowed the separator ("point" / "phẩy")
                                sep_word = next(
                                    (w for w in src_dec_words if clean_word(w) in ("point", "phẩy", "phay", "chấm", "cham", "dot")),
                                    "point"
                                )
                                ts = format_timestamp(t_end_whole)
                                issues.append({
                                    "severity": "warning",
                                    "code": "MISSING_WORD",
                                    "message": f'Nghi vấn nuốt chữ tại từ "{sep_word}" — khoảng {ts}. Vui lòng nghe kiểm tra.',
                                    "words": [sep_word],
                                    "timeRange": [round(t_end_whole, 3), round(t_start_frac, 3)],
                                })
                                continue
                            elif verdict == "unverified":
                                # Inconclusive acoustic evidence without model confirmation: never falsely pass!
                                sep_word = next(
                                    (w for w in src_dec_words if clean_word(w) in ("point", "phẩy", "phay", "chấm", "cham", "dot")),
                                    "point"
                                )
                                ts = format_timestamp(t_end_whole)
                                issues.append({
                                    "severity": "unverified",
                                    "code": "UNVERIFIED_SEPARATOR",
                                    "message": f'Chưa thể xác minh phát âm từ ngắt "{sep_word}" ({reason}) — khoảng {ts}.',
                                    "words": [sep_word],
                                    "timeRange": [round(t_end_whole, 3), round(t_start_frac, 3)],
                                })
                                continue

                        # Case B: ASR numbers differ from script decimal (Mispronunciation / Wrong Number)
                        else:
                            asr_num_str = " ".join(asr_canonicals)
                            ts = format_timestamp(t_start_whole)
                            number_issue = _numeric_mismatch_review(
                                s_span.canonical, asr_num_str, asr_words, j1, j2,
                                whisper_model, audio_data, sample_rate, language, total_dur,
                                slice_budget=slice_budget,
                            )
                            if number_issue is not None:
                                issues.append(number_issue)
                            continue

                    # Single ASR decimal token that does not match (e.g. '2.8' vs '2.4')
                    elif len(asr_canonicals) == 1 and is_decimal_number_string(asr_canonicals[0]):
                        if not are_number_expressions_equivalent(s_span.canonical, asr_canonicals[0]):
                            t_start_w = float(asr_words[j1].get("startSec", 0.0)) if j1 < len(asr_words) else 0.0
                            t_end_w = float(asr_words[j1].get("endSec", 0.0)) if j1 < len(asr_words) else 0.0
                            ts = format_timestamp(t_start_w)
                            number_issue = _numeric_mismatch_review(
                                s_span.canonical, asr_canonicals[0], asr_words, j1, j2,
                                whisper_model, audio_data, sample_rate, language, total_dur,
                                slice_budget=slice_budget,
                            )
                            if number_issue is not None:
                                issues.append(number_issue)
                            continue

                # Wrong integer / cardinal number detection (e.g. '8,200' vs '8,300', '300' vs '50')
                if s_span.is_number and (a_j2 - a_j1) == 1 and asr_spans[a_j1].is_number:
                    a_span_num = asr_spans[a_j1]
                    if not are_number_expressions_equivalent(s_span.canonical, a_span_num.canonical, language):
                        # Check if ASR number is a partial prefix/subset of multi-word source number (e.g. 'three hundred' -> 'three', 'fifty five' -> '50')
                        is_partial_swallowed = False
                        if (i2 - i1) >= 2:
                            for sub_end in range(i1 + 1, i2):
                                sub_spans = collapse_number_tokens(source_words[i1:sub_end], language)
                                if len(sub_spans) == 1 and sub_spans[0].is_number and are_number_expressions_equivalent(
                                    sub_spans[0].canonical, a_span_num.canonical, language
                                ):
                                    is_partial_swallowed = True
                                    break
                        if not is_partial_swallowed:
                            t_start_w = float(asr_words[j1].get("startSec", 0.0)) if j1 < len(asr_words) else 0.0
                            t_end_w = float(asr_words[min(len(asr_words) - 1, j2 - 1)].get("endSec", 0.0)) if asr_words else 0.0
                            ts = format_timestamp(t_start_w)
                            number_issue = _numeric_mismatch_review(
                                s_span.canonical, a_span_num.canonical, asr_words, j1, j2,
                                whisper_model, audio_data, sample_rate, language, total_dur,
                                slice_budget=slice_budget,
                            )
                            if number_issue is not None:
                                issues.append(number_issue)
                            continue

            src_slice_clean = [source_words_clean[k] for k in range(i1, i2)]
            asr_slice_clean = [asr_words_clean[k] for k in range(j1, j2)]
            src_span_canonicals = [src_spans[k].canonical for k in range(s_i1, s_i2)]
            asr_span_canonicals = [asr_spans[k].canonical for k in range(a_j1, a_j2)]

            # Check if all words or canonical spans are equivalent (orthographically, phonetically, or numerically)
            if len(src_slice_clean) == len(asr_slice_clean) and all(
                are_words_equivalent(s, a) for s, a in zip(src_slice_clean, asr_slice_clean)
            ):
                continue
            if len(src_span_canonicals) == len(asr_span_canonicals) and all(
                are_words_equivalent(sc, ac) for sc, ac in zip(src_span_canonicals, asr_span_canonicals)
            ):
                for j_map in range(j1, j2):
                    asr_to_source[j_map] = min(i1 + (j_map - j1), i2 - 1)
                continue

            # Check if concatenated string or canonical sequence matches or is equivalent (e.g. "twenty five D" -> "25d" vs "25d")
            src_joined = clean_word("".join(src_slice_clean))
            asr_joined = clean_word("".join(asr_slice_clean))
            src_canon_joined = clean_word("".join(src_span_canonicals))
            asr_canon_joined = clean_word("".join(asr_span_canonicals))
            is_compound_proper_split = (
                len(src_joined) >= 7
                and abs(len(src_joined) - len(asr_joined)) <= 2
                and (j2 - j1) >= 2
                and levenshtein_dist(phonetic_key(src_joined), phonetic_key(asr_joined)) <= 1
            )
            if (
                src_joined == asr_joined
                or are_words_equivalent(src_joined, asr_joined)
                or is_compound_proper_split
                or (src_canon_joined and src_canon_joined == asr_canon_joined)
                or are_number_expressions_equivalent(" ".join(src_slice_clean), " ".join(asr_slice_clean), language)
            ):
                for j_map in range(j1, j2):
                    asr_to_source[j_map] = min(i1 + (j_map - j1), i2 - 1)
                continue

            # Identify source word indices already covered by a canonical span matched in ASR
            matched_src_indices: set[int] = set()
            for k_sp in range(s_i1, s_i2):
                sp = src_spans[k_sp]
                if any(are_words_equivalent(sp.canonical, ac) for ac in asr_span_canonicals):
                    for idx_cov in range(sp.orig_start, sp.orig_end):
                        matched_src_indices.add(idx_cov)
                elif sp.is_number and len(asr_span_canonicals) >= 2 and any(
                    asr_span_canonicals[idx_a] + asr_span_canonicals[idx_a + 1] == sp.canonical
                    for idx_a in range(len(asr_span_canonicals) - 1)
                ):
                    for idx_cov in range(sp.orig_start, sp.orig_end):
                        matched_src_indices.add(idx_cov)
                elif k_sp + 1 < s_i2:
                    sp_next = src_spans[k_sp + 1]
                    pair_canon = clean_word(sp.canonical + sp_next.canonical)
                    if pair_canon and any(clean_word(ac) == pair_canon for ac in asr_span_canonicals):
                        for idx_cov in range(sp.orig_start, sp_next.orig_end):
                            matched_src_indices.add(idx_cov)

            has_asr_decimal_notation = any(
                bool(re.search(r"(?:^|\d)[.,]\d", str(asr_words[k].get("word", "")).strip()))
                for k in range(j1, min(j2, len(asr_words)))
            ) or any("." in ac for ac in asr_span_canonicals)

            # Find unrepresented words in source (do not drop short/function words like 'can', 'and', 'đã', 'sẽ')
            unrepresented_content_indices = []
            for idx in range(i1, i2):
                if idx in matched_src_indices:
                    continue
                sw = source_words_clean[idx]
                raw_sw_tok = re.sub(r"^[^\w\u00C0-\u1EF9]+|[^\w\u00C0-\u1EF9]+$", "", source_words[idx])
                if not sw or sw in WEAK_CLITIC_ARTICLES:
                    continue
                if sw in ("point", "dot", "phẩy", "phay", "chấm", "cham") and has_asr_decimal_notation:
                    continue
                if any(are_words_equivalent(sw, aw) for aw in asr_slice_clean):
                    continue
                if is_likely_proper_noun(source_words, delimiters, idx) and not raw_sw_tok.isupper():
                    if any(
                        abs(len(sw) - len(aw)) <= 1
                        and levenshtein_dist(phonetic_key(sw), phonetic_key(aw)) <= 2
                        for aw in asr_slice_clean
                    ):
                        continue
                unrepresented_content_indices.append(idx)

            t_start = float(asr_words[j1].get("startSec", 0.0)) if j1 < len(asr_words) else 0.0
            t_end = float(asr_words[min(len(asr_words) - 1, j2 - 1)].get("endSec", 0.0)) if asr_words else 0.0
            ts = format_timestamp(t_start)

            # Case 1: Many-to-one / Many-to-few mismatch (e.g. "response mobile" -> "responsible")
            if (i2 - i1) > (j2 - j1) and unrepresented_content_indices:
                ctx_span = extract_context_span(source_words, i1, i2)
                asr_slice_str = " ".join(asr_slice_clean)
                issues.append({
                    "severity": "warning",
                    "code": "SUSPECTED_SWALLOWED",
                    "message": f"Vùng '{ctx_span}' có dấu hiệu phát âm thiếu hoặc không rõ (ASR ghi nhận '{asr_slice_str}') — khoảng {ts}. Vui lòng nghe lại.",
                    "words": [source_words_clean[idx] for idx in unrepresented_content_indices],
                    "timeRange": [round(t_start, 3), round(t_end, 3)],
                })
                continue

            # Case 2a: Acronym partial letter omission (e.g. "GVEC" -> "GV" missing "EC", or ["G", "V"])
            if (i2 - i1) == 1 and (j2 - j1) >= 1:
                sw = src_slice_clean[0]
                raw_sw_tok = re.sub(r"^[^\w\u00C0-\u1EF9]+|[^\w\u00C0-\u1EF9]+$", "", source_words[i1])
                w_prob_max = max(
                    (float(asr_words[k].get("probability", 1.0)) for k in range(j1, min(j2, len(asr_words)))),
                    default=1.0,
                )
                if (
                    raw_sw_tok.isupper()
                    and raw_sw_tok.isalpha()
                    and len(raw_sw_tok) >= 3
                    and 1 <= len(asr_joined) < len(sw)
                    and (sw.startswith(asr_joined) or sw.endswith(asr_joined))
                    and w_prob_max >= 0.50
                ):
                    missing_part = (
                        raw_sw_tok[len(asr_joined):]
                        if sw.startswith(asr_joined)
                        else raw_sw_tok[:-len(asr_joined)]
                    )
                    issues.append({
                        "severity": "warning",
                        "code": "MISSING_WORD",
                        "message": f'Nghi vấn đọc thiếu âm "{missing_part}" trong từ viết tắt "{raw_sw_tok}" (ASR chỉ ghi nhận "{asr_joined.upper()}") — khoảng {ts}. Vui lòng nghe kiểm tra.',
                        "words": [raw_sw_tok, missing_part],
                        "timeRange": [round(t_start, 3), round(t_end, 3)],
                    })
                    continue

            # Case 2: 1-to-1 word replacement (Partial syllable truncation or Mispronunciation like 'ship' -> 'shop', 'bàn' -> 'bán')
            if (i2 - i1) == 1 and (j2 - j1) == 1:
                sw = src_slice_clean[0]
                aw = asr_slice_clean[0]
                raw_sw_tok = re.sub(r"^[^\w\u00C0-\u1EF9]+|[^\w\u00C0-\u1EF9]+$", "", source_words[i1]) or sw
                w_prob = float(asr_words[j1].get("probability", 1.0))
                is_pn = is_likely_proper_noun(source_words, delimiters, i1)

                # Proper noun transliteration tolerance (e.g. 'Nevada' -> 'Navada')
                if (
                    is_pn
                    and not raw_sw_tok.isupper()
                    and abs(len(sw) - len(aw)) <= 1
                    and levenshtein_dist(phonetic_key(sw), phonetic_key(aw)) <= 2
                ):
                    asr_to_source[j1] = i1
                    continue

                # Coarticulatory boundary assimilation:
                # 1) Sibilant assimilation when next word starts with s/z (e.g. 'arm sideways' -> 'arms sideways')
                # 2) Stop/dental assimilation on -d/-ed after n/l/r/s when next word starts with stop/dental (e.g. 'straighten bent' -> 'straightened bent')
                next_src_w = source_words_clean[i2] if i2 < len(source_words_clean) else ""
                if next_src_w:
                    if (aw == sw + "s" or sw == aw + "s") and next_src_w.startswith(("s", "z")):
                        asr_to_source[j1] = i1
                        continue
                    if (
                        len(sw) >= 4
                        and sw[-1] in "nlrs"
                        and (aw in (sw + "d", sw + "ed") or sw in (aw + "d", aw + "ed"))
                        and next_src_w.startswith(("t", "d", "b", "p", "k", "g"))
                    ):
                        asr_to_source[j1] = i1
                        continue

                if (
                    len(sw) >= 4
                    and len(aw) >= 2
                    and len(sw) >= len(aw) + 2
                    and (sw.startswith(aw) or phonetic_key(sw).startswith(phonetic_key(aw)))
                    and w_prob >= 0.50
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

                if w_prob < 0.45:
                    issues.append({
                        "severity": "unverified",
                        "code": "UNVERIFIED_WORD",
                        "message": f"Chưa thể xác minh phát âm từ '{raw_sw_tok}' (ASR ghi nhận '{aw}' với độ tin cậy thấp {w_prob:.2f}) — khoảng {ts}.",
                        "words": [sw, aw],
                        "timeRange": [round(t_start, 3), round(t_end, 3)],
                    })
                else:
                    issues.append({
                        "severity": "warning",
                        "code": "SUSPECTED_MISPRONUNCIATION",
                        "message": f"Nghi vấn phát âm sai từ '{sw}' (ASR ghi nhận '{aw}') — khoảng {ts}. Vui lòng nghe lại.",
                        "words": [sw, aw],
                        "timeRange": [round(t_start, 3), round(t_end, 3)],
                    })
                continue

            # Case 2c: 1-to-2 compound word split (e.g. "piezoresistive" -> ["piezo", "resistive"] or ["piezo", "assistive"])
            if (i2 - i1) == 1 and (j2 - j1) == 2:
                sw = src_slice_clean[0]
                aw1, aw2 = asr_slice_clean[0], asr_slice_clean[1]
                if len(sw) >= 6 and len(aw1) >= 3 and len(aw2) >= 3 and sw.startswith(aw1):
                    rem_suffix = sw[len(aw1):]
                    if rem_suffix and are_words_equivalent(rem_suffix, aw2):
                        for j_map in range(j1, j2):
                            asr_to_source[j_map] = i1
                        continue
                    elif rem_suffix:
                        issues.append({
                            "severity": "warning",
                            "code": "SUSPECTED_MISPRONUNCIATION",
                            "message": f"Nghi vấn phát âm sai từ '{sw}' (ASR ghi nhận '{aw1} {aw2}') — khoảng {ts}. Vui lòng nghe lại.",
                            "words": [sw, f"{aw1} {aw2}"],
                            "timeRange": [round(t_start, 3), round(t_end, 3)],
                        })
                        continue

            # Case 2d: Equal-length multi-word replacement where individual word pairs differ
            if (i2 - i1) == (j2 - j1) and (i2 - i1) >= 2:
                for k_off in range(i2 - i1):
                    s_idx_k = i1 + k_off
                    a_idx_k = j1 + k_off
                    sw_k = source_words_clean[s_idx_k]
                    aw_k = asr_words_clean[a_idx_k]
                    if are_words_equivalent(sw_k, aw_k):
                        asr_to_source[a_idx_k] = s_idx_k
                        continue
                    raw_sw_k = re.sub(r"^[^\w\u00C0-\u1EF9]+|[^\w\u00C0-\u1EF9]+$", "", source_words[s_idx_k]) or sw_k
                    if (
                        is_likely_proper_noun(source_words, delimiters, s_idx_k)
                        and not raw_sw_k.isupper()
                        and abs(len(sw_k) - len(aw_k)) <= 1
                        and levenshtein_dist(phonetic_key(sw_k), phonetic_key(aw_k)) <= 2
                    ):
                        asr_to_source[a_idx_k] = s_idx_k
                        continue
                    w_obj_k = asr_words[a_idx_k]
                    t_s_k = float(w_obj_k.get("startSec", t_start))
                    t_e_k = float(w_obj_k.get("endSec", t_end))
                    p_k = float(w_obj_k.get("probability", 1.0))
                    ts_k = format_timestamp(t_s_k)
                    if p_k < 0.45:
                        issues.append({
                            "severity": "unverified",
                            "code": "UNVERIFIED_WORD",
                            "message": f"Chưa thể xác minh phát âm từ '{raw_sw_k}' (ASR ghi nhận '{aw_k}' với độ tin cậy thấp {p_k:.2f}) — khoảng {ts_k}.",
                            "words": [sw_k, aw_k],
                            "timeRange": [round(t_s_k, 3), round(t_e_k, 3)],
                        })
                    else:
                        issues.append({
                            "severity": "warning",
                            "code": "SUSPECTED_MISPRONUNCIATION",
                            "message": f"Nghi vấn phát âm sai từ '{sw_k}' (ASR ghi nhận '{aw_k}') — khoảng {ts_k}. Vui lòng nghe lại.",
                            "words": [sw_k, aw_k],
                            "timeRange": [round(t_s_k, 3), round(t_e_k, 3)],
                        })
                continue

            # Case 3: Multiple unrepresented content words in multi-word replacement
            if len(unrepresented_content_indices) >= 2:
                max_prob = max((float(asr_words[k].get("probability", 0.0)) for k in range(j1, min(j2, len(asr_words)))), default=1.0)
                if max_prob >= 0.70:
                    ctx_span = extract_context_span(source_words, i1, i2)
                    asr_slice_str = " ".join(asr_slice_clean)
                    issues.append({
                        "severity": "warning",
                        "code": "SUSPECTED_SWALLOWED",
                        "message": f"Vùng '{ctx_span}' có dấu hiệu phát âm thiếu hoặc không rõ (ASR ghi nhận '{asr_slice_str}') — khoảng {ts}. Vui lòng nghe lại.",
                        "words": [source_words_clean[idx] for idx in unrepresented_content_indices],
                        "timeRange": [round(t_start, 3), round(t_end, 3)],
                    })

            # Case 4: More words in ASR than in source (e.g. repetition or extra words inside replacement span)
            if (j2 - j1) > (i2 - i1):
                for j in range(j1, j2):
                    w_obj = asr_words[j]
                    w_clean = asr_words_clean[j]
                    if not w_clean:
                        continue
                    w_raw = w_obj.get("word", "").strip()
                    w_raw = re.sub(r"^[^\w\u00C0-\u1EF9]+|[^\w\u00C0-\u1EF9]+$", "", w_raw) or w_clean
                    if is_whisper_hallucination(w_raw) or is_whisper_hallucination(w_clean):
                        continue

                    p = float(w_obj.get("probability", 1.0))
                    t_start_w = float(w_obj.get("startSec", 0.0))
                    t_end_w = float(w_obj.get("endSec", 0.0))
                    ts_w = format_timestamp(t_start_w)

                    prev_w = asr_words_clean[j - 1] if j > 0 else ""
                    next_w = asr_words_clean[j + 1] if (j + 1 < len(asr_words_clean)) else ""

                    is_repeat = (w_clean == prev_w) or (w_clean == next_w)
                    is_prefix_stutter = (
                        bool(next_w and len(w_clean) >= 1 and next_w.startswith(w_clean) and len(next_w) > len(w_clean))
                        or bool(prev_w and len(w_clean) >= 1 and prev_w.startswith(w_clean) and len(prev_w) > len(w_clean))
                    )
                    is_suffix_stutter = (
                        bool(prev_w and len(w_clean) >= 3 and prev_w.endswith(w_clean) and len(prev_w) > len(w_clean))
                        or bool(next_w and len(w_clean) >= 3 and next_w.endswith(w_clean) and len(next_w) > len(w_clean))
                    )

                    if is_repeat or is_prefix_stutter or is_suffix_stutter:
                        src_count = source_words_clean.count(w_clean)
                        asr_count = asr_words_clean.count(w_clean)
                        if asr_count <= src_count:
                            continue

                        rep_start = float(asr_words[j - 1].get("startSec", 0.0)) if (j > 0 and (w_clean == prev_w or (is_suffix_stutter and prev_w.endswith(w_clean)))) else t_start_w
                        ts_rep = format_timestamp(rep_start)
                        ctx_words = f"{prev_w} {w_clean}" if (is_suffix_stutter and prev_w.endswith(w_clean)) else (f"{w_clean} {next_w}" if next_w else (f"{prev_w} {w_clean}" if prev_w else w_clean))

                        # Deduplicate if this exact issue already added
                        if issues and issues[-1]["code"] in ("SUSPECTED_STUTTER", "REPEATED_WORD") and w_clean in issues[-1].get("words", []):
                            issues[-1]["timeRange"][1] = round(t_end_w, 3)
                            continue

                        if is_prefix_stutter or is_suffix_stutter or (len(w_clean) <= 4 and not (j > 1 and w_clean == asr_words_clean[j - 2])):
                            stutter_partner = prev_w if (is_suffix_stutter and prev_w.endswith(w_clean)) else (next_w or prev_w)
                            issues.append({
                                "severity": "warning",
                                "code": "SUSPECTED_STUTTER",
                                "message": f'Nghi vấn vấp âm gần từ "{ctx_words}" — khoảng {ts_rep}. Vui lòng nghe kiểm tra.',
                                "words": [w_clean, stutter_partner],
                                "timeRange": [round(rep_start, 3), round(t_end_w, 3)],
                            })
                        else:
                            issues.append({
                                "severity": "warning",
                                "code": "REPEATED_WORD",
                                "message": f'Nghi vấn lặp từ gần từ "{ctx_words}" — khoảng {ts_rep}. Vui lòng nghe kiểm tra.',
                                "words": [w_clean],
                                "timeRange": [round(rep_start, 3), round(t_end_w, 3)],
                            })
                    elif (
                        source_words_clean.count(w_clean) == 0
                        and (t_end_w - t_start_w) >= 0.03
                        and p >= 0.55
                        and (len(w_clean) >= 2 or w_clean in ("a", "i"))
                        and not any(are_words_equivalent(w_clean, sw) for sw in src_slice_clean)
                    ):
                        if audio_data is not None and sample_rate > 0:
                            s_w = max(0, int(round((t_start_w - 0.015) * sample_rate)))
                            e_w = min(len(audio_data), int(round((t_end_w + 0.015) * sample_rate)))
                            if e_w <= s_w or float(np.sqrt(np.mean(audio_data[s_w:e_w] ** 2))) < 0.005:
                                continue
                        msg = f"Nghi vấn phát âm thừa từ '{w_raw}' — khoảng {ts_w}. Vui lòng nghe lại."
                        issues.append({
                            "severity": "warning",
                            "code": "EXTRA_WORD",
                            "message": msg,
                            "words": [w_clean],
                            "timeRange": [round(t_start_w, 3), round(t_end_w, 3)],
                        })

    # Recover local adjacent source mappings if isolated tokens were unmapped
    for idx_a in range(len(asr_words)):
        if idx_a in asr_to_source:
            continue
        w_c = asr_words_clean[idx_a]
        if not w_c:
            continue
        if idx_a > 0 and (idx_a - 1) in asr_to_source:
            cand_s = asr_to_source[idx_a - 1] + 1
            if 0 <= cand_s < len(source_words_clean) and are_words_equivalent(w_c, source_words_clean[cand_s]):
                asr_to_source[idx_a] = cand_s
                continue
        if (idx_a + 1) < len(asr_words) and (idx_a + 1) in asr_to_source:
            cand_s = asr_to_source[idx_a + 1] - 1
            if 0 <= cand_s < len(source_words_clean) and are_words_equivalent(w_c, source_words_clean[cand_s]):
                asr_to_source[idx_a] = cand_s

    # Check for abnormal pauses between consecutive ASR words using shared acoustic envelope
    effective_min_pause = max(0.35, min_abnormal_pause_sec / eff_speed)
    conjunction_threshold = max(0.70, 0.85 / eff_speed)

    if envelope is None and audio_data is not None and sample_rate > 0:
        envelope = compute_acoustic_envelope(audio_data, sample_rate)
    boundary_valleys, _ = extract_global_silent_valleys(envelope, asr_words)
    has_acoustic_speech = bool(envelope is not None and envelope.get("has_speech"))

    boundary_records: list[dict[str, Any]] = []
    pair_pause_issues: dict[int, dict[str, Any]] = {}

    for i in range(len(asr_words) - 1):
        w1 = asr_words[i]
        w2 = asr_words[i + 1]

        start1 = float(w1.get("startSec", 0.0))
        end1 = float(w1.get("endSec", 0.0))
        start2 = float(w2.get("startSec", 0.0))
        end2 = float(w2.get("endSec", 0.0))
        gap = start2 - end1

        w1_text = clean_word(w1.get("word", ""))
        w2_text = clean_word(w2.get("word", ""))
        w1_prob = float(w1.get("probability", 1.0))
        w2_prob = float(w2.get("probability", 1.0))

        src_idx1 = asr_to_source.get(i)
        src_idx2 = asr_to_source.get(i + 1)
        mapping_uncertain = (src_idx1 is None or src_idx2 is None)

        combined_delimiter = ""
        has_source_punct = False
        if src_idx1 is not None and src_idx2 is not None and src_idx2 > src_idx1:
            combined_delimiter = "".join(delimiters[k] for k in range(src_idx1 + 1, min(len(delimiters), src_idx2 + 1)))
            if any(c in PUNCTUATION_CHARS for c in combined_delimiter) or re.search(r"[\r\n]\s*[\r\n]", combined_delimiter):
                has_source_punct = True
            elif "\n" in combined_delimiter or "\r" in combined_delimiter:
                next_src_tok = source_words[src_idx2] if 0 <= src_idx2 < len(source_words) else ""
                if next_src_tok and next_src_tok[0].isupper():
                    has_source_punct = True

        # IMPORTANT: Never use Whisper's own generated punctuation (raw_w1 / raw_w2)
        # to exempt a pause. Only verified source text punctuation is trusted.
        is_natural_pause = has_source_punct

        is_protected, entity_kind = is_protected_entity_pair(
            source_words,
            delimiters,
            src_idx1,
            src_idx2,
            w1.get("word", ""),
            w2.get("word", ""),
        )
        is_tight_cohesion, cohesion_kind, pair_min_pause = classify_phrase_cohesion_pair(
            source_words,
            source_words_clean,
            delimiters,
            src_idx1,
            src_idx2,
            w1.get("word", ""),
            w2.get("word", ""),
            eff_speed,
            effective_min_pause,
        )

        direct_sil_sec = max(0.0, gap)
        contig_sil_sec = max(0.0, gap)
        gap_start_sec = end1
        gap_end_sec = max(end1, start2)

        if has_acoustic_speech:
            if i in boundary_valleys:
                v_dur, v_s, v_e = boundary_valleys[i]
                direct_sil_sec = v_dur
                contig_sil_sec = v_dur
                gap_start_sec = v_s
                gap_end_sec = v_e
            elif gap >= 0.06:
                direct_sil_sec, contig_sil_sec = measure_boundary_silence_sec(
                    audio_data, sample_rate, start1, end1, start2, end2
                )
            else:
                direct_sil_sec = 0.0
                contig_sil_sec = 0.0

        eff_pause_sec = contig_sil_sec if has_acoustic_speech else max(0.0, gap)

        rec = {
            "index": i,
            "w1_text": w1_text,
            "w2_text": w2_text,
            "start1": start1,
            "end1": end1,
            "start2": start2,
            "end2": end2,
            "gap": gap,
            "eff_pause_sec": eff_pause_sec,
            "gap_start_sec": gap_start_sec,
            "gap_end_sec": gap_end_sec,
            "direct_sil_sec": direct_sil_sec,
            "contig_sil_sec": contig_sil_sec,
            "has_source_punct": has_source_punct,
            "mapping_uncertain": mapping_uncertain,
            "is_protected": is_protected,
            "entity_kind": entity_kind,
            "is_tight_cohesion": is_tight_cohesion,
            "cohesion_kind": cohesion_kind,
            "pair_min_pause": pair_min_pause,
            "min_prob": min(w1_prob, w2_prob),
        }
        boundary_records.append(rec)

        if not w1_text or not w2_text:
            continue

        if min(w1_prob, w2_prob) < 0.40:
            continue

        # Prosodic conjunction allowance: only BEFORE a clause-introducing conjunction (never after)
        if (
            not is_protected
            and not is_tight_cohesion
            and w2_text in CLAUSE_BOUNDARY_CONJUNCTIONS
            and i >= 2
            and eff_pause_sec < conjunction_threshold
        ):
            continue

        if is_natural_pause:
            continue

        # Evaluate whether the pause exceeds the contextual threshold
        is_abnormal = False
        reported_pause_sec = eff_pause_sec

        if has_acoustic_speech:
            if eff_pause_sec >= pair_min_pause:
                is_abnormal = True
                reported_pause_sec = eff_pause_sec
        else:
            if gap >= pair_min_pause:
                is_abnormal = True
                reported_pause_sec = gap

        if is_abnormal:
            ts = format_timestamp(gap_start_sec)
            if is_protected:
                pause_ctx = f"protected_{entity_kind}"
            elif is_tight_cohesion:
                pause_ctx = cohesion_kind
            else:
                pause_ctx = "unpunctuated_clause"
            pair_pause_issues[i] = {
                "severity": "warning",
                "code": "ABNORMAL_PAUSE",
                "message": (
                    f'Cảnh báo: Khoảng ngắt bất thường giữa "{w1_text}" và "{w2_text}" '
                    f"({reported_pause_sec:.2f}s) — khoảng {ts}. Vui lòng nghe kiểm tra."
                ),
                "words": [w1_text, w2_text],
                "timeRange": [round(gap_start_sec, 3), round(gap_end_sec, 3)],
                "mappingUncertain": mapping_uncertain,
                "pauseContext": pause_ctx,
            }

    # 1. Check for sandwiched short tokens / version numbers isolated by pauses on both sides
    # (e.g. "Powerwall ... 3 ... are")
    consumed_boundaries: set[int] = set()
    sandwiched_issues: list[dict[str, Any]] = []

    for i in range(1, len(asr_words) - 1):
        b_prev = boundary_records[i - 1]
        b_next = boundary_records[i]
        if b_prev["has_source_punct"] or b_next["has_source_punct"]:
            continue

        w_curr_raw = asr_words[i].get("word", "")
        w_curr_text = clean_word(w_curr_raw)
        if not w_curr_text or not b_prev["w1_text"] or not b_next["w2_text"]:
            continue

        if min(b_prev["min_prob"], b_next["min_prob"]) < 0.40:
            continue

        is_short_or_num = (
            len(w_curr_text) <= 4
            or is_version_or_number_token(w_curr_raw)
            or b_prev["is_protected"]
            or b_next["is_protected"]
        )
        if not is_short_or_num:
            continue

        if has_acoustic_speech:
            pause_before = b_prev["eff_pause_sec"]
            pause_after = b_next["eff_pause_sec"]
        else:
            pause_before = max(0.0, b_prev["gap"])
            pause_after = max(0.0, b_next["gap"])

        # If adjacent boundaries are also part of a longer staccato chain (3+ consecutive pauses),
        # let the choppy_phrase clusterer below merge the entire phrase rather than just 2 boundaries.
        if (i + 1) < len(boundary_records) and not boundary_records[i + 1]["has_source_punct"] and boundary_records[i + 1]["eff_pause_sec"] >= 0.22:
            continue
        if (i - 2) >= 0 and not boundary_records[i - 2]["has_source_punct"] and boundary_records[i - 2]["eff_pause_sec"] >= 0.22:
            continue

        min_side_small = max(0.16, 0.18 / eff_speed)
        min_side_large = max(0.18, 0.20 / eff_speed)
        min_combined = max(0.40, 0.44 / eff_speed)

        if (
            min(pause_before, pause_after) >= min_side_small
            and max(pause_before, pause_after) >= min_side_large
            and (pause_before + pause_after) >= min_combined
        ):
            consumed_boundaries.add(i - 1)
            consumed_boundaries.add(i)
            ts = format_timestamp(b_prev["gap_start_sec"])
            w_prev_text = b_prev["w1_text"]
            w_next_text = b_next["w2_text"]
            mapping_unc = bool(b_prev["mapping_uncertain"] or b_next["mapping_uncertain"])
            pause_ctx = (
                "protected_entity_sandwiched"
                if (b_prev["is_protected"] or b_next["is_protected"])
                else "sandwiched_token"
            )
            sandwiched_issues.append({
                "severity": "warning",
                "code": "ABNORMAL_PAUSE",
                "message": (
                    f'Cảnh báo: Khoảng ngắt bất thường tách rời "{w_curr_text}" trong cụm '
                    f'"{w_prev_text} {w_curr_text} {w_next_text}" '
                    f"({pause_before:.2f}s + {pause_after:.2f}s) — khoảng {ts}. Vui lòng nghe kiểm tra."
                ),
                "words": [w_prev_text, w_curr_text, w_next_text],
                "timeRange": [round(b_prev["gap_start_sec"], 3), round(b_next["gap_end_sec"], 3)],
                "mappingUncertain": mapping_unc,
                "pauseContext": pause_ctx,
            })

    # 2. Clustered Staccato / Choppy Phrase Detection & Merging:
    # Merge multi-pause choppy delivery across a 2-5 word unpunctuated window into a single phrase-level warning.
    choppy_issues: list[dict[str, Any]] = []
    n_bounds = len(boundary_records)
    b_cursor = 0
    while b_cursor < n_bounds:
        if b_cursor in consumed_boundaries or boundary_records[b_cursor]["has_source_punct"]:
            b_cursor += 1
            continue
        b_rec = boundary_records[b_cursor]
        if b_rec["eff_pause_sec"] < 0.22:
            b_cursor += 1
            continue

        # Attempt to grow a cluster of nearby pauses (<= 3 words apart without punctuation between them)
        cluster = [b_cursor]
        look = b_cursor + 1
        while look < n_bounds and (look - cluster[-1]) <= 3:
            # Stop if any intermediate boundary had source punctuation
            if any(boundary_records[m]["has_source_punct"] for m in range(cluster[-1], look + 1)):
                break
            if look not in consumed_boundaries and boundary_records[look]["eff_pause_sec"] >= 0.22:
                cluster.append(look)
            look += 1

        has_flagged_member = any(idx_c in pair_pause_issues for idx_c in cluster)
        total_cluster_pause = sum(boundary_records[idx_c]["eff_pause_sec"] for idx_c in cluster)
        if len(cluster) >= 2 and (has_flagged_member or len(cluster) >= 3 or total_cluster_pause >= 0.65):
            for idx_c in cluster:
                consumed_boundaries.add(idx_c)
            first_b = boundary_records[cluster[0]]
            last_b = boundary_records[cluster[-1]]
            phrase_words = [
                clean_word(str(asr_words[w_k].get("word", "")))
                for w_k in range(cluster[0], cluster[-1] + 2)
                if clean_word(str(asr_words[w_k].get("word", "")))
            ]
            phrase_str = " ".join(phrase_words)
            pauses_str = " + ".join(f"{boundary_records[idx_c]['eff_pause_sec']:.2f}s" for idx_c in cluster)
            ts = format_timestamp(first_b["gap_start_sec"])
            choppy_issues.append({
                "severity": "warning",
                "code": "ABNORMAL_PAUSE",
                "message": (
                    f'Cảnh báo: Đọc ngắt nhịp / giật cục trong cụm "{phrase_str}" '
                    f"({pauses_str}) — khoảng {ts}. Vui lòng nghe kiểm tra."
                ),
                "words": phrase_words,
                "timeRange": [round(first_b["gap_start_sec"], 3), round(last_b["gap_end_sec"], 3)],
                "mappingUncertain": any(boundary_records[idx_c]["mapping_uncertain"] for idx_c in cluster),
                "pauseContext": "choppy_phrase",
            })
            b_cursor = cluster[-1] + 1
        else:
            b_cursor += 1

    for b_idx, p_iss in sorted(pair_pause_issues.items()):
        if b_idx not in consumed_boundaries:
            issues.append(p_iss)
    issues.extend(sandwiched_issues)
    issues.extend(choppy_issues)

    # Enrich all alignment issues with diagnostic metadata for UI and TTS log export
    for iss in issues:
        tr = iss.get("timeRange", [0.0, 0.0])
        t0 = float(tr[0]) if tr else 0.0
        t1 = float(tr[1]) if len(tr) > 1 else t0
        overlapping_asr = [
            w for w in asr_words
            if float(w.get("endSec", 0.0)) >= (t0 - 0.15) and float(w.get("startSec", 0.0)) <= (t1 + 0.15)
        ]
        if not overlapping_asr and asr_words:
            overlapping_asr = [min(asr_words, key=lambda w: abs(float(w.get("startSec", 0.0)) - t0))]
        raw_excerpt = " ".join(w.get("word", "").strip() for w in overlapping_asr).strip()
        norm_spans = collapse_number_tokens([w.get("word", "") for w in overlapping_asr], language) if overlapping_asr else []
        norm_excerpt = " ".join(s.canonical for s in norm_spans).strip()
        tok_source = (
            "secondary_slice"
            if any(w.get("tokenSource") == "secondary_slice" for w in overlapping_asr)
            else "primary_asr"
        )
        iss.setdefault("sourceExcerpt", " ".join(iss.get("words", [])) or text[:80])
        iss.setdefault("asrRawExcerpt", raw_excerpt)
        iss.setdefault("asrNormalizedExcerpt", norm_excerpt)
        iss.setdefault("tokenSource", tok_source)
        iss.setdefault("mappingUncertain", False)
        ev_str = f"code={iss.get('code')} time={t0:.2f}-{t1:.2f}s source={tok_source}"
        if iss.get("pauseContext"):
            ev_str += f" context={iss.get('pauseContext')}"
        if iss.get("mappingUncertain"):
            ev_str += " mapping=uncertain"
        iss.setdefault("evidence", ev_str)

    return (issues, metrics) if return_metrics else issues


def detect_acoustic_stutter(
    audio_data: np.ndarray,
    sample_rate: int,
    text: str = "",
    asr_words: list[dict[str, Any]] | None = None,
    language: str | None = None,
    pronunciation_mapping: list[dict[str, Any]] | None = None,
    pronunciation_rules: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Detects suspected acoustic stutter / syllable repetition (e.g. 'mo-mo-mobile')
    directly from the audio waveform using two-tier verification:
    Tier 1 (Acoustic Candidate): short-frame energy bursts and spectral similarity.
    Tier 2 (Verification): corroborating ASR word boundary evidence, excluding natural
    prosody between distinct script words, and filtering intentional text repetition.
    """
    if audio_data.size == 0 or sample_rate <= 0:
        return []

    mono = np.ascontiguousarray(audio_data, dtype=np.float32)
    if mono.ndim > 1:
        mono = mono.mean(axis=1)

    # Word counts and intentional repetition check
    text_words = [clean_word(w) for w in text.split()] if text else []
    src_word_counts: dict[str, int] = {}
    for w in text_words:
        if w:
            src_word_counts[w] = src_word_counts.get(w, 0) + 1

    eff_pron_mapping: list[dict[str, Any]] = []
    if pronunciation_mapping is not None:
        eff_pron_mapping = list(pronunciation_mapping)
    elif text and text.strip():
        from .tts.service import prepare_spoken_text_for_tts
        prep = prepare_spoken_text_for_tts(
            text, language=language, custom_rules=pronunciation_rules
        )
        eff_pron_mapping = list(prep.get("pronunciationMapping", []))

    for pm in eff_pron_mapping:
        for ch in (pm.get("expectedLetters") or []):
            src_word_counts[ch] = src_word_counts.get(ch, 0) + 1

    asr_words_clean = [clean_word(w.get("word", "")) for w in asr_words] if asr_words else []
    asr_word_counts: dict[str, int] = {}
    for w in asr_words_clean:
        if w:
            asr_word_counts[w] = asr_word_counts.get(w, 0) + 1

    equal_asr_indices: set[int] = set()
    if text_words and asr_words_clean:
        s_tokens = [s.canonical for s in collapse_number_tokens(text.split(), language)]
        a_tokens = [a.canonical for a in collapse_number_tokens([w.get("word", "") for w in (asr_words or [])], language)]
        matcher = difflib.SequenceMatcher(None, s_tokens, a_tokens)
        for tag, s_i1, s_i2, a_j1, a_j2 in matcher.get_opcodes():
            if tag == "equal":
                equal_asr_indices.update(range(a_j1, a_j2))

    intentional_repeats = set()
    for idx in range(len(text_words) - 1):
        if text_words[idx] and text_words[idx] == text_words[idx + 1]:
            intentional_repeats.add(text_words[idx])
    for pm in eff_pron_mapping:
        exp_lets = pm.get("expectedLetters") or []
        for idx_l in range(len(exp_lets) - 1):
            if exp_lets[idx_l] == exp_lets[idx_l + 1]:
                intentional_repeats.add(exp_lets[idx_l])
                intentional_repeats.add(clean_word(str(pm.get("sourceSpan", ""))))

    # Frame-based energy analysis
    # TUNING REQUIRED (CONSTRAINTS.md section 7.2)
    frame_len = int(round(0.025 * sample_rate))  # 25ms frame
    hop_len = int(round(0.010 * sample_rate))    # 10ms hop
    if mono.size < frame_len * 2:
        return []

    num_frames = 1 + (mono.size - frame_len) // hop_len
    # Compute RMS per frame
    rms_frames = np.zeros(num_frames, dtype=np.float32)
    for i in range(num_frames):
        start = i * hop_len
        f = mono[start : start + frame_len]
        rms_frames[i] = np.sqrt(np.mean(f ** 2)) if f.size > 0 else 0.0

    peak_rms = float(np.max(rms_frames)) if rms_frames.size > 0 else 0.0
    if peak_rms < 0.02:
        return []

    # Find candidate burst regions: continuous frames where RMS > threshold
    # TUNING REQUIRED (CONSTRAINTS.md section 7.2)
    speech_thresh = max(0.015, peak_rms * 0.20)
    valley_thresh = peak_rms * 0.45

    bursts: list[dict[str, Any]] = []
    in_burst = False
    burst_start_idx = 0

    for i in range(num_frames):
        if rms_frames[i] >= speech_thresh:
            if not in_burst:
                in_burst = True
                burst_start_idx = i
        else:
            if in_burst:
                in_burst = False
                b_dur_sec = (i - burst_start_idx) * hop_len / sample_rate
                # Syllable burst duration typically 0.04s to 0.35s
                if 0.04 <= b_dur_sec <= 0.35:
                    bursts.append({
                        "start_idx": burst_start_idx,
                        "end_idx": i,
                        "start_sec": burst_start_idx * hop_len / sample_rate,
                        "end_sec": (i * hop_len + frame_len) / sample_rate,
                        "peak_rms": float(np.max(rms_frames[burst_start_idx:i])),
                    })

    if in_burst:
        b_dur_sec = (num_frames - burst_start_idx) * hop_len / sample_rate
        if 0.04 <= b_dur_sec <= 0.35:
            bursts.append({
                "start_idx": burst_start_idx,
                "end_idx": num_frames,
                "start_sec": burst_start_idx * hop_len / sample_rate,
                "end_sec": mono.size / sample_rate,
                "peak_rms": float(np.max(rms_frames[burst_start_idx:num_frames])),
            })

    if len(bursts) < 2:
        return []

    # Compute spectrum for each burst using Hann-windowed FFT
    burst_specs: list[np.ndarray] = []
    for b in bursts:
        st = b["start_idx"] * hop_len
        en = min(mono.size, b["end_idx"] * hop_len + frame_len)
        chunk = mono[st:en]
        if chunk.size < 64:
            burst_specs.append(np.zeros(32, dtype=np.float32))
            continue
        window = np.hanning(chunk.size)
        fft_mag = np.abs(np.fft.rfft(chunk * window))
        # Group into 32 spectral sub-bands
        if fft_mag.size >= 32:
            sub_len = fft_mag.size // 32
            spec = np.array([np.mean(fft_mag[k * sub_len : (k + 1) * sub_len]) for k in range(32)], dtype=np.float32)
        else:
            spec = np.pad(fft_mag.astype(np.float32), (0, 32 - fft_mag.size))
        norm = np.linalg.norm(spec)
        burst_specs.append(spec / norm if norm > 1e-6 else spec)

    issues: list[dict[str, Any]] = []
    detected_ranges: list[tuple[float, float]] = []

    for k in range(len(bursts) - 1):
        b1 = bursts[k]
        b2 = bursts[k + 1]

        # Valley duration between bursts (frames below speech threshold)
        valley_sec = (b2["start_idx"] - b1["end_idx"]) * hop_len / sample_rate
        # Gap between repeated syllables typically 0.01s to 0.40s
        # TUNING REQUIRED (CONSTRAINTS.md section 7.2)
        if not (0.01 <= valley_sec <= 0.40):
            continue

        # Check for clear energy valley between bursts (distinguishes from vowel elongation)
        gap_frames = rms_frames[b1["end_idx"] : b2["start_idx"]]
        if gap_frames.size > 0:
            min_gap_rms = float(np.min(gap_frames))
            min_burst_peak = min(b1["peak_rms"], b2["peak_rms"])
            if min_gap_rms > valley_thresh or min_gap_rms > 0.65 * min_burst_peak:
                # No dip -> continuous vowel elongation, not a stutter
                continue
        else:
            continue

        # Check spectral cosine similarity
        s1 = burst_specs[k]
        s2 = burst_specs[k + 1]
        cos_sim = float(np.dot(s1, s2))

        dur1 = b1["end_sec"] - b1["start_sec"]
        dur2 = b2["end_sec"] - b2["start_sec"]

        # Tier 2 Verification:
        # Syllable stutter bursts must have close durations and similar energy
        if abs(dur1 - dur2) > 0.055:
            continue

        min_burst_peak = min(b1["peak_rms"], b2["peak_rms"])
        max_burst_peak = max(b1["peak_rms"], b2["peak_rms"])
        if max_burst_peak > 0 and (min_burst_peak / max_burst_peak) < 0.60:
            continue

        is_verified_stutter = False
        stutter_word = ""

        if asr_words:
            mid1 = (b1["start_sec"] + b1["end_sec"]) / 2.0
            mid2 = (b2["start_sec"] + b2["end_sec"]) / 2.0

            w_idx1 = None
            w_idx2 = None
            for idx, w in enumerate(asr_words):
                st = float(w.get("startSec", 0.0)) - 0.05
                en = float(w.get("endSec", 0.0)) + 0.05
                if st <= mid1 <= en and w_idx1 is None:
                    w_idx1 = idx
                if st <= mid2 <= en and w_idx2 is None:
                    w_idx2 = idx

            # If bursts span across two DIFFERENT words in ASR:
            if w_idx1 is not None and w_idx2 is not None and w_idx1 != w_idx2:
                # 1. Bursts must be immediate consecutive words in ASR.
                # If separated by intervening words (e.g. 'after' in 'row after row'),
                # they belong to distinct script words and cannot be a syllable stutter burst pair!
                if abs(w_idx2 - w_idx1) != 1:
                    continue

                word1_clean = clean_word(asr_words[w_idx1].get("word", ""))
                word2_clean = clean_word(asr_words[w_idx2].get("word", ""))
                # If they are different words, this is legitimate sequential speech, NOT a stutter!
                if word1_clean != word2_clean:
                    continue
                else:
                    # 2. Both bursts map to consecutive duplicate words in ASR (e.g. 'row row' or 'that that').
                    # Check whether both occurrences correspond to intentional duplicate words in the script:
                    if equal_asr_indices and w_idx1 in equal_asr_indices and w_idx2 in equal_asr_indices:
                        continue
                    if word1_clean in intentional_repeats and (asr_word_counts.get(word1_clean, 0) <= src_word_counts.get(word1_clean, 0)):
                        continue

                    # Otherwise, at least one word was an unwanted repetition/stutter!
                    is_verified_stutter = True
                    stutter_word = word1_clean

            # If both bursts fall within the same word in ASR (intra-word repetition):
            elif w_idx1 is not None and w_idx2 is not None and w_idx1 == w_idx2:
                word_clean = clean_word(asr_words[w_idx1].get("word", ""))
                word_raw = asr_words[w_idx1].get("word", "").strip()
                # Never treat multi-digit numbers (e.g. "55", "88") as intra-word syllable stutters
                if word_clean in intentional_repeats or re.search(r"\d", word_clean):
                    continue
                # Multisyllabic words (e.g. "children", "over") naturally contain multiple syllable
                # bursts and consonant dips. Spectral similarity alone between normal syllables does NOT
                # constitute stuttering without corroborating textual/lexical repetition evidence.
                is_stutter_text = bool(
                    re.search(r"(\b[a-zA-Z\u00C0-\u1EF9]{1,4})[-_]\1", word_raw, re.IGNORECASE)
                    or re.search(r"^([a-zA-Z\u00C0-\u1EF9]{1,3})\1+", word_clean)
                )
                # TUNING REQUIRED (CONSTRAINTS.md section 7.2)
                if is_stutter_text and cos_sim >= 0.90 and min_gap_rms <= 0.20 * min_burst_peak:
                    is_verified_stutter = True
                    stutter_word = word_clean
            elif w_idx1 is None or w_idx2 is None:
                # In presence of ASR words, unaligned non-speech bursts must not trigger stutter false alarms
                pass
        else:
            # Standalone acoustic check without ASR words (e.g. synthetic test)
            # TUNING REQUIRED (CONSTRAINTS.md section 7.2)
            if cos_sim >= 0.92 and min_gap_rms <= 0.20 * min_burst_peak:
                is_verified_stutter = True

        if is_verified_stutter:
            t_start = round(b1["start_sec"], 3)
            t_end = round(b2["end_sec"], 3)

            # Avoid duplicate warnings for overlapping time ranges
            if any(abs(t_start - r[0]) < 0.3 for r in detected_ranges):
                continue
            detected_ranges.append((t_start, t_end))

            ts = format_timestamp(t_start)
            msg = (
                f'Nghi vấn vấp âm trong từ "{stutter_word}" — khoảng {ts}. Vui lòng nghe kiểm tra.'
                if stutter_word
                else f"Nghi vấn vấp âm hoặc lặp âm tiết — khoảng {ts}. Vui lòng nghe kiểm tra."
            )
            issues.append({
                "severity": "warning",
                "code": "SUSPECTED_STUTTER",
                "message": msg,
                "words": [stutter_word] if stutter_word else [],
                "timeRange": [t_start, t_end],
                "sourceExcerpt": stutter_word,
                "asrRawExcerpt": stutter_word,
                "asrNormalizedExcerpt": stutter_word,
                "tokenSource": "primary_asr",
                "evidence": f"Acoustic burst cos_sim={cos_sim:.2f} valley={valley_sec:.2f}s",
            })

    return issues



def _estimate_expected_syllables(token: str) -> int:
    """Rough upper-bound syllable estimate for a single clean word."""
    t = strip_tones_keep_vowels(clean_word(token))
    if not t:
        return 1
    groups = re.findall(r"[aeiouyăâêôơư]+", t)
    count = len(groups)
    if t.endswith("e") and not t.endswith(("le", "ee", "ie", "oe", "ye")) and count > 1:
        count -= 1
    return max(1, count)


def detect_intra_word_pause(
    audio_data: np.ndarray,
    sample_rate: int,
    source_text: str,
    asr_words: list[dict[str, Any]],
    speed: float = 1.0,
    envelope: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Flag a genuine silent break or broken-syllable stretch inside a single recognized word,
    e.g. Te-(gap)-sla or Te-xì-la.
    Excludes inter-word boundary pauses absorbed into Whisper's word window and normal
    consonant-cluster energy peaks (e.g. 'platforms', 'cycles', 'spend', 'Xpeng', 'blocks', 'pounds').
    """
    if sample_rate <= 0 or audio_data.size < sample_rate // 2:
        return []
    source_tokens = {clean_word(w) for w in tokenize_text_with_delimiters(source_text)[0]}
    if not source_tokens:
        return []

    if envelope is None:
        envelope = compute_acoustic_envelope(audio_data, sample_rate)
    _, inter_word_intervals = extract_global_silent_valleys(envelope, asr_words)

    signal = envelope["mono"] if envelope is not None else np.asarray(audio_data, dtype=np.float32)
    if signal.ndim > 1:
        signal = signal.mean(axis=1)
    hop = max(1, int(round(0.010 * sample_rate)))
    frame_size = max(hop + 1, int(round(0.020 * sample_rate)))
    eff_speed = max(0.5, float(speed or 1.0))
    min_gap = max(0.14, 0.16 / eff_speed)
    found: list[dict[str, Any]] = []

    for w_idx, word in enumerate(asr_words):
        token = clean_word(str(word.get("word", "")))
        if (
            len(token) < 4 or token not in source_tokens
            or re.search(r"\d", token)
            or float(word.get("probability", 1.0)) < 0.20
        ):
            continue
        start_sec = float(word.get("startSec", 0.0))
        end_sec = float(word.get("endSec", 0.0))
        dur_sec = end_sec - start_sec
        if not (0.38 <= dur_sec <= 3.5):
            continue
        start = max(0, int(start_sec * sample_rate))
        stop = min(len(signal), int(end_sec * sample_rate))
        if stop - start < frame_size * 4:
            continue
        wave = signal[start:stop]
        frames_w = np.lib.stride_tricks.sliding_window_view(wave, frame_size)[::hop]
        if frames_w.shape[0] < 6:
            continue
        rms = np.sqrt(np.mean(frames_w ** 2, axis=1))
        zcrs = np.mean(np.abs(np.diff(np.signbit(frames_w), axis=1)), axis=1)
        baseline = float(np.percentile(rms, 75))
        if baseline < 0.025:
            continue
        silence_ceiling = max(0.003, baseline * 0.09)
        is_quiet = (rms < silence_ceiling) & (zcrs < 0.20)
        min_frames = max(1, int(np.ceil(min_gap * sample_rate / hop)))
        expected_syl = _estimate_expected_syllables(token)
        run_start = None
        flagged_word = False
        for pos in range(len(is_quiet) + 1):
            quiet = bool(is_quiet[pos]) if pos < len(is_quiet) else False
            if quiet and run_start is None:
                run_start = pos
            if not quiet and run_start is not None:
                run_end = pos
                gap_sec = (run_end - run_start) * hop / sample_rate
                gap_start = start_sec + run_start * hop / sample_rate
                gap_end = start_sec + run_end * hop / sample_rate

                # Skip if this silent run overlaps an inter-word boundary pause
                is_boundary_pause = any(
                    min(gap_end, b_e + 0.03) - max(gap_start, b_s - 0.03) >= 0.08
                    for b_s, b_e in inter_word_intervals
                )
                # Also skip if multi-word utterance and gap is within 0.18s of word boundary
                if len(asr_words) > 1 and (
                    (w_idx > 0 and (gap_start - start_sec) <= 0.18)
                    or (w_idx + 1 < len(asr_words) and (end_sec - gap_end) <= 0.18)
                    or (expected_syl == 1 and (end_sec - gap_end) <= 0.24)
                ):
                    is_boundary_pause = True

                before = rms[max(0, run_start - 14):run_start]
                after = rms[run_end:min(len(rms), run_end + 14)]
                active_before = int(np.sum(before >= baseline * 0.30))
                active_after = int(np.sum(after >= baseline * 0.30))
                if (
                    not is_boundary_pause
                    and run_end - run_start >= min_frames
                    and run_start * hop / sample_rate >= 0.14
                    and (len(rms) - run_end) * hop / sample_rate >= 0.14
                    and active_before >= 8 and active_after >= 8
                ):
                    found.append({
                        "severity": "warning",
                        "code": "SUSPICIOUS_INTRA_PAUSE",
                        "message": (
                            f'Nghi vấn âm thanh bị ngắt ngay trong từ "{token}" '
                            f'({gap_sec:.2f}s) — khoảng {format_timestamp(gap_start)}. Vui lòng nghe lại.'
                        ),
                        "words": [token],
                        "timeRange": [round(gap_start, 3), round(gap_end, 3)],
                        "evidence": f"intra-word silence={gap_sec:.3f}s baseline_rms={baseline:.4f}",
                    })
                    flagged_word = True
                    break
                run_start = None

        # Strict broken-syllable stretch check (e.g., "Tesla" spoken "Te – xì – la"):
        # Require >= 3 sustained low-ZCR vowel nuclei (>= 90ms each) separated by >= 2 deep
        # near-silent valleys (>= 80ms each with rms < 8% baseline and zcr < 0.08),
        # so consonant clusters/plosives/fricatives ('platforms', 'cycles', 'spend', 'Xpeng', 'blocks', 'pounds') never false-trigger.
        if not flagged_word:
            voiced_frames = np.where(rms >= baseline * 0.30)[0]
            if voiced_frames.size >= 15:
                active_dur_sec = float(voiced_frames[-1] - voiced_frames[0] + 1) * hop / sample_rate
            else:
                active_dur_sec = 0.0
            min_stretched_dur = max(0.64, (0.30 * expected_syl + 0.08) / eff_speed)
            if active_dur_sec >= min_stretched_dur:
                vowel_mask = (rms >= baseline * 0.35) & (zcrs < 0.18)
                deep_valley_mask = (rms < baseline * 0.12) & (zcrs < 0.10)
                bursts: list[tuple[int, int]] = []
                b_start = None
                for idx in range(len(vowel_mask) + 1):
                    v = bool(vowel_mask[idx]) if idx < len(vowel_mask) else False
                    if v and b_start is None:
                        b_start = idx
                    elif not v and b_start is not None:
                        if idx - b_start >= 9:  # >= 90ms sustained vowel nucleus
                            if bursts and int(np.sum(deep_valley_mask[bursts[-1][1]:b_start])) < 6:
                                bursts[-1] = (bursts[-1][0], idx)
                            else:
                                bursts.append((b_start, idx))
                        b_start = None
                if len(bursts) >= expected_syl + 1 and len(bursts) >= 3:
                    found.append({
                        "severity": "warning",
                        "code": "SUSPECTED_STUTTER",
                        "message": (
                            f'Nghi vấn phát âm vấp hoặc tách âm tiết bất thường trong từ "{token}" '
                            f'({len(bursts)} nhịp âm thanh trong {active_dur_sec:.2f}s) — khoảng {format_timestamp(start_sec)}.'
                        ),
                        "words": [token],
                        "timeRange": [round(start_sec, 3), round(end_sec, 3)],
                        "evidence": f"intra-word bursts={len(bursts)} expected_syl={expected_syl} dur={active_dur_sec:.2f}s",
                    })
    return found


def recover_unaligned_words(
    audio_path: str,
    detected_words: list[dict[str, Any]],
    audio_duration_sec: float,
    whisper_model: Any,
    language: str | None = None,
) -> list[dict[str, Any]]:
    """Detects acoustic speech energy in gaps before first word or after last word
    (and very large middle pauses >= 1.2s) and runs targeted second-pass transcribe
    with vad_filter=False to recover unaligned spoken words (such as monosyllables like
    'Eat' filtered by aggressive VAD). Includes strict hallucination filtering and
    acoustic word-completion tracking on the final word to avoid slicing mid-syllable.
    """
    for w in detected_words:
        w.setdefault("tokenSource", "primary_asr")

    if whisper_model is None or not detected_words or audio_duration_sec <= 0.3:
        return detected_words

    import soundfile as sf
    try:
        data, sr = sf.read(audio_path, dtype="float32", always_2d=True)
        mono = data.mean(axis=1)
    except Exception:
        return detected_words

    candidate_gaps: list[tuple[float, float, bool]] = []

    # Leading gap before first word (e.g. 'Eat' prepended before main speech)
    # TUNING REQUIRED (CONSTRAINTS.md section 7.2)
    first_start = float(detected_words[0].get("startSec", 0.0))
    if first_start >= 0.25:
        candidate_gaps.append((0.0, first_start, False))

    # Very large middle pauses (>= 1.2s) only (never slice normal phrase pauses)
    # TUNING REQUIRED (CONSTRAINTS.md section 7.2)
    for i in range(len(detected_words) - 1):
        w_end = float(detected_words[i].get("endSec", 0.0))
        w_next_start = float(detected_words[i + 1].get("startSec", 0.0))
        gap = w_next_start - w_end
        if gap >= 1.20:
            candidate_gaps.append((w_end, w_next_start, False))
            if len(candidate_gaps) >= 2:
                break

    # Trailing gap after last word: advance true_last_end across continuous vowel/syllable decay
    # of detected_words[-1] (allowing intra-word stop closures < 0.12s) so we never slice mid-word!
    last_end = float(detected_words[-1].get("endSec", 0.0))
    true_last_end = last_end
    if audio_duration_sec - last_end >= 0.30 and sr > 0:
        frame_sz = max(1, int(round(0.02 * sr)))
        scan_start = int(round(max(0.0, last_end - 0.02) * sr))
        scan_limit = min(mono.size, int(round(min(audio_duration_sec, last_end + 0.65) * sr)))
        silent_run = 0
        last_active_sample = int(round(last_end * sr))
        pos = scan_start
        while pos + frame_sz <= scan_limit:
            f_rms = float(np.sqrt(np.mean(mono[pos : pos + frame_sz] ** 2)))
            if f_rms >= 0.015:
                silent_run = 0
                last_active_sample = pos + frame_sz
            else:
                silent_run += 1
                if silent_run >= 6:  # 120ms continuous silence = true word completion boundary
                    break
            pos += frame_sz
        true_last_end = max(last_end, round(last_active_sample / sr, 3))
        if true_last_end > last_end:
            detected_words[-1]["endSec"] = true_last_end

    if audio_duration_sec - true_last_end >= 0.35:
        candidate_gaps.append((true_last_end, audio_duration_sec, True))

    if not candidate_gaps:
        return detected_words

    additional_words: list[dict[str, Any]] = []
    import tempfile
    last_word_clean = clean_word(detected_words[-1].get("word", ""))

    for gap_start, gap_end, is_trailing in candidate_gaps:
        s_start = int(round(gap_start * sr))
        s_end = min(mono.size, int(round(gap_end * sr)))
        gap_dur = (s_end - s_start) / sr
        if gap_dur < 0.15 or gap_dur > 4.0:
            continue

        slice_audio = mono[s_start:s_end]
        peak = float(np.max(np.abs(slice_audio)))
        rms = float(np.sqrt(np.mean(slice_audio ** 2)))

        # Check voice energy burst threshold: must have clear speech energy, not background noise
        # TUNING REQUIRED (CONSTRAINTS.md section 7.2)
        if peak >= 0.08 and rms >= 0.022:
            tmp_wav = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
            tmp_wav_name = tmp_wav.name
            tmp_wav.close()
            try:
                sf.write(tmp_wav_name, slice_audio, sr, subtype="PCM_16")
                lang_code = None if not language or language == "auto" else language
                seg_iter, _ = whisper_model.transcribe(
                    tmp_wav_name,
                    language=lang_code,
                    beam_size=5,
                    word_timestamps=True,
                    vad_filter=False,
                )
                slice_words = []
                has_hallucination = False
                min_prob = 0.80 if is_trailing else 0.70
                for seg in seg_iter:
                    seg_text = seg.text or ""
                    if is_whisper_hallucination(seg_text):
                        has_hallucination = True
                        break
                    if seg.words:
                        for w in seg.words:
                            w_txt = w.word.strip()
                            w_cln = clean_word(w_txt)
                            if is_whisper_hallucination(w_txt):
                                has_hallucination = True
                                break
                            if is_trailing and w_cln == last_word_clean:
                                continue
                            if w_txt and w_cln and float(w.probability) >= min_prob:
                                slice_words.append({
                                    "word": w.word,
                                    "startSec": round(gap_start + float(w.start), 3),
                                    "endSec": round(gap_start + float(w.end), 3),
                                    "probability": round(float(w.probability), 4),
                                    "tokenSource": "secondary_slice",
                                })
                if not has_hallucination and slice_words:
                    additional_words.extend(slice_words)
            except Exception as e:
                log(f"[audio_quality] second-pass transcribe gap error: {e}")
            finally:
                if os.path.exists(tmp_wav_name):
                    try:
                        os.remove(tmp_wav_name)
                    except Exception:
                        pass

    if not additional_words:
        return detected_words

    combined = sorted(detected_words + additional_words, key=lambda x: float(x.get("startSec", 0.0)))
    return combined


def resolve_script_language(text: str, language: str | None) -> str | None:
    """Resolves the effective language from script text to prevent mismatched voice profile defaults
    (e.g. a cloned voice with default 'vi' reading an English script) from corrupting ASR & number normalization.
    """
    if not text or not text.strip():
        return language
    if re.search(
        r"[ăâđêôơưĂÂĐÊÔƠƯàảãáạằẳẵắặầẩẫấậèẻẽéẹềểễếệìỉĩíịòỏõóọồổỗốộờởỡớợùủũúụừửữứựỳỷỹýỵ]",
        text,
        re.IGNORECASE,
    ):
        return "vi"
    tokens = [clean_word(t) for t in text.split() if clean_word(t)]
    if len(tokens) >= 4:
        en_hits = sum(1 for t in tokens if t in EN_MINOR_STOPWORDS or t in {"you", "your", "over", "into", "across", "not", "have", "has", "their", "they", "more", "most", "every"})
        if en_hits >= 2 or (en_hits / len(tokens)) >= 0.15:
            return "en"
    return language


def validate_audio_quality(
    audio_path: str,
    text: str,
    language: str | None = None,
    models_dir: str | None = None,
    model_id: str | None = None,
    speed: float = 1.0,
    force_skip_whisper: bool = False,
    pronunciation_mapping: list[dict[str, Any]] | None = None,
    pronunciation_rules: list[dict[str, Any]] | None = None,
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
        "asrModelId": str,
    }
    """
    checked_at = time.time()
    eff_language = resolve_script_language(text, language)
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
            "asrModelId": model_id or "large-v3-turbo",
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
            "asrModelId": model_id or "large-v3-turbo",
        }

    from .asr_engine import resolve_whisper_model_dir, get_shared_whisper_model, AsrLifecycleManager

    target_model_dir, canonical_id = resolve_whisper_model_dir(model_id, models_dir)
    if not target_model_dir:
        return {
            "status": "unverified",
            "issues": [],
            "metrics": default_metrics,
            "summary": f"Chưa kiểm chứng (không tìm thấy mô hình Whisper '{canonical_id}' cục bộ)",
            "durationSec": dur,
            "sampleRate": info.get("sampleRate", 0),
            "checkedAt": checked_at,
            "audioPath": audio_path,
            "asrModelId": canonical_id,
        }

    # Use shared whisper instance for zero-overhead validation
    try:
        whisper_model = get_shared_whisper_model(models_dir=models_dir, model_id=target_model_dir)
        mgr = AsrLifecycleManager.get_instance()
        active_model_id = mgr.current_model_id or canonical_id
    except Exception as e:
        log(f"[audio_quality] Cannot load whisper model: {e}")
        whisper_model = None
        active_model_id = canonical_id

    if whisper_model is None:
        return {
            "status": "unverified",
            "issues": [],
            "metrics": default_metrics,
            "summary": f"Chưa kiểm chứng (không thể khởi tạo mô hình ASR '{canonical_id}')",
            "durationSec": dur,
            "sampleRate": info.get("sampleRate", 0),
            "checkedAt": checked_at,
            "audioPath": audio_path,
            "asrModelId": canonical_id,
        }

    try:
        lang_code = None if not eff_language or eff_language == "auto" else eff_language
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
                        "tokenSource": "primary_asr",
                    })

        # If detected_words is empty with vad_filter=True, retry once with vad_filter=False
        if not detected_words:
            try:
                seg_retry, _ = whisper_model.transcribe(
                    audio_path,
                    language=lang_code,
                    beam_size=5,
                    word_timestamps=True,
                    vad_filter=False,
                )
                for seg in seg_retry:
                    if seg.words:
                        for w in seg.words:
                            detected_words.append({
                                "word": w.word,
                                "startSec": round(float(w.start), 3),
                                "endSec": round(float(w.end), 3),
                                "probability": round(float(w.probability), 4),
                                "tokenSource": "primary_asr",
                            })
            except Exception as e:
                log(f"[audio_quality] retry transcribe error: {e}")

        # Bugfix: If detected_words is empty on valid audio, mark as unverified instead of falsely passing
        if not detected_words:
            return {
                "status": "unverified",
                "issues": [],
                "metrics": default_metrics,
                "summary": "Chưa kiểm chứng (ASR không nhận dạng được từ nào trong âm thanh)",
                "durationSec": dur,
                "sampleRate": info.get("sampleRate", 0),
                "checkedAt": checked_at,
                "audioPath": audio_path,
                "asrModelId": active_model_id,
            }

        # Low coverage check: if source sentence has >= 6 words but ASR recognizes < 20%
        if n_src >= 6 and (len(detected_words) / n_src) < 0.20:
            return {
                "status": "unverified",
                "issues": [],
                "metrics": default_metrics,
                "summary": "Chưa kiểm chứng (độ phủ nhận dạng của ASR quá thấp so với kịch bản)",
                "durationSec": dur,
                "sampleRate": info.get("sampleRate", 0),
                "checkedAt": checked_at,
                "audioPath": audio_path,
                "asrModelId": active_model_id,
            }

        # Recover unaligned words in acoustic speech energy gaps
        detected_words = recover_unaligned_words(
            audio_path,
            detected_words,
            dur,
            whisper_model,
            language=eff_language,
        )

        # Read audio waveform once for both alignment waveform checks and acoustic stutter check
        data_wave = None
        sr_wave = 16000
        try:
            import soundfile as sf
            data_raw, sr_wave = sf.read(audio_path, dtype="float32", always_2d=True)
            data_wave = data_raw.mean(axis=1)
        except Exception as rd_err:
            log(f"[audio_quality] Cannot read audio waveform: {rd_err}")

        shared_envelope = compute_acoustic_envelope(data_wave, sr_wave) if (data_wave is not None and sr_wave > 0) else None

        alignment_issues, metrics = analyze_word_alignment_issues(
            text,
            detected_words,
            speed=speed,
            language=eff_language,
            audio_duration_sec=dur,
            return_metrics=True,
            audio_data=data_wave,
            sample_rate=sr_wave,
            audio_path=audio_path,
            whisper_model=whisper_model,
            pronunciation_mapping=pronunciation_mapping,
            pronunciation_rules=pronunciation_rules,
            envelope=shared_envelope,
        )

        # Step 3: Acoustic Stutter Check (waveform + ASR corroboration)
        if data_wave is not None and sr_wave > 0:
            try:
                acoustic_stutters = detect_acoustic_stutter(
                    data_wave,
                    sr_wave,
                    text=text,
                    asr_words=detected_words,
                    language=eff_language,
                    pronunciation_mapping=pronunciation_mapping,
                    pronunciation_rules=pronunciation_rules,
                )
                for ast in acoustic_stutters:
                    if not any(
                        iss["code"] == "SUSPECTED_STUTTER"
                        and abs(float(iss["timeRange"][0]) - float(ast["timeRange"][0])) < 0.5
                        for iss in alignment_issues
                    ):
                        alignment_issues.append(ast)
            except Exception as st_err:
                log(f"[audio_quality] Acoustic stutter check error: {st_err}")

        # Whisper can still transcribe the correct word when audio contains
        # a real internal break (e.g. "Te ... sla"). Check its waveform too.
        if data_wave is not None and sr_wave > 0:
            try:
                intra_pauses = detect_intra_word_pause(
                    data_wave, sr_wave, text, detected_words, speed=speed, envelope=shared_envelope,
                )
                alignment_issues.extend(intra_pauses)
            except Exception as intra_err:
                log(f"[audio_quality] Intra-word pause check failed: {intra_err}")

        for iss in alignment_issues:
            iss["asrModelId"] = active_model_id

        alignment_issues.sort(key=lambda x: float(x.get("timeRange", [0.0])[0]))

        has_errors = any(i.get("severity") == "error" for i in alignment_issues)
        has_warnings = any(i.get("severity") == "warning" for i in alignment_issues)
        has_unverified = any(i.get("severity") == "unverified" for i in alignment_issues)

        if has_errors:
            return {
                "status": "error",
                "issues": alignment_issues,
                "metrics": metrics,
                "summary": alignment_issues[0]["message"],
                "durationSec": dur,
                "sampleRate": info.get("sampleRate", 0),
                "checkedAt": checked_at,
                "audioPath": audio_path,
                "asrModelId": active_model_id,
            }
        elif has_warnings:
            return {
                "status": "warning",
                "issues": alignment_issues,
                "metrics": metrics,
                "summary": alignment_issues[0]["message"],
                "durationSec": dur,
                "sampleRate": info.get("sampleRate", 0),
                "checkedAt": checked_at,
                "audioPath": audio_path,
                "asrModelId": active_model_id,
            }
        elif has_unverified:
            return {
                "status": "unverified",
                "issues": alignment_issues,
                "metrics": metrics,
                "summary": alignment_issues[0]["message"],
                "durationSec": dur,
                "sampleRate": info.get("sampleRate", 0),
                "checkedAt": checked_at,
                "audioPath": audio_path,
                "asrModelId": active_model_id,
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
            "asrModelId": active_model_id,
        }
    except Exception as e:
        log(f"[audio_quality] Validation error on {audio_path}: {e}")
        # Failure in ASR check does NOT break or discard the audio
        fallback_model = locals().get("active_model_id") or model_id or "large-v3-turbo"
        return {
            "status": "unverified",
            "issues": [],
            "metrics": default_metrics,
            "summary": f"Chưa kiểm chứng (lỗi phân tích giọng nói: {e})",
            "durationSec": dur,
            "sampleRate": info.get("sampleRate", 0),
            "checkedAt": checked_at,
            "audioPath": audio_path,
            "asrModelId": fallback_model,
        }
