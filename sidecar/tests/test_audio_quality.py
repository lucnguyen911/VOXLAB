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
        # At speed=1.0 -> effective WPM is ~384 > 240 threshold -> flags RAPID_PACE
        issues = audio_quality.analyze_word_alignment_issues(
            text, mock_words, speed=1.0, language="en", audio_duration_sec=2.5
        )
        self.assertTrue(any(i["code"] == "RAPID_PACE" for i in issues))

        # When user deliberately chose speed=1.5x -> normalized effective WPM is ~256 (still slightly fast)
        # But if speed=2.0x -> effective WPM is 192 < 240 threshold -> no RAPID_PACE warning!
        issues_fast = audio_quality.analyze_word_alignment_issues(
            text, mock_words, speed=2.0, language="en", audio_duration_sec=2.5
        )
        self.assertFalse(any(i["code"] == "RAPID_PACE" for i in issues_fast))

    def test_crowded_words_detection(self):
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
        self.assertEqual(len(crowded_issues), 1)
        self.assertIn("rapid", crowded_issues[0]["message"])
        self.assertIn("syllables", crowded_issues[0]["message"])

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


if __name__ == "__main__":
    unittest.main()
