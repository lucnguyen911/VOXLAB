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
    "milion": 1_000_000,  # common transcription/script spelling of million
    "billion": 1_000_000_000,
}

EN_ORDINALS = {
    "first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5,
    "sixth": 6, "seventh": 7, "eighth": 8, "ninth": 9, "tenth": 10,
    "eleventh": 11, "twelfth": 12, "thirteenth": 13, "fourteenth": 14, "fifteenth": 15,
    "sixteenth": 16, "seventeenth": 17, "eighteenth": 18, "nineteenth": 19,
    "twentieth": 20, "thirtieth": 30, "fortieth": 40, "fiftieth": 50,
    "sixtieth": 60, "seventieth": 70, "eightieth": 80, "ninetieth": 90,
    "hundredth": 100, "thousandth": 1000, "millionth": 1000000, "billionth": 1000000000,
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
VI_ORDINALS = {
    "nhất": 1, "nhat": 1, "nhì": 2, "nhi": 2, "tư": 4, "tu": 4,
}


def format_ordinal(num: int) -> str:
    """Formats an integer into an English ordinal string: e.g. 1 -> '1st', 2 -> '2nd', 23 -> '23rd'."""
    val = abs(num)
    if 11 <= (val % 100) <= 13:
        suffix = "th"
    else:
        last = val % 10
        if last == 1:
            suffix = "st"
        elif last == 2:
            suffix = "nd"
        elif last == 3:
            suffix = "rd"
        else:
            suffix = "th"
    return f"{num}{suffix}"


def has_trailing_boundary(s: str) -> bool:
    """Checks whether token ends with a clause boundary punctuation mark."""
    return bool(re.search(r"[,;:.!?—–\)\]]+$", s))


class NormalizedSpan(NamedTuple):
    canonical: str
    orig_start: int
    orig_end: int
    is_number: bool


def clean_token(s: str) -> str:
    """Strips leading/trailing punctuation except internal numeric characters and negative signs."""
    is_neg_number = bool(re.match(r"^-\d", s.strip()))
    t = s.strip(" .,!?;:—–-…()[]\"'“”„«»¿¡").lower()
    if is_neg_number and not t.startswith("-"):
        t = f"-{t}"
    return t


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
    if re.match(r"^[$€£¥₫]-?\d", cleaned):
        cleaned = cleaned[1:]
    elif re.search(r"\d[$€£¥₫]$", cleaned):
        cleaned = cleaned[:-1]

    if is_ip_address(cleaned):
        return cleaned

    # Time format e.g. 10:30
    if re.fullmatch(r"\d{1,2}:\d{2}", cleaned):
        return cleaned

    # Check comma-separated thousands (with optional decimal and %): e.g. 1,000 or 5,922.50 or 10,000,000
    if re.fullmatch(r"-?\d{1,3}(,\d{3})+(?:\.\d+)?%?", cleaned):
        return cleaned.replace(",", "")

    # Dot-separated thousands in VN: e.g. 1.000 or 10.000.000 (3 digits per group)
    if re.fullmatch(r"-?\d{1,3}(\.\d{3})+", cleaned):
        return cleaned.replace(".", "")

    # Decimals with comma: e.g. 0,8 or 13,5 or 3,14 (not thousands like 1,000 or 10,000)
    if re.fullmatch(r"-?\d+,\d+%?", cleaned) and not re.fullmatch(r"-?\d{1,3}(,\d{3})+(?:\.\d+)?%?", cleaned):
        return cleaned.replace(",", ".")

    # Decimals: e.g. 3.14 or -3.14
    if re.fullmatch(r"-?\d+\.\d+", cleaned):
        return cleaned

    # Percentages: e.g. 50% or 13.5%
    if re.fullmatch(r"-?\d+(?:\.\d+)?%", cleaned):
        return cleaned

    # Ordinal digit format: e.g. 1st, 2nd, 3rd, 23rd, 28th
    if re.fullmatch(r"-?\d+(st|nd|rd|th)", cleaned):
        return cleaned

    # Standard integer
    if re.fullmatch(r"-?\d+", cleaned):
        return cleaned

    return cleaned


def is_decimal_number_string(s: str) -> bool:
    """Checks whether token represents a decimal number string like '3.14' or '-0.8'."""
    cleaned = clean_token(s)
    if re.fullmatch(r"-?\d+,\d+", cleaned) and not re.fullmatch(r"-?\d{1,3}(,\d{3})+", cleaned):
        cleaned = cleaned.replace(",", ".")
    return bool(re.fullmatch(r"-?\d+\.\d+", cleaned))


def split_decimal_parts(s: str) -> tuple[str, str] | None:
    """Splits decimal string into (whole_part, frac_part), e.g. '0.8' -> ('0', '8')."""
    cleaned = clean_token(s)
    if re.fullmatch(r"-?\d+,\d+", cleaned) and not re.fullmatch(r"-?\d{1,3}(,\d{3})+", cleaned):
        cleaned = cleaned.replace(",", ".")
    if not re.fullmatch(r"-?\d+\.\d+", cleaned):
        return None
    whole, frac = cleaned.split(".", 1)
    return whole, frac


def parse_english_number_phrase(
    words: list[str],
    start_idx: int,
    delimiters: list[str] | None = None,
) -> tuple[str | None, int]:
    """Tries to parse an English number expression starting at start_idx.
    Returns (canonical_string, count_of_words_consumed).
    """
    n = len(words)
    if start_idx >= n:
        return None, 0

    def is_word_boundary(w_idx: int) -> bool:
        if delimiters is not None and w_idx + 1 < len(delimiters):
            if any(c in ",;:.!?—–()[]\"'“”\n\r" for c in delimiters[w_idx + 1]):
                return True
        if w_idx < len(words) and has_trailing_boundary(words[w_idx]):
            return True
        return False

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
        whole_str, whole_consumed = parse_english_number_phrase(words[:point_idx], idx, delimiters)
        if whole_str is not None and (idx + whole_consumed == point_idx):
            frac_digits = []
            f_idx = point_idx + 1
            while f_idx < n:
                fw = clean_token(words[f_idx])
                hit_f_bound = is_word_boundary(f_idx)
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
                if hit_f_bound:
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
        if h_val is not None and 1 <= h_val <= 12 and not is_word_boundary(idx):
            m_val = None
            m_consumed = 0
            if w_m in EN_ONES and 10 <= EN_ONES[w_m] <= 19:
                m_val = EN_ONES[w_m]
                m_consumed = 1
            elif w_m in EN_TENS:
                m_val = EN_TENS[w_m]
                m_consumed = 1
                if idx + 2 < n and not is_word_boundary(idx + 1):
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
    if idx + 1 < n and not is_word_boundary(idx):
        w1 = clean_token(words[idx])
        c_val = None
        if w1 in ("nineteen", "twenty"):
            c_val = EN_ONES.get(w1) or EN_TENS.get(w1)
        if c_val is not None:
            w2 = clean_token(words[idx + 1])
            y_val = None
            y_consumed = 0
            if w2 in ("oh", "zero") and idx + 2 < n and not is_word_boundary(idx + 1):
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
                if idx + 2 < n and not is_word_boundary(idx + 1):
                    w3 = clean_token(words[idx + 2])
                    if w3 in EN_ONES and 1 <= EN_ONES[w3] <= 9:
                        y_val += EN_ONES[w3]
                        y_consumed = 2
            if y_val is not None:
                year_str = str(c_val * 100 + y_val)
                return year_str, offset + 1 + y_consumed

    # 3b. Spoken digit-by-digit sequence: e.g. "four six eight zero" -> "4680"
    en_single_digits = {
        "zero": "0", "oh": "0", "one": "1", "two": "2", "three": "3", "four": "4",
        "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9",
    }
    if idx + 1 < n and clean_token(words[idx]) in en_single_digits:
        digit_run: list[str] = []
        d_idx = idx
        while d_idx < n:
            dw = clean_token(words[d_idx])
            if dw not in en_single_digits:
                break
            if d_idx + 1 < n and not is_word_boundary(d_idx) and clean_token(words[d_idx + 1]) in (
                "hundred", "thousand", "million", "milion", "billion", "point", "oclock", "o'clock"
            ):
                break
            digit_run.append(en_single_digits[dw])
            d_idx += 1
            if is_word_boundary(d_idx - 1):
                break
        if len(digit_run) >= 2:
            res = "".join(digit_run)
            return f"-{res}" if is_neg else res, offset + len(digit_run)

    # 4. Standard Integer and Ordinal: hundreds, thousands, millions
    current = 0
    total = 0
    words_consumed = 0
    valid_number_found = False
    is_ordinal = False
    min_scale_applied: int | None = None

    while idx < n:
        w = clean_token(words[idx])
        hit_boundary = is_word_boundary(idx)

        if (
            w == "a"
            and idx == start_idx + offset
            and not hit_boundary
            and idx + 1 < n
            and clean_token(words[idx + 1]) in ("hundred", "thousand", "million", "milion", "billion")
        ):
            current += 1
            words_consumed += 1
            valid_number_found = True
            idx += 1
            continue
        elif w in EN_ONES:
            if current % 100 != 0:
                break
            current += EN_ONES[w]
            words_consumed += 1
            valid_number_found = True
            idx += 1
            if hit_boundary:
                break
        elif w in EN_TENS:
            if current % 100 != 0:
                break
            t_val = EN_TENS[w]
            words_consumed += 1
            valid_number_found = True
            idx += 1
            if hit_boundary:
                current += t_val
                break
            # Check trailing ones or ordinals (e.g. fifty five -> 55, twenty third -> 23rd)
            if idx < n:
                next_w = clean_token(words[idx])
                next_boundary = is_word_boundary(idx)
                if next_w in EN_ONES and 1 <= EN_ONES[next_w] <= 9:
                    t_val += EN_ONES[next_w]
                    words_consumed += 1
                    idx += 1
                    current += t_val
                    if next_boundary:
                        break
                    continue
                elif next_w in EN_ORDINALS and 1 <= EN_ORDINALS[next_w] <= 9:
                    t_val += EN_ORDINALS[next_w]
                    words_consumed += 1
                    idx += 1
                    current += t_val
                    is_ordinal = True
                    break
            current += t_val
        elif "-" in w and len(w.split("-")) == 2 and w.split("-")[0] in EN_TENS and (
            (w.split("-")[1] in EN_ONES and 1 <= EN_ONES[w.split("-")[1]] <= 9)
            or (w.split("-")[1] in EN_ORDINALS and 1 <= EN_ORDINALS[w.split("-")[1]] <= 9)
        ):
            if current % 100 != 0:
                break
            p_tens, p_ones = w.split("-")
            t_val = EN_TENS[p_tens]
            if p_ones in EN_ONES:
                t_val += EN_ONES[p_ones]
                current += t_val
                words_consumed += 1
                valid_number_found = True
                idx += 1
                if hit_boundary:
                    break
            else:
                t_val += EN_ORDINALS[p_ones]
                current += t_val
                words_consumed += 1
                valid_number_found = True
                is_ordinal = True
                idx += 1
                break
        elif w in EN_ORDINALS:
            if current % 100 != 0:
                break
            if w == "second" and (
                words[idx].strip().startswith(("-", "–"))
                or (
                    idx == start_idx + offset
                    and start_idx > 0
                    and (
                        re.search(r"\d", words[start_idx - 1])
                        or clean_token(words[start_idx - 1])
                        in (set(EN_ONES) | set(EN_TENS) | set(EN_SCALES) | {"a", "one", "per", "every", "split"})
                    )
                )
            ):
                break
            current += EN_ORDINALS[w]
            words_consumed += 1
            valid_number_found = True
            is_ordinal = True
            idx += 1
            break
        elif w == "hundred":
            if current >= 100:
                break
            if current == 0:
                current = 1
            current *= 100
            words_consumed += 1
            valid_number_found = True
            idx += 1
            if hit_boundary:
                break
        elif w in ("thousand", "million", "milion", "billion"):
            scale = EN_SCALES[w]
            if min_scale_applied is not None and scale >= min_scale_applied:
                break
            if current == 0:
                current = 1
            total += current * scale
            current = 0
            min_scale_applied = scale
            words_consumed += 1
            valid_number_found = True
            idx += 1
            if hit_boundary:
                break
        elif (
            w == "and"
            and valid_number_found
            and (total > 0 or current >= 100)
            and current % 100 == 0
            and idx + 1 < n
            and clean_token(words[idx + 1]) in (EN_ONES | EN_TENS | EN_ORDINALS)
        ):
            # Look ahead past the <100 value after 'and': if it is followed by 'hundred',
            # 'thousand', 'million', or 'billion' (e.g. "eleven thousand five hundred and thirteen thousand five hundred"),
            # then 'and' is a coordinating conjunction between two separate numbers, NOT an internal number connector.
            next_num_w = clean_token(words[idx + 1])
            after_next_idx = idx + 2
            if (
                next_num_w in EN_TENS
                and after_next_idx < n
                and clean_token(words[after_next_idx]) in (EN_ONES | EN_ORDINALS)
                and 1 <= (EN_ONES.get(clean_token(words[after_next_idx])) or EN_ORDINALS.get(clean_token(words[after_next_idx])) or 0) <= 9
            ):
                after_next_idx += 1
            if after_next_idx < n:
                after_scale_w = clean_token(words[after_next_idx])
                if after_scale_w == "hundred":
                    break
                if after_scale_w in ("thousand", "million", "milion", "billion"):
                    next_scale = EN_SCALES[after_scale_w]
                    if (
                        current < 100
                        or next_num_w in ("one", "a")
                        or (start_idx > 0 and clean_token(words[start_idx - 1]) == "between")
                        or (min_scale_applied is not None and next_scale >= min_scale_applied)
                    ):
                        break
            if (
                start_idx > 0
                and clean_token(words[start_idx - 1]) == "between"
                and not (after_next_idx < n and clean_token(words[after_next_idx]) == "and")
            ):
                break
            words_consumed += 1
            idx += 1
        else:
            break

    if valid_number_found:
        total += current
        if is_ordinal:
            res = format_ordinal(total)
            return f"-{res}" if is_neg else res, offset + words_consumed
        if idx < n and clean_token(words[idx]) in ("percent", "%"):
            return f"{total}%", offset + words_consumed + 1
        res = f"-{total}" if is_neg else str(total)
        return res, offset + words_consumed

    return None, 0


def parse_vietnamese_number_phrase(
    words: list[str],
    start_idx: int,
    delimiters: list[str] | None = None,
) -> tuple[str | None, int]:
    """Tries to parse a Vietnamese number expression starting at start_idx.
    Returns (canonical_string, count_of_words_consumed).
    """
    n = len(words)
    if start_idx >= n:
        return None, 0

    def is_word_boundary(w_idx: int) -> bool:
        if delimiters is not None and w_idx + 1 < len(delimiters):
            if any(c in ",;:.!?—–()[]\"'“”\n\r" for c in delimiters[w_idx + 1]):
                return True
        if w_idx < len(words) and has_trailing_boundary(words[w_idx]):
            return True
        return False

    w0 = clean_token(words[start_idx])

    # Ordinal format: e.g. "thứ nhất", "thứ hai", "thứ ba", "thứ 23"
    if w0 in ("thứ", "thu") and start_idx + 1 < n and not is_word_boundary(start_idx):
        next_w = clean_token(words[start_idx + 1])
        if next_w in VI_ORDINALS:
            return f"thứ {VI_ORDINALS[next_w]}", 2
        norm_next = normalize_digit_string(words[start_idx + 1])
        if norm_next.isdigit() or re.fullmatch(r"-?\d+", norm_next):
            return f"thứ {norm_next}", 2
        sub_str, sub_consumed = parse_vietnamese_number_phrase(words, start_idx + 1, delimiters)
        if sub_str is not None and sub_consumed > 0:
            return f"thứ {sub_str}", 1 + sub_consumed

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
        whole_str, whole_consumed = parse_vietnamese_number_phrase(words[:point_idx], idx, delimiters)
        if whole_str is not None and (idx + whole_consumed == point_idx):
            frac_digits = []
            f_idx = point_idx + 1
            while f_idx < n:
                fw = clean_token(words[f_idx])
                hit_f_bound = is_word_boundary(f_idx)
                if fw in VI_ONES:
                    frac_digits.append(str(VI_ONES[fw]))
                    f_idx += 1
                elif fw.isdigit():
                    frac_digits.append(fw)
                    f_idx += 1
                else:
                    break
                if hit_f_bound:
                    break
            if frac_digits:
                total_consumed = (f_idx - start_idx)
                canonical = f"{whole_str}.{''.join(frac_digits)}"
                if is_neg:
                    canonical = f"-{canonical}"
                return canonical, total_consumed

    # 2. Time format: e.g. "mười giờ ba mươi" -> "10:30"
    if idx + 2 < n and clean_token(words[idx + 1]) in ("giờ", "gio") and not is_word_boundary(idx) and not is_word_boundary(idx + 1):
        w_h = clean_token(words[idx])
        h_val = VI_ONES.get(w_h) or VI_TENS.get(w_h) or (int(w_h) if w_h.isdigit() and 0 <= int(w_h) <= 23 else None)
        if h_val is not None:
            m_str, m_consumed = parse_vietnamese_number_phrase(words, idx + 2, delimiters)
            if m_str is not None and m_str.isdigit() and 0 <= int(m_str) <= 59:
                return f"{h_val}:{int(m_str):02d}", offset + 2 + m_consumed

    # 2b. Spoken digit-by-digit sequence in Vietnamese: e.g. "bốn sáu tám không" -> "4680"
    if idx + 1 < n and clean_token(words[idx]) in VI_ONES:
        digit_run_vi: list[str] = []
        d_idx = idx
        while d_idx < n:
            dw = clean_token(words[d_idx])
            if dw not in VI_ONES:
                break
            if d_idx + 1 < n and not is_word_boundary(d_idx) and clean_token(words[d_idx + 1]) in (
                "mươi", "muoi", "chục", "chuc", "trăm", "tram",
                "nghìn", "nghin", "ngàn", "ngan", "triệu", "trieu",
                "tỷ", "ty", "giờ", "gio", "phẩy", "phay", "chấm", "cham"
            ):
                break
            digit_run_vi.append(str(VI_ONES[dw]))
            d_idx += 1
            if is_word_boundary(d_idx - 1):
                break
        if len(digit_run_vi) >= 2:
            res = "".join(digit_run_vi)
            return f"-{res}" if is_neg else res, offset + len(digit_run_vi)

    # 3. Standard Integer: trăm, nghìn, triệu, tỷ
    current = 0
    total = 0
    words_consumed = 0
    valid_number_found = False

    while idx < n:
        w = clean_token(words[idx])
        hit_boundary = is_word_boundary(idx)

        if w in VI_ONES:
            digit = VI_ONES[w]
            words_consumed += 1
            valid_number_found = True
            idx += 1
            if hit_boundary:
                current += digit
                break
            # Check if followed by "mươi" / "chục" (e.g. năm mươi lăm -> 55)
            if idx < n and clean_token(words[idx]) in ("mươi", "muoi", "chục", "chuc"):
                hit_muoi_bound = is_word_boundary(idx)
                words_consumed += 1
                idx += 1
                t_val = digit * 10
                if not hit_muoi_bound and idx < n and clean_token(words[idx]) in VI_ONES:
                    hit_sub_bound = is_word_boundary(idx)
                    t_val += VI_ONES[clean_token(words[idx])]
                    words_consumed += 1
                    idx += 1
                    current += t_val
                    if hit_sub_bound:
                        break
                    continue
                current += t_val
                if hit_muoi_bound:
                    break
            elif idx < n and clean_token(words[idx]) in ("trăm", "tram"):
                words_consumed += 1
                idx += 1
                current += digit * 100
                if is_word_boundary(idx - 1):
                    break
            elif idx < n and clean_token(words[idx]) in ("nghìn", "nghin", "ngàn", "ngan"):
                words_consumed += 1
                idx += 1
                total += (current + digit) * 1000
                current = 0
                if is_word_boundary(idx - 1):
                    break
            elif idx < n and clean_token(words[idx]) in ("triệu", "trieu"):
                words_consumed += 1
                idx += 1
                total += (current + digit) * 1_000_000
                current = 0
                if is_word_boundary(idx - 1):
                    break
            elif idx < n and clean_token(words[idx]) in ("tỷ", "ty"):
                words_consumed += 1
                idx += 1
                total += (current + digit) * 1_000_000_000
                current = 0
                if is_word_boundary(idx - 1):
                    break
            else:
                current += digit
        elif w in ("mười", "muoi"):
            words_consumed += 1
            valid_number_found = True
            idx += 1
            m_val = 10
            if not hit_boundary and idx < n and clean_token(words[idx]) in VI_ONES and 1 <= VI_ONES[clean_token(words[idx])] <= 9:
                hit_ones_bound = is_word_boundary(idx)
                m_val += VI_ONES[clean_token(words[idx])]
                words_consumed += 1
                idx += 1
                current += m_val
                if hit_ones_bound:
                    break
                continue
            current += m_val
            if hit_boundary:
                break
        elif w in ("trăm", "tram"):
            if current == 0:
                current = 1
            current *= 100
            words_consumed += 1
            valid_number_found = True
            idx += 1
            if hit_boundary:
                break
        elif w in ("nghìn", "nghin", "ngàn", "ngan"):
            if current == 0:
                current = 1
            total += current * 1000
            current = 0
            words_consumed += 1
            valid_number_found = True
            idx += 1
            if hit_boundary:
                break
        elif w in ("triệu", "trieu"):
            if current == 0:
                current = 1
            total += current * 1_000_000
            current = 0
            words_consumed += 1
            valid_number_found = True
            idx += 1
            if hit_boundary:
                break
        elif w in ("tỷ", "ty"):
            if current == 0:
                current = 1
            total += current * 1_000_000_000
            current = 0
            words_consumed += 1
            valid_number_found = True
            idx += 1
            if hit_boundary:
                break
        elif w in ("linh", "lẻ", "le") and valid_number_found and idx + 1 < n and clean_token(words[idx + 1]) in VI_ONES:
            words_consumed += 2
            current += VI_ONES[clean_token(words[idx + 1])]
            idx += 2
            if is_word_boundary(idx - 1):
                break
        else:
            break

    if valid_number_found:
        total += current
        if idx + 1 < n and clean_token(words[idx]) in ("phần", "phan") and clean_token(words[idx + 1]) in ("trăm", "tram"):
            return f"{total}%", offset + words_consumed + 2
        res = f"-{total}" if is_neg else str(total)
        return res, offset + words_consumed

    return None, 0


ALL_SCALES = {**EN_SCALES, **VI_SCALES}

MULTI_WORD_UNIT_MAP = {
    "kilowatt": "kwh",
    "megawatt": "mwh",
    "gigawatt": "gwh",
}

HYPHENATED_UNIT_MAP = {
    "kilowatt-hour": "kwh",
    "kilowatt-hours": "kwh",
    "megawatt-hour": "mwh",
    "megawatt-hours": "mwh",
    "gigawatt-hour": "gwh",
    "gigawatt-hours": "gwh",
}

SINGLE_WORD_UNIT_MAP = {
    "kilowatt": "kw",
    "kilowatts": "kw",
    "megawatt": "mw",
    "megawatts": "mw",
    "gigawatt": "gw",
    "gigawatts": "gw",
    "watt": "w",
    "watts": "w",
    "volt": "v",
    "volts": "v",
    "amp": "a",
    "amps": "a",
    "ampere": "a",
    "amperes": "a",
    "milliamp": "mah",
    "milliamps": "mah",
    "gigahertz": "ghz",
    "megahertz": "mhz",
    "kilohertz": "khz",
    "hertz": "hz",
    "terabyte": "tb",
    "terabytes": "tb",
    "gigabyte": "gb",
    "gigabytes": "gb",
    "megabyte": "mb",
    "megabytes": "mb",
    "kilobyte": "kb",
    "kilobytes": "kb",
    "kilogram": "kg",
    "kilograms": "kg",
    "kilo": "kg",
    "kilos": "kg",
    "gram": "g",
    "grams": "g",
    "milligram": "mg",
    "milligrams": "mg",
    "kilometer": "km",
    "kilometers": "km",
    "kilometre": "km",
    "kilometres": "km",
    "centimeter": "cm",
    "centimeters": "cm",
    "centimetre": "cm",
    "centimetres": "cm",
    "millimeter": "mm",
    "millimeters": "mm",
    "millimetre": "mm",
    "millimetres": "mm",
}

ROMAN_NUMERALS_MAP = {
    "i": "1", "ii": "2", "iii": "3", "iv": "4", "v": "5",
    "vi": "6", "vii": "7", "viii": "8", "ix": "9", "x": "10",
    "xi": "11", "xii": "12", "xiii": "13", "xiv": "14", "xv": "15",
    "xvi": "16", "xvii": "17", "xviii": "18", "xix": "19", "xx": "20",
}

ROMAN_CONTEXT_HEADS = {
    "war", "part", "mark", "mk", "chapter", "phase", "stage", "tier",
    "type", "act", "volume", "vol", "section", "sec", "book", "level",
    "episode", "class", "category", "article", "clause", "amendment",
    "title", "annex", "appendix", "schedule", "step", "round", "game",
    "generation", "gen", "version", "ver", "apollo", "saturn", "titan",
    "falcon", "gemini", "mercury", "voyager", "pioneer", "viking",
    "king", "queen", "pope", "emperor", "tsar", "czar", "henry", "charles",
    "louis", "george", "edward", "elizabeth", "richard", "james", "john",
    "paul", "leo", "pius", "benedict", "gregory", "clement", "innocent",
    "alexander", "philip", "william", "frederick", "peter", "nicholas",
    "napoleon", "ramses", "ptolemy", "cleopatra", "bowl", "gta",
    "playstation", "civilization", "diablo", "halo", "quake", "doom",
    "chương", "phần", "tập", "cấp", "loại", "đời", "thế", "hệ",
}


def collapse_number_tokens(
    words: list[str],
    language: str | None = None,
    delimiters: list[str] | None = None,
) -> list[NormalizedSpan]:
    """Collapses multi-word number expressions into normalized canonical tokens.
    Preserves exact original index bounds [orig_start, orig_end).
    """
    spans: list[NormalizedSpan] = []
    n = len(words)
    idx = 0

    is_vi = language and language.startswith("vi")

    def has_boundary_before(pos: int) -> bool:
        if pos <= 0:
            return False
        if has_trailing_boundary(words[pos - 1]):
            return True
        if delimiters is not None and pos < len(delimiters) and any(c in ",;:.!?—–()[]\n\r" for c in delimiters[pos]):
            return True
        return False

    def try_parse_cents_at(start_idx: int) -> tuple[int, int] | None:
        if start_idx >= n or has_boundary_before(start_idx):
            return None
        num_idx = start_idx
        if clean_token(words[num_idx]) == "and":
            if num_idx + 1 >= n or has_boundary_before(num_idx + 1):
                return None
            num_idx += 1

        cents_val: int | None = None
        cents_end = num_idx

        norm_d = normalize_digit_string(words[num_idx])
        c_tok = clean_token(words[num_idx])
        if re.fullmatch(r"\d{1,2}", norm_d):
            cents_val = int(norm_d)
            cents_end = num_idx + 1
        elif "-" in c_tok and not is_ip_address(c_tok):
            sub_p = [p for p in c_tok.split("-") if p]
            if len(sub_p) > 1:
                val_h, cons_h = parse_english_number_phrase(sub_p, 0)
                if val_h is not None and cons_h == len(sub_p) and re.fullmatch(r"\d{1,2}", val_h):
                    cents_val = int(val_h)
                    cents_end = num_idx + 1

        if cents_val is None:
            val_p, cons_p = parse_english_number_phrase(words, num_idx, delimiters)
            if val_p is not None and cons_p > 0 and re.fullmatch(r"\d{1,2}", val_p):
                cents_val = int(val_p)
                cents_end = num_idx + cons_p

        if (
            cents_val is not None
            and cents_end < n
            and not has_boundary_before(cents_end)
            and clean_token(words[cents_end]) in ("cent", "cents")
        ):
            return cents_val, cents_end + 1
        return None

    def consume_trailing_modifiers() -> None:
        nonlocal idx
        while idx < n and spans and spans[-1].is_number:
            next_c = clean_token(words[idx])
            if next_c in ("percent", "%") and not spans[-1].canonical.endswith("%"):
                spans[-1] = NormalizedSpan(
                    canonical=f"{spans[-1].canonical}%",
                    orig_start=spans[-1].orig_start,
                    orig_end=idx + 1,
                    is_number=True,
                )
                idx += 1
            elif next_c in ("dollar", "dollars", "usd", "buck", "bucks"):
                spans[-1] = NormalizedSpan(
                    canonical=spans[-1].canonical,
                    orig_start=spans[-1].orig_start,
                    orig_end=idx + 1,
                    is_number=True,
                )
                idx += 1
                if re.fullmatch(r"-?\d+", spans[-1].canonical):
                    cents_res = try_parse_cents_at(idx)
                    if cents_res is not None:
                        cents_val, after_cents_idx = cents_res
                        spans[-1] = NormalizedSpan(
                            canonical=f"{spans[-1].canonical}.{cents_val:02d}",
                            orig_start=spans[-1].orig_start,
                            orig_end=after_cents_idx,
                            is_number=True,
                        )
                        idx = after_cents_idx
            elif (
                re.fullmatch(r"-?\d+", spans[-1].canonical)
                and words[spans[-1].orig_start].strip().startswith(("$", "€", "£"))
            ):
                cents_res = try_parse_cents_at(idx)
                if cents_res is not None:
                    cents_val, after_cents_idx = cents_res
                    spans[-1] = NormalizedSpan(
                        canonical=f"{spans[-1].canonical}.{cents_val:02d}",
                        orig_start=spans[-1].orig_start,
                        orig_end=after_cents_idx,
                        is_number=True,
                    )
                    idx = after_cents_idx
                else:
                    break
            elif (
                next_c in ("cent", "cents")
                and not has_boundary_before(idx)
                and re.fullmatch(r"\d{1,2}", spans[-1].canonical)
                and 1 <= int(spans[-1].canonical) <= 99
            ):
                cents_val = int(spans[-1].canonical)
                spans[-1] = NormalizedSpan(
                    canonical=f"0.{cents_val:02d}",
                    orig_start=spans[-1].orig_start,
                    orig_end=idx + 1,
                    is_number=True,
                )
                idx += 1
            else:
                break

    while idx < n:
        # Whisper may split a locale-formatted integer into BPE words such as
        # ["1.", "000.", "000"] or ["1", ".000", ".000"].
        # Recombine ONLY if the joined spelling contains explicit 3-digit
        # grouping dots; never equate numerically different decimals.
        dotted_group_end = None
        for candidate_end in range(idx + 2, min(n, idx + 7) + 1):
            joined = "".join(words[idx:candidate_end]).strip()
            if re.fullmatch(r"-?\d{1,3}(?:\.\d{3})+", joined) and not is_ip_address(joined):
                dotted_group_end = candidate_end
        if dotted_group_end is not None:
            joined = "".join(words[idx:dotted_group_end]).strip()
            spans.append(NormalizedSpan(
                canonical=normalize_digit_string(joined),
                orig_start=idx,
                orig_end=dotted_group_end,
                is_number=True,
            ))
            idx = dotted_group_end
            consume_trailing_modifiers()
            continue

        raw_w = words[idx]
        cleaned = clean_token(raw_w)

        # Multi-word energy units: "kilowatt hours" -> "kwh"
        if cleaned in MULTI_WORD_UNIT_MAP and idx + 1 < n and clean_token(words[idx + 1]) in ("hour", "hours"):
            spans.append(NormalizedSpan(
                canonical=MULTI_WORD_UNIT_MAP[cleaned],
                orig_start=idx,
                orig_end=idx + 2,
                is_number=False,
            ))
            idx += 2
            continue

        if cleaned in HYPHENATED_UNIT_MAP:
            spans.append(NormalizedSpan(
                canonical=HYPHENATED_UNIT_MAP[cleaned],
                orig_start=idx,
                orig_end=idx + 1,
                is_number=False,
            ))
            idx += 1
            continue

        if spans and spans[-1].is_number and cleaned in SINGLE_WORD_UNIT_MAP:
            spans.append(NormalizedSpan(
                canonical=SINGLE_WORD_UNIT_MAP[cleaned],
                orig_start=idx,
                orig_end=idx + 1,
                is_number=False,
            ))
            idx += 1
            continue

        # Contextual Roman numerals (e.g. "World War II" -> ["world", "war", "2"], "Part III" -> ["part", "3"])
        if cleaned in ROMAN_NUMERALS_MAP:
            prev_clean = clean_token(words[idx - 1]) if idx > 0 else ""
            raw_alpha = re.sub(r"[^A-Za-z]", "", raw_w)
            is_upper_roman = bool(raw_alpha and raw_alpha.isupper())
            if prev_clean in ROMAN_CONTEXT_HEADS and (
                cleaned not in ("i", "v", "x", "vi")
                or is_upper_roman
                or prev_clean in (
                    "war", "part", "mark", "mk", "chapter", "phase", "stage", "tier",
                    "type", "act", "volume", "vol", "section", "apollo", "saturn", "titan"
                )
            ):
                spans.append(NormalizedSpan(
                    canonical=ROMAN_NUMERALS_MAP[cleaned],
                    orig_start=idx,
                    orig_end=idx + 1,
                    is_number=True,
                ))
                idx += 1
                continue

        # Normalize spoken range/code connectors ("dash", "hyphen") immediately following a number span
        if spans and spans[-1].is_number and cleaned in ("dash", "hyphen"):
            spans.append(NormalizedSpan(
                canonical="to",
                orig_start=idx,
                orig_end=idx + 1,
                is_number=False,
            ))
            idx += 1
            continue

        # Dash range token immediately following a number span (e.g. ["60", "-70", "%"] -> "60", "to", "70%")
        # Note: Leading-zero multi-digit groups like "-031", "-0299" are serial/patent code segments, NOT numeric ranges.
        if spans and spans[-1].is_number and re.match(r"^[-–]\d", raw_w.strip()):
            if not re.match(r"^[-–]0\d", raw_w.strip()):
                spans.append(NormalizedSpan(
                    canonical="to",
                    orig_start=idx,
                    orig_end=idx + 1,
                    is_number=False,
                ))
            raw_w = raw_w.strip().lstrip("-–")
            cleaned = clean_token(raw_w)

        # Single-token dashed numeric range/code (e.g. "119-21" -> ["119", "to", "21"], "10-15%" -> ["10", "to", "15%"])
        m_dash_rng = re.fullmatch(r"(\d+(?:,\d{3})*(?:\.\d+)?)([-–])(\d+(?:,\d{3})*(?:\.\d+)?%?)", cleaned)
        if m_dash_rng and not is_ip_address(cleaned):
            p1 = normalize_digit_string(m_dash_rng.group(1))
            p2 = normalize_digit_string(m_dash_rng.group(3))
            spans.append(NormalizedSpan(
                canonical=p1,
                orig_start=idx,
                orig_end=idx + 1,
                is_number=True,
            ))
            spans.append(NormalizedSpan(
                canonical="to",
                orig_start=idx,
                orig_end=idx + 1,
                is_number=False,
            ))
            spans.append(NormalizedSpan(
                canonical=p2,
                orig_start=idx,
                orig_end=idx + 1,
                is_number=True,
            ))
            idx += 1
            consume_trailing_modifiers()
            continue

        # Single-token slashed numeric pair (e.g. "24/7" -> ["24", "7"])
        m_slash_num = re.fullmatch(r"(\d+)/(\d+)", cleaned)
        if m_slash_num:
            spans.append(NormalizedSpan(
                canonical=m_slash_num.group(1),
                orig_start=idx,
                orig_end=idx + 1,
                is_number=True,
            ))
            spans.append(NormalizedSpan(
                canonical=m_slash_num.group(2),
                orig_start=idx,
                orig_end=idx + 1,
                is_number=True,
            ))
            idx += 1
            continue

        # Single-token number + letter/unit suffix (e.g. "25d" -> ["25", "d"], "4k" -> ["4", "k"], "10kwh" -> ["10", "kwh"])
        m_num_alpha = re.fullmatch(r"(-?\d+(?:,\d{3})*(?:\.\d+)?)([a-z]{1,4})", cleaned)
        if m_num_alpha and m_num_alpha.group(2) not in ("st", "nd", "rd", "th"):
            num_part = normalize_digit_string(m_num_alpha.group(1))
            raw_suffix = m_num_alpha.group(2)
            alpha_part = SINGLE_WORD_UNIT_MAP.get(raw_suffix, raw_suffix)
            spans.append(NormalizedSpan(
                canonical=num_part,
                orig_start=idx,
                orig_end=idx + 1,
                is_number=True,
            ))
            spans.append(NormalizedSpan(
                canonical=alpha_part,
                orig_start=idx,
                orig_end=idx + 1,
                is_number=False,
            ))
            idx += 1
            continue

        # Single-token hyphenated number + word/unit compound (e.g. "15-liter" -> ["15", "liter"], "75-kilowatt-hour" -> ["75", "kwh"], "18-wheelers" -> ["18", "wheelers"])
        m_num_hyphen_word = re.fullmatch(r"(\d+(?:,\d{3})*(?:\.\d+)?)-([a-z]+(?:-[a-z]+)*)", cleaned)
        if m_num_hyphen_word:
            num_part = normalize_digit_string(m_num_hyphen_word.group(1))
            word_part = m_num_hyphen_word.group(2)
            spans.append(NormalizedSpan(
                canonical=num_part,
                orig_start=idx,
                orig_end=idx + 1,
                is_number=True,
            ))
            if word_part in HYPHENATED_UNIT_MAP:
                spans.append(NormalizedSpan(
                    canonical=HYPHENATED_UNIT_MAP[word_part],
                    orig_start=idx,
                    orig_end=idx + 1,
                    is_number=False,
                ))
            elif word_part in SINGLE_WORD_UNIT_MAP:
                spans.append(NormalizedSpan(
                    canonical=SINGLE_WORD_UNIT_MAP[word_part],
                    orig_start=idx,
                    orig_end=idx + 1,
                    is_number=False,
                ))
            else:
                for sub_w in word_part.split("-"):
                    if sub_w:
                        spans.append(NormalizedSpan(
                            canonical=SINGLE_WORD_UNIT_MAP.get(sub_w, sub_w),
                            orig_start=idx,
                            orig_end=idx + 1,
                            is_number=False,
                        ))
            idx += 1
            continue

        # Single-token letter + number code (e.g. "a1" / "-A1" -> ["a", "1"], "v3" -> ["v", "3"], "q4" -> ["q", "4"])
        m_alpha_num = re.fullmatch(r"([a-z]{1,2})(\d+)", cleaned)
        if m_alpha_num:
            spans.append(NormalizedSpan(
                canonical=m_alpha_num.group(1),
                orig_start=idx,
                orig_end=idx + 1,
                is_number=False,
            ))
            spans.append(NormalizedSpan(
                canonical=m_alpha_num.group(2),
                orig_start=idx,
                orig_end=idx + 1,
                is_number=True,
            ))
            idx += 1
            continue

        # Multi-segment alternating alphanumeric code (e.g. "88s6p" -> ["88", "s", "6", "p"], "88s6" -> ["88", "s", "6"])
        if re.fullmatch(r"(?:\d+[a-z]{1,2})+\d*(?:[a-z]{1,2})?", cleaned) and re.search(r"\d+[a-z]{1,2}\d+", cleaned):
            for seg_m in re.finditer(r"\d+|[a-z]+", cleaned):
                seg_tok = seg_m.group(0)
                spans.append(NormalizedSpan(
                    canonical=seg_tok,
                    orig_start=idx,
                    orig_end=idx + 1,
                    is_number=seg_tok.isdigit(),
                ))
            idx += 1
            continue

        # Check if already a numeric token (e.g. '300', '1,000', '3.14', '127.0.0.1', '23rd')
        norm_digit = normalize_digit_string(raw_w)
        if norm_digit != cleaned or re.search(r"\d", cleaned):
            end_idx = idx + 1
            combined_digit = norm_digit
            is_leading_dot_frac = raw_w.strip().startswith(".")

            # Merge BPE-split thousands/3-digit groups (e.g. ["82", ",000"], ["15", "400"], ["$290", ",000"])
            # and consecutive leading-zero digit-by-digit code groups (e.g. ["031", "0299"] or ["031", "-0299"] -> "0310299")
            if not is_leading_dot_frac and (
                re.fullmatch(r"-?\d{1,3}", combined_digit)
                or (combined_digit.isdigit() and combined_digit.startswith("0") and len(combined_digit) >= 2)
            ):
                while end_idx < n:
                    prev_raw = words[end_idx - 1].strip()
                    next_raw = words[end_idx].strip()
                    next_clean = clean_token(next_raw.lstrip("-–"))
                    has_delim_punct = (
                        delimiters is not None
                        and end_idx < len(delimiters)
                        and any(c in ",;:.!?—–()[]\n\r" for c in delimiters[end_idx])
                    ) or has_trailing_boundary(prev_raw)

                    if re.match(r"^,\d{3}(?:[,.;:!?)]|$)", next_raw) and re.fullmatch(r"\d{3}", next_clean):
                        combined_digit = combined_digit + next_clean
                        end_idx += 1
                    elif (
                        not has_delim_punct
                        and combined_digit.isdigit()
                        and combined_digit.startswith("0")
                        and len(combined_digit) >= 2
                        and next_clean.isdigit()
                        and next_clean.startswith("0")
                        and len(next_clean) >= 2
                    ):
                        combined_digit = combined_digit + next_clean
                        end_idx += 1
                    elif not has_delim_punct and not next_raw.startswith(("-", "–")) and (
                        (next_clean == "000" and re.fullmatch(r"-?\d{1,3}", combined_digit) and not combined_digit.startswith("0"))
                        or (re.fullmatch(r"[1-9]00", next_clean) and re.fullmatch(r"-?\d{1,2}", combined_digit) and not combined_digit.startswith("0"))
                    ):
                        combined_digit = combined_digit + next_clean
                        end_idx += 1
                    else:
                        break

            # Merge BPE-split decimal fraction token immediately following an integer (e.g. ["$5", ",922", ".50"] -> "5922.50", ["$862", ".50."] -> "862.50")
            if (
                not is_leading_dot_frac
                and end_idx < n
                and not has_trailing_boundary(words[end_idx - 1])
                and re.fullmatch(r"-?\d+", combined_digit)
            ):
                m_bpe_frac = re.match(r"^\.(\d+)[,.;:!?)]*$", words[end_idx].strip())
                if m_bpe_frac:
                    combined_digit = f"{combined_digit}.{m_bpe_frac.group(1)}"
                    end_idx += 1

            # Combine integer digit token with immediately following scale word (e.g. ["770", "million"] -> "770000000")
            if (
                not is_leading_dot_frac
                and end_idx < n
                and not has_trailing_boundary(words[end_idx - 1])
                and re.fullmatch(r"-?\d+", combined_digit)
            ):
                scale_w = clean_token(words[end_idx])
                if scale_w in ALL_SCALES and scale_w not in ("hundred", "trăm", "tram"):
                    combined_digit = str(int(combined_digit) * ALL_SCALES[scale_w])
                    end_idx += 1

            spans.append(NormalizedSpan(
                canonical=combined_digit,
                orig_start=idx,
                orig_end=end_idx,
                is_number=True,
            ))
            idx = end_idx
            consume_trailing_modifiers()
            continue

        # Check hyphenated compound numbers (e.g. 'twenty-third', 'sixty-nine', 'thirty-five-year', 'eighteen-wheelers')
        if "-" in cleaned and not is_ip_address(cleaned):
            sub_parts = [p for p in cleaned.split("-") if p]
            if len(sub_parts) > 1:
                if is_vi:
                    val_hyphen, consumed_hyphen = parse_vietnamese_number_phrase(sub_parts, 0)
                    if val_hyphen is None:
                        val_hyphen, consumed_hyphen = parse_english_number_phrase(sub_parts, 0)
                else:
                    val_hyphen, consumed_hyphen = parse_english_number_phrase(sub_parts, 0)
                    if val_hyphen is None:
                        val_hyphen, consumed_hyphen = parse_vietnamese_number_phrase(sub_parts, 0)
                if val_hyphen is not None and consumed_hyphen == len(sub_parts):
                    spans.append(NormalizedSpan(
                        canonical=val_hyphen,
                        orig_start=idx,
                        orig_end=idx + 1,
                        is_number=True,
                    ))
                    idx += 1
                    consume_trailing_modifiers()
                    continue
                elif val_hyphen is not None and 0 < consumed_hyphen < len(sub_parts):
                    spans.append(NormalizedSpan(
                        canonical=val_hyphen,
                        orig_start=idx,
                        orig_end=idx + 1,
                        is_number=True,
                    ))
                    rem_hyphen = "-".join(sub_parts[consumed_hyphen:])
                    if rem_hyphen in HYPHENATED_UNIT_MAP:
                        spans.append(NormalizedSpan(
                            canonical=HYPHENATED_UNIT_MAP[rem_hyphen],
                            orig_start=idx,
                            orig_end=idx + 1,
                            is_number=False,
                        ))
                    else:
                        for rem_w in sub_parts[consumed_hyphen:]:
                            spans.append(NormalizedSpan(
                                canonical=SINGLE_WORD_UNIT_MAP.get(rem_w, rem_w),
                                orig_start=idx,
                                orig_end=idx + 1,
                                is_number=False,
                            ))
                    idx += 1
                    continue

        # Try parsing multi-word number phrase
        val = None
        consumed = 0
        if is_vi:
            val, consumed = parse_vietnamese_number_phrase(words, idx, delimiters)
            if val is None:
                val, consumed = parse_english_number_phrase(words, idx, delimiters)
        else:
            val, consumed = parse_english_number_phrase(words, idx, delimiters)
            # If English failed but text might be VN, try VN as fallback
            if val is None:
                val, consumed = parse_vietnamese_number_phrase(words, idx, delimiters)

        if val is not None and consumed > 0:
            spans.append(NormalizedSpan(
                canonical=val,
                orig_start=idx,
                orig_end=idx + consumed,
                is_number=True,
            ))
            idx += consumed
            consume_trailing_modifiers()
        else:
            # Regular word
            spans.append(NormalizedSpan(
                canonical=clean_token(raw_w),
                orig_start=idx,
                orig_end=idx + 1,
                is_number=False,
            ))
            idx += 1

    # Shared-scale range normalization: e.g. "seven to eight thousand" -> ["7000", "to", "8000"],
    # "one hundred to two hundred billion" -> ["100000000000", "to", "200000000000"],
    # "15 to 20,000" -> ["15000", "to", "20000"]
    for k in range(len(spans) - 2):
        s1, s_mid, s2 = spans[k], spans[k + 1], spans[k + 2]
        if (
            s1.is_number
            and not s_mid.is_number
            and s_mid.canonical in ("to", "or", "đến", "den", "tới", "toi")
            and s2.is_number
            and re.fullmatch(r"\d+", s1.canonical)
            and re.fullmatch(r"\d+", s2.canonical)
        ):
            v1 = int(s1.canonical)
            v2 = int(s2.canonical)
            s2_words_clean = [clean_token(w) for w in words[s2.orig_start : s2.orig_end]]
            s1_words_clean = [clean_token(w) for w in words[s1.orig_start : s1.orig_end]]
            s2_scale = next((ALL_SCALES[w] for w in reversed(s2_words_clean) if w in ALL_SCALES), None)
            s1_max_scale = max((ALL_SCALES[w] for w in s1_words_clean if w in ALL_SCALES), default=1)
            if s2_scale is None and v2 >= 1000:
                s2_raw_joined = " ".join(words[s2.orig_start : s2.orig_end])
                if re.search(r"\d[,.\s]\d{3}\b", s2_raw_joined):
                    for cand_scale in (1_000_000_000, 1_000_000, 1_000):
                        if v2 >= cand_scale and v2 % cand_scale == 0:
                            unscaled_cand = v2 // cand_scale
                            if 1 <= unscaled_cand < 1000 and v1 >= max(2, unscaled_cand // 4) and v1 < unscaled_cand:
                                s2_scale = cand_scale
                                break
            if s2_scale and s1_max_scale < s2_scale and v1 < s2_scale and v2 >= s2_scale and v2 % s2_scale == 0:
                v2_unscaled = v2 // s2_scale
                if 1 <= v1 < v2_unscaled:
                    spans[k] = NormalizedSpan(
                        canonical=str(v1 * s2_scale),
                        orig_start=s1.orig_start,
                        orig_end=s1.orig_end,
                        is_number=True,
                    )
        elif (
            s1.is_number
            and not s_mid.is_number
            and s_mid.canonical in ("to", "or", "đến", "den", "tới", "toi")
            and s2.is_number
            and re.fullmatch(r"\d{1,2}", s1.canonical)
            and re.fullmatch(r"0\.\d{2}", s2.canonical)
        ):
            v1_cents = int(s1.canonical)
            s2_last_w = clean_token(words[s2.orig_end - 1]) if s2.orig_end > s2.orig_start else ""
            s2_first_raw = words[s2.orig_start].strip() if s2.orig_start < len(words) else ""
            if 1 <= v1_cents <= 99 and (s2_last_w in ("cent", "cents") or s2_first_raw.startswith("$")):
                spans[k] = NormalizedSpan(
                    canonical=f"0.{v1_cents:02d}",
                    orig_start=s1.orig_start,
                    orig_end=s1.orig_end,
                    is_number=True,
                )

    return spans


def are_number_expressions_equivalent(expr1: str, expr2: str, language: str | None = None) -> bool:
    """Checks whether two expressions represent the exact same numeric value."""
    s1 = collapse_number_tokens(expr1.split(), language)
    s2 = collapse_number_tokens(expr2.split(), language)
    if len(s1) == 1 and len(s2) == 1 and s1[0].is_number and s2[0].is_number:
        c1 = s1[0].canonical
        c2 = s2[0].canonical
        if c1 == c2:
            return True
        if re.fullmatch(r"-?\d+\.\d+", c1) and re.fullmatch(r"-?\d+\.\d+", c2):
            if c1.rstrip("0").rstrip(".") == c2.rstrip("0").rstrip("."):
                return True
        # Spoken hundreds vs time notation: e.g. 'one nineteen' ('1:19') == '119'
        if (":" in c1 or ":" in c2) and not is_ip_address(c1) and not is_ip_address(c2):
            d1 = c1.replace(":", "")
            d2 = c2.replace(":", "")
            if d1.isdigit() and d1 == d2:
                return True
        # Check ordinal to cardinal equivalence: e.g. '23rd' == '23', 'thứ 1' == '1'
        base1 = re.sub(r"^(thứ\s+|thu\s+)", "", c1)
        base2 = re.sub(r"^(thứ\s+|thu\s+)", "", c2)
        base1 = re.sub(r"(st|nd|rd|th)$", "", base1)
        base2 = re.sub(r"(st|nd|rd|th)$", "", base2)
        if base1 and base1 == base2:
            return True
    # Multi-span numeric/alphanumeric equivalence (e.g. 'twenty five D' == '25D', '119 dash 21' == '119-21')
    if (
        len(s1) == len(s2)
        and len(s1) >= 2
        and any(x.is_number for x in s1)
        and all(a.canonical == b.canonical for a, b in zip(s1, s2))
    ):
        return True
    # Paired digit groups vs concatenated integer (e.g. ['20', '26'] == ['2026'], ['1', '19'] == ['119'])
    if (
        s1
        and s2
        and (len(s1) > 1 or len(s2) > 1)
        and all(x.is_number for x in s1)
        and all(x.is_number for x in s2)
    ):
        j1 = "".join(x.canonical.replace(":", "") for x in s1)
        j2 = "".join(x.canonical.replace(":", "") for x in s2)
        if (j1.isdigit() or is_decimal_number_string(j1)) and j1 == j2:
            return True
    return False
