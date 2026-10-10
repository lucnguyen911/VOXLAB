"""Tests for audio quality validation and abnormal pause detection."""
from __future__ import annotations

import os
import tempfile
import unittest
import numpy as np
import soundfile as sf
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from voxlab_sidecar import audio_quality


def _create_wav(path: str, duration_sec: float, sr: int = 24000, silence: bool = False, freq: float = 440.0) -> None:
    sample_count = int(duration_sec * sr)
    if silence:
        data = np.zeros(sample_count, dtype=np.float32)
    else:
        t = np.arange(sample_count) / sr
        data = (0.4 * np.sin(2 * np.pi * freq * t)).astype(np.float32)
    sf.write(path, data, sr, subtype="PCM_16")


class AudioQualityTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="voxlab-quality-")

    def test_missing_file_returns_error(self):
        fake_path = os.path.join(self.dir, "missing.wav")
        res = audio_quality.validate_audio_quality(fake_path, text="Hello world")
        self.assertEqual(res["status"], "error")
        self.assertTrue(any(i["code"] == "FILE_NOT_FOUND" for i in res["issues"]))

    def test_empty_file_returns_error(self):
        empty_path = os.path.join(self.dir, "empty.wav")
        with open(empty_path, "wb") as f:
            f.write(b"")
        res = audio_quality.validate_audio_quality(empty_path, text="Hello world")
        self.assertEqual(res["status"], "error")
        self.assertTrue(any(i["code"] == "FILE_EMPTY" for i in res["issues"]))

    def test_corrupt_file_returns_error(self):
        corrupt_path = os.path.join(self.dir, "corrupt.wav")
        with open(corrupt_path, "wb") as f:
            f.write(b"NOT_A_VALID_WAV_HEADER_DATA_123456789")
        res = audio_quality.validate_audio_quality(corrupt_path, text="Hello world")
        self.assertEqual(res["status"], "error")
        self.assertTrue(any(i["code"] == "FILE_CORRUPTED" for i in res["issues"]))

    def test_duration_too_short_returns_error(self):
        short_path = os.path.join(self.dir, "short.wav")
        _create_wav(short_path, 0.1, sr=24000)
        res = audio_quality.validate_audio_quality(short_path, text="Hello world from VoxLab")
        self.assertEqual(res["status"], "error")
        self.assertTrue(any(i["code"] == "DURATION_TOO_SHORT" for i in res["issues"]))

    def test_silent_audio_returns_error(self):
        silent_path = os.path.join(self.dir, "silent.wav")
        _create_wav(silent_path, 2.0, sr=24000, silence=True)
        res = audio_quality.validate_audio_quality(silent_path, text="Hello world from VoxLab")
        self.assertEqual(res["status"], "error")
        self.assertTrue(any(i["code"] == "AUDIO_SILENT" for i in res["issues"]))

    def test_unverified_when_whisper_unavailable(self):
        valid_path = os.path.join(self.dir, "valid.wav")
        _create_wav(valid_path, 2.5, sr=24000)
        res = audio_quality.validate_audio_quality(
            valid_path,
            text="Hello world from VoxLab",
            models_dir=os.path.join(self.dir, "non_existent_models_dir"),
            force_skip_whisper=True,
        )
        # Technical audio checks pass, but without whisper it must be unverified, not falsely pass
        self.assertEqual(res["status"], "unverified")
        self.assertEqual(len(res["issues"]), 0)

    def test_abnormal_pause_detection_between_words_without_punctuation(self):
        # Text: "staggering cost of moving freight on diesel fuel, an economic burden"
        text = "It is the staggering cost of moving freight on diesel fuel, an economic burden baked into every physical product sold across the nation."

        # Simulate ASR words where between 'diesel' and 'fuel' there is a 0.58s gap
        mock_words = [
            {"word": "It", "startSec": 0.1, "endSec": 0.25, "probability": 0.95},
            {"word": "is", "startSec": 0.26, "endSec": 0.35, "probability": 0.95},
            {"word": "the", "startSec": 0.36, "endSec": 0.50, "probability": 0.95},
            {"word": "staggering", "startSec": 0.55, "endSec": 1.10, "probability": 0.95},
            {"word": "cost", "startSec": 1.15, "endSec": 1.45, "probability": 0.95},
            {"word": "of", "startSec": 1.46, "endSec": 1.60, "probability": 0.95},
            {"word": "moving", "startSec": 1.65, "endSec": 2.05, "probability": 0.95},
            {"word": "freight", "startSec": 2.10, "endSec": 2.50, "probability": 0.95},
            {"word": "on", "startSec": 2.55, "endSec": 2.70, "probability": 0.95},
            {"word": "diesel", "startSec": 2.75, "endSec": 3.15, "probability": 0.95},
            # Gap of 0.58s between diesel (end 3.15) and fuel (start 3.73) without punctuation in text!
            {"word": "fuel,", "startSec": 3.73, "endSec": 4.10, "probability": 0.95},
            # Gap of 0.65s after fuel, because of comma -> expected and natural!
            {"word": "an", "startSec": 4.75, "endSec": 4.90, "probability": 0.95},
            {"word": "economic", "startSec": 4.95, "endSec": 5.40, "probability": 0.95},
            {"word": "burden", "startSec": 5.45, "endSec": 5.85, "probability": 0.95},
        ]

        issues = audio_quality.analyze_word_alignment_issues(text, mock_words)
        # Should detect exactly 1 issue: between diesel and fuel!
        self.assertEqual(len(issues), 1)
        issue = issues[0]
        self.assertEqual(issue["severity"], "warning")
        self.assertEqual(issue["code"], "ABNORMAL_PAUSE")
        self.assertEqual(issue["words"], ["diesel", "fuel"])
        self.assertAlmostEqual(issue["timeRange"][0], 3.15, places=2)
        self.assertAlmostEqual(issue["timeRange"][1], 3.73, places=2)
        self.assertIn("diesel", issue["message"])
        self.assertIn("fuel", issue["message"])
        self.assertIn("0.58", issue["message"])

    def test_natural_pauses_at_commas_and_periods_are_not_flagged(self):
        text = "Hello world, this is VoxLab. We are testing natural pauses; please enjoy!"
        mock_words = [
            {"word": "Hello", "startSec": 0.1, "endSec": 0.4, "probability": 0.98},
            {"word": "world,", "startSec": 0.45, "endSec": 0.8, "probability": 0.98},
            # 0.7s gap at comma -> natural!
            {"word": "this", "startSec": 1.5, "endSec": 1.7, "probability": 0.98},
            {"word": "is", "startSec": 1.72, "endSec": 1.85, "probability": 0.98},
            {"word": "VoxLab.", "startSec": 1.88, "endSec": 2.4, "probability": 0.98},
            # 1.0s gap at period -> natural!
            {"word": "We", "startSec": 3.4, "endSec": 3.6, "probability": 0.98},
            {"word": "are", "startSec": 3.62, "endSec": 3.75, "probability": 0.98},
            {"word": "testing", "startSec": 3.78, "endSec": 4.15, "probability": 0.98},
            {"word": "natural", "startSec": 4.18, "endSec": 4.55, "probability": 0.98},
            {"word": "pauses;", "startSec": 4.58, "endSec": 5.0, "probability": 0.98},
            # 0.8s gap at semicolon -> natural!
            {"word": "please", "startSec": 5.8, "endSec": 6.1, "probability": 0.98},
            {"word": "enjoy!", "startSec": 6.15, "endSec": 6.6, "probability": 0.98},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words)
        self.assertEqual(len(issues), 0)

    def test_repeated_words_flagged_as_warning(self):
        text = "This is a normal test."
        mock_words = [
            {"word": "This", "startSec": 0.1, "endSec": 0.4, "probability": 0.98},
            {"word": "is", "startSec": 0.45, "endSec": 0.6, "probability": 0.98},
            {"word": "test", "startSec": 0.65, "endSec": 0.9, "probability": 0.98},
            {"word": "test", "startSec": 0.95, "endSec": 1.2, "probability": 0.98},
            {"word": "test", "startSec": 1.25, "endSec": 1.5, "probability": 0.98},
            {"word": "test", "startSec": 1.55, "endSec": 1.8, "probability": 0.98},
            {"word": "test", "startSec": 1.85, "endSec": 2.1, "probability": 0.98},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words)
        self.assertTrue(any(i["code"] in ("REPEATED_WORD", "REPEATED_WORDS", "SUSPECTED_STUTTER") for i in issues))

    def test_mandatory_diesel_fuel_natural_gap_is_not_flagged(self):
        """Mandatory requirement: No abnormal pause flagged between 'diesel' and 'fuel' under normal flow."""
        text = "It is the staggering cost of moving freight on diesel fuel, an economic burden baked into every physical product sold across the nation."
        mock_words = [
            {"word": "It", "startSec": 0.1, "endSec": 0.3, "probability": 0.98},
            {"word": "is", "startSec": 0.32, "endSec": 0.45, "probability": 0.98},
            {"word": "the", "startSec": 0.48, "endSec": 0.6, "probability": 0.98},
            {"word": "staggering", "startSec": 0.62, "endSec": 1.2, "probability": 0.98},
            {"word": "cost", "startSec": 1.25, "endSec": 1.55, "probability": 0.98},
            {"word": "of", "startSec": 1.58, "endSec": 1.7, "probability": 0.98},
            {"word": "moving", "startSec": 1.72, "endSec": 2.1, "probability": 0.98},
            {"word": "freight", "startSec": 2.15, "endSec": 2.5, "probability": 0.98},
            {"word": "on", "startSec": 2.55, "endSec": 2.7, "probability": 0.98},
            # Normal conversational transition between diesel and fuel (0.08s gap):
            {"word": "diesel", "startSec": 2.75, "endSec": 3.15, "probability": 0.98},
            {"word": "fuel,", "startSec": 3.23, "endSec": 3.65, "probability": 0.98},
            # Natural 0.60s pause after comma:
            {"word": "an", "startSec": 4.25, "endSec": 4.4, "probability": 0.98},
            {"word": "economic", "startSec": 4.45, "endSec": 4.9, "probability": 0.98},
            {"word": "burden", "startSec": 4.95, "endSec": 5.35, "probability": 0.98},
            {"word": "baked", "startSec": 5.4, "endSec": 5.75, "probability": 0.98},
            {"word": "into", "startSec": 5.8, "endSec": 6.05, "probability": 0.98},
            {"word": "every", "startSec": 6.1, "endSec": 6.4, "probability": 0.98},
            {"word": "physical", "startSec": 6.45, "endSec": 6.85, "probability": 0.98},
            {"word": "product", "startSec": 6.9, "endSec": 7.3, "probability": 0.98},
            {"word": "sold", "startSec": 7.35, "endSec": 7.65, "probability": 0.98},
            {"word": "across", "startSec": 7.7, "endSec": 8.05, "probability": 0.98},
            {"word": "the", "startSec": 8.1, "endSec": 8.25, "probability": 0.98},
            {"word": "nation.", "startSec": 8.3, "endSec": 8.75, "probability": 0.98},
        ]
        issues, metrics = audio_quality.analyze_word_alignment_issues(
            text, mock_words, audio_duration_sec=9.0, return_metrics=True
        )
        self.assertEqual(len(issues), 0)
        self.assertGreater(metrics["wpm"], 100)
        self.assertLess(metrics["wpm"], 200)

    def test_rapid_pace_warning_and_normalization(self):
        # 16 words spoken in 2.5s -> 384 raw WPM
        text = "This is a rapidly synthesized sentence that speaks far too fast for comfortable human listening."
        mock_words = [
            {"word": w, "startSec": i * 0.15, "endSec": (i * 0.15) + 0.12, "probability": 0.95}
            for i, w in enumerate(text.split())
        ]
        # At speed=1.0 -> effective WPM is ~384 in metrics, but per requirement NO standalone RAPID_PACE warning issue is emitted
        issues, metrics = audio_quality.analyze_word_alignment_issues(
            text, mock_words, speed=1.0, language="en", audio_duration_sec=2.5, return_metrics=True
        )
        self.assertFalse(any(i["code"] == "RAPID_PACE" for i in issues))
        self.assertGreater(metrics["wpm"], 300)

        # When user deliberately chose speed=2.0x -> normalized effective WPM is 192
        issues_fast, metrics_fast = audio_quality.analyze_word_alignment_issues(
            text, mock_words, speed=2.0, language="en", audio_duration_sec=2.5, return_metrics=True
        )
        self.assertFalse(any(i["code"] == "RAPID_PACE" for i in issues_fast))
        self.assertAlmostEqual(metrics_fast["wpm"], metrics["rawWpm"] / 2.0, places=1)

    def test_crowded_words_detection(self):
        """Crowded or rushed adjacent words do not generate standalone warnings outside the 5 required groups."""
        text = "We observe rapid crowded syllables in this sentence."
        # "rapid", "crowded", "syllables" are 3 consecutive words with dur < 0.09 and gap <= 0.02
        mock_words = [
            {"word": "We", "startSec": 0.1, "endSec": 0.25, "probability": 0.95},
            {"word": "observe", "startSec": 0.28, "endSec": 0.5, "probability": 0.95},
            {"word": "rapid", "startSec": 0.52, "endSec": 0.59, "probability": 0.90},      # dur 0.07s
            {"word": "crowded", "startSec": 0.60, "endSec": 0.67, "probability": 0.90},    # gap 0.01s, dur 0.07s
            {"word": "syllables", "startSec": 0.68, "endSec": 0.75, "probability": 0.90},  # gap 0.01s, dur 0.07s
            {"word": "in", "startSec": 0.85, "endSec": 0.95, "probability": 0.95},
            {"word": "this", "startSec": 0.98, "endSec": 1.15, "probability": 0.95},
            {"word": "sentence.", "startSec": 1.2, "endSec": 1.6, "probability": 0.95},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words)
        crowded_issues = [i for i in issues if i["code"] == "CROWDED_WORDS"]
        self.assertEqual(len(crowded_issues), 0)

    def test_possible_omission_detection(self):
        text = "This algorithm delivers remarkable stability for speech."
        # In ASR, "remarkable" (10 chars >= 4) is completely missing, and surrounding gap is 0.05s < 0.12s
        mock_words = [
            {"word": "This", "startSec": 0.1, "endSec": 0.35, "probability": 0.98},
            {"word": "algorithm", "startSec": 0.4, "endSec": 0.85, "probability": 0.98},
            {"word": "delivers", "startSec": 0.9, "endSec": 1.35, "probability": 0.95},
            # "remarkable" was swallowed here! delivers ends at 1.35, stability starts at 1.40 (gap = 0.05s)
            {"word": "stability", "startSec": 1.40, "endSec": 1.85, "probability": 0.95},
            {"word": "for", "startSec": 1.9, "endSec": 2.05, "probability": 0.98},
            {"word": "speech.", "startSec": 2.1, "endSec": 2.5, "probability": 0.98},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words)
        omission_issues = [i for i in issues if i["code"] in ("MISSING_WORD", "POSSIBLE_OMISSION")]
        self.assertEqual(len(omission_issues), 1)
        self.assertEqual(omission_issues[0]["words"], ["remarkable"])
        self.assertIn("remarkable", omission_issues[0]["message"])

    def test_mandatory_stutter_at_that_comfortable(self):
        """Mandatory requirement: 'that comfortable' in script vs 'that that comfortable' in ASR flags stutter at 00:47."""
        nevada_text = "Out in the Nevada desert, that comfortable certainty just shattered."
        nevada_asr = [
            {"word": "Out", "startSec": 45.5, "endSec": 45.8, "probability": 0.95},
            {"word": "in", "startSec": 45.8, "endSec": 46.0, "probability": 0.95},
            {"word": "the", "startSec": 46.0, "endSec": 46.2, "probability": 0.95},
            {"word": "Nevada", "startSec": 46.2, "endSec": 46.8, "probability": 0.95},
            {"word": "desert,", "startSec": 46.8, "endSec": 47.4, "probability": 0.95},
            {"word": "that", "startSec": 47.6, "endSec": 48.06, "probability": 0.775},
            {"word": "that", "startSec": 48.06, "endSec": 48.20, "probability": 0.855},
            {"word": "comfortable", "startSec": 48.20, "endSec": 48.56, "probability": 0.967},
            {"word": "certainty", "startSec": 48.6, "endSec": 49.2, "probability": 0.95},
            {"word": "just", "startSec": 49.2, "endSec": 49.6, "probability": 0.95},
            {"word": "shattered.", "startSec": 49.6, "endSec": 50.4, "probability": 0.95},
        ]
        issues = audio_quality.analyze_word_alignment_issues(nevada_text, nevada_asr)
        self.assertEqual(len(issues), 1)
        stutter_issue = issues[0]
        self.assertEqual(stutter_issue["severity"], "warning")
        self.assertEqual(stutter_issue["code"], "SUSPECTED_STUTTER")
        self.assertIn("that comfortable", stutter_issue["message"])
        self.assertIn("00:47", stutter_issue["message"])

    def test_mandatory_intentional_repetition_not_flagged(self):
        """Mandatory requirement: 'that that is correct' present in both script and ASR must not be flagged."""
        text = "I know that that is correct."
        mock_words = [
            {"word": "I", "startSec": 0.1, "endSec": 0.3, "probability": 0.98},
            {"word": "know", "startSec": 0.35, "endSec": 0.6, "probability": 0.98},
            {"word": "that", "startSec": 0.65, "endSec": 0.9, "probability": 0.98},
            {"word": "that", "startSec": 0.95, "endSec": 1.2, "probability": 0.98},
            {"word": "is", "startSec": 1.25, "endSec": 1.4, "probability": 0.98},
            {"word": "correct.", "startSec": 1.45, "endSec": 1.9, "probability": 0.98},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words)
        self.assertEqual(len(issues), 0)

    def test_mandatory_diesel_fuel_abnormal_pause(self):
        """Mandatory requirement: 'moving freight on diesel fuel' with 0.58s unpunctuated pause flags ABNORMAL_PAUSE."""
        text = "moving freight on diesel fuel"
        mock_words = [
            {"word": "moving", "startSec": 0.5, "endSec": 1.0, "probability": 0.95},
            {"word": "freight", "startSec": 1.05, "endSec": 1.5, "probability": 0.95},
            {"word": "on", "startSec": 1.55, "endSec": 1.8, "probability": 0.95},
            {"word": "diesel", "startSec": 1.85, "endSec": 2.25, "probability": 0.95},
            # 0.58s gap between diesel and fuel without punctuation in script
            {"word": "fuel", "startSec": 2.83, "endSec": 3.3, "probability": 0.95},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words)
        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0]["code"], "ABNORMAL_PAUSE")
        self.assertIn("diesel", issues[0]["message"])
        self.assertIn("fuel", issues[0]["message"])
        self.assertIn("0.58", issues[0]["message"])

    def test_mandatory_diesel_fuel_missing_freight(self):
        """Mandatory requirement: 'moving freight on diesel fuel' with swallowed 'freight' flags MISSING_WORD."""
        text = "moving freight on diesel fuel"
        mock_words = [
            {"word": "moving", "startSec": 0.5, "endSec": 1.0, "probability": 0.95},
            # 'freight' omitted: gap 0.05s < 0.18s between moving and on
            {"word": "on", "startSec": 1.05, "endSec": 1.3, "probability": 0.95},
            {"word": "diesel", "startSec": 1.35, "endSec": 1.75, "probability": 0.95},
            {"word": "fuel", "startSec": 1.8, "endSec": 2.2, "probability": 0.95},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words)
        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0]["code"], "MISSING_WORD")
        self.assertIn("freight", issues[0]["message"])

    def test_mandatory_homophone_sysco_cisco_not_flagged(self):
        """Mandatory requirement: Homophones / phonetic equivalences like PepsiCo, Sysco vs Cisco are not flagged."""
        text = "Companies like PepsiCo, Sysco, and others."
        mock_words = [
            {"word": "Companies", "startSec": 0.1, "endSec": 0.6, "probability": 0.95},
            {"word": "like", "startSec": 0.65, "endSec": 0.9, "probability": 0.95},
            {"word": "PepsiCo,", "startSec": 0.95, "endSec": 1.5, "probability": 0.95},
            {"word": "Cisco,", "startSec": 1.8, "endSec": 2.2, "probability": 0.95},
            {"word": "and", "startSec": 2.4, "endSec": 2.55, "probability": 0.95},
            {"word": "others.", "startSec": 2.6, "endSec": 3.0, "probability": 0.95},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words)
        self.assertEqual(len(issues), 0)

    def test_mandatory_numbers_and_contractions_not_flagged(self):
        """Mandatory requirement: Numbers (10 vs ten) and contractions (cannot vs can't) are not flagged."""
        text = "I have 10 ideas and cannot wait."
        mock_words = [
            {"word": "I", "startSec": 0.1, "endSec": 0.25, "probability": 0.98},
            {"word": "have", "startSec": 0.28, "endSec": 0.45, "probability": 0.98},
            {"word": "ten", "startSec": 0.48, "endSec": 0.75, "probability": 0.98},
            {"word": "ideas", "startSec": 0.78, "endSec": 1.15, "probability": 0.98},
            {"word": "and", "startSec": 1.18, "endSec": 1.30, "probability": 0.98},
            {"word": "can't", "startSec": 1.32, "endSec": 1.65, "probability": 0.98},
            {"word": "wait.", "startSec": 1.68, "endSec": 2.05, "probability": 0.98},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words)
        self.assertEqual(len(issues), 0)

    def test_rapid_response_mobile_service_swallowed(self):
        """Mandatory requirement from SPEC: 'rapid response mobile service' where 'mobile'
        is swallowed/merged with 'response' into ASR 'responsible' must flag SUSPECTED_SWALLOWED."""
        text = "Tesla cannot scale home robotics without building a vast nationwide rapid response mobile service network across North America."
        mock_words = [
            {"word": "Tesla", "startSec": 0.1, "endSec": 0.5, "probability": 0.95},
            {"word": "cannot", "startSec": 0.52, "endSec": 0.9, "probability": 0.95},
            {"word": "scale", "startSec": 0.92, "endSec": 1.25, "probability": 0.95},
            {"word": "home", "startSec": 1.28, "endSec": 1.55, "probability": 0.95},
            {"word": "robotics", "startSec": 1.58, "endSec": 2.1, "probability": 0.95},
            {"word": "without", "startSec": 2.15, "endSec": 2.45, "probability": 0.95},
            {"word": "building", "startSec": 2.48, "endSec": 2.85, "probability": 0.95},
            {"word": "a", "startSec": 2.88, "endSec": 2.95, "probability": 0.95},
            {"word": "vast", "startSec": 2.98, "endSec": 3.3, "probability": 0.95},
            {"word": "nationwide", "startSec": 3.35, "endSec": 3.85, "probability": 0.95},
            {"word": "rapid", "startSec": 3.9, "endSec": 4.25, "probability": 0.95},
            # Here: 'response mobile' was pronounced dính/nuốt and ASR returns 'responsible' at 4.28-4.85
            {"word": "responsible", "startSec": 4.28, "endSec": 4.85, "probability": 0.92},
            {"word": "service", "startSec": 4.88, "endSec": 5.25, "probability": 0.95},
            {"word": "network", "startSec": 5.28, "endSec": 5.7, "probability": 0.95},
            {"word": "across", "startSec": 5.72, "endSec": 6.05, "probability": 0.95},
            {"word": "North", "startSec": 6.1, "endSec": 6.4, "probability": 0.95},
            {"word": "America.", "startSec": 6.42, "endSec": 6.9, "probability": 0.95},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words)
        self.assertEqual(len(issues), 1)
        swallowed = issues[0]
        self.assertEqual(swallowed["severity"], "warning")
        self.assertEqual(swallowed["code"], "SUSPECTED_SWALLOWED")
        self.assertIn("response mobile service", swallowed["message"])
        self.assertIn("00:04", swallowed["message"])
        self.assertIn("Vui lòng nghe lại", swallowed["message"])

    def test_partial_syllable_truncation(self):
        """Mandatory requirement: Incomplete pronunciation / truncated syllable like 'mobile' -> 'mo' flags PARTIAL_PRONUNCIATION."""
        text = "rapid response mobile service"
        mock_words = [
            {"word": "rapid", "startSec": 0.1, "endSec": 0.4, "probability": 0.95},
            {"word": "response", "startSec": 0.45, "endSec": 0.85, "probability": 0.95},
            # Truncated syllable: 'mo' instead of 'mobile'
            {"word": "mo", "startSec": 0.88, "endSec": 1.05, "probability": 0.88},
            {"word": "service", "startSec": 1.08, "endSec": 1.5, "probability": 0.95},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words)
        self.assertEqual(len(issues), 1)
        trunc = issues[0]
        self.assertEqual(trunc["severity"], "warning")
        self.assertEqual(trunc["code"], "PARTIAL_PRONUNCIATION")
        self.assertIn("mo", trunc["message"])
        self.assertIn("00:00", trunc["message"])

    def test_proper_nouns_not_falsely_flagged(self):
        """Proper nouns with slight phonetic transliteration differences must not be flagged as swallowed words."""
        text = "Visiting Nevada and Tokyo with Elon."
        mock_words = [
            {"word": "Visiting", "startSec": 0.1, "endSec": 0.5, "probability": 0.95},
            {"word": "Navada", "startSec": 0.55, "endSec": 0.95, "probability": 0.95},
            {"word": "and", "startSec": 0.98, "endSec": 1.1, "probability": 0.95},
            {"word": "Tokyo", "startSec": 1.15, "endSec": 1.5, "probability": 0.95},
            {"word": "with", "startSec": 1.52, "endSec": 1.7, "probability": 0.95},
            {"word": "Elon.", "startSec": 1.75, "endSec": 2.1, "probability": 0.95},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words)
        self.assertEqual(len(issues), 0)

    def test_vietnamese_diacritics_not_falsely_flagged(self):
        """Vietnamese unaccented ASR variations (tieng Viet vs tiếng Việt) must not be flagged as swallowed words."""
        text = "Hệ thống nhận diện giọng nói tiếng Việt."
        mock_words = [
            {"word": "Hệ", "startSec": 0.1, "endSec": 0.3, "probability": 0.95},
            {"word": "thống", "startSec": 0.32, "endSec": 0.6, "probability": 0.95},
            {"word": "nhận", "startSec": 0.62, "endSec": 0.85, "probability": 0.95},
            {"word": "diện", "startSec": 0.88, "endSec": 1.1, "probability": 0.95},
            {"word": "giọng", "startSec": 1.12, "endSec": 1.35, "probability": 0.95},
            {"word": "nói", "startSec": 1.38, "endSec": 1.6, "probability": 0.95},
            {"word": "tieng", "startSec": 1.62, "endSec": 1.9, "probability": 0.95},
            {"word": "Viet.", "startSec": 1.92, "endSec": 2.2, "probability": 0.95},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words, language="vi")
        self.assertEqual(len(issues), 0)

    def test_clarity_time_stretch(self):
        from voxlab_sidecar.audio_ops import apply_clarity_time_stretch
        # Create 1 second of 440Hz test sine tone
        sr = 22050
        t = np.linspace(0, 1.0, sr, endpoint=False, dtype=np.float32)
        sine = np.sin(2 * np.pi * 440 * t)

        stretched = apply_clarity_time_stretch(sine, sr=sr, rate=0.95)
        # Should be stretched by ~5.26%
        ratio = len(stretched) / len(sine)
        self.assertGreater(ratio, 1.04)
        self.assertLess(ratio, 1.07)
        self.assertLessEqual(float(np.max(np.abs(stretched))), 1.0)

    def test_case_a_extra_word_carrier_hallucination(self):
        """Case A: ASR has 'It's inside an industrial plant' when text is 'Inside an industrial plant...'."""
        text = "Inside an industrial plant, hazards are governed by corporate insurance policies and clear workers compensation statutes."
        mock_words = [
            {"word": "It's", "startSec": 0.05, "endSec": 0.25, "probability": 0.88},
            {"word": "inside", "startSec": 0.28, "endSec": 0.65, "probability": 0.95},
            {"word": "an", "startSec": 0.68, "endSec": 0.80, "probability": 0.95},
            {"word": "industrial", "startSec": 0.85, "endSec": 1.40, "probability": 0.95},
            {"word": "plant,", "startSec": 1.45, "endSec": 1.85, "probability": 0.95},
            {"word": "hazards", "startSec": 1.95, "endSec": 2.45, "probability": 0.95},
            {"word": "are", "startSec": 2.50, "endSec": 2.65, "probability": 0.95},
            {"word": "governed", "startSec": 2.70, "endSec": 3.10, "probability": 0.95},
            {"word": "by", "startSec": 3.15, "endSec": 3.30, "probability": 0.95},
            {"word": "corporate", "startSec": 3.35, "endSec": 3.85, "probability": 0.95},
            {"word": "insurance", "startSec": 3.90, "endSec": 4.40, "probability": 0.95},
            {"word": "policies", "startSec": 4.45, "endSec": 4.95, "probability": 0.95},
            {"word": "and", "startSec": 5.00, "endSec": 5.15, "probability": 0.95},
            {"word": "clear", "startSec": 5.20, "endSec": 5.55, "probability": 0.95},
            {"word": "workers", "startSec": 5.60, "endSec": 6.00, "probability": 0.95},
            {"word": "compensation", "startSec": 6.05, "endSec": 6.75, "probability": 0.95},
            {"word": "statutes.", "startSec": 6.80, "endSec": 7.40, "probability": 0.95},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words, audio_duration_sec=7.5)
        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0]["severity"], "warning")
        self.assertEqual(issues[0]["code"], "EXTRA_WORD")
        self.assertIn("Nghi vấn phát âm thừa từ 'It's' trước 'Inside'", issues[0]["message"])
        self.assertIn("00:00", issues[0]["message"])

    def test_case_a_exact_match_clean(self):
        """Case A clean: When script contains 'It's inside an industrial plant', no extra word warning is flagged."""
        text = "It's inside an industrial plant, hazards are governed by corporate insurance policies."
        mock_words = [
            {"word": "It's", "startSec": 0.05, "endSec": 0.25, "probability": 0.95},
            {"word": "inside", "startSec": 0.28, "endSec": 0.65, "probability": 0.95},
            {"word": "an", "startSec": 0.68, "endSec": 0.80, "probability": 0.95},
            {"word": "industrial", "startSec": 0.85, "endSec": 1.40, "probability": 0.95},
            {"word": "plant,", "startSec": 1.45, "endSec": 1.85, "probability": 0.95},
            {"word": "hazards", "startSec": 1.95, "endSec": 2.45, "probability": 0.95},
            {"word": "are", "startSec": 2.50, "endSec": 2.65, "probability": 0.95},
            {"word": "governed", "startSec": 2.70, "endSec": 3.10, "probability": 0.95},
            {"word": "by", "startSec": 3.15, "endSec": 3.30, "probability": 0.95},
            {"word": "corporate", "startSec": 3.35, "endSec": 3.85, "probability": 0.95},
            {"word": "insurance", "startSec": 3.90, "endSec": 4.40, "probability": 0.95},
            {"word": "policies.", "startSec": 4.45, "endSec": 4.95, "probability": 0.95},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words, audio_duration_sec=5.0)
        self.assertEqual(len(issues), 0)

    def test_case_b_unexpected_letter_spelling_bot_t(self):
        """Case B: 'Comment BOT if' vs ASR 'Comment Bot T if' flags UNEXPECTED_LETTER_SPELLING."""
        text = "Comment BOT if you would trust a twenty five thousand dollar Tesla Optimus robot in your home."
        mock_words = [
            {"word": "Comment", "startSec": 0.10, "endSec": 0.50, "probability": 0.95},
            {"word": "Bot", "startSec": 0.55, "endSec": 0.90, "probability": 0.95},
            # Extra single letter 'T' detected after 'BOT'
            {"word": "T", "startSec": 0.95, "endSec": 1.15, "probability": 0.85},
            {"word": "if", "startSec": 1.20, "endSec": 1.35, "probability": 0.95},
            {"word": "you", "startSec": 1.40, "endSec": 1.55, "probability": 0.95},
            {"word": "would", "startSec": 1.60, "endSec": 1.80, "probability": 0.95},
            {"word": "trust", "startSec": 1.85, "endSec": 2.20, "probability": 0.95},
            {"word": "a", "startSec": 2.25, "endSec": 2.35, "probability": 0.95},
            {"word": "twenty", "startSec": 2.40, "endSec": 2.75, "probability": 0.95},
            {"word": "five", "startSec": 2.80, "endSec": 3.10, "probability": 0.95},
            {"word": "thousand", "startSec": 3.15, "endSec": 3.55, "probability": 0.95},
            {"word": "dollar", "startSec": 3.60, "endSec": 3.95, "probability": 0.95},
            {"word": "Tesla", "startSec": 4.00, "endSec": 4.35, "probability": 0.95},
            {"word": "Optimus", "startSec": 4.40, "endSec": 4.85, "probability": 0.95},
            {"word": "robot", "startSec": 4.90, "endSec": 5.25, "probability": 0.95},
            {"word": "in", "startSec": 5.30, "endSec": 5.45, "probability": 0.95},
            {"word": "your", "startSec": 5.50, "endSec": 5.65, "probability": 0.95},
            {"word": "home.", "startSec": 5.70, "endSec": 6.10, "probability": 0.95},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words, audio_duration_sec=6.2)
        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0]["severity"], "warning")
        self.assertEqual(issues[0]["code"], "UNEXPECTED_LETTER_SPELLING")
        self.assertIn("Nghi vấn sinh thêm chữ cái 'T' sau 'BOT'", issues[0]["message"])
        self.assertIn("00:00", issues[0]["message"])

    def test_case_b_exact_match_clean(self):
        """Case B clean: When BOT is pronounced cleanly as a word, no warning is flagged."""
        text = "Comment BOT if you would trust a robot in your home."
        mock_words = [
            {"word": "Comment", "startSec": 0.10, "endSec": 0.50, "probability": 0.95},
            {"word": "BOT", "startSec": 0.55, "endSec": 0.90, "probability": 0.95},
            {"word": "if", "startSec": 0.95, "endSec": 1.15, "probability": 0.95},
            {"word": "you", "startSec": 1.20, "endSec": 1.35, "probability": 0.95},
            {"word": "would", "startSec": 1.40, "endSec": 1.60, "probability": 0.95},
            {"word": "trust", "startSec": 1.65, "endSec": 2.00, "probability": 0.95},
            {"word": "a", "startSec": 2.05, "endSec": 2.15, "probability": 0.95},
            {"word": "robot", "startSec": 2.20, "endSec": 2.55, "probability": 0.95},
            {"word": "in", "startSec": 2.60, "endSec": 2.75, "probability": 0.95},
            {"word": "your", "startSec": 2.80, "endSec": 2.95, "probability": 0.95},
            {"word": "home.", "startSec": 3.00, "endSec": 3.40, "probability": 0.95},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words, audio_duration_sec=3.5)
        self.assertEqual(len(issues), 0)

    def test_case_b_human_exact_match_clean(self):
        """Common uppercase words like 'HUMAN' are read normally and not flagged."""
        text = "Comment HUMAN if you agree with this statement."
        mock_words = [
            {"word": "Comment", "startSec": 0.10, "endSec": 0.50, "probability": 0.95},
            {"word": "HUMAN", "startSec": 0.55, "endSec": 0.95, "probability": 0.95},
            {"word": "if", "startSec": 1.00, "endSec": 1.20, "probability": 0.95},
            {"word": "you", "startSec": 1.25, "endSec": 1.40, "probability": 0.95},
            {"word": "agree", "startSec": 1.45, "endSec": 1.80, "probability": 0.95},
            {"word": "with", "startSec": 1.85, "endSec": 2.00, "probability": 0.95},
            {"word": "this", "startSec": 2.05, "endSec": 2.25, "probability": 0.95},
            {"word": "statement.", "startSec": 2.30, "endSec": 2.85, "probability": 0.95},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words, audio_duration_sec=3.0)
        self.assertEqual(len(issues), 0)

    def test_real_acronyms_spelled_clean(self):
        """Real acronyms like USA, FBI, AI spelled out by TTS/ASR do not trigger false warnings."""
        text = "The USA and FBI utilize advanced AI models for safety."
        mock_words = [
            {"word": "The", "startSec": 0.1, "endSec": 0.25, "probability": 0.95},
            {"word": "U", "startSec": 0.3, "endSec": 0.45, "probability": 0.95},
            {"word": "S", "startSec": 0.5, "endSec": 0.65, "probability": 0.95},
            {"word": "A", "startSec": 0.7, "endSec": 0.85, "probability": 0.95},
            {"word": "and", "startSec": 0.9, "endSec": 1.05, "probability": 0.95},
            {"word": "F", "startSec": 1.1, "endSec": 1.25, "probability": 0.95},
            {"word": "B", "startSec": 1.3, "endSec": 1.45, "probability": 0.95},
            {"word": "I", "startSec": 1.5, "endSec": 1.65, "probability": 0.95},
            {"word": "utilize", "startSec": 1.7, "endSec": 2.10, "probability": 0.95},
            {"word": "advanced", "startSec": 2.15, "endSec": 2.60, "probability": 0.95},
            {"word": "A", "startSec": 2.65, "endSec": 2.80, "probability": 0.95},
            {"word": "I", "startSec": 2.85, "endSec": 3.00, "probability": 0.95},
            {"word": "models", "startSec": 3.05, "endSec": 3.45, "probability": 0.95},
            {"word": "for", "startSec": 3.50, "endSec": 3.65, "probability": 0.95},
            {"word": "safety.", "startSec": 3.70, "endSec": 4.10, "probability": 0.95},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words, audio_duration_sec=4.2)
        self.assertEqual(len(issues), 0)

    def test_empty_asr_words_returns_unverified(self):
        """When Whisper returns 0 words on valid audio, validation status must be unverified, NOT pass."""
        valid_path = os.path.join(self.dir, "valid_speech.wav")
        _create_wav(valid_path, 2.5, sr=24000)

        # Mock whisper model returning empty segments
        class MockEmptyWhisper:
            def transcribe(self, *args, **kwargs):
                return [], None

        from unittest.mock import patch
        with patch("voxlab_sidecar.asr_engine.get_shared_whisper_model", return_value=MockEmptyWhisper()):
            with patch("voxlab_sidecar.asr_engine.find_whisper_model_dir", return_value="/mock/dir"):
                res = audio_quality.validate_audio_quality(valid_path, text="This is a test of empty recognition data")
                self.assertEqual(res["status"], "unverified")
                self.assertIn("không nhận dạng được từ nào", res["summary"])

    def test_low_coverage_returns_unverified(self):
        """When ASR coverage is < 20% on sentences with >= 6 words, status must be unverified."""
        valid_path = os.path.join(self.dir, "valid_speech_cov.wav")
        _create_wav(valid_path, 3.5, sr=24000)

        class MockWord:
            def __init__(self, word, start, end):
                self.word = word
                self.start = start
                self.end = end
                self.probability = 0.95

        class MockSegment:
            def __init__(self):
                self.words = [MockWord("This", 0.1, 0.4)]

        class MockLowCoverageWhisper:
            def transcribe(self, *args, **kwargs):
                return [MockSegment()], None

        from unittest.mock import patch
        with patch("voxlab_sidecar.asr_engine.get_shared_whisper_model", return_value=MockLowCoverageWhisper()):
            with patch("voxlab_sidecar.asr_engine.find_whisper_model_dir", return_value="/mock/dir"):
                # 10 words in script, only 1 detected (10% coverage < 20%)
                text = "This is a full sentence with ten words in total here"
                res = audio_quality.validate_audio_quality(valid_path, text=text)
                self.assertEqual(res["status"], "unverified")
                self.assertIn("độ phủ nhận dạng", res["summary"])

    def test_speed_scaled_abnormal_pause(self):
        """Pause threshold scales inversely with playback speed."""
        text = "moving freight on diesel fuel without pause"
        # 0.40s gap between diesel (end 1.5) and fuel (start 1.9)
        mock_words = [
            {"word": "moving", "startSec": 0.1, "endSec": 0.4, "probability": 0.95},
            {"word": "freight", "startSec": 0.45, "endSec": 0.8, "probability": 0.95},
            {"word": "on", "startSec": 0.85, "endSec": 1.0, "probability": 0.95},
            {"word": "diesel", "startSec": 1.05, "endSec": 1.5, "probability": 0.95},
            {"word": "fuel", "startSec": 1.90, "endSec": 2.2, "probability": 0.95},
            {"word": "without", "startSec": 2.25, "endSec": 2.6, "probability": 0.95},
            {"word": "pause", "startSec": 2.65, "endSec": 3.0, "probability": 0.95},
        ]
        # At speed=1.0: threshold is 0.50s -> 0.40s gap is NOT flagged
        issues_1x = audio_quality.analyze_word_alignment_issues(text, mock_words, speed=1.0)
        self.assertEqual(len(issues_1x), 0)

        # At speed=1.5: threshold is max(0.35, 0.50 / 1.5) = 0.35s -> 0.40s gap IS flagged
        issues_1_5x = audio_quality.analyze_word_alignment_issues(text, mock_words, speed=1.5)
        self.assertEqual(len(issues_1_5x), 1)
        self.assertEqual(issues_1_5x[0]["code"], "ABNORMAL_PAUSE")

    def test_line_break_in_delimiters_not_flagged_as_abnormal_pause(self):
        """Newlines in script are natural boundaries and do not trigger abnormal pause warnings."""
        text = "First line here\nSecond line follows"
        # 0.70s pause at newline between "here" and "Second"
        mock_words = [
            {"word": "First", "startSec": 0.1, "endSec": 0.4, "probability": 0.95},
            {"word": "line", "startSec": 0.45, "endSec": 0.7, "probability": 0.95},
            {"word": "here", "startSec": 0.75, "endSec": 1.0, "probability": 0.95},
            {"word": "Second", "startSec": 1.70, "endSec": 2.0, "probability": 0.95},
            {"word": "line", "startSec": 2.05, "endSec": 2.3, "probability": 0.95},
            {"word": "follows", "startSec": 2.35, "endSec": 2.7, "probability": 0.95},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words)
        self.assertEqual(len(issues), 0)

    def test_detect_acoustic_stutter_flags_repeated_syllables(self):
        """Acoustic stutter with short bursts and valley dip is detected via waveform."""
        sr = 24000
        # Create burst 1 (100ms 440Hz), silence valley (60ms), burst 2 (100ms 440Hz)
        t_burst = np.arange(int(0.10 * sr)) / sr
        burst = (0.35 * np.sin(2 * np.pi * 440 * t_burst)).astype(np.float32)
        valley = np.zeros(int(0.06 * sr), dtype=np.float32)
        audio = np.concatenate([np.zeros(int(0.1 * sr), dtype=np.float32), burst, valley, burst, np.zeros(int(0.1 * sr), dtype=np.float32)])

        stutters = audio_quality.detect_acoustic_stutter(audio, sr, text="single word")
        self.assertEqual(len(stutters), 1)
        self.assertEqual(stutters[0]["code"], "SUSPECTED_STUTTER")

    def test_detect_acoustic_stutter_ignores_vowel_elongation(self):
        """Continuous vowel elongation without energy dips is not flagged as stutter."""
        sr = 24000
        # Continuous uninterrupted 440Hz tone (300ms)
        t = np.arange(int(0.30 * sr)) / sr
        audio = (0.35 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)

        stutters = audio_quality.detect_acoustic_stutter(audio, sr, text="sooooo")
        self.assertEqual(len(stutters), 0)

    def test_detect_acoustic_stutter_ignores_intentional_script_repetition(self):
        """Intentional repetition in the script (e.g. 'that that') is not flagged as stutter."""
        sr = 24000
        t_burst = np.arange(int(0.10 * sr)) / sr
        burst = (0.35 * np.sin(2 * np.pi * 440 * t_burst)).astype(np.float32)
        valley = np.zeros(int(0.06 * sr), dtype=np.float32)
        audio = np.concatenate([np.zeros(int(0.1 * sr), dtype=np.float32), burst, valley, burst, np.zeros(int(0.1 * sr), dtype=np.float32)])

        mock_words = [
            {"word": "that", "startSec": 0.1, "endSec": 0.2, "probability": 0.95},
            {"word": "that", "startSec": 0.26, "endSec": 0.36, "probability": 0.95},
        ]
        # Text has intentional "that that"
        stutters = audio_quality.detect_acoustic_stutter(audio, sr, text="I said that that is correct", asr_words=mock_words)
        self.assertEqual(len(stutters), 0)

    def test_master_boundary_assembly_checks(self):
        """Master audio sequential assembly warns on excessive silence gap (>4.0s) and non-zero edges."""
        from voxlab_sidecar.audio_ops import assemble
        from voxlab_sidecar.server import RequestContext

        p1 = os.path.join(self.dir, "clip1.wav")
        p2 = os.path.join(self.dir, "clip2.wav")
        out = os.path.join(self.dir, "master.wav")

        # Clip 1 has a high amplitude cut at the end (0.35)
        sr = 44100
        data1 = np.ones(4410, dtype=np.float32) * 0.35
        sf.write(p1, data1, sr, subtype="PCM_16")

        # Clip 2 is normal
        data2 = np.zeros(4410, dtype=np.float32)
        sf.write(p2, data2, sr, subtype="PCM_16")

        class _MockCtx:
            cancelled = False
            def progress(self, *_a): pass
            def check_cancelled(self): pass

        ctx = _MockCtx()
        res = assemble("audio_ops.assemble", {
            "inputs": [
                {"path": p1, "gapAfterMs": 4500},  # > 4000ms excessive silence
                {"path": p2, "gapAfterMs": 0},
            ],
            "outputPath": out,
            "mode": "sequential",
        }, ctx)

        warnings = res.get("boundaryWarnings", [])
        self.assertTrue(any(w["type"] == "gap_too_long" for w in warnings))
        self.assertTrue(any(w["type"] == "click_pop_risk" for w in warnings))

    def test_vietnamese_phonetic_equivalence_gi_d_and_tr_ch(self):
        """Vietnamese phonetic variants (giọng vs dọng, trên vs chên) are equivalent and do not trigger swallowed/missing warnings."""
        text = "bản nghe thử giọng đọc mẫu trên VoxLab"
        mock_words = [
            {"word": "bản", "startSec": 0.1, "endSec": 0.3, "probability": 0.95},
            {"word": "nghe", "startSec": 0.35, "endSec": 0.55, "probability": 0.95},
            {"word": "thử", "startSec": 0.6, "endSec": 0.8, "probability": 0.95},
            {"word": "dọng", "startSec": 0.85, "endSec": 1.1, "probability": 0.95}, # giọng -> dọng
            {"word": "đọc", "startSec": 1.15, "endSec": 1.35, "probability": 0.95},
            {"word": "mẫu", "startSec": 1.4, "endSec": 1.6, "probability": 0.95},
            {"word": "chên", "startSec": 1.65, "endSec": 1.85, "probability": 0.95}, # trên -> chên
            {"word": "VoxLab", "startSec": 1.9, "endSec": 2.4, "probability": 0.95},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words)
        self.assertEqual(len(issues), 0)

    def test_loanword_podcast_equivalence(self):
        """Loanword 'podcast' recognized as 'cốt các' does not trigger swallowed warnings."""
        text = "Trong tập podcast ngày hôm nay"
        mock_words = [
            {"word": "Trong", "startSec": 0.1, "endSec": 0.3, "probability": 0.95},
            {"word": "tập", "startSec": 0.35, "endSec": 0.5, "probability": 0.95},
            {"word": "cốt", "startSec": 0.55, "endSec": 0.75, "probability": 0.95},
            {"word": "các", "startSec": 0.8, "endSec": 0.95, "probability": 0.95},
            {"word": "ngày", "startSec": 1.0, "endSec": 1.2, "probability": 0.95},
            {"word": "hôm", "startSec": 1.25, "endSec": 1.45, "probability": 0.95},
            {"word": "nay", "startSec": 1.5, "endSec": 1.7, "probability": 0.95},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words)
        self.assertEqual(len(issues), 0)

    def test_whisper_youtube_hallucination_filtered(self):
        """Whisper boilerplate hallucination tokens (e.g. subscribe, ghiền mì gõ) are filtered out and not flagged as EXTRA_WORD."""
        text = "chúng ta sẽ cùng khám phá"
        mock_words = [
            {"word": "subscribe", "startSec": 0.1, "endSec": 0.4, "probability": 0.95},
            {"word": "kênh", "startSec": 0.45, "endSec": 0.7, "probability": 0.95},
            {"word": "chúng", "startSec": 1.0, "endSec": 1.2, "probability": 0.95},
            {"word": "ta", "startSec": 1.25, "endSec": 1.4, "probability": 0.95},
            {"word": "sẽ", "startSec": 1.45, "endSec": 1.6, "probability": 0.95},
            {"word": "cùng", "startSec": 1.65, "endSec": 1.85, "probability": 0.95},
            {"word": "khám", "startSec": 1.9, "endSec": 2.1, "probability": 0.95},
            {"word": "phá", "startSec": 2.15, "endSec": 2.35, "probability": 0.95},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words)
        self.assertEqual(len(issues), 0)

    def test_prosodic_conjunction_pauses_not_flagged(self):
        """Natural pauses (<= 0.70s) before/after conjunctions like 'và' or 'that' are not flagged as abnormal pause."""
        text_vi = "Chúng ta tiếp tục và hoàn thành nhiệm vụ"
        mock_vi = [
            {"word": "Chúng", "startSec": 0.1, "endSec": 0.3, "probability": 0.95},
            {"word": "ta", "startSec": 0.35, "endSec": 0.5, "probability": 0.95},
            {"word": "tiếp", "startSec": 0.55, "endSec": 0.75, "probability": 0.95},
            {"word": "tục", "startSec": 0.80, "endSec": 1.0, "probability": 0.95},
            # 0.65s natural breath before conjunction 'và'
            {"word": "và", "startSec": 1.65, "endSec": 1.8, "probability": 0.95},
            {"word": "hoàn", "startSec": 1.85, "endSec": 2.05, "probability": 0.95},
            {"word": "thành", "startSec": 2.1, "endSec": 2.3, "probability": 0.95},
            {"word": "nhiệm", "startSec": 2.35, "endSec": 2.55, "probability": 0.95},
            {"word": "vụ", "startSec": 2.6, "endSec": 2.8, "probability": 0.95},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text_vi, mock_vi)
        self.assertEqual(len(issues), 0)

    def test_two_tier_stutter_between_different_script_words_not_flagged(self):
        """Burst candidates spanning across two different words from the script are discarded by Tier 2 verification."""
        sr = 24000
        # Two harmonic bursts (e.g. 100ms 440Hz), valley 50ms
        t_burst = np.arange(int(0.10 * sr)) / sr
        burst = (0.35 * np.sin(2 * np.pi * 440 * t_burst)).astype(np.float32)
        valley = np.zeros(int(0.05 * sr), dtype=np.float32)
        audio = np.concatenate([np.zeros(int(0.1 * sr), dtype=np.float32), burst, valley, burst, np.zeros(int(0.1 * sr), dtype=np.float32)])

        # ASR confirms burst 1 belongs to "thử" and burst 2 belongs to "giọng"
        mock_words = [
            {"word": "thử", "startSec": 0.08, "endSec": 0.22, "probability": 0.95},
            {"word": "giọng", "startSec": 0.24, "endSec": 0.38, "probability": 0.95},
        ]
        stutters = audio_quality.detect_acoustic_stutter(audio, sr, text="thử giọng", asr_words=mock_words)
        self.assertEqual(len(stutters), 0)


if __name__ == "__main__":
    unittest.main()
