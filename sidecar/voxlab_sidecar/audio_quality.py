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
    "hour": {"hour", "our"},
    "hours": {"hours", "ours"},
    "suite": {"suite", "sweet"},
    "suites": {"suites", "sweets"},
    "leased": {"leased", "least"},
    "chute": {"chute", "shoot"},
    "chutes": {"chutes", "shoots"},
    "flour": {"flour", "flower"},
    "idle": {"idle", "idol"},
    "tier": {"tier", "tear"},
    "tiers": {"tiers", "tears"},
    "aisle": {"aisle", "isle"},
    "aisles": {"aisles", "isles"},
    "waist": {"waist", "waste"},
    "loan": {"loan", "lone"},
    "feat": {"feat", "feet"},
    "heal": {"heal", "heel"},
    "wear": {"wear", "ware"},
    "bare": {"bare", "bear"},
    "vein": {"vein", "vain", "vane"},
    "reign": {"reign", "rain", "rein"},
    "one": {"one", "won"},
    "alright": {"alright", "allright"},
    # General American intervocalic flapped-/ɾ/ homophones (identical acoustic realization in US TTS)
    "raiding": {"raiding", "rating"},
    "waiting": {"waiting", "wading"},
    "grading": {"grading", "grating"},
    "coding": {"coding", "coating"},
    "seeding": {"seeding", "seating"},
    "medal": {"medal", "metal"},
    "medals": {"medals", "metals"},
    "pedal": {"pedal", "petal"},
    "pedals": {"pedals", "petals"},
    "ladder": {"ladder", "latter"},
    "tidal": {"tidal", "title"},
    "bridal": {"bridal", "bridle"},
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

# English loanwords commonly embedded in Vietnamese scripts -> exact Vietnamese ASR phonetic spellings
# (Matched strictly when one side is ASCII English and the other is Vietnamese ASR output, never between two Vietnamese tone words)
EN_VI_LOANWORD_TRANSLITERATIONS: dict[str, set[str]] = {
    "sale": {"xêu", "sêu", "xeo", "seo"},
    "sales": {"xêu", "sêu", "xeo", "seo"},
    "voucher": {"vao chờ", "vâu chờ", "vô chờ", "vau chờ", "voucher"},
    "setup": {"sét ấp", "set up", "sét up", "xét ấp"},
    "livestream": {"lai chim", "lai trym", "lai stream", "live stream", "lai sờ trim"},
    "review": {"ri viu", "rì viu"},
    "file": {"phai", "fai"},
    "files": {"phai", "fai"},
    "view": {"viu"},
    "views": {"viu"},
    "team": {"tim"},
    "app": {"áp"},
    "apps": {"áp"},
    "video": {"vi đê ô", "vi deo", "vi đê o"},
    "online": {"on lai", "onlai"},
    "offline": {"óp lai", "ọp lai", "off lai"},
    "checkin": {"chếch in", "check in", "chéc in"},
    "feedback": {"phít bách", "phít béc"},
    "deal": {"điu"},
    "clip": {"cờ líp", "líp"},
    "web": {"quép", "oép"},
    "link": {"linh"},
    "tool": {"tun"},
    "code": {"cốt"},
    "game": {"gêm"},
    "top": {"tốp"},
    "shop": {"sốp", "xốp"},
    "order": {"o đờ", "o đơ"},
    "content": {"con ten", "còn ten"},
    "marketing": {"ma két tinh", "mác két tinh"},
}


def are_en_vi_loanword_spans_equivalent(src_tokens: list[str], asr_tokens: list[str]) -> bool:
    """True when an English loanword in a Vietnamese script matches Whisper's Vietnamese phonetic spelling
    (including 1-to-2 or 1-to-3 syllable splits such as 'voucher' <-> 'vao chờ', 'livestream' <-> 'lai chim').
    """
    s_clean = [clean_word(t) for t in src_tokens if clean_word(t)]
    a_clean = [clean_word(t) for t in asr_tokens if clean_word(t)]
    if not s_clean or not a_clean:
        return False
    s_join = "".join(s_clean)
    a_phrase = " ".join(normalize_vietnamese_orthography(t) for t in a_clean)
    a_join = "".join(normalize_vietnamese_orthography(t) for t in a_clean)
    if s_join.isascii() and s_join in EN_VI_LOANWORD_TRANSLITERATIONS:
        variants = EN_VI_LOANWORD_TRANSLITERATIONS[s_join]
        if a_phrase in variants or a_join in {v.replace(" ", "") for v in variants}:
            return True
    if a_join.isascii() and a_join in EN_VI_LOANWORD_TRANSLITERATIONS:
        variants = EN_VI_LOANWORD_TRANSLITERATIONS[a_join]
        s_phrase = " ".join(normalize_vietnamese_orthography(t) for t in s_clean)
        if s_phrase in variants or s_join in {v.replace(" ", "") for v in variants}:
            return True
    return False

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
    if are_en_vi_loanword_spans_equivalent([w1_clean], [w2_clean]):
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
        info["_mono"] = np.ascontiguousarray(mono, dtype=np.float32)

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


def has_punctuation_boundary(delimiter: str, next_word: str = "") -> bool:
    """Checks whether the delimiter between words contains any punctuation mark or hard/heading line break."""
    if any(c in PUNCTUATION_CHARS for c in delimiter) or re.search(r"[\r\n]\s*[\r\n]", delimiter):
        return True
    if "\n" in delimiter or "\r" in delimiter:
        return bool(next_word and next_word[0].isupper())
    return False


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
        "engineering", "president", "director", "executive", "officer", "manager", "founder",
        "chairman", "secretary", "governor", "senator", "professor", "industrialist", "giant",
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
    """Computes a shared frame-level RMS and ZCR envelope (10ms hop, 20ms window) once per audio file.
    Includes unvoiced fricative onset detection (e.g. /f/, /θ/, /s/ in 'four', 'five', '400', 'three')
    where weak high-ZCR friction precedes a voiced vowel nucleus.
    """
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

    # Detect unvoiced fricative onsets/codas: strong sibilants (rms >= 0.0085, zcr >= 0.25)
    # OR weak labiodental/dental fricative onsets (/f/, /θ/ as in 'four', 'five', '400':
    # rms >= max(0.0018, p10 * 1.8) and zcr >= 0.30) within 260ms before a voiced nucleus.
    n_f = len(rms)
    fricative_mask = (rms >= 0.0085) & (zcr >= 0.25)
    weak_fric_cand = (rms >= 0.0006) & (zcr >= 0.42)
    voiced_core = (rms >= active_th) | fricative_mask
    if n_f > 1 and np.any(voiced_core):
        # Allow a single 10ms voice-onset transition frame (rms >= 0.0035, zcr >= 0.22) immediately before voiced_core
        trans_frame = np.zeros(n_f, dtype=bool)
        trans_frame[:-1] = voiced_core[1:] & (rms[:-1] >= 0.0035) & (zcr[:-1] >= 0.22)
        voiced_seed = voiced_core | trans_frame
    else:
        voiced_seed = voiced_core
    if np.any(weak_fric_cand) and np.any(voiced_seed):
        near_voiced = voiced_seed.copy()
        for _ in range(34):  # up to 340ms contiguous high-ZCR (/f/, /θ/) onset leading into vowel nucleus
            if n_f > 1:
                near_voiced[:-1] |= near_voiced[1:]
                near_voiced[1:] |= near_voiced[:-1]
                near_voiced &= (voiced_seed | weak_fric_cand)
        fricative_mask = fricative_mask | ((weak_fric_cand | trans_frame) & near_voiced)

    active_indices = np.where((rms >= active_th) | fricative_mask)[0]
    first_speech_sec = float(active_indices[0] * 0.01) if active_indices.size > 0 else 0.0
    last_speech_sec = float(active_indices[-1] * 0.01) if active_indices.size > 0 else (mono.size / float(sample_rate))
    return {
        "mono": mono,
        "sample_rate": sample_rate,
        "hop": hop,
        "win": win,
        "rms": rms,
        "zcr": zcr,
        "fricative_mask": fricative_mask,
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
    fricative_mask = envelope.get("fricative_mask")
    sil_th = float(envelope["sil_th"])
    active_th = float(envelope["active_th"])
    first_speech_sec = float(envelope["first_speech_sec"])
    last_speech_sec = float(envelope["last_speech_sec"])

    if fricative_mask is not None:
        is_quiet = (rms < sil_th) & ~fricative_mask
    else:
        is_quiet = (rms < sil_th) & ~((rms >= 0.0085) & (zcr >= 0.25))
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
                # Guard against DTW-snapped intra-word breaks where a silent valley starts well inside
                # a multi-syllable word w_i (v_s <= e_i - 0.06), leaving only the first syllable before v_s
                # while w_{i+1} absorbs the remaining syllables of w_i after v_e:
                s_i = float(asr_words[i].get("startSec", 0.0))
                e_next = float(asr_words[i + 1].get("endSec", 0.0))
                tok_i = clean_word(str(asr_words[i].get("word", "")))
                tok_next = clean_word(str(asr_words[i + 1].get("word", "")))
                syl_i = _estimate_expected_syllables(tok_i) if tok_i else 1
                syl_next = _estimate_expected_syllables(tok_next) if tok_next else 1
                f_si = max(0, int(round(s_i * 100)))
                f_vs = max(f_si, int(round(v_s * 100)))
                f_ve = min(len(rms), int(round(v_e * 100)))
                f_enext = min(len(rms), int(round(e_next * 100)))
                act_i = float(np.sum(rms[f_si:f_vs] >= active_th)) * 0.01
                act_next = float(np.sum(rms[f_ve:f_enext] >= active_th)) * 0.01
                if (
                    0.16 <= v_dur <= 0.35
                    and syl_i >= 2
                    and not re.search(r"\d", tok_i)
                    and not re.search(r"\d", tok_next)
                    and v_s <= e_i - 0.06
                    and 0.06 <= act_i <= max(0.18, 0.08 * syl_i)
                    and act_next >= (0.24 * syl_next + 0.20)
                ):
                    continue
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

                # Bidirectional guard: if both left and right sides inside [s_m, e_m] have substantial
                # active speech (>= 0.12s each) and the valley is well inside the word (> 0.15s from edges),
                # preserve it as a genuine intra-word break unless preceded by a number/unit abbreviation.
                right_speech_sec = float(np.sum(~is_quiet[f_ve:f_em])) * 0.01 if f_em > f_ve else 0.0
                right_peak = float(np.max(rms[f_ve:f_em])) if f_em > f_ve else 0.0
                is_genuine_midword_break = (
                    left_active >= 0.12
                    and dist_left > 0.15
                    and (
                        (right_active >= 0.12 and dist_right > 0.15)
                        or (syl_m >= 2 and dist_right >= 0.11 and right_speech_sec >= 0.10 and right_peak >= active_th * 1.5)
                    )
                    and not (prev_is_num_or_abbr and dist_left <= 0.38)
                )

                if not is_genuine_midword_break:
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


CONSTITUENT_INITIAL_FUNCTION_WORDS: set[str] = {
    "by", "for", "from", "with", "into", "onto", "across", "through", "throughout",
    "against", "between", "among", "under", "over", "below", "above", "without",
    "within", "inside", "outside", "beyond", "behind", "beneath", "beside", "near",
    "toward", "towards", "upon", "via", "than", "before", "after", "during", "while",
    "whereas", "although", "though", "because", "since", "unless", "until", "if",
    "when", "where", "whether", "that", "which", "who", "whose", "whom", "to", "in",
    "on", "at", "of", "as", "and", "or", "but", "nor", "so", "yet",
}

MODAL_AND_AUX_VERBS: set[str] = {
    "is", "are", "was", "were", "be", "been", "being",
    "will", "would", "can", "could", "should", "shall", "may", "might", "must",
    "has", "have", "had", "does", "do", "did",
}

SUBJECT_AND_RELATIVE_PRONOUNS: set[str] = {
    "i", "you", "he", "she", "it", "we", "they", "who", "which", "that", "what", "there", "here",
    "this", "these", "those",
}

INFINITIVE_TAKING_HEADS: set[str] = {
    "want", "wants", "wanted", "need", "needs", "needed", "try", "tries", "tried",
    "have", "has", "had", "ought", "used", "going", "able", "unable", "ready", "likely",
    "unlikely", "willing", "eager", "supposed", "allowed", "expected", "meant", "forced",
    "designed", "built", "made", "plan", "plans", "planned", "decide", "decided", "begin",
    "began", "start", "started", "continue", "continued", "fail", "failed", "refuse", "refused",
    "tend", "tends", "tended", "appear", "appears", "seem", "seems", "seemed", "attempt",
    "attempted", "manage", "managed", "expect", "expects", "choose", "chose", "chosen",
    "promise", "promised", "threaten", "threatened", "hope", "hopes", "hoped", "wish",
    "learn", "learned", "agree", "agreed", "offer", "offered", "claim", "claimed", "aim", "aims",
    "help", "helps", "helped", "lead", "leads", "led", "cause", "causes", "caused",
}

PHRASAL_PREPOSITION_LOCKS: dict[str, set[str]] = {
    "depend": {"on", "upon"}, "depends": {"on", "upon"}, "depended": {"on", "upon"}, "depending": {"on", "upon"},
    "rely": {"on", "upon"}, "relies": {"on", "upon"}, "relied": {"on", "upon"}, "relying": {"on", "upon"},
    "focus": {"on", "upon"}, "focuses": {"on", "upon"}, "focused": {"on", "upon"}, "focusing": {"on", "upon"},
    "base": {"on", "upon"}, "based": {"on", "upon"},
    "consist": {"of"}, "consists": {"of"}, "consisted": {"of"}, "consisting": {"of"},
    "composed": {"of"}, "made": {"of", "from", "up"}, "full": {"of"}, "capable": {"of"}, "instead": {"of"},
    "because": {"of"}, "out": {"of"}, "regardless": {"of"}, "ahead": {"of"}, "front": {"of"},
    "result": {"in", "from"}, "results": {"in", "from"}, "resulted": {"in", "from"}, "resulting": {"in", "from"},
    "lead": {"to"}, "leads": {"to"}, "led": {"to"}, "leading": {"to"},
    "compare": {"to", "with"}, "compared": {"to", "with"}, "relative": {"to"}, "similar": {"to"},
    "according": {"to"}, "due": {"to"}, "prior": {"to"}, "close": {"to"}, "next": {"to"},
    "up": {"to"}, "down": {"to"}, "equal": {"to"}, "equivalent": {"to"}, "thanks": {"to"},
    "look": {"at", "for", "into", "like"}, "looks": {"at", "for", "into", "like"}, "looking": {"at", "for", "into", "like"},
    "wait": {"for"}, "waits": {"for"}, "waiting": {"for"}, "account": {"for"}, "accounts": {"for"},
    "deal": {"with"}, "deals": {"with"}, "dealing": {"with"}, "replace": {"with"}, "filled": {"with"},
    "refer": {"to"}, "refers": {"to"}, "listen": {"to"}, "belong": {"to"}, "belongs": {"to"},
}

PARTITIVE_AND_GENITIVE_OF_HEADS: set[str] = {
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "some", "many", "most", "all", "both", "each", "none", "any", "few", "several",
    "half", "part", "parts", "piece", "pieces", "rest", "lot", "lots", "tons", "hundreds",
    "thousands", "millions", "billions", "tens", "dozens", "percent", "percentage", "majority",
    "minority", "fraction", "number", "amount", "pair", "pairs", "set", "sets", "group",
    "kind", "kinds", "type", "types", "sort", "sorts", "form", "forms", "version", "versions",
    "layer", "layers", "sheet", "sheets", "row", "rows", "block", "blocks", "ton", "pound", "pounds",
    "kilogram", "kilograms", "liter", "liters", "gallon", "gallons", "drop", "drops", "cup", "cups",
    "center", "middle", "edge", "top", "bottom", "side", "end", "start", "beginning", "cost", "costs",
    "price", "rate", "speed", "size", "weight", "length", "width", "height", "depth", "mass", "volume",
}

DET_AND_POSSESSIVE_SET: set[str] = (
    WEAK_CLITIC_ARTICLES
    | {"this", "that", "these", "those", "my", "your", "our", "their", "his", "her", "its", "every", "each", "no"}
)

LEXICAL_FINITE_VERBS: set[str] = {
    "weighs", "separates", "hits", "cuts", "shrinks", "slashes", "eliminates", "reduces",
    "takes", "burns", "releases", "uses", "achieves", "delivers", "requires", "brings",
    "sits", "stands", "pops", "slams", "sucks", "sprays", "makes", "means", "works",
    "jumps", "meant", "forced", "came", "cost", "costs", "grew", "tore", "began", "saw",
    "poured", "asked", "developed", "confirmed", "revealed", "launched", "equals", "vibrate",
    "spend", "spends", "spent", "builds", "build", "built", "found", "made", "used", "called", "named", "designed",
    "produces", "produce", "produced", "generates", "generate", "generated", "runs", "ran",
    "holds", "held", "creates", "create", "created", "provides", "provide", "provided",
    "allows", "allow", "allowed", "enables", "enable", "enabled", "prevents", "prevent",
    "keeps", "kept", "turns", "turned", "moves", "moved", "drives", "drove", "powers", "powered",
    "charges", "charged", "replaces", "replaced", "combines", "combined", "connects", "connected",
    "controls", "controlled", "supports", "supported", "includes", "included", "contains", "contained",
    "operates", "operated", "reaches", "reached", "drops", "dropped", "rises", "rose", "falls", "fell",
    "increases", "increased", "decreases", "decreased", "improves", "improved", "protects", "protected",
    "handles", "handled", "processes", "processed", "stores", "stored", "transfers", "transferred",
    "converts", "converted", "measures", "measured", "monitors", "monitored", "detects", "detected",
}

COMMON_FINITE_VERBS_AND_AUX: set[str] = MODAL_AND_AUX_VERBS | LEXICAL_FINITE_VERBS


def _analyze_clause_subject_structure(
    source_words: list[str],
    source_words_clean: list[str],
    delimiters: list[str] | None,
    src_idx1: int | None,
) -> dict[str, Any]:
    """Analyzes the syntactic structure of the clause constituent ending at `src_idx1`.
    Determines the start of the active clause (after punctuation or a clause-introducing conjunction),
    the length of the constituent in words, whether it is an unmodified subject NP vs a heavy branching
    subject NP (with post-nominal PP/modifier), and whether a main verb has already appeared earlier
    in the clause (making `src_idx1` part of the predicate/object rather than the subject).
    """
    if src_idx1 is None or src_idx1 < 0 or src_idx1 >= len(source_words_clean):
        return {
            "clause_start": 0,
            "constituent_len": 1,
            "is_subject_np": False,
            "has_post_modifier": False,
            "has_earlier_verb": False,
        }

    subordinating_clause_conj = (
        (CLAUSE_BOUNDARY_CONJUNCTIONS - {"and", "or", "và", "hoặc", "hay"})
        | {"that", "which", "who", "whose", "whom", "where", "when", "while", "if", "because", "although", "though", "since", "unless", "until", "whether", "once", "but", "yet", "so", "nor"}
    )
    clause_start = 0
    for k in range(src_idx1, 0, -1):
        if delimiters and k < len(delimiters):
            next_tok = source_words[k] if k < len(source_words) else ""
            if has_punctuation_boundary(delimiters[k], next_tok):
                # Do not stop at serial list commas inside a coordinated NP ('the seats, center console, carpeting, and wiring harnesses')
                if "," in delimiters[k] and any(w in ("and", "or") for w in source_words_clean[k : src_idx1 + 1]):
                    pass
                else:
                    clause_start = k
                    break
        prev_tok_c = source_words_clean[k - 1]
        if prev_tok_c in subordinating_clause_conj:
            clause_start = k
            break
        if prev_tok_c in ("and", "or"):
            # 'and'/'or' only starts a new clause if a finite verb already appeared before 'and'/'or' in the current sentence
            # Otherwise ('Fresh aluminum ingots and recycled factory scrap', 'every casting and every sub assembly'),
            # 'and'/'or' coordinates NPs inside a compound Subject NP!
            sentence_floor = max(0, k - 12)
            for m in range(k - 1, sentence_floor, -1):
                if delimiters and m < len(delimiters) and has_punctuation_boundary(delimiters[m], source_words[m] if m < len(source_words) else ""):
                    if "," not in delimiters[m]:
                        sentence_floor = m
                        break
                if source_words_clean[m - 1] in subordinating_clause_conj:
                    sentence_floor = m
                    break
            verb_before_and = False
            for m in range(sentence_floor, k - 1):
                tok_m = source_words_clean[m]
                prev_m = source_words_clean[m - 1] if m > sentence_floor else ""
                if tok_m in MODAL_AND_AUX_VERBS or (tok_m in LEXICAL_FINITE_VERBS and prev_m not in DET_AND_POSSESSIVE_SET):
                    verb_before_and = True
                    break
            if verb_before_and:
                clause_start = k
                break

    span_clean = [w for w in source_words_clean[clause_start : src_idx1 + 1] if w]
    constituent_len = len(span_clean)
    earlier_tokens = span_clean[:-1]

    # Check if an unambiguous finite verb / auxiliary already appeared earlier in the clause
    # (exclude words immediately preceded by a determiner or adjective/noun stack, e.g. 'the cost', 'tolerance stack up')
    has_earlier_verb = False
    for offset, tok_c in enumerate(earlier_tokens):
        abs_idx = clause_start + offset
        prev_before_tok = source_words_clean[abs_idx - 1] if abs_idx > clause_start else ""
        if tok_c in MODAL_AND_AUX_VERBS:
            has_earlier_verb = True
            break
        if tok_c in LEXICAL_FINITE_VERBS and prev_before_tok not in DET_AND_POSSESSIVE_SET:
            # Exclude 'think'/'believe'/'know' complement clause introductions ('if you think tolerance stack up and casting defects will')
            if tok_c in ("think", "believe", "know", "hope", "say", "said", "confirm", "confirmed", "reveal", "revealed", "mean", "means", "meant"):
                continue
            has_earlier_verb = True
            break

    intro_preps = {
        "in", "on", "at", "by", "for", "with", "from", "during", "under", "over",
        "between", "through", "across", "inside", "outside", "without", "within",
        "after", "before", "despite", "throughout", "upon", "into", "onto", "near", "around",
    }
    prep_modifiers = {
        "in", "of", "on", "at", "for", "with", "from", "by", "to", "into",
        "between", "under", "over", "across", "through", "without", "within", "near", "around",
        "and", "or",
    }

    # Do not assume every pre-verbal constituent is a Subject NP:
    # If the clause starts with an introductory prepositional phrase ('In the factory...', 'During the test...'),
    # check whether a separate Subject NP starts after the introductory PP object.
    subj_tokens = span_clean
    is_intro_pp = bool(span_clean and span_clean[0] in intro_preps)
    if has_earlier_verb:
        is_subject_np = False
    elif is_intro_pp:
        # Look for a second determiner/pronoun introducing the true subject NP after the introductory PP (at index >= 2)
        subj_start_offset = None
        for idx_s in range(2, len(span_clean)):
            if span_clean[idx_s] in (DET_AND_POSSESSIVE_SET | SUBJECT_AND_RELATIVE_PRONOUNS) and span_clean[idx_s - 1] not in intro_preps:
                subj_start_offset = idx_s
                break
        if subj_start_offset is not None:
            subj_tokens = span_clean[subj_start_offset:]
            constituent_len = len(subj_tokens)
            is_subject_np = True
        else:
            is_subject_np = False
    else:
        is_subject_np = True

    subj_earlier = subj_tokens[:-1]
    has_post_modifier = (
        is_subject_np
        and len(subj_earlier) >= 2
        and any(t in prep_modifiers for t in subj_earlier[1:])
    )

    return {
        "clause_start": clause_start,
        "constituent_len": constituent_len,
        "is_subject_np": is_subject_np,
        "has_post_modifier": has_post_modifier,
        "has_earlier_verb": has_earlier_verb,
    }


def _is_contextual_3sg_finite_verb(
    c1: str,
    c2: str,
    prev_c: str,
    is_subject_np: bool,
    constituent_len: int,
    allow_heavy_subject: bool = False,
) -> bool:
    """Detects regular 3rd-person singular finite verbs ('produces', 'operates', 'generates', 'owns')
    following a singular Determiner + Noun subject ('The machine produces') or, when
    `allow_heavy_subject=True`, following a heavy multi-word Subject NP ('...company on earth | owns').
    """
    if c2 in LEXICAL_FINITE_VERBS:
        return True
    if not is_subject_np:
        return False
    if not allow_heavy_subject:
        if constituent_len > 3:
            return False
        if constituent_len > 1 and prev_c not in ("the", "a", "an", "this", "that", "its", "his", "her", "our", "your", "my", "each", "every"):
            return False
    if not c1 or c1.endswith("ly"):
        return False
    if len(c2) < 4 or not c2.endswith("s") or c2.endswith(("ss", "us", "is", "os", "ics", "ous", "ness", "less")):
        return False
    if c2 in (
        CONSTITUENT_INITIAL_FUNCTION_WORDS
        | MODAL_AND_AUX_VERBS
        | DET_AND_POSSESSIVE_SET
        | {"as", "thus", "plus", "always", "sometimes", "perhaps", "towards", "besides", "across", "whereas"}
    ):
        return False
    return True


def is_prosodic_phrase_boundary(
    source_words: list[str],
    source_words_clean: list[str],
    src_idx1: int | None,
    src_idx2: int | None,
    w1_raw: str,
    w2_raw: str,
    delimiters: list[str] | None = None,
) -> bool:
    """Identifies high-confidence natural syntactic/prosodic phrase boundaries (Tier 3 PPB)
    where speakers legitimately pause (0.25s–0.58s) between distinct heavy syntactic constituents.
    Strictly excludes tight grammatical pairs such as:
      - Short/unmodified Subject NP + Verb or Auxiliary (`The motor is`, `The system can`, `The machine produces`, `Tesla builds`)
      - Verb/Adj + infinitive 'to' (`want to`, `need to`, `able to`)
      - Subject pronoun + verb/modal (`you can`, `it is`, `they will`)
      - Modal/Auxiliary + verb (`can generate`, `will reduce`, `to build`)
      - Preposition + object (`from 60`, `between 200`, `in the`)
      - Fixed verb/noun + preposition (`depend on`, `part of`, `result in`)
    """
    c1 = clean_word(w1_raw)
    c2 = clean_word(w2_raw)
    if not c1 or not c2:
        return False

    # Never treat locked phrasal/prepositional heads as PPBs
    if c1 in PHRASAL_PREPOSITION_LOCKS and c2 in PHRASAL_PREPOSITION_LOCKS[c1]:
        return False

    # Never treat infinitival heads + 'to' ('want to', 'need to') or 'to' + verb as PPBs
    if c2 == "to" and c1 in INFINITIVE_TAKING_HEADS:
        return False

    # Never treat partitive/genitive head + 'of' ('part of', 'one of', 'tons of') as PPBs
    if c2 == "of" and (c1 in PARTITIVE_AND_GENITIVE_OF_HEADS or is_version_or_number_token(w1_raw)):
        return False

    # Never treat Subject/Relative Pronoun + Verb/Aux ('you can', 'it weighs', 'that forced') as PPBs
    if c1 in SUBJECT_AND_RELATIVE_PRONOUNS:
        return False

    # Never treat Modal/Aux + Verb ('can generate', 'will cost', 'is built') as PPBs
    if c1 in MODAL_AND_AUX_VERBS:
        return False

    # Do not treat determiner/preposition + immediate complement as PPB
    if c1 in (DET_AND_POSSESSIVE_SET | CONSTITUENT_INITIAL_FUNCTION_WORDS):
        return False

    prev_c = source_words_clean[src_idx1 - 1] if (src_idx1 is not None and src_idx1 > 0) else ""
    next_c = source_words_clean[src_idx2 + 1] if (src_idx2 is not None and src_idx2 + 1 < len(source_words_clean)) else ""

    # Numeric range conjunctions ('between 200 and 300', 'from 60 to 70') are tight, never PPB
    if c2 in ("and", "to", "or") and is_version_or_number_token(w1_raw) and (
        is_version_or_number_token(next_c) or prev_c in ("between", "from")
    ):
        return False

    clause_info = _analyze_clause_subject_structure(
        source_words, source_words_clean, delimiters, src_idx1
    )
    constituent_len = int(clause_info["constituent_len"])
    is_subject_np = bool(clause_info["is_subject_np"])
    has_post_modifier = bool(clause_info["has_post_modifier"])
    has_earlier_verb = bool(clause_info["has_earlier_verb"])

    prev2_c = source_words_clean[src_idx1 - 2] if (src_idx1 is not None and src_idx1 >= 2) else ""
    # For 'to', only allow PPB when 'to' follows a clear Noun/NP object or Proper Noun (e.g. 'named Idra | to build', 'the brake pads | to retract'),
    # never after an unverified bare verb or short function word.
    if c2 == "to":
        tok1_raw = source_words[src_idx1] if (src_idx1 is not None and 0 <= src_idx1 < len(source_words)) else w1_raw
        tok1_strip = re.sub(r"^[^\w\u00C0-\u1EF9]+|[^\w\u00C0-\u1EF9]+$", "", tok1_raw)
        is_np_object_before_to = (
            (tok1_strip and tok1_strip[0].isupper() and c1 not in ENTITY_NON_PROPER_HEADS)
            or prev_c in DET_AND_POSSESSIVE_SET
            or prev2_c in DET_AND_POSSESSIVE_SET
            or c1.endswith(("tion", "sion", "ment", "ness", "ity", "ship", "ance", "ence"))
            or is_version_or_number_token(w1_raw)
        )
        return bool(is_np_object_before_to)

    # For 'of', allow PPB only after a modified quantitative NP ('wiping out roughly 700 | of the 1,000')
    if c2 == "of":
        if is_version_or_number_token(w1_raw) and prev_c in ("roughly", "nearly", "almost", "about", "around", "over", "under"):
            return True
        return False

    # 1. Boundary before a major preposition, complementizer, subordinating or coordinating conjunction, or resultative particle:
    # Require that the preceding constituent has at least 2 words (not a single word at clause start),
    # that short clause-initial NPs (<= 3 words before any verb) are NOT broken before an attributive PP ('The motor | in the car'),
    # and that `c1` is not a bare main verb followed directly by a particle or subcategorized preposition.
    if c2 in ((CONSTITUENT_INITIAL_FUNCTION_WORDS - {"to", "of"}) | PROSODIC_CONJUNCTIONS | {"down", "up", "out"}):
        if src_idx1 is not None and constituent_len <= 1 and len(c1) <= 5:
            return False
        is_attributive_prep = c2 in (
            "in", "on", "at", "from", "with", "for", "by", "under", "over",
            "between", "into", "onto", "within", "without", "through", "across", "against",
        )
        if src_idx1 is not None and is_attributive_prep and not has_earlier_verb and constituent_len <= 3:
            return False
        # Do not treat Verb + Particle ('breaks | down', 'heating | up', 'wiping | out', 'poured | into') as PPB
        # unless `c1` is actually a noun object (preceded by a determiner/modifier or after an earlier verb in the clause).
        c1_is_noun_object = (
            prev_c in DET_AND_POSSESSIVE_SET
            or prev2_c in DET_AND_POSSESSIVE_SET
            or prev_c.endswith(("ing", "ed", "al", "ive", "ic", "ous", "ful", "less", "ment", "tion", "sion"))
            or c1 in ("costs", "cost", "parts", "part", "cuts", "hits", "runs", "drops", "works", "stands", "jumps", "means", "uses", "loads", "charges", "stores", "forces")
            or is_version_or_number_token(w1_raw)
        )
        if c1 in LEXICAL_FINITE_VERBS and not c1_is_noun_object and c2 in ("down", "up", "out", "off", "into", "onto", "from", "with", "at", "on", "in"):
            return False
        return True

    # 2. Boundary between a genuinely HEAVY branching Subject NP and a Finite Verb:
    # Short subjects ('The motor | is', 'The system | can', 'The machine | produces', 'Tesla | builds')
    # are NEVER prosodic phrase boundaries.
    if c2 in COMMON_FINITE_VERBS_AND_AUX or _is_contextual_3sg_finite_verb(
        c1, c2, prev_c, is_subject_np, constituent_len, allow_heavy_subject=True
    ):
        if src_idx1 is None or not is_subject_np:
            return False
        if c2 in MODAL_AND_AUX_VERBS:
            # Copulas and modals ('is', 'can', 'will') only allow a preceding break after a very heavy post-modified NP (>= 5 words)
            return bool(constituent_len >= 5 and has_post_modifier)
        # Lexical finite verbs require a heavy multi-word subject NP (>= 4 words, or >= 3 words with post-nominal modifier)
        return bool(constituent_len >= 4 or (constituent_len >= 3 and has_post_modifier))

    # 3. Boundary before a post-nominal -ing participle (or adverb + -ing participle like 'unit | eventually stepping')
    # introducing a participial/reduced-relative clause
    non_participle_heads = (
        COMMON_FINITE_VERBS_AND_AUX
        | {"keep", "kept", "start", "started", "begin", "continue", "stop", "stopped", "try", "tried", "already", "actually", "still", "just", "by", "for", "in", "of", "without", "before", "after", "while"}
    )
    if len(c2) >= 6 and c2.endswith("ing") and c1 not in non_participle_heads:
        return True
    if (
        len(c2) >= 6
        and c2.endswith("ly")
        and len(next_c) >= 6
        and next_c.endswith("ing")
        and c1 not in (non_participle_heads | DET_AND_POSSESSIVE_SET | CONSTITUENT_INITIAL_FUNCTION_WORDS)
    ):
        return True

    # 4. Boundary before post-nominal reduced relative comparative ('vehicle | smaller than', 'particles | larger than')
    if c2 in ("smaller", "larger", "bigger", "lighter", "heavier", "cheaper", "higher", "lower", "stronger", "weaker") and next_c == "than":
        return True

    return False


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
        next_src_tok = source_words[src_idx2] if 0 <= src_idx2 < len(source_words) else ""
        if has_punctuation_boundary(combined_delim, next_src_tok):
            return False, "", default_min_pause

    c1 = clean_word(w1_raw)
    c2 = clean_word(w2_raw)
    if not c1 or not c2:
        return False, "", default_min_pause

    prev_c = source_words_clean[src_idx1 - 1] if (src_idx1 is not None and src_idx1 > 0) else ""
    next_c = source_words_clean[src_idx2 + 1] if (src_idx2 is not None and src_idx2 + 1 < len(source_words_clean)) else ""
    tok1_raw = source_words[src_idx1] if (src_idx1 is not None and 0 <= src_idx1 < len(source_words)) else w1_raw
    tok2_raw = source_words[src_idx2] if (src_idx2 is not None and 0 <= src_idx2 < len(source_words)) else w2_raw
    tok1_strip = re.sub(r"^[^\w\u00C0-\u1EF9]+|[^\w\u00C0-\u1EF9]+$", "", tok1_raw)
    tok2_strip = re.sub(r"^[^\w\u00C0-\u1EF9]+|[^\w\u00C0-\u1EF9]+$", "", tok2_raw)

    # 1. Compound Preposition / Phrasal Preposition Lock ('down to', 'up to', 'depend on', 'result in', 'into a')
    if (
        (c1 in PHRASAL_PREPOSITION_LOCKS and c2 in PHRASAL_PREPOSITION_LOCKS[c1])
        or (
            c1 in ("down", "up", "out", "off", "prior", "according", "due", "close", "next", "instead", "ahead", "apart", "aside")
            and c2 in ("to", "of", "from")
        )
        or (
            c1 in ("into", "onto", "within", "without", "upon", "towards", "toward", "across", "through", "throughout", "against", "among")
            and c2 in (WEAK_CLITIC_ARTICLES | {"this", "that", "these", "those", "its", "their", "his", "her", "our", "your", "my", "unified", "one", "single"})
        )
    ):
        return True, "tight_preposition", max(0.28, 0.30 / eff_speed)

    # 1b. Verb/Adjective + Infinitive 'to' ('want to', 'need to', 'able to') or Infinitive 'to' + bare verb ('to build', 'to make')
    if c2 == "to" and c1 in INFINITIVE_TAKING_HEADS:
        return True, "tight_infinitive", max(0.24, 0.26 / eff_speed)
    if (
        c1 == "to"
        and c2 not in (WEAK_CLITIC_ARTICLES | CONSTITUENT_INITIAL_FUNCTION_WORDS | {"this", "that", "these", "those", "its", "their", "his", "her", "our", "your", "my", "just", "well", "roughly", "nearly", "about", "around"})
        and not is_version_or_number_token(w2_raw)
        and not (tok2_strip and tok2_strip[0].isupper())
    ):
        return True, "tight_infinitive", max(0.24, 0.26 / eff_speed)

    # 1c. Subject Pronoun + Auxiliary/Verb ('you can', 'it weighs', 'we need', 'they are')
    # Excludes object pronoun + preposition ('see you | in', 'drops it | to')
    if c1 in ("i", "you", "he", "she", "it", "we", "they", "there") and (
        c2 in (MODAL_AND_AUX_VERBS | COMMON_FINITE_VERBS_AND_AUX | INFINITIVE_TAKING_HEADS)
    ):
        return True, "tight_pronoun_verb", max(0.24, 0.26 / eff_speed)

    # 1c-ii. Short Nominal Subject NP + Auxiliary/Copula ('The motor is', 'The system can', 'Motors are')
    # or Short 1-2 word Subject NP + Lexical Finite Verb ('The machine produces', 'This motor generates', 'Tesla builds')
    clause_info = _analyze_clause_subject_structure(
        source_words, source_words_clean, delimiters, src_idx1
    )
    subj_len = int(clause_info["constituent_len"])
    is_subj_np = bool(clause_info["is_subject_np"])
    has_post_mod = bool(clause_info["has_post_modifier"])
    has_earlier_v = bool(clause_info["has_earlier_verb"])

    if c2 in MODAL_AND_AUX_VERBS and c1 not in (PROSODIC_CONJUNCTIONS | CLAUSE_BOUNDARY_CONJUNCTIONS | CONSTITUENT_INITIAL_FUNCTION_WORDS):
        if (src_idx1 is not None and is_subj_np and subj_len <= 2 and not has_post_mod) or (
            src_idx1 is None and prev_c in DET_AND_POSSESSIVE_SET
        ):
            return True, "tight_subject_aux", max(0.26, 0.28 / eff_speed)
        if src_idx1 is not None and is_subj_np and subj_len == 3 and not has_post_mod:
            return True, "tight_subject_aux", max(0.31, 0.32 / eff_speed)

    if (
        c2 in LEXICAL_FINITE_VERBS
        or _is_contextual_3sg_finite_verb(c1, c2, prev_c, is_subj_np, subj_len)
    ) and c1 not in (PROSODIC_CONJUNCTIONS | CLAUSE_BOUNDARY_CONJUNCTIONS | CONSTITUENT_INITIAL_FUNCTION_WORDS):
        if (src_idx1 is not None and is_subj_np and subj_len <= 2 and not has_post_mod) or (
            src_idx1 is None and prev_c in DET_AND_POSSESSIVE_SET
        ):
            return True, "tight_subject_verb", max(0.28, 0.30 / eff_speed)

    # 1c-iii. Lexical Verb + Phrasal Particle ('breaks down', 'shuts down', 'heating up', 'wiping out')
    c1_is_noun_obj = (
        prev_c in DET_AND_POSSESSIVE_SET
        or prev_c.endswith(("ing", "ed", "al", "ive", "ic", "ous", "ful", "less", "ment", "tion", "sion"))
        or c1 in ("costs", "cost", "parts", "part", "cuts", "hits", "runs", "drops", "works", "stands", "jumps", "means", "uses", "loads", "charges", "stores", "forces")
        or is_version_or_number_token(w1_raw)
    )
    if c1 in LEXICAL_FINITE_VERBS and not c1_is_noun_obj and c2 in ("down", "up", "out", "off", "away", "back"):
        return True, "tight_verb_particle", max(0.26, 0.28 / eff_speed)

    # 1d. Modal / Auxiliary + Verb / Participle ('can generate', 'will reduce', 'has built', 'do not')
    if c1 in (
        "can", "could", "will", "would", "shall", "should", "may", "might", "must",
        "has", "have", "had", "do", "does", "did"
    ) and c2 not in (
        WEAK_CLITIC_ARTICLES | CONSTITUENT_INITIAL_FUNCTION_WORDS | PROSODIC_CONJUNCTIONS | {"this", "that", "these", "those", "my", "your", "our", "their", "his", "her", "its"}
    ):
        return True, "tight_aux_verb", max(0.24, 0.26 / eff_speed)

    # 1e. Fixed Partitive Quantifier + 'of' ('part of', 'one of', 'tons of', 'lots of')
    if c2 == "of" and c1 in (
        "part", "parts", "one", "lot", "lots", "tons", "piece", "pieces",
        "kind", "kinds", "type", "types", "sort", "sorts", "hundreds", "thousands",
        "millions", "billions", "tens", "dozens", "none", "all", "both", "each", "some", "many", "most", "any", "few", "several", "half"
    ):
        return True, "tight_partitive_of", max(0.25, 0.27 / eff_speed)

    # 2. Preposition + Number / Quantitative Complement (e.g. 'below 40', 'between 200', 'from 60')
    if c1 in (
        "below", "above", "under", "over", "from", "between", "around", "roughly",
        "nearly", "about", "at", "by", "of", "in", "for", "with", "to", "into", "onto"
    ) and (is_version_or_number_token(tok2_strip) or is_version_or_number_token(w2_raw)):
        return True, "tight_preposition_number", max(0.24, 0.26 / eff_speed)

    # 2b. Preposition + Determiner/Article/Possessive Complement ('in the', 'on a', 'for its', 'with this')
    if c1 in (
        "in", "on", "at", "by", "for", "with", "from", "into", "onto", "within", "without", "under", "over", "below", "above", "between", "through", "across"
    ) and c2 in (
        WEAK_CLITIC_ARTICLES | {"this", "that", "these", "those", "my", "your", "our", "their", "his", "her", "its"}
    ):
        return True, "tight_preposition_complement", max(0.25, 0.27 / eff_speed)

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
        return True, "tight_numeric_range", max(0.28, 0.30 / eff_speed)

    # 4. Determiner / Demonstrative / Possessive + Head/Modifier/Number (e.g. 'this 50,000-ton', 'a single', 'the traditional')
    if c1 in ("the", "a", "an", "this", "these", "those", "my", "your", "our", "their", "his", "her", "its") and c2 not in (
        PROSODIC_CONJUNCTIONS | COMMON_FINITE_VERBS_AND_AUX
    ):
        return True, "tight_determiner", max(0.22, 0.24 / eff_speed)
    if c1 in ("every", "each", "no") and c2 not in (PROSODIC_CONJUNCTIONS | COMMON_FINITE_VERBS_AND_AUX):
        return True, "tight_determiner", max(0.29, 0.31 / eff_speed)

    # 5. Tight Comparative Construction: Verb/Noun + Adverbial Comparative before 'than' (e.g. 'sinking ships faster than')
    # Exclude post-nominal reduced relative adjectives ('a vehicle smaller than', 'particles larger than')
    if c2 in (
        "faster", "slower", "better", "worse", "harder", "easier",
        "less", "more", "longer", "shorter", "sooner", "further", "closer"
    ) and next_c == "than":
        return True, "tight_comparative", max(0.22, 0.23 / eff_speed)

    # 6. Prenominal Quantifier/Determiner-Adjective + Proper Noun or Det-Adj-CommonNoun (e.g. 'a single Liberty', 'a traditional body shop')
    if (
        prev_c in ("a", "an", "the", "this", "that", "every", "each")
        and c1 in ("single", "first", "new", "old", "entire", "whole", "main", "only", "standard", "traditional", "massive", "giant")
        and tok2_strip
        and tok2_strip[0].isupper()
        and not tok2_strip.isupper()
        and c2 not in ENTITY_NON_PROPER_HEADS
    ):
        return True, "tight_modifier_noun", max(0.22, 0.23 / eff_speed)

    if (
        prev_c in ("a", "an", "the", "this", "these", "those", "its", "their", "his", "her", "our", "your")
        and c1 not in (ENTITY_NON_PROPER_HEADS | COMMON_FINITE_VERBS_AND_AUX | CONSTITUENT_INITIAL_FUNCTION_WORDS)
        and not is_version_or_number_token(w1_raw)
        and not (tok1_strip and tok1_strip[0].isupper())
        and not (len(c1) >= 5 and c1.endswith("ing"))
        and c2 not in (
            ENTITY_NON_PROPER_HEADS
            | CONSTITUENT_INITIAL_FUNCTION_WORDS
            | COMMON_FINITE_VERBS_AND_AUX
            | {"down", "up", "out", "off", "away", "back", "together", "apart", "alone"}
        )
        and not is_version_or_number_token(w2_raw)
        and not (tok2_strip and tok2_strip[0].isupper())
        and not (len(c2) >= 5 and c2.endswith(("ing", "ed")))
    ):
        return True, "tight_modifier_noun", max(0.24, 0.26 / eff_speed)

    return False, "", default_min_pause


def evaluate_syntactic_boundary(
    source_words: list[str],
    source_words_clean: list[str],
    delimiters: list[str],
    src_idx1: int | None,
    src_idx2: int | None,
    w1_raw: str,
    w2_raw: str,
    eff_speed: float = 1.0,
    default_min_pause: float = 0.50,
    prev_has_punct: bool = False,
) -> dict[str, Any]:
    """Evaluates the syntactic and prosodic relationship between two adjacent tokens with an internal
    structural heuristic priority tier (`rule_score`, NOT a calibrated statistical probability) and classification:
      - `TIGHT_COHESION`: tokens belong to a single tight syntactic constituent; pauses >= threshold_sec are unnatural.
      - `NATURAL_BOUNDARY`: verified prosodic phrase boundary or punctuated break; pauses up to ~0.62s are natural.
      - `UNCERTAIN_BOUNDARY`: ambiguous or unmapped constituent boundary; never receives the 0.62s natural-boundary exemption.
    """
    eff_spd = max(0.5, float(eff_speed or 1.0))
    base_min_pause = max(0.35, float(default_min_pause) / eff_spd)

    # Check source punctuation first
    if src_idx1 is not None and src_idx2 is not None and src_idx2 > src_idx1:
        combined_delim = "".join(delimiters[k] for k in range(src_idx1 + 1, min(len(delimiters), src_idx2 + 1)))
        next_src_tok = source_words[src_idx2] if 0 <= src_idx2 < len(source_words) else ""
        if has_punctuation_boundary(combined_delim, next_src_tok):
            return {
                "classification": "NATURAL_BOUNDARY",
                "relation": "punctuation_boundary",
                "rule_score": 1.0,
                "threshold_sec": max(base_min_pause, 0.75 / eff_spd),
                "is_protected": False,
                "entity_kind": "",
                "is_tight_cohesion": False,
                "cohesion_kind": "",
                "is_prosodic_boundary": True,
            }

    is_protected, entity_kind = is_protected_entity_pair(
        source_words, delimiters, src_idx1, src_idx2, w1_raw, w2_raw
    )
    is_tight, cohesion_kind, tight_thresh = classify_phrase_cohesion_pair(
        source_words,
        source_words_clean,
        delimiters,
        src_idx1,
        src_idx2,
        w1_raw,
        w2_raw,
        eff_spd,
        base_min_pause,
    )
    if is_protected or is_tight:
        rel = entity_kind if is_protected else cohesion_kind
        r_score = 1.0 if is_protected else (0.9 if (src_idx1 is not None and src_idx2 is not None) else 0.75)
        return {
            "classification": "TIGHT_COHESION",
            "relation": rel,
            "rule_score": r_score,
            "threshold_sec": tight_thresh,
            "is_protected": is_protected,
            "entity_kind": entity_kind,
            "is_tight_cohesion": True,
            "cohesion_kind": rel,
            "is_prosodic_boundary": False,
        }

    c1 = clean_word(w1_raw)
    is_sentence_initial_conj = (
        prev_has_punct
        and c1 in ("because", "or", "and", "but", "while", "although", "if", "when", "since", "so", "plus", "instead", "normally")
    )
    is_ppb = is_prosodic_phrase_boundary(
        source_words, source_words_clean, src_idx1, src_idx2, w1_raw, w2_raw, delimiters=delimiters
    )

    if is_ppb or is_sentence_initial_conj:
        # Only grant NATURAL_BOUNDARY (0.62s) when source mapping is known
        if src_idx1 is not None and src_idx2 is not None:
            return {
                "classification": "NATURAL_BOUNDARY",
                "relation": "sentence_initial_discourse" if is_sentence_initial_conj else "prosodic_phrase_boundary",
                "rule_score": 0.85,
                "threshold_sec": max(base_min_pause, 0.62 / eff_spd),
                "is_protected": False,
                "entity_kind": "",
                "is_tight_cohesion": False,
                "cohesion_kind": "",
                "is_prosodic_boundary": True,
            }
        return {
            "classification": "UNCERTAIN_BOUNDARY",
            "relation": "unmapped_prosodic_candidate",
            "rule_score": 0.5,
            "threshold_sec": base_min_pause,
            "is_protected": False,
            "entity_kind": "",
            "is_tight_cohesion": False,
            "cohesion_kind": "",
            "is_prosodic_boundary": False,
        }

    # Short clause-initial NP before an attributive modifying preposition (e.g. 'The motor | in the car')
    # forms a tight subject constituent where pausing >= 0.38s breaks the subject NP.
    if (
        src_idx1 is not None
        and src_idx2 == src_idx1 + 1
        and 0 <= src_idx2 < len(source_words_clean)
        and source_words_clean[src_idx2] in (
            "in", "on", "at", "from", "with", "for", "by", "under", "over",
            "between", "into", "onto", "within", "without", "through", "across", "against", "of",
        )
    ):
        clause_start = src_idx1
        while clause_start > 0:
            d = delimiters[clause_start] if clause_start < len(delimiters) else ""
            prev_tok = source_words[clause_start] if clause_start < len(source_words) else ""
            if has_punctuation_boundary(d, prev_tok) or source_words_clean[clause_start] in CLAUSE_BOUNDARY_CONJUNCTIONS:
                break
            clause_start -= 1
        if (src_idx1 - clause_start + 1) <= 2:
            return {
                "classification": "UNCERTAIN_BOUNDARY",
                "relation": "short_np_attributive_preposition",
                "rule_score": 0.72,
                "threshold_sec": max(0.36, 0.38 / eff_spd),
                "is_protected": False,
                "entity_kind": "",
                "is_tight_cohesion": False,
                "cohesion_kind": "",
                "is_prosodic_boundary": False,
            }

    return {
        "classification": "UNCERTAIN_BOUNDARY",
        "relation": "general_clause_internal",
        "rule_score": 0.6 if (src_idx1 is not None and src_idx2 is not None) else 0.4,
        "threshold_sec": base_min_pause,
        "is_protected": False,
        "entity_kind": "",
        "is_tight_cohesion": False,
        "cohesion_kind": "",
        "is_prosodic_boundary": False,
    }


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
      around [end1, start2], compensating for Whisper DTW padding into adjacent silence
      while respecting unvoiced fricative onsets (/f/, /θ/, /s/).
    """
    if audio_data is None or sample_rate <= 0 or audio_data.size == 0:
        gap = max(0.0, start2 - end1)
        return gap, gap

    frame_sz = max(1, int(round(0.02 * sample_rate)))

    def _is_frame_silent(frm: np.ndarray) -> bool:
        if frm.size == 0:
            return True
        rms = float(np.sqrt(np.mean(frm ** 2)))
        if rms >= silence_rms_threshold:
            return False
        if rms >= 0.0006:
            zcr = float(np.mean(np.abs(np.diff(np.signbit(frm))))) if frm.size > 1 else 0.0
            if (rms >= 0.0085 and zcr >= 0.25) or (rms >= 0.0006 and zcr >= 0.42):
                return False
        return True

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
                if _is_frame_silent(slice_gap[k * frame_sz : (k + 1) * frame_sz])
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
            if _is_frame_silent(frm):
                cur_run += 1
                if cur_run > best_run:
                    best_run = cur_run
            else:
                cur_run = 0
        max_contig_sec = max(direct_silence_sec, round(best_run * 0.02, 3))

    return direct_silence_sec, max_contig_sec



def clean_word(word: str) -> str:
    """Strip whitespace and punctuation for string comparison.
    Preserves decimal notation (e.g. '0.8', '.5' -> '0.5', '13,5' -> '13.5').
    """
    raw_trimmed = word.strip(" ,!?;:—–…()[]\"'“”„«»¿¡$€£¥₫").lower()
    m_lead_dec = re.fullmatch(r"(-?)\.(\d+)%?", raw_trimmed.rstrip("."))
    if m_lead_dec:
        return f"{m_lead_dec.group(1)}0.{m_lead_dec.group(2)}"
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
    slice_budget: list[int] | None = None,
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
    if (
        whisper_model is not None
        and (audio_path is not None or audio_data is not None)
        and (slice_budget is None or slice_budget[0] > 0)
    ):
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
    slice_budget: list[int] | None = None,
) -> list[dict[str, Any]]:
    """Extracts an isolated audio slice around `asr_words[j1:j2]` (including 1 preceding word
    for local onset framing, without the surrounding sentence so Whisper's LM cannot auto-correct
    a mispronounced acronym) and returns the transcribed slice words for the acronym.
    """
    if whisper_model is None or not asr_words or j1 >= len(asr_words):
        return []
    if slice_budget is not None and slice_budget[0] <= 0:
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

    if slice_budget is not None:
        slice_budget[0] -= 1

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


_LETTER_MULTIPLIERS: dict[str, int] = {
    "double": 2,
    "triple": 3,
    "quadruple": 4,
}


def _collapse_multiplied_letter_spans(
    spans: list[Any],
    raw_tokens: list[str],
    delimiters: list[str] | None = None,
    counterpart_clean: set[str] | None = None,
) -> list[Any]:
    """Normalizes spelled-out multiplied letter expressions (e.g. 'Triple A' / 'Triple-A' -> 'aaa',
    'Double A' -> 'aa', 'Triple B' -> 'bbb', 'Double U' -> 'w') into canonical spans so ASR acronym
    formatting ('AAA', 'AA', 'BBB') aligns cleanly without false missing-word warnings.
    """
    from .number_normalizer import NormalizedSpan

    if not spans:
        return spans

    out: list[Any] = []
    idx = 0
    n_spans = len(spans)
    punct_strip = " .,!?;:—–-…()[]\"'“”„«»¿¡"

    while idx < n_spans:
        sp = spans[idx]
        if not sp.is_number and (sp.orig_end - sp.orig_start) == 1 and sp.orig_start < len(raw_tokens):
            raw_tok = str(raw_tokens[sp.orig_start]).strip(punct_strip)
            # Single hyphenated token like 'Triple-A' or 'Double-B'
            m_hyph = re.fullmatch(r"(double|triple|quadruple)-([A-Za-z])", raw_tok, flags=re.IGNORECASE)
            if m_hyph:
                mult_str, let_raw = m_hyph.group(1).lower(), m_hyph.group(2)
                let_c = let_raw.lower()
                canon = "w" if (mult_str == "double" and let_c == "u") else (let_c * _LETTER_MULTIPLIERS[mult_str])
                if let_c not in ("a", "i") or let_raw.isupper() or raw_tok[0].isupper() or (
                    counterpart_clean is not None and canon in counterpart_clean
                ):
                    out.append(NormalizedSpan(canon, sp.orig_start, sp.orig_end, False))
                    idx += 1
                    continue

            c_mult = clean_word(raw_tok)
            if (
                c_mult in _LETTER_MULTIPLIERS
                and (idx + 1) < n_spans
                and not spans[idx + 1].is_number
                and (spans[idx + 1].orig_end - spans[idx + 1].orig_start) == 1
                and spans[idx + 1].orig_start == sp.orig_start + 1
                and spans[idx + 1].orig_start < len(raw_tokens)
            ):
                next_orig = spans[idx + 1].orig_start
                has_punct = (
                    delimiters is not None
                    and next_orig < len(delimiters)
                    and has_punctuation_boundary(delimiters[next_orig], str(raw_tokens[next_orig]))
                )
                if not has_punct:
                    next_raw = str(raw_tokens[next_orig]).strip(punct_strip)
                    next_c = clean_word(next_raw)
                    if c_mult == "double" and next_c in ("u", "you"):
                        if next_raw[:1].isupper() or raw_tok[:1].isupper() or (
                            counterpart_clean is not None and "w" in counterpart_clean
                        ):
                            out.append(NormalizedSpan("w", sp.orig_start, spans[idx + 1].orig_end, False))
                            idx += 2
                            continue
                    elif len(next_c) == 1 and next_c.isalpha():
                        canon = next_c * _LETTER_MULTIPLIERS[c_mult]
                        # Guard lowercase verb + article ('can triple a company') unless ASR produced 'aaa'
                        if next_c not in ("a", "i") or next_raw[:1].isupper() or raw_tok[:1].isupper() or (
                            counterpart_clean is not None and canon in counterpart_clean
                        ):
                            out.append(NormalizedSpan(canon, sp.orig_start, spans[idx + 1].orig_end, False))
                            idx += 2
                            continue

        out.append(sp)
        idx += 1

    return out


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
    slice_budget: list[int] | None = None,
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
                    slice_budget=slice_budget,
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
# Production pipeline budget: at most one targeted re-transcription per chunk (speed over marginal recall).
CORE_SECONDARY_SLICE_CHECKS = 1


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
    if src_idx < 0 or src_idx >= len(source_words_clean):
        return None

    sw = source_words_clean[src_idx]
    if len(sw) < 4 or sw in WEAK_CLITIC_ARTICLES:
        return None

    w_raw = str(w_obj.get("word", "")).strip()
    if w_raw.startswith("-"):
        return None

    w_prob = float(w_obj.get("probability", 1.0))
    next_src_peek = source_words_clean[src_idx + 1] if (src_idx + 1) < len(source_words_clean) else ""
    is_unassimilated_ed = (
        sw.endswith("ed")
        and len(sw) >= 5
        and not next_src_peek.startswith(("t", "d", "th"))
    )
    prob_threshold = 0.62 if is_unassimilated_ed else 0.55
    if w_prob >= prob_threshold:
        return None

    t_start = float(w_obj.get("startSec", 0.0))
    t_end = float(w_obj.get("endSec", 0.0))
    if t_end <= t_start:
        return None

    if slice_budget is not None and slice_budget[0] <= 0:
        ts = format_timestamp(t_start)
        src_raw_tok = re.sub(r"^[^\w\u00C0-\u1EF9]+|[^\w\u00C0-\u1EF9]+$", "", source_words[src_idx]) or sw
        return {
            "severity": "unverified",
            "code": "UNVERIFIED_WORD",
            "message": (
                f"Chưa thể xác minh từ '{src_raw_tok}' do độ tin cậy ASR thấp ({w_prob:.2f}) "
                f"và đã hết ngân sách nhận dạng bổ sung — khoảng {ts}."
            ),
            "words": [sw],
            "timeRange": [round(t_start, 3), round(t_end, 3)],
            "unverifiedReason": "slice_budget_exhausted",
        }

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
            if sw_clean_cand in (sw + "s", sw + "d", sw + "ed"):
                return None
            if sw == sw_clean_cand + "s" and next_src_clean.startswith(("s", "z", "sh", "ch")):
                return None
            if sw in (sw_clean_cand + "d", sw_clean_cand + "ed") and next_src_clean.startswith(("t", "d", "th")):
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
    elif (
        slice_budget is not None
        and slice_budget[0] <= 0
        and whisper_model is not None
        and audio_data is not None
    ):
        verdict = "unverified"

    # Whisper commonly confuses 'one point X' and 'zero point X' even
    # after a second pass or when no second pass can run. Neither PASS nor WARNING is justified by ASR alone.
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


def _consonant_skeleton(word: str) -> str:
    """Extracts the ordered consonant skeleton of a word for proper-noun verification.
    Ensures distinct consonant structures (e.g. 'Tesla' -> 'tsl' vs 'Tessa' -> 'ts')
    cannot be conflated by vowel-insensitive phonetic keys.
    """
    w = strip_tones_keep_vowels(clean_word(word))
    if not w:
        return ""
    s = re.sub(r"ph", "f", w)
    s = re.sub(r"ck|q", "k", s)
    s = re.sub(r"c(?=[eiy])", "s", s)
    s = re.sub(r"c", "k", s)
    s = re.sub(r"x", "ks", s)
    s = re.sub(r"[aeiouyăâêôơưh]+", "", s)
    s = re.sub(r"(.)\1+", r"\1", s)
    return s


def _is_valid_proper_noun_transliteration(sw: str, aw: str) -> bool:
    """Checks if `aw` is a benign ASR vowel/geminate transliteration variant of proper noun `sw`
    (e.g. 'Nevada' <-> 'Navada', 'Cerabeads' <-> 'Cerabeds') while rejecting consonant loss or
    substitution (e.g. 'Tesla' -> 'Tessa', 'BYD' -> 'B&D').
    """
    if not sw or not aw:
        return False
    if abs(len(sw) - len(aw)) > 1:
        return False
    if _consonant_skeleton(sw) != _consonant_skeleton(aw):
        return False
    if _estimate_expected_syllables(sw) != _estimate_expected_syllables(aw):
        return False
    return levenshtein_dist(phonetic_key(sw), phonetic_key(aw)) <= 1


def _has_sustained_speech_in_span(
    audio_data: np.ndarray | None,
    sample_rate: int,
    t0: float,
    t1: float,
    min_rms: float = 0.022,
    min_voiced_sec: float = 0.10,
) -> tuple[bool, float, float]:
    """Measures whether an audio time range [t0, t1] contains sustained speech energy.
    Returns (has_sustained_speech, span_rms, active_voiced_sec).
    """
    if audio_data is None or sample_rate <= 0 or t1 <= t0:
        return False, 0.0, 0.0
    s0 = max(0, int(round(t0 * sample_rate)))
    s1 = min(len(audio_data), int(round(t1 * sample_rate)))
    if s1 <= s0:
        return False, 0.0, 0.0
    seg = audio_data[s0:s1]
    span_rms = float(np.sqrt(np.mean(seg ** 2))) if seg.size > 0 else 0.0
    frame_sz = max(1, int(round(0.020 * sample_rate)))
    hop_sz = max(1, int(round(0.010 * sample_rate)))
    if seg.size < frame_sz:
        voiced_sec = (s1 - s0) / sample_rate if span_rms >= min_rms else 0.0
        return (span_rms >= min_rms and voiced_sec >= min_voiced_sec), span_rms, voiced_sec
    frames = np.lib.stride_tricks.sliding_window_view(seg, frame_sz)[::hop_sz]
    f_rms = np.sqrt(np.mean(frames ** 2, axis=1))
    active_frames = int(np.sum(f_rms >= max(0.014, min_rms * 0.70)))
    voiced_sec = active_frames * hop_sz / sample_rate
    return (span_rms >= min_rms and voiced_sec >= min_voiced_sec), span_rms, voiced_sec


def _count_vowel_nuclei_in_span(
    audio_data: np.ndarray | None,
    sample_rate: int,
    t0: float,
    t1: float,
) -> int:
    """Counts distinct voiced vowel energy peaks (syllable nuclei >= 40ms) inside [t0, t1].
    Used to distinguish continuous two-word speech ('building vast' = 3 nuclei) from speech
    containing an unaligned vowel/function word ('building a vast' = 4 nuclei).
    """
    if audio_data is None or sample_rate <= 0 or t1 <= t0:
        return 0
    s0 = max(0, int(round(t0 * sample_rate)))
    s1 = min(len(audio_data), int(round(t1 * sample_rate)))
    frame_sz = max(1, int(round(0.020 * sample_rate)))
    hop_sz = max(1, int(round(0.010 * sample_rate)))
    if s1 - s0 < frame_sz * 2:
        return 0
    seg = audio_data[s0:s1]
    frames = np.lib.stride_tricks.sliding_window_view(seg, frame_sz)[::hop_sz]
    if frames.shape[0] < 3:
        return 0
    rms = np.sqrt(np.mean(frames ** 2, axis=1))
    zcr = np.mean(np.abs(np.diff(np.signbit(frames), axis=1)), axis=1)
    p75 = float(np.percentile(rms, 75))
    if p75 < 0.018:
        return 0
    vowel_mask = (rms >= max(0.015, p75 * 0.34)) & (zcr < 0.24)
    valley_mask = (rms < p75 * 0.22) | (zcr >= 0.28)
    peaks: list[tuple[int, int]] = []
    run_s: int | None = None
    for idx in range(len(vowel_mask) + 1):
        v = bool(vowel_mask[idx]) if idx < len(vowel_mask) else False
        if v and run_s is None:
            run_s = idx
        elif not v and run_s is not None:
            if idx - run_s >= 4:  # >= 40ms vowel nucleus
                if peaks and int(np.sum(valley_mask[peaks[-1][1] : run_s])) < 2:
                    peaks[-1] = (peaks[-1][0], idx)
                else:
                    peaks.append((run_s, idx))
            run_s = None
    return len(peaks)


def _verify_omitted_word_evidence(
    src_clean: str,
    w_prev: dict[str, Any],
    w_next: dict[str, Any],
    audio_data: np.ndarray | None,
    sample_rate: int,
    whisper_model: Any | None,
    language: str | None,
    total_dur: float,
    eff_speed: float,
    slice_budget: list[int] | None,
    secondary_reasons: list[str] | None = None,
) -> tuple[str, str]:
    """Stage 2 Evidence Evaluator for a single omitted word (`tag == 'delete'`) between `w_prev` and `w_next`.
    Strictly separates three physical states:
      1. Word missing from primary ASR output (`tag == 'delete'`).
      2. Reduced / coarticulated acoustic realization in the waveform (voiced vocalic bridge + articulatory duration budget).
      3. Word genuinely not articulated in the audio (`missing` -> `MISSING_WORD` warning).
    Accounts for Whisper non-independence: a repeated secondary Whisper omission on a slice that contains
    verified unattributed speech/vocalic energy is NOT treated as 100% proof of absence.
    Returns `(decision, reason)` where `decision` is in `('pass', 'missing', 'unverified')`.
    """
    t_start_prev = float(w_prev.get("startSec", 0.0))
    t_end_prev = float(w_prev.get("endSec", 0.0))
    t_start_next = float(w_next.get("startSec", 0.0))
    t_end_next = float(w_next.get("endSec", t_start_next))
    gap = max(0.0, t_start_next - t_end_prev)
    p_prev = float(w_prev.get("probability", 1.0))
    p_next = float(w_next.get("probability", 1.0))

    if min(p_prev, p_next) < 0.50:
        return "unverified", "low_neighbor_asr_confidence"

    is_clitic_article = src_clean in WEAK_CLITIC_ARTICLES
    is_weak_fn_word = src_clean in (WEAK_CLITIC_ARTICLES | {"to", "of", "and", "can", "has", "have", "had", "in", "on", "at", "for", "đã", "sẽ"})
    has_gap_energy = False
    has_extra_syllable_nucleus = False
    has_verified_clitic_vowel = False

    if audio_data is not None and sample_rate > 0:
        w_prev_clean = clean_word(str(w_prev.get("word", "")))
        w_next_clean = clean_word(str(w_next.get("word", "")))
        exp_syl_pair = _estimate_expected_syllables(w_prev_clean) + _estimate_expected_syllables(w_next_clean)
        exp_syl_omitted = _estimate_expected_syllables(src_clean)
        span_dur = max(0.0, t_end_next - t_start_prev)
        min_req_dur = (0.145 * (exp_syl_pair + exp_syl_omitted)) / max(0.5, eff_speed)
        observed_nuclei = _count_vowel_nuclei_in_span(audio_data, sample_rate, t_start_prev, t_end_next)

        if span_dur >= min_req_dur and observed_nuclei >= (exp_syl_pair + exp_syl_omitted):
            has_extra_syllable_nucleus = True

        if gap >= 0.055:
            s1 = max(0, int(round(t_end_prev * sample_rate)))
            s2 = min(len(audio_data), int(round(t_start_next * sample_rate)))
            if s2 > s1:
                slice_gap = audio_data[s1:s2]
                gap_rms = float(np.sqrt(np.mean(slice_gap ** 2))) if slice_gap.size > 0 else 0.0
                gap_zcr = float(np.mean(np.abs(np.diff(np.signbit(slice_gap))))) if slice_gap.size > 1 else 0.0
                if gap_rms >= (0.018 if is_weak_fn_word else 0.025):
                    has_gap_energy = True
                    if is_clitic_article and gap_rms >= 0.020 and gap_zcr < 0.18 and span_dur >= min_req_dur:
                        has_verified_clitic_vowel = True

        if is_clitic_article and not has_verified_clitic_vowel and has_extra_syllable_nucleus:
            # Check whether the boundary window [t_end_prev - 0.07, t_start_next + 0.07] contains a sustained
            # low-ZCR vocalic bridge (>= 55ms) together with full 4-syllable duration budget
            jb0 = max(0, int(round(max(t_start_prev, t_end_prev - 0.07) * sample_rate)))
            jb1 = min(len(audio_data), int(round(min(t_end_next, t_start_next + 0.07) * sample_rate)))
            f_sz = max(1, int(round(0.015 * sample_rate)))
            h_sz = max(1, int(round(0.005 * sample_rate)))
            if jb1 - jb0 >= f_sz * 2 and span_dur >= (0.165 * (exp_syl_pair + exp_syl_omitted)) / max(0.5, eff_speed):
                j_seg = audio_data[jb0:jb1]
                j_frames = np.lib.stride_tricks.sliding_window_view(j_seg, f_sz)[::h_sz]
                j_rms = np.sqrt(np.mean(j_frames ** 2, axis=1))
                j_zcr = np.mean(np.abs(np.diff(np.signbit(j_frames), axis=1)), axis=1)
                voiced_bridge_sec = int(np.sum((j_rms >= 0.020) & (j_zcr < 0.18))) * h_sz / sample_rate
                if voiced_bridge_sec >= 0.055:
                    has_verified_clitic_vowel = True

    # Run targeted secondary Whisper slice verification whenever:
    # (a) there is gap energy or extra syllable nucleus, OR
    # (b) a weak function word / article was omitted in real audio and whisper_model is available to verify directly.
    needs_slice = (has_gap_energy or has_extra_syllable_nucleus or is_weak_fn_word)
    can_slice = (
        whisper_model is not None
        and audio_data is not None
        and sample_rate > 0
        and (slice_budget is None or slice_budget[0] > 0)
        and needs_slice
    )
    if can_slice:
        import tempfile
        import soundfile as sf
        if slice_budget is not None:
            slice_budget[0] -= 1
        if secondary_reasons is not None:
            secondary_reasons.append(f"omitted_word:{src_clean}")
        t_s0 = max(0.0, t_start_prev - 0.12)
        t_s1 = min(total_dur or (len(audio_data) / sample_rate), t_end_next + 0.12)
        seg_audio = audio_data[max(0, int(t_s0 * sample_rate)) : min(len(audio_data), int(t_s1 * sample_rate))]
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
                    return "pass", "verified_by_secondary_slice"
                # Whisper non-independence: if secondary Whisper repeats the omission on the same audio slice,
                # check whether acoustic-phonetic evidence proves a reduced clitic vowel or conflicts with omission!
                if is_clitic_article and has_verified_clitic_vowel:
                    return "pass", "verified_reduced_clitic_by_acoustic_phonetics"
                if has_gap_energy or has_extra_syllable_nucleus:
                    return "unverified", "secondary_asr_omission_conflicts_with_acoustic_evidence"
                return "missing", "confirmed_absent_by_asr_and_acoustics"
            except Exception:
                pass
            finally:
                try:
                    os.remove(tmp_om_name)
                except OSError:
                    pass
    elif (
        whisper_model is not None
        and slice_budget is not None
        and slice_budget[0] <= 0
        and needs_slice
    ):
        if has_gap_energy or has_extra_syllable_nucleus:
            return "unverified", "slice_budget_exhausted"

    if has_gap_energy or has_extra_syllable_nucleus:
        # Never auto-pass an omitted word without secondary ASR confirmation!
        return "unverified", "unverified_acoustic_energy_without_secondary_asr"

    return "missing", "confirmed_omission"


def _has_homorganic_stop_closure(
    audio_data: np.ndarray | None,
    sample_rate: int,
    t_start: float,
    t_end: float,
    next_start: float,
    stem_ends_in_stop: bool = False,
    next_is_alveolar_stop: bool = False,
) -> bool:
    """Verifies whether the word-final boundary `[t_end - 0.06, next_start + 0.10]` exhibits
    a genuine low-energy stop closure hold characteristic of an unreleased alveolar/dental `-d/-ed`
    before `/t, d, ð, θ/`. When the stem itself already ends in a voiceless stop (`stem_ends_in_stop=True`,
    e.g. 'walk', 'check', 'flip'), requires a sustained double-stop / geminate closure hold (`>= 72ms` before
    dental `/ð/`, or `>= 95ms` before alveolar stop `/t, d/` which already contributes its own stop closure).
    """
    if audio_data is None or sample_rate <= 0 or t_end <= t_start:
        return False
    s_stem0 = max(0, int(round(t_start * sample_rate)))
    s_stem1 = min(len(audio_data), int(round(t_end * sample_rate)))
    if s_stem1 - s_stem0 < int(0.06 * sample_rate):
        return False
    frame_sz = max(1, int(round(0.010 * sample_rate)))
    hop_sz = max(1, int(round(0.005 * sample_rate)))
    stem_seg = audio_data[s_stem0:s_stem1]
    if stem_seg.size < frame_sz * 2:
        return False
    stem_frames = np.lib.stride_tricks.sliding_window_view(stem_seg, frame_sz)[::hop_sz]
    stem_peak = float(np.percentile(np.sqrt(np.mean(stem_frames ** 2, axis=1)), 85))
    if stem_peak < 0.015:
        return False

    b0 = max(s_stem0 + frame_sz, int(round((t_end - 0.08) * sample_rate)))
    b1 = min(len(audio_data), int(round((next_start + 0.10) * sample_rate)))
    if b1 - b0 < frame_sz:
        return False
    b_seg = audio_data[b0:b1]
    if b_seg.size < frame_sz:
        return False
    b_frames = np.lib.stride_tricks.sliding_window_view(b_seg, frame_sz)[::hop_sz]
    b_rms = np.sqrt(np.mean(b_frames ** 2, axis=1))
    b_zcr = np.mean(np.abs(np.diff(np.signbit(b_frames), axis=1)), axis=1)
    if stem_ends_in_stop:
        deep_closure_sec = int(np.sum(b_rms < 0.005)) * hop_sz / sample_rate
        ultra_deep_sec = int(np.sum(b_rms <= 0.0005)) * hop_sz / sample_rate
        min_deep_req = 0.095 if next_is_alveolar_stop else 0.072
        min_ultra_req = 0.050 if next_is_alveolar_stop else 0.035
        if deep_closure_sec >= min_deep_req and ultra_deep_sec >= min_ultra_req:
            return True
        # Also allow dental-masked stop-hold signals (before 'th') or synthetic stop-hold test signals
        synth_closure_sec = int(np.sum((b_rms <= stem_peak * 0.20) & (b_zcr < 0.18))) * hop_sz / sample_rate
        return (not next_is_alveolar_stop or ultra_deep_sec == 0.0) and synth_closure_sec >= 0.020 and float(np.min(b_rms)) <= 0.003
    closure_frames = int(np.sum((b_rms <= stem_peak * 0.35) & (b_zcr < 0.24)))
    return (closure_frames * hop_sz / sample_rate) >= 0.015


def _evaluate_coarticulatory_assimilation(
    sw: str,
    aw: str,
    next_src_w: str,
    t_start: float,
    t_end: float,
    w_prob: float,
    gap_to_next_asr: float,
    gap_from_prev_asr: float,
    asr_words: list[dict[str, Any]],
    j1: int,
    audio_data: np.ndarray | None,
    sample_rate: int,
    whisper_model: Any | None,
    language: str | None,
    total_dur: float,
    eff_speed: float,
    slice_budget: list[int] | None,
    secondary_reasons: list[str] | None = None,
) -> tuple[str, str]:
    """Evaluates whether a 1-to-1 difference (`sw` vs `aw`) before `next_src_w` is genuine
    phonetic coarticulatory assimilation ('pass'), an unverified boundary ambiguity ('unverified'),
    or a pronunciation / suffix omission defect ('mismatch').
    Never assumes two words are equivalent merely because they are adjacent or have equal syllable counts.
    """
    if not next_src_w or not (-0.05 <= gap_to_next_asr <= 0.05):
        return "mismatch", "not_adjacent"

    next_start = float(asr_words[j1 + 1].get("startSec", t_end)) if (j1 + 1) < len(asr_words) else t_end
    next_end = float(asr_words[j1 + 1].get("endSec", next_start)) if (j1 + 1) < len(asr_words) else next_start

    # 1. Sibilant assimilation (-s before s/z, e.g. 'arm sideways' <-> 'arms sideways')
    if (aw == sw + "s" or sw == aw + "s") and next_src_w.startswith(("s", "z")):
        if audio_data is not None and sample_rate > 0:
            b0 = max(0, int(round((t_end - 0.06) * sample_rate)))
            b1 = min(len(audio_data), int(round((next_start + 0.08) * sample_rate)))
            frame_sz = max(1, int(round(0.015 * sample_rate)))
            hop_sz = max(1, int(round(0.005 * sample_rate)))
            if b1 - b0 >= frame_sz:
                b_slice = audio_data[b0:b1]
                zcr_b = float(np.mean(np.abs(np.diff(np.signbit(b_slice))))) if b_slice.size > 1 else 0.0
                rms_b = float(np.sqrt(np.mean(b_slice ** 2)))
                # When script requires plural/3sg '-s' ('sw.endswith("s")'), require sustained sibilant duration (>= 55ms)
                if sw.endswith("s") and not aw.endswith("s"):
                    if b_slice.size >= frame_sz * 2:
                        b_frames = np.lib.stride_tricks.sliding_window_view(b_slice, frame_sz)[::hop_sz]
                        f_rms = np.sqrt(np.mean(b_frames ** 2, axis=1))
                        f_zcr = np.mean(np.abs(np.diff(np.signbit(b_frames), axis=1)), axis=1)
                        sib_dur = int(np.sum((f_zcr >= 0.22) & (f_rms >= 0.006))) * hop_sz / sample_rate
                    else:
                        sib_dur = (b1 - b0) / sample_rate if (zcr_b >= 0.22 and rms_b >= 0.006) else 0.0
                    if sib_dur >= (0.055 / max(0.5, eff_speed)):
                        return "pass", "verified_sustained_sibilant_liaison"
                    return "mismatch", "missing_sibilant_energy"
                if zcr_b >= 0.22 and rms_b >= 0.006:
                    return "pass", "verified_sibilant_liaison"
            return "unverified", "borderline_sibilant_liaison"
        # Without waveform: if script required '-s' and ASR omitted it, do not blindly pass
        if sw.endswith("s") and not aw.endswith("s"):
            return ("mismatch", "missing_final_s") if w_prob >= 0.85 else ("unverified", "unverified_sibilant_without_audio")
        return "pass", "sibilant_overflow_from_next_word"

    # 2. Unstressed 'and' <-> 'an' before vowel-initial word
    if (
        {sw, aw} == {"and", "an"}
        and next_src_w[:1] in ("a", "e", "i", "o", "u")
        and (t_end - t_start) <= 0.24
        and gap_from_prev_asr < 0.18
    ):
        if audio_data is not None and sample_rate > 0:
            b0 = max(0, int(round((t_end - 0.03) * sample_rate)))
            b1 = min(len(audio_data), int(round((next_start + 0.03) * sample_rate)))
            if b1 > b0:
                rms_b = float(np.sqrt(np.mean(audio_data[b0:b1] ** 2)))
                if rms_b >= 0.015 and w_prob < 0.82 and _has_homorganic_stop_closure(audio_data, sample_rate, t_start, t_end, next_start):
                    return "pass", "verified_nasal_stop_vowel_liaison"
                if rms_b >= 0.015 and w_prob < 0.85:
                    return "unverified", "unverified_and_an_liaison"
            return "mismatch", "missing_d_in_and"
        return ("mismatch", "missing_d_in_and") if w_prob >= 0.83 else ("unverified", "unverified_and_an_without_audio")

    # 3. Stop/dental assimilation on -d/-ed (equal syllable count only, never 'wanted' -> 'want'):
    #    - Case 3a (ASR added -d/-ed from following stop closure, e.g. 'straighten bent' -> 'straightened bent'):
    #      Allowed before any stop/dental ('t', 'd', 'b', 'p', 'k', 'g', 'th').
    #    - Case 3b (Script has -d/-ed and ASR heard uninflected stem, e.g. 'flipped the' -> 'flip the'):
    #      Allowed ONLY before homorganic alveolar/dental ('t', 'd', 'th') when confirmed by secondary slice
    #      or verified stop-closure hold on the waveform. Never auto-passed on low w_prob alone!
    asr_added_ed = (
        _estimate_expected_syllables(sw) == _estimate_expected_syllables(aw)
        and len(sw) >= 3
        and sw[-1] not in "td"
        and aw in (sw + "d", sw + "ed", sw + sw[-1] + "ed")
    )
    if asr_added_ed and next_src_w.startswith(("t", "d", "b", "p", "k", "g", "th")):
        return "pass", "stop_closure_overflow_from_next_word"

    asr_dropped_ed = (
        _estimate_expected_syllables(sw) == _estimate_expected_syllables(aw)
        and len(aw) >= 3
        and aw[-1] not in "td"
        and sw in (aw + "d", aw + "ed", aw + aw[-1] + "ed")
    )
    if asr_dropped_ed and next_src_w.startswith(("t", "d", "th")):
        is_doubled_stop_stem = (sw == aw + aw[-1] + "ed" and aw[-1] in "pbgk")
        stem_ends_in_stop = bool(aw[-1] in "pbgk" or aw.endswith(("ck", "ch", "sh")))
        next_is_alveolar_stop = bool(next_src_w.startswith(("t", "d")) and not next_src_w.startswith("th"))
        has_closure = _has_homorganic_stop_closure(
            audio_data,
            sample_rate,
            t_start,
            t_end,
            next_start,
            stem_ends_in_stop=stem_ends_in_stop,
            next_is_alveolar_stop=next_is_alveolar_stop,
        )
        ran_slice = False
        if (
            whisper_model is not None
            and audio_data is not None
            and sample_rate > 0
            and (slice_budget is None or slice_budget[0] > 0)
        ):
            import tempfile
            import soundfile as sf
            if slice_budget is not None:
                slice_budget[0] -= 1
            if secondary_reasons is not None:
                secondary_reasons.append(f"assimilation_ed:{sw}")
            s0 = max(0.0, t_start - 0.10)
            s1 = min(total_dur or (len(audio_data) / sample_rate), next_end + 0.10)
            seg_a = audio_data[max(0, int(s0 * sample_rate)) : min(len(audio_data), int(s1 * sample_rate))]
            if seg_a.size >= int(0.15 * sample_rate):
                ran_slice = True
                tmp_ed = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
                tmp_ed_name = tmp_ed.name
                tmp_ed.close()
                try:
                    sf.write(tmp_ed_name, seg_a, sample_rate, subtype="PCM_16")
                    lang_c = None if not language or language == "auto" else language
                    segs_ed, _ = whisper_model.transcribe(
                        tmp_ed_name, language=lang_c, beam_size=5, word_timestamps=True, vad_filter=False
                    )
                    ed_words = [clean_word(w.word) for seg in segs_ed for w in (seg.words or []) if w.word]
                    if any(are_words_equivalent(sw, ew) for ew in ed_words):
                        return "pass", "verified_ed_by_secondary_slice"
                except Exception:
                    pass
                finally:
                    try:
                        os.remove(tmp_ed_name)
                    except OSError:
                        pass

        if audio_data is not None and sample_rate > 0:
            if (
                has_closure
                and (is_doubled_stop_stem or stem_ends_in_stop)
                and (t_end - t_start) >= (0.22 / max(0.5, eff_speed))
                and w_prob < 0.85
            ):
                return "pass", "verified_homorganic_stop_closure"
            if not has_closure or w_prob >= 0.85 or ran_slice:
                return "mismatch", "missing_stop_closure_or_confirmed_stem"
            return "unverified", "ambiguous_homorganic_ed_closure"

        # Synthetic metadata-only call (audio_data is None):
        if is_doubled_stop_stem and (t_end - t_start) >= (0.22 / max(0.5, eff_speed)) and w_prob < 0.82:
            return "pass", "homorganic_doubled_stop_dental_masking"
        if w_prob >= 0.85 or not is_doubled_stop_stem:
            return "mismatch", "missing_ed_suffix"
        return "unverified", "ambiguous_homorganic_ed"

    return "mismatch", "not_assimilated"


def _is_contiguous_word_sublist(sub: list[str], full: list[str]) -> bool:
    """Checks whether `sub` appears as a contiguous sub-sequence inside `full`."""
    if not sub or not full or len(sub) > len(full):
        return False
    n = len(sub)
    return any(full[k : k + n] == sub for k in range(len(full) - n + 1))


def _deduplicate_quality_issues(issues: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Stage 3 Decision Deduplicator: merges detections ONLY when they describe the exact
    same physical defect on the same target word/boundary, preserving combined `evidence`.
    Strictly preserves multiple distinct co-occurring defects in the same phrase or adjacent words.
    Priority: error > warning > unverified.
    """
    if len(issues) <= 1:
        return issues


    sev_rank = {"error": 3, "warning": 2, "unverified": 1}
    deduped: list[dict[str, Any]] = []

    for iss in issues:
        tr = iss.get("timeRange")
        t0 = float(tr[0]) if (tr and len(tr) > 0) else float(iss.get("startSec", 0.0))
        t1 = float(tr[1]) if (tr and len(tr) > 1) else float(iss.get("endSec", t0))
        code = str(iss.get("code", ""))
        sev = str(iss.get("severity", "warning"))
        words_list = [clean_word(w) for w in (iss.get("words") or []) if clean_word(w)]
        words_set = set(words_list)

        merged_existing = False
        for idx_ex, ex in enumerate(deduped):
            ex_tr = ex.get("timeRange")
            ex_t0 = float(ex_tr[0]) if (ex_tr and len(ex_tr) > 0) else float(ex.get("startSec", 0.0))
            ex_t1 = float(ex_tr[1]) if (ex_tr and len(ex_tr) > 1) else float(ex.get("endSec", ex_t0))
            ex_code = str(ex.get("code", ""))
            ex_sev = str(ex.get("severity", "warning"))
            ex_words_list = [clean_word(w) for w in (ex.get("words") or []) if clean_word(w)]
            ex_words = set(ex_words_list)

            overlap = min(t1, ex_t1) - max(t0, ex_t0)
            min_dur = max(0.02, min(max(0.02, t1 - t0), max(0.02, ex_t1 - ex_t0)))
            is_same_phenomenon = False

            # 1. Inter-word Pause family: only merge if they describe the exact same boundary pair
            #    or if one is a multi-word choppy/sandwiched cluster containing the other's boundary pair.
            if {code, ex_code} <= {"ABNORMAL_PAUSE", "UNVERIFIED_PAUSE"}:
                if words_list and ex_words_list:
                    if words_list == ex_words_list and (overlap >= -0.05 or abs(t0 - ex_t0) <= 0.12):
                        is_same_phenomenon = True
                    elif (
                        (len(words_list) >= 3 or len(ex_words_list) >= 3)
                        and overlap > 0.01
                        and (
                            _is_contiguous_word_sublist(words_list, ex_words_list)
                            or _is_contiguous_word_sublist(ex_words_list, words_list)
                        )
                    ):
                        is_same_phenomenon = True
                elif overlap >= 0.50 * min_dur:
                    is_same_phenomenon = True

            # 2. Intra-word Pause vs Pause family: only merge when the silent intervals physically overlap >= 50%
            elif {code, ex_code} <= {"ABNORMAL_PAUSE", "SUSPICIOUS_INTRA_PAUSE", "UNVERIFIED_PAUSE"}:
                if code == ex_code == "SUSPICIOUS_INTRA_PAUSE":
                    is_same_phenomenon = (words_list == ex_words_list and abs(t0 - ex_t0) <= 0.10)
                elif overlap >= 0.50 * min_dur:
                    is_same_phenomenon = True

            # 3. Omission family: must target the same omitted word at the same position
            elif {code, ex_code} <= {"MISSING_WORD", "SUSPECTED_SWALLOWED"} or (
                {code, ex_code} <= {"MISSING_WORD", "SUSPECTED_SWALLOWED", "UNVERIFIED_WORD"}
                and ("MISSING_WORD" in {code, ex_code} or "SUSPECTED_SWALLOWED" in {code, ex_code})
            ):
                same_omitted_target = bool(
                    words_list and ex_words_list and (
                        words_list[0] == ex_words_list[0]
                        or words_set <= ex_words
                        or ex_words <= words_set
                    )
                )
                if same_omitted_target and (overlap >= -0.02 or abs(t0 - ex_t0) <= 0.08):
                    is_same_phenomenon = True

            # 4. Mispronunciation / Numeric / Acronym family: must target the exact same source word at the same time
            elif {code, ex_code} <= {
                "SUSPECTED_MISPRONUNCIATION",
                "PARTIAL_PRONUNCIATION",
                "UNVERIFIED_WORD",
                "UNVERIFIED_NUMBER",
                "UNVERIFIED_ACRONYM",
            }:
                same_src_word = bool(words_list and ex_words_list and words_list[0] == ex_words_list[0])
                if same_src_word and (overlap >= -0.02 and abs(t0 - ex_t0) <= 0.10):
                    is_same_phenomenon = True

            # 5. Stutter / Repetition family: overlapping time range on the same stuttered token
            elif {code, ex_code} <= {"SUSPECTED_STUTTER", "REPEATED_WORD", "REPEATED_WORDS"}:
                shared_stutter_word = bool(not words_set or not ex_words or (words_set & ex_words))
                if shared_stutter_word and (overlap >= -0.04 or abs(t0 - ex_t0) <= 0.15):
                    is_same_phenomenon = True

            # 6. Identical code on other issue types (e.g. EXTRA_WORD): must be the exact same token at the same time
            elif code == ex_code:
                if words_list == ex_words_list and abs(t0 - ex_t0) <= 0.08:
                    is_same_phenomenon = True

            if is_same_phenomenon:
                ev_new = str(iss.get("evidence") or "").strip()
                ev_old = str(ex.get("evidence") or "").strip()
                combined_ev = ev_old
                if ev_new and ev_old and ev_new not in ev_old:
                    combined_ev = f"{ev_old} | {ev_new}" if ev_old else ev_new
                elif ev_new and not ev_old:
                    combined_ev = ev_new

                if sev_rank.get(sev, 0) > sev_rank.get(ex_sev, 0) or (
                    sev_rank.get(sev, 0) == sev_rank.get(ex_sev, 0) and (t1 - t0) > (ex_t1 - ex_t0) + 0.05
                ):
                    winner = dict(iss)
                    if ev_old and ev_new and ev_old not in ev_new:
                        winner["evidence"] = f"{ev_new} | {ev_old}"
                    elif combined_ev:
                        winner["evidence"] = combined_ev
                    deduped[idx_ex] = winner
                else:
                    if combined_ev:
                        deduped[idx_ex]["evidence"] = combined_ev
                merged_existing = True
                break

        if not merged_existing:
            deduped.append(iss)

    return deduped


# ---------------------------------------------------------------------------
# Core-defect scope (v3.5.0)
# ---------------------------------------------------------------------------
# Production QC reports only the three defect categories operators act on:
#   - SUSPECTED_STUTTER: a word is stumbled or garbled (syllable repetition, or a word so distorted that
#     Whisper hears a clearly different word with low confidence).
#   - REPEATED_WORD: a word or phrase is read twice.
#   - MISSING_WORD: a script word or phrase is not read.
# Pause/prosody, number/unit formatting, acronym spelling and minor inflection differences
# (dollar/dollars, Musk/Musk's, face/faced) are intentionally out of scope: they produced most
# false alarms and Whisper cannot judge them reliably.
CORE_DEFECT_CODES = frozenset({"SUSPECTED_STUTTER", "REPEATED_WORD", "MISSING_WORD"})
# ABNORMAL_PAUSE is also reported, but only from `detect_phrase_internal_pauses` (pauseContext 'phrase_internal').
# A substituted word is only reported as garbled when Whisper itself is unsure about what it heard.
CORE_GARBLE_MAX_ASR_PROB = 0.80


def _inflection_stems(word: str) -> set[str]:
    """Candidate stems after removing one regular English inflection (-s/-es/-ies/-ed/-d/-ing, possessive 's),
    e.g. 'faced' -> {'faced', 'face', 'fac'}, 'enemies' -> {'enemies', 'enemy', 'enemie', 'enemi'}.
    """
    w = clean_word(word)
    stems = {w}
    if len(w) > 4 and w.endswith("ies"):
        stems.add(w[:-3] + "y")
    for suffix in ("ing", "ed", "es", "s", "d"):
        if len(w) - len(suffix) >= 3 and w.endswith(suffix):
            stems.add(w[: -len(suffix)])
    return stems


def _is_minor_word_variant(src_word: str, asr_word: str) -> bool:
    """True when a script/ASR word difference is formatting or inflection noise rather than a misread:
    equivalent spellings, any number formatting (80 vs eighty), or the same stem (dollar/dollars, faced/face).
    """
    s = clean_word(src_word)
    a = clean_word(asr_word)
    if not s or not a:
        return False
    if are_words_equivalent(s, a):
        return True
    if re.search(r"\d", s) or re.search(r"\d", a):
        return True
    # Vowel-less script tokens are unit/abbreviation spellings (kg, km, kW, mph): unit wording is out of scope
    if s.isascii() and not re.search(r"[aeiouy]", s):
        return True
    # Reduced function words ('and' heard as 'an', 'to' as 'ta') are normal connected speech, not stumbles
    if len(s) <= 3 and levenshtein_dist(s, a) <= 1:
        return True
    # One-letter spelling variance on long words ('deionized' vs 'dionized') is Whisper orthography noise
    if min(len(s), len(a)) >= 6 and levenshtein_dist(s, a) <= 1:
        return True
    s_stems = _inflection_stems(s)
    a_stems = _inflection_stems(a)
    return bool(s_stems & a_stems) or any(are_words_equivalent(x, y) for x in s_stems for y in a_stems)


def _looks_like_abbreviation(raw_token: str) -> bool:
    """True for ASR tokens written as abbreviations, e.g. 'AT&T', 'mAh', 'FTC', 'kWh'."""
    tok = raw_token.strip(" .,!?;:\"'()")
    if not re.fullmatch(r"[A-Za-z]+(?:&[A-Za-z]+)*", tok):
        return False
    letters = tok.replace("&", "")
    if not (3 <= len(letters) <= 8):
        return False
    return "&" in tok or any(c.isupper() for c in tok[1:])


def _renders_as_abbreviation(src_words: list[str], abbreviation: str) -> bool:
    """True if `abbreviation` spells `src_words` in order, each word contributing its first letter plus
    optionally further letters of itself ('and' may be written '&').
    Examples: ['a', 't', 'and', 't'] -> 'AT&T', ['milliampere', 'hour'] -> 'mAh'.
    """
    letters = abbreviation.strip(" .,!?;:\"'()").lower()
    words = ["&" if w == "and" else w for w in (clean_word(x) for x in src_words) if w]
    if not letters or not words or len(words) > 8:
        return False

    def match(li: int, wi: int) -> bool:
        if wi == len(words):
            return li == len(letters)
        if li >= len(letters) or letters[li] != words[wi][0]:
            return False
        word = words[wi]
        pos, k = 1, li + 1
        if match(k, wi + 1):
            return True
        while k < len(letters):
            p = word.find(letters[k], pos)
            if p < 0:
                return False
            pos, k = p + 1, k + 1
            if match(k, wi + 1):
                return True
        return False

    return match(0, 0)


def _explains_by_abbreviation(src_slice_clean: list[str], asr_raw_tokens: list[str], language: str | None) -> bool:
    """True when a replace span differs only because Whisper wrote some script words as an abbreviation
    (e.g. script 'A T and T' vs ASR 'AT&T', script 'five thousand milliampere hour' vs ASR '5,000 mAh').
    """
    merged: list[str] = []
    for tok in asr_raw_tokens:
        t = tok.strip()
        if merged and t.startswith("&"):
            merged[-1] += t
        elif t:
            merged.append(t)
    asr_clean = [clean_word(t) for t in merged]
    for ai, raw in enumerate(merged):
        if not _looks_like_abbreviation(raw):
            continue
        for a in range(len(src_slice_clean)):
            for b in range(a + 1, min(len(src_slice_clean), a + 8) + 1):
                if not _renders_as_abbreviation(src_slice_clean[a:b], raw):
                    continue
                rest_src = [w for w in src_slice_clean[:a] + src_slice_clean[b:] if w]
                rest_asr_raw = merged[:ai] + merged[ai + 1:]
                rest_asr = [w for w in asr_clean[:ai] + asr_clean[ai + 1:] if w]
                if not rest_src and not rest_asr:
                    return True
                if len(rest_src) == len(rest_asr) and all(
                    are_words_equivalent(s, w) for s, w in zip(rest_src, rest_asr)
                ):
                    return True
                if rest_src and rest_asr_raw and are_number_expressions_equivalent(
                    " ".join(rest_src), "".join(rest_asr_raw).strip(" .,!?;:"), language
                ):
                    return True
    return False


def _asr_probability_for_issue(asr_words: list[dict[str, Any]], issue: dict[str, Any], asr_word: str) -> float | None:
    """Whisper confidence of the ASR word an issue refers to (lowest overlapping word if no exact match)."""
    tr = issue.get("timeRange") or [0.0, 0.0]
    t0 = float(tr[0]) if tr else 0.0
    t1 = float(tr[1]) if len(tr) > 1 else t0
    overlapping = [
        w for w in asr_words
        if float(w.get("endSec", 0.0)) >= t0 - 0.05 and float(w.get("startSec", 0.0)) <= t1 + 0.05
    ]
    if not overlapping:
        return None
    target = clean_word(asr_word)
    exact = [w for w in overlapping if clean_word(str(w.get("word", ""))) == target]
    pool = exact or overlapping
    return min(float(w.get("probability", 1.0)) for w in pool)


def _is_adjacent_duplicate_in_asr(asr_words: list[dict[str, Any]], issue: dict[str, Any], word: str) -> bool:
    """True if Whisper transcribed `word` twice in a row inside the issue's time range."""
    target = clean_word(word)
    if not target:
        return False
    tr = issue.get("timeRange") or [0.0, 0.0]
    t0 = float(tr[0]) if tr else 0.0
    t1 = float(tr[1]) if len(tr) > 1 else t0
    for k in range(len(asr_words) - 1):
        w1, w2 = asr_words[k], asr_words[k + 1]
        if float(w2.get("endSec", 0.0)) < t0 - 0.05 or float(w1.get("startSec", 0.0)) > t1 + 0.05:
            continue
        if clean_word(str(w1.get("word", ""))) == target == clean_word(str(w2.get("word", ""))):
            return True
    return False


def _extra_words_to_repeats(extra_issues: list[dict[str, Any]], asr_words: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keeps only inserted words that duplicate an adjacent spoken phrase (e.g. 'an iPhone 18 Pro, an iPhone 18')
    and reports them as REPEATED_WORD. Other inserted words are out of scope.
    """
    asr_clean = [clean_word(str(w.get("word", ""))) for w in asr_words]
    indices: list[int] = []
    for iss in extra_issues:
        words = iss.get("words") or []
        tr = iss.get("timeRange") or [0.0, 0.0]
        t0 = float(tr[0]) if tr else 0.0
        target = clean_word(words[0]) if words else ""
        for k, w in enumerate(asr_words):
            if asr_clean[k] == target and abs(float(w.get("startSec", 0.0)) - t0) <= 0.10:
                indices.append(k)
                break
    indices = sorted(set(indices))

    runs: list[list[int]] = []
    for k in indices:
        if runs and k == runs[-1][-1] + 1:
            runs[-1].append(k)
        else:
            runs.append([k])

    def _repeats_neighbour(sub: list[int]) -> bool:
        n = len(sub)
        tokens = [asr_clean[k] for k in sub]
        start, end = sub[0], sub[-1] + 1
        reach = 1 if n == 1 else n + 2
        before = asr_clean[max(0, start - reach) : start]
        after = asr_clean[end : end + reach]
        return any(
            window[p : p + n] == tokens
            for window in (before, after)
            for p in range(0, len(window) - n + 1)
        )

    # Split each run of inserted words into the longest sub-runs that duplicate a neighbouring phrase
    repeat_runs: list[list[int]] = []
    for run in runs:
        i = 0
        while i < len(run):
            for length in range(len(run) - i, 0, -1):
                sub = run[i : i + length]
                if _repeats_neighbour(sub):
                    repeat_runs.append(sub)
                    i += length
                    break
            else:
                i += 1

    repeats: list[dict[str, Any]] = []
    for run in repeat_runs:
        tokens = [asr_clean[k] for k in run]
        t_start = float(asr_words[run[0]].get("startSec", 0.0))
        t_end = float(asr_words[run[-1]].get("endSec", t_start))
        phrase = " ".join(str(asr_words[k].get("word", "")).strip(" ,.;:!?") for k in run)
        repeats.append({
            "severity": "warning",
            "code": "REPEATED_WORD",
            "message": f'Nghi vấn đọc lặp "{phrase}" — khoảng {format_timestamp(t_start)}. Vui lòng nghe lại.',
            "words": tokens,
            "timeRange": [round(t_start, 3), round(t_end, 3)],
        })
    return repeats


def _reduce_to_core_defects(issues: list[dict[str, Any]], asr_words: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Maps detector output onto the three core defect categories (stutter / repeat / missing word)
    and drops everything else. Technical errors (corrupt/silent audio) are always kept.
    """
    kept: list[dict[str, Any]] = []
    extra_issues: list[dict[str, Any]] = []
    for iss in issues:
        severity = iss.get("severity")
        code = str(iss.get("code", ""))
        if severity == "error":
            kept.append(iss)
            continue
        if severity != "warning":
            # Possible omissions Whisper could not confirm stay visible as 'unverified' (gray), never as warnings
            if severity == "unverified" and iss.get("omissionCandidate"):
                kept.append(iss)
            continue
        words = list(iss.get("words") or [])
        tr = iss.get("timeRange") or [0.0, 0.0]
        ts = format_timestamp(float(tr[0]) if tr else 0.0)
        if code == "ABNORMAL_PAUSE":
            if iss.get("pauseContext") in ("phrase_internal", "misplaced_pause", "skipped_comma"):
                kept.append(iss)
            continue
        # Number reading (digits, number words, currency) is outside the QC scope
        # (stutters and repetitions on a number are still reported: they are reading defects, not number checks)
        if code in ("SUSPECTED_MISPRONUNCIATION", "PARTIAL_PRONUNCIATION"):
            if words and not iss.get("verifiedCurrencyUnitOmission") and _is_numeric_scope_word(words[0]):
                continue
        elif code in ("MISSING_WORD", "SUSPECTED_SWALLOWED") and not iss.get("verifiedCurrencyUnitOmission"):
            if words:
                non_num_words = [w for w in words if not _is_numeric_scope_word(w)]
                if not non_num_words:
                    continue
                if len(non_num_words) < len(words):
                    words = non_num_words
                    phrase_clean = " ".join(words)
                    iss = {
                        **iss,
                        "words": words,
                        "message": (
                            f'Nghi vấn nuốt chữ tại từ "{words[0]}" — khoảng {ts}. Vui lòng nghe kiểm tra.'
                            if len(words) == 1 and code == "MISSING_WORD"
                            else f'Nghi vấn đọc thiếu "{phrase_clean}" — khoảng {ts}. Vui lòng nghe lại.'
                        ),
                    }
        if code == "SUSPECTED_STUTTER" and words and _is_adjacent_duplicate_in_asr(asr_words, iss, words[0]):
            # The same whole word spoken twice ('pump pump') is a repetition, not a stumble
            kept.append({
                **iss,
                "code": "REPEATED_WORD",
                "words": [words[0]],
                "message": f'Nghi vấn đọc lặp từ "{words[0]}" — khoảng {ts}. Vui lòng nghe lại.',
            })
        elif code in CORE_DEFECT_CODES:
            kept.append(iss)
        elif code == "SUSPECTED_SWALLOWED":
            phrase = " ".join(words)
            kept.append({
                **iss,
                "code": "MISSING_WORD",
                "message": f'Nghi vấn đọc thiếu "{phrase}" — khoảng {ts}. Vui lòng nghe lại.',
            })
        elif code in ("SUSPECTED_MISPRONUNCIATION", "PARTIAL_PRONUNCIATION"):
            if len(words) < 2 or _is_minor_word_variant(words[0], words[1]):
                continue
            prob = _asr_probability_for_issue(asr_words, iss, words[1])
            if prob is None or prob >= CORE_GARBLE_MAX_ASR_PROB:
                continue
            kept.append({
                **iss,
                "code": "SUSPECTED_STUTTER",
                "words": [words[0]],
                "message": (
                    f'Nghi vấn vấp / đọc không rõ từ "{words[0]}" (ASR nghe thành "{words[1]}", '
                    f"độ tin cậy {prob:.2f}) — khoảng {ts}. Vui lòng nghe lại."
                ),
                "evidence": f"asr_substitution prob={prob:.2f}",
            })
        elif code == "EXTRA_WORD":
            extra_issues.append(iss)

    kept.extend(_extra_words_to_repeats(extra_issues, asr_words))
    kept.sort(key=lambda x: float((x.get("timeRange") or [0.0])[0]))

    # Adjacent garbled words are one stumble (e.g. 'eighty dollar' heard as "DALF's $80s").
    merged: list[dict[str, Any]] = []
    for iss in kept:
        prev = merged[-1] if merged else None
        if (
            prev is not None
            and prev.get("code") == iss.get("code") == "SUSPECTED_STUTTER"
            and float(iss["timeRange"][0]) - float(prev["timeRange"][1]) <= 0.15
        ):
            prev_words = list(prev.get("words") or [])
            prev["words"] = prev_words + [w for w in (iss.get("words") or []) if w not in prev_words]
            prev["timeRange"] = [prev["timeRange"][0], max(float(prev["timeRange"][1]), float(iss["timeRange"][1]))]
            prev["message"] = (
                f'Nghi vấn vấp / đọc không rõ cụm "{" ".join(prev["words"])}" — khoảng '
                f"{format_timestamp(float(prev['timeRange'][0]))}. Vui lòng nghe lại."
            )
            continue
        merged.append(dict(iss))
    return _deduplicate_quality_issues(merged)


# ---------------------------------------------------------------------------
# Phrase-internal abnormal pause (v3.6.0)
# ---------------------------------------------------------------------------
# A pause is only abnormal when it splits a word group that must be read in one breath: a head word that
# cannot stand alone is cut off from its complement ("hôm nay tôi đi | chợ", "the | earth", "will | launch").
# Pauses between major constituents ("hôm nay | tôi đi chợ", "the motor | is", "...satellites | orbit") are
# natural phrasing and are never flagged.
EN_PHRASE_HEAD_WORDS = frozenset({
    # determiners / possessives
    "the", "a", "an", "my", "your", "our", "their", "its", "his", "every", "each", "another",
    # prepositions
    "of", "to", "for", "with", "from", "by", "into", "onto", "at", "in", "on", "about", "between", "among",
    "through", "across", "toward", "towards", "without", "within", "during", "against", "per", "via", "than",
    "below", "above", "under", "beneath", "beyond", "inside", "outside", "behind", "near",
    "after", "before", "since", "until", "over", "around", "upon", "despite", "including", "throughout",
    "amid", "amidst", "unto",
    # auxiliaries / modals / copulas
    "will", "would", "can", "could", "should", "shall", "may", "might", "must",
    "is", "are", "was", "were", "be", "been", "being", "am", "has", "have", "had", "does", "did",
    # negation and coordinators (a pause belongs before 'and', never right after it)
    "not", "and", "or",
})
_EN_NP_PP_HEAD_WORDS = frozenset({
    "the", "a", "an", "my", "your", "our", "their", "its", "his", "her", "this", "these", "those",
    "every", "each", "another",
    "of", "to", "for", "with", "from", "by", "into", "onto", "at", "in", "on", "about", "between", "among",
    "through", "across", "toward", "towards", "without", "within", "during", "against", "per", "via",
    "below", "above", "under", "beneath", "beyond", "inside", "outside", "behind", "near",
    "after", "before", "since", "until", "over", "around", "upon", "despite", "including", "throughout",
    "amid", "amidst", "unto",
})
VI_PHRASE_HEAD_WORDS = frozenset({
    # prepositions / relational words
    "của", "cho", "với", "ở", "tại", "từ", "đến", "tới", "về", "trong", "ngoài", "trên", "dưới", "bằng",
    "theo", "vào", "sau", "trước", "giữa", "qua",
    # plural markers / quantifiers / classifiers / nominalizers
    "những", "các", "mọi", "mỗi", "từng", "cái", "con", "chiếc", "cuộc", "sự", "việc",
    # tense, aspect, modality, negation, degree
    "đã", "đang", "sẽ", "vừa", "mới", "sắp", "không", "chưa", "chẳng", "đừng", "hãy", "rất",
    "được", "bị", "phải", "cần", "muốn", "định", "có",
    # copula / coordinator / complementizer (pause belongs before 'rằng', never right after it)
    "là", "và", "hoặc", "rằng",
    # motion / light verbs that take an immediate complement ("đi chợ", "ra ngoài", "làm việc")
    "đi", "ra", "lên", "xuống", "sang", "làm",
})
PHRASE_HEAD_WORDS = EN_PHRASE_HEAD_WORDS | VI_PHRASE_HEAD_WORDS
# Right-hand words that open a new clause or phrase: a pause before them is natural phrasing.
# A preposition on the right starts a new prepositional phrase ('from above | with total freedom').
_PREPOSITION_OPENERS = frozenset({
    "of", "to", "for", "with", "from", "by", "into", "onto", "at", "in", "on", "about", "between",
    "among", "through", "across", "toward", "towards", "without", "within", "during", "against",
    "per", "via", "below", "above", "under", "beneath", "beyond", "inside", "outside", "behind", "near",
    "after", "before", "since", "until", "over", "around", "upon", "despite", "including", "throughout",
    "amid", "amidst", "unto",
    "của", "cho", "với", "ở", "tại", "từ", "đến", "tới", "về", "trong", "ngoài", "trên", "dưới",
    "bằng", "theo", "vào", "sau", "trước", "giữa", "qua",
})
PHRASE_OPENER_WORDS = frozenset(PROSODIC_CONJUNCTIONS | CLAUSE_BOUNDARY_CONJUNCTIONS | _PREPOSITION_OPENERS | {
    "who", "whom", "whose", "what", "how", "why", "then", "also", "however",
})
NUMERIC_SCOPE_WORDS = frozenset(ALL_NUMBER_WORDS_SET | {
    "hundred", "hundreds", "thousand", "thousands", "million", "millions",
    "billion", "billions", "trillion", "trillions",
    "percent", "dollar", "dollars", "cent", "cents", "usd", "buck", "bucks",
    "trăm", "nghìn", "ngàn", "triệu", "tỷ", "tỉ", "phần", "đồng",
})
# Minimum contiguous silence (at speed 1.0) that counts as a break inside a word group.
PHRASE_PAUSE_MIN_SEC = 0.30


def _boundary_silence_run_sec(
    audio_data: np.ndarray,
    sample_rate: int,
    start1: float,
    end1: float,
    start2: float,
    end2: float,
) -> float:
    """Length of the longest contiguous silent run touching the boundary between two ASR words.

    Whisper often stretches a neighbouring word over a pause (e.g. 'landing' starting right where 'the' ends
    although 0.4s of silence follows) or even places the next word inside the pause, so the run is measured on
    the waveform from the first word's onset up to 0.6s past the second word. The run must start after audible
    speech of the first word and touch the word boundary. Unvoiced fricatives (high zero-crossing rate) count
    as speech, not silence.
    """
    win_start = start1
    win_end = end2 + 0.6
    if end2 <= start1:
        return 0.0
    frame = max(1, int(round(0.020 * sample_rate)))
    hop = max(1, int(round(0.010 * sample_rate)))
    s0 = max(0, int(round(win_start * sample_rate)))
    s1 = min(audio_data.size, int(round(win_end * sample_rate)))
    if s1 - s0 < frame:
        return 0.0
    frames = np.lib.stride_tricks.sliding_window_view(audio_data[s0:s1], frame)[::hop]
    rms = np.sqrt(np.mean(np.square(frames, dtype=np.float32), axis=1))
    zcr = np.mean(np.abs(np.diff(np.signbit(frames), axis=1)), axis=1)
    fricative = ((rms >= 0.0085) & (zcr >= 0.25)) | ((rms >= 0.0006) & (zcr >= 0.42))
    silent = (rms < 0.012) & ~fricative
    frame_sec = hop / sample_rate
    touch_lo = (end1 - 0.06 - win_start) / frame_sec
    touch_hi = (start2 + 0.06 - win_start) / frame_sec
    touch_hi_shifted = (start2 + 0.16 - win_start) / frame_sec
    w2_onset_frame = min(len(silent), max(0, int(round((max(end1 - 0.01, start2 - 0.01) - win_start) / frame_sec))))
    w2_end_frame = min(len(silent), max(0, int(round((end2 + 0.05 - win_start) / frame_sec))))
    voiced_before = np.cumsum(~silent)
    best = 0
    k = 0
    n = len(silent)
    while k < n:
        if not silent[k]:
            k += 1
            continue
        run_start = k
        while k < n and silent[k]:
            k += 1
        # Guard against attributing a legitimate pause AFTER a short w2 (e.g. 'about it: [0.7s] rent'
        # where w2='it' is <=60ms so start2 + 0.06 >= end2) to the boundary BEFORE w2.
        if run_start > w2_onset_frame:
            voiced_w2_before = int(
                voiced_before[run_start - 1]
                - (voiced_before[w2_onset_frame - 1] if w2_onset_frame > 0 else 0)
            )
            voiced_w2_after = (
                int(voiced_before[w2_end_frame - 1] - voiced_before[k - 1])
                if k < w2_end_frame
                else 0
            )
            if voiced_w2_before >= 2 and voiced_w2_after < 2:
                continue
        # Symmetric guard against attributing a pause BEFORE a left-shifted w1 (e.g. 'three | [sil] can jog'
        # where w1='can' was spoken entirely AFTER [run_start, k] and BEFORE w2_onset_frame) to w1 | w2.
        if k < w2_onset_frame:
            voiced_w1_after_run = int(
                voiced_before[w2_onset_frame - 1] - (voiced_before[k - 1] if k > 0 else 0)
            )
            if voiced_w1_after_run >= 6:
                continue
        spoke_first_word = run_start > 0 and voiced_before[run_start - 1] >= 4
        if spoke_first_word and k - 1 >= touch_lo:
            if run_start <= touch_hi:
                best = max(best, k - run_start)
            elif run_start <= touch_hi_shifted and k < w2_end_frame:
                voiced_after_in_w2 = int(voiced_before[w2_end_frame - 1] - voiced_before[k - 1])
                if voiced_after_in_w2 >= 5:
                    best = max(best, k - run_start)
    return round((best - 1) * hop / sample_rate + frame / sample_rate, 3) if best else 0.0


def _is_numeric_scope_word(word: str) -> bool:
    """Numbers, number words and currency/scale words: number reading is outside the QC scope."""
    w = clean_word(word)
    return bool(w) and (bool(re.search(r"\d", w)) or w in NUMERIC_SCOPE_WORDS)


_NON_HEAD_NOUN_ADVERBS_AND_PARTICLES = frozenset({
    "down", "up", "out", "off", "away", "back", "together", "apart", "alone",
    "just", "even", "only", "still", "already", "almost", "quite", "rather", "enough", "indeed",
    "ago", "aside", "ahead", "aloud", "alike", "ever", "never", "often", "always", "soon",
    "once", "twice", "too", "yet", "far",
})
_PER_UNIT_MODIFIERS = frozenset({
    "kilowatt", "megawatt", "gigawatt", "terawatt", "milliwatt",
    "square", "cubic", "metric", "nautical", "fiscal", "calendar",
    "working", "business", "single", "individual", "average", "additional", "extra",
})
_NON_PARTICIPLE_ING_WORDS = frozenset({
    "during", "including", "according", "regarding", "concerning", "following", "pending",
    "nothing", "something", "everything", "anything",
    "morning", "evening", "ceiling", "building", "wedding", "meeting", "warning", "painting",
    "clothing", "housing", "funding", "pricing", "shipping", "parking", "landing", "opening",
    "ending", "beginning", "setting", "feeling", "lightning", "engineering", "manufacturing",
    "marketing", "computing", "banking", "mining", "farming", "training", "testing",
    "cooling", "heating", "charging", "steering", "braking", "wiring", "casting", "coating",
})
_ZERO_THAT_COMPLEMENT_HEADS = frozenset({
    "show", "shows", "showed", "showing", "prove", "proves", "proved", "proving",
    "reveal", "reveals", "revealed", "revealing", "confirm", "confirms", "confirmed", "confirming",
    "indicate", "indicates", "indicated", "indicating", "demonstrate", "demonstrates", "demonstrated", "demonstrating",
    "suggest", "suggests", "suggested", "suggesting", "mean", "means", "meant", "meaning",
    "ensure", "ensures", "ensured", "ensuring", "claim", "claims", "claimed", "claiming",
    "state", "states", "stated", "stating", "say", "says", "said", "saying",
    "know", "knows", "knew", "knowing", "believe", "believes", "believed", "believing",
    "assume", "assumes", "assumed", "assuming", "find", "finds", "found", "finding",
    "see", "sees", "saw", "seeing", "hear", "hears", "heard", "hearing",
    "notice", "notices", "noticed", "noticing", "realize", "realizes", "realized", "realizing",
    "discover", "discovers", "discovered", "discovering", "estimate", "estimates", "estimated", "estimating",
    "predict", "predicts", "predicted", "predicting", "expect", "expects", "expected", "expecting",
    "think", "thinks", "thought", "thinking", "feel", "feels", "felt",
})
_PREVERBAL_ADVERBS = frozenset({
    "already", "still", "never", "always", "often", "also", "soon", "now", "just", "only", "even",
    "actually", "currently", "typically", "usually", "normally", "routinely", "quietly",
    "simply", "merely", "nearly", "almost", "barely", "hardly", "rarely",
})


def _is_focus_adjunct_opener(
    source_words: list[str],
    src_clean: list[str],
    delimiters: list[str],
    right_idx: int,
) -> bool:
    """True when a focus adverb ('just', 'even', 'only', 'simply', 'merely') introduces a post-nominal
    or post-clause participial / infinitival / prepositional adjunct (e.g. '...per mile | just owning a car').
    """
    if right_idx < 0 or right_idx + 1 >= len(src_clean):
        return False
    rw = src_clean[right_idx]
    if rw not in ("just", "even", "only", "simply", "merely"):
        return False
    if has_punctuation_boundary(delimiters[right_idx + 1], source_words[right_idx + 1]):
        return False
    nxt = src_clean[right_idx + 1]
    if not nxt:
        return False
    if nxt == "to" or nxt in PHRASE_OPENER_WORDS:
        return True
    if len(nxt) >= 5 and nxt.endswith("ing") and nxt not in _NON_PARTICIPLE_ING_WORDS:
        return True
    return False


def _is_tight_np_pp_modifier_pair(
    source_words: list[str],
    src_clean: list[str],
    delimiters: list[str],
    idx: int,
) -> bool:
    """True for tight [Det/Prep] + AttributiveModifier + HeadNoun groups (e.g. 'at industrial | scale')
    that must be read as a single breath unit, while excluding plural subjects, verbs, clauses, and openers.
    """
    if idx < 1 or idx + 1 >= len(src_clean):
        return False
    prev_w = src_clean[idx - 1]
    left = src_clean[idx]
    right = src_clean[idx + 1]
    if prev_w not in _EN_NP_PP_HEAD_WORDS:
        return False
    if has_punctuation_boundary(delimiters[idx], source_words[idx]):
        return False
    if _is_numeric_scope_word(prev_w) or _is_numeric_scope_word(left) or _is_numeric_scope_word(right):
        return False
    # After 'per', a bare unit noun ('per mile', 'per year', 'per hour') already closes the PP;
    # only multi-word unit modifiers ('per kilowatt | hour', 'per square | foot') chain into the next noun.
    if prev_w == "per" and left not in _PER_UNIT_MODIFIERS:
        return False
    raw_left = source_words[idx].strip(" ,.;:!?\"'()")
    raw_right = source_words[idx + 1].strip(" ,.;:!?\"'()")
    if (raw_left and raw_left[0].isupper()) or (raw_right and raw_right[0].isupper()):
        return False
    if left in (
        ENTITY_NON_PROPER_HEADS
        | COMMON_FINITE_VERBS_AND_AUX
        | CONSTITUENT_INITIAL_FUNCTION_WORDS
        | PHRASE_OPENER_WORDS
    ):
        return False
    if (prev_w, left) in (
        ("on", "earth"), ("on", "board"), ("on", "stage"), ("on", "foot"), ("on", "hand"), ("on", "time"),
        ("in", "fact"), ("in", "cash"), ("in", "turn"), ("in", "full"), ("in", "short"), ("in", "part"),
        ("at", "home"), ("at", "work"), ("at", "night"), ("at", "once"), ("at", "all"), ("by", "hand"),
    ):
        return False
    if (len(left) >= 5 and left.endswith("ing")) or (
        left.endswith("s") and not left.endswith(("ss", "ous", "is", "us"))
    ):
        return False
    if right in (
        ENTITY_NON_PROPER_HEADS
        | CONSTITUENT_INITIAL_FUNCTION_WORDS
        | COMMON_FINITE_VERBS_AND_AUX
        | PHRASE_OPENER_WORDS
        | _NON_HEAD_NOUN_ADVERBS_AND_PARTICLES
    ):
        return False
    if len(right) >= 5 and right.endswith(("ing", "ed", "ly")):
        return False
    return True


def _is_participle_complement_pair(
    source_words: list[str],
    src_clean: list[str],
    delimiters: list[str],
    idx: int,
) -> bool:
    """True when a verbal '-ing' participle/gerund is split from its immediate NP determiner complement
    (e.g. 'data showing | the average American', 'just owning | a personal car').
    """
    if idx < 0 or idx + 1 >= len(src_clean):
        return False
    left = src_clean[idx]
    right = src_clean[idx + 1]
    if len(left) < 5 or not left.endswith("ing") or left in _NON_PARTICIPLE_ING_WORDS:
        return False
    # Exclude nominal '-ing' preceded by a determiner/possessive (e.g. 'the showing', 'his writing')
    if idx > 0 and not has_punctuation_boundary(delimiters[idx], source_words[idx]):
        if src_clean[idx - 1] in DET_AND_POSSESSIVE_SET:
            return False
    return right in (DET_AND_POSSESSIVE_SET - {"that"})


def _is_zero_that_embedded_subject_predicate_split(
    source_words: list[str],
    src_clean: list[str],
    delimiters: list[str],
    idx: int,
) -> bool:
    """True when an unpunctuated pause cuts off a short embedded subject (1-4 words) from its predicate
    inside a zero-'that' complement clause (e.g. 'showing the average American | already spends...'),
    creating a garden-path break where the embedded subject sounds like a closed direct object.
    """
    if idx < 1 or idx + 1 >= len(src_clean):
        return False
    right = src_clean[idx + 1]

    def _looks_like_finite_verb(tok: str) -> bool:
        if not tok:
            return False
        if tok in COMMON_FINITE_VERBS_AND_AUX:
            return True
        return len(tok) >= 4 and tok.endswith("s") and not tok.endswith(("ss", "ous", "is", "us"))

    predicate_starts = _looks_like_finite_verb(right) or (
        (right in _PREVERBAL_ADVERBS or (len(right) >= 5 and right.endswith("ly")))
        and idx + 2 < len(src_clean)
        and not has_punctuation_boundary(delimiters[idx + 2], source_words[idx + 2])
        and _looks_like_finite_verb(src_clean[idx + 2])
    )
    if not predicate_starts:
        return False

    complementizers = {
        "that", "which", "who", "whom", "whose", "what", "where", "when", "whether", "if", "how", "why",
    }
    for k in range(idx, max(0, idx - 4), -1):
        if has_punctuation_boundary(delimiters[k], source_words[k]):
            return False
        tok_k = src_clean[k]
        if tok_k in complementizers or tok_k in MODAL_AND_AUX_VERBS:
            return False
        # Do not cross an earlier finite verb inside the candidate subject span
        if k < idx and tok_k in LEXICAL_FINITE_VERBS and (k == 0 or src_clean[k - 1] not in DET_AND_POSSESSIVE_SET):
            return False
        if src_clean[k - 1] in _ZERO_THAT_COMPLEMENT_HEADS:
            return True
    return False


def detect_phrase_internal_pauses(
    text: str,
    asr_words: list[dict[str, Any]],
    audio_data: np.ndarray,
    sample_rate: int,
    speed: float = 1.0,
    min_pause_sec: float = PHRASE_PAUSE_MIN_SEC,
) -> list[dict[str, Any]]:
    """Flags silences that split a word group which must be read together (head word + its complement).

    Uses canonical number and multiplied-letter span alignment ('thirty' == '30', 'Triple A' == 'AAA')
    so phrase boundaries adjacent to normalized spans remain aligned, while never flagging pauses inside
    numbers themselves. Silence is measured directly on the waveform.
    """
    if audio_data is None or sample_rate <= 0 or not text or not asr_words:
        return []
    source_words, delimiters = tokenize_text_with_delimiters(text)
    src_clean = [clean_word(w) for w in source_words]
    asr_raw = [str(w.get("word", "")) for w in asr_words]
    asr_clean = [clean_word(w) for w in asr_raw]
    eff_lang = resolve_script_language(text, None)
    src_spans = _collapse_multiplied_letter_spans(
        collapse_number_tokens(source_words, eff_lang, delimiters=delimiters),
        source_words,
        delimiters=delimiters,
        counterpart_clean=set(asr_clean),
    )
    asr_spans = _collapse_multiplied_letter_spans(
        collapse_number_tokens(asr_raw, eff_lang),
        asr_raw,
        counterpart_clean=set(src_clean),
    )
    eff_speed = max(0.5, float(speed or 1.0))
    threshold = max(0.22, min_pause_sec / eff_speed)

    issues: list[dict[str, Any]] = []
    matcher = difflib.SequenceMatcher(
        None,
        [s.canonical for s in src_spans],
        [a.canonical for a in asr_spans],
        autojunk=False,
    )
    candidate_boundaries: list[tuple[int, int, bool, bool]] = []
    for block in matcher.get_matching_blocks():
        for off in range(block.size):
            s_cur = src_spans[block.a + off]
            a_cur = asr_spans[block.b + off]
            s_len = s_cur.orig_end - s_cur.orig_start
            a_len = a_cur.orig_end - a_cur.orig_start
            if not s_cur.is_number and not a_cur.is_number and s_len >= 2 and s_len == a_len:
                for sub in range(s_len - 1):
                    candidate_boundaries.append((s_cur.orig_start + sub, a_cur.orig_start + sub, False, False))
            if off + 1 < block.size:
                s_right = src_spans[block.a + off + 1]
                a_right = asr_spans[block.b + off + 1]
                i_b = s_cur.orig_end - 1
                j_b = a_cur.orig_end - 1
                if s_right.orig_start == i_b + 1 and a_right.orig_start == j_b + 1:
                    candidate_boundaries.append((i_b, j_b, s_cur.is_number, s_right.is_number))

    for i, j, left_is_num, right_is_num in candidate_boundaries:
        left, right = src_clean[i], src_clean[i + 1]
        if not left or not right or right in PHRASE_OPENER_WORDS:
            continue
        if _is_focus_adjunct_opener(source_words, src_clean, delimiters, i + 1):
            continue
        if has_punctuation_boundary(delimiters[i + 1], source_words[i + 1]):
            continue
        if left_is_num or right_is_num or _is_numeric_scope_word(left) or _is_numeric_scope_word(right):
            continue
        is_head_pair = left in PHRASE_HEAD_WORDS
        is_mod_noun_pair = (not is_head_pair) and _is_tight_np_pp_modifier_pair(
            source_words, src_clean, delimiters, i
        )
        is_part_comp_pair = (not is_head_pair and not is_mod_noun_pair) and _is_participle_complement_pair(
            source_words, src_clean, delimiters, i
        )
        is_embedded_subj_split = (
            not is_head_pair and not is_mod_noun_pair and not is_part_comp_pair
        ) and _is_zero_that_embedded_subject_predicate_split(source_words, src_clean, delimiters, i)
        if not (is_head_pair or is_mod_noun_pair or is_part_comp_pair or is_embedded_subj_split):
            continue
        if not is_head_pair and is_prosodic_phrase_boundary(
            source_words, src_clean, i, i + 1, source_words[i], source_words[i + 1], delimiters=delimiters
        ):
            continue
        w1, w2 = asr_words[j], asr_words[j + 1]
        if min(float(w1.get("probability", 1.0)), float(w2.get("probability", 1.0))) < 0.50:
            continue
        s1, e1 = float(w1.get("startSec", 0.0)), float(w1.get("endSec", 0.0))
        s2, e2 = float(w2.get("startSec", 0.0)), float(w2.get("endSec", 0.0))
        silence = _boundary_silence_run_sec(audio_data, sample_rate, s1, e1, s2, e2)
        pair_threshold = threshold
        if (
            left in ("or", "and", "yet", "but")
            and right in ("roughly", "nearly", "approximately", "almost", "about", "around", "even", "simply", "merely", "maybe", "perhaps")
            and (has_punctuation_boundary(delimiters[i], source_words[i]) or i >= 4)
        ):
            pair_threshold = max(threshold, 0.52 / eff_speed)
        if silence < pair_threshold:
            continue
        raw_left = source_words[i].strip(" ,.;:!?\"'()")
        raw_right = source_words[i + 1].strip(" ,.;:!?\"'()")
        if is_head_pair:
            head_tag = left
        elif is_mod_noun_pair:
            head_tag = f"{src_clean[i - 1]}+{left}"
        elif is_part_comp_pair:
            head_tag = f"participle:{left}"
        else:
            head_tag = f"embedded_subj:{left}"
        issues.append({
            "severity": "warning",
            "code": "ABNORMAL_PAUSE",
            "message": (
                f'Ngắt nghỉ bất thường giữa "{raw_left} {raw_right}" ({silence:.2f}s) — cụm này cần đọc liền '
                f"— khoảng {format_timestamp(e1)}. Vui lòng nghe lại."
            ),
            "words": [left, right],
            "timeRange": [round(e1, 3), round(max(e1, s2), 3)],
            "pauseContext": "phrase_internal",
            "evidence": f"silence={silence:.3f}s threshold={threshold:.2f}s head={head_tag}",
        })
    return issues



# ---------------------------------------------------------------------------
# Misplaced pause (v3.7.0)
# ---------------------------------------------------------------------------
# TTS sometimes moves a comma pause one word too early: "Every single | month, seventy" instead of
# "Every single month, | seventy". A 50-90 ms voice cut alone is common in connected TTS speech, so it is only
# reported when the punctuation right after it is read through without any pause.
MISPLACED_PAUSE_MAX_PUNCT_SILENCE_SEC = 0.08   # the comma is effectively skipped ...
MISPLACED_PAUSE_MAX_PUNCT_CUT_SEC = 0.03       # ... with (almost) no voice cut at all
MISPLACED_PAUSE_MIN_EARLY_CUT_SEC = 0.05       # while the boundary one word earlier has a clear voice cut


def _voice_cut_sec(audio_data: np.ndarray, sample_rate: int, t0: float, t1: float, threshold: float = 0.002) -> float:
    """Longest run of near-digital silence (5 ms frames) inside [t0, t1], i.e. where voicing is fully cut."""
    hop = max(1, int(round(0.005 * sample_rate)))
    a = max(0, int(round(t0 * sample_rate)))
    b = min(audio_data.size, int(round(t1 * sample_rate)))
    if b - a < 2 * hop:
        return 0.0
    frames = np.lib.stride_tricks.sliding_window_view(audio_data[a:b], hop)[::hop]
    silent = np.sqrt(np.mean(np.square(frames, dtype=np.float32), axis=1)) < threshold
    best = cur = 0
    for is_silent in silent:
        cur = cur + 1 if is_silent else 0
        best = max(best, cur)
    return round(best * hop / sample_rate, 3)


def detect_misplaced_punctuation_pauses(
    text: str,
    asr_words: list[dict[str, Any]],
    audio_data: np.ndarray,
    sample_rate: int,
) -> list[dict[str, Any]]:
    """Flags a pause moved one word before an in-sentence comma/semicolon/colon that is itself read through.

    Requires the two script words before the punctuation to match Whisper exactly and consecutively; the word
    after the punctuation may be written differently (e.g. 'seventy' -> '$70').
    """
    if audio_data is None or sample_rate <= 0 or not text or not asr_words:
        return []
    source_words, delimiters = tokenize_text_with_delimiters(text)
    src_clean = [clean_word(w) for w in source_words]
    asr_raw = [str(w.get("word", "")) for w in asr_words]
    asr_clean = [clean_word(w) for w in asr_raw]
    eff_lang = resolve_script_language(text, None)
    src_spans = _collapse_multiplied_letter_spans(
        collapse_number_tokens(source_words, eff_lang, delimiters=delimiters),
        source_words,
        delimiters=delimiters,
        counterpart_clean=set(asr_clean),
    )
    asr_spans = _collapse_multiplied_letter_spans(
        collapse_number_tokens(asr_raw, eff_lang),
        asr_raw,
        counterpart_clean=set(src_clean),
    )
    src_to_asr: dict[int, int] = {}
    for block in difflib.SequenceMatcher(None, src_clean, asr_clean, autojunk=False).get_matching_blocks():
        for off in range(block.size):
            src_to_asr[block.a + off] = block.b + off
    for tag_m, s_i1_m, s_i2_m, a_j1_m, a_j2_m in difflib.SequenceMatcher(
        None, [s.canonical for s in src_spans], [a.canonical for a in asr_spans], autojunk=False
    ).get_opcodes():
        if tag_m == "equal":
            for off in range(s_i2_m - s_i1_m):
                s_sp = src_spans[s_i1_m + off]
                a_sp = asr_spans[a_j1_m + off]
                if not s_sp.is_number and not a_sp.is_number and (s_sp.orig_end - s_sp.orig_start) == 1 and (a_sp.orig_end - a_sp.orig_start) == 1:
                    src_to_asr.setdefault(s_sp.orig_start, a_sp.orig_start)

    issues: list[dict[str, Any]] = []
    for i in range(1, len(source_words) - 1):
        punct = delimiters[i + 1]
        if not re.search(r"[,;:]", punct) or re.search(r"[.!?]", punct):
            continue
        if has_punctuation_boundary(delimiters[i], source_words[i]):
            continue
        if _is_numeric_scope_word(src_clean[i - 1]) or _is_numeric_scope_word(src_clean[i]):
            continue
        j_prev, j_cur = src_to_asr.get(i - 1), src_to_asr.get(i)
        if j_prev is None or j_cur is None or j_cur != j_prev + 1 or j_cur + 1 >= len(asr_words):
            continue
        w_prev, w_cur, w_next = asr_words[j_prev], asr_words[j_cur], asr_words[j_cur + 1]
        if min(float(w.get("probability", 1.0)) for w in (w_prev, w_cur, w_next)) < 0.50:
            continue
        mid_prev = 0.5 * (float(w_prev.get("startSec", 0.0)) + float(w_prev.get("endSec", 0.0)))
        mid_cur = 0.5 * (float(w_cur.get("startSec", 0.0)) + float(w_cur.get("endSec", 0.0)))
        mid_next = 0.5 * (float(w_next.get("startSec", 0.0)) + float(w_next.get("endSec", 0.0)))

        punct_silence = _boundary_silence_run_sec(
            audio_data, sample_rate,
            float(w_cur.get("startSec", 0.0)), float(w_cur.get("endSec", 0.0)),
            float(w_next.get("startSec", 0.0)), float(w_next.get("endSec", 0.0)),
        )
        if punct_silence >= MISPLACED_PAUSE_MAX_PUNCT_SILENCE_SEC:
            continue
        if _voice_cut_sec(audio_data, sample_rate, mid_cur, mid_next) >= MISPLACED_PAUSE_MAX_PUNCT_CUT_SEC:
            continue
        early_cut = _voice_cut_sec(audio_data, sample_rate, mid_prev, mid_cur)
        if early_cut < MISPLACED_PAUSE_MIN_EARLY_CUT_SEC:
            continue

        raw_prev = source_words[i - 1].strip(" ,.;:!?\"'()")
        raw_cur = source_words[i].strip(" ,.;:!?\"'()")
        raw_next = source_words[i + 1].strip(" ,.;:!?\"'()")
        mark = punct.strip() or ","
        t_cut = float(w_prev.get("endSec", mid_prev))
        issues.append({
            "severity": "warning",
            "code": "ABNORMAL_PAUSE",
            "message": (
                f'Ngắt sai chỗ: nghỉ sau "{raw_prev}" nhưng đọc lướt dấu "{mark}" sau "{raw_cur}" '
                f'("{raw_prev} ‖ {raw_cur}{mark} {raw_next}") — khoảng {format_timestamp(t_cut)}. Vui lòng nghe lại.'
            ),
            "words": [clean_word(raw_prev), clean_word(raw_cur)],
            "timeRange": [round(mid_prev, 3), round(float(w_next.get("startSec", mid_next)), 3)],
            "pauseContext": "misplaced_pause",
            "evidence": (
                f"early_cut={early_cut * 1000:.0f}ms punct_silence={punct_silence * 1000:.0f}ms "
                f"punct='{mark}'"
            ),
        })
    return issues


_SENTENCE_INITIAL_COMMON_WORDS = frozenset({
    "then", "when", "while", "what", "where", "which", "this", "that", "there", "these", "those",
    "here", "after", "before", "under", "over", "into", "from", "with", "they", "their", "your",
    "just", "still", "today", "worse", "most", "many", "some", "more", "even", "only", "once",
    "think", "imagine", "moving", "pulling", "buying", "renting", "nobody", "anyone", "every",
    "across", "inside", "outside", "behind", "around", "without", "because", "although", "though",
    "however", "meanwhile", "first", "second", "third", "next", "last", "finally",
})


def extract_qc_vocabulary_hotwords(
    text: str,
    language: str | None = None,
    pronunciation_mapping: list[dict[str, Any]] | None = None,
    max_terms: int = 18,
) -> str:
    """Extracts a context-free, order-broken vocabulary hint string for Whisper ASR.

    Includes proper nouns, rare/long domain words (>= 9 chars), mixed-case brand tokens, and
    ASCII loanwords embedded in Vietnamese scripts — sorted by descending length then alphabetically
    so consecutive sentence words are never kept in sentence n-gram order (preventing Whisper from
    hallucinating omitted words or smoothing repeated words).
    """
    if not text or not text.strip():
        return ""
    eff_lang = resolve_script_language(text, language)
    words, delimiters, char_spans = tokenize_text_with_spans(text)
    if not words:
        return ""

    pm_skip_indices: set[int] = set()
    for pm in (pronunciation_mapping or []):
        if pm.get("mode") in ("letter_by_letter", "custom"):
            ms = int(pm.get("startIndex", -1))
            me = int(pm.get("endIndex", -1))
            for idx, (ws, we) in enumerate(char_spans):
                if ws < me and we > ms:
                    pm_skip_indices.add(idx)

    selected_by_lower: dict[str, str] = {}
    lower_counts: dict[str, int] = {}
    cap_counts: dict[str, int] = {}
    for w in words:
        stripped = re.sub(r"^[^\w\u00C0-\u1EF9]+|[^\w\u00C0-\u1EF9]+$", "", w)
        if stripped:
            lw = stripped.lower()
            lower_counts[lw] = lower_counts.get(lw, 0) + 1
            if stripped[0].isupper():
                cap_counts[lw] = cap_counts.get(lw, 0) + 1

    for idx, raw_w in enumerate(words):
        if idx in pm_skip_indices:
            continue
        tok = re.sub(r"^[^\w\u00C0-\u1EF9'-]+|[^\w\u00C0-\u1EF9]+$", "", raw_w)
        tok_base = re.sub(r"(?:'s|'S|’s|’S)$", "", tok)
        cln = clean_word(tok_base)
        if not cln or len(cln) < 4 or re.search(r"\d", cln):
            continue
        if (
            cln in EN_MINOR_STOPWORDS
            or cln in PHRASE_HEAD_WORDS
            or cln in PHRASE_OPENER_WORDS
            or cln in _SENTENCE_INITIAL_COMMON_WORDS
            or _is_numeric_scope_word(cln)
        ):
            continue
        is_mixed_brand = any(c.isupper() for c in tok_base[1:]) and not tok_base.isupper()
        is_mid_proper = is_likely_proper_noun(words, delimiters, idx) and not tok_base.isupper()
        is_repeated_init_proper = (
            not is_mid_proper
            and tok_base[:1].isupper()
            and not tok_base.isupper()
            and cap_counts.get(cln, 0) >= 2
        )
        is_long_domain = len(cln) >= 9
        is_vi_loanword = (eff_lang == "vi" and cln.isascii() and len(cln) >= 4)
        if is_mid_proper or is_repeated_init_proper or is_mixed_brand or is_long_domain or is_vi_loanword:
            if cln not in selected_by_lower:
                selected_by_lower[cln] = tok_base

    if not selected_by_lower:
        return ""
    # Sort longest-first then alphabetically so multi-word spans from the sentence are broken apart
    ordered = sorted(selected_by_lower.values(), key=lambda t: (-len(t.lower()), t.lower()))[:max_terms]
    return ", ".join(ordered)


def reanchor_asr_word_timestamps(
    asr_words: list[dict[str, Any]],
    audio_data: np.ndarray | None,
    sample_rate: int,
    text: str | None = None,
) -> list[dict[str, Any]]:
    """Re-anchors Whisper DTW word timestamps onto true waveform speech & silence boundaries.

    Eliminates Whisper Large V3's systematic -120ms..-350ms left-shifted word-timestamp bias (where a
    post-pause word `w[k]` starts 150-350ms before the pause and absorbs the silence island `[sil_s, sil_e]`),
    while preserving genuine illegal pauses (`months and | [SILENCE] | face` -> pause stays between `and` and `face`)
    and genuine intra-word syllable breaks (`Te - [SILENCE] - sla`).
    """
    words = [dict(w) for w in (asr_words or [])]
    n = len(words)
    if n < 2 or audio_data is None or audio_data.size == 0 or sample_rate <= 0:
        return words

    mono = np.ascontiguousarray(audio_data, dtype=np.float32)
    if mono.ndim > 1:
        mono = mono.mean(axis=1)
    hop = max(1, int(round(0.005 * sample_rate)))
    win = max(hop + 1, int(round(0.015 * sample_rate)))
    if mono.size < win * 4:
        return words

    frames = np.lib.stride_tricks.sliding_window_view(mono, win)[::hop]
    rms = np.sqrt(np.mean(np.square(frames, dtype=np.float32), axis=1))
    zcr = np.mean(np.abs(np.diff(np.signbit(frames), axis=1)), axis=1)
    peak_rms = float(np.max(rms)) if rms.size > 0 else 0.0
    if peak_rms < 0.015:
        return words

    fricative = ((rms >= 0.0080) & (zcr >= 0.24)) | ((rms >= 0.0006) & (zcr >= 0.40))
    sil_thresh = min(0.012, max(0.0035, peak_rms * 0.095))
    is_silent = (rms < sil_thresh) & (~fricative)
    voiced_idx = np.where(~is_silent)[0]
    if voiced_idx.size < 4:
        return words

    frame_sec = hop / float(sample_rate)
    win_sec = win / float(sample_rate)
    first_speech_sec = float(voiced_idx[0]) * frame_sec
    last_speech_sec = min(mono.size / float(sample_rate), float(voiced_idx[-1]) * frame_sec + win_sec)

    # Optional source punctuation alignment so punctuated boundaries are known
    punct_boundaries: set[int] = set()
    if text and text.strip():
        src_tokens, delims = tokenize_text_with_delimiters(text)
        src_clean = [clean_word(t) for t in src_tokens]
        asr_clean = [clean_word(str(w.get("word", ""))) for w in words]
        for blk in difflib.SequenceMatcher(None, src_clean, asr_clean, autojunk=False).get_matching_blocks():
            for off in range(blk.size):
                s_i = blk.a + off
                a_j = blk.b + off
                if s_i + 1 < len(delims) and re.search(r"[,;:.!?—–-]", delims[s_i + 1]):
                    punct_boundaries.add(a_j)
        try:
            src_sp = collapse_number_tokens(src_tokens, None, delimiters=delims)
            asr_sp = collapse_number_tokens([str(w.get("word", "")) for w in words], None)
            for blk in difflib.SequenceMatcher(
                None,
                [s.canonical for s in src_sp],
                [a.canonical for a in asr_sp],
                autojunk=False,
            ).get_matching_blocks():
                for off in range(blk.size):
                    s_end = src_sp[blk.a + off].orig_end - 1
                    a_end = asr_sp[blk.b + off].orig_end - 1
                    if 0 <= s_end and s_end + 1 < len(delims) and 0 <= a_end < n:
                        if re.search(r"[,;:.!?—–-]", delims[s_end + 1]):
                            punct_boundaries.add(a_end)
        except Exception:
            pass

    # Step A: Local-only utterance onset/offset anchor (never linearly stretch internal words 1..n-2,
    # because trailing vowel decay on the final word would shift mid-utterance words forward by +250..350ms).
    orig_t0 = float(words[0].get("startSec", 0.0))
    orig_t0_end = float(words[0].get("endSec", orig_t0))
    orig_tN_start = float(words[-1].get("startSec", 0.0))
    orig_tN = float(words[-1].get("endSec", orig_tN_start))
    raw_start_shift = first_speech_sec - orig_t0
    raw_end_shift = last_speech_sec - orig_tN
    if -0.04 <= raw_start_shift <= 0.25 and abs(raw_start_shift) >= 0.02 and first_speech_sec < orig_t0_end - 0.04:
        words[0]["startSec"] = round(first_speech_sec, 3)
    if (
        0.04 <= raw_end_shift <= 0.45
        and last_speech_sec > orig_tN_start + 0.04
        and _voice_cut_sec(mono, sample_rate, max(0.0, orig_tN - 0.02), last_speech_sec, threshold=sil_thresh) < 0.075
    ):
        words[-1]["endSec"] = round(last_speech_sec, 3)

    # Extract internal silence islands >= 110ms strictly inside [first_speech_sec, last_speech_sec].
    # Voiceless stop closures (/p/, /t/, /k/) inside normal speech last 45-95ms and MUST NOT snap word boundaries.
    silence_islands: list[tuple[float, float]] = []
    pos = int(voiced_idx[0]) + 1
    end_limit = int(voiced_idx[-1])
    while pos < end_limit:
        if not is_silent[pos]:
            pos += 1
            continue
        r0 = pos
        while pos < end_limit and is_silent[pos]:
            pos += 1
        sil_s = r0 * frame_sec
        sil_e = (pos - 1) * frame_sec + win_sec
        if sil_e > sil_s and (sil_e - sil_s) >= 0.11:
            silence_islands.append((sil_s, sil_e))

    def _voiced_sec_in_window(t0: float, t1: float) -> float:
        if t1 <= t0:
            return 0.0
        f0 = max(0, int(round(t0 / frame_sec)))
        f1 = min(len(is_silent), int(round(t1 / frame_sec)))
        if f1 <= f0:
            return 0.0
        return float(np.sum(~is_silent[f0:f1])) * frame_sec

    def _min_rms_around(t_center: float, half_win: float = 0.030) -> float:
        f0 = max(0, int(round((t_center - half_win) / frame_sec)))
        f1 = min(len(rms), max(f0 + 1, int(round((t_center + half_win) / frame_sec))))
        return float(np.min(rms[f0:f1])) if f1 > f0 else peak_rms

    def _snap_boundary(b_idx: int, sil_s: float, sil_e: float) -> None:
        w_left = words[b_idx]
        w_right = words[b_idx + 1]
        if sil_s < float(w_left.get("startSec", 0.0)) + 0.04:
            return
        w_left["endSec"] = round(sil_s, 3)
        w_right["startSec"] = round(sil_e, 3)
        min_right_dur = 0.08
        if float(w_right.get("endSec", sil_e)) < sil_e + min_right_dur:
            w_right["endSec"] = round(min(last_speech_sec, sil_e + min_right_dur), 3)
            # Propagate forward only if needed to preserve monotonic word intervals
            for m in range(b_idx + 2, n):
                prev_end = float(words[m - 1]["endSec"])
                if float(words[m]["startSec"]) < prev_end:
                    words[m]["startSec"] = round(prev_end, 3)
                if float(words[m]["endSec"]) < float(words[m]["startSec"]) + 0.05:
                    words[m]["endSec"] = round(min(last_speech_sec, float(words[m]["startSec"]) + 0.05), 3)

    # Step B: Snap absorbed silence islands onto exact word boundaries
    used_boundaries: set[int] = set()
    consumed_sil_indices: set[int] = set()
    for sil_idx, (sil_s, sil_e) in enumerate(silence_islands):
        if sil_idx in consumed_sil_indices:
            continue
        # 1. Check if silence already touches/bridges an existing ASR gap (b_idx, b_idx + 1)
        bridged_b = None
        for b_idx in range(n - 1):
            if b_idx in used_boundaries:
                continue
            e_l = float(words[b_idx]["endSec"])
            s_r = float(words[b_idx + 1]["startSec"])
            asr_gap = s_r - e_l
            left_tol = 0.25 if asr_gap >= 0.05 else 0.05
            right_end_pad = 0.05 if b_idx in punct_boundaries else -0.03
            if (e_l - left_tol) <= sil_s <= (s_r + 0.05) and sil_e <= float(words[b_idx + 1]["endSec"]) + right_end_pad:
                bridged_b = b_idx
                break
        if bridged_b is not None:
            # When a punctuated word ends with a brief consonant release burst (< 120ms) followed immediately
            # by the main comma pause (e.g. 'fingertips, | [0.50s] with'), merge across the release click so
            # w_right starts cleanly after the main comma pause.
            if bridged_b in punct_boundaries and sil_idx + 1 < len(silence_islands):
                nxt_s, nxt_e = silence_islands[sil_idx + 1]
                if (
                    (nxt_s - sil_e) <= 0.12
                    and (nxt_e - nxt_s) > (sil_e - sil_s)
                    and nxt_e <= float(words[bridged_b + 1]["endSec"]) + 0.05
                ):
                    sil_e = nxt_e
                    consumed_sil_indices.add(sil_idx + 1)
            _snap_boundary(bridged_b, sil_s, sil_e)
            used_boundaries.add(bridged_b)
            continue

        # 2. Otherwise find the word `k` absorbing the largest share of [sil_s, sil_e]
        best_k = None
        best_ov = 0.0
        for k in range(n):
            ws = float(words[k]["startSec"])
            we = float(words[k]["endSec"])
            ov = max(0.0, min(we, sil_e) - max(ws, sil_s))
            if ov > best_ov:
                best_ov = ov
                best_k = k
        if best_k is None or best_ov < 0.45 * (sil_e - sil_s):
            continue

        # 2.0 Straddled two-word left-shift on Whisper Large V3 (e.g. 'three | [sil] can jog' or '1X | [sil] have pitched'):
        # `[sil_s, sil_e]` straddles `words[best_k - 1].endSec == words[best_k].startSec`, where `words[best_k - 1]` is a
        # 1-syllable word shifted so far left that `[sil_s, prev_end]` is silent and both `words[best_k - 1]` and `words[best_k]`
        # are spoken continuously after `sil_e`, while `words[best_k - 2]` bled continuously up to `sil_s`.
        if best_k >= 2 and (best_k - 2) not in used_boundaries:
            prev1_s = float(words[best_k - 1]["startSec"])
            prev1_e = float(words[best_k - 1]["endSec"])
            prev2_s = float(words[best_k - 2]["startSec"])
            prev2_e = float(words[best_k - 2]["endSec"])
            tok_prev1 = clean_word(str(words[best_k - 1].get("word", "")))
            if (
                sil_s + 0.06 <= prev1_e <= sil_e - 0.06
                and abs(float(words[best_k]["startSec"]) - prev1_e) <= 0.03
                and _estimate_expected_syllables(tok_prev1) == 1
                and -0.05 <= (sil_s - prev2_e) <= (0.68 if (best_k - 2) in punct_boundaries else 0.56)
                and _voiced_sec_in_window(sil_e, float(words[best_k]["endSec"])) >= 0.16
            ):
                cut_prev2_to_sil = _voice_cut_sec(
                    mono, sample_rate, max(prev2_s + 0.03, prev2_e - 0.02), sil_s, threshold=sil_thresh
                )
                if cut_prev2_to_sil < 0.105:
                    _snap_boundary(best_k - 2, sil_s, sil_e)
                    used_boundaries.add(best_k - 2)
                    continue

        ws_k = float(words[best_k]["startSec"])
        we_k = float(words[best_k]["endSec"])
        voiced_before_k = _voiced_sec_in_window(ws_k, sil_s)
        voiced_after_k = _voiced_sec_in_window(sil_e, we_k)
        tok_k = clean_word(str(words[best_k].get("word", "")))
        exp_syl_k = _estimate_expected_syllables(tok_k)

        # Prefer 2b first when `best_k` itself carries punctuation (`best_k in punct_boundaries`) while
        # `best_k - 1` does not, and `best_k`'s trailing bbox stretched across `[sil_s, sil_e]` right up to
        # `words[best_k + 1]["startSec"]` (e.g. Turbo stretching `"it:"` or `"back,"` up to the next word).
        raw_tail_align = (
            best_k < n - 1
            and best_k not in used_boundaries
            and -0.22 <= (float(words[best_k + 1]["startSec"]) - sil_e) <= 0.16
            and voiced_after_k < 0.08
        )
        is_tail_punct_pause = (
            raw_tail_align
            and best_k in punct_boundaries
            and (best_k - 1) not in punct_boundaries
            and voiced_before_k >= 0.035
        )
        if is_tail_punct_pause:
            _snap_boundary(best_k, sil_s, sil_e)
            used_boundaries.add(best_k)
            continue

        prev_has_real_dip = (
            _min_rms_around(float(words[best_k - 1]["endSec"]), 0.030) < (0.22 * peak_rms)
            if best_k >= 1
            else True
        )
        can_snap_tail = (
            raw_tail_align
            and voiced_before_k >= max(0.055, 0.075 * min(exp_syl_k, 2))
            and (
                best_k in punct_boundaries
                or (best_k - 1) not in punct_boundaries
                or (prev_has_real_dip and voiced_before_k >= 0.11)
            )
        )

        # 2a. Left-shifted post-pause word `best_k >= 1` absorbed the pause that occurred BEFORE `best_k`
        if best_k >= 1 and (best_k - 1) not in used_boundaries:
            prev_end = float(words[best_k - 1]["endSec"])
            prev_start = float(words[best_k - 1]["startSec"])
            max_left_shift = 0.68 if (best_k - 1) in punct_boundaries else 0.56
            if -0.05 <= (sil_s - prev_end) <= max_left_shift:
                cut_between_prev_and_sil = _voice_cut_sec(
                    mono, sample_rate, max(prev_start + 0.03, prev_end - 0.02), sil_s, threshold=sil_thresh
                )
                if cut_between_prev_and_sil < 0.105:
                    is_true_mid_word_break = (
                        exp_syl_k >= 2
                        and (best_k - 1) not in punct_boundaries
                        and prev_has_real_dip
                        and voiced_before_k >= 0.14
                        and voiced_after_k >= 0.14
                    )
                    if not is_true_mid_word_break:
                        _snap_boundary(best_k - 1, sil_s, sil_e)
                        used_boundaries.add(best_k - 1)
                        continue

        # 2b. Tail-absorbed pause at end of `best_k` before `best_k + 1`
        if can_snap_tail:
            _snap_boundary(best_k, sil_s, sil_e)
            used_boundaries.add(best_k)

    return words


SKIPPED_COMMA_MIN_SILENCE_SEC = 0.045
SKIPPED_COMMA_MIN_VOICE_CUT_SEC = 0.025


def detect_skipped_clause_pauses(
    text: str,
    asr_words: list[dict[str, Any]],
    audio_data: np.ndarray | None,
    sample_rate: int,
    speed: float = 1.0,
) -> list[dict[str, Any]]:
    """Flags major clause-dividing commas/semicolons/colons (`left_len >= 4` and `right_len >= 4`)
    that TTS rushes straight through without any acoustic pause or voicing break.

    Exempts numeric commas (`10,000`), short introductory phrases (`Today,`, `Worse yet,`),
    and coordinate list / Oxford commas (`components, custom actuators, and delicate sensors`).
    """
    if audio_data is None or audio_data.size == 0 or sample_rate <= 0 or not text or not asr_words:
        return []
    source_words, delimiters = tokenize_text_with_delimiters(text)
    if len(source_words) < 8:
        return []
    src_clean = [clean_word(w) for w in source_words]
    asr_raw = [str(w.get("word", "")) for w in asr_words]
    asr_clean = [clean_word(w) for w in asr_raw]
    eff_lang = resolve_script_language(text, None)
    eff_speed = max(0.5, float(speed or 1.0))

    src_spans = _collapse_multiplied_letter_spans(
        collapse_number_tokens(source_words, eff_lang, delimiters=delimiters),
        source_words,
        delimiters=delimiters,
        counterpart_clean=set(asr_clean),
    )
    asr_spans = _collapse_multiplied_letter_spans(
        collapse_number_tokens(asr_raw, eff_lang),
        asr_raw,
        counterpart_clean=set(src_clean),
    )
    src_boundary_to_asr: dict[int, int] = {}
    matcher = difflib.SequenceMatcher(
        None, [s.canonical for s in src_spans], [a.canonical for a in asr_spans], autojunk=False
    )
    for block in matcher.get_matching_blocks():
        for off in range(block.size):
            s_cur = src_spans[block.a + off]
            a_cur = asr_spans[block.b + off]
            s_len = s_cur.orig_end - s_cur.orig_start
            a_len = a_cur.orig_end - a_cur.orig_start
            if not s_cur.is_number and not a_cur.is_number and s_len >= 2 and s_len == a_len:
                for sub in range(s_len - 1):
                    src_boundary_to_asr[s_cur.orig_start + sub] = a_cur.orig_start + sub
            if off + 1 < block.size:
                s_right = src_spans[block.a + off + 1]
                a_right = asr_spans[block.b + off + 1]
                i_b = s_cur.orig_end - 1
                j_b = a_cur.orig_end - 1
                if s_right.orig_start == i_b + 1 and a_right.orig_start == j_b + 1:
                    src_boundary_to_asr[i_b] = j_b

    min_sil = SKIPPED_COMMA_MIN_SILENCE_SEC / eff_speed
    min_cut = SKIPPED_COMMA_MIN_VOICE_CUT_SEC / eff_speed
    issues: list[dict[str, Any]] = []

    for i in range(3, len(source_words) - 4):
        punct = delimiters[i + 1]
        if not re.search(r"[,;:]", punct) or re.search(r"[.!?]", punct):
            continue
        j = src_boundary_to_asr.get(i)
        if j is None or j + 1 >= len(asr_words):
            continue
        if _is_numeric_scope_word(src_clean[i]) and _is_numeric_scope_word(src_clean[i + 1]):
            continue

        # Compute word counts of the clause on the left and the clause on the right
        left_len = 1
        for k in range(i - 1, -1, -1):
            if has_punctuation_boundary(delimiters[k + 1], source_words[k + 1]):
                break
            left_len += 1
        right_len = 1
        for k in range(i + 1, len(source_words) - 1):
            if has_punctuation_boundary(delimiters[k + 1], source_words[k + 1]):
                break
            right_len += 1
        if left_len < 4 or right_len < 4:
            continue

        # Exempt Oxford comma in a multi-item list ('A, B, and C')
        if src_clean[i + 1] in ("and", "or", "va", "và", "hoặc") and any(
            re.search(r",", delimiters[k]) for k in range(max(1, i - 3), i + 1)
        ):
            continue

        w_cur, w_next = asr_words[j], asr_words[j + 1]
        if min(float(w_cur.get("probability", 1.0)), float(w_next.get("probability", 1.0))) < 0.50:
            continue
        s1, e1 = float(w_cur.get("startSec", 0.0)), float(w_cur.get("endSec", 0.0))
        s2, e2 = float(w_next.get("startSec", 0.0)), float(w_next.get("endSec", 0.0))
        if (s2 - e1) >= (0.10 / eff_speed):
            continue
        punct_sil = _boundary_silence_run_sec(audio_data, sample_rate, s1, e1, s2, e2)
        if punct_sil >= min_sil:
            continue
        mid_cur = 0.5 * (s1 + e1)
        mid_next = 0.5 * (s2 + e2)
        if _voice_cut_sec(audio_data, sample_rate, mid_cur, mid_next) >= min_cut:
            continue
        # Relative prosodic valley check: breathy comma pauses (e.g. ~0.015 RMS room/breath tone)
        # sit slightly above absolute 0.012 RMS yet drop <22% of surrounding syllable energy.
        val_lo = max(0.0, min(mid_cur, e1 - 0.08))
        val_hi = min(len(audio_data) / float(sample_rate), max(mid_next, s2 + 0.12))
        if val_hi - val_lo >= 0.12:
            seg = audio_data[int(val_lo * sample_rate) : int(val_hi * sample_rate)]
            win_n = max(1, int(0.010 * sample_rate))
            n_frames = len(seg) // win_n
            if n_frames >= 8:
                frames = seg[: n_frames * win_n].reshape(n_frames, win_n)
                f_rms = np.sqrt(np.mean(frames * frames, axis=1) + 1e-12)
                valley_ceil = max(0.006, 0.22 * float(np.percentile(f_rms, 90)))
                best_run = 0
                cur_run = 0
                for rv in f_rms:
                    if rv < valley_ceil:
                        cur_run += 1
                        if cur_run > best_run:
                            best_run = cur_run
                    else:
                        cur_run = 0
                if best_run * 0.010 >= (0.045 / eff_speed):
                    continue
        # If pause was shifted one word early, let detect_misplaced_punctuation_pauses report it
        if j > 0:
            w_prev = asr_words[j - 1]
            mid_prev = 0.5 * (float(w_prev.get("startSec", 0.0)) + float(w_prev.get("endSec", 0.0)))
            if _voice_cut_sec(audio_data, sample_rate, mid_prev, mid_cur) >= MISPLACED_PAUSE_MIN_EARLY_CUT_SEC:
                continue

        raw_left = source_words[i].strip(" ,.;:!?\"'()")
        raw_right = source_words[i + 1].strip(" ,.;:!?\"'()")
        mark = punct.strip() or ","
        issues.append({
            "severity": "warning",
            "code": "ABNORMAL_PAUSE",
            "message": (
                f'Đọc lướt dấu "{mark}" giữa hai mệnh đề "{raw_left}{mark} {raw_right}" '
                f"— khoảng {format_timestamp(e1)}. Vui lòng nghe lại hoặc bấm Tạo lại."
            ),
            "words": [src_clean[i], src_clean[i + 1]],
            "timeRange": [round(e1, 3), round(max(e1, s2), 3)],
            "pauseContext": "skipped_comma",
            "evidence": f"punct='{mark}' silence={punct_sil * 1000:.0f}ms left_len={left_len} right_len={right_len}",
        })
    return issues


def _match_equivalent_subspans(
    src_tokens: list[str],
    asr_tokens: list[str],
) -> tuple[bool, set[int], list[tuple[int, int]]]:
    """Matches multi-token compound/loanword sub-spans (e.g. 'setup livestream' <-> 'sét ấp lai chim',
    'all right' <-> 'alright') within a `replace` opcode.

    Returns `(full_match, covered_local_src_indices, asr_to_local_src_pairs)`.
    """
    ns, na = len(src_tokens), len(asr_tokens)
    if ns == 0 or na == 0 or ns > 12 or na > 16:
        return False, set(), []

    def _sub_equiv(s_sub: list[str], a_sub: list[str]) -> bool:
        if len(s_sub) == 1 and len(a_sub) == 1 and are_words_equivalent(s_sub[0], a_sub[0]):
            return True
        if are_en_vi_loanword_spans_equivalent(s_sub, a_sub):
            return True
        sj = clean_word("".join(s_sub))
        aj = clean_word("".join(a_sub))
        if not sj or not aj:
            return False
        if sj == aj or are_words_equivalent(sj, aj):
            return True
        if min(len(sj), len(aj)) >= 6 and levenshtein_dist(sj, aj) <= 1 and phonetic_key(sj) == phonetic_key(aj):
            return True
        return False

    # Exact full-span DP
    dp: dict[tuple[int, int], list[tuple[int, int, int, int]]] = {(0, 0): []}
    for si in range(ns + 1):
        for ai in range(na + 1):
            path = dp.get((si, ai))
            if path is None:
                continue
            for ds in (1, 2):
                if si + ds > ns:
                    break
                for da in (1, 2, 3):
                    if ai + da > na or (ds == 2 and da == 3):
                        continue
                    if (si + ds, ai + da) in dp:
                        continue
                    if _sub_equiv(src_tokens[si : si + ds], asr_tokens[ai : ai + da]):
                        dp[(si + ds, ai + da)] = path + [(si, si + ds, ai, ai + da)]

    if (ns, na) in dp:
        pairs: list[tuple[int, int]] = []
        for s0, s1, a0, a1 in dp[(ns, na)]:
            for a_k in range(a0, a1):
                pairs.append((a_k, min(s0 + (a_k - a0), s1 - 1)))
        return True, set(range(ns)), pairs

    # Partial sub-span coverage for mixed spans where one loanword matched and another word did not
    covered_src: set[int] = set()
    used_asr: set[int] = set()
    for si in range(ns):
        if si in covered_src:
            continue
        for ds in (2, 1):
            if si + ds > ns:
                continue
            matched_here = False
            for ai in range(na):
                if ai in used_asr:
                    continue
                for da in (3, 2, 1):
                    if ai + da > na or any((ai + k) in used_asr for k in range(da)):
                        continue
                    if _sub_equiv(src_tokens[si : si + ds], asr_tokens[ai : ai + da]):
                        covered_src.update(range(si, si + ds))
                        used_asr.update(range(ai, ai + da))
                        matched_here = True
                        break
                if matched_here:
                    break
            if matched_here:
                break
    return False, covered_src, []


def _verify_asr_substitution_with_lexicon(
    raw_src_word: str,
    src_clean: str,
    t_start: float,
    t_end: float,
    w_prob: float,
    audio_data: np.ndarray | None,
    sample_rate: int,
    whisper_model: Any | None,
    language: str | None,
    total_dur: float,
    slice_budget: list[int] | None,
    secondary_reasons: list[str] | None,
) -> bool:
    """Layer 3 Anti-ASR-Mishearing Arbitrator:
    When primary ASR substitutes a word at moderate confidence (`0.45 <= w_prob < CORE_GARBLE_MAX_ASR_PROB`)
    despite clean unbroken waveform voicing, runs an isolated silence-padded slice with `hotwords=raw_src_word`.
    Returns True ONLY if isolated ASR confirms an equivalent word with `prob >= 0.72` and zero stutter restarts.
    """
    if (
        whisper_model is None
        or audio_data is None
        or audio_data.size == 0
        or sample_rate <= 0
        or not src_clean
        or not (0.45 <= w_prob < CORE_GARBLE_MAX_ASR_PROB)
        or slice_budget is None
        or slice_budget[0] <= 0
    ):
        return False
    if (t_end - t_start) < 0.10:
        return False

    mono = np.ascontiguousarray(audio_data, dtype=np.float32)
    if mono.ndim > 1:
        mono = mono.mean(axis=1)
    # Do not clear if the word itself has an internal glottal voice cut >= 40ms
    if (t_end - t_start) >= 0.14 and _voice_cut_sec(mono, sample_rate, t_start + 0.03, t_end - 0.03, threshold=0.003) >= 0.040:
        return False

    eff_total = total_dur if total_dur > 0 else (mono.size / float(sample_rate))
    s0 = max(0, int(round(max(0.0, t_start - 0.06) * sample_rate)))
    s1 = min(mono.size, int(round(min(eff_total, t_end + 0.08) * sample_rate)))
    if s1 - s0 < int(0.09 * sample_rate):
        return False

    pad = np.zeros(int(0.18 * sample_rate), dtype=np.float32)
    isolated_clip = np.concatenate([pad, mono[s0:s1], pad])
    slice_budget[0] -= 1
    if secondary_reasons is not None:
        secondary_reasons.append(f"lexicon_verify:{src_clean}")

    import tempfile
    import soundfile as sf

    lang_code = None if not language or language == "auto" else language
    hint = raw_src_word.strip(" ,.;:!?\"'()") or src_clean
    fd, tmp_path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    try:
        sf.write(tmp_path, isolated_clip, sample_rate, subtype="PCM_16")
        try:
            seg_iter, _ = whisper_model.transcribe(
                tmp_path,
                language=lang_code,
                beam_size=5,
                word_timestamps=True,
                vad_filter=False,
                condition_on_previous_text=False,
                hotwords=hint,
            )
        except TypeError:
            try:
                seg_iter, _ = whisper_model.transcribe(
                    tmp_path,
                    language=lang_code,
                    beam_size=5,
                    word_timestamps=True,
                    vad_filter=False,
                    hotwords=hint,
                )
            except TypeError:
                seg_iter, _ = whisper_model.transcribe(
                    tmp_path,
                    language=lang_code,
                    beam_size=5,
                    word_timestamps=True,
                    vad_filter=False,
                )
        slice_tokens = [
            (str(w.word).strip(), clean_word(str(w.word)), float(getattr(w, "probability", 0.8)))
            for seg in seg_iter
            for w in (getattr(seg, "words", None) or [])
            if getattr(w, "word", None) and clean_word(str(w.word))
        ]
    except Exception:
        return False
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass

    if not slice_tokens:
        return False
    # Reject if isolated slice shows adjacent duplicate/stutter tokens
    for k in range(len(slice_tokens) - 1):
        if slice_tokens[k][1] == slice_tokens[k + 1][1] or slice_tokens[k + 1][0].startswith("-"):
            return False
    if len(slice_tokens) == 1:
        _, cln_tok, prob_tok = slice_tokens[0]
        return prob_tok >= 0.72 and are_words_equivalent(src_clean, cln_tok)
    joined_cln = clean_word("".join(c for _, c, _ in slice_tokens))
    min_prob = min(p for _, _, p in slice_tokens)
    return min_prob >= 0.72 and bool(joined_cln) and are_words_equivalent(src_clean, joined_cln)


_CURRENCY_UNIT_WORDS = ("dollar", "dollars", "buck", "bucks")
_CURRENCY_UNIT_ACCEPT = {"dollar", "dollars", "usd", "buck", "bucks"}


def _verify_equal_currency_span(
    *,
    source_words: list[str],
    source_words_clean: list[str],
    s_span: Any,
    a_span: Any,
    asr_words: list[dict[str, Any]],
    eff_speed: float,
    audio_data: np.ndarray | None,
    sample_rate: int,
    whisper_model: Any | None,
    language: str | None,
    total_dur: float,
    slice_budget: list[int],
    secondary_reasons: list[str] | None = None,
) -> tuple[dict[str, Any] | None, set[int]]:
    """Detects swallowed currency units (e.g. 'ten dollars a day' spoken as 'tins a day')
    inside an otherwise-equal numeric span match (`s_span.canonical == a_span.canonical == '10'`).

    Handles both:
    - Large V3: Whisper hears bare `'10s'` / `'10'` with neither `$` nor `'dollars'`
    - Large V3 Turbo: Whisper's contextual LM hallucinates `'$10'` from earlier `'$299'` in the
      sentence, even though the acoustic span is far too short (`< 0.125s * exp_syl / eff_speed`)
      to contain `'ten dollars'` (3 syllables).
    """
    if (
        whisper_model is None
        or audio_data is None
        or audio_data.size == 0
        or sample_rate <= 0
        or slice_budget[0] <= 0
        or not getattr(s_span, "is_number", False)
        or not getattr(a_span, "is_number", False)
    ):
        return None, set()

    src_sub_raw = source_words[s_span.orig_start : s_span.orig_end]
    src_sub_clean = source_words_clean[s_span.orig_start : s_span.orig_end]
    unit_idx_rel = next(
        (idx for idx, cw in enumerate(src_sub_clean) if cw in _CURRENCY_UNIT_WORDS),
        None,
    )
    if unit_idx_rel is None:
        return None, set()

    unit_clean = src_sub_clean[unit_idx_rel]
    unit_display = src_sub_raw[unit_idx_rel].strip(" ,.;:!?\"'()") or unit_clean

    j1 = max(0, int(a_span.orig_start))
    j2 = min(len(asr_words), int(a_span.orig_end))
    if j2 <= j1:
        return None, set()

    # Also inspect the immediately following ASR word in case 'dollar(s)' was emitted right after the number span
    inspect_end = min(len(asr_words), j2 + 1)
    raw_asr_sub = [str(asr_words[k].get("word", "")) for k in range(j1, j2)]
    raw_asr_ext = [str(asr_words[k].get("word", "")) for k in range(j1, inspect_end)]
    has_symbol = any("$" in r for r in raw_asr_sub)
    has_unit_word = any(
        clean_word(part) in _CURRENCY_UNIT_ACCEPT
        for r in raw_asr_ext
        for part in re.split(r"[-/\s]+", r)
    )
    if has_unit_word:
        return None, set()

    span_start = float(asr_words[j1].get("startSec", 0.0))
    span_end = float(asr_words[j2 - 1].get("endSec", span_start))
    span_dur = max(0.0, span_end - span_start)
    min_prob = min((float(asr_words[k].get("probability", 1.0)) for k in range(j1, j2)), default=1.0)
    num_syl = max(
        1,
        sum(_estimate_expected_syllables(cw) for cw in src_sub_clean if cw and cw not in _CURRENCY_UNIT_WORDS),
    )
    unit_syl = max(1, _estimate_expected_syllables(unit_clean))

    # Trigger isolated context-free verification only when currency unit is completely absent in ASR
    # OR when `$` is present on an acoustically implausible short/low-confidence span (multi-word numbers
    # compress per-syllable to ~0.09s/syl, whereas the currency unit adds ~0.28s).
    suspicious_symbol_span = has_symbol and (
        span_dur < (0.090 * num_syl + 0.140 * unit_syl) / eff_speed
        or (min_prob < 0.72 and span_dur < (0.105 * num_syl + 0.160 * unit_syl) / eff_speed)
    )
    if has_symbol and not suspicious_symbol_span:
        return None, set()

    mono = np.mean(audio_data, axis=1) if audio_data.ndim > 1 else audio_data
    mono = np.asarray(mono, dtype=np.float32)
    eff_total = total_dur if total_dur > 0 else (mono.size / float(sample_rate))

    idx_prev = max(0, j1 - 1)
    idx_next = min(len(asr_words) - 1, j2 + 1)
    win_t0 = max(0.0, float(asr_words[idx_prev].get("startSec", span_start)) - 0.06)
    win_t1 = min(eff_total, float(asr_words[idx_next].get("endSec", span_end)) + 0.08)
    s0 = max(0, int(round(win_t0 * sample_rate)))
    s1 = min(mono.size, int(round(win_t1 * sample_rate)))
    if s1 - s0 < int(0.12 * sample_rate):
        return None, set()

    pad = np.zeros(int(0.18 * sample_rate), dtype=np.float32)
    isolated_clip = np.concatenate([pad, mono[s0:s1], pad])
    slice_budget[0] -= 1
    if secondary_reasons is not None:
        secondary_reasons.append(f"currency_unit_verify:{unit_clean}")

    import tempfile
    import soundfile as sf

    lang_code = None if not language or language == "auto" else language
    fd, tmp_path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    try:
        sf.write(tmp_path, isolated_clip, sample_rate, subtype="PCM_16")
        try:
            seg_iter, _ = whisper_model.transcribe(
                tmp_path,
                language=lang_code,
                beam_size=5,
                word_timestamps=True,
                vad_filter=False,
                condition_on_previous_text=False,
            )
        except TypeError:
            seg_iter, _ = whisper_model.transcribe(
                tmp_path,
                language=lang_code,
                beam_size=5,
                word_timestamps=True,
                vad_filter=False,
            )
        slice_raw_words = [
            str(w.word).strip()
            for seg in seg_iter
            for w in (getattr(seg, "words", None) or [])
            if getattr(w, "word", None) and str(w.word).strip()
        ]
    except Exception:
        return None, set()
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass

    if not slice_raw_words:
        return None, set()

    slice_has_currency = any("$" in rw for rw in slice_raw_words) or any(
        clean_word(part) in _CURRENCY_UNIT_ACCEPT
        for rw in slice_raw_words
        for part in re.split(r"[-/\s]+", rw)
    )
    if slice_has_currency:
        return None, set()

    ts = format_timestamp(span_start)
    issue = {
        "severity": "warning",
        "code": "MISSING_WORD",
        "message": f'Nghi vấn nuốt chữ tại từ "{unit_display}" — khoảng {ts}. Vui lòng nghe kiểm tra.',
        "words": [unit_clean],
        "timeRange": [round(span_start, 3), round(span_end, 3)],
        "verifiedCurrencyUnitOmission": True,
    }
    return issue, set(range(j1, j2))


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
    slice_budget: list[int] | None = None,
    secondary_reasons: list[str] | None = None,
    core_scope: bool = False,
) -> list[dict[str, Any]] | tuple[list[dict[str, Any]], dict[str, Any]]:
    """Analyzes ASR words with timestamps against source text to identify:
    1. Suspected stutter or syllable repetition (SUSPECTED_STUTTER, PARTIAL_PRONUNCIATION)
    2. Meaningful words swallowed / omitted (MISSING_WORD, SUSPECTED_SWALLOWED)
    3. Unintended word repetition (REPEATED_WORD)
    4. Extra words or letter spelling not in script (EXTRA_WORD, UNEXPECTED_LETTER_SPELLING)
    5. Abnormal pauses between unpunctuated words (ABNORMAL_PAUSE)
    Note: Rapid pace and crowded words are recorded in metrics only, without generating standalone warnings.
    When `core_scope` is True (production pipeline), secondary Whisper slices are reserved for missing-word
    and decimal-separator verification; acronym/number/inflection/low-confidence re-checks run without
    slices because their findings are outside the core defect scope (see `_reduce_to_core_defects`).
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

    if slice_budget is None:
        slice_budget = [MAX_SECONDARY_SLICE_CHECKS]
    noncore_budget = [0] if core_scope else slice_budget
    if secondary_reasons is None:
        secondary_reasons = []
    initial_slice_budget = int(slice_budget[0])

    metrics: dict[str, Any] = {
        "wpm": round(effective_wpm, 1),
        "rawWpm": round(raw_wpm, 1),
        "paceVariance": round(pace_variance, 4),
        "detectedWordsCount": len(asr_words),
        "sourceWordsCount": n_src,
        "secondaryWhisperCalls": 0,
        "secondaryWhisperReasons": secondary_reasons,
        "unverifiedReasons": [],
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

    # Normalize compound and digit number expressions + multiplied-letter expressions ('Triple A' == 'AAA')
    asr_raw_tokens = [str(w.get("word", "")) for w in asr_words]
    src_spans = collapse_number_tokens(source_words, language, delimiters=delimiters)
    src_spans = _collapse_multiplied_letter_spans(
        src_spans, source_words, delimiters=delimiters, counterpart_clean=set(asr_words_clean)
    )
    asr_spans = collapse_number_tokens(asr_raw_tokens, language)
    asr_spans = _collapse_acronym_letter_spans(asr_spans, asr_words, eff_pron_mapping)
    asr_spans = _collapse_multiplied_letter_spans(
        asr_spans, asr_raw_tokens, counterpart_clean=set(source_words_clean)
    )
    src_canonical = [s.canonical for s in src_spans]
    asr_canonical = [a.canonical for a in asr_spans]

    matcher = difflib.SequenceMatcher(None, src_canonical, asr_canonical)
    span_opcodes = matcher.get_opcodes()

    # Track ASR to source alignment for delimiter & pause checks
    asr_to_source: dict[int, int] = {}
    swallowed_currency_asr_indices: set[int] = set()
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
                        slice_budget=noncore_budget,
                    )
                    if pm_iss is not None:
                        issues.append(pm_iss)
                elif pm_eq is None and s_span.is_number and a_span.is_number:
                    curr_iss, curr_suppressed = _verify_equal_currency_span(
                        source_words=source_words,
                        source_words_clean=source_words_clean,
                        s_span=s_span,
                        a_span=a_span,
                        asr_words=asr_words,
                        eff_speed=eff_speed,
                        audio_data=audio_data,
                        sample_rate=sample_rate,
                        whisper_model=whisper_model,
                        language=language,
                        total_dur=total_dur,
                        slice_budget=slice_budget,
                        secondary_reasons=secondary_reasons,
                    )
                    if curr_iss is not None:
                        issues.append(curr_iss)
                        swallowed_currency_asr_indices.update(curr_suppressed)
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
                        slice_budget=noncore_budget,
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
                        slice_budget=noncore_budget,
                    )
                    if verdict == "PASS":
                        for j_map in range(pm_j1, pm_j2):
                            asr_to_source[j_map] = pm_i1
                    if pm_iss is not None:
                        issues.append(pm_iss)

                if handled_all_in_op and len(pms_in_op) == 1:
                    continue

        if tag == "insert":
            insert_phrase = " ".join(w for w in asr_words_clean[j1:j2] if w)
            is_boundary_insert = (i1 == 0 or i1 == len(source_words))
            if insert_phrase and (
                is_whisper_hallucination(insert_phrase)
                or (
                    is_boundary_insert
                    and insert_phrase in (
                        "thank you",
                        "thanks for watching",
                        "thank you so much",
                        "cam on",
                        "cảm ơn",
                    )
                )
            ):
                min_span_p = min(
                    (float(asr_words[k].get("probability", 1.0)) for k in range(j1, j2)),
                    default=1.0,
                )
                t_sp0 = float(asr_words[j1].get("startSec", 0.0)) if j1 < len(asr_words) else 0.0
                t_sp1 = float(asr_words[j2 - 1].get("endSec", 0.0)) if j2 > j1 else t_sp0
                n_ins_words = max(1, j2 - j1)
                if audio_data is not None and sample_rate > 0:
                    has_sustained, _, _ = _has_sustained_speech_in_span(
                        audio_data,
                        sample_rate,
                        t_sp0,
                        t_sp1,
                        min_rms=0.022,
                        min_voiced_sec=0.12 * n_ins_words,
                    )
                    if not (has_sustained and min_span_p >= 0.68):
                        continue
                else:
                    # Without waveform data, filter boundary boilerplate or low-confidence hallucinations
                    if is_boundary_insert or min_span_p < 0.75:
                        continue

            # Extra words in ASR not present in source text
            for j in range(j1, j2):
                if j in swallowed_currency_asr_indices:
                    continue
                w_obj = asr_words[j]
                w_clean = asr_words_clean[j]
                if not w_clean:
                    continue
                w_raw = w_obj.get("word", "").strip()
                w_raw = re.sub(r"^[^\w\u00C0-\u1EF9]+|[^\w\u00C0-\u1EF9]+$", "", w_raw)
                if not w_raw:
                    w_raw = w_clean

                p = float(w_obj.get("probability", 1.0))
                t_end = float(w_obj.get("endSec", 0.0))
                t_start = float(w_obj.get("startSec", 0.0))
                w_dur = t_end - t_start

                # Filter out known Whisper hallucination boilerplate only when silent/low-confidence or boundary without waveform
                if is_whisper_hallucination(w_raw) or is_whisper_hallucination(w_clean):
                    if audio_data is not None and sample_rate > 0:
                        has_sustained_w, _, _ = _has_sustained_speech_in_span(
                            audio_data, sample_rate, t_start, t_end, min_rms=0.022, min_voiced_sec=0.12
                        )
                        if not (has_sustained_w and p >= 0.68):
                            continue
                    else:
                        if is_boundary_insert or p < 0.75 or w_dur < 0.12:
                            continue

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
                    def _is_silent_phantom_tok(tok_obj: dict[str, Any]) -> bool:
                        tp = float(tok_obj.get("probability", 1.0))
                        ts0 = float(tok_obj.get("startSec", 0.0))
                        ts1 = float(tok_obj.get("endSec", 0.0))
                        if tp < 0.40 and audio_data is not None and sample_rate > 0:
                            s_d = max(0, int(round(ts0 * sample_rate)))
                            e_d = min(len(audio_data), int(round(ts1 * sample_rate)))
                            if e_d <= s_d or float(np.sqrt(np.mean(np.square(audio_data[s_d:e_d], dtype=np.float32)))) < 0.008:
                                return True
                        return tp < 0.25 and (ts1 - ts0) < 0.05

                    if _is_silent_phantom_tok(w_obj):
                        continue
                    if is_repeat and j > 0 and w_clean == prev_w and w_clean != next_w and _is_silent_phantom_tok(asr_words[j - 1]):
                        if (j - 1) in asr_to_source:
                            asr_to_source[j] = asr_to_source.pop(j - 1)
                        continue
                    if is_repeat and (j + 1) < len(asr_words) and w_clean == next_w and w_clean != prev_w and _is_silent_phantom_tok(asr_words[j + 1]):
                        continue
                    # Check whether count in ASR exceeds count in source script, or if it's a local adjacent repeat
                    # where the source script does not intentionally repeat `w_clean` back-to-back near `i1`:
                    src_count = source_words_clean.count(w_clean)
                    asr_count = asr_words_clean.count(w_clean)
                    has_local_src_repeat = any(
                        source_words_clean[k] == w_clean and source_words_clean[k + 1] == w_clean
                        for k in range(max(0, i1 - 2), min(len(source_words_clean) - 1, i1 + 2))
                    )
                    if asr_count <= src_count and (not is_repeat or has_local_src_repeat):
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
            # Evaluate all omitted words (including function words like 'can', 'and', 'đã', 'sẽ', and articles 'a', 'an', 'the').
            # Never unconditionally exempt WEAK_CLITIC_ARTICLES or large gaps!
            candidate_indices = [
                i for i in range(i1, i2)
                if source_words_clean[i]
            ]
            if not candidate_indices:
                continue

            # Check if merged with adjacent spoken words (e.g. 'a' + 'part' -> 'apart', 'ice' + 'cream' -> 'icecream', 'can' + 'not' -> 'cannot')
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

            if j1 > 0 and j1 < len(asr_words):
                w_prev = asr_words[j1 - 1]
                w_next = asr_words[j1]
                t_end_prev = float(w_prev.get("endSec", 0.0))
                t_start_next = float(w_next.get("startSec", 0.0))
                gap = max(0.0, t_start_next - t_end_prev)
                p_prev = float(w_prev.get("probability", 1.0))
                p_next = float(w_next.get("probability", 1.0))
                ts = format_timestamp(t_end_prev)

                # Single missing word bounded by spoken words: Stage 2 Evidence Evaluation
                if len(unmerged_indices) == 1 and p_prev >= 0.50 and p_next >= 0.50:
                    src_clean = source_words_clean[unmerged_indices[0]]
                    om_decision, om_reason = _verify_omitted_word_evidence(
                        src_clean=src_clean,
                        w_prev=w_prev,
                        w_next=w_next,
                        audio_data=audio_data,
                        sample_rate=sample_rate,
                        whisper_model=whisper_model,
                        language=language,
                        total_dur=total_dur,
                        eff_speed=eff_speed,
                        slice_budget=slice_budget,
                        secondary_reasons=secondary_reasons,
                    )
                    if om_decision == "pass":
                        continue
                    elif om_decision == "unverified":
                        issues.append({
                            "severity": "unverified",
                            "code": "UNVERIFIED_WORD",
                            "omissionCandidate": True,
                            "message": (
                                f'Chưa thể xác minh từ "{src_clean}" (có tín hiệu âm học trong khoảng {gap:.2f}s '
                                f"nhưng chưa có xác nhận nhận dạng độc lập) — khoảng {ts}."
                            ),
                            "words": [src_clean],
                            "timeRange": [round(t_end_prev, 3), round(t_start_next, 3)],
                            "unverifiedReason": om_reason,
                        })
                    else:
                        issues.append({
                            "severity": "warning",
                            "code": "MISSING_WORD",
                            "message": f'Nghi vấn nuốt chữ tại từ "{src_clean}" — khoảng {ts}. Vui lòng nghe kiểm tra.',
                            "words": [src_clean],
                            "timeRange": [round(t_end_prev, 3), round(t_start_next, 3)],
                        })
                elif len(unmerged_indices) == 1 and min(p_prev, p_next) < 0.50:
                    src_clean = source_words_clean[unmerged_indices[0]]
                    issues.append({
                        "severity": "unverified",
                        "code": "UNVERIFIED_WORD",
                        "omissionCandidate": True,
                        "message": (
                            f'Chưa thể xác minh từ "{src_clean}" do độ tin cậy căn chỉnh vùng lân cận thấp '
                            f"({min(p_prev, p_next):.2f}) — khoảng {ts}."
                        ),
                        "words": [src_clean],
                        "timeRange": [round(t_end_prev, 3), round(t_start_next, 3)],
                    })
                else:
                    ctx_span = extract_context_span(source_words, i1, i2)
                    issues.append({
                        "severity": "warning",
                        "code": "SUSPECTED_SWALLOWED",
                        "message": f"Vùng '{ctx_span}' có dấu hiệu phát âm thiếu hoặc không rõ — khoảng {ts}. Vui lòng nghe lại.",
                        "words": [source_words_clean[idx] for idx in unmerged_indices],
                        "timeRange": [round(t_end_prev, 3), round(t_start_next, 3)],
                    })
            elif j1 == 0 and asr_words:
                t_first = float(asr_words[0].get("startSec", 0.0))
                p_first = float(asr_words[0].get("probability", 1.0))
                src_clean = source_words_clean[unmerged_indices[0]]
                ts = format_timestamp(0.0)
                if p_first >= 0.50:
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
                else:
                    issues.append({
                        "severity": "unverified",
                        "code": "UNVERIFIED_WORD",
                        "omissionCandidate": True,
                        "message": f'Chưa thể xác minh từ đầu câu "{src_clean}" — khoảng {ts}.',
                        "words": [source_words_clean[idx] for idx in unmerged_indices],
                        "timeRange": [0.0, round(t_first, 3)],
                    })
            elif j1 == len(asr_words) and asr_words:
                if float(audio_duration_sec) <= 0.0 and audio_data is None and len(unmerged_indices) >= 6:
                    continue
                t_last = float(asr_words[-1].get("endSec", 0.0))
                p_last = float(asr_words[-1].get("probability", 1.0))
                src_clean = source_words_clean[unmerged_indices[0]]
                ts = format_timestamp(t_last)
                t_end_bound = round(max(t_last, total_dur), 3)
                if p_last >= 0.50:
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
                else:
                    issues.append({
                        "severity": "unverified",
                        "code": "UNVERIFIED_WORD",
                        "omissionCandidate": True,
                        "message": f'Chưa thể xác minh từ cuối câu "{src_clean}" — khoảng {ts}.',
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
                                slice_budget=noncore_budget,
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
                                slice_budget=noncore_budget,
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
                                slice_budget=noncore_budget,
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
                                slice_budget=noncore_budget,
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
                or are_en_vi_loanword_spans_equivalent(src_slice_clean, asr_slice_clean)
                or is_compound_proper_split
                or (src_canon_joined and src_canon_joined == asr_canon_joined)
                or are_number_expressions_equivalent(" ".join(src_slice_clean), " ".join(asr_slice_clean), language)
            ):
                for j_map in range(j1, j2):
                    asr_to_source[j_map] = min(i1 + (j_map - j1), i2 - 1)
                continue

            subspan_full_match, subspan_covered_local, subspan_pairs = _match_equivalent_subspans(
                src_slice_clean, asr_slice_clean
            )
            if subspan_full_match:
                for a_loc, s_loc in subspan_pairs:
                    asr_to_source[j1 + a_loc] = i1 + s_loc
                continue

            # Whisper wrote script words as an abbreviation (e.g. 'A T and T' -> 'AT&T', 'milliampere hour' -> 'mAh')
            if _explains_by_abbreviation(
                src_slice_clean,
                [str(asr_words[k].get("word", "")) for k in range(j1, min(j2, len(asr_words)))],
                language,
            ):
                for j_map in range(j1, j2):
                    asr_to_source[j_map] = min(i1 + (j_map - j1), i2 - 1)
                continue

            # Identify source word indices already covered by a canonical span matched in ASR
            matched_src_indices: set[int] = {i1 + loc_i for loc_i in subspan_covered_local}
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

            # In core QC scope, number value mishearings (e.g. "eight point five" -> "0.5" or ".5")
            # must never inflate raw word-count diffs (4 > 1) or contaminate adjacent words with MISSING_WORD,
            # while still checking for swallowed currency units ("dollar"/"dollars") and stutters/repeats.
            paired_src_num_indices: set[int] = set()
            paired_asr_num_indices: set[int] = set()
            mismatched_src_num_starts: set[int] = set()
            if core_scope:
                unmatched_src_nums = [
                    src_spans[k_sp]
                    for k_sp in range(s_i1, s_i2)
                    if src_spans[k_sp].is_number
                    and any(idx_c not in matched_src_indices for idx_c in range(src_spans[k_sp].orig_start, src_spans[k_sp].orig_end))
                ]
                cand_asr_nums = [asr_spans[k_a] for k_a in range(a_j1, a_j2) if asr_spans[k_a].is_number]
                if unmatched_src_nums and cand_asr_nums:
                    pair_count = min(len(unmatched_src_nums), len(cand_asr_nums))
                    for p_idx in range(pair_count):
                        s_num = unmatched_src_nums[p_idx]
                        a_num = cand_asr_nums[p_idx]
                        if slice_budget is not None:
                            curr_iss, curr_asr_set = _verify_equal_currency_span(
                                source_words=source_words,
                                source_words_clean=source_words_clean,
                                s_span=s_num,
                                a_span=a_num,
                                asr_words=asr_words,
                                eff_speed=eff_speed,
                                audio_data=audio_data,
                                sample_rate=sample_rate,
                                whisper_model=whisper_model,
                                language=language,
                                total_dur=total_dur,
                                slice_budget=slice_budget,
                                secondary_reasons=secondary_reasons,
                            )
                            if curr_iss is not None:
                                issues.append(curr_iss)
                                swallowed_currency_asr_indices.update(curr_asr_set)
                        for idx_cov in range(s_num.orig_start, s_num.orig_end):
                            matched_src_indices.add(idx_cov)
                            paired_src_num_indices.add(idx_cov)
                        for j_cov in range(a_num.orig_start, a_num.orig_end):
                            paired_asr_num_indices.add(j_cov)
                            asr_to_source[j_cov] = s_num.orig_start
                        if not are_number_expressions_equivalent(s_num.canonical, a_num.canonical, language):
                            mismatched_src_num_starts.add(s_num.orig_start)
                    if (
                        len(unmatched_src_nums) == 1
                        and len(cand_asr_nums) == 2
                        and cand_asr_nums[0].orig_end == cand_asr_nums[1].orig_start
                        and cand_asr_nums[0].canonical != cand_asr_nums[1].canonical
                    ):
                        for j_cov in range(cand_asr_nums[1].orig_start, cand_asr_nums[1].orig_end):
                            paired_asr_num_indices.add(j_cov)
                            asr_to_source[j_cov] = unmatched_src_nums[0].orig_start

            has_asr_decimal_notation = any(
                bool(re.search(r"(?:^|\d)[.,]\d", str(asr_words[k].get("word", "")).strip()))
                for k in range(j1, min(j2, len(asr_words)))
            ) or any("." in ac for ac in asr_span_canonicals)

            # Find unrepresented words in source (do not drop short/function words like 'can', 'and', 'đã', 'sẽ', or 'a', 'an', 'the')
            unrepresented_content_indices = []
            for idx in range(i1, i2):
                if idx in matched_src_indices:
                    continue
                sw = source_words_clean[idx]
                raw_sw_tok = re.sub(r"^[^\w\u00C0-\u1EF9]+|[^\w\u00C0-\u1EF9]+$", "", source_words[idx])
                if not sw:
                    continue
                if sw in WEAK_CLITIC_ARTICLES:
                    # Exempt an article inside a replacement span if it merged with an adjacent source token in ASR
                    # OR when 'a'/'an' immediately precedes a vowel-onset / ASR-misheard number token (e.g. 'an eight point five' -> '0.5')
                    prev_sc = source_words_clean[idx - 1] if idx > 0 else ""
                    next_sc = source_words_clean[idx + 1] if idx + 1 < len(source_words_clean) else ""
                    if any(
                        (prev_sc and (aw == prev_sc + sw or are_words_equivalent(prev_sc + sw, aw)))
                        or (next_sc and (aw == sw + next_sc or are_words_equivalent(sw + next_sc, aw)))
                        for aw in asr_slice_clean
                    ):
                        continue
                    if (
                        core_scope
                        and sw in ("a", "an")
                        and (idx + 1) in mismatched_src_num_starts
                        and not any(j_b < min(paired_asr_num_indices) for j_b in range(j1, j2) if j_b not in paired_asr_num_indices)
                    ):
                        continue
                if sw in ("point", "dot", "phẩy", "phay", "chấm", "cham") and has_asr_decimal_notation:
                    continue
                if any(are_words_equivalent(sw, aw) for aw in asr_slice_clean):
                    continue
                if is_likely_proper_noun(source_words, delimiters, idx) and not raw_sw_tok.isupper():
                    if any(
                        _is_valid_proper_noun_transliteration(sw, aw)
                        for aw in asr_slice_clean
                    ):
                        continue
                unrepresented_content_indices.append(idx)

            t_start = float(asr_words[j1].get("startSec", 0.0)) if j1 < len(asr_words) else 0.0
            t_end = float(asr_words[min(len(asr_words) - 1, j2 - 1)].get("endSec", 0.0)) if asr_words else 0.0
            ts = format_timestamp(t_start)

            if paired_asr_num_indices:
                rem_src_indices = [idx for idx in range(i1, i2) if idx not in paired_src_num_indices]
                rem_asr_indices = [
                    j_r for j_r in range(j1, j2)
                    if j_r not in paired_asr_num_indices and asr_words_clean[j_r]
                ]
                if len(rem_src_indices) == 1 and len(rem_asr_indices) == 1 and unrepresented_content_indices:
                    s_rem = rem_src_indices[0]
                    a_rem = rem_asr_indices[0]
                    sw_rem = source_words_clean[s_rem]
                    aw_rem = asr_words_clean[a_rem]
                    raw_sw_rem = re.sub(r"^[^\w\u00C0-\u1EF9]+|[^\w\u00C0-\u1EF9]+$", "", source_words[s_rem]) or sw_rem
                    w_rem_obj = asr_words[a_rem]
                    t_s_rem = float(w_rem_obj.get("startSec", t_start))
                    t_e_rem = float(w_rem_obj.get("endSec", t_end))
                    p_rem = float(w_rem_obj.get("probability", 1.0))
                    ts_rem = format_timestamp(t_s_rem)
                    if p_rem < 0.45:
                        issues.append({
                            "severity": "unverified",
                            "code": "UNVERIFIED_WORD",
                            "message": f"Chưa thể xác minh phát âm từ '{raw_sw_rem}' (ASR ghi nhận '{aw_rem}' với độ tin cậy thấp {p_rem:.2f}) — khoảng {ts_rem}.",
                            "words": [sw_rem, aw_rem],
                            "timeRange": [round(t_s_rem, 3), round(t_e_rem, 3)],
                        })
                    elif not _verify_asr_substitution_with_lexicon(
                        raw_src_word=raw_sw_rem,
                        src_clean=sw_rem,
                        t_start=t_s_rem,
                        t_end=t_e_rem,
                        w_prob=p_rem,
                        audio_data=audio_data,
                        sample_rate=sample_rate,
                        whisper_model=whisper_model,
                        language=language,
                        total_dur=total_dur,
                        slice_budget=slice_budget,
                        secondary_reasons=secondary_reasons,
                    ):
                        issues.append({
                            "severity": "warning",
                            "code": "SUSPECTED_MISPRONUNCIATION",
                            "message": f"Nghi vấn phát âm sai từ '{sw_rem}' (ASR ghi nhận '{aw_rem}') — khoảng {ts_rem}. Vui lòng nghe lại.",
                            "words": [sw_rem, aw_rem],
                            "timeRange": [round(t_s_rem, 3), round(t_e_rem, 3)],
                        })
                    else:
                        asr_to_source[a_rem] = s_rem
                    unrepresented_content_indices = []
                elif len(rem_asr_indices) == 0 and len(unrepresented_content_indices) == 1:
                    om_idx = unrepresented_content_indices[0]
                    om_sw = source_words_clean[om_idx]
                    num_j_first = min(paired_asr_num_indices)
                    if num_j_first > 0 and num_j_first < len(asr_words):
                        w_prev_om = asr_words[num_j_first - 1]
                        w_next_om = asr_words[num_j_first]
                        om_dec, om_rsn = _verify_omitted_word_evidence(
                            src_clean=om_sw,
                            w_prev=w_prev_om,
                            w_next=w_next_om,
                            audio_data=audio_data,
                            sample_rate=sample_rate,
                            whisper_model=whisper_model,
                            language=language,
                            total_dur=total_dur,
                            eff_speed=eff_speed,
                            slice_budget=slice_budget,
                            secondary_reasons=secondary_reasons,
                        )
                        t_om0 = float(w_prev_om.get("endSec", t_start))
                        t_om1 = float(w_next_om.get("startSec", t_om0))
                        ts_om = format_timestamp(t_om0)
                        if om_dec == "missing":
                            issues.append({
                                "severity": "warning",
                                "code": "MISSING_WORD",
                                "message": f'Nghi vấn nuốt chữ tại từ "{om_sw}" — khoảng {ts_om}. Vui lòng nghe kiểm tra.',
                                "words": [om_sw],
                                "timeRange": [round(t_om0, 3), round(max(t_om0, t_om1), 3)],
                            })
                        elif om_dec == "unverified":
                            issues.append({
                                "severity": "unverified",
                                "code": "UNVERIFIED_WORD",
                                "omissionCandidate": True,
                                "message": f'Chưa thể xác minh từ "{om_sw}" — khoảng {ts_om}.',
                                "words": [om_sw],
                                "timeRange": [round(t_om0, 3), round(max(t_om0, t_om1), 3)],
                                "unverifiedReason": om_rsn,
                            })
                        unrepresented_content_indices = []

            eff_src_len = len(range(i1, i2)) - len(paired_src_num_indices) + (1 if paired_src_num_indices else 0)
            eff_asr_len = len(range(j1, j2)) - len(paired_asr_num_indices) + (1 if paired_asr_num_indices else 0)

            # Case 1: Many-to-one / Many-to-few mismatch (e.g. "response mobile" -> "responsible")
            if eff_src_len > eff_asr_len and unrepresented_content_indices:
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

                # Proper noun transliteration tolerance (e.g. 'Nevada' -> 'Navada', 'Cerabeads' -> 'Cerabeds')
                # Requires consonant skeleton preservation so 'Tesla' -> 'Tessa' is flagged.
                if (
                    is_pn
                    and not raw_sw_tok.isupper()
                    and _is_valid_proper_noun_transliteration(sw, aw)
                ):
                    asr_to_source[j1] = i1
                    continue

                # Coarticulatory boundary assimilation:
                # 1) Sibilant assimilation when next word starts with s/z (e.g. 'arm sideways' -> 'arms sideways')
                # 2) Stop/dental assimilation on -d/-ed (including doubled final consonant like 'flipped' -> 'flip')
                #    ONLY when physically adjacent (gap <= 0.05s), equal syllable count (never 'wanted' -> 'want'),
                #    and next word starts with stop/dental ('t', 'd', 'b', 'p', 'k', 'g', 'th')
                # 3) Unstressed 'and' <-> 'an' before a vowel-initial word ONLY when physically adjacent (gap <= 0.05s)
                #    and spoken rapidly (<= 0.30s)
                next_src_w = source_words_clean[i2] if i2 < len(source_words_clean) else ""
                gap_to_next_asr = (
                    float(asr_words[j1 + 1].get("startSec", t_end)) - t_end
                    if (j1 + 1) < len(asr_words)
                    else 99.0
                )
                gap_from_prev_asr = (
                    t_start - float(asr_words[j1 - 1].get("endSec", t_start))
                    if j1 > 0
                    else 0.0
                )
                assim_decision, assim_reason = _evaluate_coarticulatory_assimilation(
                    sw=sw,
                    aw=aw,
                    next_src_w=next_src_w,
                    t_start=t_start,
                    t_end=t_end,
                    w_prob=w_prob,
                    gap_to_next_asr=gap_to_next_asr,
                    gap_from_prev_asr=gap_from_prev_asr,
                    asr_words=asr_words,
                    j1=j1,
                    audio_data=audio_data,
                    sample_rate=sample_rate,
                    whisper_model=whisper_model,
                    language=language,
                    total_dur=total_dur,
                    eff_speed=eff_speed,
                    slice_budget=noncore_budget,
                    secondary_reasons=secondary_reasons,
                )
                if assim_decision == "pass":
                    asr_to_source[j1] = i1
                    continue
                elif assim_decision == "unverified":
                    issues.append({
                        "severity": "unverified",
                        "code": "UNVERIFIED_WORD",
                        "message": f"Chưa thể xác minh nối âm cuối tại từ '{raw_sw_tok}' (ASR ghi nhận '{aw}' trước '{next_src_w}') — khoảng {ts}.",
                        "words": [sw, aw],
                        "timeRange": [round(t_start, 3), round(t_end, 3)],
                        "unverifiedReason": assim_reason,
                    })
                    continue

                is_same_syllable_inflection = bool(
                    re.fullmatch(re.escape(aw) + r"(?:[bcdgfklmnprstvz]?ed|d|s)", sw)
                    and _estimate_expected_syllables(sw) == _estimate_expected_syllables(aw)
                )
                if (
                    len(sw) >= 4
                    and len(aw) >= 2
                    and len(sw) >= len(aw) + 2
                    and not is_same_syllable_inflection
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
                elif _verify_asr_substitution_with_lexicon(
                    raw_src_word=raw_sw_tok,
                    src_clean=sw,
                    t_start=t_start,
                    t_end=t_end,
                    w_prob=w_prob,
                    audio_data=audio_data,
                    sample_rate=sample_rate,
                    whisper_model=whisper_model,
                    language=language,
                    total_dur=total_dur,
                    slice_budget=slice_budget,
                    secondary_reasons=secondary_reasons,
                ):
                    asr_to_source[j1] = i1
                    continue
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
            if not paired_asr_num_indices and (i2 - i1) == (j2 - j1) and (i2 - i1) >= 2:
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
                        and _is_valid_proper_noun_transliteration(sw_k, aw_k)
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
                    elif _verify_asr_substitution_with_lexicon(
                        raw_src_word=raw_sw_k,
                        src_clean=sw_k,
                        t_start=t_s_k,
                        t_end=t_e_k,
                        w_prob=p_k,
                        audio_data=audio_data,
                        sample_rate=sample_rate,
                        whisper_model=whisper_model,
                        language=language,
                        total_dur=total_dur,
                        slice_budget=slice_budget,
                        secondary_reasons=secondary_reasons,
                    ):
                        asr_to_source[a_idx_k] = s_idx_k
                        continue
                    else:
                        issues.append({
                            "severity": "warning",
                            "code": "SUSPECTED_MISPRONUNCIATION",
                            "message": f"Nghi vấn phát âm sai từ '{sw_k}' (ASR ghi nhận '{aw_k}') — khoảng {ts_k}. Vui lòng nghe lại.",
                            "words": [sw_k, aw_k],
                            "timeRange": [round(t_s_k, 3), round(t_e_k, 3)],
                        })
                continue

            # Case 3: Any unrepresented source words in multi-token replacement (including single omitted/replaced words in 1-to-2 or 2-to-3 spans)
            if len(unrepresented_content_indices) >= 1:
                max_prob = max((float(asr_words[k].get("probability", 0.0)) for k in range(j1, min(j2, len(asr_words)))), default=1.0)
                ctx_span = extract_context_span(source_words, i1, i2)
                asr_slice_str = " ".join(asr_slice_clean)
                unrep_words = [source_words_clean[idx] for idx in unrepresented_content_indices]
                if max_prob >= 0.50:
                    issues.append({
                        "severity": "warning",
                        "code": "SUSPECTED_SWALLOWED" if len(unrep_words) >= 2 else "SUSPECTED_MISPRONUNCIATION",
                        "message": f"Vùng '{ctx_span}' có dấu hiệu phát âm sai hoặc thiếu từ (ASR ghi nhận '{asr_slice_str}') — khoảng {ts}. Vui lòng nghe lại.",
                        "words": unrep_words,
                        "timeRange": [round(t_start, 3), round(t_end, 3)],
                    })
                else:
                    issues.append({
                        "severity": "unverified",
                        "code": "UNVERIFIED_WORD",
                        "message": f"Chưa thể xác minh vùng '{ctx_span}' (ASR ghi nhận '{asr_slice_str}' với độ tin cậy thấp {max_prob:.2f}) — khoảng {ts}.",
                        "words": unrep_words,
                        "timeRange": [round(t_start, 3), round(t_end, 3)],
                        "unverifiedReason": "low_asr_confidence_in_replace",
                    })

            # Case 4: More words in ASR than in source (e.g. repetition or extra words inside replacement span)
            has_local_asr_repeat = any(
                asr_words_clean[j_chk]
                and (
                    (j_chk > 0 and asr_words_clean[j_chk] == asr_words_clean[j_chk - 1])
                    or (j_chk + 1 < len(asr_words_clean) and asr_words_clean[j_chk] == asr_words_clean[j_chk + 1])
                )
                for j_chk in range(j1, j2)
            )
            if eff_asr_len > eff_src_len or (paired_asr_num_indices and has_local_asr_repeat):
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
                        if p < 0.40 and audio_data is not None and sample_rate > 0:
                            s_dup = max(0, int(round(t_start_w * sample_rate)))
                            e_dup = min(len(audio_data), int(round(t_end_w * sample_rate)))
                            if e_dup <= s_dup or float(np.sqrt(np.mean(np.square(audio_data[s_dup:e_dup], dtype=np.float32)))) < 0.008:
                                continue
                        elif p < 0.25 and (t_end_w - t_start_w) < 0.05:
                            continue
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
                        j not in paired_asr_num_indices
                        and source_words_clean.count(w_clean) == 0
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
        elif src_idx1 is not None and src_idx2 is None and (src_idx1 + 1) < len(delimiters):
            combined_delimiter = delimiters[src_idx1 + 1]
            if any(c in PUNCTUATION_CHARS for c in combined_delimiter):
                has_source_punct = True
        elif src_idx1 is None and src_idx2 is not None and 0 < src_idx2 < len(delimiters):
            combined_delimiter = delimiters[src_idx2]
            if any(c in PUNCTUATION_CHARS for c in combined_delimiter):
                has_source_punct = True

        # IMPORTANT: Never use Whisper's own generated punctuation (raw_w1 / raw_w2)
        # to exempt a pause. Only verified source text punctuation is trusted.
        is_natural_pause = has_source_punct
        prev_has_punct = (i == 0 or (i > 0 and boundary_records[i - 1]["has_source_punct"]))

        syn_eval = evaluate_syntactic_boundary(
            source_words=source_words,
            source_words_clean=source_words_clean,
            delimiters=delimiters,
            src_idx1=src_idx1 if not has_source_punct else None,
            src_idx2=src_idx2 if not has_source_punct else None,
            w1_raw=w1.get("word", ""),
            w2_raw=w2.get("word", ""),
            eff_speed=eff_speed,
            default_min_pause=min_abnormal_pause_sec,
            prev_has_punct=prev_has_punct,
        )
        boundary_class = syn_eval["classification"]
        boundary_rule_score = float(syn_eval["rule_score"])
        is_protected = bool(syn_eval["is_protected"])
        entity_kind = str(syn_eval["entity_kind"])
        is_tight_cohesion = bool(syn_eval["is_tight_cohesion"])
        cohesion_kind = str(syn_eval["cohesion_kind"])
        is_prosodic_boundary = bool(syn_eval["is_prosodic_boundary"])
        pair_min_pause = float(syn_eval["threshold_sec"])

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
            "boundary_class": boundary_class,
            "boundary_rule_score": boundary_rule_score,
            "is_protected": is_protected,
            "entity_kind": entity_kind,
            "is_tight_cohesion": is_tight_cohesion,
            "cohesion_kind": cohesion_kind,
            "is_prosodic_boundary": is_prosodic_boundary,
            "pair_min_pause": pair_min_pause,
            "min_prob": min(w1_prob, w2_prob),
        }
        boundary_records.append(rec)

        if not w1_text or not w2_text:
            continue

        min_pair_prob = min(w1_prob, w2_prob)
        if min_pair_prob < 0.40:
            if eff_pause_sec >= pair_min_pause and not is_natural_pause:
                ts = format_timestamp(gap_start_sec)
                pair_pause_issues[i] = {
                    "severity": "unverified",
                    "code": "UNVERIFIED_PAUSE",
                    "message": (
                        f'Chưa thể xác minh khoảng ngắt giữa "{w1_text}" và "{w2_text}" '
                        f"({eff_pause_sec:.2f}s) do độ tin cậy nhận dạng ASR thấp ({min_pair_prob:.2f}) — khoảng {ts}."
                    ),
                    "words": [w1_text, w2_text],
                    "timeRange": [round(gap_start_sec, 3), round(gap_end_sec, 3)],
                    "mappingUncertain": True,
                    "pauseContext": "low_asr_confidence",
                    "unverifiedReason": "low_asr_confidence",
                }
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

            if mapping_uncertain and not is_protected and reported_pause_sec < (0.65 / eff_speed):
                pair_pause_issues[i] = {
                    "severity": "unverified",
                    "code": "UNVERIFIED_PAUSE",
                    "message": (
                        f'Chưa thể xác minh khoảng ngắt giữa "{w1_text}" và "{w2_text}" '
                        f"({reported_pause_sec:.2f}s) do căn chỉnh chưa chắc chắn — khoảng {ts}."
                    ),
                    "words": [w1_text, w2_text],
                    "timeRange": [round(gap_start_sec, 3), round(gap_end_sec, 3)],
                    "mappingUncertain": True,
                    "pauseContext": pause_ctx,
                    "unverifiedReason": "alignment_uncertain",
                }
            else:
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

    def is_clean_prosodic_break(m_idx: int) -> bool:
        b_m = boundary_records[m_idx]
        if not b_m["is_prosodic_boundary"] or m_idx in pair_pause_issues:
            return False
        # If the word immediately after m_idx is the head of a tight constituent (e.g. 'between | 200')
        # and that tight link is broken (in pair_pause_issues), then m_idx is stranded inside a staccato
        # breakdown rather than starting a fluent phrase.
        if (
            (m_idx + 1) < len(boundary_records)
            and (m_idx + 1) in pair_pause_issues
            and (boundary_records[m_idx + 1]["is_tight_cohesion"] or boundary_records[m_idx + 1]["is_protected"])
        ):
            return False
        return True

    # 1. Check for sandwiched short tokens / version numbers / function words isolated by pauses on both sides
    # (e.g. "Powerwall ... 3 ... are", "this ... 50 ... ,000", "down ... to ... 20", "in ... the ... car")
    # Evaluates the 3-word syntactic structure (b_prev, w_curr, b_next) rather than skipping function words by list:
    #   - If one side is a clean prosodic phrase boundary and the other side does NOT violate its tight threshold
    #     (e.g. "costs [0.38s] by [0.22s] 50" where 'costs | by' is NATURAL_BOUNDARY and 'by 50' < 0.24s), it is natural.
    #   - If w_curr is inside a tight constituent on both sides ('down | to | 20', 'in | the | car') or violates a
    #     tight/protected link while isolated on both sides, it is flagged.
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

        if has_acoustic_speech:
            pause_before = b_prev["eff_pause_sec"]
            pause_after = b_next["eff_pause_sec"]
        else:
            pause_before = max(0.0, b_prev["gap"])
            pause_after = max(0.0, b_next["gap"])

        prev_is_tight = bool(b_prev["is_protected"] or b_prev["is_tight_cohesion"])
        next_is_tight = bool(b_next["is_protected"] or b_next["is_tight_cohesion"])
        prev_tight_violated = prev_is_tight and pause_before >= b_prev["pair_min_pause"]
        next_tight_violated = next_is_tight and pause_after >= b_next["pair_min_pause"]

        # When one side is a clean prosodic phrase boundary (e.g. 'costs | by 50', 'oven | for hours', 'named Idra | to'),
        # do NOT trigger unless the OTHER side is a protected entity or violates its own tight-cohesion threshold.
        if is_clean_prosodic_break(i - 1) and not (b_next["is_protected"] or next_tight_violated):
            continue
        if is_clean_prosodic_break(i) and not (b_prev["is_protected"] or prev_tight_violated):
            continue

        is_short_or_num = (
            len(w_curr_text) <= 4
            or is_version_or_number_token(w_curr_raw)
            or b_prev["is_protected"]
            or b_next["is_protected"]
        )
        if not is_short_or_num:
            continue

        # Require either:
        #   (a) at least one adjacent boundary violates its tight/protected threshold, OR
        #   (b) both adjacent boundaries are tight-cohesion links (e.g. 'in | the | car', 'down | to | 20')
        #       with pauses >= 0.21s on both sides tearing the constituent apart.
        has_structural_violation = (
            prev_tight_violated
            or next_tight_violated
            or (prev_is_tight and next_is_tight and min(pause_before, pause_after) >= (0.21 / eff_speed))
        )
        if not has_structural_violation:
            continue

        # If adjacent boundaries are also part of a longer staccato chain (3+ pauses in the same phrase),
        # let the choppy_phrase clusterer below merge the entire phrase rather than just 2 boundaries.
        if (i + 1) < len(boundary_records) and not boundary_records[i + 1]["has_source_punct"] and not is_clean_prosodic_break(i + 1) and boundary_records[i + 1]["eff_pause_sec"] >= 0.21:
            continue
        if (
            (i + 2) < len(boundary_records)
            and not boundary_records[i + 1]["has_source_punct"]
            and not boundary_records[i + 2]["has_source_punct"]
            and not is_clean_prosodic_break(i + 1)
            and not is_clean_prosodic_break(i + 2)
            and boundary_records[i + 2]["eff_pause_sec"] >= 0.21
            and ((i - 1) in pair_pause_issues and i in pair_pause_issues)
        ):
            continue
        if (i - 2) >= 0 and not boundary_records[i - 2]["has_source_punct"] and not is_clean_prosodic_break(i - 2) and boundary_records[i - 2]["eff_pause_sec"] >= 0.21:
            continue

        min_side_small = max(0.16, 0.18 / eff_speed)
        min_side_large = max(0.18, 0.20 / eff_speed)
        min_combined = max(0.40, 0.44 / eff_speed)

        if (
            round(min(pause_before, pause_after), 3) >= round(min_side_small, 3)
            and round(max(pause_before, pause_after), 3) >= round(min_side_large, 3)
            and round(pause_before + pause_after, 3) >= round(min_combined, 3)
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
            if mapping_unc and not (b_prev["is_protected"] or b_next["is_protected"]):
                sandwiched_issues.append({
                    "severity": "unverified",
                    "code": "UNVERIFIED_PAUSE",
                    "message": (
                        f'Chưa thể xác minh khoảng ngắt quanh "{w_curr_text}" trong cụm '
                        f'"{w_prev_text} {w_curr_text} {w_next_text}" '
                        f"({pause_before:.2f}s + {pause_after:.2f}s) — khoảng {ts}."
                    ),
                    "words": [w_prev_text, w_curr_text, w_next_text],
                    "timeRange": [round(b_prev["gap_start_sec"], 3), round(b_next["gap_end_sec"], 3)],
                    "mappingUncertain": True,
                    "pauseContext": pause_ctx,
                    "unverifiedReason": "alignment_uncertain",
                })
            else:
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

    # 2. Clustered Staccato / Choppy Phrase Detection & Merging (Whole-Phrase Acoustic Continuity):
    # Evaluates the entire candidate constituent's acoustic continuity:
    #   - Never chain across Prosodic Phrase Boundaries or punctuation.
    #   - Compute active speech duration vs total silent pause duration inside the span (`discontinuity_ratio`),
    #     plus local rhythm change vs surrounding fluent boundaries.
    #   - Distinguish PASS, UNVERIFIED_PAUSE (borderline/ambiguous), and WARNING (verified choppy phrase).
    choppy_issues: list[dict[str, Any]] = []
    n_bounds = len(boundary_records)

    non_punct_pauses = [
        b["eff_pause_sec"]
        for b in boundary_records
        if not b["has_source_punct"] and not b["is_prosodic_boundary"]
    ]
    baseline_clause_pause = float(np.median(non_punct_pauses)) if non_punct_pauses else 0.04

    b_cursor = 0
    while b_cursor < n_bounds:
        b_rec = boundary_records[b_cursor]
        if (
            b_cursor in consumed_boundaries
            or b_rec["has_source_punct"]
            or is_clean_prosodic_break(b_cursor)
            or b_rec["eff_pause_sec"] < 0.21
        ):
            b_cursor += 1
            continue

        # Grow a cluster within the same syntactic constituent (<= 2 words apart, stopping at punctuation or clean PPBs)
        cluster = [b_cursor]
        look = b_cursor + 1
        while look < n_bounds and (look - cluster[-1]) <= 2:
            if any(
                boundary_records[m]["has_source_punct"]
                or is_clean_prosodic_break(m)
                for m in range(cluster[-1] + 1, look + 1)
            ):
                break
            if look not in consumed_boundaries and boundary_records[look]["eff_pause_sec"] >= 0.21:
                cluster.append(look)
            look += 1

        if len(cluster) < 2:
            b_cursor += 1
            continue

        flagged_members = [
            idx_c for idx_c in cluster
            if idx_c in pair_pause_issues and pair_pause_issues[idx_c]["severity"] == "warning"
        ]
        tight_members = [
            idx_c for idx_c in cluster
            if boundary_records[idx_c]["is_protected"] or boundary_records[idx_c]["is_tight_cohesion"]
        ]
        consecutive_links = sum(1 for k in range(len(cluster) - 1) if cluster[k + 1] - cluster[k] == 1)

        first_b = boundary_records[cluster[0]]
        last_b = boundary_records[cluster[-1]]
        span_start_sec = float(first_b["start1"])
        span_end_sec = float(last_b["end2"])
        span_total_dur = max(0.10, span_end_sec - span_start_sec)
        total_pause_in_cluster = sum(float(boundary_records[idx_c]["eff_pause_sec"]) for idx_c in cluster)
        mean_cluster_pause = total_pause_in_cluster / len(cluster)

        # Four mathematically independent evidence dimensions for choppy_phrase:
        #   1. Temporal pause density: pause_fraction = total_pause_in_cluster / span_total_dur
        #   2. Syntactic cohesion disruption: tight_members & max_cohesion_excess
        #   3. Inter-pause speech fragmentation: mean_fragment_speech_sec & short_fragment_count
        #   4. Local rhythm contrast: rhythm_jump = mean_cluster_pause - baseline_clause_pause
        pause_fraction = total_pause_in_cluster / span_total_dur
        max_cohesion_excess = max(
            (
                float(boundary_records[idx_c]["eff_pause_sec"])
                / max(0.15, float(boundary_records[idx_c]["pair_min_pause"]))
            )
            for idx_c in cluster
        )
        fragment_durs = [
            max(0.02, float(asr_words[w_k].get("endSec", 0.0)) - float(asr_words[w_k].get("startSec", 0.0)))
            for w_k in range(cluster[0], min(len(asr_words), cluster[-1] + 2))
        ]
        mean_fragment_speech_sec = float(np.mean(fragment_durs)) if fragment_durs else 0.35
        short_fragment_count = sum(1 for d in fragment_durs if d <= (0.48 / eff_speed))
        rhythm_jump = mean_cluster_pause - baseline_clause_pause

        is_verified_choppy = (
            (
                len(flagged_members) >= 2
                and pause_fraction >= 0.20
                and (short_fragment_count >= 1 or max_cohesion_excess >= 1.05)
            )
            or (
                len(flagged_members) >= 1
                and len(tight_members) >= 2
                and pause_fraction >= 0.22
                and mean_fragment_speech_sec <= (0.55 / eff_speed)
            )
            or (
                len(tight_members) >= 2
                and consecutive_links >= 1
                and all(boundary_records[idx_c]["eff_pause_sec"] >= (0.25 / eff_speed) for idx_c in cluster)
                and pause_fraction >= 0.25
                and mean_fragment_speech_sec <= (0.52 / eff_speed)
                and rhythm_jump >= 0.18
            )
            or (
                len(cluster) >= 3
                and consecutive_links >= 2
                and len(tight_members) >= 1
                and all(boundary_records[idx_c]["eff_pause_sec"] >= (0.22 / eff_speed) for idx_c in cluster)
                and pause_fraction >= 0.24
                and short_fragment_count >= 2
            )
        )

        # Ambiguous / borderline staccato in a phrase without sufficient evidence for WARNING
        is_borderline_unverified_choppy = (
            not is_verified_choppy
            and len(flagged_members) == 0
            and consecutive_links >= 1
            and len(tight_members) >= 1
            and all(boundary_records[idx_c]["eff_pause_sec"] >= (0.22 / eff_speed) for idx_c in cluster)
            and pause_fraction >= 0.21
            and mean_fragment_speech_sec <= (0.58 / eff_speed)
            and (
                len(tight_members) >= 2
                or any(
                    boundary_records[idx_c]["mapping_uncertain"]
                    or boundary_records[idx_c]["boundary_class"] == "UNCERTAIN_BOUNDARY"
                    for idx_c in cluster
                )
            )
        )

        if is_verified_choppy or is_borderline_unverified_choppy:
            for idx_c in cluster:
                consumed_boundaries.add(idx_c)
            phrase_words = [
                clean_word(str(asr_words[w_k].get("word", "")))
                for w_k in range(cluster[0], cluster[-1] + 2)
                if clean_word(str(asr_words[w_k].get("word", "")))
            ]
            phrase_str = " ".join(phrase_words)
            pauses_str = " + ".join(f"{boundary_records[idx_c]['eff_pause_sec']:.2f}s" for idx_c in cluster)
            ts = format_timestamp(first_b["gap_start_sec"])
            mapping_unc = any(boundary_records[idx_c]["mapping_uncertain"] for idx_c in cluster)
            use_unverified = is_borderline_unverified_choppy or (mapping_unc and not flagged_members)
            if use_unverified:
                choppy_issues.append({
                    "severity": "unverified",
                    "code": "UNVERIFIED_PAUSE",
                    "message": (
                        f'Chưa thể xác minh nhịp đọc trong cụm "{phrase_str}" '
                        f"({pauses_str}) do ranh giới ngữ pháp hoặc căn chỉnh chưa chắc chắn — khoảng {ts}."
                    ),
                    "words": phrase_words,
                    "timeRange": [round(first_b["gap_start_sec"], 3), round(last_b["gap_end_sec"], 3)],
                    "mappingUncertain": True,
                    "pauseContext": "choppy_phrase",
                    "unverifiedReason": "alignment_uncertain" if mapping_unc else "borderline_uncertain_boundary",
                })
            else:
                choppy_issues.append({
                    "severity": "warning",
                    "code": "ABNORMAL_PAUSE",
                    "message": (
                        f'Cảnh báo: Đọc ngắt nhịp / giật cục trong cụm "{phrase_str}" '
                        f"({pauses_str}) — khoảng {ts}. Vui lòng nghe kiểm tra."
                    ),
                    "words": phrase_words,
                    "timeRange": [round(first_b["gap_start_sec"], 3), round(last_b["gap_end_sec"], 3)],
                    "mappingUncertain": mapping_unc,
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

    # Stage 3 Decision Deduplication
    issues = _deduplicate_quality_issues(issues)

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
        if iss.get("unverifiedReason"):
            ev_str += f" reason={iss.get('unverifiedReason')}"
        if iss.get("mappingUncertain"):
            ev_str += " mapping=uncertain"
        iss.setdefault("evidence", ev_str)

    metrics["secondaryWhisperCalls"] = max(0, initial_slice_budget - int(slice_budget[0]))
    metrics["unverifiedReasons"] = [
        str(iss.get("unverifiedReason") or iss.get("code"))
        for iss in issues
        if iss.get("severity") == "unverified"
    ]
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
        raw_split = text.split()
        raw_asr = [str(w.get("word", "")) for w in (asr_words or [])]
        s_sp = _collapse_multiplied_letter_spans(
            collapse_number_tokens(raw_split, language), raw_split, counterpart_clean=set(asr_words_clean)
        )
        a_sp = _collapse_multiplied_letter_spans(
            collapse_number_tokens(raw_asr, language), raw_asr, counterpart_clean=set(text_words)
        )
        matcher = difflib.SequenceMatcher(None, [s.canonical for s in s_sp], [a.canonical for a in a_sp])
        for tag, s_i1, s_i2, a_j1, a_j2 in matcher.get_opcodes():
            if tag == "equal":
                for a_item in a_sp[a_j1:a_j2]:
                    equal_asr_indices.update(range(a_item.orig_start, a_item.orig_end))

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
    # Compute RMS per frame (vectorized over strided frames)
    frame_view = np.lib.stride_tricks.sliding_window_view(mono, frame_len)[::hop_len][:num_frames]
    rms_frames = np.sqrt(np.mean(np.square(frame_view, dtype=np.float32), axis=1)).astype(np.float32)

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

    # Compute spectrum, formant-band spectrum (180Hz-4200Hz), and zero-crossing rate for each burst
    burst_specs: list[np.ndarray] = []
    formant_specs: list[np.ndarray] = []
    for b in bursts:
        st = b["start_idx"] * hop_len
        en = min(mono.size, b["end_idx"] * hop_len + frame_len)
        chunk = mono[st:en]
        b["mean_zcr"] = float(np.mean(np.abs(np.diff(np.signbit(chunk))))) if chunk.size > 1 else 0.0
        if chunk.size < 64:
            burst_specs.append(np.zeros(32, dtype=np.float32))
            formant_specs.append(np.zeros(24, dtype=np.float32))
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

        freqs = np.fft.rfftfreq(chunk.size, d=1.0 / sample_rate)
        f_mask = (freqs >= 240.0) & (freqs <= 4200.0)
        f_mag = np.log1p(fft_mag[f_mask] * 50.0) if np.any(f_mask) else np.log1p(fft_mag)
        if f_mag.size >= 24:
            edges = np.linspace(0, f_mag.size, 25, dtype=int)
            f_vec = np.array([np.mean(f_mag[edges[k] : edges[k + 1]]) for k in range(24)], dtype=np.float32)
        else:
            f_vec = np.pad(f_mag.astype(np.float32), (0, max(0, 24 - f_mag.size)))[:24]
        f_vec = f_vec - float(np.mean(f_vec)) * 0.85
        f_norm = np.linalg.norm(f_vec)
        formant_specs.append(f_vec / f_norm if f_norm > 1e-6 else f_vec)

    issues: list[dict[str, Any]] = []
    detected_ranges: list[tuple[float, float]] = []

    for k in range(len(bursts) - 1):
        for m_next in range(k + 1, min(len(bursts), k + 3)):
            b1 = bursts[k]
            b2 = bursts[m_next]
            if m_next == k + 2:
                b_mid = bursts[k + 1]
                if (b_mid["end_sec"] - b_mid["start_sec"]) > 0.11:
                    continue

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

            # Check spectral cosine similarity and formant-band similarity
            s1 = burst_specs[k]
            s2 = burst_specs[m_next]
            cos_sim = float(np.dot(s1, s2))
            formant_sim = float(np.dot(formant_specs[k], formant_specs[m_next]))

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
                    st = float(w.get("startSec", 0.0)) - 0.02
                    en = float(w.get("endSec", 0.0)) + 0.02
                    if st <= mid1 <= en and w_idx1 is None:
                        w_idx1 = idx
                    if st <= mid2 <= en and w_idx2 is None:
                        w_idx2 = idx

                # If bursts span across two DIFFERENT words in ASR:
                if w_idx1 is not None and w_idx2 is not None and w_idx1 != w_idx2:
                    if abs(w_idx2 - w_idx1) != 1:
                        continue

                    word1_clean = clean_word(asr_words[w_idx1].get("word", ""))
                    word2_clean = clean_word(asr_words[w_idx2].get("word", ""))
                    if not word1_clean or not word2_clean:
                        continue
                    if word1_clean != word2_clean:
                        # Check for DTW-misaligned syllable repetition across adjacent words (e.g. 'mo-mo-mobile diagnostic'
                        # where Whisper ended 'mobile' on the first 'mo-' with low probability < 0.72 and pushed the second 'mo-'
                        # + 'mobile' into the start of 'diagnostic'):
                        p1 = float(asr_words[w_idx1].get("probability", 1.0))
                        p2 = float(asr_words[w_idx2].get("probability", 1.0))
                        w1_st = float(asr_words[w_idx1].get("startSec", 0.0))
                        w2_en = float(asr_words[w_idx2].get("endSec", w1_st))
                        exp_syl_pair = _estimate_expected_syllables(word1_clean) + _estimate_expected_syllables(word2_clean)
                        pair_nuclei = _count_vowel_nuclei_in_span(mono, sample_rate, w1_st, w2_en)
                        cand_stutter_word = word1_clean if p1 <= p2 else word2_clean
                        both_matched_cleanly = (
                            bool(equal_asr_indices)
                            and w_idx1 in equal_asr_indices
                            and w_idx2 in equal_asr_indices
                            and min(p1, p2) >= 0.55
                        )
                        if (
                            min(p1, p2) < 0.72
                            and not both_matched_cleanly
                            and len(cand_stutter_word) >= 3
                            and cand_stutter_word not in EN_MINOR_STOPWORDS
                            and not re.search(r"\d", word1_clean)
                            and not re.search(r"\d", word2_clean)
                            and float(b1.get("mean_zcr", 0.0)) < 0.20
                            and float(b2.get("mean_zcr", 0.0)) < 0.20
                            and cos_sim >= 0.94
                            and formant_sim >= 0.93
                            and abs(dur1 - dur2) <= 0.035
                            and (min_burst_peak / max_burst_peak) >= 0.75
                            and min_gap_rms <= 0.15 * min_burst_peak
                            and pair_nuclei >= exp_syl_pair + 1
                        ):
                            is_verified_stutter = True
                            stutter_word = cand_stutter_word
                        else:
                            continue
                    else:
                        # 2. Both bursts map to consecutive duplicate words in ASR (e.g. 'row row' or 'that that').
                        if equal_asr_indices and w_idx1 in equal_asr_indices and w_idx2 in equal_asr_indices:
                            continue
                        if word1_clean in intentional_repeats and (asr_word_counts.get(word1_clean, 0) <= src_word_counts.get(word1_clean, 0)):
                            continue

                        is_verified_stutter = True
                        stutter_word = word1_clean

                # If both bursts fall within the same word in ASR (intra-word repetition):
                elif w_idx1 is not None and w_idx2 is not None and w_idx1 == w_idx2:
                    word_clean = clean_word(asr_words[w_idx1].get("word", ""))
                    word_raw = asr_words[w_idx1].get("word", "").strip()
                    if not word_clean or word_clean in intentional_repeats or re.search(r"\d", word_clean):
                        continue
                    is_stutter_text = bool(
                        re.search(r"(\b[a-zA-Z\u00C0-\u1EF9]{1,4})[-_]\1", word_raw, re.IGNORECASE)
                        or re.search(r"^([a-zA-Z\u00C0-\u1EF9]{1,3})\1+", word_clean)
                    )
                    if is_stutter_text and cos_sim >= 0.90 and min_gap_rms <= 0.20 * min_burst_peak:
                        is_verified_stutter = True
                        stutter_word = word_clean
                    else:
                        w_st = float(asr_words[w_idx1].get("startSec", 0.0))
                        w_en = float(asr_words[w_idx1].get("endSec", w_st))
                        w_dur = w_en - w_st
                        w_prob = float(asr_words[w_idx1].get("probability", 1.0))
                        expected_syl = _estimate_expected_syllables(word_clean)
                        word_voiced_bursts = [
                            b_cand for b_cand in bursts
                            if (w_st - 0.02) <= ((b_cand["start_sec"] + b_cand["end_sec"]) / 2.0) <= (w_en + 0.02)
                            and float(b_cand.get("mean_zcr", 0.0)) < 0.22
                        ]
                        word_nuclei = _count_vowel_nuclei_in_span(mono, sample_rate, w_st, w_en)
                        has_excess_syllables = (
                            len(word_voiced_bursts) >= 3
                            and max(len(word_voiced_bursts), word_nuclei) >= expected_syl + 1
                        )
                        has_clone_prefix_stutter = (
                            len(word_clean) >= 4
                            and w_prob < 0.75
                            and max(len(word_voiced_bursts), word_nuclei) >= expected_syl + 1
                            and abs(dur1 - dur2) <= 0.030
                            and (min_burst_peak / max_burst_peak) >= 0.80
                            and formant_sim >= 0.95
                            and min_gap_rms <= 0.14 * min_burst_peak
                        )
                        if (
                            float(b1.get("mean_zcr", 0.0)) < 0.22
                            and float(b2.get("mean_zcr", 0.0)) < 0.22
                            and cos_sim >= 0.91
                            and formant_sim >= 0.92
                            and min_gap_rms <= 0.20 * min_burst_peak
                            and (
                                (has_excess_syllables and 0.015 <= valley_sec <= 0.095)
                                # Clone-prefix restarts ('ba- ba- battery') carry a longer hesitation gap but
                                # already require near-identical bursts and low ASR confidence
                                or (has_clone_prefix_stutter and 0.015 <= valley_sec <= 0.20)
                            )
                            and w_dur >= (0.18 * expected_syl + 0.12)
                        ):
                            is_verified_stutter = True
                            stutter_word = word_clean
                elif w_idx1 is None and w_idx2 is not None and m_next == k + 1:
                    # Cut-and-restart onset stutter where Whisper placed `startSec` of word `w_idx2` on the second burst `b2`,
                    # leaving the repeated initial syllable `b1` ('ba-' before 'battery') unaligned in the preceding gap:
                    word2_clean = clean_word(asr_words[w_idx2].get("word", ""))
                    prev_w_end = float(asr_words[w_idx2 - 1].get("endSec", 0.0)) if w_idx2 > 0 else 0.0
                    prev_w_start = float(asr_words[w_idx2 - 1].get("startSec", 0.0)) if w_idx2 > 0 else 0.0
                    prev_w_clean = clean_word(asr_words[w_idx2 - 1].get("word", "")) if w_idx2 > 0 else ""
                    w2_prob = float(asr_words[w_idx2].get("probability", 1.0))
                    w2_st = float(asr_words[w_idx2].get("startSec", 0.0))
                    w2_en = float(asr_words[w_idx2].get("endSec", w2_st))
                    w2_dur = max(0.0, w2_en - w2_st)
                    dur1 = float(b1["end_sec"] - b1["start_sec"])
                    dur2 = float(b2["end_sec"] - b2["start_sec"])
                    prev_plus_b1_excess = (
                        True
                        if w_idx2 == 0 or not prev_w_clean
                        else _count_vowel_nuclei_in_span(mono, sample_rate, prev_w_start, float(b1["end_sec"]))
                        >= (_estimate_expected_syllables(prev_w_clean) + 1)
                    )
                    if (
                        word2_clean
                        and len(word2_clean) >= 4
                        and prev_plus_b1_excess
                        and word2_clean not in intentional_repeats
                        and not re.search(r"\d", word2_clean)
                        and b1["start_sec"] >= (prev_w_end + 0.025 if w_idx2 > 0 else 0.0)
                        and abs(b2["start_sec"] - w2_st) <= 0.08
                        and 0.05 <= dur1 <= 0.18
                        and w2_dur >= 1.8 * dur1
                        and (dur2 >= 1.8 * dur1 or abs(dur1 - dur2) <= 0.025)
                        and 0.015 <= valley_sec <= 0.085
                        and float(b1.get("mean_zcr", 0.0)) < 0.20
                        and float(b2.get("mean_zcr", 0.0)) < 0.20
                        and cos_sim >= 0.92
                        and formant_sim >= 0.92
                        and min_gap_rms <= 0.18 * min_burst_peak
                    ):
                        is_verified_stutter = True
                        stutter_word = word2_clean
            else:
                # Standalone acoustic check without ASR words (e.g. synthetic test)
                # TUNING REQUIRED (CONSTRAINTS.md section 7.2)
                if m_next == k + 1 and cos_sim >= 0.92 and min_gap_rms <= 0.20 * min_burst_peak:
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
                    "evidence": f"Acoustic burst cos_sim={cos_sim:.2f} formant_sim={formant_sim:.2f} valley={valley_sec:.2f}s",
                })
                break

    # Pass 2: Whisper-Suppressed Whole-Word Repetition Detection (bursts 0.18s .. 0.65s)
    # Uses a 40ms word-level RMS envelope (20ms hop) to smooth over brief intra-word consonant
    # closures (e.g. the medial flap/glottal in "throt-tle") so each spoken word forms a contiguous burst.
    wb_frame_len = max(1, int(round(0.040 * sample_rate)))
    wb_hop_len = max(1, int(round(0.020 * sample_rate)))
    if mono.size >= wb_frame_len * 2:
        wb_frames_view = np.lib.stride_tricks.sliding_window_view(mono, wb_frame_len)[::wb_hop_len]
        wb_rms_frames = np.sqrt(np.mean(wb_frames_view ** 2, axis=1))
    else:
        wb_rms_frames = np.zeros(0, dtype=np.float32)
    wb_num_frames = int(wb_rms_frames.size)
    wb_peak_rms = float(np.max(wb_rms_frames)) if wb_num_frames > 0 else 0.0
    wb_speech_thresh = max(0.015, wb_peak_rms * 0.20)
    wb_valley_thresh = wb_peak_rms * 0.45

    word_bursts: list[dict[str, Any]] = []
    in_wb = False
    wb_start = 0
    for i, r in enumerate(wb_rms_frames):
        if r >= wb_speech_thresh:
            if not in_wb:
                in_wb = True
                wb_start = i
        else:
            if in_wb:
                in_wb = False
                wb_dur = (i - wb_start) * wb_hop_len / sample_rate
                if 0.18 <= wb_dur <= 0.65:
                    word_bursts.append({
                        "start_idx": wb_start,
                        "end_idx": i,
                        "start_sec": wb_start * wb_hop_len / sample_rate,
                        "end_sec": (i * wb_hop_len + wb_frame_len) / sample_rate,
                        "dur_sec": wb_dur,
                        "peak_rms": float(np.max(wb_rms_frames[wb_start:i])),
                    })
    if in_wb:
        wb_dur = (wb_num_frames - wb_start) * wb_hop_len / sample_rate
        if 0.18 <= wb_dur <= 0.65:
            word_bursts.append({
                "start_idx": wb_start,
                "end_idx": wb_num_frames,
                "start_sec": wb_start * wb_hop_len / sample_rate,
                "end_sec": mono.size / sample_rate,
                "dur_sec": wb_dur,
                "peak_rms": float(np.max(wb_rms_frames[wb_start:wb_num_frames])),
            })

    def _compute_chunk_acoustic_vecs(chunk_arr: np.ndarray) -> tuple[np.ndarray, np.ndarray, float]:
        if chunk_arr.size < 64:
            return np.zeros(32, dtype=np.float32), np.zeros(24, dtype=np.float32), 0.0
        zcr_val = float(np.mean(np.abs(np.diff(np.signbit(chunk_arr))))) if chunk_arr.size > 1 else 0.0
        win = np.hanning(chunk_arr.size)
        mag = np.abs(np.fft.rfft(chunk_arr * win))
        if mag.size >= 32:
            s_len = mag.size // 32
            sp = np.array([np.mean(mag[idx_b * s_len : (idx_b + 1) * s_len]) for idx_b in range(32)], dtype=np.float32)
        else:
            sp = np.pad(mag.astype(np.float32), (0, 32 - mag.size))
        sp_norm = np.linalg.norm(sp)
        sp = sp / sp_norm if sp_norm > 1e-6 else sp

        frqs = np.fft.rfftfreq(chunk_arr.size, d=1.0 / sample_rate)
        f_msk = (frqs >= 240.0) & (frqs <= 4200.0)
        f_mg = np.log1p(mag[f_msk] * 50.0) if np.any(f_msk) else np.log1p(mag)
        if f_mg.size >= 24:
            edg = np.linspace(0, f_mg.size, 25, dtype=int)
            fv = np.array([np.mean(f_mg[edg[idx_b] : edg[idx_b + 1]]) for idx_b in range(24)], dtype=np.float32)
        else:
            fv = np.pad(f_mg.astype(np.float32), (0, max(0, 24 - f_mg.size)))[:24]
        fv = fv - float(np.mean(fv)) * 0.85
        fv_norm = np.linalg.norm(fv)
        fv = fv / fv_norm if fv_norm > 1e-6 else fv
        return sp, fv, zcr_val

    for k in range(len(word_bursts) - 1):
        wb1 = word_bursts[k]
        wb2 = word_bursts[k + 1]
        valley_sec = (wb2["start_idx"] - wb1["end_idx"]) * wb_hop_len / sample_rate
        if not (0.015 <= valley_sec <= 0.35):
            continue
        gap_frames = wb_rms_frames[wb1["end_idx"] : wb2["start_idx"]]
        if gap_frames.size == 0:
            continue
        min_gap_rms = float(np.min(gap_frames))
        min_peak = min(wb1["peak_rms"], wb2["peak_rms"])
        max_peak = max(wb1["peak_rms"], wb2["peak_rms"])
        if min_gap_rms > wb_valley_thresh or min_gap_rms > 0.16 * min_peak or (min_peak / max_peak) < 0.75:
            continue
        dur1 = wb1["dur_sec"]
        dur2 = wb2["dur_sec"]
        # Either equal-length word bursts or wb2 has a coarticulated short trailing word (e.g. 'throttle its')
        if not (abs(dur1 - dur2) <= 0.08 or (0.0 <= (dur2 - dur1) <= 0.18 and dur1 >= 0.22)):
            continue

        st1 = wb1["start_idx"] * wb_hop_len
        en1 = min(mono.size, wb1["end_idx"] * wb_hop_len + wb_frame_len)
        st2 = wb2["start_idx"] * wb_hop_len
        en2 = min(mono.size, wb2["end_idx"] * wb_hop_len + wb_frame_len)
        c1 = mono[st1:en1]
        c2 = mono[st2:en2]
        c2_pref = c2[:c1.size] if c2.size > c1.size else c2

        s1, f1, z1 = _compute_chunk_acoustic_vecs(c1)
        s2, f2, z2 = _compute_chunk_acoustic_vecs(c2)
        s2p, f2p, _ = _compute_chunk_acoustic_vecs(c2_pref)
        if z1 >= 0.20 or z2 >= 0.20:
            continue
        cos_sim = max(float(np.dot(s1, s2)), float(np.dot(s1, s2p)))
        formant_sim = max(float(np.dot(f1, f2)), float(np.dot(f1, f2p)))

        env_frame = max(1, int(round(0.02 * sample_rate)))
        env_hop = max(1, int(round(0.01 * sample_rate)))
        if c1.size >= env_frame * 3 and c2_pref.size >= env_frame * 3:
            e1 = np.sqrt(np.mean(np.lib.stride_tricks.sliding_window_view(c1, env_frame)[::env_hop] ** 2, axis=1))
            e2 = np.sqrt(np.mean(np.lib.stride_tricks.sliding_window_view(c2_pref, env_frame)[::env_hop] ** 2, axis=1))
            m_len = min(len(e1), len(e2))
            e1, e2 = e1[:m_len], e2[:m_len]
            env_corr = float(np.dot(e1, e2) / (np.linalg.norm(e1) * np.linalg.norm(e2) + 1e-8))
        else:
            env_corr = 0.0

        if cos_sim < 0.96 or formant_sim < 0.95 or env_corr < 0.80:
            continue

        rep_word = ""
        is_whole_word_repeat = False
        if asr_words:
            mid1 = (wb1["start_sec"] + wb1["end_sec"]) / 2.0
            mid2 = (wb2["start_sec"] + wb2["end_sec"]) / 2.0
            w_idx1 = next(
                (idx for idx, w in enumerate(asr_words) if float(w.get("startSec", 0.0)) - 0.02 <= mid1 <= float(w.get("endSec", 0.0)) + 0.02),
                None,
            )
            w_idx2 = next(
                (idx for idx, w in enumerate(asr_words) if float(w.get("startSec", 0.0)) - 0.02 <= mid2 <= float(w.get("endSec", 0.0)) + 0.02),
                None,
            )
            if w_idx1 is not None and w_idx2 is not None and abs(w_idx2 - w_idx1) == 1:
                w1_obj = asr_words[w_idx1]
                w2_obj = asr_words[w_idx2]
                w1_clean = clean_word(w1_obj.get("word", ""))
                w2_clean = clean_word(w2_obj.get("word", ""))
                w1_dur = float(w1_obj.get("endSec", 0.0)) - float(w1_obj.get("startSec", 0.0))
                w2_dur = float(w2_obj.get("endSec", 0.0)) - float(w2_obj.get("startSec", 0.0))
                exp_syl1 = _estimate_expected_syllables(w1_clean)
                exp_syl2 = _estimate_expected_syllables(w2_clean)
                if w1_clean and w2_clean and w1_clean != w2_clean:
                    if (
                        dur1 >= 0.65 * w1_dur
                        and w2_dur >= (valley_sec + dur1 * 0.85 + 0.14 * exp_syl2)
                    ):
                        rep_word = w1_clean
                        is_whole_word_repeat = True
                    elif (
                        dur2 >= 0.65 * w2_dur
                        and w1_dur >= (valley_sec + dur2 * 0.85 + 0.14 * exp_syl1)
                    ):
                        rep_word = w2_clean
                        is_whole_word_repeat = True
            elif w_idx1 is not None and w_idx2 is not None and w_idx1 == w_idx2:
                w1_obj = asr_words[w_idx1]
                w1_clean = clean_word(w1_obj.get("word", ""))
                w1_dur = float(w1_obj.get("endSec", 0.0)) - float(w1_obj.get("startSec", 0.0))
                exp_syl1 = _estimate_expected_syllables(w1_clean)
                if (
                    w1_clean
                    and dur1 >= max(0.22, 0.13 * exp_syl1)
                    and w1_dur >= max(0.56, 0.22 * exp_syl1 + dur1 * 0.90 + valley_sec)
                ):
                    rep_word = w1_clean
                    is_whole_word_repeat = True
            elif w_idx1 is not None and w_idx2 is None:
                w1_obj = asr_words[w_idx1]
                w1_clean = clean_word(w1_obj.get("word", ""))
                exp_syl1 = _estimate_expected_syllables(w1_clean)
                next_st = (
                    float(asr_words[w_idx1 + 1].get("startSec", wb2["end_sec"] + 1.0))
                    if (w_idx1 + 1) < len(asr_words)
                    else (wb2["end_sec"] + 1.0)
                )
                if w1_clean and dur1 >= max(0.22, 0.13 * exp_syl1) and valley_sec >= 0.10 and wb2["end_sec"] <= next_st + 0.06:
                    rep_word = w1_clean
                    is_whole_word_repeat = True
            elif w_idx1 is None and w_idx2 is not None:
                w2_obj = asr_words[w_idx2]
                w2_clean = clean_word(w2_obj.get("word", ""))
                exp_syl2 = _estimate_expected_syllables(w2_clean)
                prev_en = float(asr_words[w_idx2 - 1].get("endSec", 0.0)) if w_idx2 > 0 else 0.0
                if w2_clean and dur2 >= max(0.22, 0.13 * exp_syl2) and valley_sec >= 0.10 and wb1["start_sec"] >= prev_en - 0.04:
                    rep_word = w2_clean
                    is_whole_word_repeat = True
        else:
            if abs(dur1 - dur2) <= 0.06:
                is_whole_word_repeat = True

        if (
            is_whole_word_repeat
            and (not rep_word or (len(rep_word) >= 3 and rep_word not in intentional_repeats and not re.search(r"\d", rep_word)))
        ):
            t_start = round(wb1["start_sec"], 3)
            t_end = round(wb2["start_sec"] + min(wb2["end_sec"] - wb2["start_sec"], wb1["end_sec"] - wb1["start_sec"]), 3)
            if any(abs(t_start - r[0]) < 0.35 for r in detected_ranges):
                continue
            detected_ranges.append((t_start, t_end))
            ts = format_timestamp(t_start)
            msg = (
                f'Nghi vấn đọc lặp từ "{rep_word}" — khoảng {ts}. Vui lòng nghe kiểm tra.'
                if rep_word
                else f"Nghi vấn đọc lặp từ — khoảng {ts}. Vui lòng nghe kiểm tra."
            )
            issues.append({
                "severity": "warning",
                "code": "REPEATED_WORD",
                "message": msg,
                "words": [rep_word] if rep_word else [],
                "timeRange": [t_start, t_end],
                "sourceExcerpt": rep_word,
                "asrRawExcerpt": rep_word,
                "asrNormalizedExcerpt": rep_word,
                "tokenSource": "primary_asr",
                "evidence": f"Acoustic word repeat cos_sim={cos_sim:.2f} formant_sim={formant_sim:.2f} env_corr={env_corr:.2f} valley={valley_sec:.2f}s",
            })

    return issues



def verify_whisper_smoothed_stutters(
    text: str,
    asr_words: list[dict[str, Any]],
    audio_data: np.ndarray | None,
    sample_rate: int,
    whisper_model: Any | None,
    language: str | None = None,
    slice_budget: list[int] | None = None,
    secondary_reasons: list[str] | None = None,
    pronunciation_mapping: list[dict[str, Any]] | None = None,
    pronunciation_rules: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Two-tier stutter & garble verifier for words that full-sentence Whisper auto-corrected via LM context.

    Tier 1 (Waveform Acoustic Gate):
      - Trigger A: Intra-word / onset syllable restart where a matched word contains >= expected_syl + 1
        voiced bursts separated by a deep silence dip (e.g. 'The da— day' smoothed to 'The day').
      - Trigger B: Matched content word (len >= 4) with low confidence (< 0.55) or moderate confidence (< 0.80)
        paired with abnormal stretching or an internal glottal voice cut (e.g. 'Test-la-ts' smoothed to "Tesla's").
    Tier 2 (Isolated Context-Free Whisper Verification):
      - Extracts only the active speech span of the candidate word (padded with clean digital silence so
        surrounding sentence context cannot bias Whisper's decoder) and confirms SUSPECTED_STUTTER only when
        isolated ASR hears a syllable stutter/repeat or a non-equivalent garble.
    """
    if (
        whisper_model is None
        or audio_data is None
        or audio_data.size == 0
        or sample_rate <= 0
        or not text
        or not asr_words
    ):
        return []
    if slice_budget is not None and slice_budget[0] <= 0:
        return []

    mono = np.ascontiguousarray(audio_data, dtype=np.float32)
    if mono.ndim > 1:
        mono = mono.mean(axis=1)
    total_dur = mono.size / float(sample_rate)

    source_words, _, source_char_spans = tokenize_text_with_spans(text)
    source_words_clean = [clean_word(w) for w in source_words]
    asr_words_clean = [clean_word(str(w.get("word", ""))) for w in asr_words]
    if not source_words_clean or not asr_words_clean:
        return []

    intentional_repeats: set[str] = set()
    for idx in range(len(source_words_clean) - 1):
        if source_words_clean[idx] and source_words_clean[idx] == source_words_clean[idx + 1]:
            intentional_repeats.add(source_words_clean[idx])

    eff_pron_mapping: list[dict[str, Any]] = []
    if pronunciation_mapping is not None:
        eff_pron_mapping = list(pronunciation_mapping)
    elif text.strip():
        from .tts.service import prepare_spoken_text_for_tts
        prep = prepare_spoken_text_for_tts(text, language=language, custom_rules=pronunciation_rules)
        eff_pron_mapping = list(prep.get("pronunciationMapping", []))

    pm_covered_src: set[int] = set()
    for pm in eff_pron_mapping:
        if pm.get("mode") not in ("letter_by_letter", "custom"):
            continue
        m_start = int(pm.get("startIndex", -1))
        m_end = int(pm.get("endIndex", -1))
        for idx, (ws, we) in enumerate(source_char_spans):
            if ws < m_end and we > m_start:
                pm_covered_src.add(idx)

    matched_pairs: list[tuple[int, int]] = []
    matcher = difflib.SequenceMatcher(None, source_words_clean, asr_words_clean, autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            for off in range(i2 - i1):
                matched_pairs.append((i1 + off, j1 + off))
        elif tag == "replace" and (i2 - i1) == (j2 - j1):
            for off in range(i2 - i1):
                sw_c, aw_c = source_words_clean[i1 + off], asr_words_clean[j1 + off]
                if sw_c and aw_c and are_words_equivalent(sw_c, aw_c):
                    matched_pairs.append((i1 + off, j1 + off))

    # Precompute 25ms/10ms global RMS frames for burst similarity checks
    frame_len = max(1, int(round(0.025 * sample_rate)))
    hop_len = max(1, int(round(0.010 * sample_rate)))
    if mono.size < frame_len * 2:
        return []
    num_frames = 1 + (mono.size - frame_len) // hop_len
    frame_view = np.lib.stride_tricks.sliding_window_view(mono, frame_len)[::hop_len][:num_frames]
    rms_frames = np.sqrt(np.mean(np.square(frame_view, dtype=np.float32), axis=1)).astype(np.float32)
    global_peak_rms = float(np.max(rms_frames)) if rms_frames.size > 0 else 0.0
    if global_peak_rms < 0.02:
        return []
    speech_thresh = max(0.015, global_peak_rms * 0.20)

    def _burst_spec_and_formant(st_sample: int, en_sample: int) -> tuple[float, np.ndarray, np.ndarray]:
        chunk = mono[max(0, st_sample):min(mono.size, en_sample)]
        zcr_val = float(np.mean(np.abs(np.diff(np.signbit(chunk))))) if chunk.size > 1 else 0.0
        if chunk.size < 64:
            return zcr_val, np.zeros(32, dtype=np.float32), np.zeros(24, dtype=np.float32)
        fft_mag = np.abs(np.fft.rfft(chunk * np.hanning(chunk.size)))
        if fft_mag.size >= 32:
            sub_len = fft_mag.size // 32
            spec = np.array([np.mean(fft_mag[k * sub_len:(k + 1) * sub_len]) for k in range(32)], dtype=np.float32)
        else:
            spec = np.pad(fft_mag.astype(np.float32), (0, 32 - fft_mag.size))
        s_norm = float(np.linalg.norm(spec))
        spec = spec / s_norm if s_norm > 1e-6 else spec

        freqs = np.fft.rfftfreq(chunk.size, d=1.0 / sample_rate)
        f_mask = (freqs >= 240.0) & (freqs <= 4200.0)
        f_mag = np.log1p(fft_mag[f_mask] * 50.0) if np.any(f_mask) else np.log1p(fft_mag)
        if f_mag.size >= 24:
            edges = np.linspace(0, f_mag.size, 25, dtype=int)
            f_vec = np.array([np.mean(f_mag[edges[k]:edges[k + 1]]) for k in range(24)], dtype=np.float32)
        else:
            f_vec = np.pad(f_mag.astype(np.float32), (0, max(0, 24 - f_mag.size)))[:24]
        f_vec = f_vec - float(np.mean(f_vec)) * 0.85
        f_norm = float(np.linalg.norm(f_vec))
        f_vec = f_vec / f_norm if f_norm > 1e-6 else f_vec
        return zcr_val, spec, f_vec

    # Tier 1: Collect acoustic anomaly candidates
    candidates: list[dict[str, Any]] = []
    for src_idx, asr_idx in matched_pairs:
        sw = source_words_clean[src_idx]
        aw = asr_words_clean[asr_idx]
        if (
            not sw
            or len(sw) < 2
            or sw in intentional_repeats
            or src_idx in pm_covered_src
            or _is_numeric_scope_word(sw)
            or _is_numeric_scope_word(aw)
        ):
            continue
        w_obj = asr_words[asr_idx]
        if str(w_obj.get("word", "")).strip().startswith("-"):
            continue
        w_st = float(w_obj.get("startSec", 0.0))
        w_en = float(w_obj.get("endSec", w_st))
        w_dur = w_en - w_st
        if w_dur <= 0.12:
            continue
        w_prob = float(w_obj.get("probability", 1.0))
        expected_syl = _estimate_expected_syllables(sw)

        # Locate active speech onset/offset inside [max(prev_en, w_st - 0.03), min(next_st - 0.01, w_en + 0.12)]
        prev_en = float(asr_words[asr_idx - 1].get("endSec", 0.0)) if asr_idx > 0 else 0.0
        next_st = (
            float(asr_words[asr_idx + 1].get("startSec", total_dur)) - 0.01
            if (asr_idx + 1) < len(asr_words)
            else total_dur
        )
        search_t0 = max(0.0, max(prev_en, w_st - 0.03))
        search_t1 = min(total_dur, min(max(w_en, next_st), w_en + 0.12))
        f0 = max(0, int(round(search_t0 * sample_rate / hop_len)))
        f1 = min(num_frames, int(round(search_t1 * sample_rate / hop_len)))
        if f1 - f0 < 6:
            continue

        local_rms = rms_frames[f0:f1]
        local_zcr = np.mean(np.abs(np.diff(np.signbit(frame_view[f0:f1]), axis=1)), axis=1)
        local_peak = float(np.max(local_rms))
        if local_peak < 0.015:
            continue
        active_mask = (local_rms >= max(0.014, local_peak * 0.18)) | ((local_rms >= 0.008) & (local_zcr >= 0.24))
        active_idx = np.where(active_mask)[0]
        if active_idx.size == 0:
            continue
        speech_onset = (f0 + int(active_idx[0])) * hop_len / float(sample_rate)
        speech_offset = min(total_dur, ((f0 + int(active_idx[-1])) * hop_len + frame_len) / float(sample_rate))
        active_span_dur = max(0.0, speech_offset - speech_onset)

        # Trigger A: Double-burst voiced syllable restart inside the word span
        trigger_a = False
        best_burst_meta = ""
        min_trig_a_dur = 0.34 if expected_syl == 1 else (0.20 * expected_syl + 0.22)
        if active_span_dur >= min_trig_a_dur:
            local_bursts: list[dict[str, Any]] = []
            in_b = False
            b_st_i = f0
            for fi in range(f0, f1):
                if rms_frames[fi] >= speech_thresh:
                    if not in_b:
                        in_b = True
                        b_st_i = fi
                elif in_b:
                    in_b = False
                    bdur = (fi - b_st_i) * hop_len / float(sample_rate)
                    if 0.04 <= bdur <= 0.36:
                        z_v, sp_v, fm_v = _burst_spec_and_formant(b_st_i * hop_len, fi * hop_len + frame_len)
                        if z_v < 0.22:
                            local_bursts.append({
                                "start_idx": b_st_i,
                                "end_idx": fi,
                                "peak_rms": float(np.max(rms_frames[b_st_i:fi])),
                                "spec": sp_v,
                                "formant": fm_v,
                            })
            if in_b:
                bdur = (f1 - b_st_i) * hop_len / float(sample_rate)
                if 0.04 <= bdur <= 0.36:
                    z_v, sp_v, fm_v = _burst_spec_and_formant(b_st_i * hop_len, f1 * hop_len + frame_len)
                    if z_v < 0.22:
                        local_bursts.append({
                            "start_idx": b_st_i,
                            "end_idx": f1,
                            "peak_rms": float(np.max(rms_frames[b_st_i:f1])),
                            "spec": sp_v,
                            "formant": fm_v,
                        })
            if len(local_bursts) >= expected_syl + 1:
                for bi in range(len(local_bursts) - 1):
                    lb1, lb2 = local_bursts[bi], local_bursts[bi + 1]
                    val_sec = (lb2["start_idx"] - lb1["end_idx"]) * hop_len / float(sample_rate)
                    if not (0.015 <= val_sec <= 0.28):
                        continue
                    gap_r = rms_frames[lb1["end_idx"]:lb2["start_idx"]]
                    if gap_r.size == 0:
                        continue
                    min_gap = float(np.min(gap_r))
                    min_pk = min(lb1["peak_rms"], lb2["peak_rms"])
                    cos_s = float(np.dot(lb1["spec"], lb2["spec"]))
                    f_s = float(np.dot(lb1["formant"], lb2["formant"]))
                    if min_gap <= 0.18 * min_pk and cos_s >= 0.90 and f_s >= 0.86:
                        trigger_a = True
                        best_burst_meta = f"double_burst cos={cos_s:.2f} formant={f_s:.2f} valley={val_sec:.2f}s"
                        break

        # Trigger B: Low/moderate-confidence stretched or glottal-cut content word
        trigger_b = False
        vcut_sec = 0.0
        if len(sw) >= 4 and not trigger_a:
            if w_prob < 0.55:
                trigger_b = True
            elif w_prob < 0.80:
                vcut_sec = _voice_cut_sec(mono, sample_rate, speech_onset + 0.05, speech_offset - 0.03, threshold=0.004)
                if (
                    active_span_dur >= max(0.56, 0.28 * expected_syl + 0.10)
                    or w_dur >= max(0.72, 0.34 * expected_syl + 0.24)
                    or vcut_sec >= 0.045
                ):
                    trigger_b = True

        if trigger_a or trigger_b:
            candidates.append({
                "priority": (0 if trigger_a else 1, w_prob),
                "src_idx": src_idx,
                "asr_idx": asr_idx,
                "sw": sw,
                "w_st": w_st,
                "w_en": w_en,
                "w_prob": w_prob,
                "speech_onset": speech_onset,
                "speech_offset": speech_offset,
                "expected_syl": expected_syl,
                "trigger_a": trigger_a,
                "meta": best_burst_meta if trigger_a else f"stretched_or_cut prob={w_prob:.2f} vcut={vcut_sec:.3f}s",
            })

    if not candidates:
        return []

    candidates.sort(key=lambda c: c["priority"])
    verified_issues: list[dict[str, Any]] = []
    lang_code = None if not language or language == "auto" else language

    import tempfile
    import soundfile as sf

    for cand in candidates:
        if slice_budget is not None and slice_budget[0] <= 0:
            break
        src_idx = cand["src_idx"]
        sw = cand["sw"]
        speech_onset = float(cand["speech_onset"])
        speech_offset = float(cand["speech_offset"])
        w_en = float(cand["w_en"])
        t_clip0 = max(0.0, speech_onset - 0.06)
        t_clip1 = min(total_dur, max(w_en, speech_offset) + 0.12)
        s0 = max(0, int(round(t_clip0 * sample_rate)))
        s1 = min(mono.size, int(round(t_clip1 * sample_rate)))
        if s1 - s0 < int(0.15 * sample_rate):
            continue

        pad = np.zeros(int(0.18 * sample_rate), dtype=np.float32)
        isolated_clip = np.concatenate([pad, mono[s0:s1], pad])

        if slice_budget is not None:
            slice_budget[0] -= 1
        if secondary_reasons is not None:
            secondary_reasons.append(f"stutter_slice:{sw}")

        fd, tmp_slice_path = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        slice_words: list[tuple[str, str, float]] = []
        try:
            sf.write(tmp_slice_path, isolated_clip, sample_rate, subtype="PCM_16")
            try:
                seg_iter, _ = whisper_model.transcribe(
                    tmp_slice_path,
                    language=lang_code,
                    beam_size=5,
                    word_timestamps=True,
                    vad_filter=False,
                    condition_on_previous_text=False,
                )
            except TypeError:
                seg_iter, _ = whisper_model.transcribe(
                    tmp_slice_path,
                    language=lang_code,
                    beam_size=5,
                    word_timestamps=True,
                    vad_filter=False,
                )
            slice_words = [
                (str(w.word).strip(), clean_word(str(w.word)), float(getattr(w, "probability", 0.8)))
                for seg in seg_iter
                for w in (getattr(seg, "words", None) or [])
                if getattr(w, "word", None) and clean_word(str(w.word))
            ]
        except Exception:
            continue
        finally:
            if os.path.exists(tmp_slice_path):
                try:
                    os.remove(tmp_slice_path)
                except Exception:
                    pass

        if not slice_words:
            continue

        prev_src = source_words_clean[src_idx - 1] if src_idx > 0 else ""
        prev2_src = source_words_clean[src_idx - 2] if src_idx >= 2 else ""
        next_src = source_words_clean[src_idx + 1] if (src_idx + 1) < len(source_words_clean) else ""
        next2_src = source_words_clean[src_idx + 2] if (src_idx + 2) < len(source_words_clean) else ""

        def _is_neighbor_bleed(tok_c: str, neighbor_c: str) -> bool:
            if not neighbor_c or not tok_c:
                return False
            if _is_numeric_scope_word(neighbor_c) or _is_numeric_scope_word(tok_c):
                return _is_numeric_scope_word(neighbor_c) and _is_numeric_scope_word(tok_c)
            if are_words_equivalent(tok_c, neighbor_c) or _is_minor_word_variant(tok_c, neighbor_c):
                return True
            return False

        def _is_edge_truncated_bleed(raw_tok: str, tok_c: str, neighbor_c: str) -> bool:
            if _is_neighbor_bleed(tok_c, neighbor_c):
                return True
            if not tok_c or not neighbor_c:
                return False
            if len(neighbor_c) == 1 and tok_c == neighbor_c:
                return True
            # Whisper censored profanity hallucination on truncated consonant onset (e.g. 'f***ing' from 'force')
            if "*" in raw_tok and tok_c[0] == neighbor_c[0]:
                return True
            # Silent-'h' vowel-onset neighbors ('hour', 'honest', 'honor', 'heir') bleeding a short vowel fragment ('app', 'at', 'out')
            if neighbor_c.startswith(("hour", "honest", "honor", "heir")) and tok_c[0] in "aeiou":
                return True
            if len(tok_c) < 2 or len(neighbor_c) < 3:
                return False
            pk_t = phonetic_key(tok_c)
            pk_n = phonetic_key(neighbor_c)
            return neighbor_c.startswith(tok_c[:2]) or (len(pk_t) >= 2 and pk_n.startswith(pk_t[:2]))

        def _matches_target_word(tok_c: str) -> bool:
            return bool(tok_c) and (
                are_words_equivalent(sw, tok_c)
                or _is_minor_word_variant(sw, tok_c)
                or phonetic_key(sw) == phonetic_key(tok_c)
            )

        # Trim edge neighbor bleed tokens (including 2-word bleed when Large V3 stretches w_en across
        # a short function word into the onset of next2_src, or truncated/censored neighbor onset bleed)
        trimmed_slice = list(slice_words)
        if (
            len(trimmed_slice) >= 3
            and _is_edge_truncated_bleed(trimmed_slice[0][0], trimmed_slice[0][1], prev2_src)
            and _is_neighbor_bleed(trimmed_slice[1][1], prev_src)
        ):
            trimmed_slice = trimmed_slice[2:]
        elif len(trimmed_slice) >= 2 and (
            _is_neighbor_bleed(trimmed_slice[0][1], prev_src)
            or (
                len(trimmed_slice) == 2
                and _matches_target_word(trimmed_slice[1][1])
                and _is_edge_truncated_bleed(trimmed_slice[0][0], trimmed_slice[0][1], prev_src)
            )
        ):
            trimmed_slice = trimmed_slice[1:]

        if (
            len(trimmed_slice) >= 3
            and _is_edge_truncated_bleed(trimmed_slice[-1][0], trimmed_slice[-1][1], next2_src)
            and _is_neighbor_bleed(trimmed_slice[-2][1], next_src)
        ):
            trimmed_slice = trimmed_slice[:-2]
        elif len(trimmed_slice) >= 2 and (
            _is_neighbor_bleed(trimmed_slice[-1][1], next_src)
            or (
                len(trimmed_slice) == 2
                and _matches_target_word(trimmed_slice[0][1])
                and _is_edge_truncated_bleed(trimmed_slice[-1][0], trimmed_slice[-1][1], next_src)
            )
        ):
            trimmed_slice = trimmed_slice[:-1]
        if not trimmed_slice:
            continue
        if len(trimmed_slice) == 1 and not _matches_target_word(trimmed_slice[0][1]) and (
            _is_neighbor_bleed(trimmed_slice[0][1], prev_src)
            or _is_neighbor_bleed(trimmed_slice[0][1], next_src)
        ):
            # Timestamp shift on Large V3 placed the isolated slice on the adjacent word cleanly
            continue

        # Step 1: Explicit syllable restart / duplicate inside the isolated slice (e.g. 'Da -day', 'day day')
        confirmed_stutter = False
        confirmed_whole_word_repeat = False
        for idx_s in range(len(trimmed_slice) - 1):
            raw_a, cln_a, _ = trimmed_slice[idx_s]
            raw_b, cln_b, _ = trimmed_slice[idx_s + 1]
            if cln_a == cln_b:
                confirmed_stutter = True
                if not raw_a.startswith("-") and not raw_b.startswith("-") and are_words_equivalent(sw, cln_a):
                    confirmed_whole_word_repeat = True
                break
            if len(cln_a) >= 2 and sw.startswith(cln_a) and (
                are_words_equivalent(sw, cln_b) or raw_b.startswith("-")
            ):
                confirmed_stutter = True
                break
            if len(cln_b) >= 2 and sw.endswith(cln_b) and are_words_equivalent(sw, cln_a):
                confirmed_stutter = True
                break
        if (
            not confirmed_stutter
            and cand["trigger_a"]
            and cand["expected_syl"] == 1
            and len(sw) >= 3
            and sw not in EN_MINOR_STOPWORDS
            and len(trimmed_slice) >= 2
            and any(are_words_equivalent(sw, c_tok) for _, c_tok, _ in trimmed_slice)
            and any(
                c_tok
                and not are_words_equivalent(sw, c_tok)
                and (
                    (len(c_tok) >= 2 and (sw.startswith(c_tok[:2]) or sw.endswith(c_tok[-2:])))
                    or (phonetic_key(sw)[:1] and phonetic_key(sw)[:1] == phonetic_key(c_tok)[:1])
                )
                for _, c_tok, _ in trimmed_slice
            )
        ):
            confirmed_stutter = True

        # Step 2: Clear candidate if isolated slice cleanly recognizes the target word without stutter
        if not confirmed_stutter:
            joined_clean = "".join(c_tok for _, c_tok, _ in trimmed_slice)
            if len(trimmed_slice) >= 2 and (
                are_words_equivalent(sw, joined_clean) or _is_minor_word_variant(sw, joined_clean)
            ):
                continue
            matched_cleanly = False
            for _, cln_cand, p_cand in trimmed_slice:
                if p_cand < 0.20:
                    continue
                if (
                    are_words_equivalent(sw, cln_cand)
                    or _is_minor_word_variant(sw, cln_cand)
                    or phonetic_key(sw) == phonetic_key(cln_cand)
                    or cln_cand in (sw + "s", sw + "d", sw + "ed")
                    or sw in (cln_cand + "s", cln_cand + "d", cln_cand + "ed")
                    or (prev_src and cln_cand == prev_src + sw)
                    or (next_src and cln_cand == sw + next_src)
                    or (
                        len(trimmed_slice) == 1
                        and min(len(sw), len(cln_cand)) >= 6
                        and (
                            sw[:5] == cln_cand[:5]
                            or (
                                sw[:4] == cln_cand[:4]
                                and levenshtein_dist(sw, cln_cand) <= 2
                                and _estimate_expected_syllables(sw) == _estimate_expected_syllables(cln_cand)
                            )
                        )
                    )
                ):
                    matched_cleanly = True
                    break
            if matched_cleanly:
                continue

            # Step 3: Isolated slice heard a non-equivalent garble / multi-word distortion (e.g. 'test lists' for "Tesla's").
            # Only flag unconfirmed garbles on content words whose primary ASR confidence was already degraded (< 0.82).
            if float(cand["w_prob"]) >= 0.82 or len(sw) < 4 or sw in EN_MINOR_STOPWORDS:
                continue
            max_slice_prob = max(p_c for _, _, p_c in trimmed_slice)
            if max_slice_prob < 0.30:
                continue

        obs_phrase = " ".join(
            re.sub(r"^[^\w\u00C0-\u1EF9-]+|[^\w\u00C0-\u1EF9]+$", "", r_tok) or c_tok
            for r_tok, c_tok, _ in trimmed_slice
        ).strip()
        src_display = source_words[src_idx].strip(" ,.;:!?\"'()") or sw
        t_issue_start = round(speech_onset, 3)
        t_issue_end = round(max(w_en, speech_offset), 3)
        ts = format_timestamp(t_issue_start)
        issue_code = "REPEATED_WORD" if confirmed_whole_word_repeat else "SUSPECTED_STUTTER"
        issue_msg = (
            f'Nghi vấn đọc lặp từ "{src_display}" (tách riêng nghe thành "{obs_phrase}") — khoảng {ts}. Vui lòng nghe lại.'
            if confirmed_whole_word_repeat
            else (
                f'Nghi vấn vấp âm hoặc phát âm méo tại từ "{src_display}" '
                f'(tách riêng nghe thành "{obs_phrase}") — khoảng {ts}. Vui lòng nghe lại.'
            )
        )
        verified_issues.append({
            "severity": "warning",
            "code": issue_code,
            "message": issue_msg,
            "words": [sw],
            "timeRange": [t_issue_start, t_issue_end],
            "sourceExcerpt": src_display,
            "asrRawExcerpt": obs_phrase,
            "asrNormalizedExcerpt": " ".join(c_tok for _, c_tok, _ in trimmed_slice),
            "tokenSource": "secondary_slice_asr",
            "evidence": f"{cand['meta']}; isolated_asr='{obs_phrase}'",
        })

    return verified_issues



def _estimate_expected_syllables(token: str) -> int:
    """Rough upper-bound syllable estimate for a single clean word."""
    t = strip_tones_keep_vowels(clean_word(token))
    if not t:
        return 1
    groups = re.findall(r"[aeiouyăâêôơư]+", t)
    count = len(groups)
    is_consonant_le = bool(t.endswith("le") and len(t) >= 3 and t[-3] not in "aeiouyăâêôơư")
    is_consonant_les = bool(t.endswith("les") and len(t) >= 4 and t[-4] not in "aeiouyăâêôơư")
    if t.endswith("e") and not is_consonant_le and not t.endswith(("ee", "ie", "oe", "ye")) and count > 1:
        count -= 1
    elif t.endswith("ed") and len(t) > 3 and not t.endswith(("ted", "ded", "ied", "eed")) and count > 1:
        count -= 1
    elif t.endswith("es") and len(t) > 3 and not is_consonant_les and not t.endswith(("ses", "zes", "xes", "ches", "shes", "ies", "ees")) and count > 1:
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
    e.g. Te-(gap)-sla, Te-xì-la, twenty-(gap)-five, or a broken short word.
    Excludes inter-word boundary pauses absorbed into Whisper's word window and normal
    consonant-cluster energy peaks (e.g. 'platforms', 'cycles', 'spend', 'Xpeng', 'blocks', 'pounds').
    """
    if sample_rate <= 0 or audio_data.size < sample_rate // 2:
        return []
    raw_src_words = tokenize_text_with_delimiters(source_text)[0]
    source_tokens = {clean_word(w) for w in raw_src_words if clean_word(w)}
    source_canonicals = {s.canonical for s in collapse_number_tokens(raw_src_words)}
    if not source_tokens and not source_canonicals:
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
        if not token or len(token) < 2 or float(word.get("probability", 1.0)) < 0.20:
            continue
        has_digit = bool(re.search(r"\d", token))
        # Only single-word numbers (1-2 digits like 10..20, 30, 40, 50, 60, 70, 80, 90) are single words;
        # multi-digit numbers ('2026', '400') and alphanumeric codes ('88s6p') are multi-word phrases.
        is_single_word_num = bool(
            re.fullmatch(r"\d{1,2}", token)
            and (int(token) <= 20 or int(token) % 10 == 0)
        )
        if has_digit and not is_single_word_num:
            continue
        is_numeric_tok = is_single_word_num
        is_short_tok = len(token) < 4
        in_source = (
            token in source_tokens
            or token in source_canonicals
            or any(are_words_equivalent(token, st) for st in source_tokens)
        )
        if not in_source and not is_numeric_tok:
            continue

        start_sec = float(word.get("startSec", 0.0))
        end_sec = float(word.get("endSec", 0.0))
        expected_syl = 2 if is_numeric_tok else _estimate_expected_syllables(token)
        # When a multi-syllable word (>= 2 syllables) was truncated by a mid-word break and the next
        # ASR word absorbed the remaining syllables without an attributed inter-word pause, extend end_sec:
        if (
            expected_syl >= 2
            and not is_numeric_tok
            and (end_sec - start_sec) <= 0.36
            and (w_idx + 1) < len(asr_words)
        ):
            next_s = float(asr_words[w_idx + 1].get("startSec", end_sec))
            next_e = float(asr_words[w_idx + 1].get("endSec", next_s))
            next_tok = clean_word(str(asr_words[w_idx + 1].get("word", "")))
            next_syl = _estimate_expected_syllables(next_tok) if next_tok else 1
            has_inter = any(abs(b_s - end_sec) <= 0.16 or abs(b_e - next_s) <= 0.16 for b_s, b_e in inter_word_intervals)
            if not has_inter and (next_e - next_s) >= (0.28 * next_syl + 0.36):
                end_sec = min(next_e, end_sec + 0.42)
        dur_sec = end_sec - start_sec
        min_word_dur = 0.48 if (is_short_tok or is_numeric_tok) else 0.38
        if not (min_word_dur <= dur_sec <= 3.5):
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
        zcr_limit = 0.16 if (is_short_tok or is_numeric_tok) else 0.20
        is_quiet = (rms < silence_ceiling) & (zcrs < zcr_limit)
        eff_min_gap = max(0.16, 0.18 / eff_speed) if (is_short_tok or is_numeric_tok) else min_gap
        min_frames = max(1, int(np.ceil(eff_min_gap * sample_rate / hop)))
        expected_syl = 2 if is_numeric_tok else _estimate_expected_syllables(token)
        req_active_frames = 11 if (is_short_tok or is_numeric_tok) else 8
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

                before = rms[max(0, run_start - 14):run_start]
                after = rms[run_end:min(len(rms), run_end + 14)]
                active_before = int(np.sum(before >= baseline * 0.30))
                active_after = int(np.sum(after >= baseline * 0.30))

                # Skip if this silent run overlaps an inter-word boundary pause
                is_boundary_pause = any(
                    min(gap_end, b_e + 0.03) - max(gap_start, b_s - 0.03) >= 0.08
                    for b_s, b_e in inter_word_intervals
                )
                has_strong_both_syllables = (
                    expected_syl >= 2
                    and active_before >= 8
                    and active_after >= 7
                    and before.size > 0
                    and after.size > 0
                    and float(np.max(before)) >= baseline * 0.55
                    and float(np.max(after)) >= baseline * 0.55
                )
                # Also skip if multi-word utterance and gap is near word edge without sustained syllables on both sides
                if len(asr_words) > 1 and not has_strong_both_syllables and (
                    (w_idx > 0 and (gap_start - start_sec) <= 0.18 and active_before < 12)
                    or (w_idx + 1 < len(asr_words) and (end_sec - gap_end) <= 0.18 and active_after < 12)
                    or (expected_syl == 1 and (end_sec - gap_end) <= 0.24 and active_after < 11)
                ):
                    is_boundary_pause = True
                min_edge_sec = 0.10 if has_strong_both_syllables else 0.14
                req_after_frames = 7 if has_strong_both_syllables else req_active_frames
                if (
                    not is_boundary_pause
                    and run_end - run_start >= min_frames
                    and run_start * hop / sample_rate >= min_edge_sec
                    and (len(rms) - run_end) * hop / sample_rate >= min_edge_sec
                    and active_before >= req_active_frames
                    and active_after >= req_after_frames
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
            min_stretched_dur = max(0.58, (0.28 * expected_syl + 0.04) / eff_speed)
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
                        if idx - b_start >= 8:  # >= 80ms sustained vowel nucleus
                            if bursts and int(np.sum(deep_valley_mask[bursts[-1][1]:b_start])) < 5:
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
    slice_budget: list[int] | None = None,
    audio_data: np.ndarray | None = None,
    sample_rate: int = 0,
    secondary_reasons: list[str] | None = None,
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
    if audio_data is not None and sample_rate > 0:
        mono = audio_data
        sr = sample_rate
    else:
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
            if slice_budget is not None and slice_budget[0] <= 0:
                break
            if slice_budget is not None:
                slice_budget[0] -= 1
            if secondary_reasons is not None:
                secondary_reasons.append("trailing_gap_recovery" if is_trailing else "boundary_gap_recovery")
            tmp_wav = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
            tmp_wav_name = tmp_wav.name
            tmp_wav.close()
            try:
                sf.write(tmp_wav_name, slice_audio, sr, subtype="PCM_16")
                lang_code = None if not language or language == "auto" else language
                try:
                    seg_iter, _ = whisper_model.transcribe(
                        tmp_wav_name,
                        language=lang_code,
                        beam_size=5,
                        word_timestamps=True,
                        vad_filter=False,
                        condition_on_previous_text=False,
                    )
                except TypeError:
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
    norm_lang = language
    if isinstance(language, str) and language.strip():
        raw_l = language.strip()
        if raw_l.lower() != "auto":
            norm_lang = raw_l.split("-")[0].split("_")[0].lower() or raw_l
        else:
            norm_lang = "auto"
    if not text or not text.strip():
        return norm_lang
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
    return norm_lang


_RECENT_PRIMARY_ASR_CACHE: dict[tuple[str, int, int, str, str], list[dict[str, Any]]] = {}


def cache_primary_asr_words(
    audio_path: str,
    model_id: str | None,
    language: str | None,
    words: list[dict[str, Any]],
) -> None:
    """Stores recently aligned primary ASR words keyed by exact file stat + model_id so post-synthesis
    punctuation shaping and immediate Post-QC validation never run Whisper twice on the same WAV.
    """
    if not audio_path or not words:
        return
    try:
        st = os.stat(audio_path)
        key = (
            os.path.abspath(audio_path),
            int(st.st_mtime_ns),
            int(st.st_size),
            str(model_id or "").lower(),
            str(language or ""),
        )
        if len(_RECENT_PRIMARY_ASR_CACHE) >= 256:
            _RECENT_PRIMARY_ASR_CACHE.pop(next(iter(_RECENT_PRIMARY_ASR_CACHE)), None)
        _RECENT_PRIMARY_ASR_CACHE[key] = [dict(w) for w in words]
    except Exception:
        pass


def get_cached_primary_asr_words(
    audio_path: str,
    model_id: str | None,
    language: str | None,
) -> list[dict[str, Any]] | None:
    if not audio_path:
        return None
    try:
        st = os.stat(audio_path)
        key = (
            os.path.abspath(audio_path),
            int(st.st_mtime_ns),
            int(st.st_size),
            str(model_id or "").lower(),
            str(language or ""),
        )
        hit = _RECENT_PRIMARY_ASR_CACHE.get(key)
        return [dict(w) for w in hit] if hit else None
    except Exception:
        return None


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

    # Step 1: Technical Audio Validation (loads waveform once into memory)
    t_stage0 = time.perf_counter()
    valid, tech_issues, info = validate_audio_file(audio_path, text)
    cached_mono = info.pop("_mono", None)
    t_tech_ms = round((time.perf_counter() - t_stage0) * 1000.0, 2)
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

    from .asr_engine import (
        resolve_whisper_model_dir,
        find_whisper_model_dir,
        get_shared_whisper_model,
        AsrLifecycleManager,
        DEFAULT_TTS_VAD_PARAMETERS,
        _is_cuda_runtime_error,
    )

    target_model_dir, canonical_id = resolve_whisper_model_dir(model_id, models_dir)
    if not target_model_dir:
        target_model_dir = find_whisper_model_dir(models_dir, model_id)
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
        qc_hotwords = extract_qc_vocabulary_hotwords(
            text, language=eff_language, pronunciation_mapping=pronunciation_mapping
        )

        def _invoke_whisper_transcribe(model_obj: Any, use_vad: bool) -> Any:
            kw_extra: dict[str, Any] = {"condition_on_previous_text": False}
            if qc_hotwords:
                kw_extra["hotwords"] = qc_hotwords
            try:
                if use_vad:
                    return model_obj.transcribe(
                        audio_path,
                        language=lang_code,
                        beam_size=5,
                        word_timestamps=True,
                        vad_filter=True,
                        vad_parameters=dict(DEFAULT_TTS_VAD_PARAMETERS),
                        **kw_extra,
                    )
                return model_obj.transcribe(
                    audio_path,
                    language=lang_code,
                    beam_size=5,
                    word_timestamps=True,
                    vad_filter=False,
                    **kw_extra,
                )
            except TypeError:
                try:
                    return model_obj.transcribe(
                        audio_path,
                        language=lang_code,
                        beam_size=5,
                        word_timestamps=True,
                        vad_filter=use_vad,
                        condition_on_previous_text=False,
                    )
                except TypeError:
                    return model_obj.transcribe(
                        audio_path,
                        language=lang_code,
                        beam_size=5,
                        word_timestamps=True,
                        vad_filter=use_vad,
                    )

        cached_primary = (
            get_cached_primary_asr_words(audio_path, active_model_id, lang_code)
            or get_cached_primary_asr_words(audio_path, canonical_id, lang_code)
        )
        detected_words: list[dict[str, Any]] = []
        if cached_primary is not None:
            detected_words = cached_primary
        else:
            try:
                segments_iter, _ = _invoke_whisper_transcribe(whisper_model, True)
                segments_iter = list(segments_iter)
            except Exception as inf_err:
                if _is_cuda_runtime_error(inf_err):
                    log(f"[audio_quality] CUDA inference error ({inf_err}); switching ASR to CPU / int8")
                    mgr = AsrLifecycleManager.get_instance()
                    whisper_model = mgr.get_or_load(
                        model_dir_or_id=target_model_dir,
                        models_dir=models_dir,
                        device="cpu",
                        compute_type="int8",
                    )
                    segments_iter, _ = _invoke_whisper_transcribe(whisper_model, True)
                    segments_iter = list(segments_iter)
                else:
                    raise

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
                    seg_retry, _ = _invoke_whisper_transcribe(whisper_model, False)
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

        dynamic_core_budget = max(
            CORE_SECONDARY_SLICE_CHECKS + 1,
            min(5, 1 + int(np.ceil(max(1.0, dur) / 10.0))),
        )
        shared_slice_budget = [dynamic_core_budget]
        shared_secondary_reasons: list[str] = []

        # Reuse waveform loaded during validate_audio_file (zero redundant disk reads)
        data_wave = cached_mono
        sr_wave = int(info.get("sampleRate", 16000) or 16000)
        if data_wave is None:
            try:
                import soundfile as sf
                data_raw, sr_wave = sf.read(audio_path, dtype="float32", always_2d=True)
                data_wave = data_raw.mean(axis=1)
            except Exception as rd_err:
                log(f"[audio_quality] Cannot read audio waveform: {rd_err}")

        # Re-anchor Whisper DTW word timestamps onto true waveform boundaries BEFORE gap recovery
        # (so Large V3's systematic left-shift is corrected using untouched primary timestamps)
        if cached_primary is None:
            detected_words = reanchor_asr_word_timestamps(
                detected_words, data_wave, sr_wave, text=text
            )
            detected_words = recover_unaligned_words(
                audio_path,
                detected_words,
                dur,
                whisper_model,
                language=eff_language,
                slice_budget=shared_slice_budget,
                audio_data=data_wave,
                sample_rate=sr_wave,
                secondary_reasons=shared_secondary_reasons,
            )
            cache_primary_asr_words(audio_path, active_model_id, lang_code, detected_words)
        t_primary_asr_ms = round((time.perf_counter() - t_stage0) * 1000.0 - t_tech_ms, 2)

        t_env0 = time.perf_counter()
        shared_envelope = compute_acoustic_envelope(data_wave, sr_wave) if (data_wave is not None and sr_wave > 0) else None
        t_env_ms = round((time.perf_counter() - t_env0) * 1000.0, 2)

        t_align0 = time.perf_counter()
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
            slice_budget=shared_slice_budget,
            secondary_reasons=shared_secondary_reasons,
            core_scope=True,
        )
        t_align_ms = round((time.perf_counter() - t_align0) * 1000.0, 2)

        # Step 3: Acoustic Stutter Check (waveform + ASR corroboration + isolated slice verification)
        t_stut0 = time.perf_counter()
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
                alignment_issues.extend(acoustic_stutters)
            except Exception as st_err:
                log(f"[audio_quality] Acoustic stutter check error: {st_err}")
            try:
                smoothed_stutters = verify_whisper_smoothed_stutters(
                    text=text,
                    asr_words=detected_words,
                    audio_data=data_wave,
                    sample_rate=sr_wave,
                    whisper_model=whisper_model,
                    language=eff_language,
                    slice_budget=shared_slice_budget,
                    secondary_reasons=shared_secondary_reasons,
                    pronunciation_mapping=pronunciation_mapping,
                    pronunciation_rules=pronunciation_rules,
                )
                alignment_issues.extend(smoothed_stutters)
            except Exception as sm_err:
                log(f"[audio_quality] Smoothed stutter slice check error: {sm_err}")
        t_stut_ms = round((time.perf_counter() - t_stut0) * 1000.0, 2)
        metrics["secondaryWhisperCalls"] = max(0, dynamic_core_budget - int(shared_slice_budget[0]))
        metrics["secondaryWhisperReasons"] = list(shared_secondary_reasons)

        # Intra-word pause / broken-syllable detection is outside the core defect scope (v3.5.0) and is skipped.
        # The legacy prosody analyzer's pause findings are discarded here by the core-scope reduction.
        alignment_issues = _deduplicate_quality_issues(alignment_issues)
        alignment_issues = _reduce_to_core_defects(alignment_issues, detected_words)

        # Step 4: Breaks inside word groups that must be read together (phrase-internal abnormal pauses)
        t_pause0 = time.perf_counter()
        if data_wave is not None and sr_wave > 0:
            try:
                alignment_issues.extend(
                    detect_phrase_internal_pauses(text, detected_words, data_wave, sr_wave, speed=speed)
                )
            except Exception as pause_err:
                log(f"[audio_quality] Phrase pause check failed: {pause_err}")
            try:
                # Step 5: Comma pause moved one word too early ('Every single | month, seventy')
                misplaced_issues = detect_misplaced_punctuation_pauses(text, detected_words, data_wave, sr_wave)
                alignment_issues.extend(misplaced_issues)
            except Exception as misplaced_err:
                misplaced_issues = []
                log(f"[audio_quality] Misplaced pause check failed: {misplaced_err}")
            try:
                # Step 6: Clause-dividing comma/semicolon/colon rushed straight through without pausing
                skipped_issues = detect_skipped_clause_pauses(text, detected_words, data_wave, sr_wave, speed=speed)
                for sk_iss in skipped_issues:
                    sk_words = sk_iss.get("words") or []
                    if sk_words and any(sk_words[0] in (mp.get("words") or []) for mp in misplaced_issues):
                        continue
                    alignment_issues.append(sk_iss)
            except Exception as skipped_err:
                log(f"[audio_quality] Skipped clause pause check failed: {skipped_err}")
        t_pause_ms = round((time.perf_counter() - t_pause0) * 1000.0, 2)
        for iss in alignment_issues:
            iss["asrModelId"] = active_model_id

        alignment_issues.sort(key=lambda x: float(x.get("timeRange", [0.0])[0]))
        metrics["timingMs"] = {
            "technicalMs": t_tech_ms,
            "primaryAsrMs": t_primary_asr_ms,
            "envelopeMs": t_env_ms,
            "alignmentMs": t_align_ms,
            "stutterMs": t_stut_ms,
            "phrasePauseMs": t_pause_ms,
            "totalMs": round((time.perf_counter() - t_stage0) * 1000.0, 2),
        }

        error_issues = [i for i in alignment_issues if i.get("severity") == "error"]
        warning_issues = [i for i in alignment_issues if i.get("severity") == "warning"]
        unverified_issues = [i for i in alignment_issues if i.get("severity") == "unverified"]

        if error_issues:
            return {
                "status": "error",
                "issues": alignment_issues,
                "metrics": metrics,
                "summary": error_issues[0]["message"],
                "durationSec": dur,
                "sampleRate": info.get("sampleRate", 0),
                "checkedAt": checked_at,
                "audioPath": audio_path,
                "asrModelId": active_model_id,
            }
        elif warning_issues:
            return {
                "status": "warning",
                "issues": alignment_issues,
                "metrics": metrics,
                "summary": warning_issues[0]["message"],
                "durationSec": dur,
                "sampleRate": info.get("sampleRate", 0),
                "checkedAt": checked_at,
                "audioPath": audio_path,
                "asrModelId": active_model_id,
            }
        elif unverified_issues:
            return {
                "status": "unverified",
                "issues": alignment_issues,
                "metrics": metrics,
                "summary": unverified_issues[0]["message"],
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
