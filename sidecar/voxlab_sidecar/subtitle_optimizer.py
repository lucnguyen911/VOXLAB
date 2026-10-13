"""YouTube Cinematic Subtitle Optimizer for VoxLab (ASR Word-Timestamp + Global DP + Protected Spans).

Pipeline:
Master Audio -> ASR (word_timestamps=True) -> Script-Assisted Orthographic Recovery ->
Protected Spans -> Semantic & Grammar Scoring -> Global DP -> 1-2 Line Balanced Wrapping ->
Acoustic Onset Alignment (-30 dBFS) -> Hard Invariant Validation -> SRT Export.
"""
from __future__ import annotations

import difflib
import hashlib
import logging
import math
import os
import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from .number_normalizer import collapse_number_tokens

logger = logging.getLogger(__name__)


class SubtitleOptimizationError(Exception):
    """Raised when subtitle segmentation violates a hard invariant."""


@dataclass(frozen=True)
class LayoutProfile:
    format_id: str
    max_lines: int
    target_width: int
    max_width: int
    max_cue_chars: int
    target_words: int
    max_words: int
    min_duration: float
    target_duration: float
    max_duration: float
    target_cps: float
    max_cps: float
    soft_pause: float
    preferred_pause: float
    hard_pause: float


# YouTube Cinematic Subtitle Profiles (Section 3.3)
PROFILES: Dict[Tuple[str, int], LayoutProfile] = {
    ("16:9", 1): LayoutProfile(
        format_id="16:9",
        max_lines=1,
        target_width=29,
        max_width=32,
        max_cue_chars=32,
        target_words=6,
        max_words=10,
        min_duration=0.85,
        target_duration=2.2,
        max_duration=6.0,
        target_cps=15.0,
        max_cps=20.0,
        soft_pause=0.25,
        preferred_pause=0.45,
        hard_pause=0.80,
    ),
    ("16:9", 2): LayoutProfile(
        format_id="16:9",
        max_lines=2,
        target_width=29,
        max_width=32,
        max_cue_chars=60,
        target_words=8,
        max_words=14,
        min_duration=0.85,
        target_duration=2.8,
        max_duration=6.0,
        target_cps=15.0,
        max_cps=20.0,
        soft_pause=0.25,
        preferred_pause=0.45,
        hard_pause=0.80,
    ),
    ("1:1", 1): LayoutProfile(
        format_id="1:1",
        max_lines=1,
        target_width=25,
        max_width=29,
        max_cue_chars=29,
        target_words=5,
        max_words=9,
        min_duration=0.80,
        target_duration=2.0,
        max_duration=5.5,
        target_cps=14.5,
        max_cps=19.0,
        soft_pause=0.22,
        preferred_pause=0.40,
        hard_pause=0.75,
    ),
    ("1:1", 2): LayoutProfile(
        format_id="1:1",
        max_lines=2,
        target_width=25,
        max_width=29,
        max_cue_chars=54,
        target_words=7,
        max_words=12,
        min_duration=0.80,
        target_duration=2.5,
        max_duration=5.5,
        target_cps=14.5,
        max_cps=19.0,
        soft_pause=0.22,
        preferred_pause=0.40,
        hard_pause=0.75,
    ),
    ("9:16", 1): LayoutProfile(
        format_id="9:16",
        max_lines=1,
        target_width=21,
        max_width=26,
        max_cue_chars=26,
        target_words=4,
        max_words=7,
        min_duration=0.75,
        target_duration=1.8,
        max_duration=4.8,
        target_cps=14.0,
        max_cps=18.5,
        soft_pause=0.20,
        preferred_pause=0.35,
        hard_pause=0.65,
    ),
    ("9:16", 2): LayoutProfile(
        format_id="9:16",
        max_lines=2,
        target_width=21,
        max_width=26,
        max_cue_chars=48,
        target_words=6,
        max_words=10,
        min_duration=0.75,
        target_duration=2.2,
        max_duration=4.8,
        target_cps=14.0,
        max_cps=18.5,
        soft_pause=0.20,
        preferred_pause=0.35,
        hard_pause=0.65,
    ),
}

TERMINAL_PUNCTUATION = (".", "?", "!", "…")
CLAUSE_PUNCTUATION = (",", ";", ":", "—", "–")

DETERMINERS = {
    "a", "an", "the", "this", "that", "these", "those", "each", "every",
    "some", "any", "no", "my", "your", "his", "her", "its", "our", "their",
}
PREPOSITIONS = {
    "of", "to", "for", "with", "from", "by", "at", "in", "on", "as", "into",
    "onto", "upon", "under", "over", "between", "among", "about", "through",
    "inside", "outside", "within", "without", "against", "during", "before",
    "after", "per", "via", "toward", "towards", "across", "behind", "beyond",
}
AUXILIARIES = {
    "am", "is", "are", "was", "were", "be", "been", "being", "has", "have", "had",
    "do", "does", "did", "will", "would", "can", "could", "may", "might", "must",
    "should", "shall", "isn't", "aren't", "wasn't", "weren't", "haven't", "hasn't",
    "hadn't", "don't", "doesn't", "didn't", "won't", "wouldn't", "can't", "cannot",
    "couldn't", "shouldn't",
}
CONJUNCTIONS = {
    "and", "but", "or", "so", "because", "although", "though", "while", "when",
    "if", "unless", "whether", "yet", "than", "nor",
}
RELATIVES = {"that", "which", "who", "whom", "whose", "where", "whether"}

# Subject pronouns that can never legitimately end an unpunctuated cue or line
SUBJECT_PRONOUNS = {"i", "he", "she", "we", "they"}

# Vietnamese function words that should not dangle at the end of a cue/line
VI_FORBIDDEN_ENDINGS = {
    "và", "nhưng", "hoặc", "hay", "vì", "nên", "mà", "là", "của", "cho",
    "với", "tại", "trong", "trên", "dưới", "đến", "từ", "để", "khi", "nếu",
    "những", "các", "một", "đang", "sẽ", "đã", "vẫn", "còn", "rất", "quá",
}

FORBIDDEN_ENDINGS = (
    DETERMINERS
    | PREPOSITIONS
    | AUXILIARIES
    | CONJUNCTIONS
    | RELATIVES
    | SUBJECT_PRONOUNS
    | VI_FORBIDDEN_ENDINGS
)

CLAUSE_STARTERS = {
    "and", "but", "or", "so", "because", "although", "though", "while", "when", "if",
    "unless", "however", "therefore", "meanwhile", "instead", "before", "after", "once",
    "now", "then", "yet", "which", "where", "who",
    "và", "nhưng", "hoặc", "vì", "nên", "tuy", "khi", "nếu", "trong",
}

COMPLEMENT_TAKING = {
    "including", "excluding", "containing", "involving", "requiring", "allowing",
    "making", "using", "takes", "took", "needs", "needed", "wants", "wanted",
    "expects", "expected", "means", "meant", "called", "calls", "call", "named", "known",
    "becomes", "unsettle", "unsettles", "unsettled", "prove", "proves", "proved", "more",
    "less", "fewer", "rather", "other", "close", "next", "prior", "due", "according",
    "up", "down", "out", "instead", "capable", "full", "part", "kind", "sort", "verge",
}

QUANTIFIER_OF_HEADS = {
    "millions", "thousands", "billions", "hundreds", "trillions", "tens", "dozens",
    "tons", "lots", "plenty", "most", "all", "some", "many", "few", "none",
    "half", "majority", "number", "amount", "couple", "handful",
    "verge", "sake", "scrap", "introduction",
}

ENTITY_DESIGNATOR_HEADS = {
    "powerwall", "model", "nem", "iso", "ieee", "astm", "nfpa", "ul", "sae", "ansi", "iec",
    "iphone", "ipad", "macbook", "airpods", "galaxy", "pixel", "playstation", "xbox",
    "windows", "wifi", "wi-fi", "usb", "pcie", "ddr", "hdmi", "bluetooth", "gpt",
    "claude", "gemini", "llama", "qwen", "deepseek", "starship", "falcon", "supercharger",
    "megacharger", "megapack", "cybertruck", "optimus", "version", "ver", "tier", "phase",
    "stage", "level", "class", "category", "type", "series", "generation", "gen", "mark",
    "mk", "block", "part", "chapter", "section", "article", "title", "rule", "policy",
    "act", "bill", "prop", "proposition", "amendment", "apollo", "saturn",
}

SMALL_NUMBER_WORD_TO_DIGIT = {
    "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4", "five": "5",
    "six": "6", "seven": "7", "eight": "8", "nine": "9", "ten": "10",
    "eleven": "11", "twelve": "12", "thirteen": "13", "fourteen": "14", "fifteen": "15",
    "sixteen": "16", "seventeen": "17", "eighteen": "18", "nineteen": "19", "twenty": "20",
}

PRENOMINAL_MODIFIERS = {
    "aging", "different", "separate", "original", "ordinary", "functional", "profitable",
    "legendary", "unprofitable", "real", "actual", "entire", "everyday", "heavy",
    "repeated", "strong", "quiet", "quietly", "genuine", "genuinely", "exact", "exactly",
    "likely", "unlikely", "major", "minor", "first", "last", "next", "previous", "new",
    "old", "human", "robotic", "elderly", "friendly", "early", "single", "whole",
    "electric", "commercial", "industrial", "massive", "tiny", "huge", "global",
    "eligible", "ultimate", "predictive", "continuous", "instantaneous", "virtual",
    "solar", "stored", "wholesale", "honest", "final", "overloaded", "glowing", "surplus",
    "long", "short", "high", "low", "peak", "extra", "backup", "freezing", "soaring",
    "failing", "desperate", "equivalent",
}

VI_VERBS = {
    "mua", "bán", "đi", "về", "đến", "làm", "ăn", "uống", "nói", "nghe", "đọc", "viết",
    "chạy", "nhìn", "thấy", "biết", "hiểu", "muốn", "cần", "phải", "có", "là", "được",
    "bị", "lấy", "dùng", "tạo", "xây", "mở", "đóng", "bắt", "kết", "thử", "kiểm",
    "chuyển", "nhận", "phát", "giữ", "đặt", "mang", "đưa", "gửi", "nhớ", "quên",
    "yêu", "ghét", "sống", "chết", "ngủ", "thức", "học", "dạy", "hỏi", "trả", "giúp",
}

COMMON_VERBS = AUXILIARIES | VI_VERBS | {
    "accept", "accepted", "allow", "allows", "allowed", "appear", "appears", "arrive",
    "arrived", "ask", "asked", "become", "became", "believe", "believes", "build",
    "built", "building", "buy", "buys", "bought", "buying", "call", "called", "calls",
    "change", "changed", "changes", "charge", "charged", "come", "comes", "came",
    "coming", "connect", "connecting", "cost", "costs", "create", "created", "cut",
    "cuts", "depend", "depends", "design", "designed", "discharge", "draw", "drive",
    "drives", "drove", "driving", "end", "ends", "ended", "endure", "erase", "erased",
    "exist", "exists", "eye", "eyeing", "factor", "fight", "find", "finding", "finish",
    "finished", "function", "generate", "get", "gets", "got", "getting", "give",
    "gives", "gave", "go", "goes", "went", "gone", "handle", "handles", "happen",
    "happens", "happened", "happening", "hear", "help", "helps", "hold", "holds",
    "hope", "hoping", "install", "jack", "keep", "keeps", "kept", "know", "knows",
    "knew", "leave", "leaves", "left", "leaving", "let", "lets", "live", "lives",
    "log", "logged", "look", "looks", "looked", "love", "loved", "make", "makes",
    "made", "mean", "means", "meant", "move", "moves", "moved", "need", "needs",
    "needed", "override", "overrides", "owe", "owes", "pack", "packed", "pay", "pays",
    "paid", "paying", "place", "placing", "plan", "planning", "play", "plug", "plugged",
    "plummet", "pour", "pouring", "process", "processed", "promise", "promised",
    "prove", "proves", "proved", "pull", "pulls", "pulled", "read", "receive",
    "receives", "remember", "replace", "replaced", "run", "runs", "ran", "save",
    "saving", "say", "says", "said", "see", "sees", "saw", "seeing", "sell", "selling",
    "send", "sending", "shave", "show", "shows", "showed", "shut", "sit", "sits", "sat",
    "skyrocket", "slash", "slashed", "sound", "sounds", "sounded", "squeeze",
    "stabilize", "start", "starts", "started", "stay", "stays", "stayed", "step",
    "stop", "stops", "stopped", "strain", "straining", "struggle", "take", "takes",
    "took", "talk", "talks", "tell", "telling", "think", "thinks", "thought", "turn",
    "turns", "turned", "turning", "use", "uses", "used", "using", "wait", "waiting",
    "walk", "walked", "want", "wants", "wanted", "watch", "watched", "work", "works",
    "working", "affect", "affects", "frighten", "hide", "count", "counts",
}

NOUN_THAT_COMPLEMENTS = {
    "proof", "fact", "idea", "reason", "claim", "belief", "evidence", "argument",
    "possibility", "chance", "sign", "promise", "part", "moment", "way", "time", "answer",
}

SHORT_STANDALONE = {
    "yes", "no", "why", "hello", "hi", "okay", "ok", "stop", "wait", "really",
    "correct", "exactly", "absolutely", "thanks", "goodbye", "picture this", "next week",
    "đúng", "không", "khoan", "chờ đã", "tất nhiên", "chính xác",
}

KNOWN_PHRASES = {
    "elon musk", "tesla semi", "tesla's semi", "model s", "model x", "model y", "model 3",
    "powerwall 3", "tesla powerwall", "tesla powerwall 3", "nem 3.0", "virtual power plant",
    "lithium iron phosphate", "storm watch", "spaceX starship", "spacex starship",
    "giga texas", "giga nevada", "north america", "new york", "san francisco", "united states",
    "wall street", "general motors", "the boring company", "boring company",
    "mass production", "production line", "assembly line", "assembly lines",
    "self driving", "self-driving", "talk about", "out of", "check in", "care of",
    "close to", "many of", "more than", "less than", "fewer than", "rather than",
    "other than", "up to", "down to", "instead of", "because of", "according to",
    "due to", "thanks to", "next to", "able to", "going to", "have to", "has to",
    "had to", "need to", "needs to", "want to", "wants to", "designed to", "built to",
    "meant to", "came from", "come from", "comes from", "turning into", "turn into",
    "turned into", "shut it down", "shut down", "backed up", "back up", "on its own",
    "at the end", "in real time", "real time", "side by side", "for the first time",
    "very first time", "second quarter", "working hours", "force limiting", "hive mind",
    "product update", "know how", "dollars per month", "miles per hour", "kilowatt hour",
    "kilowatt hours", "per mile", "per hour", "per year", "per day", "per month",
    "a year", "a day", "a month", "safety net", "strong enough", "fully functional",
    "truck stop", "diesel engine", "diesel engines", "diesel truck", "diesel trucks",
    "diesel industry", "freight costs", "grocery shelves", "one single", "single piston",
    "what if", "find out", "step back", "storage tank", "surge capacity", "data trap",
    "solar panels", "solar power", "utility bills", "electric bills", "electric bill",
    "power company", "utility company", "utility companies", "game changer", "long term",
    # Vietnamese compounds
    "mô hình", "giọng nói", "hệ thống", "thử nghiệm", "nhận diện", "bóc băng",
    "sản xuất", "nội dung", "âm thanh", "thời gian", "chính xác", "tiếng việt",
    "lồng tiếng", "lập tức", "quay trở lại", "tốc độ", "xử lý", "thời gian thực",
    "hôm nay", "chúng ta", "chúng tôi", "người dùng", "trên máy", "kịch bản", "phụ đề",
    "trí tuệ", "nhân tạo", "trí tuệ nhân tạo", "sau đó", "bởi vì", "cho nên", "mặc dù",
    "tuy nhiên", "do đó", "trong khi", "đi chợ", "đi về",
}

MAX_KNOWN_PHRASE_WORDS = 4

UNIT_WORDS = {
    "percent", "%", "dollar", "dollars", "usd", "mile", "miles", "hour", "hours",
    "minute", "minutes", "second", "seconds", "day", "days", "week", "weeks",
    "month", "months", "year", "years", "volt", "volts", "watt", "watts",
    "kilowatt", "kilowatts", "megawatt", "megawatts", "gigawatt", "gigawatts",
    "kwh", "mwh", "gwh", "kw", "mw", "gw", "ghz", "mhz", "khz", "hz",
    "pound", "pounds", "lb", "lbs", "ton", "tons", "kg", "g", "mg", "km", "m",
    "cm", "mm", "mph", "km/h", "liter", "liters", "gallon", "gallons",
    "million", "billion", "trillion", "thousand", "hundred",
    "units", "vehicles", "trucks", "cars", "robots", "packs", "cells", "stations",
}

NOISY_ABBREVIATIONS = {"mr", "mrs", "ms", "dr", "prof", "st", "vs", "etc", "e.g", "i.e", "u.s", "u.k"}
NUMBER_WORDS = {
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
    "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
    "hundred", "thousand", "million", "billion", "trillion",
}

COMMON_SENTENCE_STARTERS = (
    DETERMINERS
    | PREPOSITIONS
    | AUXILIARIES
    | CONJUNCTIONS
    | RELATIVES
    | CLAUSE_STARTERS
    | PRENOMINAL_MODIFIERS
    | {
        "i", "you", "he", "she", "it", "we", "they", "there", "here", "what", "why",
        "how", "when", "where", "who", "all", "most", "many", "few", "several",
        "both", "either", "neither", "only", "even", "just", "still", "also",
        "today", "yesterday", "tomorrow", "pilot", "stay", "look", "think", "wait",
        "imagine", "instead", "homeowners", "can", "so", "for", "from", "through",
    }
)


@lru_cache(maxsize=32768)
def display_width(text: str) -> int:
    return sum(2 if unicodedata.east_asian_width(ch) in {"W", "F"} else 1 for ch in text)


def _clean_token(text: str) -> str:
    return text.lower().strip(".,;:!?…\"'“”‘’()[]{}—–- ")


def _visible_chars(text: str) -> int:
    return len(text.replace("\n", ""))


@lru_cache(maxsize=32768)
def _join_tokens_cached(tokens: Tuple[str, ...]) -> str:
    text = " ".join(token.strip() for token in tokens if token.strip())
    text = re.sub(r"\s+([,.;:!?…%])", r"\1", text)
    text = re.sub(r"([$€£])\s+(\d)", r"\1\2", text)
    text = re.sub(r"\s+-\s*", "-", text)
    text = re.sub(r"\s+(['’](?:s|t|re|ve|ll|d|m))\b", r"\1", text, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", text).strip()


def _join_tokens(tokens: Sequence[str]) -> str:
    return _join_tokens_cached(tuple(tokens))


def _display_token(word: Dict[str, Any]) -> str:
    return str(word.get("display_text", word["text"]))


def _replace_terminal_for_display(text: str, replacement: str) -> str:
    return re.sub(r"[.?!…]+(?=\s*$)", replacement, text).rstrip()


def _normalise_format(video_format: str) -> str:
    value = str(video_format or "16:9").lower().strip()
    return {"horizontal": "16:9", "vertical": "9:16", "square": "1:1"}.get(value, value)


def get_profile(video_format: str = "16:9", max_lines: int = 2) -> LayoutProfile:
    fmt = _normalise_format(video_format)
    lines = 1 if int(max_lines) == 1 else 2
    key = (fmt, lines)
    return PROFILES.get(key, PROFILES[("16:9", 2)])


def _word_text(word_obj: Any) -> str:
    if isinstance(word_obj, dict):
        value = word_obj.get("word") or word_obj.get("text") or ""
    else:
        value = getattr(word_obj, "word", "") or getattr(word_obj, "text", "")
    return re.sub(r"\s+", " ", str(value)).strip()


def _capitalize_subtitle_opening(text: str) -> str:
    for index, character in enumerate(text):
        if character.isalpha():
            return f"{text[:index]}{character.upper()}{text[index + 1:]}"
    return text


def _value(obj: Any, key: str, default: Any) -> Any:
    return obj.get(key, default) if isinstance(obj, dict) else getattr(obj, key, default)


def _is_bpe_continuation(prev_text: str, curr_text: str) -> bool:
    """Detect BPE sub-tokens produced by Whisper that belong to the previous token
    (e.g., '82' + ',000', '$290' + ',000', '13' + '.5', '70' + '%', 'Tesla' + \"'s\", '60' + '-70')."""
    prev = prev_text.strip()
    curr = curr_text.strip()
    if not prev or not curr:
        return False
    if re.fullmatch(r"[,.:]\d+[,.;:!?…%]*", curr) and re.search(r"\d$", prev):
        return True
    if curr in {"%", "‰"} and re.search(r"\d$", prev):
        return True
    if re.fullmatch(r"['’](?:s|t|re|ve|ll|d|m)[,.;:!?…]*", curr, flags=re.IGNORECASE):
        return True
    if curr.startswith("-") and len(curr) > 1 and not curr.startswith("--"):
        return True
    if prev.endswith("-") and not prev.endswith("--"):
        return True
    return False


def build_word_sequence(segments: Sequence[Any]) -> List[Dict[str, Any]]:
    """Convert raw ASR segments into one lossless, globally indexed word stream."""
    raw_list: List[Dict[str, Any]] = []
    for segment_index, segment in enumerate(segments):
        source_boundary_before = bool(_value(segment, "source_boundary_before", False))
        speaker = _value(segment, "speaker", None)
        first_result_index = len(raw_list)
        text = re.sub(r"\s+", " ", str(_value(segment, "text", ""))).strip()
        start = max(0.0, float(_value(segment, "start", _value(segment, "startSec", 0.0)) or 0.0))
        end = max(start, float(_value(segment, "end", _value(segment, "endSec", start)) or start))
        raw_words = _value(segment, "words", None)

        if raw_words:
            for raw_word in raw_words:
                token = _word_text(raw_word)
                if not token:
                    continue
                w_start = max(
                    0.0,
                    float(_value(raw_word, "start", _value(raw_word, "startSec", start)) or start),
                )
                raw_end_val = _value(raw_word, "end", _value(raw_word, "endSec", None))
                raw_end = float(raw_end_val) if raw_end_val is not None else (w_start + 0.05)
                raw_duration = max(0.0, raw_end - w_start)
                w_end = raw_end if raw_end > w_start else (w_start + 0.05)
                prob = _value(raw_word, "probability", _value(raw_word, "confidence", None))
                raw_list.append({
                    "id": len(raw_list),
                    "text": token,
                    "start": w_start,
                    "end": w_end,
                    "raw_duration": round(raw_duration, 4),
                    "probability": float(prob) if prob is not None else None,
                    "source_segment": segment_index,
                    "speaker": speaker,
                    "source_boundary_before": source_boundary_before and len(raw_list) == first_result_index,
                })
            continue

        tokens = text.split()
        if not tokens:
            continue
        weights = [max(1, len(t)) for t in tokens]
        total = float(sum(weights))
        cursor = 0.0
        duration = max(0.05 * len(tokens), end - start)
        for token, weight in zip(tokens, weights):
            w_start = start + duration * (cursor / total)
            cursor += weight
            w_end = start + duration * (cursor / total)
            raw_list.append({
                "id": len(raw_list),
                "text": token,
                "start": w_start,
                "end": max(w_start + 0.05, w_end),
                "raw_duration": round(max(0.05, w_end - w_start), 4),
                "probability": None,
                "source_segment": segment_index,
                "speaker": speaker,
                "source_boundary_before": source_boundary_before and len(raw_list) == first_result_index,
            })

    # Merge BPE continuations (e.g. "$290" + ",000" -> "$290,000", "82" + ",000" -> "82,000")
    result: List[Dict[str, Any]] = []
    for item in raw_list:
        if (
            result
            and not item.get("source_boundary_before")
            and _is_bpe_continuation(result[-1]["text"], item["text"])
            and (item["start"] - result[-1]["end"]) < 0.25
        ):
            result[-1]["text"] = result[-1]["text"].rstrip() + item["text"].lstrip()
            result[-1]["end"] = max(result[-1]["end"], item["end"])
            result[-1]["raw_duration"] = round(
                float(result[-1].get("raw_duration", 0.05)) + float(item.get("raw_duration", 0.05)),
                4,
            )
            if result[-1]["probability"] is not None and item["probability"] is not None:
                result[-1]["probability"] = min(result[-1]["probability"], item["probability"])
        else:
            result.append(item)

    # Canonicalize split entity designators across ASR segment boundaries
    # e.g., "Tesla Powerwall." + "Three are seeing" -> "Tesla Powerwall" + "3 are seeing"
    for idx in range(len(result) - 1):
        prev_w = result[idx]
        cur_w = result[idx + 1]
        if cur_w.get("source_boundary_before"):
            continue
        prev_clean = _clean_token(prev_w["text"])
        cur_clean = _clean_token(cur_w["text"])
        gap = max(0.0, cur_w["start"] - prev_w["end"])
        if prev_clean in ENTITY_DESIGNATOR_HEADS and gap < 0.85:
            if cur_clean in SMALL_NUMBER_WORD_TO_DIGIT:
                # Check if cur_w is followed by a verb/auxiliary or punctuation, or if prev clause lacks a finite verb
                next_is_pred = (
                    idx + 2 < len(result)
                    and (
                        _clean_token(result[idx + 2]["text"]) in AUXILIARIES | COMMON_VERBS | PREPOSITIONS
                        or cur_w["text"].rstrip().endswith(TERMINAL_PUNCTUATION + CLAUSE_PUNCTUATION)
                    )
                )
                if next_is_pred:
                    trailing_punct = ""
                    stripped_cur = cur_w["text"].rstrip()
                    while stripped_cur and stripped_cur[-1] in TERMINAL_PUNCTUATION + CLAUSE_PUNCTUATION:
                        trailing_punct = stripped_cur[-1] + trailing_punct
                        stripped_cur = stripped_cur[:-1]
                    prev_w["text"] = _replace_terminal_for_display(prev_w["text"], "")
                    cur_w["text"] = SMALL_NUMBER_WORD_TO_DIGIT[cur_clean] + trailing_punct
            elif re.fullmatch(r"\d+(?:\.\d+)?", cur_clean) and prev_w["text"].rstrip().endswith(TERMINAL_PUNCTUATION):
                prev_w["text"] = _replace_terminal_for_display(prev_w["text"], "")

    if result:
        result[0]["text"] = _capitalize_subtitle_opening(result[0]["text"])

    _reindex_word_sequence(result)
    return result


def _reindex_word_sequence(words: List[Dict[str, Any]]) -> None:
    for idx, word in enumerate(words):
        word["id"] = idx
        word["display_text"] = word["text"]
        word["terminal"] = word["text"].rstrip().endswith(TERMINAL_PUNCTUATION)
        word["clause_end"] = word["text"].rstrip().endswith(CLAUSE_PUNCTUATION)
        word["pause_after"] = (
            max(0.0, words[idx + 1]["start"] - word["end"])
            if idx + 1 < len(words)
            else 0.0
        )


def _measure_window_rms_db(wav_path: Optional[Path], start_sec: float, end_sec: float) -> Optional[float]:
    if wav_path is None or not Path(wav_path).is_file():
        return None
    try:
        import numpy as np
        import soundfile as sf

        info = sf.info(str(wav_path))
        sr = int(info.samplerate or 0)
        if sr <= 0:
            return None
        s_frame = max(0, int(start_sec * sr))
        e_frame = min(int(info.frames), max(s_frame + 1, int(end_sec * sr)))
        if e_frame <= s_frame:
            return None
        data, _ = sf.read(str(wav_path), start=s_frame, stop=e_frame, always_2d=True)
        if data.size == 0:
            return None
        mono = np.mean(data, axis=1)
        rms = float(np.sqrt(np.mean(np.square(mono))))
        return 20.0 * math.log10(max(1e-9, rms))
    except Exception:
        return None


def filter_asr_hallucinations(
    words: List[Dict[str, Any]],
    wav_path: Optional[Path] = None,
    suspected_out: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """Detect and handle Whisper 30s-window boundary micro-hallucinations (e.g. 'It's happening.'
    with 0.000s raw duration and p=0.0034 during -58 dBFS silence).

    - Never drops words solely because they repeat earlier words.
    - Requires BOTH anomalous ASR token evidence (collapsed duration <= 0.015s or span <= 0.12s
      AND low confidence min_prob < 0.05 / avg_prob < 0.35 at a segment boundary) AND acoustic
      verification (< -35 dBFS silence in Master WAV) before removing.
    - If Master WAV is unavailable, preserves the tokens and records them in `suspected_out`
      as unverified.
    """
    if len(words) <= 2:
        return words

    to_remove = set()
    n = len(words)
    idx = 0
    while idx < n:
        w = words[idx]
        at_seg_start = idx == 0 or w.get("source_segment") != words[idx - 1].get("source_segment")
        if at_seg_start:
            # Find micro-utterance span up to first terminal punctuation within 1..3 tokens
            span_end_idx = None
            for k in range(idx, min(n, idx + 3)):
                if k > idx and words[k].get("source_segment") != w.get("source_segment"):
                    break
                if words[k]["text"].rstrip().endswith(TERMINAL_PUNCTUATION):
                    span_end_idx = k + 1
                    break
            if span_end_idx is not None:
                span = words[idx:span_end_idx]
                probs = [float(x["probability"]) for x in span if x.get("probability") is not None]
                raw_durs = [float(x.get("raw_duration", x["end"] - x["start"])) for x in span]
                span_start = float(span[0]["start"])
                span_raw_end = float(span[-1]["start"]) + raw_durs[-1]
                span_total_raw_dur = max(0.0, span_raw_end - span_start)
                min_prob = min(probs) if probs else 1.0
                avg_prob = (sum(probs) / len(probs)) if probs else 1.0
                min_raw_dur = min(raw_durs) if raw_durs else 1.0

                is_anomalous_asr = (
                    len(probs) > 0
                    and (min_raw_dur <= 0.015 or span_total_raw_dur <= 0.12)
                    and (min_prob < 0.05 or avg_prob < 0.35)
                )
                if is_anomalous_asr:
                    next_start = float(words[span_end_idx]["start"]) if span_end_idx < n else (span_start + 0.35)
                    check_end = min(next_start, max(float(span[-1]["end"]), span_start + 0.25))
                    rms_db = _measure_window_rms_db(wav_path, span_start, check_end)
                    phrase_text = _join_tokens([x["text"] for x in span])
                    record = {
                        "text": phrase_text,
                        "start": round(span_start, 3),
                        "end": round(float(span[-1]["end"]), 3),
                        "min_probability": round(min_prob, 4),
                        "avg_probability": round(avg_prob, 4),
                        "min_raw_duration": round(min_raw_dur, 4),
                        "rms_db": round(rms_db, 2) if rms_db is not None else None,
                    }
                    if rms_db is not None and rms_db < -35.0:
                        record["verified_silent_hallucination"] = True
                        record["action"] = "removed"
                        if suspected_out is not None:
                            suspected_out.append(record)
                        for r_idx in range(idx, span_end_idx):
                            to_remove.add(r_idx)
                        idx = span_end_idx
                        continue
                    else:
                        record["verified_silent_hallucination"] = False
                        record["action"] = "kept_unverified" if rms_db is None else "kept_audible"
                        if suspected_out is not None:
                            suspected_out.append(record)
        idx += 1

    if not to_remove:
        return words

    filtered = [dict(w) for i, w in enumerate(words) if i not in to_remove]
    if filtered:
        filtered[0]["text"] = _capitalize_subtitle_opening(filtered[0]["text"])
        _reindex_word_sequence(filtered)
    return filtered


def recover_orthography_from_script(
    words: List[Dict[str, Any]],
    script_text: Optional[str],
    language: str = "en",
) -> List[Dict[str, Any]]:
    """Script-Assisted Orthographic Recovery (Section 3.2).

    Aligns the ASR word stream (which holds authoritative audio timestamps) with the
    original script text to recover exact capitalization, brand/proper nouns
    (PepsiCo, Sysco, Tesla Semi, Optimus, Megacharger), and compact number/unit
    formatting ($290,000, 1.55 kWh, 4680, 50,000) while preserving 100% of ASR timing.
    """
    if not words or not script_text or not script_text.strip():
        return words

    # Clean pause tags from script while preserving all surface words & punctuation
    cleaned_script = re.sub(r"\[pause[^\]]*\]", " ", script_text, flags=re.IGNORECASE)
    script_tokens = [t.strip() for t in cleaned_script.split() if t.strip()]
    if not script_tokens:
        return words

    asr_clean = [_clean_token(w["text"]) for w in words]
    scr_clean = [_clean_token(t) for t in script_tokens]

    matcher = difflib.SequenceMatcher(None, asr_clean, scr_clean, autojunk=False)
    recovered: List[Dict[str, Any]] = []

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            for k in range(i2 - i1):
                w = dict(words[i1 + k])
                scr_tok = script_tokens[j1 + k]
                # Preserve script casing and punctuation when underlying lexical token matches
                if _clean_token(w["text"]) == _clean_token(scr_tok):
                    w["text"] = scr_tok
                    w["display_text"] = scr_tok
                    if scr_tok.rstrip().endswith(TERMINAL_PUNCTUATION):
                        w["script_confirmed_terminal"] = True
                recovered.append(w)
            continue

        if tag == "delete":
            # Spoken words in ASR not in script: keep them so we never drop spoken audio
            for k in range(i1, i2):
                recovered.append(dict(words[k]))
            continue

        if tag == "insert":
            # Script words not spoken in ASR: do not invent untimed words
            continue

        # tag == "replace"
        asr_slice = words[i1:i2]
        scr_slice = script_tokens[j1:j2]
        if not asr_slice:
            continue

        asr_phrase = " ".join(w["text"] for w in asr_slice)
        scr_phrase = " ".join(scr_slice)

        # Do not replace compact ASR digits (e.g. "55,", "37", "15-liter") with spelled-out TTS words ("fifty five")
        asr_has_digits = any(any(ch.isdigit() for ch in w["text"]) for w in asr_slice)
        scr_has_digits = any(any(ch.isdigit() for ch in t) for t in scr_slice)
        if asr_has_digits and not scr_has_digits:
            if scr_slice and scr_slice[-1].rstrip().endswith(TERMINAL_PUNCTUATION):
                asr_copy = [dict(w) for w in asr_slice]
                asr_copy[-1]["script_confirmed_terminal"] = True
                recovered.extend(asr_copy)
            else:
                for w_orig in asr_slice:
                    recovered.append(dict(w_orig))
            continue

        # Check if normalized forms match (e.g., "$290,000" vs "two hundred and ninety thousand dollars",
        # "1.55 kWh" vs "1.55 kilowatt hours", "4680" vs "four six eight zero", "PepsiCo" vs "Pepsico")
        asr_norm = [s.canonical for s in collapse_number_tokens(asr_phrase.split(), language=language)]
        scr_norm = [s.canonical for s in collapse_number_tokens(scr_phrase.split(), language=language)]

        norm_matches = (asr_norm == scr_norm and len(scr_norm) > 0)
        if not norm_matches and len(asr_norm) > 0 and len(scr_norm) > 0:
            joined_asr = "".join(asr_norm)
            joined_scr = "".join(scr_norm)
            if joined_asr == joined_scr:
                norm_matches = True
            else:
                ratio = difflib.SequenceMatcher(None, joined_asr, joined_scr).ratio()
                if ratio >= 0.82 and abs(len(asr_slice) - len(scr_slice)) <= 2:
                    norm_matches = True

        if norm_matches and 1 <= len(scr_slice) <= len(asr_slice) + 1:
            if len(scr_slice) == len(asr_slice):
                for w_orig, s_tok in zip(asr_slice, scr_slice):
                    w = dict(w_orig)
                    w["text"] = s_tok
                    w["display_text"] = s_tok
                    if s_tok.rstrip().endswith(TERMINAL_PUNCTUATION):
                        w["script_confirmed_terminal"] = True
                    recovered.append(w)
            else:
                # Distribute the ASR span [start, end] proportionally across scr_slice tokens
                span_start = asr_slice[0]["start"]
                span_end = max(span_start + 0.05, asr_slice[-1]["end"])
                span_dur = span_end - span_start
                weights = [max(1, len(t)) for t in scr_slice]
                total_w = float(sum(weights))
                cursor = 0.0
                min_prob = min(
                    (w["probability"] for w in asr_slice if w.get("probability") is not None),
                    default=None,
                )
                for idx_s, (s_tok, weight) in enumerate(zip(scr_slice, weights)):
                    w_s = span_start + span_dur * (cursor / total_w)
                    cursor += weight
                    w_e = span_start + span_dur * (cursor / total_w)
                    base_w = dict(asr_slice[min(idx_s, len(asr_slice) - 1)])
                    base_w["text"] = s_tok
                    base_w["display_text"] = s_tok
                    base_w["start"] = round(w_s, 3)
                    base_w["end"] = round(max(w_s + 0.04, w_e), 3)
                    base_w["probability"] = min_prob
                    if s_tok.rstrip().endswith(TERMINAL_PUNCTUATION):
                        base_w["script_confirmed_terminal"] = True
                    base_w["source_boundary_before"] = (
                        asr_slice[0].get("source_boundary_before", False) and idx_s == 0
                    )
                    recovered.append(base_w)
        else:
            # Keep ASR tokens untouched if no high-confidence alignment exists
            for w_orig in asr_slice:
                recovered.append(dict(w_orig))

    _reindex_word_sequence(recovered)
    return recovered


def _looks_like_verb(token: str) -> bool:
    clean = _clean_token(token)
    if clean in COMMON_VERBS or clean in VI_VERBS:
        return True
    if len(clean) >= 5 and (clean.endswith("ed") or clean.endswith("ing")) and clean not in PRENOMINAL_MODIFIERS:
        return True
    return False


def _looks_like_standalone_title(words: Sequence[Dict[str, Any]], index: int) -> bool:
    following = [_clean_token(word["text"]) for word in words[index + 1 : index + 7]]
    if len(following) < 4 or following[0] not in {"the", "a", "an"}:
        return False
    return "that" in following[:4] and any(_looks_like_verb(token) for token in following[2:])


def _is_suspicious_terminal(words: Sequence[Dict[str, Any]], index: int) -> bool:
    if index >= len(words) - 1:
        return False
    current = words[index]
    if not current.get("terminal"):
        return False
    if current.get("script_confirmed_terminal"):
        return False
    next_word = words[index + 1]
    gap = max(0.0, next_word["start"] - current["end"])
    current_clean = _clean_token(current["text"])
    next_raw = next_word["text"].strip()
    next_clean = _clean_token(next_raw)

    if _looks_like_standalone_title(words, index):
        return False
    if f"{current_clean} {next_clean}" in KNOWN_PHRASES:
        return True
    if current_clean in ENTITY_DESIGNATOR_HEADS and re.fullmatch(r"\d+(?:\.\d+)?", next_clean) and gap < 0.85:
        return True
    if (
        current_clean == "moment"
        and next_clean in {"a", "an"}
        and index > 0
        and _clean_token(words[index - 1]["text"]) == "the"
        and gap < 0.45
    ):
        return True
    if next_raw and next_raw[0].islower() and gap < 0.45:
        return True
    if current_clean in NOISY_ABBREVIATIONS:
        return True

    sentence_start = index
    while sentence_start > 0 and not words[sentence_start - 1].get("terminal"):
        sentence_start -= 1
    fragment_length = index - sentence_start + 1
    fragment_phrase = " ".join(_clean_token(word["text"]) for word in words[sentence_start : index + 1])
    if fragment_phrase in SHORT_STANDALONE and gap < 0.45:
        return False
    if fragment_length <= 2 and gap < 0.12 and current_clean not in SHORT_STANDALONE:
        if next_raw and next_raw[0].islower() and next_clean not in CLAUSE_STARTERS:
            return True
    if re.fullmatch(r"\d+", current_clean) and next_clean in NUMBER_WORDS and gap < 0.35:
        return True
    return False


def _false_terminal_display_replacement(words: Sequence[Dict[str, Any]], index: int) -> Optional[str]:
    if not _is_suspicious_terminal(words, index) or index >= len(words) - 1:
        return None
    current_clean = _clean_token(words[index]["text"])
    next_raw = words[index + 1]["text"].strip()
    next_clean = _clean_token(next_raw)
    if current_clean in ENTITY_DESIGNATOR_HEADS and re.fullmatch(r"\d+(?:\.\d+)?", next_clean):
        return ""
    if not next_raw or not next_raw[0].islower() or re.fullmatch(r"\d+(?:[.,]\d+)?", current_clean):
        return None
    if _looks_like_standalone_title(words, index):
        return None
    if f"{current_clean} {next_clean}" in KNOWN_PHRASES:
        return ""
    if next_clean in {"at", "to", "of", "for", "in", "on", "into", "onto", "from"}:
        return ""
    return ","


def mark_hard_boundaries(
    words: List[Dict[str, Any]],
    profile: LayoutProfile,
    cue_protected: Optional[Dict[int, str]] = None,
) -> List[int]:
    """Return exclusive global word indexes that partition independent DP blocks."""
    boundaries: List[int] = []
    protected_map = cue_protected or {}
    for word in words:
        word["display_text"] = word["text"]
    for idx, word in enumerate(words):
        is_hard_sentence = bool(word.get("terminal")) and not _is_suspicious_terminal(words, idx)
        word["hard_sentence_end"] = is_hard_sentence
        replacement = _false_terminal_display_replacement(words, idx)
        if replacement is not None:
            word["display_text"] = _replace_terminal_for_display(word["text"], replacement)
        if is_hard_sentence and idx + 1 < len(words):
            words[idx + 1]["display_text"] = _capitalize_subtitle_opening(words[idx + 1]["display_text"])
        if idx == len(words) - 1:
            boundaries.append(idx + 1)
            continue
        gap = max(0.0, words[idx + 1]["start"] - word["end"])
        source_boundary = bool(words[idx + 1].get("source_boundary_before"))
        boundary_id = idx + 1
        if boundary_id in protected_map and not is_hard_sentence and not source_boundary and gap < 1.15:
            continue
        if is_hard_sentence or gap >= profile.hard_pause or source_boundary:
            boundaries.append(boundary_id)
    if not boundaries or boundaries[-1] != len(words):
        boundaries.append(len(words))
    return boundaries


def _is_proper_noun_pair(words: Sequence[Dict[str, Any]], idx: int) -> bool:
    """Detect 2-word capitalized Proper Nouns (e.g. 'Tesla Semi', 'Elon Musk', 'Giga Texas')."""
    if idx < 0 or idx >= len(words) - 1:
        return False
    w1_raw = words[idx]["text"].strip()
    w2_raw = words[idx + 1]["text"].strip()
    if w1_raw.endswith(TERMINAL_PUNCTUATION + CLAUSE_PUNCTUATION):
        return False
    w1_clean = _clean_token(w1_raw)
    w2_clean = _clean_token(w2_raw)
    if not w1_clean or not w2_clean:
        return False
    if not (w1_raw[0].isupper() and w2_raw[0].isupper()):
        return False
    if w1_clean in COMMON_SENTENCE_STARTERS or w2_clean in FORBIDDEN_ENDINGS:
        return False
    return True


def _is_entity_designator_pair(words: Sequence[Dict[str, Any]], idx: int) -> bool:
    """Detect Product/Model/Policy/Standard + Version/Number (e.g. 'Powerwall 3', 'Model 3',
    'NEM 3.0', 'ISO 9001', 'iPhone 17', 'Megapack 2', 'Starship 3')."""
    if idx < 0 or idx >= len(words) - 1:
        return False
    w1_raw = words[idx]["text"].strip()
    w2_raw = words[idx + 1]["text"].strip()
    if w1_raw.endswith(TERMINAL_PUNCTUATION + CLAUSE_PUNCTUATION):
        return False
    gap = max(0.0, float(words[idx + 1]["start"]) - float(words[idx]["end"]))
    if gap >= 1.15:
        return False
    w1_clean = _clean_token(w1_raw)
    w2_clean = _clean_token(w2_raw)
    if not w1_clean or not w2_clean:
        return False
    is_version_num = bool(re.fullmatch(r"\d+(?:\.\d+)?[a-z]?", w2_clean)) or w2_clean in SMALL_NUMBER_WORD_TO_DIGIT
    if not is_version_num:
        return False
    if w1_clean in ENTITY_DESIGNATOR_HEADS:
        return True
    # Also match any capitalized brand/acronym (>= 2 letters) followed by a version number,
    # provided w1 is not a common sentence starter, verb, preposition, or determiner
    if (
        len(w1_clean) >= 2
        and (w1_raw[0].isupper() or w1_raw.isupper())
        and w1_clean not in COMMON_SENTENCE_STARTERS
        and w1_clean not in FORBIDDEN_ENDINGS
        and w1_clean not in CLAUSE_STARTERS
        and not _looks_like_verb(w1_raw)
    ):
        return True
    return False


def build_protected_boundary_map(
    words: Sequence[Dict[str, Any]],
) -> Tuple[Dict[int, str], Dict[int, str]]:
    """Build O(1) maps keyed by global exclusive word boundary IDs:
    - cue_protected: boundaries that must not be split across separate cues.
    - line_protected: boundaries that must not be split across lines inside a cue either.
    """
    cue_protected: Dict[int, str] = {}
    line_protected: Dict[int, str] = {}
    clean = [_clean_token(word["text"]) for word in words]
    n = len(words)

    # 1. Known phrases (multi-word entities, phrasal verbs, idioms, compounds)
    for start in range(n):
        for size in range(MAX_KNOWN_PHRASE_WORDS, 1, -1):
            end = start + size
            if end > n:
                continue
            if any(words[pos].get("source_boundary_before") for pos in range(start + 1, end)):
                continue
            if any(
                words[pos]["text"].rstrip().endswith(TERMINAL_PUNCTUATION + CLAUSE_PUNCTUATION)
                for pos in range(start, end - 1)
            ):
                continue
            if any(
                max(0.0, float(words[pos]["start"]) - float(words[pos - 1]["end"])) >= 1.15
                for pos in range(start + 1, end)
            ):
                continue
            phrase = " ".join(clean[start:end])
            if phrase in KNOWN_PHRASES:
                for boundary in range(start + 1, end):
                    cue_protected[boundary] = f"protected phrase: {phrase}"
                    line_protected[boundary] = f"protected phrase: {phrase}"
                break

    # 1b. Brand/Product/Policy/Standard + Version/Number (e.g. "Powerwall 3", "Tesla Powerwall 3",
    # "Tesla Model 3", "NEM 3.0", "ISO 9001", "iPhone 17") and introducing heads ("called NEM 3.0")
    for idx in range(n - 1):
        if _is_entity_designator_pair(words, idx):
            span_start = idx
            if (
                idx > 0
                and not words[idx - 1]["text"].rstrip().endswith(TERMINAL_PUNCTUATION + CLAUSE_PUNCTUATION)
                and (_is_proper_noun_pair(words, idx - 1) or clean[idx - 1] in ENTITY_DESIGNATOR_HEADS)
                and max(0.0, float(words[idx]["start"]) - float(words[idx - 1]["end"])) < 1.15
            ):
                span_start = idx - 1
            entity_text = _join_tokens([words[k]["text"] for k in range(span_start, idx + 2)])
            for b in range(span_start + 1, idx + 2):
                cue_protected[b] = f"protected entity designator: {entity_text}"
                line_protected[b] = f"protected entity designator: {entity_text}"
            # Keep "called NEM 3.0" / "named Powerwall 3" together in the same cue
            if span_start > 0 and clean[span_start - 1] in {"called", "named"}:
                cue_protected[span_start] = f"named entity introduction: {words[span_start - 1]['text']} {entity_text}"
            elif (
                span_start >= 2
                and clean[span_start - 2] == "like"
                and clean[span_start - 1] in {"the", "a", "an"}
            ):
                cue_protected[span_start - 1] = f"exemplar entity: like {words[span_start - 1]['text']} {entity_text}"
                cue_protected[span_start] = f"exemplar entity: like {words[span_start - 1]['text']} {entity_text}"

    # 1c. Quantifier + "of" (e.g. "millions of", "thousands of", "billions of", "hundreds of")
    for idx in range(n - 1):
        if (
            not words[idx]["text"].rstrip().endswith(TERMINAL_PUNCTUATION + CLAUSE_PUNCTUATION)
            and clean[idx] in QUANTIFIER_OF_HEADS
            and clean[idx + 1] == "of"
        ):
            q_phrase = f"{words[idx]['text']} {words[idx + 1]['text']}"
            cue_protected[idx + 1] = f"quantifier of-phrase: {q_phrase}"
            line_protected[idx + 1] = f"quantifier of-phrase: {q_phrase}"

    # 2. Short 3-item coordinate noun lists: "X, Y, and Z" or "X, Y and Z"
    # Example: "cars, trucks, and robots." or "steel, aluminum, and glass."
    for idx in range(n - 3):
        w1_raw = words[idx]["text"].rstrip()
        w3_clean = clean[idx + 2]
        w4_clean = clean[idx + 3]
        if (
            w1_raw.endswith(",")
            and not w1_raw.endswith(TERMINAL_PUNCTUATION)
            and w3_clean in {"and", "or", "và", "hoặc"}
            and w4_clean
            and not _looks_like_verb(words[idx]["text"])
            and not _looks_like_verb(words[idx + 1]["text"])
            and not _looks_like_verb(words[idx + 3]["text"])
        ):
            list_text = _join_tokens([words[k]["text"] for k in range(idx, idx + 4)])
            if display_width(list_text) <= 42:
                cue_protected[idx + 1] = f"3-item coordinate list: {list_text}"
                cue_protected[idx + 2] = f"3-item coordinate list: {list_text}"
                cue_protected[idx + 3] = f"3-item coordinate list: {list_text}"
                line_protected[idx + 1] = f"3-item list head: {list_text}"
                line_protected[idx + 3] = f"3-item list conjunction: {list_text}"

    # 3. Short 2-item coordinate noun pairs without commas:
    # "PepsiCo and Sysco", "Americans and Europeans", "vegetables and eggs", "rau và trứng"
    for idx in range(n - 2):
        w1_raw = words[idx]["text"].rstrip()
        w2_clean = clean[idx + 1]
        w3_raw = words[idx + 2]["text"].rstrip()
        if (
            not w1_raw.endswith(TERMINAL_PUNCTUATION + CLAUSE_PUNCTUATION)
            and w2_clean in {"and", "or", "và", "hay", "hoặc"}
            and clean[idx]
            and clean[idx + 2]
            and clean[idx] not in FORBIDDEN_ENDINGS
            and clean[idx + 2] not in FORBIDDEN_ENDINGS
            and clean[idx + 2] not in {"then", "sau", "so", "therefore", "yet", "still"}
            and not _looks_like_verb(w1_raw)
            and not _looks_like_verb(w3_raw)
        ):
            next_is_clause_verb = (
                idx + 3 < n
                and _looks_like_verb(words[idx + 3]["text"])
                and clean[idx + 3] not in {"have", "has", "had", "are", "were"}
                and clean[idx + 2] in SUBJECT_PRONOUNS
            )
            pair_text = _join_tokens([words[idx]["text"], words[idx + 1]["text"], words[idx + 2]["text"]])
            if not next_is_clause_verb and display_width(pair_text) <= 28:
                cue_protected[idx + 1] = f"coordinate noun pair: {pair_text}"
                cue_protected[idx + 2] = f"coordinate noun pair: {pair_text}"
                line_protected[idx + 2] = f"coordinate noun pair conjunction: {pair_text}"
                prev_clean = clean[idx - 1] if idx > 0 else ""
                if display_width(pair_text) <= 20 and prev_clean not in PREPOSITIONS:
                    line_protected[idx + 1] = f"coordinate noun pair: {pair_text}"

    # 4. Tight subordinate starter + pronoun subject + verb ("that it depends", "that they are")
    for idx in range(n - 2):
        w1_raw = words[idx]["text"].rstrip()
        w2_raw = words[idx + 1]["text"].rstrip()
        if (
            not w1_raw.endswith(TERMINAL_PUNCTUATION + CLAUSE_PUNCTUATION)
            and not w2_raw.endswith(TERMINAL_PUNCTUATION + CLAUSE_PUNCTUATION)
            and clean[idx] in {"that", "whether", "if", "when", "where", "who", "because", "while"}
            and clean[idx + 1] in (SUBJECT_PRONOUNS | {"it", "you", "there", "one"})
            and (_looks_like_verb(words[idx + 2]["text"]) or clean[idx + 2] in AUXILIARIES)
        ):
            sub_phrase = _join_tokens([words[idx]["text"], words[idx + 1]["text"], words[idx + 2]["text"]])
            cue_protected[idx + 1] = f"subordinate subject-verb: {sub_phrase}"
            cue_protected[idx + 2] = f"subordinate subject-verb: {sub_phrase}"
            line_protected[idx + 1] = f"subordinate subject: {words[idx]['text']} {words[idx + 1]['text']}"

    # 5. Pairwise lexical, numeric, unit, and grammatical protections
    for idx in range(n - 1):
        left = clean[idx]
        right = clean[idx + 1]
        left_raw = words[idx]["text"].strip()
        right_raw = words[idx + 1]["text"].strip()
        boundary = idx + 1
        if not left or not right:
            continue
        if words[idx + 1].get("source_boundary_before"):
            continue
        gap = max(0.0, float(words[idx + 1]["start"]) - float(words[idx]["end"]))
        if gap >= 1.15:
            continue

        left_is_terminal = bool(words[idx].get("terminal")) and not _is_suspicious_terminal(words, idx)
        left_has_punct = left_raw.endswith(TERMINAL_PUNCTUATION + CLAUSE_PUNCTUATION)
        split_token_boundary = right_raw.startswith(("-", ",")) or left_raw.endswith("-")
        left_number = bool(re.fullmatch(r"[$€£]?\d[\d,.:/-]*%?", left)) or left in NUMBER_WORDS
        right_number = bool(re.fullmatch(r"[$€£]?\d[\d,.:/-]*%?", right)) or right in NUMBER_WORDS
        is_copula_before_that_clause = (
            left in {"is", "was", "are", "were"}
            and right in {"that", "whether", "what", "why", "how", "where", "when", "who"}
            and idx + 2 < n
            and (clean[idx + 2] in (SUBJECT_PRONOUNS | {"it", "you", "there", "this", "these", "those"}) or clean[idx + 2] in DETERMINERS)
        )

        reason: Optional[str] = None
        line_protect_also = True

        if split_token_boundary:
            reason = "split punctuation or hyphenated token"
        elif not left_has_punct and (left in FORBIDDEN_ENDINGS or left.endswith("'s") or left.endswith("’s")):
            if right not in {"before", "after", "when", "while", "because", "if", "although"}:
                reason = f"forbidden ending: {left}"
                if is_copula_before_that_clause:
                    line_protect_also = False
        elif not left_has_punct and left_number and right in UNIT_WORDS:
            reason = f"number and unit: {left_raw} {right_raw}"
        elif not left_has_punct and left in UNIT_WORDS and right in UNIT_WORDS and left in {"million", "billion", "trillion", "thousand", "hundred", "kilowatt", "megawatt", "gigawatt"}:
            reason = f"scale and unit: {left_raw} {right_raw}"
        elif not left_has_punct and left in UNIT_WORDS and right == "per" and idx + 2 < n and clean[idx + 2] in UNIT_WORDS:
            cue_protected[boundary] = f"unit rate: {left_raw} per {words[idx + 2]['text']}"
            cue_protected[boundary + 1] = f"unit rate: {left_raw} per {words[idx + 2]['text']}"
            line_protected[boundary] = f"unit rate: {left_raw} per {words[idx + 2]['text']}"
            line_protected[boundary + 1] = f"unit rate: {left_raw} per {words[idx + 2]['text']}"
            continue
        elif not left_has_punct and left_number and right == "to" and idx + 2 < n and (
            bool(re.fullmatch(r"[$€£]?\d[\d,.:/-]*%?", clean[idx + 2])) or clean[idx + 2] in NUMBER_WORDS
        ):
            cue_protected[boundary] = "numeric range"
            cue_protected[boundary + 1] = "numeric range"
            line_protected[boundary] = "numeric range"
            line_protected[boundary + 1] = "numeric range"
            continue
        elif not left_has_punct and left in {"kilo", "mega", "giga", "tera"} and right in UNIT_WORDS:
            reason = "multi-word unit"
        elif _is_entity_designator_pair(words, idx):
            reason = f"entity designator: {left_raw} {right_raw}"
        elif _is_proper_noun_pair(words, idx):
            reason = f"proper noun: {left_raw} {right_raw}"
        elif not left_has_punct and left in {"self", "real", "split"} and right in {"driving", "time", "second"}:
            reason = "compound modifier"
        elif (
            left_raw.endswith(",")
            and left in PRENOMINAL_MODIFIERS
            and right in PRENOMINAL_MODIFIERS
        ):
            reason = "coordinate modifiers"
            line_protect_also = False
        elif not left_has_punct and left in PRENOMINAL_MODIFIERS and right not in CLAUSE_STARTERS:
            reason = f"modifier with following word: {left}"
            line_protect_also = False
        elif (
            not left_has_punct
            and left.endswith("ly")
            and left not in {"elderly", "friendly", "family", "only", "likely", "unlikely", "early"}
            and right not in CLAUSE_STARTERS
            and right not in PREPOSITIONS
        ):
            reason = "adverb with following predicate or modifier"
            line_protect_also = False
        elif not left_has_punct and left in {"already", "still", "never", "always", "just"} and _looks_like_verb(right_raw):
            reason = f"adverb with verb: {left} {right}"
            line_protect_also = False
        elif not left_has_punct and _looks_like_verb(left_raw) and right_number and gap < 0.35:
            reason = f"verb with numeric object: {left_raw} {right_raw}"
            line_protect_also = False
        elif not left_has_punct and left in COMPLEMENT_TAKING and right in PREPOSITIONS | DETERMINERS | {"than", "to", "it", "down", "up", "in", "out"}:
            reason = f"complement after: {left}"
            line_protect_also = False
        elif not left_has_punct and left in AUXILIARIES and right not in CLAUSE_STARTERS:
            reason = f"auxiliary with following predicate: {left}"
            if is_copula_before_that_clause:
                line_protect_also = False

        if reason and not left_is_terminal:
            cue_protected[boundary] = reason
            if line_protect_also and not (
                right_number
                and (left == "than" or left in {"precisely", "roughly", "nearly", "almost", "approximately", "about", "around"})
            ):
                line_protected[boundary] = reason

    return cue_protected, line_protected


def _is_clause_conjunction_boundary(words: Sequence[Dict[str, Any]], boundary: int) -> bool:
    """Return True when boundary is immediately BEFORE a conjunction/relative that connects
    two clauses (both left and right sides contain a verb/predicate)."""
    if boundary <= 0 or boundary >= len(words):
        return False
    left_word = words[boundary - 1]
    left_raw = left_word["text"].rstrip()
    left_clean = _clean_token(left_raw)
    right_word = words[boundary]
    right_clean = _clean_token(right_word["text"])
    if right_clean not in {"and", "but", "so", "because", "although", "though", "while", "when", "if", "which", "where", "và", "nhưng", "vì", "khi", "nếu", "mà"}:
        return False
    # Do not split between a cognitive/reporting verb and its wh-complement clause when unpunctuated (e.g. "remember when")
    if (
        not left_raw.endswith(CLAUSE_PUNCTUATION + TERMINAL_PUNCTUATION)
        and right_clean in {"when", "where", "if", "whether"}
        and left_clean in {"remember", "know", "knew", "see", "saw", "think", "thought", "say", "says", "said", "show", "shows", "ask", "asked"}
    ):
        return False
    left_start = max(0, boundary - 8)
    for k in range(boundary - 1, left_start - 1, -1):
        if k < boundary - 1 and words[k].get("hard_sentence_end"):
            left_start = k + 1
            break
    left_has_verb = any(_looks_like_verb(w["text"]) for w in words[left_start:boundary])
    right_end = min(len(words), boundary + 8)
    for k in range(boundary, right_end):
        if words[k].get("hard_sentence_end"):
            right_end = k + 1
            break
    right_has_verb = any(_looks_like_verb(w["text"]) for w in words[boundary + 1 : right_end])
    return left_has_verb and right_has_verb


def _boundary_features(
    words: Sequence[Dict[str, Any]],
    boundary: int,
    profile: LayoutProfile,
    protected: Dict[int, str],
    *,
    line_wrap: bool = False,
) -> Tuple[float, List[str]]:
    """Cost and reasons for a boundary between boundary-1 and boundary."""
    if boundary <= 0 or boundary >= len(words):
        return 0.0, ["block edge"]
    if words[boundary].get("source_boundary_before"):
        return -10000.0, ["source file boundary"]
    left = words[boundary - 1]
    right = words[boundary]
    left_raw = left["text"].rstrip()
    left_clean = _clean_token(left_raw)
    right_clean = _clean_token(right["text"])
    left_is_terminal = bool(left.get("hard_sentence_end"))
    left_has_clause_punct = left_raw.endswith(CLAUSE_PUNCTUATION)
    gap = max(0.0, right["start"] - left["end"])
    cost = 160.0
    reasons = ["mid-sentence boundary"]

    if boundary in protected:
        cost += 6000.0
        reasons.append(protected[boundary])

    if left_is_terminal:
        cost -= 1800.0
        reasons.append("sentence end")
    elif left_has_clause_punct:
        cost -= 780.0
        reasons.append("clause punctuation")

    if gap >= profile.preferred_pause:
        cost -= 900.0
        reasons.append("preferred pause")
    elif gap >= profile.soft_pause:
        cost -= 480.0
        reasons.append("soft pause")
    elif gap >= 0.12:
        cost -= 120.0
        reasons.append("micro pause")
    elif gap <= 0.04:
        cost += 120.0
        reasons.append("continuous speech")

    if _is_clause_conjunction_boundary(words, boundary):
        cost -= 580.0
        reasons.append("independent clause conjunction")
    elif right_clean in CLAUSE_STARTERS and boundary not in protected:
        if right_clean in {"and", "or", "và", "hay", "hoặc"} and not left_has_clause_punct and not line_wrap:
            pass
        else:
            cost -= 280.0
            reasons.append("clause starter")

    # Never end a cue or line on a forbidden function word unless punctuated
    if not left_is_terminal and not left_has_clause_punct:
        right_is_number = bool(re.fullmatch(r"[$€£]?\d[\d,.:/-]*%?", right_clean)) or right_clean in NUMBER_WORDS
        left_is_number = bool(re.fullmatch(r"[$€£]?\d[\d,.:/-]*%?", left_clean)) or left_clean in NUMBER_WORDS
        is_copula_that = (
            line_wrap
            and left_clean in {"is", "was", "are", "were"}
            and right_clean in {"that", "whether", "what", "why", "how", "where", "when", "who"}
        )
        if left_is_number and right_clean in UNIT_WORDS:
            cost += 5800.0
            reasons.append(f"number-unit split: {left_raw} {right['text']}")
        if _is_entity_designator_pair(words, boundary - 1):
            cost += 6000.0
            reasons.append(f"entity-designator split: {left_raw} {right['text']}")
        if left_clean in FORBIDDEN_ENDINGS or left_clean.endswith("'s") or left_clean.endswith("’s"):
            if line_wrap and left_clean == "than" and right_is_number:
                cost -= 80.0
                reasons.append("line wrap after comparative 'than' before number")
            elif is_copula_that:
                cost -= 80.0
                reasons.append("line wrap after copula before complement clause")
            else:
                cost += 5400.0
                reasons.append(f"forbidden ending: {left_clean}")
        if left_clean in COMPLEMENT_TAKING:
            if line_wrap and right_clean in DETERMINERS:
                cost += 120.0
                reasons.append(f"soft line wrap after transitive/participle: {left_clean}")
            else:
                cost += 1400.0
                reasons.append(f"complement expected after: {left_clean}")
        if left_clean in PRENOMINAL_MODIFIERS:
            cost += 1700.0
            reasons.append(f"modifier should stay with following word: {left_clean}")
        if (
            left_clean.endswith("ly")
            and left_clean not in {"elderly", "friendly", "family", "only", "likely", "unlikely", "early"}
            and right_clean not in CLAUSE_STARTERS
            and right_clean not in PREPOSITIONS
        ):
            if line_wrap and right_is_number and left_clean in {"precisely", "roughly", "nearly", "almost", "approximately"}:
                cost -= 60.0
                reasons.append("line wrap after approximator before number")
            else:
                cost += 1200.0
                reasons.append("adverb should stay with following predicate/modifier")

        if line_wrap:
            # Semantic Line Balancing inside a 2-line cue:
            # 1. Reward wrapping before a Prepositional Phrase (e.g. "store cheap solar energy / from the afternoon")
            if (
                right_clean in PREPOSITIONS
                and right_clean not in {"of"}
                and left_clean not in COMPLEMENT_TAKING
                and left_clean not in FORBIDDEN_ENDINGS
            ):
                cost -= 220.0
                reasons.append("line wrap before prepositional phrase")
            # 2. Avoid splitting a pronoun subject (e.g. "you buy", "they are") from its verb across lines,
            # while allowing a multi-word Subject NP (e.g. "your Powerwall 3 / can") to wrap cleanly before its verb
            if (_looks_like_verb(right["text"]) or right_clean in AUXILIARIES) and left_clean not in CLAUSE_STARTERS:
                if left_clean in (SUBJECT_PRONOUNS | {"it", "you", "who", "that", "which"}):
                    cost += 680.0
                    reasons.append("pronoun subject-predicate line split")
        else:
            # Avoid splitting a short subject (1-3 words) or any pronoun subject from its verb across separate cues
            if _looks_like_verb(right["text"]) and left_clean not in CLAUSE_STARTERS and gap < profile.soft_pause:
                phrase_len = 1
                k = boundary - 2
                while k >= max(0, boundary - 5):
                    if words[k]["text"].rstrip().endswith(TERMINAL_PUNCTUATION + CLAUSE_PUNCTUATION):
                        break
                    phrase_len += 1
                    k -= 1
                if phrase_len <= 3 or left_clean in (SUBJECT_PRONOUNS | {"it", "you", "who", "that", "which"}):
                    cost += 680.0
                    reasons.append("short subject-predicate split")

    return cost, reasons


def _wrap_words(
    cue_words: Sequence[Dict[str, Any]],
    profile: LayoutProfile,
    line_protected: Dict[int, str],
) -> Optional[List[str]]:
    """Wrap cue_words into 1 or 2 balanced lines strictly <= profile.max_width."""
    texts = tuple(_display_token(word) for word in cue_words)
    if not texts:
        return None
    one_line = _join_tokens(texts)
    total_chars = display_width(one_line)

    if total_chars > profile.max_cue_chars and len(cue_words) > 1:
        return None

    if profile.max_lines == 1:
        if total_chars <= profile.max_width:
            return [one_line]
        return None

    if total_chars <= profile.target_width:
        return [one_line]

    n = len(cue_words)
    best: Optional[Tuple[float, List[str]]] = None

    for split_idx in range(1, n):
        global_boundary = cue_words[split_idx]["id"]
        if global_boundary in line_protected:
            continue

        line1 = _join_tokens(texts[:split_idx])
        line2 = _join_tokens(texts[split_idx:])
        w1 = display_width(line1)
        w2 = display_width(line2)
        if w1 > profile.max_width or w2 > profile.max_width:
            continue

        score = abs(w1 - w2) * 3.2
        if w1 < 7 or w2 < 7:
            score += 400.0
        elif w1 < 11 or w2 < 11:
            score += 140.0

        boundary_cost, _ = _boundary_features(
            cue_words,
            split_idx,
            profile,
            {},
            line_wrap=True,
        )
        if boundary_cost >= 4000.0:
            continue
        score += max(-300.0, boundary_cost)

        if best is None or score < best[0]:
            best = (score, [line1, line2])

    if total_chars <= profile.max_width:
        one_score = (total_chars - profile.target_width) * 4.0
        if best is None or one_score <= best[0]:
            return [one_line]

    return best[1] if best else None


def _has_predicate(cue_words: Sequence[Dict[str, Any]]) -> bool:
    return any(_looks_like_verb(word["text"]) for word in cue_words)


def _standalone_is_valid(cue_words: Sequence[Dict[str, Any]]) -> bool:
    phrase = " ".join(_clean_token(word["text"]) for word in cue_words).strip()
    if phrase in SHORT_STANDALONE or phrase in KNOWN_PHRASES:
        return True
    if cue_words and cue_words[-1].get("hard_sentence_end"):
        return True
    if len(cue_words) == 1:
        token = cue_words[0]["text"].rstrip()
        clean = _clean_token(token)
        if token.endswith(CLAUSE_PUNCTUATION) and (
            clean.endswith("ly")
            or clean in {"however", "meanwhile", "instead", "therefore", "otherwise", "wait", "now"}
        ):
            return True
    if len(cue_words) == 2:
        first_raw = cue_words[0]["text"].rstrip()
        first = _clean_token(first_raw)
        second = _clean_token(cue_words[1]["text"])
        if (
            not first_raw.endswith(CLAUSE_PUNCTUATION)
            and first not in FORBIDDEN_ENDINGS
            and first not in CLAUSE_STARTERS
            and not first.endswith("ly")
            and second not in FORBIDDEN_ENDINGS
        ):
            return True
    return False


def _local_line_boundaries(cue_words: Sequence[Dict[str, Any]], lines: Sequence[str]) -> List[int]:
    if len(lines) <= 1:
        return []
    boundaries: List[int] = []
    cursor = 0
    for line in lines[:-1]:
        for end in range(cursor + 1, len(cue_words) + 1):
            if _join_tokens([_display_token(word) for word in cue_words[cursor:end]]) == line:
                boundaries.append(end)
                cursor = end
                break
    return boundaries


def _cue_cost(
    words: Sequence[Dict[str, Any]],
    start: int,
    end: int,
    profile: LayoutProfile,
    cue_protected: Dict[int, str],
    line_protected: Dict[int, str],
    is_block_end: bool,
) -> Tuple[float, Optional[List[str]], Dict[str, Any]]:
    cue_words = words[start:end]
    if not cue_words:
        return math.inf, None, {}
    if len(cue_words) > profile.max_words:
        return math.inf, None, {}
    if start in cue_protected or (not is_block_end and end in cue_protected):
        return math.inf, None, {}

    raw_duration = max(0.05, cue_words[-1]["end"] - cue_words[0]["start"])
    if raw_duration > profile.max_duration + 1e-6:
        return math.inf, None, {}

    lines = _wrap_words(cue_words, profile, line_protected)
    if lines is None:
        if len(cue_words) == 1:
            lines = [_display_token(cue_words[0])]
        else:
            return math.inf, None, {}

    text = "\n".join(lines)
    visible_chars = _visible_chars(text)
    widest_line = max(display_width(line) for line in lines)

    # Estimate achievable display duration (including available post-cue silence up to next word)
    gap_after = (
        max(0.0, words[end]["start"] - cue_words[-1]["end"])
        if end < len(words)
        else 0.60
    )
    usable_tail = max(0.10, min(0.80, gap_after - 0.06)) if gap_after >= 0.10 else 0.04
    achievable_duration = min(profile.max_duration, raw_duration + usable_tail)
    cps = visible_chars / max(0.10, achievable_duration)
    word_count = len(cue_words)

    cost = 0.0
    cost += abs(word_count - profile.target_words) * 7.5
    cost += abs(raw_duration - profile.target_duration) * 16.0
    cost += abs(widest_line - profile.target_width) * 1.8

    if cps > profile.target_cps:
        cost += (cps - profile.target_cps) ** 2 * 18.0
    if cps > 17.5:
        cost += (cps - 17.5) ** 2 * 55.0
    if cps > profile.max_cps - 0.3:
        cost += 3500.0 + (cps - (profile.max_cps - 0.3)) ** 2 * 140.0
    if achievable_duration < profile.min_duration:
        cost += 2200.0 + (profile.min_duration - achievable_duration) * 3500.0
    elif raw_duration < profile.min_duration:
        cost += 700.0 + (profile.min_duration - raw_duration) * 1800.0

    if word_count == 1 and not _standalone_is_valid(cue_words):
        if not is_block_end:
            return math.inf, None, {}
        cost += 6500.0
    elif word_count == 2 and not _standalone_is_valid(cue_words):
        if not is_block_end:
            return math.inf, None, {}
        cost += 3200.0

    first_clean = _clean_token(cue_words[0]["text"])
    last_clean = _clean_token(cue_words[-1]["text"])
    if not is_block_end and not _has_predicate(cue_words):
        if first_clean not in PREPOSITIONS and first_clean not in CLAUSE_STARTERS:
            cost += 380.0
    if last_clean in COMPLEMENT_TAKING and not is_block_end:
        cost += 900.0

    for local_boundary in _local_line_boundaries(cue_words, lines):
        line_cost, _ = _boundary_features(
            cue_words,
            local_boundary,
            profile,
            {},
            line_wrap=True,
        )
        global_boundary = cue_words[local_boundary]["id"]
        if global_boundary in line_protected:
            line_cost += 6000.0
        cost += max(0.0, line_cost)

    boundary_cost = 0.0
    boundary_reasons: List[str] = []
    if not is_block_end:
        boundary_cost, boundary_reasons = _boundary_features(words, end, profile, cue_protected)
        cost += boundary_cost

    return cost, lines, {
        "cps": cps,
        "duration": raw_duration,
        "boundary_cost": boundary_cost,
        "boundary_reasons": boundary_reasons,
    }


def _segment_block(
    words: Sequence[Dict[str, Any]],
    block_start: int,
    block_end: int,
    profile: LayoutProfile,
    cue_protected: Dict[int, str],
    line_protected: Dict[int, str],
) -> List[List[Dict[str, Any]]]:
    count = block_end - block_start
    dp = [math.inf] * (count + 1)
    parent = [-1] * (count + 1)
    dp[0] = 0.0

    for local_end in range(1, count + 1):
        global_end = block_start + local_end
        first_local = max(0, local_end - profile.max_words)
        for local_start in range(first_local, local_end):
            if not math.isfinite(dp[local_start]):
                continue
            global_start = block_start + local_start
            cue_cost, _lines, _details = _cue_cost(
                words,
                global_start,
                global_end,
                profile,
                cue_protected,
                line_protected,
                is_block_end=(global_end == block_end),
            )
            if not math.isfinite(cue_cost):
                continue
            total = dp[local_start] + cue_cost
            if total < dp[local_end]:
                dp[local_end] = total
                parent[local_end] = local_start

    if not math.isfinite(dp[count]):
        raise SubtitleOptimizationError(
            f"No strict DP layout for block {block_start}:{block_end}"
        )

    ranges: List[Tuple[int, int]] = []
    cursor = count
    while cursor > 0:
        previous = parent[cursor]
        if previous < 0:
            raise SubtitleOptimizationError(f"Broken DP chain at {block_start + cursor}")
        ranges.append((block_start + previous, block_start + cursor))
        cursor = previous
    ranges.reverse()
    return [list(words[s:e]) for s, e in ranges]


def _segment_block_fallback(
    words: Sequence[Dict[str, Any]],
    block_start: int,
    block_end: int,
    profile: LayoutProfile,
    cue_protected: Dict[int, str],
    line_protected: Dict[int, str],
) -> Tuple[List[List[Dict[str, Any]]], List[int]]:
    """Lossless emergency segmentation when strict DP constraints cannot all be satisfied simultaneously."""
    count = block_end - block_start

    def solve(*, allow_protected_breaks: bool) -> Optional[Tuple[List[Tuple[int, int]], List[int]]]:
        dp = [math.inf] * (count + 1)
        parent = [-1] * (count + 1)
        relaxed_break = [False] * (count + 1)
        dp[0] = 0.0

        for local_end in range(1, count + 1):
            global_end = block_start + local_end
            first_local = max(0, local_end - profile.max_words)
            for local_start in range(first_local, local_end):
                if not math.isfinite(dp[local_start]):
                    continue
                global_start = block_start + local_start
                cue_words = words[global_start:global_end]
                lines = _wrap_words(
                    cue_words,
                    profile,
                    {} if allow_protected_breaks else line_protected,
                )
                if lines is None:
                    if len(cue_words) == 1:
                        lines = [_display_token(cue_words[0])]
                    else:
                        continue

                breaks_protected = global_end in cue_protected and global_end != block_end
                if breaks_protected and not allow_protected_breaks:
                    continue

                duration = max(0.05, cue_words[-1]["end"] - cue_words[0]["start"])
                widest_line = max(display_width(line) for line in lines)
                cost = abs(len(cue_words) - profile.target_words) * 5.0
                cost += abs(duration - profile.target_duration) * 8.0
                cost += abs(widest_line - profile.target_width)
                if global_end != block_end:
                    b_cost, _ = _boundary_features(words, global_end, profile, cue_protected)
                    cost += max(-300.0, b_cost)
                if breaks_protected:
                    cost += 50000.0

                total = dp[local_start] + cost
                if total < dp[local_end]:
                    dp[local_end] = total
                    parent[local_end] = local_start
                    relaxed_break[local_end] = breaks_protected

        if not math.isfinite(dp[count]):
            return None

        ranges: List[Tuple[int, int]] = []
        relaxed: List[int] = []
        cursor = count
        while cursor > 0:
            prev = parent[cursor]
            if prev < 0:
                return None
            g_end = block_start + cursor
            if relaxed_break[cursor]:
                relaxed.append(g_end)
            ranges.append((block_start + prev, g_end))
            cursor = prev
        ranges.reverse()
        relaxed.reverse()
        return ranges, relaxed

    res = solve(allow_protected_breaks=False)
    if res is None:
        res = solve(allow_protected_breaks=True)
    if res is None:
        raise SubtitleOptimizationError(f"Unable to recover subtitle block {block_start}:{block_end}")
    ranges, relaxed = res
    return [list(words[s:e]) for s, e in ranges], relaxed


def _merge_safe_fragment_cues(
    cue_groups: Sequence[Sequence[Dict[str, Any]]],
    profile: LayoutProfile,
    line_protected: Dict[int, str],
) -> List[List[Dict[str, Any]]]:
    """Rejoin dangling short continuations or sub-0.80s micro-cues when the merged cue
    fits all display and line-wrap limits."""
    merged: List[List[Dict[str, Any]]] = []
    for incoming in cue_groups:
        current = list(incoming)
        if not merged:
            merged.append(current)
            continue

        previous = merged[-1]
        joined = previous + current
        previous_last = previous[-1]
        next_first = current[0]
        first_clean = _clean_token(next_first["text"])
        last_clean = _clean_token(previous_last["text"])
        duration = max(0.05, joined[-1]["end"] - joined[0]["start"])
        wrapped_joined = _wrap_words(joined, profile, line_protected)
        if wrapped_joined is None:
            merged.append(current)
            continue

        text = "\n".join(wrapped_joined)
        cps = _visible_chars(text) / duration
        previous_duration = max(0.05, previous[-1]["end"] - previous[0]["start"])
        current_duration = max(0.05, current[-1]["end"] - current[0]["start"])
        dangling_start = first_clean in PREPOSITIONS | RELATIVES | {"and", "or", "but", "và", "hoặc", "nhưng"}
        dangling_end = last_clean in FORBIDDEN_ENDINGS or last_clean in COMPLEMENT_TAKING
        short_fragment = (
            previous_duration < profile.min_duration
            or current_duration < profile.min_duration
        )
        can_merge = (
            not next_first.get("source_boundary_before")
            and not previous_last.get("hard_sentence_end")
            and len(joined) <= profile.max_words
            and duration <= profile.max_duration
            and cps <= profile.target_cps + 2.2
        )
        if can_merge and (dangling_start or dangling_end or short_fragment):
            merged[-1] = joined
        else:
            merged.append(current)
    return merged


def _audio_duration_from_wav(wav_path: Optional[Path]) -> float:
    if wav_path is None or not wav_path.is_file():
        return 0.0
    try:
        import soundfile as sf

        info = sf.info(str(wav_path))
        return float(info.duration or 0.0)
    except Exception:
        try:
            import wave

            with wave.open(str(wav_path), "rb") as wf:
                return wf.getnframes() / float(wf.getframerate())
        except Exception:
            return 0.0


def _assign_display_times(
    cue_words: Sequence[Sequence[Dict[str, Any]]],
    profile: LayoutProfile,
    audio_duration: float,
    offset_seconds: float = 0.0,
    wav_path: Optional[Path] = None,
) -> List[Tuple[float, float]]:
    """Assign natural display timestamps (Section 3.8):
    - leadIn = 40ms before first word (aligned to -30 dBFS onset when wav_path is provided)
    - tail = 80-120ms after last word, extended to min_reading_duration up to next word - minGap
    - minGap = 60ms when acoustic gap >= 100ms, else 5ms for continuous speech
    """
    if not cue_words:
        return []
    starts: List[float] = []
    for idx, cue in enumerate(cue_words):
        spoken_duration = max(0.0, cue[-1]["end"] - cue[0]["start"])
        available_lead = max(0.0, profile.max_duration - spoken_duration)
        start = max(0.0, cue[0]["start"] - min(0.04, available_lead))
        if idx > 0:
            start = max(start, cue_words[idx - 1][-1]["end"])
        starts.append(start)

    # Align starts to actual speech onset (> -30 dBFS) when ASR pre-roll falls in silence,
    # never pushing start past the first word's spoken start + 40ms.
    if wav_path is not None and Path(wav_path).is_file():
        temp_cues = [
            {
                "start": s,
                "end": max(s + 0.25, cue[-1]["end"]),
                "word_start": cue[0]["start"],
            }
            for s, cue in zip(starts, cue_words)
        ]
        align_cues_to_audio_onset(temp_cues, wav_path, min_db_threshold=-30.0)
        starts = [float(tc["start"]) for tc in temp_cues]

    ends: List[float] = []
    for idx, cue in enumerate(cue_words):
        voice_end = cue[-1]["end"]
        visible_chars = len(_join_tokens([_display_token(word) for word in cue]))
        desired_duration = min(
            profile.max_duration,
            max(profile.min_duration, visible_chars / profile.target_cps),
        )
        desired_end = min(
            starts[idx] + profile.max_duration,
            max(voice_end + 0.10, starts[idx] + desired_duration),
        )
        if idx < len(cue_words) - 1:
            next_voice_start = max(cue_words[idx + 1][0]["start"], starts[idx + 1])
            voice_gap = next_voice_start - voice_end
            display_gap = 0.06 if voice_gap >= 0.12 else 0.005
            latest_end = next_voice_start - display_gap
            end = max(voice_end, min(desired_end, latest_end))
        else:
            end = desired_end
            if audio_duration > 0.0:
                end = min(audio_duration, end)
        ends.append(end)

    times: List[Tuple[float, float]] = []
    previous_end = 0.0
    for idx, (start, end) in enumerate(zip(starts, ends)):
        start = max(previous_end, start)
        end = max(end, cue_words[idx][-1]["end"], start + 0.05)
        if idx < len(starts) - 1:
            end = min(end, starts[idx + 1])
            end = max(end, start + 0.05)
        unshifted_end = end
        start = max(0.0, start + offset_seconds)
        end = max(start + 0.05, end + offset_seconds)
        if audio_duration > 0.0:
            start = min(start, audio_duration)
            end = min(max(start + 0.01, end), audio_duration)
        start = round(start, 3)
        end = round(max(start + 0.001, end), 3)
        times.append((start, end))
        previous_end = unshifted_end

    # Smooth micro-boundaries when a fast cue (> max_cps) or sub-min_duration cue can borrow up to 140ms from surrounding silence or a slow neighbor
    for idx in range(len(times)):
        s, e = times[idx]
        vis_chars = len(_join_tokens([_display_token(w) for w in cue_words[idx]]))
        needed_dur = max(profile.min_duration, vis_chars / (profile.max_cps - 0.1))
        deficit = needed_dur - (e - s)
        if deficit <= 0:
            continue
        # 1. Borrow from silence before s, or from previous cue's post-voice tail hold
        min_allowed_s = (times[idx - 1][1] + 0.005) if idx > 0 else 0.0
        avail_before = max(0.0, min(0.18, s - min_allowed_s))
        if avail_before > 0:
            take = min(deficit, avail_before)
            s = round(s - take, 3)
            times[idx] = (s, e)
            deficit = needed_dur - (e - s)
        if deficit > 0 and idx > 0:
            ps, pe = times[idx - 1]
            prev_voice_end = cue_words[idx - 1][-1]["end"] + offset_seconds
            prev_chars = len(_join_tokens([_display_token(w) for w in cue_words[idx - 1]]))
            prev_min_dur = max(profile.min_duration, prev_chars / (profile.max_cps - 0.5))
            prev_tail_slack = max(0.0, pe - max(prev_voice_end, ps + prev_min_dur))
            avail_prev = min(0.16, prev_tail_slack)
            if avail_prev > 0 and abs(s - pe) <= 0.06:
                take_prev = min(deficit, avail_prev)
                pe = round(pe - take_prev, 3)
                s = round(max(pe + 0.005, s - take_prev), 3)
                times[idx - 1] = (ps, pe)
                times[idx] = (s, e)
                deficit = needed_dur - (e - s)
        # 2. Borrow up to 140ms from next cue if next cue has comfortable CPS (< target_cps)
        if deficit > 0 and idx + 1 < len(times):
            ns, ne = times[idx + 1]
            next_chars = len(_join_tokens([_display_token(w) for w in cue_words[idx + 1]]))
            next_min_dur = max(profile.min_duration, next_chars / (profile.max_cps - 0.5))
            avail_after = max(0.0, min(0.16, (ne - ns) - next_min_dur))
            gap_to_next = max(0.0, ns - e)
            if gap_to_next + avail_after > 0:
                take_gap = min(deficit, max(0.0, gap_to_next - 0.005))
                e = round(e + take_gap, 3)
                deficit -= take_gap
                if deficit > 0 and avail_after > 0 and abs(ns - e) <= 0.01:
                    take_next = min(deficit, avail_after)
                    e = round(e + take_next, 3)
                    ns = round(max(e, ns + take_next), 3)
                    times[idx + 1] = (ns, ne)
                times[idx] = (s, e)

    return times


def align_cues_to_audio_onset(
    cues: List[Dict[str, Any]],
    wav_path: Optional[Path],
    min_db_threshold: float = -30.0,
) -> None:
    """Align cue start timestamps with actual speech onset (> -30 dBFS) within a 300ms window
    (Section 3.8), keeping a 40ms pre-roll and strictly preserving non-overlapping order."""
    if not wav_path:
        return
    path_obj = Path(wav_path)
    if not path_obj.is_file():
        return

    try:
        import numpy as np
        import soundfile as sf

        data, sr = sf.read(str(path_obj))
        if data.size == 0 or sr <= 0:
            return

        amplitude = np.max(np.abs(data), axis=1) if data.ndim > 1 else np.abs(data)
        linear_threshold = 10.0 ** (min_db_threshold / 20.0)
        total_samples = len(amplitude)
        win_size = max(1, int(sr * 0.02))
        step_size = max(1, int(sr * 0.01))

        for idx, cue in enumerate(cues):
            start_sec = float(cue["start"])
            end_sec = float(cue["end"])
            start_sample = int(start_sec * sr)
            if start_sample >= total_samples or start_sample < 0:
                continue

            current_energy = float(
                np.max(amplitude[start_sample : min(total_samples, start_sample + win_size)])
            )
            if current_energy < linear_threshold:
                word_start = float(cue.get("word_start", start_sec + 0.04))
                max_search_sec = min(end_sec - 0.2, start_sec + 0.30, word_start + 0.06)
                max_search_sample = int(max_search_sec * sr)
                curr = start_sample
                found_onset_sample = None
                while curr < max_search_sample and curr < total_samples:
                    win_max = float(np.max(amplitude[curr : min(total_samples, curr + win_size)]))
                    if win_max >= linear_threshold:
                        found_onset_sample = curr
                        break
                    curr += step_size

                if found_onset_sample is not None:
                    refined_start = round(found_onset_sample / float(sr), 3)
                    prev_end = float(cues[idx - 1]["end"]) if idx > 0 else 0.0
                    refined_start = min(word_start, max(prev_end, start_sec, refined_start - 0.04))
                    if refined_start < end_sec - 0.2:
                        cue["start"] = round(refined_start, 3)
                        cue["startSec"] = cue["start"]
    except Exception as e:
        logger.warning(f"Failed to align cues to audio onset: {e}")


def validate_final_cues(
    cues: Sequence[Dict[str, Any]],
    source_words: Sequence[Dict[str, Any]],
    profile: LayoutProfile,
    protected: Dict[int, str],
    audio_duration: float,
    chunk_count: int = 0,
    suspected_hallucinations: Optional[Sequence[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Validate final subtitle cues against hard invariants (Section 3.9)."""
    fatal: List[Dict[str, Any]] = []
    warnings: List[Dict[str, Any]] = []
    checks: Dict[str, Any] = {}

    flattened_words = [word for cue in cues for word in cue.get("words", [])]
    source_ids = [word["id"] for word in source_words]
    output_ids = [word["id"] for word in flattened_words]
    content_ok = source_ids == output_ids
    if not content_ok:
        fatal.append({"code": "CONTENT_INVARIANT", "reason": "Word content/order changed during subtitle optimization"})
    checks["content_invariant"] = {
        "pass": content_ok,
        "source_words": len(source_words),
        "output_words": len(flattened_words),
    }

    # Check 2: Anti-chunk-copying invariant
    chunk_copy_ok = True
    if chunk_count >= 10 or audio_duration >= 120.0:
        min_expected = max(int(chunk_count * 2.5), 25) if chunk_count >= 10 else 25
        if len(cues) < min_expected:
            chunk_copy_ok = False
            fatal.append({
                "code": "CHUNK_COPY_DETECTED",
                "reason": f"Subtitle cue count ({len(cues)}) is too close to chunk count ({chunk_count})",
            })
    checks["anti_chunk_copy"] = {"pass": chunk_copy_ok, "cue_count": len(cues), "chunk_count": chunk_count}

    overlap_violations = []
    layout_violations = []
    forbidden_violations = []
    cps_violations = []
    short_duration_violations = []
    protected_split_violations = []

    for idx, cue in enumerate(cues):
        text = str(cue.get("text", ""))
        lines = text.splitlines() or [text]
        start = float(cue.get("start", cue.get("startSec", 0.0)))
        end = float(cue.get("end", cue.get("endSec", 0.0)))
        duration = max(0.001, end - start)
        cps = _visible_chars(text) / duration
        words = cue.get("words", [])
        cue_number = idx + 1

        if len(lines) > profile.max_lines or any(display_width(line) > profile.max_width for line in lines):
            if len(words) > 1:
                item = {"cue_index": cue_number, "code": "LAYOUT", "text": text}
                layout_violations.append(item)
                warnings.append(item)

        if cps > profile.max_cps + 0.05:
            item = {"cue_index": cue_number, "cps": round(cps, 2), "code": "HIGH_CPS", "text": text}
            cps_violations.append(item)
            warnings.append(item)

        if duration < profile.min_duration - 0.02:
            item = {"cue_index": cue_number, "duration": round(duration, 3), "code": "SHORT_DURATION", "text": text}
            short_duration_violations.append(item)
            warnings.append(item)

        if words and idx < len(cues) - 1:
            last_raw = words[-1]["text"].rstrip()
            last_clean = _clean_token(last_raw)
            has_punct = last_raw.endswith(TERMINAL_PUNCTUATION + CLAUSE_PUNCTUATION)
            if last_clean in FORBIDDEN_ENDINGS and not has_punct:
                item = {"cue_index": cue_number, "code": "FORBIDDEN_ENDING", "word": last_clean, "text": text}
                forbidden_violations.append(item)
                warnings.append(item)
            boundary_id = int(words[-1]["id"]) + 1
            if boundary_id in protected:
                item = {
                    "cue_index": cue_number,
                    "code": "PROTECTED_SPAN_SPLIT",
                    "reason": protected[boundary_id],
                    "text": text,
                }
                protected_split_violations.append(item)
                warnings.append(item)

        if idx > 0:
            prev_end = float(cues[idx - 1].get("end", cues[idx - 1].get("endSec", 0.0)))
            if start < prev_end - 1e-6:
                item = {"cue_index": cue_number, "code": "OVERLAP"}
                overlap_violations.append(item)
                fatal.append(item)
        if end <= start:
            item = {"cue_index": cue_number, "code": "NON_POSITIVE_DURATION"}
            overlap_violations.append(item)
            fatal.append(item)
        if audio_duration > 0.0 and end > audio_duration + 0.05:
            item = {"cue_index": cue_number, "code": "PAST_AUDIO_END"}
            overlap_violations.append(item)
            fatal.append(item)

    checks["layout"] = {"pass": not layout_violations, "violations": layout_violations}
    checks["timing"] = {"pass": not overlap_violations, "violations": overlap_violations}
    checks["forbidden_endings"] = {"pass": not forbidden_violations, "violations": forbidden_violations}
    checks["max_cps"] = {"pass": not cps_violations, "violations": cps_violations}
    checks["min_duration"] = {"pass": not short_duration_violations, "violations": short_duration_violations}
    checks["protected_spans"] = {"pass": not protected_split_violations, "violations": protected_split_violations}
    checks["asr_hallucinations"] = {
        "records": list(suspected_hallucinations or []),
    }

    return {
        "engine": "voxlab_youtube_cinematic_dp",
        "total_cues": len(cues),
        "profile": {
            "format_id": profile.format_id,
            "max_lines": profile.max_lines,
            "max_width": profile.max_width,
            "max_cps": profile.max_cps,
        },
        "checks": checks,
        "fatal_errors": fatal,
        "quality_warnings": warnings,
        "export_allowed": len(fatal) == 0,
    }


def format_srt_timestamp(seconds: float) -> str:
    safe_sec = max(0.0, float(seconds or 0.0))
    total_ms = int(round(safe_sec * 1000))
    ms = total_ms % 1000
    total_s = total_ms // 1000
    s = total_s % 60
    total_m = total_s // 60
    m = total_m % 60
    h = total_m // 60
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def export_cues_to_srt(cues: Sequence[Dict[str, Any]]) -> str:
    blocks: List[str] = []
    for idx, cue in enumerate(cues, start=1):
        start = format_srt_timestamp(float(cue.get("start", cue.get("startSec", 0.0))))
        end = format_srt_timestamp(float(cue.get("end", cue.get("endSec", 0.0))))
        text = str(cue.get("text", "")).strip()
        if not text:
            continue
        blocks.append(f"{idx}\n{start} --> {end}\n{text}")
    return "\n\n".join(blocks) + ("\n" if blocks else "")


def optimize_subtitles_v2(
    segments: Sequence[Any],
    video_format: str = "16:9",
    max_lines: int = 2,
    wav_path: Optional[Path] = None,
    script_text: Optional[str] = None,
    language: str = "en",
    chunk_count: int = 0,
    subtitle_sync_offset_ms: float = 0.0,
    debug_validation_report: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    profile = get_profile(video_format, max_lines)
    words = build_word_sequence(segments)
    if not words:
        return []

    suspected_hallucinations: List[Dict[str, Any]] = []
    words = filter_asr_hallucinations(
        words,
        wav_path=Path(wav_path) if wav_path is not None else None,
        suspected_out=suspected_hallucinations,
    )
    if not words:
        return []

    if script_text and script_text.strip():
        words = recover_orthography_from_script(words, script_text, language=language)

    cue_protected, line_protected = build_protected_boundary_map(words)
    hard_boundaries = mark_hard_boundaries(words, profile, cue_protected=cue_protected)
    all_cue_words: List[List[Dict[str, Any]]] = []
    block_start = 0
    relaxed_protected_boundaries = set()

    for block_end in hard_boundaries:
        try:
            block_cues = _segment_block(
                words,
                block_start,
                block_end,
                profile,
                cue_protected,
                line_protected,
            )
        except SubtitleOptimizationError:
            block_cues, relaxed = _segment_block_fallback(
                words,
                block_start,
                block_end,
                profile,
                cue_protected,
                line_protected,
            )
            relaxed_protected_boundaries.update(relaxed)
        all_cue_words.extend(block_cues)
        block_start = block_end

    all_cue_words = _merge_safe_fragment_cues(all_cue_words, profile, line_protected)

    effective_cue_protected = {
        b: r
        for b, r in cue_protected.items()
        if b not in relaxed_protected_boundaries and b not in hard_boundaries
    }

    audio_duration = _audio_duration_from_wav(Path(wav_path) if wav_path is not None else None)
    display_times = _assign_display_times(
        all_cue_words,
        profile,
        audio_duration,
        float(subtitle_sync_offset_ms) / 1000.0,
        wav_path=Path(wav_path) if wav_path is not None else None,
    )

    cues: List[Dict[str, Any]] = []
    for index, (cue_words, (start, end)) in enumerate(zip(all_cue_words, display_times), start=1):
        lines = _wrap_words(cue_words, profile, line_protected)
        if lines is None:
            lines = _wrap_words(cue_words, profile, {})
        if lines is None:
            rendered = _join_tokens([_display_token(word) for word in cue_words])
            lines = [rendered]
        cues.append({
            "index": index,
            "start": start,
            "end": end,
            "startSec": start,
            "endSec": end,
            "text": "\n".join(lines),
            "words": [dict(word) for word in cue_words],
        })

    report = validate_final_cues(
        cues,
        words,
        profile,
        effective_cue_protected,
        audio_duration,
        chunk_count=chunk_count,
        suspected_hallucinations=suspected_hallucinations,
    )
    if debug_validation_report is not None:
        debug_validation_report.clear()
        debug_validation_report.update(report)

    if report["fatal_errors"]:
        raise SubtitleOptimizationError(
            f"Subtitle validation failed: {report['fatal_errors'][:3]}"
        )
    return cues


# Cache for Master WAV ASR segments so switching aspectRatio / maxLines re-runs only DP
_MASTER_ASR_CACHE: Dict[str, Dict[str, Any]] = {}


def _compute_audio_hash(audio_path: str) -> str:
    try:
        st = os.stat(audio_path)
        h = hashlib.sha256()
        h.update(f"{st.st_size}_{int(st.st_mtime)}".encode("utf-8"))
        with open(audio_path, "rb") as f:
            h.update(f.read(65536))
        return h.hexdigest()[:24]
    except Exception:
        return os.path.abspath(audio_path)


def generate_srt_from_master_audio(
    audio_path: str,
    script_text: Optional[str] = None,
    language: str = "auto",
    aspect_ratio: str = "16:9",
    max_lines: int = 2,
    models_dir: Optional[str] = None,
    model_id: Optional[str] = None,
    chunk_count: int = 0,
    ctx: Any = None,
) -> Dict[str, Any]:
    """Full end-to-end ASR + YouTube Cinematic Subtitle pipeline for Master Audio."""
    from .asr_engine import AsrLifecycleManager, canonicalize_whisper_model_id
    from .audio_quality import resolve_script_language

    if not audio_path or not os.path.isfile(audio_path):
        raise SubtitleOptimizationError(f"Master audio file not found: {audio_path}")

    resolved_lang = resolve_script_language(script_text or "", language)
    canonical_model = canonicalize_whisper_model_id(model_id)
    wav_hash = _compute_audio_hash(audio_path)
    cache_key = f"{wav_hash}_{canonical_model}_{resolved_lang or 'auto'}"

    cached = _MASTER_ASR_CACHE.get(cache_key)
    if cached is not None:
        segments = cached["segments"]
        detected_lang = cached["language"]
        duration_sec = cached["durationSec"]
        used_model_id = cached["modelId"]
    else:
        mgr = AsrLifecycleManager.get_instance()
        model = mgr.get_or_load(model_dir_or_id=model_id, models_dir=models_dir, ctx=ctx)
        used_model_id = mgr.current_model_id or canonical_model
        if ctx:
            ctx.progress(15.0, f"transcribing_master_{used_model_id}")

        segments_iter, info = model.transcribe(
            audio_path,
            language=resolved_lang,
            word_timestamps=True,
            beam_size=5,
            vad_filter=False,
        )
        duration_sec = float(info.duration or 0.0)
        detected_lang = info.language or (resolved_lang or "en")
        segments = []
        for seg in segments_iter:
            if ctx:
                ctx.check_cancelled()
            words_list = [
                {
                    "startSec": round(w.start, 3),
                    "endSec": round(w.end, 3),
                    "word": w.word,
                    "probability": round(w.probability, 4),
                }
                for w in (seg.words or [])
            ]
            segments.append({
                "id": len(segments) + 1,
                "startSec": round(seg.start, 3),
                "endSec": round(seg.end, 3),
                "text": seg.text.strip(),
                "words": words_list,
            })
            if ctx and duration_sec > 0:
                ctx.progress(min(80.0, 15.0 + (seg.end / duration_sec) * 65.0), "transcribing_master")

        _MASTER_ASR_CACHE[cache_key] = {
            "segments": segments,
            "language": detected_lang,
            "durationSec": duration_sec,
            "modelId": used_model_id,
        }

    if ctx:
        ctx.progress(85.0, "optimizing_youtube_subtitles")

    validation_report: Dict[str, Any] = {}
    cues = optimize_subtitles_v2(
        segments=segments,
        video_format=aspect_ratio,
        max_lines=max_lines,
        wav_path=Path(audio_path),
        script_text=script_text,
        language=detected_lang,
        chunk_count=chunk_count,
        debug_validation_report=validation_report,
    )
    srt_content = export_cues_to_srt(cues)

    if ctx:
        ctx.progress(100.0, "subtitle_ready")

    return {
        "srt": srt_content,
        "cues": [
            {
                "index": c["index"],
                "startSec": c["startSec"],
                "endSec": c["endSec"],
                "text": c["text"],
            }
            for c in cues
        ],
        "totalCues": len(cues),
        "durationSec": round(duration_sec, 3),
        "language": detected_lang,
        "asrModelId": used_model_id,
        "validationReport": validation_report,
    }
