"""Unit and acceptance tests for VoxLab YouTube Cinematic Subtitle Optimizer (Phase B)."""
from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from voxlab_sidecar.subtitle_optimizer import (
    build_protected_boundary_map,
    build_word_sequence,
    display_width,
    get_profile,
    optimize_subtitles_v2,
    recover_orthography_from_script,
    validate_final_cues,
)


def _make_segment(text: str, start_sec: float = 0.0, word_dur: float = 0.32) -> dict:
    tokens = text.split()
    words = []
    for idx, tok in enumerate(tokens):
        w_start = round(start_sec + idx * word_dur, 3)
        w_end = round(w_start + word_dur - 0.02, 3)
        words.append({"word": tok, "startSec": w_start, "endSec": w_end, "probability": 0.99})
    return {
        "id": 1,
        "startSec": start_sec,
        "endSec": round(start_sec + len(tokens) * word_dur, 3),
        "text": text,
        "words": words,
    }


class SubtitleOptimizerTest(unittest.TestCase):
    def test_mandatory_sentence_1_over_55_diesel_truck(self):
        sentence = "If you are over 55, you remember when a diesel truck meant America was working."
        report = {}
        cues = optimize_subtitles_v2(
            [_make_segment(sentence)],
            video_format="16:9",
            max_lines=2,
            debug_validation_report=report,
        )
        self.assertTrue(report["export_allowed"])
        self.assertEqual(len(cues), 2)
        self.assertEqual(cues[0]["text"], "If you are over 55,")
        self.assertEqual(cues[1]["text"], "you remember when a diesel truck\nmeant America was working.")

    def test_mandatory_sentence_2_tesla_semi_82000_pounds(self):
        sentence = (
            "Tesla's Semi pulls 82,000 pounds, about 37 tons, "
            "with a motor roughly the size of one single piston from a 15-liter diesel engine."
        )
        report = {}
        cues = optimize_subtitles_v2(
            [_make_segment(sentence)],
            video_format="16:9",
            max_lines=2,
            debug_validation_report=report,
        )
        self.assertTrue(report["export_allowed"])
        self.assertGreaterEqual(len(cues), 2)
        joined_cues = [" ".join(c["text"].splitlines()) for c in cues]
        self.assertTrue(any("82,000 pounds," in c["text"] for c in cues))
        self.assertTrue(any("37 tons," in c["text"] for c in cues))
        self.assertTrue(any("15-liter diesel engine." in c["text"] for c in cues))
        for c in cues:
            lines = c["text"].splitlines()
            self.assertLessEqual(len(lines), 2)
            self.assertTrue(all(display_width(line) <= 32 for line in lines))
        self.assertEqual(" ".join(joined_cues), sentence)

    def test_mandatory_sentence_3_kwh_per_mile_protected_spans(self):
        sentence = "That is less than 2 kilowatt hours per mile, or more precisely 1.55 kWh per mile."
        report = {}
        cues = optimize_subtitles_v2(
            [_make_segment(sentence)],
            video_format="16:9",
            max_lines=2,
            debug_validation_report=report,
        )
        self.assertTrue(report["export_allowed"])
        self.assertEqual(len(cues), 2)
        self.assertIn("2 kilowatt hours per mile,", cues[0]["text"].splitlines())
        self.assertIn("1.55 kWh per mile.", cues[1]["text"].splitlines())

    def test_mandatory_sentence_4_clause_conjunction_and(self):
        sentence = (
            "It is coming for the money, and when freight costs change, "
            "the price of everything you buy changes with it."
        )
        report = {}
        cues = optimize_subtitles_v2(
            [_make_segment(sentence)],
            video_format="16:9",
            max_lines=2,
            debug_validation_report=report,
        )
        self.assertTrue(report["export_allowed"])
        self.assertEqual(len(cues), 2)
        self.assertEqual(cues[0]["text"], "It is coming for the money,\nand when freight costs change,")
        self.assertEqual(cues[1]["text"], "the price of everything\nyou buy changes with it.")

    def test_mandatory_sentence_5_coordinate_noun_list_intact(self):
        sentence = "One architecture across cars, trucks, and robots."
        report = {}
        cues = optimize_subtitles_v2(
            [_make_segment(sentence)],
            video_format="16:9",
            max_lines=2,
            debug_validation_report=report,
        )
        self.assertTrue(report["export_allowed"])
        self.assertEqual(len(cues), 1)
        self.assertIn("cars, trucks, and robots.", cues[0]["text"])
        self.assertEqual(cues[0]["text"], "One architecture\nacross cars, trucks, and robots.")

    def test_mandatory_sentence_6_proper_noun_pair_pepsico_and_sysco(self):
        sentence = "PepsiCo and Sysco have already logged millions of miles."
        report = {}
        cues = optimize_subtitles_v2(
            [_make_segment(sentence)],
            video_format="16:9",
            max_lines=2,
            debug_validation_report=report,
        )
        self.assertTrue(report["export_allowed"])
        self.assertTrue(any("PepsiCo and Sysco" in line for c in cues for line in c["text"].splitlines()))

    def test_mandatory_sentence_7_short_punch_line(self):
        sentence = "Shut it down."
        report = {}
        cues = optimize_subtitles_v2(
            [_make_segment(sentence)],
            video_format="16:9",
            max_lines=2,
            debug_validation_report=report,
        )
        self.assertTrue(report["export_allowed"])
        self.assertEqual(len(cues), 1)
        self.assertEqual(cues[0]["text"], "Shut it down.")

    def test_script_orthography_recovery_restores_brands_and_compact_units(self):
        asr_seg = _make_segment(
            "Pepsico and Sysco logged 1.55 kilowatt hours per mile for two hundred and ninety thousand dollars."
        )
        script = "PepsiCo and Sysco logged 1.55 kWh per mile for $290,000."
        words = build_word_sequence([asr_seg])
        recovered = recover_orthography_from_script(words, script, language="en")
        recovered_text = " ".join(w["text"] for w in recovered)
        self.assertIn("PepsiCo", recovered_text)
        self.assertIn("Sysco", recovered_text)
        self.assertIn("1.55 kWh per mile", recovered_text)
        self.assertIn("$290,000.", recovered_text)

    def test_profiles_and_anti_chunk_copy_invariant(self):
        p16 = get_profile("16:9", 2)
        p11 = get_profile("1:1", 2)
        p916 = get_profile("9:16", 2)
        self.assertEqual(p16.max_width, 32)
        self.assertEqual(p11.max_width, 29)
        self.assertEqual(p916.max_width, 26)

        seg = _make_segment("This is a test sentence with several words.")
        words = build_word_sequence([seg])
        cue_protected, _ = build_protected_boundary_map(words)
        cues = [{
            "index": 1,
            "start": 0.0,
            "end": 2.5,
            "text": "This is a test sentence\nwith several words.",
            "words": words,
        }]
        report = validate_final_cues(
            cues=cues,
            source_words=words,
            profile=p16,
            protected=cue_protected,
            audio_duration=1200.0,
            chunk_count=85,
        )
        self.assertFalse(report["export_allowed"])
        self.assertTrue(any(err["code"] == "CHUNK_COPY_DETECTED" for err in report["fatal_errors"]))


if __name__ == "__main__":
    unittest.main()
