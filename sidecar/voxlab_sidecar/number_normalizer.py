"""Full Number Normalizer implementation for VoxLab sidecar."""
from __future__ import annotations

import re
from typing import NamedTuple

EN_ONES = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
    "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19
}
EN_TENS = {
    "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50,
    "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90
}
EN_SCALES = {
    "hundred": 100,
    "thousand": 1_000,
    "million": 1_000_000,
    "billion": 1_000_000_000,
}

VI_ONES = {
    "không": 0, "khong": 0,
    "một": 1, "mot": 1, "mốt": 1,
    "hai": 2,
    "ba": 3,
    "bốn": 4, "bon": 4, "tư": 4, "tu": 4,
    "năm": 5, "nam": 5, "lăm": 5, "lam": 5,
    "sáu": 6, "sau": 6,
    "bảy": 7, "bay": 7,
    "tám": 8, "tam": 8,
    "chín": 9, "chin": 9
}
VI_TENS = {
    "mười": 10, "muoi": 10,
    "mươi": 10, "chục": 10, "chuc": 10
}
VI_SCALES = {
    "trăm": 100, "tram": 100,
    "nghìn": 1_000, "nghin": 1_000, "ngàn": 1_000, "ngan": 1_000,
    "triệu": 1_000_000, "trieu": 1_000_000,
    "tỷ": 1_000_000_000, "ty": 1_000_000_000
}


class NormalizedSpan(NamedTuple):
    canonical: str
    orig_start: int
    orig_end: int
    is_number: bool


def clean_token(s: str) -> str:
    """Strips leading/trailing punctuation except internal numeric characters."""
    t = s.strip(" .,!?;:—–-…()[]\"'“”„«»¿¡")
    return t.lower()


def is_ip_address(s: str) -> bool:
    """Checks whether token is an IPv4 address like 127.0.0.1."""
    parts = s.split(".")
    if len(parts) == 4 and all(p.isdigit() and 0 <= int(p) <= 255 for p in parts):
        return True
    return False


def normalize_digit_string(token: str) -> str:
    """Normalizes string containing digits: e.g. '1,000' -> '1000', '10:30' -> '10:30'.
    Preserves IP addresses, version numbers like '2.0', decimals '3.14'.
    """
    cleaned = clean_token(token)
    if is_ip_address(cleaned):
        return cleaned

    # Time format e.g. 10:30
    if re.fullmatch(r"\d{1,2}:\d{2}", cleaned):
        return cleaned

    # Check comma-separated thousands: e.g. 1,000 or 10,000,000
    if re.fullmatch(r"\d{1,3}(,\d{3})+", cleaned):
        return cleaned.replace(",", "")

    # Dot-separated thousands in VN: e.g. 1.000 or 10.000.000 (3 digits per group)
    if re.fullmatch(r"\d{1,3}(\.\d{3})+", cleaned):
        return cleaned.replace(".", "")

    # Decimals: e.g. 3.14 or -3.14
    if re.fullmatch(r"-?\d+\.\d+", cleaned):
        return cleaned

    # Percentages: e.g. 50%
    if re.fullmatch(r"-?\d+%", cleaned):
        return cleaned

    # Standard integer
    if re.fullmatch(r"-?\d+", cleaned):
        return cleaned

    return cleaned


def parse_english_number_phrase(words: list[str], start_idx: int) -> tuple[str | None, int]:
    """Tries to parse an English number expression starting at start_idx.
    Returns (canonical_string, count_of_words_consumed).
    """
    n = len(words)
    if start_idx >= n:
        return None, 0

    w0 = clean_token(words[start_idx])
    is_neg = False
    offset = 0
    if w0 in ("minus", "negative"):
        is_neg = True
        offset += 1
        if start_idx + offset >= n:
            return None, 0
        w0 = clean_token(words[start_idx + offset])

    idx = start_idx + offset

    # 1. Decimal format: e.g. "three point one four" -> "3.14"
    point_idx = -1
    for k in range(idx, min(n, idx + 5)):
        if clean_token(words[k]) == "point":
            point_idx = k
            break

    if point_idx != -1 and point_idx > idx:
        whole_str, whole_consumed = parse_english_number_phrase(words[:point_idx], idx)
        if whole_str is not None and (idx + whole_consumed == point_idx):
            frac_digits = []
            f_idx = point_idx + 1
            while f_idx < n:
                fw = clean_token(words[f_idx])
                if fw in EN_ONES and EN_ONES[fw] < 10:
                    frac_digits.append(str(EN_ONES[fw]))
                    f_idx += 1
                elif fw in ("zero", "oh"):
                    frac_digits.append("0")
                    f_idx += 1
                elif fw.isdigit():
                    frac_digits.append(fw)
                    f_idx += 1
                else:
                    break
            if frac_digits:
                total_consumed = (f_idx - start_idx)
                canonical = f"{whole_str}.{''.join(frac_digits)}"
                if is_neg:
                    canonical = f"-{canonical}"
                return canonical, total_consumed

    # 2. Time format: e.g. "ten thirty" -> "10:30"
    if idx + 1 < n:
        w_h = clean_token(words[idx])
        w_m = clean_token(words[idx + 1])
        h_val = EN_ONES.get(w_h) or (int(w_h) if w_h.isdigit() and 1 <= int(w_h) <= 12 else None)
        if h_val is not None and 1 <= h_val <= 12:
            m_val = None
            m_consumed = 0
            if w_m in EN_ONES and 10 <= EN_ONES[w_m] <= 19:
                m_val = EN_ONES[w_m]
                m_consumed = 1
            elif w_m in EN_TENS:
                m_val = EN_TENS[w_m]
                m_consumed = 1
                if idx + 2 < n:
                    w_m2 = clean_token(words[idx + 2])
                    if w_m2 in EN_ONES and 1 <= EN_ONES[w_m2] <= 9:
                        m_val += EN_ONES[w_m2]
                        m_consumed = 2
            elif w_m in ("oclock", "o'clock"):
                m_val = 0
                m_consumed = 1
            if m_val is not None and 0 <= m_val <= 59:
                time_str = f"{h_val}:{m_val:02d}"
                return time_str, offset + 1 + m_consumed

    # 3. Year format: e.g. "twenty twenty six" -> "2026", "nineteen ninety five" -> "1995"
    if idx + 1 < n:
        w1 = clean_token(words[idx])
        c_val = None
        if w1 in ("nineteen", "twenty"):
            c_val = EN_ONES.get(w1) or EN_TENS.get(w1)
        if c_val is not None:
            w2 = clean_token(words[idx + 1])
            y_val = None
            y_consumed = 0
            if w2 in ("oh", "zero") and idx + 2 < n:
                w3 = clean_token(words[idx + 2])
                if w3 in EN_ONES and 1 <= EN_ONES[w3] <= 9:
                    y_val = EN_ONES[w3]
                    y_consumed = 2
            elif w2 in EN_ONES and 10 <= EN_ONES[w2] <= 19:
                y_val = EN_ONES[w2]
                y_consumed = 1
            elif w2 in EN_TENS:
                y_val = EN_TENS[w2]
                y_consumed = 1
                if idx + 2 < n:
                    w3 = clean_token(words[idx + 2])
                    if w3 in EN_ONES and 1 <= EN_ONES[w3] <= 9:
                        y_val += EN_ONES[w3]
                        y_consumed = 2
            if y_val is not None:
                year_str = str(c_val * 100 + y_val)
                return year_str, offset + 1 + y_consumed

    # 4. Standard Integer: hundreds, thousands, millions
    current = 0
    total = 0
    words_consumed = 0
    valid_number_found = False

    while idx < n:
        w = clean_token(words[idx])
        if w in EN_ONES:
            current += EN_ONES[w]
            words_consumed += 1
            valid_number_found = True
            idx += 1
        elif w in EN_TENS:
            t_val = EN_TENS[w]
            words_consumed += 1
            valid_number_found = True
            idx += 1
            # Check trailing ones (e.g. fifty five -> 55)
            if idx < n:
                next_w = clean_token(words[idx])
                if next_w in EN_ONES and 1 <= EN_ONES[next_w] <= 9:
                    t_val += EN_ONES[next_w]
                    words_consumed += 1
                    idx += 1
            current += t_val
        elif w == "hundred":
            if current == 0:
                current = 1
            current *= 100
            words_consumed += 1
            valid_number_found = True
            idx += 1
        elif w in ("thousand", "million", "billion"):
            scale = EN_SCALES[w]
            if current == 0:
                current = 1
            total += current * scale
            current = 0
            words_consumed += 1
            valid_number_found = True
            idx += 1
        elif w == "and" and valid_number_found and idx + 1 < n and clean_token(words[idx + 1]) in (EN_ONES | EN_TENS):
            words_consumed += 1
            idx += 1
        else:
            break

    if valid_number_found:
        total += current
        if idx < n and clean_token(words[idx]) in ("percent", "%"):
            return f"{total}%", offset + words_consumed + 1
        res = f"-{total}" if is_neg else str(total)
        return res, offset + words_consumed

    return None, 0


def parse_vietnamese_number_phrase(words: list[str], start_idx: int) -> tuple[str | None, int]:
    """Tries to parse a Vietnamese number expression starting at start_idx.
    Returns (canonical_string, count_of_words_consumed).
    """
    n = len(words)
    if start_idx >= n:
        return None, 0

    w0 = clean_token(words[start_idx])
    is_neg = False
    offset = 0
    if w0 in ("âm", "am", "trừ", "tru"):
        is_neg = True
        offset += 1
        if start_idx + offset >= n:
            return None, 0
        w0 = clean_token(words[start_idx + offset])

    idx = start_idx + offset

    # 1. Decimal format: e.g. "ba phẩy một bốn" -> "3.14"
    point_idx = -1
    for k in range(idx, min(n, idx + 5)):
        if clean_token(words[k]) in ("phẩy", "phay", "chấm", "cham"):
            point_idx = k
            break

    if point_idx != -1 and point_idx > idx:
        whole_str, whole_consumed = parse_vietnamese_number_phrase(words[:point_idx], idx)
        if whole_str is not None and (idx + whole_consumed == point_idx):
            frac_digits = []
            f_idx = point_idx + 1
            while f_idx < n:
                fw = clean_token(words[f_idx])
                if fw in VI_ONES:
                    frac_digits.append(str(VI_ONES[fw]))
                    f_idx += 1
                elif fw.isdigit():
                    frac_digits.append(fw)
                    f_idx += 1
                else:
                    break
            if frac_digits:
                total_consumed = (f_idx - start_idx)
                canonical = f"{whole_str}.{''.join(frac_digits)}"
                if is_neg:
                    canonical = f"-{canonical}"
                return canonical, total_consumed

    # 2. Time format: e.g. "mười giờ ba mươi" -> "10:30"
    if idx + 2 < n and clean_token(words[idx + 1]) in ("giờ", "gio"):
        w_h = clean_token(words[idx])
        h_val = VI_ONES.get(w_h) or VI_TENS.get(w_h) or (int(w_h) if w_h.isdigit() and 0 <= int(w_h) <= 23 else None)
        if h_val is not None:
            m_str, m_consumed = parse_vietnamese_number_phrase(words, idx + 2)
            if m_str is not None and m_str.isdigit() and 0 <= int(m_str) <= 59:
                return f"{h_val}:{int(m_str):02d}", offset + 2 + m_consumed

    # 3. Standard Integer: trăm, nghìn, triệu, tỷ
    current = 0
    total = 0
    words_consumed = 0
    valid_number_found = False

    while idx < n:
        w = clean_token(words[idx])
        if w in VI_ONES:
            digit = VI_ONES[w]
            words_consumed += 1
            valid_number_found = True
            idx += 1
            # Check if followed by "mươi" / "chục" (e.g. năm mươi lăm -> 55)
            if idx < n and clean_token(words[idx]) in ("mươi", "muoi", "chục", "chuc"):
                words_consumed += 1
                idx += 1
                t_val = digit * 10
                if idx < n and clean_token(words[idx]) in VI_ONES:
                    t_val += VI_ONES[clean_token(words[idx])]
                    words_consumed += 1
                    idx += 1
                current += t_val
            elif idx < n and clean_token(words[idx]) in ("trăm", "tram"):
                words_consumed += 1
                idx += 1
                current += digit * 100
            elif idx < n and clean_token(words[idx]) in ("nghìn", "nghin", "ngàn", "ngan"):
                words_consumed += 1
                idx += 1
                total += (current + digit) * 1000
                current = 0
            elif idx < n and clean_token(words[idx]) in ("triệu", "trieu"):
                words_consumed += 1
                idx += 1
                total += (current + digit) * 1_000_000
                current = 0
            elif idx < n and clean_token(words[idx]) in ("tỷ", "ty"):
                words_consumed += 1
                idx += 1
                total += (current + digit) * 1_000_000_000
                current = 0
            else:
                current += digit
        elif w in ("mười", "muoi"):
            words_consumed += 1
            valid_number_found = True
            idx += 1
            m_val = 10
            if idx < n and clean_token(words[idx]) in VI_ONES and 1 <= VI_ONES[clean_token(words[idx])] <= 9:
                m_val += VI_ONES[clean_token(words[idx])]
                words_consumed += 1
                idx += 1
            current += m_val
        elif w in ("trăm", "tram"):
            if current == 0:
                current = 1
            current *= 100
            words_consumed += 1
            valid_number_found = True
            idx += 1
        elif w in ("nghìn", "nghin", "ngàn", "ngan"):
            if current == 0:
                current = 1
            total += current * 1000
            current = 0
            words_consumed += 1
            valid_number_found = True
            idx += 1
        elif w in ("triệu", "trieu"):
            if current == 0:
                current = 1
            total += current * 1_000_000
            current = 0
            words_consumed += 1
            valid_number_found = True
            idx += 1
        elif w in ("tỷ", "ty"):
            if current == 0:
                current = 1
            total += current * 1_000_000_000
            current = 0
            words_consumed += 1
            valid_number_found = True
            idx += 1
        elif w in ("linh", "lẻ", "le") and valid_number_found and idx + 1 < n and clean_token(words[idx + 1]) in VI_ONES:
            words_consumed += 2
            current += VI_ONES[clean_token(words[idx + 1])]
            idx += 2
        else:
            break

    if valid_number_found:
        total += current
        if idx + 1 < n and clean_token(words[idx]) in ("phần", "phan") and clean_token(words[idx + 1]) in ("trăm", "tram"):
            return f"{total}%", offset + words_consumed + 2
        res = f"-{total}" if is_neg else str(total)
        return res, offset + words_consumed

    return None, 0


def collapse_number_tokens(words: list[str], language: str | None = None) -> list[NormalizedSpan]:
    """Collapses multi-word number expressions into normalized canonical tokens.
    Preserves exact original index bounds [orig_start, orig_end).
    """
    spans: list[NormalizedSpan] = []
    n = len(words)
    idx = 0

    is_vi = language and language.startswith("vi")

    while idx < n:
        raw_w = words[idx]
        cleaned = clean_token(raw_w)

        # Check if already a numeric token (e.g. '300', '1,000', '3.14', '127.0.0.1')
        norm_digit = normalize_digit_string(raw_w)
        if norm_digit != cleaned or re.search(r"\d", cleaned):
            spans.append(NormalizedSpan(
                canonical=norm_digit,
                orig_start=idx,
                orig_end=idx + 1,
                is_number=True,
            ))
            idx += 1
            continue

        # Try parsing multi-word number phrase
        val = None
        consumed = 0
        if is_vi:
            val, consumed = parse_vietnamese_number_phrase(words, idx)
        else:
            val, consumed = parse_english_number_phrase(words, idx)
            # If English failed but text might be VN, try VN as fallback
            if val is None:
                val, consumed = parse_vietnamese_number_phrase(words, idx)

        if val is not None and consumed > 0:
            spans.append(NormalizedSpan(
                canonical=val,
                orig_start=idx,
                orig_end=idx + consumed,
                is_number=True,
            ))
            idx += consumed
        else:
            # Regular word
            spans.append(NormalizedSpan(
                canonical=clean_token(raw_w),
                orig_start=idx,
                orig_end=idx + 1,
                is_number=False,
            ))
            idx += 1

    return spans


def are_number_expressions_equivalent(expr1: str, expr2: str, language: str | None = None) -> bool:
    """Checks whether two expressions represent the exact same numeric value."""
    s1 = collapse_number_tokens(expr1.split(), language)
    s2 = collapse_number_tokens(expr2.split(), language)
    if len(s1) == 1 and len(s2) == 1 and s1[0].is_number and s2[0].is_number:
        return s1[0].canonical == s2[0].canonical
    return False
