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


if __name__ == "__main__":
    unittest.main()
