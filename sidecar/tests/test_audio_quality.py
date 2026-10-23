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

    def test_tesla_internal_pause_detected_even_when_asr_word_matches(self):
        """A clear mid-word silent break (Te ... sla) must not be silently PASS."""
        sr = 16000
        left = 0.18 * np.sin(2 * np.pi * 240 * np.arange(int(0.24 * sr)) / sr)
        right = 0.18 * np.sin(2 * np.pi * 330 * np.arange(int(0.25 * sr)) / sr)
        wave = np.concatenate([
            np.zeros(int(0.15 * sr)), left,
            np.zeros(int(0.20 * sr)), right,
            np.zeros(int(0.15 * sr)),
        ]).astype(np.float32)
        words = [{"word": "Tesla", "startSec": 0.15, "endSec": 0.84, "probability": 0.98}]
        issues = audio_quality.detect_intra_word_pause(wave, sr, "Tesla", words)
        self.assertEqual(len(issues), 1, issues)
        self.assertEqual(issues[0]["code"], "SUSPICIOUS_INTRA_PAUSE")
        self.assertEqual(issues[0]["words"], ["tesla"])

        # A normal continuous word or a 40ms consonant closure is not a 200ms glitch.
        smooth = np.concatenate([np.zeros(int(0.15 * sr)), left, right, np.zeros(int(0.15 * sr))]).astype(np.float32)
        smooth_words = [{"word": "Tesla", "startSec": 0.15, "endSec": 0.64, "probability": 0.98}]
        self.assertEqual(audio_quality.detect_intra_word_pause(smooth, sr, "Tesla", smooth_words), [])
        short_pause = np.concatenate([
            np.zeros(int(0.15 * sr)), left, np.zeros(int(0.04 * sr)),
            right, np.zeros(int(0.15 * sr)),
        ]).astype(np.float32)
        short_words = [{"word": "Tesla", "startSec": 0.15, "endSec": 0.68, "probability": 0.98}]
        self.assertEqual(audio_quality.detect_intra_word_pause(short_pause, sr, "Tesla", short_words), [])

    def test_numeric_mismatch_secondary_asr_can_clear_or_mark_ambiguous(self):
        """1.2 != 0.2, but a conflicting Whisper number is not definitive TTS evidence."""
        from types import SimpleNamespace

        class SliceModel:
            def __init__(self, recognized):
                self.recognized = recognized

            def transcribe(self, *_args, **_kwargs):
                words = [
                    SimpleNamespace(word=w, start=i * 0.2, end=(i + 1) * 0.2, probability=0.95)
                    for i, w in enumerate(self.recognized.split())
                ]
                return [SimpleNamespace(text=self.recognized, words=words)], None

        sr = 16000
        waveform = np.zeros(sr * 2, dtype=np.float32)
        primary = [{"word": "0.2", "startSec": 0.4, "endSec": 0.9, "probability": 0.80}]
        correct = audio_quality._numeric_mismatch_review(
            "1.2", "0.2", primary, 0, 1, SliceModel("one point two"),
            waveform, sr, "en", 2.0,
        )
        self.assertIsNone(correct, "Second recognition of 1.2 must clear primary false warning")
        ambiguous = audio_quality._numeric_mismatch_review(
            "1.2", "0.2", primary, 0, 1, SliceModel("zero point two"),
            waveform, sr, "en", 2.0,
        )
        self.assertEqual(ambiguous["severity"], "unverified")
        self.assertEqual(ambiguous["code"], "UNVERIFIED_NUMBER")
        self.assertNotEqual(ambiguous["severity"], "warning")

        real_error = audio_quality._numeric_mismatch_review(
            "2.8", "2.4", primary, 0, 1, SliceModel("two point four"),
            waveform, sr, "en", 2.0,
        )
        self.assertEqual(real_error["code"], "SUSPECTED_MISPRONUNCIATION")
        self.assertEqual(real_error["severity"], "warning")

    def test_one_million_asr_dotted_digits_does_not_warn(self):
        text = "Sales reached one million dollars"
        words = [
            {"word": "Sales", "startSec": 0.10, "endSec": 0.35, "probability": 0.99},
            {"word": "reached", "startSec": 0.36, "endSec": 0.70, "probability": 0.99},
            {"word": "1.000.000", "startSec": 0.71, "endSec": 1.35, "probability": 0.99},
            {"word": "dollars", "startSec": 1.36, "endSec": 1.72, "probability": 0.99},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, words, language="en")
        self.assertEqual(issues, [], issues)

        # Whisper sometimes yields one dotted integer across multiple BPE words.
        fragments = [
            {"word": "Sales", "startSec": 0.10, "endSec": 0.35, "probability": 0.99},
            {"word": "reached", "startSec": 0.36, "endSec": 0.70, "probability": 0.99},
            {"word": "1.", "startSec": 0.71, "endSec": 0.85, "probability": 0.99},
            {"word": "000.", "startSec": 0.86, "endSec": 1.05, "probability": 0.99},
            {"word": "000", "startSec": 1.06, "endSec": 1.35, "probability": 0.99},
            {"word": "dollars", "startSec": 1.36, "endSec": 1.72, "probability": 0.99},
        ]
        self.assertEqual(audio_quality.analyze_word_alignment_issues(text, fragments, language="en"), [])

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

    def test_mispronunciation_detection_steering_vs_steelering(self):
        """Test 11 case: 'steering' pronounced with intrusive syllable as 'steelering' is detected as SUSPECTED_MISPRONUNCIATION."""
        text = "The steering wheel provides accurate feedback."
        mock_words = [
            {"word": "The", "startSec": 0.1, "endSec": 0.25, "probability": 0.95},
            {"word": "steelering", "startSec": 0.3, "endSec": 0.85, "probability": 0.92},
            {"word": "wheel", "startSec": 0.9, "endSec": 1.15, "probability": 0.95},
            {"word": "provides", "startSec": 1.2, "endSec": 1.55, "probability": 0.95},
            {"word": "accurate", "startSec": 1.6, "endSec": 1.95, "probability": 0.95},
            {"word": "feedback.", "startSec": 2.0, "endSec": 2.45, "probability": 0.95},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words)
        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0]["code"], "SUSPECTED_MISPRONUNCIATION")
        self.assertIn("steering", issues[0]["words"])
        self.assertIn("steelering", issues[0]["words"])

    def test_extra_word_detection_should_test_11(self):
        """Test 11 case: extra spoken word 'should' in 'so you never miss a single update' is detected as EXTRA_WORD."""
        text = "so you never miss a single update"
        mock_words = [
            {"word": "so", "startSec": 0.1, "endSec": 0.25, "probability": 0.95},
            {"word": "you", "startSec": 0.26, "endSec": 0.40, "probability": 0.95},
            {"word": "should", "startSec": 0.45, "endSec": 0.70, "probability": 0.88},
            {"word": "never", "startSec": 0.75, "endSec": 1.00, "probability": 0.95},
            {"word": "miss", "startSec": 1.05, "endSec": 1.25, "probability": 0.95},
            {"word": "a", "startSec": 1.26, "endSec": 1.35, "probability": 0.95},
            {"word": "single", "startSec": 1.40, "endSec": 1.70, "probability": 0.95},
            {"word": "update", "startSec": 1.75, "endSec": 2.10, "probability": 0.95},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words)
        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0]["code"], "EXTRA_WORD")
        self.assertEqual(issues[0]["words"], ["should"])

    def test_extra_word_detection_eat_test_10(self):
        """Test 10 case: extra spoken word 'Eat' outside script is detected as EXTRA_WORD."""
        text = "Inside an industrial plant, hazards are governed by policies."
        mock_words = [
            {"word": "Inside", "startSec": 0.1, "endSec": 0.4, "probability": 0.95},
            {"word": "Eat", "startSec": 0.45, "endSec": 0.75, "probability": 0.85},
            {"word": "an", "startSec": 0.8, "endSec": 0.95, "probability": 0.95},
            {"word": "industrial", "startSec": 1.0, "endSec": 1.5, "probability": 0.95},
            {"word": "plant,", "startSec": 1.55, "endSec": 1.9, "probability": 0.95},
            {"word": "hazards", "startSec": 2.0, "endSec": 2.4, "probability": 0.95},
            {"word": "are", "startSec": 2.45, "endSec": 2.6, "probability": 0.95},
            {"word": "governed", "startSec": 2.65, "endSec": 3.0, "probability": 0.95},
            {"word": "by", "startSec": 3.05, "endSec": 3.2, "probability": 0.95},
            {"word": "policies.", "startSec": 3.25, "endSec": 3.7, "probability": 0.95},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words)
        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0]["code"], "EXTRA_WORD")
        self.assertEqual(issues[0]["words"], ["eat"])

    def test_intentional_repetition_in_script_not_flagged(self):
        """Intentional repeat in script (e.g. 'that that') is not flagged as stutter or duplicate."""
        text = "He knew that that was the right answer."
        mock_words = [
            {"word": "He", "startSec": 0.1, "endSec": 0.3, "probability": 0.95},
            {"word": "knew", "startSec": 0.35, "endSec": 0.6, "probability": 0.95},
            {"word": "that", "startSec": 0.65, "endSec": 0.85, "probability": 0.95},
            {"word": "that", "startSec": 0.9, "endSec": 1.1, "probability": 0.95},
            {"word": "was", "startSec": 1.15, "endSec": 1.3, "probability": 0.95},
            {"word": "the", "startSec": 1.35, "endSec": 1.45, "probability": 0.95},
            {"word": "right", "startSec": 1.5, "endSec": 1.75, "probability": 0.95},
            {"word": "answer.", "startSec": 1.8, "endSec": 2.2, "probability": 0.95},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words)
        self.assertEqual(len(issues), 0)

    def test_compound_numbers_three_hundred_and_fifty_five_not_flagged(self):
        """Verifies that compound number words matching digit representations are not flagged as swallowed."""
        # English: 'three hundred' vs '300'
        text_en = "Now picture roughly three hundred cars filling it row after row."
        asr_en = [
            {"word": "Now", "startSec": 0.1, "endSec": 0.3, "probability": 0.98},
            {"word": "picture", "startSec": 0.35, "endSec": 0.7, "probability": 0.98},
            {"word": "roughly", "startSec": 0.75, "endSec": 1.1, "probability": 0.98},
            {"word": "300", "startSec": 1.15, "endSec": 1.6, "probability": 0.98},
            {"word": "cars", "startSec": 1.65, "endSec": 1.95, "probability": 0.98},
            {"word": "filling", "startSec": 2.0, "endSec": 2.3, "probability": 0.98},
            {"word": "it", "startSec": 2.35, "endSec": 2.45, "probability": 0.98},
            {"word": "row", "startSec": 2.5, "endSec": 2.7, "probability": 0.98},
            {"word": "after", "startSec": 2.75, "endSec": 2.95, "probability": 0.98},
            {"word": "row.", "startSec": 3.0, "endSec": 3.3, "probability": 0.98},
        ]
        issues_en = audio_quality.analyze_word_alignment_issues(text_en, asr_en, language="en")
        self.assertEqual(len(issues_en), 0, f"Expected 0 issues for three hundred -> 300, got: {issues_en}")

        # English: 'fifty five' vs '55'
        text_55 = "every American over fifty five should answer before these cars arrive."
        asr_55 = [
            {"word": "every", "startSec": 0.1, "endSec": 0.35, "probability": 0.98},
            {"word": "American", "startSec": 0.4, "endSec": 0.8, "probability": 0.98},
            {"word": "over", "startSec": 0.85, "endSec": 1.1, "probability": 0.98},
            {"word": "55", "startSec": 1.15, "endSec": 1.5, "probability": 0.98},
            {"word": "should", "startSec": 1.55, "endSec": 1.75, "probability": 0.98},
            {"word": "answer", "startSec": 1.8, "endSec": 2.1, "probability": 0.98},
            {"word": "before", "startSec": 2.15, "endSec": 2.4, "probability": 0.98},
            {"word": "these", "startSec": 2.45, "endSec": 2.65, "probability": 0.98},
            {"word": "cars", "startSec": 2.7, "endSec": 2.95, "probability": 0.98},
            {"word": "arrive.", "startSec": 3.0, "endSec": 3.4, "probability": 0.98},
        ]
        issues_55 = audio_quality.analyze_word_alignment_issues(text_55, asr_55, language="en")
        self.assertEqual(len(issues_55), 0, f"Expected 0 issues for fifty five -> 55, got: {issues_55}")

        # Vietnamese: 'ba trăm' vs '300'
        text_vi = "khoảng ba trăm chiếc xe xếp hàng."
        asr_vi = [
            {"word": "khoảng", "startSec": 0.1, "endSec": 0.4, "probability": 0.98},
            {"word": "300", "startSec": 0.45, "endSec": 0.85, "probability": 0.98},
            {"word": "chiếc", "startSec": 0.9, "endSec": 1.15, "probability": 0.98},
            {"word": "xe", "startSec": 1.2, "endSec": 1.45, "probability": 0.98},
            {"word": "xếp", "startSec": 1.5, "endSec": 1.75, "probability": 0.98},
            {"word": "hàng.", "startSec": 1.8, "endSec": 2.1, "probability": 0.98},
        ]
        issues_vi = audio_quality.analyze_word_alignment_issues(text_vi, asr_vi, language="vi")
        self.assertEqual(len(issues_vi), 0, f"Expected 0 issues for ba trăm -> 300, got: {issues_vi}")

    def test_multisyllabic_words_children_and_over_no_false_stutter(self):
        """Clean multisyllabic words (children, over) with natural syllable bursts do not trigger stutter warnings."""
        sr = 24000
        # Create audio with two bursts simulating syllables of 'children'
        t_burst = np.arange(int(0.10 * sr)) / sr
        burst = (0.35 * np.sin(2 * np.pi * 440 * t_burst)).astype(np.float32)
        gap = np.zeros(int(0.04 * sr), dtype=np.float32)
        audio = np.concatenate([np.zeros(int(0.1 * sr), dtype=np.float32), burst, gap, burst, np.zeros(int(0.1 * sr), dtype=np.float32)])

        # ASR recognizes a single multisyllabic word 'children' spanning the duration
        mock_words = [
            {"word": "children", "startSec": 0.08, "endSec": 0.36, "probability": 0.99},
        ]
        issues = audio_quality.detect_acoustic_stutter(audio, sr, text="children", asr_words=mock_words)
        self.assertEqual(len(issues), 0, f"Expected 0 issues for multisyllabic 'children', got: {issues}")

        # ASR recognizes 'over'
        mock_words_over = [
            {"word": "over", "startSec": 0.08, "endSec": 0.36, "probability": 0.97},
        ]
        issues_over = audio_quality.detect_acoustic_stutter(audio, sr, text="over", asr_words=mock_words_over)
        self.assertEqual(len(issues_over), 0, f"Expected 0 issues for multisyllabic 'over', got: {issues_over}")

    def test_swallowed_number_part_detected(self):
        """When a word of a compound number is swallowed, SUSPECTED_SWALLOWED is correctly raised."""
        # 'three hundred' in text, but ASR only captured 'three' (omitted 'hundred')
        text = "roughly three hundred cars"
        mock_words = [
            {"word": "roughly", "startSec": 0.1, "endSec": 0.4, "probability": 0.98},
            {"word": "three", "startSec": 0.45, "endSec": 0.75, "probability": 0.98},
            {"word": "cars", "startSec": 0.8, "endSec": 1.1, "probability": 0.98},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words, language="en")
        self.assertTrue(
            any(i["code"] in ("SUSPECTED_SWALLOWED", "MISSING_WORD") and "hundred" in i.get("words", []) for i in issues),
            f"Expected swallowed hundred, got: {issues}",
        )

        # 'fifty five' in text, but ASR only captured '50' (omitted 'five')
        text_55 = "American over fifty five should answer"
        mock_words_50 = [
            {"word": "American", "startSec": 0.1, "endSec": 0.5, "probability": 0.98},
            {"word": "over", "startSec": 0.55, "endSec": 0.8, "probability": 0.98},
            {"word": "50", "startSec": 0.85, "endSec": 1.1, "probability": 0.98},
            {"word": "should", "startSec": 1.15, "endSec": 1.45, "probability": 0.98},
            {"word": "answer", "startSec": 1.5, "endSec": 1.85, "probability": 0.98},
        ]
        issues_50 = audio_quality.analyze_word_alignment_issues(text_55, mock_words_50, language="en")
        self.assertTrue(
            any(i["code"] in ("SUSPECTED_SWALLOWED", "MISSING_WORD") and "five" in i.get("words", []) for i in issues_50),
            f"Expected swallowed five, got: {issues_50}",
        )

    def test_non_equivalent_numbers_detected(self):
        """Non-equivalent numbers (300 vs 50) are not marked equivalent and trigger warning."""
        text = "roughly three hundred cars"
        mock_words = [
            {"word": "roughly", "startSec": 0.1, "endSec": 0.4, "probability": 0.98},
            {"word": "50", "startSec": 0.45, "endSec": 0.75, "probability": 0.98},
            {"word": "cars", "startSec": 0.8, "endSec": 1.1, "probability": 0.98},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words, language="en")
        self.assertTrue(
            any(i["code"] in ("SUSPECTED_SWALLOWED", "SUSPECTED_MISPRONUNCIATION") for i in issues),
            f"Expected issue for 300 vs 50, got: {issues}",
        )

    def test_row_after_row_no_false_stutter(self):
        """Valid repetitions with intervening words like 'row after row' are not flagged as stutter."""
        text = "Picture roughly three hundred cars filling it, row after row, and not one of them has a steering wheel."
        sr = 24000
        t_burst = np.arange(int(0.12 * sr)) / sr
        burst = (0.35 * np.sin(2 * np.pi * 300 * t_burst)).astype(np.float32)

        audio = np.concatenate([
            np.zeros(int(0.05 * sr), dtype=np.float32),
            burst,
            np.zeros(int(0.10 * sr), dtype=np.float32),
            burst,
            np.zeros(int(0.1 * sr), dtype=np.float32)
        ])

        asr_words = [
            {"word": "Picture", "startSec": 0.0, "endSec": 0.3, "probability": 0.98},
            {"word": "roughly", "startSec": 0.35, "endSec": 0.6, "probability": 0.98},
            {"word": "300", "startSec": 0.65, "endSec": 0.9, "probability": 0.98},
            {"word": "cars", "startSec": 0.95, "endSec": 1.2, "probability": 0.98},
            {"word": "filling", "startSec": 1.25, "endSec": 1.5, "probability": 0.98},
            {"word": "it,", "startSec": 1.55, "endSec": 1.7, "probability": 0.98},
            {"word": "row", "startSec": 1.75, "endSec": 1.95, "probability": 0.98},
            {"word": "after", "startSec": 2.0, "endSec": 2.2, "probability": 0.98},
            {"word": "row,", "startSec": 2.25, "endSec": 2.45, "probability": 0.98},
            {"word": "and", "startSec": 2.5, "endSec": 2.6, "probability": 0.98},
            {"word": "not", "startSec": 2.65, "endSec": 2.8, "probability": 0.98},
            {"word": "one", "startSec": 2.85, "endSec": 3.0, "probability": 0.98},
            {"word": "of", "startSec": 3.05, "endSec": 3.15, "probability": 0.98},
            {"word": "them", "startSec": 3.2, "endSec": 3.35, "probability": 0.98},
            {"word": "has", "startSec": 3.4, "endSec": 3.55, "probability": 0.98},
            {"word": "a", "startSec": 3.6, "endSec": 3.65, "probability": 0.98},
            {"word": "steering", "startSec": 3.7, "endSec": 4.0, "probability": 0.98},
            {"word": "wheel.", "startSec": 4.05, "endSec": 4.3, "probability": 0.98},
        ]
        # Alignment check
        align_issues = audio_quality.analyze_word_alignment_issues(text, asr_words, language="en")
        self.assertEqual(len(align_issues), 0, f"Expected 0 alignment issues for row after row, got: {align_issues}")

        # Acoustic stutter check
        stutter_issues = audio_quality.detect_acoustic_stutter(audio, sr, text=text, asr_words=asr_words, language="en")
        self.assertEqual(len(stutter_issues), 0, f"Expected 0 stutter issues for row after row, got: {stutter_issues}")

    def test_row_row_after_row_flags_stutter(self):
        """Unintended consecutive repetition 'row row after row' flags warning."""
        text = "Picture roughly three hundred cars filling it, row after row, and not one of them has a steering wheel."
        asr_words_repeat = [
            {"word": "row", "startSec": 0.1, "endSec": 0.3, "probability": 0.98},
            {"word": "row", "startSec": 0.35, "endSec": 0.55, "probability": 0.98},
            {"word": "after", "startSec": 0.6, "endSec": 0.8, "probability": 0.98},
            {"word": "row,", "startSec": 0.85, "endSec": 1.05, "probability": 0.98},
        ]
        issues = audio_quality.analyze_word_alignment_issues("row after row", asr_words_repeat, language="en")
        self.assertTrue(
            any(i["code"] in ("REPEATED_WORD", "SUSPECTED_STUTTER") and "row" in i.get("words", []) for i in issues),
            f"Expected repeated row detected, got: {issues}",
        )

    def test_excessive_repeat_that_that_that_flags_repetition(self):
        """When text has 'that that' (2x) but ASR has 'that that that' (3x), the extra repeat is flagged."""
        text = "I know that that is true."
        mock_words = [
            {"word": "I", "startSec": 0.1, "endSec": 0.3, "probability": 0.98},
            {"word": "know", "startSec": 0.35, "endSec": 0.6, "probability": 0.98},
            {"word": "that", "startSec": 0.65, "endSec": 0.85, "probability": 0.98},
            {"word": "that", "startSec": 0.9, "endSec": 1.1, "probability": 0.98},
            {"word": "that", "startSec": 1.15, "endSec": 1.35, "probability": 0.98},
            {"word": "is", "startSec": 1.4, "endSec": 1.55, "probability": 0.98},
            {"word": "true.", "startSec": 1.6, "endSec": 1.9, "probability": 0.98},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words, language="en")
        self.assertTrue(
            any(i["code"] in ("REPEATED_WORD", "SUSPECTED_STUTTER") and "that" in i.get("words", []) for i in issues),
            f"Expected repeated that detected for 3x, got: {issues}",
        )

    def test_comma_number_sequence_alignment(self):
        """Comma-separated numbers like 'sixty nine, one hundred twenty six, one hundred fifty eight' align cleanly."""
        text = "sixty nine, one hundred twenty six, one hundred fifty eight"
        asr_words = [
            {"word": "69,", "startSec": 0.1, "endSec": 0.5, "probability": 0.99},
            {"word": "126,", "startSec": 0.6, "endSec": 1.1, "probability": 0.99},
            {"word": "158", "startSec": 1.2, "endSec": 1.8, "probability": 0.99},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, asr_words, language="en")
        self.assertEqual(len(issues), 0, f"Expected 0 issues for comma number sequence, got: {issues}")

    def test_chunk_30_decimal_separated_numbers_no_false_warning(self):
        """Chunk 30 scenario: TTS speaks all 5 decimal numbers correctly, ASR transcribes as separated numbers.
        Zero false 'Thiếu từ' (MISSING_WORD/SUSPECTED_SWALLOWED) warnings must be generated.
        """
        text = "zero point eight and two point eight plus one point four then four point two and thirteen point five"
        mock_words = [
            {"word": "0", "startSec": 0.1, "endSec": 0.40, "probability": 0.98},
            {"word": "8", "startSec": 0.55, "endSec": 0.85, "probability": 0.98},
            {"word": "and", "startSec": 0.90, "endSec": 1.05, "probability": 0.98},
            {"word": "2", "startSec": 1.15, "endSec": 1.45, "probability": 0.98},
            {"word": "8", "startSec": 1.60, "endSec": 1.90, "probability": 0.98},
            {"word": "plus", "startSec": 1.95, "endSec": 2.20, "probability": 0.98},
            {"word": "1", "startSec": 2.30, "endSec": 2.55, "probability": 0.98},
            {"word": "4", "startSec": 2.70, "endSec": 2.95, "probability": 0.98},
            {"word": "then", "startSec": 3.00, "endSec": 3.20, "probability": 0.98},
            {"word": "4", "startSec": 3.30, "endSec": 3.55, "probability": 0.98},
            {"word": "2", "startSec": 3.70, "endSec": 3.95, "probability": 0.98},
            {"word": "and", "startSec": 4.00, "endSec": 4.15, "probability": 0.98},
            {"word": "13", "startSec": 4.25, "endSec": 4.65, "probability": 0.98},
            {"word": "5", "startSec": 4.80, "endSec": 5.15, "probability": 0.98},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words, language="en", audio_duration_sec=5.3)
        self.assertEqual(len(issues), 0, f"Expected 0 issues for Chunk 30 decimals, got: {issues}")

    def test_single_decimals_separated_asr_no_false_warning(self):
        """Single decimal expressions in English and Vietnamese matching separated ASR output."""
        cases = [
            ("zero point eight", [{"word": "0", "startSec": 0.1, "endSec": 0.4, "probability": 0.98}, {"word": "8", "startSec": 0.55, "endSec": 0.85, "probability": 0.98}], "en"),
            ("two point eight", [{"word": "2", "startSec": 0.1, "endSec": 0.35, "probability": 0.98}, {"word": "8", "startSec": 0.5, "endSec": 0.8, "probability": 0.98}], "en"),
            ("thirteen point five", [{"word": "13", "startSec": 0.1, "endSec": 0.45, "probability": 0.98}, {"word": "5", "startSec": 0.6, "endSec": 0.9, "probability": 0.98}], "en"),
            ("không phẩy tám", [{"word": "0", "startSec": 0.1, "endSec": 0.35, "probability": 0.98}, {"word": "8", "startSec": 0.5, "endSec": 0.8, "probability": 0.98}], "vi"),
            ("0.8", [{"word": "0", "startSec": 0.1, "endSec": 0.35, "probability": 0.98}, {"word": "8", "startSec": 0.5, "endSec": 0.8, "probability": 0.98}], "en"),
            ("0,8", [{"word": "0", "startSec": 0.1, "endSec": 0.35, "probability": 0.98}, {"word": "8", "startSec": 0.5, "endSec": 0.8, "probability": 0.98}], "vi"),
        ]
        for phrase, asr_w, lang in cases:
            issues = audio_quality.analyze_word_alignment_issues(phrase, asr_w, language=lang, audio_duration_sec=1.0)
            self.assertEqual(len(issues), 0, f"Expected 0 issues for '{phrase}', got: {issues}")

    def test_decimal_actual_swallowed_point_flags_missing_word(self):
        """When TTS actually swallows or omits 'point' (says 'zero eight' with tight gap and short duration),
        a MISSING_WORD or SUSPECTED_SWALLOWED warning must be emitted.
        """
        text = "zero point eight"
        mock_words = [
            {"word": "0", "startSec": 0.1, "endSec": 0.25, "probability": 0.98},
            {"word": "8", "startSec": 0.28, "endSec": 0.42, "probability": 0.98},  # gap 0.03s, total 0.32s!
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words, language="en", audio_duration_sec=0.5)
        self.assertTrue(
            any(i["code"] in ("MISSING_WORD", "SUSPECTED_SWALLOWED") and "point" in i.get("words", []) for i in issues),
            f"Expected missing point detected for swallowed audio, got: {issues}",
        )

    def test_decimal_mispronunciation_wrong_numbers_flagged(self):
        """When digits differ (e.g. 'two point eight' but ASR transcribes '2 4' or '2.4'),
        SUSPECTED_MISPRONUNCIATION must be flagged.
        """
        text = "two point eight"
        # Case A: Separated wrong digits '2 4'
        asr_separated = [
            {"word": "2", "startSec": 0.1, "endSec": 0.35, "probability": 0.98},
            {"word": "4", "startSec": 0.5, "endSec": 0.8, "probability": 0.98},
        ]
        issues_a = audio_quality.analyze_word_alignment_issues(text, asr_separated, language="en")
        self.assertTrue(
            any(i["code"] == "SUSPECTED_MISPRONUNCIATION" for i in issues_a),
            f"Expected mispronunciation for 2.8 vs 2 4, got: {issues_a}",
        )

        # Case B: Single token wrong decimal '2.4'
        asr_single = [
            {"word": "2.4", "startSec": 0.1, "endSec": 0.6, "probability": 0.98},
        ]
        issues_b = audio_quality.analyze_word_alignment_issues(text, asr_single, language="en")
        self.assertTrue(
            any(i["code"] == "SUSPECTED_MISPRONUNCIATION" for i in issues_b),
            f"Expected mispronunciation for 2.8 vs 2.4, got: {issues_b}",
        )

    def test_decimal_repetition_and_extra_word_flagged(self):
        """When ASR transcribes repetition or extra word inside decimal expression, warnings must be emitted."""
        # Repetition 'zero point point eight'
        text_rep = "zero point eight"
        asr_rep = [
            {"word": "zero", "startSec": 0.1, "endSec": 0.3, "probability": 0.98},
            {"word": "point", "startSec": 0.35, "endSec": 0.55, "probability": 0.98},
            {"word": "point", "startSec": 0.6, "endSec": 0.8, "probability": 0.98},
            {"word": "eight", "startSec": 0.85, "endSec": 1.1, "probability": 0.98},
        ]
        issues_rep = audio_quality.analyze_word_alignment_issues(text_rep, asr_rep, language="en")
        self.assertTrue(
            any(i["code"] in ("REPEATED_WORD", "SUSPECTED_STUTTER") and "point" in i.get("words", []) for i in issues_rep),
            f"Expected repeated point detected, got: {issues_rep}",
        )

        # Extra word 'zero should point eight'
        text_extra = "zero point eight"
        asr_extra = [
            {"word": "zero", "startSec": 0.1, "endSec": 0.3, "probability": 0.98},
            {"word": "should", "startSec": 0.35, "endSec": 0.6, "probability": 0.98},
            {"word": "point", "startSec": 0.65, "endSec": 0.85, "probability": 0.98},
            {"word": "eight", "startSec": 0.9, "endSec": 1.15, "probability": 0.98},
        ]
        issues_extra = audio_quality.analyze_word_alignment_issues(text_extra, asr_extra, language="en")
        self.assertTrue(
            any(i["code"] == "EXTRA_WORD" and "should" in i.get("words", []) for i in issues_extra),
            f"Expected extra word 'should' detected, got: {issues_extra}",
        )

    def test_slow_reading_swallowed_point_flagged_with_audio_waveform(self):
        """CRITICAL TEST (User Prompt Section 10 - Group B):
        When TTS says 'zero eight' SLOWLY (e.g. total duration 1.0s, gap 0.25s with silence/pause),
        it must NEVER falsely pass as 'Đạt' merely because duration is long!
        Hypothesis B (omission) must be confirmed and MISSING_WORD must be emitted.
        """
        text = "zero point eight"
        sr = 16000
        # 1.1s total audio:
        # 0.0 - 0.1s: lead-in
        # 0.1 - 0.45s: speech for "0"
        # 0.45 - 0.70s: silent pause between "0" and "8" (RMS ~ 0.0)
        # 0.70 - 1.05s: speech for "8"
        total_samples = int(1.15 * sr)
        audio = np.zeros(total_samples, dtype=np.float32)
        # Add tone for "0"
        t_zero = np.arange(int(0.35 * sr)) / sr
        audio[int(0.1 * sr) : int(0.45 * sr)] = (0.3 * np.sin(2 * np.pi * 300 * t_zero)).astype(np.float32)
        # Silent gap: int(0.45 * sr) to int(0.70 * sr) is 0.0
        # Add tone for "8"
        t_eight = np.arange(int(0.35 * sr)) / sr
        audio[int(0.70 * sr) : int(1.05 * sr)] = (0.3 * np.sin(2 * np.pi * 350 * t_eight)).astype(np.float32)

        mock_words = [
            {"word": "0", "startSec": 0.10, "endSec": 0.45, "probability": 0.98},
            {"word": "8", "startSec": 0.70, "endSec": 1.05, "probability": 0.98},
        ]
        # In commit bb4e813, total_dec_dur = 0.95s >= 0.54s and gap = 0.25s >= 0.12s caused false pass!
        # With new Two-Hypothesis logic, silent gap without separator audio MUST flag MISSING_WORD:
        issues = audio_quality.analyze_word_alignment_issues(
            text,
            mock_words,
            language="en",
            audio_duration_sec=1.15,
            audio_data=audio,
            sample_rate=sr,
        )
        self.assertTrue(
            any(i["code"] in ("MISSING_WORD", "SUSPECTED_SWALLOWED") and "point" in i.get("words", []) for i in issues),
            f"Expected missing point detected on slow reading with silent pause, got: {issues}",
        )

    def test_two_hypothesis_slice_transcription_evaluation(self):
        """Simulate second-pass whisper transcription on audio slice:
        - When slice transcription detects 'point' or '0.8': Hypothesis A confirmed -> PASS.
        - When slice transcription detects 'zero eight' without separator (even slow): Hypothesis B confirmed -> MISSING_WORD.
        """
        text = "zero point eight"
        sr = 16000
        audio = np.zeros(int(1.2 * sr), dtype=np.float32)

        # Mock whisper segment and result helper
        class MockWord:
            def __init__(self, w):
                self.word = w

        class MockSeg:
            def __init__(self, text, words):
                self.text = text
                self.words = [MockWord(w) for w in words]

        class MockWhisperFull:
            def transcribe(self, audio_file, **kwargs):
                return [MockSeg("0.8", ["0.8"])], {}

        class MockWhisperOmission:
            def transcribe(self, audio_file, **kwargs):
                return [MockSeg("zero eight", ["zero", "eight"])], {}

        mock_words = [
            {"word": "0", "startSec": 0.10, "endSec": 0.40, "probability": 0.98},
            {"word": "8", "startSec": 0.65, "endSec": 0.95, "probability": 0.98},
        ]

        # Case 1: Slice re-transcription proves Hypothesis A (0.8 / point pronounced) -> PASS
        issues_pass = audio_quality.analyze_word_alignment_issues(
            text,
            mock_words,
            language="en",
            audio_duration_sec=1.2,
            audio_data=audio,
            sample_rate=sr,
            whisper_model=MockWhisperFull(),
        )
        self.assertEqual(len(issues_pass), 0, f"Expected 0 issues when slice proves Hypothesis A, got: {issues_pass}")

        # Case 2: Slice re-transcription proves Hypothesis B (only 'zero eight' pronounced) -> MISSING_WORD
        issues_fail = audio_quality.analyze_word_alignment_issues(
            text,
            mock_words,
            language="en",
            audio_duration_sec=1.2,
            audio_data=audio,
            sample_rate=sr,
            whisper_model=MockWhisperOmission(),
        )
        self.assertTrue(
            any(i["code"] in ("MISSING_WORD", "SUSPECTED_SWALLOWED") and "point" in i.get("words", []) for i in issues_fail),
            f"Expected missing point when slice proves omission, got: {issues_fail}",
        )

    def test_group_b_all_swallowed_decimals_flagged_both_fast_and_slow(self):
        """User Prompt Section 10 - Group B:
        - zero point eight -> zero eight (fast & slow)
        - two point eight -> two eight (fast & slow)
        - thirteen point five -> thirteen five (fast & slow)
        All must be flagged as MISSING_WORD.
        """
        cases = [
            ("zero point eight", "0", "8", "point"),
            ("two point eight", "2", "8", "point"),
            ("thirteen point five", "13", "5", "point"),
        ]
        sr = 16000

        class MockWhisperOmission:
            def transcribe(self, audio_file, **kwargs):
                return [], {}

        for phrase, w_num, f_num, sep in cases:
            # Sub-case: Fast reading (tight gap 0.04s, total 0.30s)
            mock_fast = [
                {"word": w_num, "startSec": 0.10, "endSec": 0.22, "probability": 0.98},
                {"word": f_num, "startSec": 0.26, "endSec": 0.40, "probability": 0.98},
            ]
            issues_fast = audio_quality.analyze_word_alignment_issues(
                phrase, mock_fast, language="en", audio_duration_sec=0.5
            )
            self.assertTrue(
                any(i["code"] in ("MISSING_WORD", "SUSPECTED_SWALLOWED") and sep in i.get("words", []) for i in issues_fast),
                f"Fast omitted '{phrase}' must flag missing separator, got: {issues_fast}",
            )

            # Sub-case: Slow reading (gap 0.25s silence, total 1.0s)
            audio_slow = np.zeros(int(1.2 * sr), dtype=np.float32)
            mock_slow = [
                {"word": w_num, "startSec": 0.10, "endSec": 0.45, "probability": 0.98},
                {"word": f_num, "startSec": 0.70, "endSec": 1.05, "probability": 0.98},
            ]
            issues_slow = audio_quality.analyze_word_alignment_issues(
                phrase,
                mock_slow,
                language="en",
                audio_duration_sec=1.2,
                audio_data=audio_slow,
                sample_rate=sr,
            )
            self.assertTrue(
                any(i["code"] in ("MISSING_WORD", "SUSPECTED_SWALLOWED") and sep in i.get("words", []) for i in issues_slow),
                f"Slow omitted '{phrase}' must flag missing separator, got: {issues_slow}",
            )

    def test_unverified_status_hierarchy_when_ambiguous(self):
        """When evidence cannot verify separator and model is missing with acoustic energy present,
        status must be 'unverified', never falsely 'pass'.
        """
        text = "zero point eight"
        sr = 16000
        # Audio with non-zero noise in the gap, but no whisper model to verify:
        audio = np.zeros(int(1.2 * sr), dtype=np.float32)
        # Put moderate noise in the gap:
        audio[int(0.45 * sr) : int(0.65 * sr)] = (0.05 * np.random.randn(int(0.20 * sr))).astype(np.float32)

        mock_words = [
            {"word": "0", "startSec": 0.10, "endSec": 0.45, "probability": 0.98},
            {"word": "8", "startSec": 0.65, "endSec": 1.00, "probability": 0.98},
        ]
        issues = audio_quality.analyze_word_alignment_issues(
            text,
            mock_words,
            language="en",
            audio_duration_sec=1.2,
            audio_data=audio,
            sample_rate=sr,
            whisper_model=None,  # No model available to verify
        )
        self.assertTrue(
            any(i.get("severity") == "unverified" for i in issues),
            f"Expected unverified status when ambiguous without model, got: {issues}",
        )

    def test_phase_a_number_currency_range_unit_equivalences_no_false_warnings(self):
        """Phase A mandatory equivalences: BPE-split thousands, ranges, currency, units, spoken digits, possessives."""
        cases = [
            (
                "Up to eighty two thousand pounds",
                [
                    {"word": "Up", "startSec": 0.1, "endSec": 0.25, "probability": 0.99},
                    {"word": "to", "startSec": 0.26, "endSec": 0.35, "probability": 0.99},
                    {"word": "82", "startSec": 0.40, "endSec": 0.70, "probability": 0.99},
                    {"word": ",000", "startSec": 0.72, "endSec": 1.05, "probability": 0.99},
                    {"word": "pounds", "startSec": 1.10, "endSec": 1.45, "probability": 0.99},
                ],
            ),
            (
                "About two thousand eight hundred cycles",
                [
                    {"word": "About", "startSec": 0.1, "endSec": 0.35, "probability": 0.99},
                    {"word": "2", "startSec": 0.40, "endSec": 0.60, "probability": 0.99},
                    {"word": ",800", "startSec": 0.62, "endSec": 0.95, "probability": 0.99},
                    {"word": "cycles", "startSec": 1.00, "endSec": 1.40, "probability": 0.99},
                ],
            ),
            (
                "Delivering seven to eight thousand units",
                [
                    {"word": "Delivering", "startSec": 0.1, "endSec": 0.5, "probability": 0.99},
                    {"word": "7", "startSec": 0.55, "endSec": 0.70, "probability": 0.99},
                    {"word": ",000", "startSec": 0.72, "endSec": 0.90, "probability": 0.99},
                    {"word": "to", "startSec": 0.92, "endSec": 1.05, "probability": 0.99},
                    {"word": "8", "startSec": 1.08, "endSec": 1.25, "probability": 0.99},
                    {"word": ",000", "startSec": 1.27, "endSec": 1.55, "probability": 0.99},
                    {"word": "units", "startSec": 1.60, "endSec": 1.95, "probability": 0.99},
                ],
            ),
            (
                "Slashes energy costs by sixty to seventy percent",
                [
                    {"word": "Slashes", "startSec": 0.1, "endSec": 0.4, "probability": 0.99},
                    {"word": "energy", "startSec": 0.45, "endSec": 0.75, "probability": 0.99},
                    {"word": "costs", "startSec": 0.80, "endSec": 1.05, "probability": 0.99},
                    {"word": "by", "startSec": 1.08, "endSec": 1.20, "probability": 0.99},
                    {"word": "60", "startSec": 1.25, "endSec": 1.55, "probability": 0.99},
                    {"word": "-70", "startSec": 1.60, "endSec": 1.95, "probability": 0.99},
                    {"word": "%", "startSec": 1.98, "endSec": 2.30, "probability": 0.99},
                ],
            ),
            (
                "Over seven hundred and seventy million miles",
                [
                    {"word": "Over", "startSec": 0.1, "endSec": 0.35, "probability": 0.99},
                    {"word": "770", "startSec": 0.40, "endSec": 0.95, "probability": 0.99},
                    {"word": "million", "startSec": 0.98, "endSec": 1.35, "probability": 0.99},
                    {"word": "miles", "startSec": 1.40, "endSec": 1.75, "probability": 0.99},
                ],
            ),
            (
                "Priced at two hundred and ninety thousand dollars",
                [
                    {"word": "Priced", "startSec": 0.1, "endSec": 0.4, "probability": 0.99},
                    {"word": "at", "startSec": 0.42, "endSec": 0.55, "probability": 0.99},
                    {"word": "$290", "startSec": 0.60, "endSec": 1.10, "probability": 0.99},
                    {"word": ",000", "startSec": 1.12, "endSec": 1.50, "probability": 0.99},
                ],
            ),
            (
                "Multiply that by one point five five kilowatt hours per unit",
                [
                    {"word": "Multiply", "startSec": 0.1, "endSec": 0.45, "probability": 0.99},
                    {"word": "that", "startSec": 0.48, "endSec": 0.65, "probability": 0.99},
                    {"word": "by", "startSec": 0.68, "endSec": 0.80, "probability": 0.99},
                    {"word": "1", "startSec": 0.85, "endSec": 1.05, "probability": 0.99},
                    {"word": ".55", "startSec": 1.25, "endSec": 1.65, "probability": 0.99},
                    {"word": "kWh", "startSec": 1.70, "endSec": 2.25, "probability": 0.99},
                    {"word": "per", "startSec": 2.30, "endSec": 2.45, "probability": 0.99},
                    {"word": "unit", "startSec": 2.50, "endSec": 2.85, "probability": 0.99},
                ],
            ),
            (
                "Built around the four six eight zero cell architecture",
                [
                    {"word": "Built", "startSec": 0.1, "endSec": 0.35, "probability": 0.99},
                    {"word": "around", "startSec": 0.38, "endSec": 0.65, "probability": 0.99},
                    {"word": "the", "startSec": 0.68, "endSec": 0.80, "probability": 0.99},
                    {"word": "4680", "startSec": 0.85, "endSec": 1.65, "probability": 0.99},
                    {"word": "cell", "startSec": 1.70, "endSec": 1.95, "probability": 0.99},
                    {"word": "architecture", "startSec": 2.00, "endSec": 2.55, "probability": 0.99},
                ],
            ),
            (
                "Supply of Tesla's fifty thousand dollar trucks",
                [
                    {"word": "Supply", "startSec": 0.1, "endSec": 0.45, "probability": 0.99},
                    {"word": "of", "startSec": 0.48, "endSec": 0.60, "probability": 0.99},
                    {"word": "Tesla's", "startSec": 0.65, "endSec": 1.05, "probability": 0.99},
                    {"word": "50", "startSec": 1.10, "endSec": 1.35, "probability": 0.99},
                    {"word": ",000", "startSec": 1.38, "endSec": 1.70, "probability": 0.99},
                    {"word": "trucks", "startSec": 1.75, "endSec": 2.15, "probability": 0.99},
                ],
            ),
        ]
        for text, mock_words in cases:
            issues = audio_quality.analyze_word_alignment_issues(text, mock_words, language="en")
            self.assertEqual(len(issues), 0, f"Expected 0 issues for '{text}', got: {issues}")

    def test_repeated_digit_numbers_55_88_no_false_stutter(self):
        """Multi-digit numbers with repeated digits like '55' and '88' must never trigger intra-word stutter."""
        sr = 24000
        t_burst = np.arange(int(0.10 * sr)) / sr
        burst = (0.35 * np.sin(2 * np.pi * 440 * t_burst)).astype(np.float32)
        valley = np.zeros(int(0.05 * sr), dtype=np.float32)
        audio = np.concatenate([np.zeros(int(0.1 * sr), dtype=np.float32), burst, valley, burst, np.zeros(int(0.1 * sr), dtype=np.float32)])

        for num_str, phrase in [("55", "fifty five"), ("88", "eighty eight")]:
            asr_words = [{"word": num_str, "startSec": 0.08, "endSec": 0.38, "probability": 0.99}]
            stutters = audio_quality.detect_acoustic_stutter(audio, sr, text=phrase, asr_words=asr_words, language="en")
            self.assertEqual(len(stutters), 0, f"Expected 0 stutter issues for '{num_str}', got: {stutters}")

    def test_wrong_cardinal_number_8200_vs_8300_flagged(self):
        """Wrong cardinal numbers (e.g. 8,300 spoken instead of 8,200) must flag SUSPECTED_MISPRONUNCIATION."""
        text = "The total weight is eight thousand two hundred pounds"
        mock_words = [
            {"word": "The", "startSec": 0.1, "endSec": 0.25, "probability": 0.99},
            {"word": "total", "startSec": 0.28, "endSec": 0.55, "probability": 0.99},
            {"word": "weight", "startSec": 0.58, "endSec": 0.85, "probability": 0.99},
            {"word": "is", "startSec": 0.88, "endSec": 1.00, "probability": 0.99},
            {"word": "8", "startSec": 1.05, "endSec": 1.30, "probability": 0.99},
            {"word": ",300", "startSec": 1.32, "endSec": 1.75, "probability": 0.99},
            {"word": "pounds", "startSec": 1.80, "endSec": 2.20, "probability": 0.99},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words, language="en")
        self.assertEqual(len(issues), 1, f"Expected 1 issue for 8200 vs 8300, got: {issues}")
        self.assertEqual(issues[0]["code"], "SUSPECTED_MISPRONUNCIATION")
        self.assertIn("8200", issues[0]["words"])
        self.assertIn("8300", issues[0]["words"])
        self.assertTrue(issues[0].get("sourceExcerpt"))
        self.assertTrue(issues[0].get("asrRawExcerpt"))
        self.assertTrue(issues[0].get("asrNormalizedExcerpt"))
        self.assertEqual(issues[0].get("tokenSource"), "primary_asr")

    def test_currency_dollars_and_cents_chunk37_no_false_missing_cents(self):
        """Regression test for Chunk 37: spoken 'five thousand nine hundred and twenty two dollars and fifty cents'
        and 'eight hundred and sixty two dollars and fifty cents' transcribed by Whisper as BPE tokens
        ['$5', ',922', '.50'] and ['$862', '.50.'] must not flag 'cents' as MISSING_WORD."""
        text = (
            "Through their Peak-Time Payback program, eligible homeowners can receive an initial upfront "
            "incentive of up to five thousand nine hundred and twenty two dollars and fifty cents just for "
            "installing a Powerwall Three and enrolling. On top of that, the program offers annual bill "
            "credits of up to eight hundred and sixty two dollars and fifty cents."
        )
        raw_tokens = [
            "Through", "their", "Peak", "-Time", "Payback", "program,", "eligible", "homeowners",
            "can", "receive", "an", "initial", "upfront", "incentive", "of", "up", "to",
            "$5", ",922", ".50", "just", "for", "installing", "a", "Powerwall", "3", "and",
            "enrolling.", "On", "top", "of", "that,", "the", "program", "offers", "annual",
            "bill", "credits", "of", "up", "to", "$862", ".50.",
        ]
        mock_words = [
            {
                "word": tok,
                "startSec": round(0.1 + idx * 0.35, 3),
                "endSec": round(0.1 + idx * 0.35 + 0.30, 3),
                "probability": 0.99,
            }
            for idx, tok in enumerate(raw_tokens)
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words, language="en")
        self.assertEqual(len(issues), 0, f"Expected 0 issues for Chunk 37 dollars and cents, got: {issues}")

    def test_acronym_missing_letters_gvec_spoken_as_gv_flagged(self):
        """Regression test for Chunk 37 (27.3s): when 'GVEC' in script is only spoken as 'GV' (missing 'EC')
        while 'five thousand nine hundred and twenty two dollars and fifty cents' is spoken in full,
        QC must flag 'GVEC' / 'EC' as MISSING_WORD and must NOT falsely flag 'cents'."""
        text = (
            "Take a look at the GVEC cooperative in Texas as a prime example. "
            "Through their Peak-Time Payback program, eligible homeowners can receive an initial upfront "
            "incentive of up to five thousand nine hundred and twenty two dollars and fifty cents just for "
            "installing a Powerwall Three and enrolling. On top of that, the program offers annual bill "
            "credits of up to eight hundred and sixty two dollars and fifty cents."
        )
        raw_tokens = [
            "take", "a", "look", "at", "the", "GV", "Cooperative", "in", "Texas", "as", "a", "prime", "example.",
            "Through", "their", "Peak", "Time", "Payback", "program,", "eligible", "homeowners",
            "can", "receive", "an", "initial", "upfront", "incentive", "of", "up", "to",
            "$5", ",922", ".50", "just", "for", "installing", "a", "Powerwall", "3", "and",
            "enrolling.", "On", "top", "of", "that,", "the", "program", "offers", "annual",
            "bill", "credits", "of", "up", "to", "$862", ".50.",
        ]
        mock_words = [
            {
                "word": tok,
                "startSec": round(0.1 + idx * 0.35, 3),
                "endSec": round(0.1 + idx * 0.35 + 0.30, 3),
                "probability": 0.98,
            }
            for idx, tok in enumerate(raw_tokens)
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words, language="en")
        self.assertEqual(len(issues), 1, f"Expected 1 issue for GVEC -> GV, got: {issues}")
        self.assertEqual(issues[0]["code"], "MISSING_WORD")
        self.assertIn("GVEC", issues[0]["words"])
        self.assertIn("EC", issues[0]["words"])
        self.assertNotIn("cents", issues[0]["words"])

    def test_whisper_hallucinated_comma_does_not_exempt_abnormal_pause(self):
        """Tầng 2 - Yêu cầu A: Punctuation generated by Whisper (e.g. 'diesel,') that does NOT exist
        in source text must never be used to exempt an abnormal pause, even if mapping is uncertain."""
        text = "The system relies on clean battery storage across the grid"
        # Whisper mistranscribes 'clean' slightly or leaves a unmapped token and adds a comma on 'battery,'
        mock_words = [
            {"word": "The", "startSec": 0.10, "endSec": 0.25, "probability": 0.98},
            {"word": "system", "startSec": 0.28, "endSec": 0.65, "probability": 0.98},
            {"word": "relies", "startSec": 0.68, "endSec": 1.05, "probability": 0.98},
            {"word": "on", "startSec": 1.08, "endSec": 1.22, "probability": 0.98},
            {"word": "cleen", "startSec": 1.25, "endSec": 1.55, "probability": 0.95},
            {"word": "battery,", "startSec": 1.58, "endSec": 2.00, "probability": 0.95},
            # 0.52s pause after 'battery,' where Whisper added a comma not in source text
            {"word": "storage", "startSec": 2.52, "endSec": 2.95, "probability": 0.98},
            {"word": "across", "startSec": 2.98, "endSec": 3.30, "probability": 0.98},
            {"word": "the", "startSec": 3.32, "endSec": 3.45, "probability": 0.98},
            {"word": "grid", "startSec": 3.48, "endSec": 3.85, "probability": 0.98},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words, language="en")
        pause_issues = [i for i in issues if i["code"] == "ABNORMAL_PAUSE"]
        self.assertEqual(len(pause_issues), 1, f"Expected 1 ABNORMAL_PAUSE, got: {issues}")
        self.assertIn("battery", pause_issues[0]["words"])
        self.assertIn("storage", pause_issues[0]["words"])

    def test_protected_entity_and_sandwiched_pause_powerwall_3_are_flagged(self):
        """Tầng 2 - Yêu cầu B: Detects abnormal pause inside protected entity 'Powerwall 3'
        and sandwiched short version token 'Powerwall ... 3 ... are' with waveform silence verification."""
        text = "And systems like the Tesla Powerwall 3 are suddenly at the center of the conversation."
        sr = 16000
        # Build a 20s waveform with speech energy except for silence windows at [16.12s, 16.36s] (240ms)
        # and [16.72s, 17.08s] (360ms), matching the real defect in sample 15.
        t = np.arange(int(20.0 * sr)) / sr
        audio = (0.12 * np.sin(2 * np.pi * 220.0 * t)).astype(np.float32)
        audio[int(16.12 * sr) : int(16.36 * sr)] = 0.0
        audio[int(16.72 * sr) : int(17.08 * sr)] = 0.0

        mock_words = [
            {"word": "And", "startSec": 13.72, "endSec": 13.90, "probability": 0.99},
            {"word": "systems", "startSec": 13.90, "endSec": 14.34, "probability": 0.99},
            {"word": "like", "startSec": 14.34, "endSec": 14.66, "probability": 0.99},
            {"word": "the", "startSec": 14.66, "endSec": 14.94, "probability": 0.99},
            {"word": "Tesla", "startSec": 14.94, "endSec": 15.42, "probability": 0.99},
            {"word": "Powerwall,", "startSec": 15.42, "endSec": 16.08, "probability": 0.98},
            {"word": "3,", "startSec": 16.20, "endSec": 16.52, "probability": 0.65},
            {"word": "are", "startSec": 16.80, "endSec": 17.18, "probability": 1.00},
            {"word": "suddenly", "startSec": 17.18, "endSec": 17.64, "probability": 0.99},
            {"word": "at", "startSec": 17.64, "endSec": 17.82, "probability": 0.99},
            {"word": "the", "startSec": 17.82, "endSec": 17.92, "probability": 0.99},
            {"word": "center", "startSec": 17.92, "endSec": 18.30, "probability": 0.99},
            {"word": "of", "startSec": 18.30, "endSec": 18.44, "probability": 0.99},
            {"word": "the", "startSec": 18.44, "endSec": 18.54, "probability": 0.99},
            {"word": "conversation.", "startSec": 18.54, "endSec": 19.30, "probability": 0.99},
        ]
        issues = audio_quality.analyze_word_alignment_issues(
            text,
            mock_words,
            language="en",
            audio_duration_sec=20.0,
            audio_data=audio,
            sample_rate=sr,
        )
        pause_issues = [i for i in issues if i["code"] == "ABNORMAL_PAUSE"]
        self.assertEqual(len(pause_issues), 1, f"Expected 1 sandwiched ABNORMAL_PAUSE issue, got: {issues}")
        iss = pause_issues[0]
        self.assertEqual(iss["words"], ["powerwall", "3", "are"])
        self.assertIn("protected_entity", iss.get("pauseContext", ""))

    def test_fluent_powerwall_3_does_not_flag_false_positive(self):
        """Fluent reading of 'Tesla Powerwall 3 are' with normal coarticulation must not trigger ABNORMAL_PAUSE."""
        text = "And systems like the Tesla Powerwall 3 are suddenly at the center of the conversation."
        mock_words = [
            {"word": "And", "startSec": 0.10, "endSec": 0.25, "probability": 0.99},
            {"word": "systems", "startSec": 0.26, "endSec": 0.65, "probability": 0.99},
            {"word": "like", "startSec": 0.66, "endSec": 0.90, "probability": 0.99},
            {"word": "the", "startSec": 0.91, "endSec": 1.05, "probability": 0.99},
            {"word": "Tesla", "startSec": 1.06, "endSec": 1.45, "probability": 0.99},
            {"word": "Powerwall", "startSec": 1.46, "endSec": 2.00, "probability": 0.99},
            {"word": "3", "startSec": 2.04, "endSec": 2.35, "probability": 0.99},
            {"word": "are", "startSec": 2.38, "endSec": 2.55, "probability": 0.99},
            {"word": "suddenly", "startSec": 2.58, "endSec": 3.00, "probability": 0.99},
            {"word": "at", "startSec": 3.02, "endSec": 3.15, "probability": 0.99},
            {"word": "the", "startSec": 3.16, "endSec": 3.28, "probability": 0.99},
            {"word": "center", "startSec": 3.30, "endSec": 3.65, "probability": 0.99},
            {"word": "of", "startSec": 3.66, "endSec": 3.78, "probability": 0.99},
            {"word": "the", "startSec": 3.79, "endSec": 3.90, "probability": 0.99},
            {"word": "conversation.", "startSec": 3.92, "endSec": 4.55, "probability": 0.99},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words, language="en")
        self.assertEqual(len(issues), 0, f"Expected 0 issues for fluent Powerwall 3, got: {issues}")

    def test_acronym_gvec_spelled_all_four_letters_passes(self):
        """GVEC spoken as G-V-E-C in order passes with 0 issues."""
        text = "Take a look at the GVEC cooperative in Texas."
        mock_words = [
            {"word": "Take", "startSec": 0.10, "endSec": 0.30, "probability": 0.99},
            {"word": "a", "startSec": 0.32, "endSec": 0.40, "probability": 0.99},
            {"word": "look", "startSec": 0.42, "endSec": 0.65, "probability": 0.99},
            {"word": "at", "startSec": 0.68, "endSec": 0.80, "probability": 0.99},
            {"word": "the", "startSec": 0.82, "endSec": 0.95, "probability": 0.99},
            {"word": "G", "startSec": 1.00, "endSec": 1.22, "probability": 0.95},
            {"word": "V", "startSec": 1.25, "endSec": 1.48, "probability": 0.95},
            {"word": "E", "startSec": 1.50, "endSec": 1.72, "probability": 0.95},
            {"word": "C", "startSec": 1.75, "endSec": 2.02, "probability": 0.96},
            {"word": "cooperative", "startSec": 2.08, "endSec": 2.65, "probability": 0.99},
            {"word": "in", "startSec": 2.68, "endSec": 2.82, "probability": 0.99},
            {"word": "Texas.", "startSec": 2.85, "endSec": 3.30, "probability": 0.99},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words, language="en")
        self.assertEqual(len(issues), 0, f"Expected 0 issues when GVEC is spelled G V E C, got: {issues}")

    def test_acronym_gvec_blended_syllable_gvec_ek_or_gvac_key_flagged(self):
        """GVEC spoken as partial syllable blend ('G V ek' or 'GVAC Key') must flag SUSPECTED_MISPRONUNCIATION."""
        text = "Take a look at the GVEC cooperative in Texas."
        for bad_tokens in (
            [
                {"word": "G", "startSec": 1.00, "endSec": 1.22, "probability": 0.92},
                {"word": "V", "startSec": 1.25, "endSec": 1.45, "probability": 0.92},
                {"word": "ek", "startSec": 1.48, "endSec": 1.75, "probability": 0.88},
            ],
            [
                {"word": "GVAC", "startSec": 0.88, "endSec": 1.56, "probability": 0.65},
                {"word": "Key", "startSec": 1.56, "endSec": 1.74, "probability": 0.59},
            ],
        ):
            mock_words = [
                {"word": "Take", "startSec": 0.10, "endSec": 0.30, "probability": 0.99},
                {"word": "a", "startSec": 0.32, "endSec": 0.40, "probability": 0.99},
                {"word": "look", "startSec": 0.42, "endSec": 0.60, "probability": 0.99},
                {"word": "at", "startSec": 0.62, "endSec": 0.72, "probability": 0.99},
                {"word": "the", "startSec": 0.74, "endSec": 0.85, "probability": 0.99},
                *bad_tokens,
                {"word": "cooperative", "startSec": 1.80, "endSec": 2.40, "probability": 0.99},
                {"word": "in", "startSec": 2.45, "endSec": 2.60, "probability": 0.99},
                {"word": "Texas.", "startSec": 2.65, "endSec": 3.10, "probability": 0.99},
            ]
            issues = audio_quality.analyze_word_alignment_issues(text, mock_words, language="en")
            self.assertEqual(len(issues), 1, f"Expected 1 issue for {bad_tokens}, got: {issues}")
            self.assertEqual(issues[0]["code"], "SUSPECTED_MISPRONUNCIATION")
            self.assertIn("GVEC", issues[0]["words"])

    def test_acronym_vpp_missing_or_extra_repeated_letter_flagged(self):
        """VPP spoken as 'V P' (missing second P) or 'V P P P' (extra P) must be flagged."""
        text = "Enrolling in a VPP helps stabilize the grid."
        # 1. Missing repeated letter: V P
        words_missing = [
            {"word": "Enrolling", "startSec": 0.10, "endSec": 0.55, "probability": 0.99},
            {"word": "in", "startSec": 0.58, "endSec": 0.70, "probability": 0.99},
            {"word": "a", "startSec": 0.72, "endSec": 0.82, "probability": 0.99},
            {"word": "V", "startSec": 0.85, "endSec": 1.05, "probability": 0.95},
            {"word": "P", "startSec": 1.08, "endSec": 1.28, "probability": 0.95},
            {"word": "helps", "startSec": 1.35, "endSec": 1.70, "probability": 0.99},
            {"word": "stabilize", "startSec": 1.75, "endSec": 2.30, "probability": 0.99},
            {"word": "the", "startSec": 2.35, "endSec": 2.48, "probability": 0.99},
            {"word": "grid.", "startSec": 2.50, "endSec": 2.90, "probability": 0.99},
        ]
        issues_missing = audio_quality.analyze_word_alignment_issues(text, words_missing, language="en")
        self.assertEqual(len(issues_missing), 1, f"Expected 1 issue for VPP -> V P, got: {issues_missing}")
        self.assertEqual(issues_missing[0]["code"], "MISSING_WORD")
        self.assertIn("VPP", issues_missing[0]["words"])

        # 2. Extra repeated letter: V P P P
        words_extra = [
            {"word": "Enrolling", "startSec": 0.10, "endSec": 0.55, "probability": 0.99},
            {"word": "in", "startSec": 0.58, "endSec": 0.70, "probability": 0.99},
            {"word": "a", "startSec": 0.72, "endSec": 0.82, "probability": 0.99},
            {"word": "V", "startSec": 0.85, "endSec": 1.05, "probability": 0.95},
            {"word": "P", "startSec": 1.08, "endSec": 1.28, "probability": 0.95},
            {"word": "P", "startSec": 1.30, "endSec": 1.50, "probability": 0.95},
            {"word": "P", "startSec": 1.52, "endSec": 1.72, "probability": 0.95},
            {"word": "helps", "startSec": 1.78, "endSec": 2.10, "probability": 0.99},
            {"word": "stabilize", "startSec": 2.15, "endSec": 2.70, "probability": 0.99},
            {"word": "the", "startSec": 2.75, "endSec": 2.88, "probability": 0.99},
            {"word": "grid.", "startSec": 2.90, "endSec": 3.30, "probability": 0.99},
        ]
        issues_extra = audio_quality.analyze_word_alignment_issues(text, words_extra, language="en")
        self.assertEqual(len(issues_extra), 1, f"Expected 1 issue for VPP -> V P P P, got: {issues_extra}")
        self.assertIn(issues_extra[0]["code"], ("REPEATED_WORD", "SUSPECTED_STUTTER"))
        self.assertIn("VPP", issues_extra[0]["words"])

    def test_acronym_who_spoken_as_pronoun_who_flagged(self):
        """Organization 'WHO' spoken as ordinary pronoun 'who' must flag SUSPECTED_MISPRONUNCIATION."""
        text = "The WHO issued a new global report today."
        mock_words = [
            {"word": "The", "startSec": 0.10, "endSec": 0.25, "probability": 0.99},
            {"word": "who", "startSec": 0.26, "endSec": 0.50, "probability": 0.96},
            {"word": "issued", "startSec": 0.55, "endSec": 0.95, "probability": 0.99},
            {"word": "a", "startSec": 0.98, "endSec": 1.08, "probability": 0.99},
            {"word": "new", "startSec": 1.10, "endSec": 1.35, "probability": 0.99},
            {"word": "global", "startSec": 1.38, "endSec": 1.78, "probability": 0.99},
            {"word": "report", "startSec": 1.80, "endSec": 2.20, "probability": 0.99},
            {"word": "today.", "startSec": 2.25, "endSec": 2.70, "probability": 0.99},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words, language="en")
        self.assertEqual(len(issues), 1, f"Expected 1 issue for WHO -> who, got: {issues}")
        self.assertEqual(issues[0]["code"], "SUSPECTED_MISPRONUNCIATION")
        self.assertIn("WHO", issues[0]["words"])

    def test_acronym_low_asr_confidence_returns_unverified(self):
        """When ASR transcribes 'GVEC' with low probability and no isolated audio slice is available,
        QC must return UNVERIFIED_ACRONYM (severity='unverified') with timeRange instead of falsely passing."""
        text = "The GVEC cooperative is in Texas."
        mock_words = [
            {"word": "The", "startSec": 0.10, "endSec": 0.25, "probability": 0.99},
            # Low probability (0.55 < 0.72) and compressed duration (0.35s < 0.68s expected for 4 letters)
            {"word": "GVEC", "startSec": 0.28, "endSec": 0.63, "probability": 0.55},
            {"word": "cooperative", "startSec": 0.68, "endSec": 1.25, "probability": 0.99},
            {"word": "is", "startSec": 1.28, "endSec": 1.42, "probability": 0.99},
            {"word": "in", "startSec": 1.45, "endSec": 1.58, "probability": 0.99},
            {"word": "Texas.", "startSec": 1.60, "endSec": 2.05, "probability": 0.99},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, mock_words, language="en")
        self.assertEqual(len(issues), 1, f"Expected 1 UNVERIFIED_ACRONYM issue, got: {issues}")
        self.assertEqual(issues[0]["code"], "UNVERIFIED_ACRONYM")
        self.assertEqual(issues[0]["severity"], "unverified")
        self.assertEqual(issues[0]["timeRange"], [0.28, 0.63])

    def test_alphanumeric_and_dashed_number_alignment(self):
        """Spoken alphanumeric codes ('Section twenty five D' vs 'Section 25D') and dashed laws
        ('Public Law one hundred and nineteen dash twenty one' vs 'Public Law 119-21') must pass with 0 false warnings,
        while genuine numeric mispronunciations ('20D' instead of 'twenty five D') must still warn."""
        text = (
            "Also known as Section twenty five D. "
            "Specifically Public Law one hundred and nineteen dash twenty one."
        )
        mock_words_ok = [
            {"word": "Also", "startSec": 0.10, "endSec": 0.35, "probability": 0.99},
            {"word": "known", "startSec": 0.36, "endSec": 0.60, "probability": 0.99},
            {"word": "as", "startSec": 0.61, "endSec": 0.75, "probability": 0.99},
            {"word": "Section", "startSec": 0.76, "endSec": 1.15, "probability": 0.99},
            {"word": "25D.", "startSec": 1.16, "endSec": 1.85, "probability": 0.99},
            {"word": "Specifically", "startSec": 2.00, "endSec": 2.65, "probability": 0.99},
            {"word": "Public", "startSec": 2.66, "endSec": 3.00, "probability": 0.99},
            {"word": "Law", "startSec": 3.01, "endSec": 3.25, "probability": 0.99},
            {"word": "119-21.", "startSec": 3.26, "endSec": 4.50, "probability": 0.99},
        ]
        issues_ok = audio_quality.analyze_word_alignment_issues(text, mock_words_ok, language="en")
        self.assertEqual(len(issues_ok), 0, f"Expected 0 issues for 25D and 119-21, got: {issues_ok}")

        # Now simulate TTS swallowing 'five' ('20D' instead of 'twenty five D')
        mock_words_swallowed = [
            {"word": "Also", "startSec": 0.10, "endSec": 0.35, "probability": 0.99},
            {"word": "known", "startSec": 0.36, "endSec": 0.60, "probability": 0.99},
            {"word": "as", "startSec": 0.61, "endSec": 0.75, "probability": 0.99},
            {"word": "Section", "startSec": 0.76, "endSec": 1.15, "probability": 0.99},
            {"word": "20D.", "startSec": 1.16, "endSec": 1.85, "probability": 0.99},
            {"word": "Specifically", "startSec": 2.00, "endSec": 2.65, "probability": 0.99},
            {"word": "Public", "startSec": 2.66, "endSec": 3.00, "probability": 0.99},
            {"word": "Law", "startSec": 3.01, "endSec": 3.25, "probability": 0.99},
            {"word": "119-21.", "startSec": 3.26, "endSec": 4.50, "probability": 0.99},
        ]
        issues_swallowed = audio_quality.analyze_word_alignment_issues(text, mock_words_swallowed, language="en")
        self.assertEqual(len(issues_swallowed), 1, f"Expected 1 issue for 20D vs twenty five D, got: {issues_swallowed}")
        self.assertEqual(issues_swallowed[0]["code"], "SUSPECTED_SWALLOWED")

        # Now simulate TTS misreading 'twenty five D' as '15D'
        mock_words_wrong_num = [
            {"word": "Also", "startSec": 0.10, "endSec": 0.35, "probability": 0.99},
            {"word": "known", "startSec": 0.36, "endSec": 0.60, "probability": 0.99},
            {"word": "as", "startSec": 0.61, "endSec": 0.75, "probability": 0.99},
            {"word": "Section", "startSec": 0.76, "endSec": 1.15, "probability": 0.99},
            {"word": "15D.", "startSec": 1.16, "endSec": 1.85, "probability": 0.99},
            {"word": "Specifically", "startSec": 2.00, "endSec": 2.65, "probability": 0.99},
            {"word": "Public", "startSec": 2.66, "endSec": 3.00, "probability": 0.99},
            {"word": "Law", "startSec": 3.01, "endSec": 3.25, "probability": 0.99},
            {"word": "119-21.", "startSec": 3.26, "endSec": 4.50, "probability": 0.99},
        ]
        issues_wrong = audio_quality.analyze_word_alignment_issues(text, mock_words_wrong_num, language="en")
        self.assertEqual(len(issues_wrong), 1, f"Expected 1 issue for 15D vs twenty five D, got: {issues_wrong}")
        self.assertEqual(issues_wrong[0]["code"], "SUSPECTED_MISPRONUNCIATION")

    def test_trailing_whisper_hallucination_vs_real_extra_word(self):
        """Zero-duration or silent trailing Whisper hallucinations ('Thank you.' at 30.04-30.04s) must not
        trigger EXTRA_WORD, while a genuine extra spoken word with real duration and energy must still flag EXTRA_WORD."""
        text = "Waiting and hoping for help to arrive."
        mock_words_hallucination = [
            {"word": "Waiting", "startSec": 0.10, "endSec": 0.45, "probability": 0.99},
            {"word": "and", "startSec": 0.46, "endSec": 0.60, "probability": 0.99},
            {"word": "hoping", "startSec": 0.61, "endSec": 0.95, "probability": 0.99},
            {"word": "for", "startSec": 0.96, "endSec": 1.15, "probability": 0.99},
            {"word": "help", "startSec": 1.16, "endSec": 1.45, "probability": 0.99},
            {"word": "to", "startSec": 1.46, "endSec": 1.60, "probability": 0.99},
            {"word": "arrive.", "startSec": 1.61, "endSec": 2.10, "probability": 0.99},
            {"word": "Thank", "startSec": 3.04, "endSec": 3.04, "probability": 0.35},
            {"word": "you.", "startSec": 3.04, "endSec": 3.04, "probability": 0.85},
        ]
        issues_halluc = audio_quality.analyze_word_alignment_issues(text, mock_words_hallucination, language="en")
        self.assertEqual(len(issues_halluc), 0, f"Expected 0 issues for trailing 0.00s 'Thank you.', got: {issues_halluc}")

        # Now simulate a real spoken extra word 'now' at the end with real duration (0.28s)
        mock_words_real_extra = [
            {"word": "Waiting", "startSec": 0.10, "endSec": 0.45, "probability": 0.99},
            {"word": "and", "startSec": 0.46, "endSec": 0.60, "probability": 0.99},
            {"word": "hoping", "startSec": 0.61, "endSec": 0.95, "probability": 0.99},
            {"word": "for", "startSec": 0.96, "endSec": 1.15, "probability": 0.99},
            {"word": "help", "startSec": 1.16, "endSec": 1.45, "probability": 0.99},
            {"word": "to", "startSec": 1.46, "endSec": 1.60, "probability": 0.99},
            {"word": "arrive", "startSec": 1.61, "endSec": 2.10, "probability": 0.99},
            {"word": "now.", "startSec": 2.15, "endSec": 2.43, "probability": 0.90},
        ]
        issues_real = audio_quality.analyze_word_alignment_issues(text, mock_words_real_extra, language="en")
        self.assertEqual(len(issues_real), 1, f"Expected 1 EXTRA_WORD issue for real extra word 'now', got: {issues_real}")
        self.assertEqual(issues_real[0]["code"], "EXTRA_WORD")

    def test_homophone_and_scientific_compound_alignment(self):
        """Exact homophones ('sealing' vs 'ceiling') and valid compound splits ('piezoresistive' -> 'piezo resistive')
        must pass without false warnings, while stem mispronunciation ('piezoresistive' -> 'piezo assistive')
        must emit a single SUSPECTED_MISPRONUNCIATION warning instead of two EXTRA_WORD warnings."""
        text_seal = "With water resistant sealing for Optimus."
        asr_seal = [
            {"word": "With", "startSec": 0.10, "endSec": 0.30, "probability": 0.99},
            {"word": "water", "startSec": 0.31, "endSec": 0.60, "probability": 0.99},
            {"word": "-resistant", "startSec": 0.61, "endSec": 1.10, "probability": 0.99},
            {"word": "ceiling,", "startSec": 1.11, "endSec": 1.55, "probability": 0.99},
            {"word": "for", "startSec": 1.56, "endSec": 1.70, "probability": 0.99},
            {"word": "Optimus.", "startSec": 1.71, "endSec": 2.20, "probability": 0.99},
        ]
        issues_seal = audio_quality.analyze_word_alignment_issues(text_seal, asr_seal, language="en")
        self.assertEqual(len(issues_seal), 0, f"Expected 0 issues for homophone sealing/ceiling, got: {issues_seal}")

        text_piezo = "Uses multi layer piezoresistive materials."
        asr_piezo_ok = [
            {"word": "Uses", "startSec": 0.10, "endSec": 0.40, "probability": 0.99},
            {"word": "multi", "startSec": 0.41, "endSec": 0.70, "probability": 0.99},
            {"word": "-layer", "startSec": 0.71, "endSec": 1.00, "probability": 0.99},
            {"word": "piezo", "startSec": 1.01, "endSec": 1.40, "probability": 0.99},
            {"word": "-resistive", "startSec": 1.41, "endSec": 1.95, "probability": 0.99},
            {"word": "materials.", "startSec": 1.96, "endSec": 2.50, "probability": 0.99},
        ]
        issues_piezo_ok = audio_quality.analyze_word_alignment_issues(text_piezo, asr_piezo_ok, language="en")
        self.assertEqual(len(issues_piezo_ok), 0, f"Expected 0 issues for piezo -resistive, got: {issues_piezo_ok}")

        asr_piezo_bad = [
            {"word": "Uses", "startSec": 0.10, "endSec": 0.40, "probability": 0.99},
            {"word": "multi", "startSec": 0.41, "endSec": 0.70, "probability": 0.99},
            {"word": "-layer", "startSec": 0.71, "endSec": 1.00, "probability": 0.99},
            {"word": "piezo", "startSec": 1.01, "endSec": 1.40, "probability": 0.99},
            {"word": "-assistive", "startSec": 1.41, "endSec": 1.95, "probability": 0.99},
            {"word": "materials.", "startSec": 1.96, "endSec": 2.50, "probability": 0.99},
        ]
        issues_piezo_bad = audio_quality.analyze_word_alignment_issues(text_piezo, asr_piezo_bad, language="en")
        self.assertEqual(len(issues_piezo_bad), 1, f"Expected 1 SUSPECTED_MISPRONUNCIATION issue, got: {issues_piezo_bad}")
        self.assertEqual(issues_piezo_bad[0]["code"], "SUSPECTED_MISPRONUNCIATION")

    def test_standalone_cents_and_between_hundred_thousand_alignment(self):
        """Regression test for Chunk #17 ('thirty to forty cents per mile', 'thirty five cents per mile'
        where Whisper formats as '$0.30', '$0.35') and Chunk #26 ('between seven hundred and one thousand nanometers'
        where Whisper formats as 'between 700 and 1,000 nanometers')."""
        text_17 = (
            "A total service price of thirty to forty cents per mile, "
            "and a thirty thousand dollar robotaxi operating for thirty five cents per mile."
        )
        asr_17 = [
            {"word": "A", "startSec": 0.10, "endSec": 0.20, "probability": 0.99},
            {"word": "total", "startSec": 0.21, "endSec": 0.50, "probability": 0.99},
            {"word": "service", "startSec": 0.51, "endSec": 0.85, "probability": 0.99},
            {"word": "price", "startSec": 0.86, "endSec": 1.15, "probability": 0.99},
            {"word": "of", "startSec": 1.16, "endSec": 1.30, "probability": 0.99},
            {"word": "$0", "startSec": 1.31, "endSec": 1.50, "probability": 0.99},
            {"word": ".30", "startSec": 1.51, "endSec": 1.75, "probability": 0.99},
            {"word": "to", "startSec": 1.76, "endSec": 1.90, "probability": 0.99},
            {"word": "40", "startSec": 1.91, "endSec": 2.20, "probability": 0.99},
            {"word": "cents", "startSec": 2.21, "endSec": 2.50, "probability": 0.99},
            {"word": "per", "startSec": 2.51, "endSec": 2.65, "probability": 0.99},
            {"word": "mile,", "startSec": 2.66, "endSec": 3.00, "probability": 0.99},
            {"word": "and", "startSec": 3.10, "endSec": 3.25, "probability": 0.99},
            {"word": "a", "startSec": 3.26, "endSec": 3.35, "probability": 0.99},
            {"word": "$30", "startSec": 3.36, "endSec": 3.65, "probability": 0.99},
            {"word": ",000", "startSec": 3.66, "endSec": 3.95, "probability": 0.99},
            {"word": "robotaxi", "startSec": 3.96, "endSec": 4.50, "probability": 0.99},
            {"word": "operating", "startSec": 4.51, "endSec": 4.95, "probability": 0.99},
            {"word": "for", "startSec": 4.96, "endSec": 5.10, "probability": 0.99},
            {"word": "$0", "startSec": 5.11, "endSec": 5.35, "probability": 0.99},
            {"word": ".35", "startSec": 5.36, "endSec": 5.70, "probability": 0.99},
            {"word": "per", "startSec": 5.71, "endSec": 5.85, "probability": 0.99},
            {"word": "mile.", "startSec": 5.86, "endSec": 6.20, "probability": 0.99},
        ]
        issues_17 = audio_quality.analyze_word_alignment_issues(text_17, asr_17, language="en")
        self.assertEqual(len(issues_17), 0, f"Expected 0 issues for Chunk #17 cents alignment, got: {issues_17}")

        text_26 = "Allowing the sensors to capture Near Infrared between seven hundred and one thousand nanometers."
        asr_26 = [
            {"word": "Allowing", "startSec": 0.10, "endSec": 0.50, "probability": 0.99},
            {"word": "the", "startSec": 0.51, "endSec": 0.65, "probability": 0.99},
            {"word": "sensors", "startSec": 0.66, "endSec": 1.10, "probability": 0.99},
            {"word": "to", "startSec": 1.11, "endSec": 1.25, "probability": 0.99},
            {"word": "capture", "startSec": 1.26, "endSec": 1.65, "probability": 0.99},
            {"word": "Near", "startSec": 1.66, "endSec": 1.95, "probability": 0.99},
            {"word": "Infrared", "startSec": 1.96, "endSec": 2.45, "probability": 0.99},
            {"word": "between", "startSec": 2.46, "endSec": 2.85, "probability": 0.99},
            {"word": "700", "startSec": 2.86, "endSec": 3.30, "probability": 0.99},
            {"word": "and", "startSec": 3.31, "endSec": 3.45, "probability": 0.99},
            {"word": "1", "startSec": 3.46, "endSec": 3.65, "probability": 0.99},
            {"word": ",000", "startSec": 3.66, "endSec": 3.95, "probability": 0.99},
            {"word": "nanometers.", "startSec": 3.96, "endSec": 4.60, "probability": 0.99},
        ]
        issues_26 = audio_quality.analyze_word_alignment_issues(text_26, asr_26, language="en")
        self.assertEqual(len(issues_26), 0, f"Expected 0 issues for Chunk #26 between 700 and 1,000, got: {issues_26}")

    def test_low_confidence_equal_word_slice_verification(self):
        """When Whisper's LM auto-corrects a truncated word ('Austin' spoken as 'Austs', prob=0.49),
        targeted slice re-transcription detects the truncation ('Aust...') while passing valid low-prob
        BPE case variants ('Silicon' -> 'silicon')."""
        from types import SimpleNamespace

        class MockSliceWhisper:
            def __init__(self, slice_words):
                self.slice_words = slice_words

            def transcribe(self, *args, **kwargs):
                seg = SimpleNamespace(
                    text=" ".join(w[0] for w in self.slice_words),
                    words=[SimpleNamespace(word=w[0], probability=w[1], start=0.1, end=0.4) for w in self.slice_words],
                )
                return [seg], None

        sr = 16000
        dummy_audio = (0.2 * np.sin(2 * np.pi * 440.0 * (np.arange(sr * 8) / sr))).astype(np.float32)
        text = "Cybercabs in Austin last month."
        asr_words = [
            {"word": "Cybercabs", "startSec": 0.10, "endSec": 0.80, "probability": 0.98},
            {"word": "in", "startSec": 0.85, "endSec": 1.10, "probability": 0.99},
            {"word": "Austin", "startSec": 1.12, "endSec": 1.54, "probability": 0.493},
            {"word": "last", "startSec": 1.56, "endSec": 1.90, "probability": 0.98},
            {"word": "month.", "startSec": 1.92, "endSec": 2.35, "probability": 0.99},
        ]

        # 1. Context-free slice reveals truncated 'Aust...' -> flags PARTIAL_PRONUNCIATION
        mock_trunc = MockSliceWhisper([("In", 0.58), ("Aust...", 0.58)])
        issues_trunc = audio_quality.analyze_word_alignment_issues(
            text,
            asr_words,
            language="en",
            audio_data=dummy_audio,
            sample_rate=sr,
            whisper_model=mock_trunc,
            audio_duration_sec=8.0,
        )
        self.assertEqual(len(issues_trunc), 1, f"Expected 1 issue for truncated Austin, got: {issues_trunc}")
        self.assertEqual(issues_trunc[0]["code"], "PARTIAL_PRONUNCIATION")
        self.assertEqual(issues_trunc[0]["words"], ["austin", "aust"])

        # 2. Context-free slice confirms 'Austin' -> 0 issues
        mock_ok = MockSliceWhisper([("In", 0.78), ("Austin", 0.85)])
        issues_ok = audio_quality.analyze_word_alignment_issues(
            text,
            asr_words,
            language="en",
            audio_data=dummy_audio,
            sample_rate=sr,
            whisper_model=mock_ok,
            audio_duration_sec=8.0,
        )
        self.assertEqual(len(issues_ok), 0, f"Expected 0 issues when slice confirms Austin, got: {issues_ok}")

    def test_decimal_point_with_trailing_one_second_unit(self):
        """Regression test for Chunk #39 ('the zero point eight one second rocket Roadster')
        where Whisper formats 'zero point eight one second' as ['0', '.8', 'one', '-second']."""
        text = "Type Option A if you believe the zero point eight one second rocket Roadster is an absolute masterpiece."
        asr_words = [
            {"word": "Type", "startSec": 0.00, "endSec": 0.30, "probability": 0.86},
            {"word": "option", "startSec": 0.30, "endSec": 0.76, "probability": 0.72},
            {"word": "A", "startSec": 0.76, "endSec": 1.24, "probability": 0.95},
            {"word": "if", "startSec": 1.24, "endSec": 1.72, "probability": 0.91},
            {"word": "you", "startSec": 1.72, "endSec": 1.84, "probability": 1.00},
            {"word": "believe", "startSec": 1.84, "endSec": 2.26, "probability": 0.99},
            {"word": "the", "startSec": 2.26, "endSec": 2.46, "probability": 0.99},
            {"word": "0", "startSec": 2.46, "endSec": 2.74, "probability": 0.99},
            {"word": ".8", "startSec": 2.74, "endSec": 3.28, "probability": 0.93},
            {"word": "one", "startSec": 3.28, "endSec": 3.60, "probability": 0.66},
            {"word": "-second", "startSec": 3.60, "endSec": 3.96, "probability": 0.97},
            {"word": "Rocket", "startSec": 3.96, "endSec": 4.32, "probability": 0.62},
            {"word": "Roadster", "startSec": 4.32, "endSec": 4.86, "probability": 0.99},
            {"word": "is", "startSec": 4.86, "endSec": 5.42, "probability": 0.99},
            {"word": "an", "startSec": 5.42, "endSec": 5.58, "probability": 1.00},
            {"word": "absolute", "startSec": 5.58, "endSec": 6.20, "probability": 1.00},
            {"word": "masterpiece.", "startSec": 6.20, "endSec": 6.80, "probability": 0.99},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, asr_words, language="en")
        self.assertEqual(len(issues), 0, f"Expected 0 issues for 'zero point eight one second', got: {issues}")

    def test_group_a_stutter_and_intraword_breaks_v290(self):
        # 1. Suffix stutter ("generates" -> "generates rates")
        text = "The turbine generates clean power."
        asr_words = [
            {"word": "The", "startSec": 0.10, "endSec": 0.25, "probability": 0.99},
            {"word": "turbine", "startSec": 0.26, "endSec": 0.65, "probability": 0.99},
            {"word": "generates", "startSec": 0.66, "endSec": 1.15, "probability": 0.95},
            {"word": "rates", "startSec": 1.18, "endSec": 1.48, "probability": 0.88},
            {"word": "clean", "startSec": 1.50, "endSec": 1.80, "probability": 0.99},
            {"word": "power.", "startSec": 1.82, "endSec": 2.20, "probability": 0.99},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, asr_words, language="en")
        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0]["code"], "SUSPECTED_STUTTER")

        # 2. Intra-word multi-burst stutter ("Tesla" spoken "Te - xì - la" with 3 voiced bursts in 0.82s)
        sr = 16000
        wave = np.zeros(sr * 2, dtype=np.float32)
        t_burst = np.arange(int(0.16 * sr)) / sr
        burst_sig = (0.35 * np.sin(2 * np.pi * 220.0 * t_burst)).astype(np.float32)
        # 3 distinct bursts inside [0.20s, 1.02s] separated by 80ms low-energy valleys
        for offset_sec in (0.22, 0.48, 0.76):
            s = int(offset_sec * sr)
            wave[s:s + len(burst_sig)] = burst_sig
        # Add slight noise in valleys so it's not pure zero silence, testing multi-burst detector
        wave[int(0.38 * sr):int(0.48 * sr)] = 0.015
        wave[int(0.64 * sr):int(0.76 * sr)] = 0.015

        intra_issues = audio_quality.detect_intra_word_pause(
            wave,
            sr,
            "Tesla builds electric cars",
            [{"word": "Tesla", "startSec": 0.20, "endSec": 1.02, "probability": 0.55}],
        )
        self.assertEqual(len(intra_issues), 1, f"Expected 1 intra-word issue for Te-xi-la, got {intra_issues}")
        self.assertIn(intra_issues[0]["code"], ("SUSPECTED_STUTTER", "SUSPICIOUS_INTRA_PAUSE"))

    def test_group_b_swallowed_short_and_function_words_v290(self):
        # Short/function words ("can", "and", "đã", "sẽ") must NOT be blindly ignored when swallowed
        text_en = "Drivers can charge quickly and safely."
        asr_en = [
            {"word": "Drivers", "startSec": 0.10, "endSec": 0.55, "probability": 0.99},
            # "can" swallowed with 0.18s gap
            {"word": "charge", "startSec": 0.73, "endSec": 1.10, "probability": 0.99},
            {"word": "quickly", "startSec": 1.12, "endSec": 1.50, "probability": 0.99},
            # "and" swallowed with 0.20s gap
            {"word": "safely.", "startSec": 1.70, "endSec": 2.15, "probability": 0.99},
        ]
        issues_en = audio_quality.analyze_word_alignment_issues(text_en, asr_en, language="en")
        missing_words_en = [w for iss in issues_en if iss["code"] == "MISSING_WORD" for w in iss["words"]]
        self.assertIn("can", missing_words_en)
        self.assertIn("and", missing_words_en)

        text_vi = "Hệ thống đã hoạt động và sẽ ổn định."
        asr_vi = [
            {"word": "Hệ", "startSec": 0.10, "endSec": 0.25, "probability": 0.99},
            {"word": "thống", "startSec": 0.26, "endSec": 0.50, "probability": 0.99},
            # "đã" swallowed
            {"word": "hoạt", "startSec": 0.68, "endSec": 0.90, "probability": 0.99},
            {"word": "động", "startSec": 0.91, "endSec": 1.15, "probability": 0.99},
            {"word": "và", "startSec": 1.16, "endSec": 1.30, "probability": 0.99},
            # "sẽ" swallowed
            {"word": "ổn", "startSec": 1.48, "endSec": 1.70, "probability": 0.99},
            {"word": "định.", "startSec": 1.71, "endSec": 2.00, "probability": 0.99},
        ]
        issues_vi = audio_quality.analyze_word_alignment_issues(text_vi, asr_vi, language="vi")
        missing_words_vi = [w for iss in issues_vi if iss["code"] == "MISSING_WORD" for w in iss["words"]]
        self.assertIn("đã", missing_words_vi)
        self.assertIn("sẽ", missing_words_vi)

    def test_group_c_extra_words_vs_hallucination_v290(self):
        # Common standalone words ("like", "share", "video", "kênh") must NOT be treated as hallucinations
        for word in ("like", "share", "video", "kênh"):
            self.assertFalse(
                audio_quality.is_whisper_hallucination(word),
                f"Standalone common word '{word}' must not be classified as Whisper hallucination",
            )
        # Multi-word boilerplate hallucinations ARE still classified as hallucinations
        self.assertTrue(audio_quality.is_whisper_hallucination("thank you for watching"))
        self.assertTrue(audio_quality.is_whisper_hallucination("hãy đăng ký kênh"))

        # Extra spoken "video" in middle of sentence is flagged as EXTRA_WORD
        text = "This system records high resolution clips."
        asr_words = [
            {"word": "This", "startSec": 0.10, "endSec": 0.30, "probability": 0.99},
            {"word": "system", "startSec": 0.31, "endSec": 0.65, "probability": 0.99},
            {"word": "records", "startSec": 0.66, "endSec": 1.05, "probability": 0.99},
            {"word": "video", "startSec": 1.06, "endSec": 1.40, "probability": 0.92},
            {"word": "high", "startSec": 1.41, "endSec": 1.65, "probability": 0.99},
            {"word": "resolution", "startSec": 1.66, "endSec": 2.15, "probability": 0.99},
            {"word": "clips.", "startSec": 2.16, "endSec": 2.55, "probability": 0.99},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, asr_words, language="en")
        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0]["code"], "EXTRA_WORD")
        self.assertIn("video", issues[0]["words"])

    def test_group_d_mispronunciation_and_tone_strictness_v290(self):
        # Distinct words with edit distance 1 must NOT be equivalent
        self.assertFalse(audio_quality.are_words_equivalent("ship", "shop"))
        self.assertFalse(audio_quality.are_words_equivalent("could", "cold"))
        self.assertFalse(audio_quality.are_words_equivalent("bàn", "bán"))
        self.assertFalse(audio_quality.are_words_equivalent("mẹ", "mẻ"))

        # Legitimate spelling variants and i/y homophones remain equivalent
        self.assertTrue(audio_quality.are_words_equivalent("color", "colour"))
        self.assertTrue(audio_quality.are_words_equivalent("center", "centre"))
        self.assertTrue(audio_quality.are_words_equivalent("kĩ", "kỹ"))

        # High-confidence replacement ("ship" -> "shop") emits SUSPECTED_MISPRONUNCIATION
        text = "They will ship the battery tomorrow."
        asr_high = [
            {"word": "They", "startSec": 0.10, "endSec": 0.25, "probability": 0.99},
            {"word": "will", "startSec": 0.26, "endSec": 0.45, "probability": 0.99},
            {"word": "shop", "startSec": 0.46, "endSec": 0.80, "probability": 0.91},
            {"word": "the", "startSec": 0.81, "endSec": 0.95, "probability": 0.99},
            {"word": "battery", "startSec": 0.96, "endSec": 1.40, "probability": 0.99},
            {"word": "tomorrow.", "startSec": 1.41, "endSec": 1.90, "probability": 0.99},
        ]
        issues_high = audio_quality.analyze_word_alignment_issues(text, asr_high, language="en")
        self.assertEqual(len(issues_high), 1)
        self.assertEqual(issues_high[0]["code"], "SUSPECTED_MISPRONUNCIATION")

        # Low-confidence replacement ("ship" -> "shop", prob=0.30) emits UNVERIFIED_WORD
        asr_low = [dict(w) for w in asr_high]
        asr_low[2]["probability"] = 0.30
        issues_low = audio_quality.analyze_word_alignment_issues(text, asr_low, language="en")
        self.assertEqual(len(issues_low), 1)
        self.assertEqual(issues_low[0]["code"], "UNVERIFIED_WORD")
        self.assertEqual(issues_low[0]["severity"], "unverified")

    def test_group_e_abnormal_pause_conjunctions_and_soft_newlines_v290(self):
        # 1. Pause AFTER a conjunction ("and [0.55s] the") is unnatural and must be flagged
        text = "We tested the motor and the inverter today."
        asr_after_conj = [
            {"word": "We", "startSec": 0.10, "endSec": 0.25, "probability": 0.99},
            {"word": "tested", "startSec": 0.26, "endSec": 0.60, "probability": 0.99},
            {"word": "the", "startSec": 0.61, "endSec": 0.75, "probability": 0.99},
            {"word": "motor", "startSec": 0.76, "endSec": 1.15, "probability": 0.99},
            {"word": "and", "startSec": 1.16, "endSec": 1.35, "probability": 0.99},
            # 0.55s unnatural pause AFTER 'and'
            {"word": "the", "startSec": 1.90, "endSec": 2.05, "probability": 0.99},
            {"word": "inverter", "startSec": 2.06, "endSec": 2.50, "probability": 0.99},
            {"word": "today.", "startSec": 2.51, "endSec": 2.90, "probability": 0.99},
        ]
        issues_after = audio_quality.analyze_word_alignment_issues(text, asr_after_conj, language="en")
        self.assertEqual(len(issues_after), 1)
        self.assertEqual(issues_after[0]["code"], "ABNORMAL_PAUSE")
        self.assertEqual(issues_after[0]["words"], ["and", "the"])

        # 2. Soft single newline mid-phrase ("diesel\nfuel") with 0.58s pause is still flagged
        text_nl = "Moving freight on diesel\nfuel across the country."
        asr_nl = [
            {"word": "Moving", "startSec": 0.10, "endSec": 0.45, "probability": 0.99},
            {"word": "freight", "startSec": 0.46, "endSec": 0.80, "probability": 0.99},
            {"word": "on", "startSec": 0.81, "endSec": 0.95, "probability": 0.99},
            {"word": "diesel", "startSec": 0.96, "endSec": 1.35, "probability": 0.99},
            {"word": "fuel", "startSec": 1.93, "endSec": 2.30, "probability": 0.99},
            {"word": "across", "startSec": 2.31, "endSec": 2.65, "probability": 0.99},
            {"word": "the", "startSec": 2.66, "endSec": 2.80, "probability": 0.99},
            {"word": "country.", "startSec": 2.81, "endSec": 3.25, "probability": 0.99},
        ]
        issues_nl = audio_quality.analyze_word_alignment_issues(text_nl, asr_nl, language="en")
        self.assertEqual(len(issues_nl), 1)
        self.assertEqual(issues_nl[0]["code"], "ABNORMAL_PAUSE")
        self.assertEqual(issues_nl[0]["words"], ["diesel", "fuel"])

    def test_section_3_bounded_slice_budget_v290(self):
        from types import SimpleNamespace

        call_count = 0

        class CountingWhisper:
            def transcribe(self, *args, **kwargs):
                nonlocal call_count
                call_count += 1
                seg = SimpleNamespace(
                    text="word",
                    words=[SimpleNamespace(word="word", probability=0.90, start=0.1, end=0.3)],
                )
                return [seg], None

        sr = 16000
        dummy_audio = (0.2 * np.sin(2 * np.pi * 440.0 * (np.arange(sr * 10) / sr))).astype(np.float32)
        text = "Alpha Beta Gamma Delta Epsilon Zeta Eta."
        # 6 low-confidence equal words -> slice re-transcription must be capped at MAX_SECONDARY_SLICE_CHECKS (3)
        words = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta."]
        asr_words = [
            {"word": w, "startSec": i * 0.6 + 0.1, "endSec": (i + 1) * 0.6, "probability": 0.40}
            for i, w in enumerate(words)
        ]
        audio_quality.analyze_word_alignment_issues(
            text,
            asr_words,
            language="en",
            audio_data=dummy_audio,
            sample_rate=sr,
            whisper_model=CountingWhisper(),
            audio_duration_sec=10.0,
        )
        self.assertLessEqual(call_count, audio_quality.MAX_SECONDARY_SLICE_CHECKS)
        self.assertEqual(call_count, 3)

    def test_v300_acoustic_boundary_valley_attribution_when_asr_gap_zero(self):
        # Whisper DTW absorbs a 0.45s inter-word silence between 'down' and 'to' into 'while'/'to'
        # so asr_gap == 0.00s, yet actual waveform has a 0.45s silent valley.
        sr = 16000
        wave = np.zeros(sr * 4, dtype=np.float32)
        t_frame = np.arange(sr * 4) / sr
        carrier = (0.25 * np.sin(2 * np.pi * 210.0 * t_frame)).astype(np.float32)
        # Active speech regions:
        # 'bringing' [0.20, 0.55], 'weight' [0.58, 0.88], 'down' [0.90, 1.25],
        # [0.45s SILENCE in 1.25..1.70], 'to' [1.70, 1.92], 'below' [1.95, 2.30]
        for s_sec, e_sec in ((0.20, 0.55), (0.58, 0.88), (0.90, 1.25), (1.70, 1.92), (1.95, 2.30)):
            wave[int(s_sec * sr):int(e_sec * sr)] = carrier[int(s_sec * sr):int(e_sec * sr)]

        text = "bringing weight down to below"
        # Whisper sets endSec of 'down' == startSec of 'to' == 1.25 (or stretches 'down' to 1.68)
        asr_words = [
            {"word": "bringing", "startSec": 0.20, "endSec": 0.56, "probability": 0.99},
            {"word": "weight", "startSec": 0.56, "endSec": 0.89, "probability": 0.99},
            {"word": "down", "startSec": 0.90, "endSec": 1.26, "probability": 0.99},
            {"word": "to", "startSec": 1.26, "endSec": 1.92, "probability": 0.99},
            {"word": "below", "startSec": 1.93, "endSec": 2.30, "probability": 0.99},
        ]
        issues = audio_quality.analyze_word_alignment_issues(
            text, asr_words, language="en", audio_data=wave, sample_rate=sr, audio_duration_sec=3.0
        )
        pause_issues = [i for i in issues if i["code"] == "ABNORMAL_PAUSE"]
        self.assertEqual(len(pause_issues), 1, f"Expected 1 ABNORMAL_PAUSE for down->to, got {issues}")
        self.assertEqual(pause_issues[0]["words"], ["down", "to"])
        self.assertEqual(pause_issues[0]["pauseContext"], "tight_preposition")

        # Must NOT misclassify the inter-word silence as an intra-word break
        intra = audio_quality.detect_intra_word_pause(wave, sr, text, asr_words)
        self.assertEqual(len(intra), 0, f"Expected 0 false intra-word pauses, got {intra}")

    def test_v300_choppy_phrase_clustering_and_cohesion_tiers(self):
        # 1. Multi-pause staccato sequence ("consolidate [0.43s] between [0.31s] 200 and [0.40s] 300")
        # clusters into a single choppy_phrase ABNORMAL_PAUSE warning.
        text = "designed to consolidate between 200 and 300 stamped parts."
        asr_choppy = [
            {"word": "designed", "startSec": 0.10, "endSec": 0.45, "probability": 0.99},
            {"word": "to", "startSec": 0.46, "endSec": 0.60, "probability": 0.99},
            {"word": "consolidate", "startSec": 0.62, "endSec": 1.15, "probability": 0.99},
            {"word": "between", "startSec": 1.58, "endSec": 1.95, "probability": 0.99},
            {"word": "200", "startSec": 2.26, "endSec": 2.65, "probability": 0.99},
            {"word": "and", "startSec": 3.05, "endSec": 3.25, "probability": 0.99},
            {"word": "300", "startSec": 3.27, "endSec": 3.65, "probability": 0.99},
            {"word": "stamped", "startSec": 3.90, "endSec": 4.25, "probability": 0.99},
            {"word": "parts.", "startSec": 4.27, "endSec": 4.65, "probability": 0.99},
        ]
        issues_choppy = audio_quality.analyze_word_alignment_issues(text, asr_choppy, language="en")
        self.assertEqual(len(issues_choppy), 1, f"Expected 1 clustered choppy_phrase issue, got {issues_choppy}")
        self.assertEqual(issues_choppy[0]["code"], "ABNORMAL_PAUSE")
        self.assertEqual(issues_choppy[0]["pauseContext"], "choppy_phrase")
        self.assertIn("consolidate between 200 and 300 stamped", issues_choppy[0]["message"])

        # 2. Natural subject-predicate pause ("named Henry Kaiser [0.38s] tore up") must pass with 0 warnings
        text_kaiser = "Then an industrialist named Henry Kaiser tore up the sequential playbook."
        asr_kaiser = [
            {"word": "Then", "startSec": 0.10, "endSec": 0.35, "probability": 0.99},
            {"word": "an", "startSec": 0.36, "endSec": 0.50, "probability": 0.99},
            {"word": "industrialist", "startSec": 0.52, "endSec": 1.25, "probability": 0.99},
            {"word": "named", "startSec": 1.27, "endSec": 1.55, "probability": 0.99},
            {"word": "Henry", "startSec": 1.57, "endSec": 1.92, "probability": 0.99},
            {"word": "Kaiser", "startSec": 1.94, "endSec": 2.35, "probability": 0.99},
            # 0.38s natural subject-predicate prosodic boundary
            {"word": "tore", "startSec": 2.73, "endSec": 3.00, "probability": 0.99},
            {"word": "up", "startSec": 3.02, "endSec": 3.18, "probability": 0.99},
            {"word": "the", "startSec": 3.20, "endSec": 3.32, "probability": 0.99},
            {"word": "sequential", "startSec": 3.34, "endSec": 3.85, "probability": 0.99},
            {"word": "playbook.", "startSec": 3.87, "endSec": 4.35, "probability": 0.99},
        ]
        issues_kaiser = audio_quality.analyze_word_alignment_issues(text_kaiser, asr_kaiser, language="en")
        self.assertEqual(len(issues_kaiser), 0, f"Expected 0 issues for natural Kaiser->tore pause, got {issues_kaiser}")

    def test_v300_consonant_cluster_words_no_false_stutter(self):
        # Words with internal stop closures / plural fricatives ('platforms', 'cycles', 'spend', 'Xpeng', 'blocks', 'pounds')
        # have brief 30-45ms consonant dips or high-ZCR fricative bursts; they must NOT trigger SUSPECTED_STUTTER.
        sr = 16000
        wave = np.zeros(sr * 2, dtype=np.float32)
        t = np.arange(sr * 2) / sr
        vowel = (0.30 * np.sin(2 * np.pi * 190.0 * t)).astype(np.float32)
        rng = np.random.default_rng(42)
        fric = (0.12 * rng.standard_normal(sr * 2)).astype(np.float32)

        # Construct 'platforms' in [0.20, 0.92]:
        # 'plat' vowel [0.22, 0.36], 35ms /t/ closure [0.36, 0.395], 'form' vowel [0.395, 0.56],
        # high-ZCR /s/ fricative [0.56, 0.68], plus trailing silence [0.68, 0.92]
        wave[int(0.22 * sr):int(0.36 * sr)] = vowel[int(0.22 * sr):int(0.36 * sr)]
        wave[int(0.395 * sr):int(0.56 * sr)] = vowel[int(0.395 * sr):int(0.56 * sr)]
        wave[int(0.56 * sr):int(0.68 * sr)] = fric[int(0.56 * sr):int(0.68 * sr)]

        for w_token in ("platforms", "cycles", "spend", "Xpeng", "castings", "stamped", "blocks", "pounds", "stations"):
            intra = audio_quality.detect_intra_word_pause(
                wave,
                sr,
                f"Testing {w_token} in production",
                [{"word": w_token, "startSec": 0.20, "endSec": 0.92, "probability": 0.95}],
            )
            self.assertEqual(len(intra), 0, f"Expected 0 false stutter for '{w_token}', got {intra}")

    def test_v300_compound_proper_splits_and_coarticulatory_assimilation(self):
        # 1. Compound proper-noun split: 'Gigafactory' <-> ['Geiga', 'Factory']
        text_giga = "Inside the Shanghai Gigafactory today."
        asr_giga = [
            {"word": "Inside", "startSec": 0.10, "endSec": 0.45, "probability": 0.99},
            {"word": "the", "startSec": 0.46, "endSec": 0.58, "probability": 0.99},
            {"word": "Shanghai", "startSec": 0.60, "endSec": 1.10, "probability": 0.99},
            {"word": "Geiga", "startSec": 1.12, "endSec": 1.45, "probability": 0.90},
            {"word": "Factory", "startSec": 1.46, "endSec": 1.90, "probability": 0.95},
            {"word": "today.", "startSec": 1.92, "endSec": 2.30, "probability": 0.99},
        ]
        self.assertEqual(audio_quality.analyze_word_alignment_issues(text_giga, asr_giga, language="en"), [])

        # 2. Coarticulatory sibilant assimilation ('arm sideways' -> 'arms sideways')
        # and stop assimilation ('straighten bent' -> 'straightened bent')
        text_assim = "Swing the arm sideways to straighten bent frames."
        asr_assim = [
            {"word": "Swing", "startSec": 0.10, "endSec": 0.40, "probability": 0.99},
            {"word": "the", "startSec": 0.41, "endSec": 0.52, "probability": 0.99},
            {"word": "arms", "startSec": 0.53, "endSec": 0.82, "probability": 0.92},
            {"word": "sideways", "startSec": 0.83, "endSec": 1.30, "probability": 0.99},
            {"word": "to", "startSec": 1.31, "endSec": 1.42, "probability": 0.99},
            {"word": "straightened", "startSec": 1.43, "endSec": 1.95, "probability": 0.91},
            {"word": "bent", "startSec": 1.96, "endSec": 2.25, "probability": 0.99},
            {"word": "frames.", "startSec": 2.26, "endSec": 2.65, "probability": 0.99},
        ]
        self.assertEqual(audio_quality.analyze_word_alignment_issues(text_assim, asr_assim, language="en"), [])

        # 3. Unit abbreviations ('forty kilograms' <-> '40 kg') and Roman numerals ('World War Two' <-> 'World War II')
        text_units = "During World War Two, the shell weighed forty kilograms."
        asr_units = [
            {"word": "During", "startSec": 0.10, "endSec": 0.40, "probability": 0.99},
            {"word": "World", "startSec": 0.41, "endSec": 0.70, "probability": 0.99},
            {"word": "War", "startSec": 0.71, "endSec": 0.95, "probability": 0.99},
            {"word": "II,", "startSec": 0.96, "endSec": 1.30, "probability": 0.99},
            {"word": "the", "startSec": 1.50, "endSec": 1.62, "probability": 0.99},
            {"word": "shell", "startSec": 1.63, "endSec": 1.95, "probability": 0.99},
            {"word": "weighed", "startSec": 1.96, "endSec": 2.30, "probability": 0.99},
            {"word": "40", "startSec": 2.31, "endSec": 2.65, "probability": 0.99},
            {"word": "kg.", "startSec": 2.66, "endSec": 3.10, "probability": 0.99},
        ]
        self.assertEqual(audio_quality.analyze_word_alignment_issues(text_units, asr_units, language="en"), [])


    def test_v310_sandwiched_token_does_not_flag_constituent_initial_preposition_or_conjunction(self):
        # 1. 'costs [0.38s] by [0.22s] 50%' (Chunk 38): 'by' introduces PP '[by 50%]' after NP object 'costs' -> PASS
        text_38 = "slash vehicle manufacturing costs by fifty percent"
        asr_38 = [
            {"word": "slash", "startSec": 0.10, "endSec": 0.45, "probability": 0.99},
            {"word": "vehicle", "startSec": 0.46, "endSec": 0.90, "probability": 0.99},
            {"word": "manufacturing", "startSec": 0.91, "endSec": 1.60, "probability": 0.99},
            {"word": "costs", "startSec": 1.61, "endSec": 2.00, "probability": 0.99},
            {"word": "by", "startSec": 2.38, "endSec": 2.55, "probability": 0.99},
            {"word": "50%", "startSec": 2.77, "endSec": 3.30, "probability": 0.99},
        ]
        self.assertEqual(audio_quality.analyze_word_alignment_issues(text_38, asr_38, language="en"), [])

        # 2. 'oven [0.42s] for [0.19s] hours' (Chunk 17): 'for' introduces PP '[for hours]' -> PASS
        text_17 = "bake it inside a heat treatment oven for hours"
        asr_17 = [
            {"word": "bake", "startSec": 0.10, "endSec": 0.35, "probability": 0.99},
            {"word": "it", "startSec": 0.36, "endSec": 0.48, "probability": 0.99},
            {"word": "inside", "startSec": 0.49, "endSec": 0.85, "probability": 0.99},
            {"word": "a", "startSec": 0.86, "endSec": 0.95, "probability": 0.99},
            {"word": "heat", "startSec": 0.96, "endSec": 1.25, "probability": 0.99},
            {"word": "treatment", "startSec": 1.26, "endSec": 1.70, "probability": 0.99},
            {"word": "oven", "startSec": 1.71, "endSec": 2.10, "probability": 0.99},
            {"word": "for", "startSec": 2.52, "endSec": 2.68, "probability": 0.99},
            {"word": "hours", "startSec": 2.87, "endSec": 3.35, "probability": 0.99},
        ]
        self.assertEqual(audio_quality.analyze_word_alignment_issues(text_17, asr_17, language="en"), [])

        # 3. Genuine sandwiched number token inside tight NP ('this [0.26s] 50 [0.19s] ,000') -> WARNING
        text_24 = "this fifty thousand ton system"
        asr_24 = [
            {"word": "this", "startSec": 0.10, "endSec": 0.25, "probability": 0.99},
            {"word": "50", "startSec": 0.51, "endSec": 0.72, "probability": 0.99},
            {"word": ",000", "startSec": 0.91, "endSec": 1.15, "probability": 0.99},
            {"word": "-ton", "startSec": 1.16, "endSec": 1.32, "probability": 0.99},
            {"word": "system", "startSec": 1.33, "endSec": 1.60, "probability": 0.99},
        ]
        issues_24 = audio_quality.analyze_word_alignment_issues(text_24, asr_24, language="en")
        self.assertEqual(len(issues_24), 1)
        self.assertEqual(issues_24[0]["pauseContext"], "sandwiched_token")

    def test_v310_choppy_phrase_does_not_chain_across_prosodic_boundaries_or_sum_threshold(self):
        # 1. 'hailing [0.22s] costs [0.44s] down to' (Chunk 38) -> PASS
        text_38b = "pushing autonomous ride hailing costs down to twenty cents"
        asr_38b = [
            {"word": "pushing", "startSec": 0.10, "endSec": 0.45, "probability": 0.99},
            {"word": "autonomous", "startSec": 0.46, "endSec": 1.10, "probability": 0.99},
            {"word": "ride", "startSec": 1.11, "endSec": 1.40, "probability": 0.99},
            {"word": "-hailing", "startSec": 1.41, "endSec": 1.80, "probability": 0.99},
            {"word": "costs", "startSec": 2.02, "endSec": 2.40, "probability": 0.99},
            {"word": "down", "startSec": 2.84, "endSec": 3.10, "probability": 0.99},
            {"word": "to", "startSec": 3.12, "endSec": 3.25, "probability": 0.99},
            {"word": "20", "startSec": 3.26, "endSec": 3.60, "probability": 0.99},
            {"word": "cents", "startSec": 3.61, "endSec": 4.00, "probability": 0.99},
        ]
        self.assertEqual(audio_quality.analyze_word_alignment_issues(text_38b, asr_38b, language="en"), [])

        # 2. 'crack [0.43s] meant [0.30s] throwing' and 'study [0.48s] testing Tesla's [0.30s] mega-castings [0.29s] against' (Chunk 40) -> PASS
        text_40 = "a single crack meant throwing away the car in a study testing Tesla's mega castings against frames"
        asr_40 = [
            {"word": "a", "startSec": 0.10, "endSec": 0.20, "probability": 0.99},
            {"word": "single", "startSec": 0.21, "endSec": 0.55, "probability": 0.99},
            {"word": "crack", "startSec": 0.56, "endSec": 0.95, "probability": 0.99},
            {"word": "meant", "startSec": 1.38, "endSec": 1.65, "probability": 0.99},
            {"word": "throwing", "startSec": 1.95, "endSec": 2.35, "probability": 0.99},
            {"word": "away", "startSec": 2.36, "endSec": 2.65, "probability": 0.99},
            {"word": "the", "startSec": 2.66, "endSec": 2.78, "probability": 0.99},
            {"word": "car", "startSec": 2.79, "endSec": 3.10, "probability": 0.99},
            {"word": "in", "startSec": 3.12, "endSec": 3.25, "probability": 0.99},
            {"word": "a", "startSec": 3.26, "endSec": 3.35, "probability": 0.99},
            {"word": "study", "startSec": 3.36, "endSec": 3.75, "probability": 0.99},
            {"word": "testing", "startSec": 4.23, "endSec": 4.65, "probability": 0.99},
            {"word": "Tesla's", "startSec": 4.66, "endSec": 5.10, "probability": 0.99},
            {"word": "mega-castings", "startSec": 5.40, "endSec": 6.15, "probability": 0.99},
            {"word": "against", "startSec": 6.44, "endSec": 6.85, "probability": 0.99},
            {"word": "frames", "startSec": 6.86, "endSec": 7.30, "probability": 0.99},
        ]
        self.assertEqual(audio_quality.analyze_word_alignment_issues(text_40, asr_40, language="en"), [])

    def test_v310_bidirectional_acoustic_valley_attribution_and_intra_word_break(self):
        # Multi-word utterance where 'Tesla' [0.60 - 1.35] has a genuine 0.19s mid-word silent break [0.85 - 1.04]
        # surrounded by >= 0.20s active speech on both sides: must NOT be stolen as inter-word pause and MUST be
        # flagged as SUSPICIOUS_INTRA_PAUSE.
        sr = 16000
        wave = np.zeros(int(sr * 2.2), dtype=np.float32)
        t = np.arange(wave.size) / sr
        carrier = (0.28 * np.sin(2 * np.pi * 185.0 * t)).astype(np.float32)
        # 'Testing' [0.15 - 0.52]
        wave[int(0.15 * sr):int(0.52 * sr)] = carrier[int(0.15 * sr):int(0.52 * sr)]
        # 'Te-' [0.60 - 0.85]
        wave[int(0.60 * sr):int(0.85 * sr)] = carrier[int(0.60 * sr):int(0.85 * sr)]
        # mid-word silent break [0.85 - 1.04] (0.19s)
        # '-sla' [1.04 - 1.32]
        wave[int(1.04 * sr):int(1.32 * sr)] = carrier[int(1.04 * sr):int(1.32 * sr)]
        # 'today' [1.40 - 1.85]
        wave[int(1.40 * sr):int(1.85 * sr)] = carrier[int(1.40 * sr):int(1.85 * sr)]

        text = "Testing Tesla today"
        asr_words = [
            {"word": "Testing", "startSec": 0.15, "endSec": 0.52, "probability": 0.99},
            {"word": "Tesla", "startSec": 0.60, "endSec": 1.32, "probability": 0.95},
            {"word": "today", "startSec": 1.40, "endSec": 1.85, "probability": 0.99},
        ]
        intra_issues = audio_quality.detect_intra_word_pause(wave, sr, text, asr_words)
        self.assertEqual(len(intra_issues), 1, f"Expected 1 SUSPICIOUS_INTRA_PAUSE for mid-word break in Tesla, got {intra_issues}")
        self.assertEqual(intra_issues[0]["code"], "SUSPICIOUS_INTRA_PAUSE")
        self.assertEqual(intra_issues[0]["words"], ["tesla"])

    def test_v310_mapping_uncertain_downgrades_moderate_pause_to_unverified(self):
        # When an ASR token is unmapped (due to mispronunciation 'shift' -> 'lift') and followed by a 0.56s pause,
        # the pause is downgraded to UNVERIFIED_PAUSE (severity='unverified') rather than a second WARNING.
        text = "That single architectural shift rapidly shrinks the floor"
        asr_words = [
            {"word": "That", "startSec": 0.10, "endSec": 0.25, "probability": 0.99},
            {"word": "single", "startSec": 0.26, "endSec": 0.50, "probability": 0.99},
            {"word": "architectural", "startSec": 0.51, "endSec": 1.05, "probability": 0.99},
            {"word": "lift", "startSec": 1.06, "endSec": 1.40, "probability": 0.95},
            {"word": "rapidly", "startSec": 1.96, "endSec": 2.35, "probability": 0.99},
            {"word": "shrinks", "startSec": 2.36, "endSec": 2.70, "probability": 0.99},
            {"word": "the", "startSec": 2.71, "endSec": 2.82, "probability": 0.99},
            {"word": "floor", "startSec": 2.83, "endSec": 3.15, "probability": 0.99},
        ]
        issues = audio_quality.analyze_word_alignment_issues(text, asr_words, language="en")
        warn_issues = [i for i in issues if i["severity"] == "warning"]
        unv_issues = [i for i in issues if i["severity"] == "unverified"]
        self.assertEqual(len(warn_issues), 1)
        self.assertEqual(warn_issues[0]["code"], "SUSPECTED_MISPRONUNCIATION")
        self.assertEqual(len(unv_issues), 1)
        self.assertEqual(unv_issues[0]["code"], "UNVERIFIED_PAUSE")

    def test_v310_coarticulatory_doubled_consonant_ed_before_dental_and_alphanumeric_code(self):
        # 1. 'flipped the' -> ASR 'flip the' (1-syllable doubled-consonant -ed before dental 'th') -> PASS
        text_flip = "and the findings flipped the narrative"
        asr_flip = [
            {"word": "and", "startSec": 0.10, "endSec": 0.25, "probability": 0.99},
            {"word": "the", "startSec": 0.26, "endSec": 0.38, "probability": 0.99},
            {"word": "findings", "startSec": 0.39, "endSec": 0.85, "probability": 0.99},
            {"word": "flip", "startSec": 0.86, "endSec": 1.20, "probability": 0.72},
            {"word": "the", "startSec": 1.21, "endSec": 1.35, "probability": 0.99},
            {"word": "narrative", "startSec": 1.36, "endSec": 1.90, "probability": 0.99},
        ]
        self.assertEqual(audio_quality.analyze_word_alignment_issues(text_flip, asr_flip, language="en"), [])

        # 2. 'eighty eight S six P layout' -> ASR '88S6P layout' -> PASS
        text_code = "cells in an eighty eight S six P layout"
        asr_code = [
            {"word": "cells", "startSec": 0.10, "endSec": 0.45, "probability": 0.99},
            {"word": "in", "startSec": 0.46, "endSec": 0.60, "probability": 0.99},
            {"word": "an", "startSec": 0.61, "endSec": 0.75, "probability": 0.99},
            {"word": "88S6P", "startSec": 0.76, "endSec": 1.95, "probability": 0.95},
            {"word": "layout", "startSec": 1.96, "endSec": 2.40, "probability": 0.99},
        ]
        self.assertEqual(audio_quality.analyze_word_alignment_issues(text_code, asr_code, language="en"), [])

    def test_v320_syntactic_boundary_classification_and_tight_cohesion(self):
        # Section 1.1 & 1.2: Tight grammatical pairs ('want to', 'you can', 'need to', 'can generate', 'from 60', 'between 200')
        # must NEVER be classified as Prosodic Phrase Boundaries (NATURAL_BOUNDARY 0.62s); they must be TIGHT_COHESION.
        tight_cases = [
            ("We want to build faster.", 1, 2, "want", "to", 0.33),
            ("So you can see the difference.", 1, 2, "you", "can", 0.33),
            ("Engineers need to test the die.", 1, 2, "need", "to", 0.33),
            ("This press can generate massive force.", 2, 3, "can", "generate", 0.33),
            ("Dropping weight from 60 kilograms.", 2, 3, "from", "60", 0.33),
            ("Consolidate between 200 and 300 parts.", 1, 2, "between", "200", 0.33),
        ]
        for sent, idx1, idx2, w1, w2, gap_sec in tight_cases:
            src_w, delims, _ = audio_quality.tokenize_text_with_spans(sent)
            src_clean = [audio_quality.clean_word(w) for w in src_w]
            self.assertFalse(
                audio_quality.is_prosodic_phrase_boundary(src_w, src_clean, idx1, idx2, w1, w2),
                f"Expected is_prosodic_phrase_boundary=False for '{w1} ... {w2}' in '{sent}'",
            )
            syn = audio_quality.evaluate_syntactic_boundary(
                src_w, src_clean, delims, idx1, idx2, w1, w2, eff_speed=1.0, default_min_pause=0.50
            )
            self.assertEqual(syn["classification"], "TIGHT_COHESION", f"Expected TIGHT_COHESION for '{w1} {w2}', got {syn}")
            self.assertLessEqual(syn["threshold_sec"], 0.28)

            # Verify that a 0.33s pause between w1 and w2 triggers ABNORMAL_PAUSE
            asr_words = []
            t_cur = 0.10
            for k, tok in enumerate(src_w):
                asr_words.append({"word": tok, "startSec": round(t_cur, 3), "endSec": round(t_cur + 0.25, 3), "probability": 0.99})
                t_cur += 0.26 + (gap_sec if k == idx1 else 0.0)
            issues = audio_quality.analyze_word_alignment_issues(sent, asr_words, language="en")
            self.assertEqual(len(issues), 1, f"Expected 1 ABNORMAL_PAUSE for '{w1} [{gap_sec}s] {w2}', got {issues}")
            self.assertEqual(issues[0]["code"], "ABNORMAL_PAUSE")

        # Verify UNCERTAIN_BOUNDARY when source mapping is None (never gets 0.62s NATURAL_BOUNDARY exemption)
        src_w, delims, _ = audio_quality.tokenize_text_with_spans("A press named Idra to build castings.")
        src_clean = [audio_quality.clean_word(w) for w in src_w]
        syn_mapped = audio_quality.evaluate_syntactic_boundary(src_w, src_clean, delims, 3, 4, "Idra", "to")
        self.assertEqual(syn_mapped["classification"], "NATURAL_BOUNDARY")
        syn_unmapped = audio_quality.evaluate_syntactic_boundary(src_w, src_clean, delims, None, None, "Idra", "to")
        self.assertEqual(syn_unmapped["classification"], "UNCERTAIN_BOUNDARY")
        self.assertLessEqual(syn_unmapped["threshold_sec"], 0.50)

    def test_v320_sandwiched_token_3word_structure_and_choppy_phrase_continuity(self):
        # Section 2.1 & 2.2:
        # 1) 'down [0.23s] to [0.22s] 20' (function word 'to' inside tight constituent on both sides) -> WARNING
        text_down = "bringing costs down to twenty dollars"
        asr_down = [
            {"word": "bringing", "startSec": 0.10, "endSec": 0.45, "probability": 0.99},
            {"word": "costs", "startSec": 0.46, "endSec": 0.80, "probability": 0.99},
            {"word": "down", "startSec": 0.81, "endSec": 1.10, "probability": 0.99},
            {"word": "to", "startSec": 1.33, "endSec": 1.48, "probability": 0.99},
            {"word": "20", "startSec": 1.70, "endSec": 2.00, "probability": 0.99},
            {"word": "dollars", "startSec": 2.01, "endSec": 2.45, "probability": 0.99},
        ]
        issues_down = audio_quality.analyze_word_alignment_issues(text_down, asr_down, language="en")
        self.assertEqual(len(issues_down), 1)
        self.assertEqual(issues_down[0]["code"], "ABNORMAL_PAUSE")
        self.assertEqual(issues_down[0]["pauseContext"], "sandwiched_token")
        self.assertEqual(issues_down[0]["words"], ["down", "to", "20"])

        # 2) 'in [0.22s] the [0.22s] car' (article 'the' inside tight PP on both sides) -> WARNING
        text_car = "sitting in the car today"
        asr_car = [
            {"word": "sitting", "startSec": 0.10, "endSec": 0.45, "probability": 0.99},
            {"word": "in", "startSec": 0.46, "endSec": 0.62, "probability": 0.99},
            {"word": "the", "startSec": 0.84, "endSec": 0.98, "probability": 0.99},
            {"word": "car", "startSec": 1.20, "endSec": 1.55, "probability": 0.99},
            {"word": "today", "startSec": 1.56, "endSec": 1.95, "probability": 0.99},
        ]
        issues_car = audio_quality.analyze_word_alignment_issues(text_car, asr_car, language="en")
        self.assertEqual(len(issues_car), 1)
        self.assertEqual(issues_car[0]["code"], "ABNORMAL_PAUSE")
        self.assertEqual(issues_car[0]["pauseContext"], "sandwiched_token")
        self.assertEqual(issues_car[0]["words"], ["in", "the", "car"])

        # 3) Choppy phrase inside tight numeric range ('between [0.25s] 200 [0.25s] and [0.25s] 300') -> WARNING (choppy_phrase)
        text_choppy = "designed to consolidate between two hundred and three hundred stamped parts"
        asr_choppy = [
            {"word": "designed", "startSec": 0.10, "endSec": 0.45, "probability": 0.99},
            {"word": "to", "startSec": 0.46, "endSec": 0.58, "probability": 0.99},
            {"word": "consolidate", "startSec": 0.59, "endSec": 1.15, "probability": 0.99},
            {"word": "between", "startSec": 1.16, "endSec": 1.50, "probability": 0.99},
            {"word": "200", "startSec": 1.75, "endSec": 2.10, "probability": 0.99},
            {"word": "and", "startSec": 2.35, "endSec": 2.50, "probability": 0.99},
            {"word": "300", "startSec": 2.75, "endSec": 3.15, "probability": 0.99},
            {"word": "stamped", "startSec": 3.16, "endSec": 3.55, "probability": 0.99},
            {"word": "parts", "startSec": 3.56, "endSec": 3.95, "probability": 0.99},
        ]
        issues_choppy = audio_quality.analyze_word_alignment_issues(text_choppy, asr_choppy, language="en")
        self.assertEqual(len(issues_choppy), 1)
        self.assertEqual(issues_choppy[0]["code"], "ABNORMAL_PAUSE")
        self.assertEqual(issues_choppy[0]["pauseContext"], "choppy_phrase")

    def test_v320_content_omission_articles_large_gaps_and_hallucinations(self):
        # Section 3.1: Swallowed article 'a' ('building a vast network' -> 'building vast network') must be flagged as MISSING_WORD
        text_art = "without building a vast network"
        asr_art = [
            {"word": "without", "startSec": 0.10, "endSec": 0.45, "probability": 0.99},
            {"word": "building", "startSec": 0.46, "endSec": 0.85, "probability": 0.99},
            {"word": "vast", "startSec": 1.05, "endSec": 1.40, "probability": 0.99},
            {"word": "network", "startSec": 1.41, "endSec": 1.85, "probability": 0.99},
        ]
        issues_art = audio_quality.analyze_word_alignment_issues(text_art, asr_art, language="en")
        self.assertEqual(len(issues_art), 1)
        self.assertEqual(issues_art[0]["code"], "MISSING_WORD")
        self.assertEqual(issues_art[0]["words"], ["a"])

        # Merged token ('a part' -> 'apart') is NOT a missing word
        text_merged = "keep the panels a part during curing"
        asr_merged = [
            {"word": "keep", "startSec": 0.10, "endSec": 0.35, "probability": 0.99},
            {"word": "the", "startSec": 0.36, "endSec": 0.48, "probability": 0.99},
            {"word": "panels", "startSec": 0.49, "endSec": 0.85, "probability": 0.99},
            {"word": "apart", "startSec": 0.86, "endSec": 1.25, "probability": 0.99},
            {"word": "during", "startSec": 1.26, "endSec": 1.55, "probability": 0.99},
            {"word": "curing", "startSec": 1.56, "endSec": 1.95, "probability": 0.99},
        ]
        self.assertEqual(audio_quality.analyze_word_alignment_issues(text_merged, asr_merged, language="en"), [])

        # Section 3.2: Missing word with a LARGE gap (>= 0.85s, e.g. 1.20s) must still be flagged as MISSING_WORD
        text_gap = "The liquid metal flows rapidly through heated pipes."
        asr_gap = [
            {"word": "The", "startSec": 0.10, "endSec": 0.22, "probability": 0.99},
            {"word": "liquid", "startSec": 0.23, "endSec": 0.55, "probability": 0.99},
            {"word": "metal", "startSec": 0.56, "endSec": 0.90, "probability": 0.99},
            # 'flows' omitted with a 1.20s gap [0.90 - 2.10]
            {"word": "rapidly", "startSec": 2.10, "endSec": 2.55, "probability": 0.99},
            {"word": "through", "startSec": 2.56, "endSec": 2.85, "probability": 0.99},
            {"word": "heated", "startSec": 2.86, "endSec": 3.20, "probability": 0.99},
            {"word": "pipes.", "startSec": 3.21, "endSec": 3.65, "probability": 0.99},
        ]
        issues_gap = audio_quality.analyze_word_alignment_issues(text_gap, asr_gap, language="en")
        missing_codes = [i for i in issues_gap if i["code"] == "MISSING_WORD" and i["words"] == ["flows"]]
        self.assertEqual(len(missing_codes), 1)

        # Section 3.3: Extra phrase matching hallucination boilerplate ('thank you') WITH real sustained speech energy -> EXTRA_WORD
        sr = 16000
        t = np.arange(int(sr * 2.5)) / sr
        speech_wave = (0.18 * np.sin(2 * np.pi * 220.0 * t)).astype(np.float32)
        text_hall = "The test is complete."
        asr_hall = [
            {"word": "The", "startSec": 0.10, "endSec": 0.25, "probability": 0.99},
            {"word": "test", "startSec": 0.26, "endSec": 0.55, "probability": 0.99},
            {"word": "is", "startSec": 0.56, "endSec": 0.70, "probability": 0.99},
            {"word": "complete.", "startSec": 0.71, "endSec": 1.15, "probability": 0.99},
            {"word": "Thank", "startSec": 1.25, "endSec": 1.55, "probability": 0.92},
            {"word": "you.", "startSec": 1.56, "endSec": 1.90, "probability": 0.92},
        ]
        issues_hall_voiced = audio_quality.analyze_word_alignment_issues(
            text_hall, asr_hall, language="en", audio_data=speech_wave, sample_rate=sr
        )
        extra_voiced = [i for i in issues_hall_voiced if i["code"] == "EXTRA_WORD"]
        self.assertTrue(len(extra_voiced) >= 1, f"Expected EXTRA_WORD when 'Thank you' has real speech energy, got {issues_hall_voiced}")

        # When trailing region [1.25 - 1.90s] is silent on the waveform, 'Thank you' is filtered as Whisper hallucination
        silent_tail_wave = speech_wave.copy()
        silent_tail_wave[int(1.20 * sr):] = 0.0
        issues_hall_silent = audio_quality.analyze_word_alignment_issues(
            text_hall, asr_hall, language="en", audio_data=silent_tail_wave, sample_rate=sr
        )
        self.assertEqual([i for i in issues_hall_silent if i["code"] == "EXTRA_WORD"], [])

    def test_v320_proper_noun_skeleton_assimilation_and_decimal_slice_budget(self):
        # Section 3.4: Proper noun consonant skeleton preservation
        # 'Nevada' -> 'Navada' (skeleton 'nvd' == 'nvd', 3 syl) -> PASS
        self.assertTrue(audio_quality._is_valid_proper_noun_transliteration("nevada", "navada"))
        # 'Cerabeads' -> 'Cerabeds' (skeleton 'srbds' == 'srbds', 3 syl) -> PASS
        self.assertTrue(audio_quality._is_valid_proper_noun_transliteration("cerabeads", "cerabeds"))
        # 'Tesla' -> 'Tessa' (skeleton 'tsl' != 'ts') -> FALSE (must be flagged as SUSPECTED_MISPRONUNCIATION!)
        self.assertFalse(audio_quality._is_valid_proper_noun_transliteration("tesla", "tessa"))

        text_tesla = "Inside the Tesla factory today."
        asr_tessa = [
            {"word": "Inside", "startSec": 0.10, "endSec": 0.45, "probability": 0.99},
            {"word": "the", "startSec": 0.46, "endSec": 0.58, "probability": 0.99},
            {"word": "Tessa", "startSec": 0.59, "endSec": 1.00, "probability": 0.90},
            {"word": "factory", "startSec": 1.01, "endSec": 1.45, "probability": 0.99},
            {"word": "today.", "startSec": 1.46, "endSec": 1.85, "probability": 0.99},
        ]
        issues_tessa = audio_quality.analyze_word_alignment_issues(text_tesla, asr_tessa, language="en")
        self.assertEqual(len(issues_tessa), 1)
        self.assertEqual(issues_tessa[0]["code"], "SUSPECTED_MISPRONUNCIATION")
        self.assertEqual(issues_tessa[0]["words"], ["tesla", "tessa"])

        # Section 3.5: 'wanted the' -> 'want the' (2 syllables vs 1 syllable) must NOT be exempted as assimilation
        text_wanted = "They wanted the new battery."
        asr_want = [
            {"word": "They", "startSec": 0.10, "endSec": 0.30, "probability": 0.99},
            {"word": "want", "startSec": 0.31, "endSec": 0.65, "probability": 0.85},
            {"word": "the", "startSec": 0.66, "endSec": 0.80, "probability": 0.99},
            {"word": "new", "startSec": 0.81, "endSec": 1.05, "probability": 0.99},
            {"word": "battery.", "startSec": 1.06, "endSec": 1.55, "probability": 0.99},
        ]
        issues_want = audio_quality.analyze_word_alignment_issues(text_wanted, asr_want, language="en")
        self.assertEqual(len(issues_want), 1)

        # 'and expansion' -> 'an expansion' after a 0.34s comma pause -> SUSPECTED_MISPRONUNCIATION
        text_and = "in a month, and expansion into Dallas"
        asr_an = [
            {"word": "in", "startSec": 0.10, "endSec": 0.25, "probability": 0.99},
            {"word": "a", "startSec": 0.26, "endSec": 0.36, "probability": 0.99},
            {"word": "month,", "startSec": 0.37, "endSec": 0.70, "probability": 0.99},
            {"word": "an", "startSec": 1.04, "endSec": 1.34, "probability": 0.83},
            {"word": "expansion", "startSec": 1.35, "endSec": 1.90, "probability": 0.99},
            {"word": "into", "startSec": 1.91, "endSec": 2.20, "probability": 0.99},
            {"word": "Dallas", "startSec": 2.21, "endSec": 2.65, "probability": 0.99},
        ]
        issues_an = audio_quality.analyze_word_alignment_issues(text_and, asr_an, language="en")
        self.assertEqual(len(issues_an), 1)
        self.assertEqual(issues_an[0]["code"], "SUSPECTED_MISPRONUNCIATION")
        self.assertEqual(issues_an[0]["words"], ["and", "an"])

        # Section 3.6: _numeric_mismatch_review returns UNVERIFIED_NUMBER when slice_budget is exhausted ([0])
        # or when '1.2' vs '0.2' is compared without a second pass
        sr = 16000
        dummy_wave = np.ones(sr * 2, dtype=np.float32) * 0.05
        asr_num = [{"word": "2.4", "startSec": 0.20, "endSec": 0.70, "probability": 0.85}]
        exhausted_budget = [0]
        res_exhausted = audio_quality._numeric_mismatch_review(
            expected="2.8",
            observed="2.4",
            asr_words=asr_num,
            j1=0,
            j2=1,
            whisper_model=object(),
            audio_data=dummy_wave,
            sample_rate=sr,
            language="en",
            total_dur=2.0,
            slice_budget=exhausted_budget,
        )
        self.assertIsNotNone(res_exhausted)
        self.assertEqual(res_exhausted["code"], "UNVERIFIED_NUMBER")
        self.assertEqual(res_exhausted["severity"], "unverified")

        res_1_0 = audio_quality._numeric_mismatch_review(
            expected="1.2",
            observed="0.2",
            asr_words=[{"word": "0.2", "startSec": 0.20, "endSec": 0.70, "probability": 0.90}],
            j1=0,
            j2=1,
            whisper_model=None,
            audio_data=None,
            sample_rate=sr,
            language="en",
            total_dur=2.0,
        )
        self.assertIsNotNone(res_1_0)
        self.assertEqual(res_1_0["code"], "UNVERIFIED_NUMBER")

    def test_v320_unvoiced_fricative_onset_and_short_word_intra_pause(self):
        # Section 4.1: Unvoiced labiodental fricative '/f/' onset (rms ~ 0.0012, zcr >= 0.45) before voiced vowel
        # must be masked as speech onset so 'at 400' does not trigger a false ABNORMAL_PAUSE
        sr = 16000
        wave = np.zeros(int(sr * 2.0), dtype=np.float32)
        t = np.arange(wave.size) / sr
        voiced = (0.18 * np.sin(2 * np.pi * 190.0 * t)).astype(np.float32)
        # 'at' [0.20 - 0.45]
        wave[int(0.20 * sr):int(0.45 * sr)] = voiced[int(0.20 * sr):int(0.45 * sr)]
        # 0.06s true silence [0.45 - 0.51]
        # '/f/' unvoiced fricative onset [0.51 - 0.78] with rms ~ 0.0012 and high ZCR (~0.60)
        alt = np.where((np.arange(int(0.27 * sr)) % 2) == 0, 0.0012, -0.0012).astype(np.float32)
        wave[int(0.51 * sr):int(0.78 * sr)] = alt
        # '400' voiced nucleus [0.78 - 1.35]
        wave[int(0.78 * sr):int(1.35 * sr)] = voiced[int(0.78 * sr):int(1.35 * sr)]

        env = audio_quality.compute_acoustic_envelope(wave, sr)
        asr_f = [
            {"word": "at", "startSec": 0.20, "endSec": 0.45, "probability": 0.99},
            {"word": "400", "startSec": 0.78, "endSec": 1.35, "probability": 0.99},
        ]
        issues_f = audio_quality.analyze_word_alignment_issues(
            "at four hundred", asr_f, language="en", audio_data=wave, sample_rate=sr, envelope=env
        )
        self.assertEqual(issues_f, [], f"Expected 0 false pause for '/f/' onset before 400, got {issues_f}")

        # Section 4.2: Short 3-letter word ('car') with genuine mid-word silent break (0.20s inside 0.62s word) -> SUSPICIOUS_INTRA_PAUSE
        wave_car = np.zeros(int(sr * 1.5), dtype=np.float32)
        t_car = np.arange(wave_car.size) / sr
        carrier_car = (0.22 * np.sin(2 * np.pi * 180.0 * t_car)).astype(np.float32)
        # 'ca-' [0.20 - 0.41] (210ms active)
        wave_car[int(0.20 * sr):int(0.41 * sr)] = carrier_car[int(0.20 * sr):int(0.41 * sr)]
        # silent break [0.41 - 0.61] (200ms silence)
        # '-r' [0.61 - 0.82] (210ms active)
        wave_car[int(0.61 * sr):int(0.82 * sr)] = carrier_car[int(0.61 * sr):int(0.82 * sr)]
        asr_car_intra = [{"word": "car", "startSec": 0.20, "endSec": 0.82, "probability": 0.95}]
        intra_car = audio_quality.detect_intra_word_pause(wave_car, sr, "car", asr_car_intra)
        self.assertEqual(len(intra_car), 1)
        self.assertEqual(intra_car[0]["code"], "SUSPICIOUS_INTRA_PAUSE")
        self.assertEqual(intra_car[0]["words"], ["car"])

    def test_v330_missing_article_continuous_speech_no_false_pass(self):
        # Section 1.1: 'building a vast network' spoken as 'building vast network' with continuous energy (gap=0.02s)
        # MUST NOT be exempted merely because gap < 0.05s or boundary RMS >= 0.022!
        from types import SimpleNamespace

        sr = 16000
        wave = np.zeros(int(sr * 2.2), dtype=np.float32)
        t = np.arange(wave.size) / sr
        carrier = (0.24 * np.sin(2 * np.pi * 195.0 * t)).astype(np.float32)
        # Construct 3 vowel nuclei across 'building' (2 syllables: [0.46..0.63], [0.66..0.84]) and 'vast' (1 syllable: [0.86..1.25])
        # with continuous energy across the 0.02s boundary [0.84..0.86], so liaison_rms > 0.05 but NO 4th vowel nucleus for 'a'
        for s_sec, e_sec in ((0.10, 0.44), (0.46, 0.63), (0.66, 0.84), (0.86, 1.25), (1.27, 1.75)):
            wave[int(s_sec * sr):int(e_sec * sr)] = carrier[int(s_sec * sr):int(e_sec * sr)]
        wave[int(0.83 * sr):int(0.87 * sr)] = carrier[int(0.83 * sr):int(0.87 * sr)] * 0.65

        text = "without building a vast network"
        asr_words = [
            {"word": "without", "startSec": 0.10, "endSec": 0.44, "probability": 0.99},
            {"word": "building", "startSec": 0.46, "endSec": 0.84, "probability": 0.99},
            {"word": "vast", "startSec": 0.86, "endSec": 1.25, "probability": 0.99},
            {"word": "network", "startSec": 1.27, "endSec": 1.75, "probability": 0.99},
        ]
        issues_no_a = audio_quality.analyze_word_alignment_issues(
            text, asr_words, language="en", audio_data=wave, sample_rate=sr, audio_duration_sec=2.2
        )
        self.assertEqual(len(issues_no_a), 1, f"Expected MISSING_WORD for omitted 'a' in continuous speech, got {issues_no_a}")
        self.assertEqual(issues_no_a[0]["code"], "MISSING_WORD")
        self.assertEqual(issues_no_a[0]["severity"], "warning")
        self.assertEqual(issues_no_a[0]["words"], ["a"])

        # Now add a 4th distinct vowel nucleus at [0.84..0.93] ('a') separated by dips so observed_nuclei == 4:
        # Without a secondary Whisper model, it must emit UNVERIFIED_WORD (never silent PASS).
        wave_4nuc = np.zeros(int(sr * 2.2), dtype=np.float32)
        for s_sec, e_sec in ((0.10, 0.44), (0.46, 0.60), (0.64, 0.78), (0.82, 0.93), (0.97, 1.25), (1.27, 1.75)):
            wave_4nuc[int(s_sec * sr):int(e_sec * sr)] = carrier[int(s_sec * sr):int(e_sec * sr)]
        issues_unv = audio_quality.analyze_word_alignment_issues(
            text, asr_words, language="en", audio_data=wave_4nuc, sample_rate=sr, audio_duration_sec=2.2
        )
        self.assertEqual(len(issues_unv), 1)
        self.assertEqual(issues_unv[0]["code"], "UNVERIFIED_WORD")
        self.assertEqual(issues_unv[0]["severity"], "unverified")

        # When secondary Whisper slice confirms 'building a vast', it passes with 0 issues:
        class MockConfirmWhisper:
            def transcribe(self, *args, **kwargs):
                seg = SimpleNamespace(
                    text="building a vast",
                    words=[
                        SimpleNamespace(word="building", probability=0.95, start=0.1, end=0.4),
                        SimpleNamespace(word="a", probability=0.92, start=0.41, end=0.50),
                        SimpleNamespace(word="vast", probability=0.96, start=0.51, end=0.85),
                    ],
                )
                return [seg], None

        issues_confirmed = audio_quality.analyze_word_alignment_issues(
            text,
            asr_words,
            language="en",
            audio_data=wave_4nuc,
            sample_rate=sr,
            whisper_model=MockConfirmWhisper(),
            audio_duration_sec=2.2,
        )
        self.assertEqual(issues_confirmed, [])

    def test_v330_clause_subject_structure_and_verb_boundaries(self):
        # Section 2.1:
        # 1) Short 1-3 word Subject NP + Aux/Modal/Copula -> TIGHT_COHESION (threshold <= 0.28s)
        short_subj_aux_cases = [
            ("The motor is running smoothly.", 1, 2, "motor", "is", 0.34),
            ("The system can handle peak loads.", 1, 2, "system", "can", 0.34),
            ("The electric motor is ready.", 2, 3, "motor", "is", 0.34),
        ]
        for sent, idx1, idx2, w1, w2, gap_sec in short_subj_aux_cases:
            src_w, delims, _ = audio_quality.tokenize_text_with_spans(sent)
            src_clean = [audio_quality.clean_word(w) for w in src_w]
            syn = audio_quality.evaluate_syntactic_boundary(src_w, src_clean, delims, idx1, idx2, w1, w2)
            self.assertEqual(syn["classification"], "TIGHT_COHESION", f"Expected TIGHT_COHESION for '{w1} | {w2}' in '{sent}', got {syn}")
            self.assertLessEqual(syn["threshold_sec"], 0.28 if idx1 <= 1 else 0.32)

            asr_words = []
            t_cur = 0.10
            for k, tok in enumerate(src_w):
                asr_words.append({"word": tok, "startSec": round(t_cur, 3), "endSec": round(t_cur + 0.25, 3), "probability": 0.99})
                t_cur += 0.26 + (gap_sec if k == idx1 else 0.0)
            issues = audio_quality.analyze_word_alignment_issues(sent, asr_words, language="en")
            self.assertEqual(len(issues), 1, f"Expected ABNORMAL_PAUSE for '{w1} [{gap_sec}s] {w2}' in '{sent}', got {issues}")
            self.assertEqual(issues[0]["code"], "ABNORMAL_PAUSE")

        # 2) Short 1-2 word Subject NP + Lexical Finite Verb -> TIGHT_COHESION (threshold <= 0.30s)
        short_subj_verb_cases = [
            ("The machine produces clean energy.", 1, 2, "machine", "produces", 0.35),
            ("This motor generates high torque.", 1, 2, "motor", "generates", 0.35),
            ("Tesla builds electric vehicles.", 0, 1, "Tesla", "builds", 0.35),
        ]
        for sent, idx1, idx2, w1, w2, gap_sec in short_subj_verb_cases:
            src_w, delims, _ = audio_quality.tokenize_text_with_spans(sent)
            src_clean = [audio_quality.clean_word(w) for w in src_w]
            syn = audio_quality.evaluate_syntactic_boundary(src_w, src_clean, delims, idx1, idx2, w1, w2)
            self.assertEqual(syn["classification"], "TIGHT_COHESION", f"Expected TIGHT_COHESION for '{w1} | {w2}' in '{sent}', got {syn}")
            self.assertLessEqual(syn["threshold_sec"], 0.30)

        # 3) 3-word unmodified Subject NP + Lexical Verb -> UNCERTAIN_BOUNDARY (threshold <= 0.50s, NOT 0.62s)
        src_3w, delims_3w, _ = audio_quality.tokenize_text_with_spans("The electric motor produces high torque.")
        clean_3w = [audio_quality.clean_word(w) for w in src_3w]
        syn_3w = audio_quality.evaluate_syntactic_boundary(src_3w, clean_3w, delims_3w, 2, 3, "motor", "produces")
        self.assertEqual(syn_3w["classification"], "UNCERTAIN_BOUNDARY")
        self.assertLessEqual(syn_3w["threshold_sec"], 0.50)

        # 4) Heavy branching Subject NP with post-nominal modifier -> NATURAL_BOUNDARY (0.62s)
        src_heavy, delims_heavy, _ = audio_quality.tokenize_text_with_spans(
            "The massive casting machine in Shanghai produces single-piece rear frames."
        )
        clean_heavy = [audio_quality.clean_word(w) for w in src_heavy]
        syn_heavy = audio_quality.evaluate_syntactic_boundary(src_heavy, clean_heavy, delims_heavy, 5, 6, "Shanghai", "produces")
        self.assertEqual(syn_heavy["classification"], "NATURAL_BOUNDARY")

    def test_v330_choppy_phrase_requires_whole_phrase_discontinuity(self):
        # Section 2.3: Two ~0.23s pauses inside a phrase where active words are long/fluent
        # (low discontinuity_ratio and pause_to_speech_ratio < 0.28) must NOT trigger a choppy_phrase WARNING.
        text_fluent = "engineers carefully calibrated specialized manufacturing equipment today"
        asr_fluent = [
            {"word": "engineers", "startSec": 0.10, "endSec": 0.85, "probability": 0.99},
            {"word": "carefully", "startSec": 0.86, "endSec": 1.65, "probability": 0.99},
            # 0.23s pause
            {"word": "calibrated", "startSec": 1.88, "endSec": 2.75, "probability": 0.99},
            # 0.23s pause
            {"word": "specialized", "startSec": 2.98, "endSec": 3.85, "probability": 0.99},
            {"word": "manufacturing", "startSec": 3.86, "endSec": 4.75, "probability": 0.99},
            {"word": "equipment", "startSec": 4.76, "endSec": 5.45, "probability": 0.99},
            {"word": "today", "startSec": 5.46, "endSec": 5.95, "probability": 0.99},
        ]
        issues_fluent = audio_quality.analyze_word_alignment_issues(text_fluent, asr_fluent, language="en")
        warn_fluent = [i for i in issues_fluent if i["severity"] == "warning"]
        self.assertEqual(warn_fluent, [], f"Expected 0 warnings for low-discontinuity 2x0.23s pauses, got {warn_fluent}")

    def test_v330_coarticulatory_assimilation_strictness_and_deduplication(self):
        # Section 1.2:
        # 1) High-confidence missing -d ('flipped the' -> 'flip the' with prob=0.96 and no audio evidence) -> WARNING
        text_flip = "and the findings flipped the narrative"
        asr_flip_high = [
            {"word": "and", "startSec": 0.10, "endSec": 0.25, "probability": 0.99},
            {"word": "the", "startSec": 0.26, "endSec": 0.38, "probability": 0.99},
            {"word": "findings", "startSec": 0.39, "endSec": 0.85, "probability": 0.99},
            {"word": "flip", "startSec": 0.86, "endSec": 1.20, "probability": 0.96},
            {"word": "the", "startSec": 1.21, "endSec": 1.35, "probability": 0.99},
            {"word": "narrative", "startSec": 1.36, "endSec": 1.90, "probability": 0.99},
        ]
        issues_flip_high = audio_quality.analyze_word_alignment_issues(text_flip, asr_flip_high, language="en")
        self.assertEqual(len(issues_flip_high), 1)
        self.assertEqual(issues_flip_high[0]["code"], "SUSPECTED_MISPRONUNCIATION")

        # 2) Non-homorganic missing -ed ('walked back' -> 'walk back' before labial 'b') -> WARNING even at low prob
        text_walk = "They walked back to the station."
        asr_walk = [
            {"word": "They", "startSec": 0.10, "endSec": 0.25, "probability": 0.99},
            {"word": "walk", "startSec": 0.26, "endSec": 0.58, "probability": 0.72},
            {"word": "back", "startSec": 0.59, "endSec": 0.88, "probability": 0.99},
            {"word": "to", "startSec": 0.89, "endSec": 1.02, "probability": 0.99},
            {"word": "the", "startSec": 1.03, "endSec": 1.15, "probability": 0.99},
            {"word": "station.", "startSec": 1.16, "endSec": 1.65, "probability": 0.99},
        ]
        issues_walk = audio_quality.analyze_word_alignment_issues(text_walk, asr_walk, language="en")
        self.assertEqual(len(issues_walk), 1)
        self.assertEqual(issues_walk[0]["code"], "SUSPECTED_MISPRONUNCIATION")

        # 3) Stage 3 Decision Deduplicator collapses overlapping issues on the same span
        raw_issues = [
            {
                "code": "UNVERIFIED_PAUSE",
                "severity": "unverified",
                "message": "Unverified pause",
                "startSec": 1.10,
                "endSec": 1.45,
                "words": ["motor", "produces"],
            },
            {
                "code": "ABNORMAL_PAUSE",
                "severity": "warning",
                "message": "Abnormal pause",
                "startSec": 1.12,
                "endSec": 1.44,
                "words": ["motor", "produces"],
            },
        ]
        deduped = audio_quality._deduplicate_quality_issues(raw_issues)
        self.assertEqual(len(deduped), 1)
        self.assertEqual(deduped[0]["code"], "ABNORMAL_PAUSE")
        self.assertEqual(deduped[0]["severity"], "warning")

    def test_v340_omitted_word_whisper_non_independence_and_clitic_recovery(self):
        # Sections 1.1 & 1.2:
        # Two runs of Whisper on the same audio are NOT two independent sources.
        # If secondary Whisper repeats the omission on a slice where the waveform has
        # verified reduced-clitic vowel acoustics ('building a vast network' spoken with 'a'),
        # it must recover PASS rather than falsely flagging MISSING_WORD.
        from types import SimpleNamespace

        sr = 16000
        wave_with_a = np.zeros(int(sr * 2.2), dtype=np.float32)
        t = np.arange(wave_with_a.size) / sr
        carrier = (0.24 * np.sin(2 * np.pi * 195.0 * t)).astype(np.float32)
        # 4 distinct vowel nuclei across 'building' [0.46..0.76], 'a' [0.80..0.90], 'vast' [0.94..1.25]
        # with sustained voiced vocalic bridge at the boundary [0.77..0.90]
        for s_sec, e_sec in ((0.10, 0.44), (0.46, 0.60), (0.63, 0.76), (0.79, 0.90), (0.94, 1.25), (1.27, 1.75)):
            wave_with_a[int(s_sec * sr):int(e_sec * sr)] = carrier[int(s_sec * sr):int(e_sec * sr)]

        text = "without building a vast network"
        asr_words = [
            {"word": "without", "startSec": 0.10, "endSec": 0.44, "probability": 0.99},
            {"word": "building", "startSec": 0.46, "endSec": 0.84, "probability": 0.99},
            {"word": "vast", "startSec": 0.86, "endSec": 1.25, "probability": 0.99},
            {"word": "network", "startSec": 1.27, "endSec": 1.75, "probability": 0.99},
        ]

        class MockRepeatingOmissionWhisper:
            def transcribe(self, *args, **kwargs):
                seg = SimpleNamespace(
                    text="building vast",
                    words=[
                        SimpleNamespace(word="building", probability=0.95, start=0.1, end=0.45),
                        SimpleNamespace(word="vast", probability=0.95, start=0.46, end=0.85),
                    ],
                )
                return [seg], None

        # 1) Reduced clitic 'a' with verified 4-nucleus + vocalic bridge waveform recovers PASS even when secondary Whisper repeats omission
        issues_clitic_recovered = audio_quality.analyze_word_alignment_issues(
            text,
            asr_words,
            language="en",
            audio_data=wave_with_a,
            sample_rate=sr,
            whisper_model=MockRepeatingOmissionWhisper(),
            audio_duration_sec=2.2,
        )
        self.assertEqual(issues_clitic_recovered, [])

        # 2) Non-clitic function word ('can') where waveform has unattributed speech energy in the gap
        #    but secondary Whisper repeats the omission -> must return UNVERIFIED_WORD (not MISSING_WORD or silent PASS)
        text_can = "they can generate power"
        asr_can = [
            {"word": "they", "startSec": 0.10, "endSec": 0.40, "probability": 0.99},
            # 0.18s gap [0.40..0.58] filled with speech energy
            {"word": "generate", "startSec": 0.58, "endSec": 1.15, "probability": 0.99},
            {"word": "power", "startSec": 1.16, "endSec": 1.60, "probability": 0.99},
        ]
        wave_can_energy = carrier[:int(sr * 1.8)].copy()
        issues_can_conflict = audio_quality.analyze_word_alignment_issues(
            text_can,
            asr_can,
            language="en",
            audio_data=wave_can_energy,
            sample_rate=sr,
            whisper_model=MockRepeatingOmissionWhisper(),
            audio_duration_sec=1.8,
        )
        self.assertEqual(len(issues_can_conflict), 1)
        self.assertEqual(issues_can_conflict[0]["code"], "UNVERIFIED_WORD")
        self.assertEqual(issues_can_conflict[0]["severity"], "unverified")

        # 3) Genuine omission of 'can' and 'has' when gap has no extra speech/syllable energy -> MISSING_WORD (WARNING)
        wave_can_silent_gap = wave_can_energy.copy()
        wave_can_silent_gap[int(0.40 * sr):int(0.58 * sr)] = 0.0
        issues_can_missing = audio_quality.analyze_word_alignment_issues(
            text_can,
            asr_can,
            language="en",
            audio_data=wave_can_silent_gap,
            sample_rate=sr,
            whisper_model=MockRepeatingOmissionWhisper(),
            audio_duration_sec=1.8,
        )
        self.assertEqual(len(issues_can_missing), 1)
        self.assertEqual(issues_can_missing[0]["code"], "MISSING_WORD")
        self.assertEqual(issues_can_missing[0]["severity"], "warning")
        self.assertEqual(issues_can_missing[0]["words"], ["can"])

        text_has = "the system has improved"
        asr_has = [
            {"word": "the", "startSec": 0.10, "endSec": 0.22, "probability": 0.99},
            {"word": "system", "startSec": 0.23, "endSec": 0.65, "probability": 0.99},
            {"word": "improved", "startSec": 0.67, "endSec": 1.20, "probability": 0.99},
        ]
        issues_has_missing = audio_quality.analyze_word_alignment_issues(text_has, asr_has, language="en")
        self.assertEqual(len(issues_has_missing), 1)
        self.assertEqual(issues_has_missing[0]["code"], "MISSING_WORD")
        self.assertEqual(issues_has_missing[0]["words"], ["has"])

    def test_v340_coarticulatory_assimilation_requires_acoustic_phoneme_evidence(self):
        # Section 1.3:
        # 1) Single-consonant -ed omission before dental/alveolar ('walked to' -> 'walk to' with prob=0.72)
        #    must NOT be auto-passed by a generic w_prob < 0.82 rule!
        text_walk_to = "They walked to the station."
        asr_walk_to = [
            {"word": "They", "startSec": 0.10, "endSec": 0.25, "probability": 0.99},
            {"word": "walk", "startSec": 0.26, "endSec": 0.58, "probability": 0.72},
            {"word": "to", "startSec": 0.59, "endSec": 0.72, "probability": 0.99},
            {"word": "the", "startSec": 0.73, "endSec": 0.85, "probability": 0.99},
            {"word": "station.", "startSec": 0.86, "endSec": 1.35, "probability": 0.99},
        ]
        issues_walk_to = audio_quality.analyze_word_alignment_issues(text_walk_to, asr_walk_to, language="en")
        self.assertEqual(len(issues_walk_to), 1)
        self.assertEqual(issues_walk_to[0]["code"], "SUSPECTED_MISPRONUNCIATION")
        self.assertEqual(issues_walk_to[0]["words"], ["walked", "walk"])

        # 2) Doubled-stop stem ('flipped the' -> 'flip the') WITH real waveform:
        #    - When continuous vowel energy fills the boundary without any stop-closure hold, it MUST flag SUSPECTED_MISPRONUNCIATION.
        #    - When a genuine >= 20ms low-energy stop-closure hold exists at [t_end - 0.04, next_start], it passes.
        sr = 16000
        t = np.arange(int(sr * 2.0)) / sr
        continuous_vowel = (0.25 * np.sin(2 * np.pi * 190.0 * t)).astype(np.float32)
        text_flip = "and the findings flipped the narrative"
        asr_flip = [
            {"word": "and", "startSec": 0.10, "endSec": 0.25, "probability": 0.99},
            {"word": "the", "startSec": 0.26, "endSec": 0.38, "probability": 0.99},
            {"word": "findings", "startSec": 0.39, "endSec": 0.85, "probability": 0.99},
            {"word": "flip", "startSec": 0.86, "endSec": 1.20, "probability": 0.72},
            {"word": "the", "startSec": 1.21, "endSec": 1.35, "probability": 0.99},
            {"word": "narrative", "startSec": 1.36, "endSec": 1.90, "probability": 0.99},
        ]
        issues_no_closure = audio_quality.analyze_word_alignment_issues(
            text_flip, asr_flip, language="en", audio_data=continuous_vowel, sample_rate=sr
        )
        self.assertEqual(len(issues_no_closure), 1)
        self.assertEqual(issues_no_closure[0]["code"], "SUSPECTED_MISPRONUNCIATION")

        wave_with_closure = continuous_vowel.copy()
        # Insert a 35ms stop closure hold at the end of 'flipped' [1.165..1.200]
        wave_with_closure[int(1.165 * sr):int(1.205 * sr)] = 0.002
        issues_with_closure = audio_quality.analyze_word_alignment_issues(
            text_flip, asr_flip, language="en", audio_data=wave_with_closure, sample_rate=sr
        )
        self.assertEqual(issues_with_closure, [])

    def test_v340_transcript_independent_acoustic_stutter_and_onset_restart(self):
        # Section 2.2:
        # 1) Intra-word syllable repetition ('mo-mo-mobile' / 'mo-mobile') where Whisper normalizes
        #    the word text to 'mobile' (no hyphen in ASR text!) MUST still be detected as SUSPECTED_STUTTER.
        sr = 16000
        wave_stut = np.zeros(int(sr * 2.0), dtype=np.float32)
        t = np.arange(wave_stut.size) / sr
        syl_mo = (0.28 * np.sin(2 * np.pi * 185.0 * t)).astype(np.float32)
        syl_bile = (0.26 * np.sin(2 * np.pi * 240.0 * t)).astype(np.float32)
        # 'mo-' [0.40..0.52], valley [0.52..0.58], 'mo-' [0.58..0.70], valley [0.70..0.75], '-bile' [0.75..0.95]
        # Total 3 voiced bursts inside 'mobile' (expected_syl == 2)
        wave_stut[int(0.40 * sr):int(0.52 * sr)] = syl_mo[int(0.40 * sr):int(0.52 * sr)]
        wave_stut[int(0.58 * sr):int(0.70 * sr)] = syl_mo[int(0.58 * sr):int(0.70 * sr)]
        wave_stut[int(0.75 * sr):int(0.95 * sr)] = syl_bile[int(0.75 * sr):int(0.95 * sr)]

        asr_normalized = [
            {"word": "mobile", "startSec": 0.38, "endSec": 0.98, "probability": 0.92},
        ]
        stutters_intra = audio_quality.detect_acoustic_stutter(
            wave_stut, sr, text="mobile", asr_words=asr_normalized, language="en"
        )
        self.assertEqual(len(stutters_intra), 1, f"Expected SUSPECTED_STUTTER on normalized 'mobile', got {stutters_intra}")
        self.assertEqual(stutters_intra[0]["code"], "SUSPECTED_STUTTER")
        self.assertEqual(stutters_intra[0]["words"], ["mobile"])

        # 2) Cut-and-restart onset stutter where Whisper aligns 'mobile' starting at the 2nd burst [0.58..0.98],
        #    leaving the 1st burst 'mo-' [0.40..0.52] unaligned in the gap before 'mobile':
        asr_onset_shifted = [
            {"word": "mobile", "startSec": 0.58, "endSec": 0.98, "probability": 0.92},
        ]
        stutters_onset = audio_quality.detect_acoustic_stutter(
            wave_stut, sr, text="mobile", asr_words=asr_onset_shifted, language="en"
        )
        self.assertEqual(len(stutters_onset), 1, f"Expected SUSPECTED_STUTTER on onset-shifted 'mobile', got {stutters_onset}")
        self.assertEqual(stutters_onset[0]["code"], "SUSPECTED_STUTTER")

        # 3) Normal 2-syllable 'mobile' (only 2 voiced bursts: 'mo' + 'bile') must NOT trigger false stutter
        wave_clean = np.zeros(int(sr * 2.0), dtype=np.float32)
        wave_clean[int(0.58 * sr):int(0.70 * sr)] = syl_mo[int(0.58 * sr):int(0.70 * sr)]
        wave_clean[int(0.75 * sr):int(0.95 * sr)] = syl_bile[int(0.75 * sr):int(0.95 * sr)]
        stutters_clean = audio_quality.detect_acoustic_stutter(
            wave_clean, sr, text="mobile", asr_words=asr_onset_shifted, language="en"
        )
        self.assertEqual(stutters_clean, [])

    def test_v340_introductory_pp_and_preposition_boundary_refinements(self):
        # Section 2.3:
        # 1) Introductory PP before a short subject ('In the factory the motor is running')
        #    must recognize 'the motor' (len=2) as a short tight subject before 'is', NOT a 5-word heavy NP!
        sent_intro = "In the factory the motor is running smoothly."
        src_w, delims, _ = audio_quality.tokenize_text_with_spans(sent_intro)
        src_clean = [audio_quality.clean_word(w) for w in src_w]
        syn_intro = audio_quality.evaluate_syntactic_boundary(src_w, src_clean, delims, 4, 5, "motor", "is")
        self.assertEqual(syn_intro["classification"], "TIGHT_COHESION")
        self.assertLessEqual(syn_intro["threshold_sec"], 0.28)
        self.assertIn("rule_score", syn_intro)
        self.assertNotIn("confidence", syn_intro)

        # 2) Short clause-initial NP before an attributive preposition ('The motor | in the car is broken')
        #    must be UNCERTAIN_BOUNDARY (0.50s), NOT NATURAL_BOUNDARY (0.62s)
        sent_short_pp = "The motor in the car is broken."
        sw2, del2, _ = audio_quality.tokenize_text_with_spans(sent_short_pp)
        sc2 = [audio_quality.clean_word(w) for w in sw2]
        syn_short_pp = audio_quality.evaluate_syntactic_boundary(sw2, sc2, del2, 1, 2, "motor", "in")
        self.assertEqual(syn_short_pp["classification"], "UNCERTAIN_BOUNDARY")
        self.assertLessEqual(syn_short_pp["threshold_sec"], 0.50)

    def test_v340_deduplication_preserves_multi_error_chunks_and_combines_evidence(self):
        # Section 3.1 & 3.2:
        # 1) Three distinct errors in the same phrase (mispronunciation + abnormal pause + repeated word,
        #    or two adjacent mispronunciations, or an inter-word pause + non-overlapping intra-word break)
        #    must ALL be preserved without dropping any error.
        multi_issues = [
            {
                "code": "SUSPECTED_MISPRONUNCIATION",
                "severity": "warning",
                "message": "Mispronounced 'Tesla'",
                "timeRange": [0.50, 0.85],
                "words": ["tesla", "tessa"],
                "evidence": "align_replace:tesla->tessa",
            },
            {
                "code": "ABNORMAL_PAUSE",
                "severity": "warning",
                "message": "Pause between 'Tesla' and 'builds'",
                "timeRange": [0.85, 1.25],
                "words": ["tesla", "builds"],
                "evidence": "pause=0.40s",
            },
            {
                "code": "SUSPICIOUS_INTRA_PAUSE",
                "severity": "warning",
                "message": "Intra-word break inside 'builds'",
                "timeRange": [1.35, 1.55],
                "words": ["builds"],
                "evidence": "intra_silence=0.20s",
            },
            {
                "code": "REPEATED_WORD",
                "severity": "warning",
                "message": "Repeated 'builds'",
                "timeRange": [1.26, 1.85],
                "words": ["builds"],
                "evidence": "asr_repeat:builds",
            },
        ]
        deduped_multi = audio_quality._deduplicate_quality_issues(multi_issues)
        self.assertEqual(len(deduped_multi), 4, f"Expected all 4 distinct defects preserved, got {deduped_multi}")

        # 2) Two adjacent boundary pauses ('a | b' and 'b | c') that share pivot word 'b' must NOT be merged into one
        adj_pauses = [
            {
                "code": "ABNORMAL_PAUSE",
                "severity": "warning",
                "message": "Pause 1",
                "timeRange": [0.40, 0.75],
                "words": ["alpha", "beta"],
                "evidence": "p1=0.35s",
            },
            {
                "code": "ABNORMAL_PAUSE",
                "severity": "warning",
                "message": "Pause 2",
                "timeRange": [0.95, 1.35],
                "words": ["beta", "gamma"],
                "evidence": "p2=0.40s",
            },
        ]
        self.assertEqual(len(audio_quality._deduplicate_quality_issues(adj_pauses)), 2)

        # 3) Same physical stutter detected by both ASR alignment (REPEATED_WORD) and waveform burst (SUSPECTED_STUTTER)
        #    merges into 1 issue AND combines their evidence strings.
        same_stutter = [
            {
                "code": "REPEATED_WORD",
                "severity": "warning",
                "message": "Repeated mobile",
                "timeRange": [0.40, 0.95],
                "words": ["mobile"],
                "evidence": "asr_insert_repeat:mobile",
            },
            {
                "code": "SUSPECTED_STUTTER",
                "severity": "warning",
                "message": "Acoustic stutter mobile",
                "timeRange": [0.42, 0.72],
                "words": ["mobile"],
                "evidence": "burst_cos_sim=0.95",
            },
        ]
        merged_stut = audio_quality._deduplicate_quality_issues(same_stutter)
        self.assertEqual(len(merged_stut), 1)
        self.assertIn("asr_insert_repeat:mobile", merged_stut[0]["evidence"])
        self.assertIn("burst_cos_sim=0.95", merged_stut[0]["evidence"])

        # 4) Exhausted slice_budget ([0]) in _verify_low_confidence_equal_word returns UNVERIFIED_WORD, never None (PASS)
        exhausted_res = audio_quality._verify_low_confidence_equal_word(
            source_words=["Testing", "manufacturing", "today"],
            source_words_clean=["testing", "manufacturing", "today"],
            src_idx=1,
            w_obj={"word": "manufacturing", "startSec": 0.50, "endSec": 1.20, "probability": 0.42},
            audio_data=np.zeros(16000 * 2, dtype=np.float32),
            sample_rate=16000,
            audio_path=None,
            whisper_model=object(),
            language="en",
            total_dur=2.0,
            slice_budget=[0],
        )
        self.assertIsNotNone(exhausted_res)
        self.assertEqual(exhausted_res["code"], "UNVERIFIED_WORD")
        self.assertEqual(exhausted_res["severity"], "unverified")
        self.assertEqual(exhausted_res["unverifiedReason"], "slice_budget_exhausted")


if __name__ == "__main__":
    unittest.main()



