"""Tests for number normalizer module in VoxLab."""
from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from voxlab_sidecar.number_normalizer import (
    are_number_expressions_equivalent,
    collapse_number_tokens,
    normalize_digit_string,
    is_ip_address,
)


class NumberNormalizerTest(unittest.TestCase):
    def test_english_compound_integers(self):
        cases = [
            ("three hundred", "300"),
            ("fifty five", "55"),
            ("one hundred fifty eight", "158"),
            ("two thousand twenty six", "2026"),
            ("one million", "1000000"),
            ("minus forty two", "-42"),
        ]
        for phrase, expected in cases:
            spans = collapse_number_tokens(phrase.split(), language="en")
            self.assertEqual(len(spans), 1, f"Expected 1 span for '{phrase}', got {spans}")
            self.assertTrue(spans[0].is_number)
            self.assertEqual(spans[0].canonical, expected)

    def test_english_decimals_and_time(self):
        cases = [
            ("three point one four", "3.14"),
            ("zero point zero five", "0.05"),
            ("ten thirty", "10:30"),
            ("twenty twenty six", "2026"),
            ("fifty percent", "50%"),
        ]
        for phrase, expected in cases:
            spans = collapse_number_tokens(phrase.split(), language="en")
            self.assertEqual(len(spans), 1, f"Expected 1 span for '{phrase}', got {spans}")
            self.assertTrue(spans[0].is_number)
            self.assertEqual(spans[0].canonical, expected)

    def test_vietnamese_numbers(self):
        cases = [
            ("ba trăm", "300"),
            ("năm mươi lăm", "55"),
            ("hai nghìn không trăm hai mươi sáu", "2026"),
            ("ba phẩy một bốn", "3.14"),
            ("mười giờ ba mươi", "10:30"),
            ("năm mươi phần trăm", "50%"),
        ]
        for phrase, expected in cases:
            spans = collapse_number_tokens(phrase.split(), language="vi")
            self.assertEqual(len(spans), 1, f"Expected 1 span for '{phrase}', got {spans}")
            self.assertTrue(spans[0].is_number)
            self.assertEqual(spans[0].canonical, expected)

    def test_digit_normalization_and_ip_preservation(self):
        self.assertEqual(normalize_digit_string("1,000"), "1000")
        self.assertEqual(normalize_digit_string("10,000,000"), "10000000")
        self.assertEqual(normalize_digit_string("127.0.0.1"), "127.0.0.1")
        self.assertTrue(is_ip_address("127.0.0.1"))
        self.assertFalse(is_ip_address("127001"))
        self.assertFalse(is_ip_address("3.14"))

    def test_number_expressions_equivalence(self):
        # Equivalent pairs
        self.assertTrue(are_number_expressions_equivalent("three hundred", "300"))
        self.assertTrue(are_number_expressions_equivalent("fifty five", "55"))
        self.assertTrue(are_number_expressions_equivalent("1,000", "one thousand"))
        self.assertTrue(are_number_expressions_equivalent("ba trăm", "300"))
        self.assertTrue(are_number_expressions_equivalent("năm mươi lăm", "55"))
        self.assertTrue(are_number_expressions_equivalent("three point one four", "3.14"))
        self.assertTrue(are_number_expressions_equivalent("fifty percent", "50%"))

        # Non-equivalent pairs (must return False)
        self.assertFalse(are_number_expressions_equivalent("three hundred", "30"))
        self.assertFalse(are_number_expressions_equivalent("fifty five", "50"))
        self.assertFalse(are_number_expressions_equivalent("100", "1000"))
        self.assertFalse(are_number_expressions_equivalent("127.0.0.1", "127001"))
        self.assertFalse(are_number_expressions_equivalent("three hundred", "thirty"))
        self.assertFalse(are_number_expressions_equivalent("ba trăm", "ba mươi"))

    def test_sentence_with_compound_numbers(self):
        sentence = "Roughly three hundred cars filling row after row."
        words = sentence.split()
        spans = collapse_number_tokens(words, language="en")
        canonicals = [s.canonical for s in spans]
        self.assertIn("300", canonicals)
        # Find span for 300
        span_300 = next(s for s in spans if s.canonical == "300")
        self.assertEqual(span_300.orig_start, 1)
        self.assertEqual(span_300.orig_end, 3)
        self.assertEqual(words[span_300.orig_start:span_300.orig_end], ["three", "hundred"])

    def test_english_ordinals_and_hyphenated(self):
        cases = [
            ("first", "1st"),
            ("second", "2nd"),
            ("third", "3rd"),
            ("fourth", "4th"),
            ("eighth", "8th"),
            ("twelfth", "12th"),
            ("twentieth", "20th"),
            ("twenty third", "23rd"),
            ("twenty eighth", "28th"),
            ("one hundred twenty third", "123rd"),
            ("twenty-third", "23rd"),
            ("sixty-nine", "69"),
            ("fifty-five", "55"),
        ]
        for phrase, expected in cases:
            spans = collapse_number_tokens(phrase.split(), language="en")
            self.assertEqual(len(spans), 1, f"Expected 1 span for '{phrase}', got {spans}")
            self.assertTrue(spans[0].is_number)
            self.assertEqual(spans[0].canonical, expected)

    def test_comma_separated_number_sequences(self):
        sentence = "sixty nine, one hundred twenty six, one hundred fifty eight"
        spans = collapse_number_tokens(sentence.split(), language="en")
        canonicals = [s.canonical for s in spans]
        self.assertEqual(canonicals, ["69", "126", "158"])

    def test_vietnamese_ordinals(self):
        cases = [
            ("thứ nhất", "thứ 1"),
            ("thứ hai", "thứ 2"),
            ("thứ ba", "thứ 3"),
            ("thứ tư", "thứ 4"),
            ("thứ hai mươi ba", "thứ 23"),
        ]
        for phrase, expected in cases:
            spans = collapse_number_tokens(phrase.split(), language="vi")
            self.assertEqual(len(spans), 1, f"Expected 1 span for '{phrase}', got {spans}")
            self.assertTrue(spans[0].is_number)
            self.assertEqual(spans[0].canonical, expected)

    def test_ordinal_number_equivalence(self):
        self.assertTrue(are_number_expressions_equivalent("twenty third", "23"))
        self.assertTrue(are_number_expressions_equivalent("twenty third", "23rd"))
        self.assertTrue(are_number_expressions_equivalent("twenty eighth", "28"))
        self.assertTrue(are_number_expressions_equivalent("twenty eighth", "28th"))
        self.assertTrue(are_number_expressions_equivalent("first", "1st"))
        self.assertTrue(are_number_expressions_equivalent("first", "1"))
        self.assertTrue(are_number_expressions_equivalent("thứ nhất", "1"))
        self.assertTrue(are_number_expressions_equivalent("thứ 23", "23"))

        self.assertFalse(are_number_expressions_equivalent("twenty third", "24"))
        self.assertFalse(are_number_expressions_equivalent("twenty eighth", "27"))
        self.assertFalse(are_number_expressions_equivalent("first", "2"))

    def test_decimal_comma_normalization_and_equivalences(self):
        # Normalization with comma
        self.assertEqual(normalize_digit_string("0,8"), "0.8")
        self.assertEqual(normalize_digit_string("13,5"), "13.5")
        self.assertEqual(normalize_digit_string("3,14"), "3.14")
        self.assertEqual(normalize_digit_string("-0,05"), "-0.05")

        # Thousands comma should NOT be converted to decimal dot
        self.assertEqual(normalize_digit_string("1,000"), "1000")
        self.assertEqual(normalize_digit_string("10,000"), "10000")

        # Decimal equivalences in English
        self.assertTrue(are_number_expressions_equivalent("zero point eight", "0.8"))
        self.assertTrue(are_number_expressions_equivalent("two point eight", "2.8"))
        self.assertTrue(are_number_expressions_equivalent("one point four", "1.4"))
        self.assertTrue(are_number_expressions_equivalent("four point two", "4.2"))
        self.assertTrue(are_number_expressions_equivalent("thirteen point five", "13.5"))
        self.assertTrue(are_number_expressions_equivalent("three point one four", "3.14"))
        self.assertTrue(are_number_expressions_equivalent("zero point zero five", "0.05"))

        # Decimal equivalences in Vietnamese
        self.assertTrue(are_number_expressions_equivalent("không phẩy tám", "0.8", language="vi"))
        self.assertTrue(are_number_expressions_equivalent("không phẩy tám", "0,8", language="vi"))
        self.assertTrue(are_number_expressions_equivalent("hai phẩy tám", "2.8", language="vi"))
        self.assertTrue(are_number_expressions_equivalent("mười ba phẩy năm", "13.5", language="vi"))
        self.assertTrue(are_number_expressions_equivalent("ba phẩy một bốn", "3.14", language="vi"))

        # Non-equivalent numbers MUST return False
        self.assertFalse(are_number_expressions_equivalent("two point eight", "two point four"))
        self.assertFalse(are_number_expressions_equivalent("2.8", "2.4"))
        self.assertFalse(are_number_expressions_equivalent("0.8", "0.9"))
        self.assertFalse(are_number_expressions_equivalent("13.5", "13.8"))
        self.assertFalse(are_number_expressions_equivalent("300", "500"))


if __name__ == "__main__":
    unittest.main()
