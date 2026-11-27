"""audio_ops: real assembly, resampling, WAV/MP3 encoding, atomic writes."""
from __future__ import annotations

import os
import tempfile
import unittest

import numpy as np
import soundfile as sf

import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from voxlab_sidecar import audio_ops
from voxlab_sidecar.protocol import SidecarError


class _Ctx:
    cancelled = False

    def progress(self, *_a):
        pass

    def check_cancelled(self):
        pass


def _tone(path: str, sec: float, sr: int, freq: float = 440.0) -> None:
    t = np.arange(int(sec * sr)) / sr
    sf.write(path, (0.5 * np.sin(2 * np.pi * freq * t)).astype(np.float32), sr, subtype="PCM_16")


class AudioOpsTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="voxlab-audio-")
        self.a = os.path.join(self.dir, "a.wav")
        self.b = os.path.join(self.dir, "b.wav")
        _tone(self.a, 1.0, 24000)
        _tone(self.b, 0.5, 44100, 660.0)

    def test_sequential_with_gap_and_resample(self):
        out = os.path.join(self.dir, "sub", "master.wav")  # missing folder is created
        r = audio_ops.assemble("audio.assemble", {
            "inputs": [{"path": self.a, "gapAfterMs": 250}, {"path": self.b}],
            "outputPath": out, "format": "wav"}, _Ctx())
        self.assertEqual(r["sampleRate"], 44100)
        self.assertAlmostEqual(r["durationSec"], 1.75, places=2)
        self.assertAlmostEqual(r["segments"][1]["startSec"], 1.25, places=3)
        data, sr = sf.read(out)
        self.assertEqual(sr, 44100)
        self.assertAlmostEqual(len(data) / sr, 1.75, places=2)
        self.assertLess(np.abs(data[int(1.05 * sr):int(1.2 * sr)]).max(), 1e-4)  # gap is silence
        self.assertGreater(np.abs(data[: sr // 2]).max(), 0.4)                    # real samples, not zeros
        self.assertEqual([f for f in os.listdir(os.path.dirname(out)) if ".tmp" in f], [])

    def test_mp3_is_real_and_decodable(self):
        out = os.path.join(self.dir, "master.mp3")
        audio_ops.assemble("audio.assemble", {"inputs": [{"path": self.a}], "outputPath": out, "format": "mp3"}, _Ctx())
        with open(out, "rb") as f:
            head = f.read(3)
        self.assertTrue(head == b"ID3" or head[0] == 0xFF)
        data, sr = sf.read(out)  # libsndfile MP3 decoder: fails on fake bitstreams
        self.assertEqual(sr, 44100)
        self.assertAlmostEqual(len(data) / sr, 1.0, delta=0.1)
        spectrum = np.abs(np.fft.rfft(data[:sr]))
        self.assertAlmostEqual(np.argmax(spectrum) * sr / (2 * (len(spectrum) - 1)), 440, delta=5)

    def test_timeline_places_clips_at_start_times(self):
        out = os.path.join(self.dir, "dub.wav")
        r = audio_ops.assemble("audio.assemble", {
            "mode": "timeline", "totalDurationSec": 4.0,
            "inputs": [{"path": self.a, "startSec": 0.5}, {"path": self.b, "startSec": 2.0}],
            "outputPath": out, "format": "wav"}, _Ctx())
        self.assertAlmostEqual(r["durationSec"], 4.0, places=2)
        data, sr = sf.read(out)
        self.assertLess(np.abs(data[: int(0.45 * sr)]).max(), 1e-4)
        self.assertGreater(np.abs(data[int(0.6 * sr):int(1.4 * sr)]).max(), 0.4)
        self.assertAlmostEqual(r["segments"][1]["startSec"], 2.0, places=3)

    def test_missing_input_is_structured_error(self):
        with self.assertRaises(SidecarError) as cm:
            audio_ops.assemble("audio.assemble", {"inputs": [{"path": os.path.join(self.dir, "nope.wav")}],
                                                  "outputPath": os.path.join(self.dir, "x.wav")}, _Ctx())
        self.assertEqual(cm.exception.code, "INPUT_NOT_FOUND")

    def test_probe(self):
        r = audio_ops.probe({"path": self.b})
        self.assertEqual(r["sampleRate"], 44100)
        self.assertAlmostEqual(r["durationSec"], 0.5, places=3)

    def test_prepare_clone_reference_short_preserves_file(self):
        p, txt = audio_ops.prepare_clone_reference(self.a, ref_text="User Text", max_duration=10.0)
        self.assertEqual(p, self.a)
        self.assertEqual(txt, "User Text")

    def test_prepare_clone_reference_long_auto_trims(self):
        # Create a 15-second audio: tone from 0-4s, silence from 4-6s, tone from 6-15s
        long_wav = os.path.join(self.dir, "long.wav")
        sr = 16000
        samples = np.zeros(15 * sr, dtype=np.float32)
        # Tone in 0-4s
        t1 = np.arange(4 * sr) / sr
        samples[: 4 * sr] = 0.5 * np.sin(2 * np.pi * 440.0 * t1)
        # Silence in 4-6s (samples already zero)
        # Tone in 6-15s
        t2 = np.arange(9 * sr) / sr
        samples[6 * sr :] = 0.5 * np.sin(2 * np.pi * 440.0 * t2)
        sf.write(long_wav, samples, sr)

        trimmed_path, _txt = audio_ops.prepare_clone_reference(long_wav, ref_text="", max_duration=10.0)
        self.assertNotEqual(trimmed_path, long_wav)
        self.assertTrue(os.path.isfile(trimmed_path))
        info = sf.info(trimmed_path)
        # Sliced cleanly in the silence window between 4.5s and 8.5s
        self.assertGreaterEqual(info.duration, 4.0)
        self.assertLessEqual(info.duration, 8.5)

    def test_normalize_spoken_text_for_tts_version_numbers_vs_quantities_and_specs(self):
        from voxlab_sidecar.tts.service import normalize_spoken_text_for_tts

        src = (
            "Can the Tesla Powerwall 3 and Tesla Model 3 beat NEM 3.0 in 2026? "
            "A single Powerwall 3 stores 13.5 kWh, costs $10,000 for 3 years, "
            "and [B EY1 S] BOT is preserved."
        )
        normalized = normalize_spoken_text_for_tts(src, language="en", engine="omnivoice")
        self.assertIn("Tesla Powerwall three", normalized)
        self.assertIn("Tesla Model three", normalized)
        self.assertIn("NEM three point zero", normalized)
        self.assertIn("A single Powerwall three stores", normalized)
        # Must NOT convert years, technical specs with units, currencies, or time quantities
        self.assertIn("in 2026?", normalized)
        self.assertIn("13.5 kWh", normalized)
        self.assertIn("$10,000", normalized)
        self.assertIn("for 3 years", normalized)
        # Must preserve CMU pronunciation control tags and lowercase BOT
        self.assertIn("[B EY1 S] bot", normalized)

        # Vietnamese language support
        vi_src = "Pin Tesla Powerwall 3 và chính sách NEM 3.0 có dung lượng 13.5 kWh trong 3 năm."
        vi_norm = normalize_spoken_text_for_tts(vi_src, language="vi", engine="omnivoice")
        self.assertIn("Tesla Powerwall ba", vi_norm)
        self.assertIn("NEM ba chấm không", vi_norm)
        self.assertIn("13.5 kWh", vi_norm)
        self.assertIn("trong 3 năm", vi_norm)

    def test_leading_artifact_high_confidence_trimmed_with_hann_fade(self):
        sr = 24000
        samples = np.zeros(int(1.5 * sr), dtype=np.float32)
        # Isolated low-energy artifact at 0.14s - 0.21s (70ms, peak 0.015, low freq 180Hz)
        s_b0, s_b1 = int(0.14 * sr), int(0.21 * sr)
        t_b = np.arange(s_b1 - s_b0) / sr
        samples[s_b0:s_b1] = 0.015 * np.sin(2 * np.pi * 180.0 * t_b)
        # Silence valley at 0.21s - 0.25s (40ms)
        # Main speech starting at 0.25s - 1.25s (amplitude 0.35)
        s_m0, s_m1 = int(0.25 * sr), int(1.25 * sr)
        t_m = np.arange(s_m1 - s_m0) / sr
        samples[s_m0:s_m1] = 0.35 * np.sin(2 * np.pi * 220.0 * t_m)

        filtered, info = audio_ops.detect_and_filter_leading_artifact(samples, sr)
        self.assertEqual(info["action"], "trimmed")
        self.assertEqual(info["confidence"], "high")
        # Cut should occur around 0.225s (25ms lead-in before 0.25s onset)
        self.assertAlmostEqual(info["trimmedDurationSec"], 0.225, places=2)
        self.assertAlmostEqual(len(filtered) / sr, 1.5 - info["trimmedDurationSec"], places=3)
        # First sample of trimmed audio has Hann fade-in (starts at 0.0, no click)
        self.assertAlmostEqual(float(filtered[0]), 0.0, places=5)
        # Main speech amplitude is intact
        self.assertGreater(float(np.max(np.abs(filtered))), 0.34)

    def test_leading_consonant_or_ambiguous_burst_never_clipped(self):
        sr = 24000
        # Case 1: Attached initial consonant at 0.20s - 0.25s flowing directly into vowel at 0.25s
        attached = np.zeros(int(1.2 * sr), dtype=np.float32)
        s_c0, s_m0, s_m1 = int(0.20 * sr), int(0.25 * sr), int(1.0 * sr)
        t_c = np.arange(s_m0 - s_c0) / sr
        attached[s_c0:s_m0] = 0.03 * np.sin(2 * np.pi * 300.0 * t_c)
        t_m = np.arange(s_m1 - s_m0) / sr
        attached[s_m0:s_m1] = 0.35 * np.sin(2 * np.pi * 220.0 * t_m)

        out_attached, info_attached = audio_ops.detect_and_filter_leading_artifact(attached, sr)
        self.assertEqual(info_attached["action"], "none")
        self.assertEqual(len(out_attached), len(attached))

        # Case 2: Ambiguous stronger pre-onset burst (relative RMS ~0.18 > 0.12 threshold) -> kept with warning
        ambiguous = np.zeros(int(1.2 * sr), dtype=np.float32)
        s_b0, s_b1 = int(0.14 * sr), int(0.21 * sr)
        t_b = np.arange(s_b1 - s_b0) / sr
        ambiguous[s_b0:s_b1] = 0.065 * np.sin(2 * np.pi * 250.0 * t_b)
        ambiguous[s_m0:s_m1] = 0.35 * np.sin(2 * np.pi * 220.0 * t_m)

        out_ambig, info_ambig = audio_ops.detect_and_filter_leading_artifact(ambiguous, sr)
        self.assertEqual(info_ambig["action"], "kept_with_warning")
        self.assertEqual(info_ambig["confidence"], "low")
        self.assertEqual(len(out_ambig), len(ambiguous))

    def test_normalize_internal_breath_seams_and_leading_breath_compensation(self):
        sr = 24000
        # 3.0s waveform:
        # - 0.00s - 1.00s: voiced speech (0.35 amp)
        # - 1.00s - 1.80s: 800ms pause seam containing:
        #   * 1.00s - 1.05s: trailing exhale (0.02 amp)
        #   * 1.05s - 1.60s: 550ms dead silence (0.0 amp)
        #   * 1.60s - 1.77s: pre-speech inhale breath (0.025 amp)
        #   * 1.77s - 1.80s: initial consonant onset (0.035 amp)
        # - 1.80s - 3.00s: voiced speech (0.35 amp)
        samples = np.zeros(int(3.0 * sr), dtype=np.float32)
        t_all = np.arange(len(samples)) / sr
        samples[: int(1.00 * sr)] = 0.35 * np.sin(2 * np.pi * 220.0 * t_all[: int(1.00 * sr)])
        samples[int(1.00 * sr) : int(1.05 * sr)] = 0.02 * np.sin(2 * np.pi * 300.0 * t_all[int(1.00 * sr) : int(1.05 * sr)])
        samples[int(1.60 * sr) : int(1.77 * sr)] = 0.025 * np.sin(2 * np.pi * 500.0 * t_all[int(1.60 * sr) : int(1.77 * sr)])
        samples[int(1.77 * sr) : int(1.80 * sr)] = 0.035 * np.sin(2 * np.pi * 800.0 * t_all[int(1.77 * sr) : int(1.80 * sr)])
        samples[int(1.80 * sr) :] = 0.35 * np.sin(2 * np.pi * 220.0 * t_all[int(1.80 * sr) :])

        out, info = audio_ops.normalize_internal_breath_seams(samples, sr)
        self.assertGreater(info["compactedMs"], 300.0)
        self.assertEqual(info["attenuatedBreaths"], 1)
        self.assertLess(len(out) / sr, 2.65)
        # Main speech amplitude preserved intact
        self.assertGreater(float(np.max(np.abs(out[: int(0.8 * sr)]))), 0.34)
        self.assertGreater(float(np.max(np.abs(out[-int(0.8 * sr) :]))), 0.34)

    def test_resample_numpy_fallback_when_scipy_missing(self):
        from unittest import mock

        sr_in, sr_out = 24000, 44100
        t = np.arange(sr_in, dtype=np.float32) / sr_in
        sine = (0.5 * np.sin(2 * np.pi * 440.0 * t)).astype(np.float32)
        with mock.patch.dict(sys.modules, {"scipy": None, "scipy.signal": None}):
            y = audio_ops._resample(sine, sr_in, sr_out)
        self.assertEqual(y.dtype, np.float32)
        self.assertEqual(len(y), sr_out)
        spectrum = np.abs(np.fft.rfft(y))
        peak_hz = np.argmax(spectrum) * sr_out / (2 * (len(spectrum) - 1))
        self.assertAlmostEqual(peak_hz, 440.0, delta=2.0)

    def test_split_tts_chunk_by_major_punctuation_protects_numbers_abbreviations_and_versions(self):
        text = (
            "First sentence in the U.S. costs $10,000 today. "
            "Is NEM 3.0 worth 13.5 kWh at 10:30? "
            "Dr. Smith explained [B EY1 S] clearly: rent the robot; never buy outright."
        )
        parts = audio_ops.split_tts_chunk_by_major_punctuation(text)
        self.assertEqual(
            parts,
            [
                ("First sentence in the U.S. costs $10,000 today.", "period"),
                ("Is NEM 3.0 worth 13.5 kWh at 10:30?", "questionExclamation"),
                ("Dr. Smith explained [B EY1 S] clearly:", "colonSemicolon"),
                ("rent the robot;", "colonSemicolon"),
                ("never buy outright.", ""),
            ],
        )

    def test_stitch_tts_segments_with_pauses_and_preserve_configured_breath_seams(self):
        sr = 24000
        t = np.arange(int(0.45 * sr), dtype=np.float32) / sr
        # Clip 1 has 50ms trailing silence; Clip 2 has 40ms leading silence
        voice_burst = (0.35 * np.sin(2 * np.pi * 220.0 * t)).astype(np.float32)
        clip1 = np.concatenate([voice_burst, np.zeros(int(0.05 * sr), dtype=np.float32)])
        clip2 = np.concatenate([np.zeros(int(0.04 * sr), dtype=np.float32), voice_burst])

        stitched_short = audio_ops.stitch_tts_segments_with_pauses(
            [clip1, clip2],
            sr,
            ["period", ""],
            {"comma": 0.2, "period": 0.25, "questionExclamation": 0.5, "colonSemicolon": 0.4},
        )
        stitched_long = audio_ops.stitch_tts_segments_with_pauses(
            [clip1, clip2],
            sr,
            ["period", ""],
            {"comma": 0.2, "period": 0.85, "questionExclamation": 0.5, "colonSemicolon": 0.4},
        )
        # Total pause should differ by ~0.60s (0.85s - 0.25s)
        self.assertAlmostEqual((len(stitched_long) - len(stitched_short)) / sr, 0.60, delta=0.03)
        # Preserved when normalize_internal_breath_seams is given max_allowed_pause_sec >= 0.95
        preserved, seam_info = audio_ops.normalize_internal_breath_seams(
            stitched_long, sr, max_allowed_pause_sec=1.0
        )
        self.assertEqual(seam_info["compactedMs"], 0.0)
        self.assertEqual(len(preserved), len(stitched_long))

    def test_enforce_punctuation_pauses_shapes_clause_comma_updates_cache_and_passes_qc(self):
        from voxlab_sidecar import audio_quality

        sr = 24000
        text = "When stiff knees make hauling laundry impossible, families face a brutal financial trap."
        word_specs = [
            ("When", 0.18), ("stiff", 0.20), ("knees", 0.22), ("make", 0.18),
            ("hauling", 0.24), ("laundry", 0.26), ("impossible,", 0.36),
            ("families", 0.28), ("face", 0.20), ("a", 0.10),
            ("brutal", 0.22), ("financial", 0.28), ("trap.", 0.28),
        ]
        pieces = [np.zeros(int(0.08 * sr), dtype=np.float32)]
        cursor = 0.08
        asr_words = []
        for idx, (w_txt, dur_s) in enumerate(word_specs):
            n = int(round(dur_s * sr))
            t = np.arange(n, dtype=np.float32) / sr
            # Smooth syllable envelope with continuous non-zero speech across rushed comma
            env = 0.35 + 0.65 * np.sin(np.pi * np.linspace(0.08, 0.92, n, dtype=np.float32))
            seg = (0.30 * env * np.sin(2 * np.pi * (190.0 + 7.0 * idx) * t)).astype(np.float32)
            pieces.append(seg)
            asr_words.append({
                "word": " " + w_txt,
                "startSec": round(cursor, 3),
                "endSec": round(cursor + n / sr, 3),
                "probability": 0.99,
            })
            cursor += n / sr
        pieces.append(np.zeros(int(0.10 * sr), dtype=np.float32))
        rushed_wave = np.concatenate(pieces)
        wav_path = os.path.join(self.dir, "rushed_comma.wav")
        sf.write(wav_path, rushed_wave, sr, subtype="PCM_16")

        # Before shaping: rushed clause comma is flagged
        pre_issues = audio_quality.detect_skipped_clause_pauses(text, asr_words, rushed_wave, sr)
        self.assertEqual([i["words"] for i in pre_issues], [["impossible", "families"]])

        orig_dur = len(rushed_wave) / sr
        res = audio_ops.enforce_punctuation_pauses(
            "audio.enforce_punctuation_pauses",
            {
                "audioPath": wav_path,
                "text": text,
                "language": "en",
                "speed": 1.0,
                "modelId": "large-v3-turbo",
                "punctuationPauses": {
                    "comma": 0.38,
                    "period": 0.60,
                    "questionExclamation": 0.50,
                    "colonSemicolon": 0.40,
                },
                "_precomputedAsrWords": asr_words,
            },
            _Ctx(),
        )
        self.assertTrue(res["shaped"])
        self.assertAlmostEqual(res["durationSec"] - orig_dur, 0.38, delta=0.04)

        shaped_wave, shaped_sr = sf.read(wav_path, dtype="float32")
        self.assertEqual(shaped_sr, sr)
        orig_max_step = float(np.max(np.abs(np.diff(rushed_wave))))
        shaped_max_step = float(np.max(np.abs(np.diff(shaped_wave))))
        self.assertLessEqual(shaped_max_step, orig_max_step + 1e-3)

        cached_words = audio_quality.get_cached_primary_asr_words(wav_path, "large-v3-turbo", "en")
        self.assertIsNotNone(cached_words)
        assert cached_words is not None
        # Verify ultra-smooth raised-cosine transition across the inserted comma silence (zero click/pop)
        seam_s = max(0, int((cached_words[6]["endSec"] - 0.03) * sr))
        seam_e = min(len(shaped_wave), int((cached_words[7]["startSec"] + 0.03) * sr))
        self.assertLess(float(np.max(np.abs(np.diff(shaped_wave[seam_s:seam_e])))), 0.05)
        # Comma gap between 'impossible,' (index 6) and 'families' (index 7) is now ~0.38s
        gap_after_comma = cached_words[7]["startSec"] - cached_words[6]["endSec"]
        self.assertAlmostEqual(gap_after_comma, 0.38, delta=0.05)

        # Post-shaping QC checks pass with 0 warnings!
        self.assertEqual(audio_quality.detect_skipped_clause_pauses(text, cached_words, shaped_wave, sr), [])
        self.assertEqual(audio_quality.detect_phrase_internal_pauses(text, cached_words, shaped_wave, sr), [])

    def test_enforce_punctuation_pauses_live_asr_path_and_bcp47_locale(self):
        from types import SimpleNamespace
        from unittest.mock import patch
        from voxlab_sidecar import audio_quality

        sr = 24000
        text = "Wait, listen closely."
        t_word = np.linspace(0.0, 0.25, int(0.25 * sr), endpoint=False, dtype=np.float32)
        fade = int(0.01 * sr)
        seg = (0.20 * np.sin(2 * np.pi * 200.0 * t_word)).astype(np.float32)
        seg[:fade] *= np.linspace(0.0, 1.0, fade, dtype=np.float32)
        seg[-fade:] *= np.linspace(1.0, 0.0, fade, dtype=np.float32)
        wave = np.concatenate([
            np.zeros(int(0.05 * sr), dtype=np.float32),
            seg,
            seg,
            seg,
            np.zeros(int(0.08 * sr), dtype=np.float32),
        ])
        wav_path = os.path.join(self.dir, "live_asr_comma.wav")
        sf.write(wav_path, wave, sr, subtype="PCM_16")

        captured_lang: list[str | None] = []

        class _FakeWhisper:
            def transcribe(self, _path, language=None, **_kwargs):
                captured_lang.append(language)
                words = [
                    SimpleNamespace(word=" Wait,", start=0.05, end=0.30, probability=0.98),
                    SimpleNamespace(word=" listen", start=0.30, end=0.55, probability=0.98),
                    SimpleNamespace(word=" closely.", start=0.55, end=0.80, probability=0.98),
                ]
                return [SimpleNamespace(words=words)], SimpleNamespace(language="en")

        class _FakeMgr:
            current_model_id = "faster-whisper-large-v3-turbo"

            def get_or_load(self, **_kwargs):
                return _FakeWhisper()

        with (
            patch("voxlab_sidecar.asr_engine.resolve_whisper_model_dir", return_value=(self.dir, "large-v3-turbo")),
            patch("voxlab_sidecar.asr_engine.AsrLifecycleManager.get_instance", return_value=_FakeMgr()),
        ):
            res = audio_ops.enforce_punctuation_pauses(
                "audio.enforce_punctuation_pauses",
                {
                    "audioPath": wav_path,
                    "text": text,
                    "language": "en-US",
                    "speed": 1.0,
                    "modelsDir": self.dir,
                    "modelId": "large-v3-turbo",
                    "punctuationPauses": {
                        "comma": 0.40,
                        "period": 0.60,
                        "questionExclamation": 0.50,
                        "colonSemicolon": 0.40,
                    },
                },
                _Ctx(),
            )

        self.assertTrue(res["shaped"])
        self.assertEqual(captured_lang, ["en"])
        cached = audio_quality.get_cached_primary_asr_words(wav_path, "faster-whisper-large-v3-turbo", "en")
        self.assertIsNotNone(cached)

    def test_shape_internal_pauses_maps_mixed_trim_and_insert_timestamps(self):
        sr = 24000
        # Two chunks concatenated: speech1 [0.0..0.5], long gap1 [0.5..1.5] (1.0s trimmed to ~0.35s),
        # speech2 [1.5..2.0], short gap2 [2.0..2.1] (0.1s extended to ~0.50s), speech3 [2.1..2.6]
        t_sp = np.linspace(0, 0.5, int(0.5 * sr), endpoint=False, dtype=np.float32)
        sp = 0.25 * np.sin(2 * np.pi * 220.0 * t_sp)
        audio = np.concatenate([
            sp,
            np.zeros(int(1.0 * sr), dtype=np.float32),
            sp,
            np.zeros(int(0.1 * sr), dtype=np.float32),
            sp,
        ])
        asr_words = [
            {"word": "First,", "startSec": 0.0, "endSec": 0.5, "probability": 0.99},
            {"word": "second?", "startSec": 1.5, "endSec": 2.0, "probability": 0.99},
            {"word": "Third.", "startSec": 2.1, "endSec": 2.6, "probability": 0.99},
        ]
        shaped, updated_words, edits = audio_ops.shape_internal_punctuation_pauses(
            audio,
            sr,
            "First, second? Third.",
            {"comma": 0.35, "period": 0.55, "questionExclamation": 0.50, "colonSemicolon": 0.40},
            asr_words,
        )
        self.assertGreaterEqual(len(edits), 2)
        # First word untouched, second word shifted left by trim, third word shifted net left+insert
        self.assertAlmostEqual(updated_words[0]["startSec"], 0.0, places=2)
        self.assertLess(updated_words[1]["startSec"], 1.0)
        gap2 = updated_words[2]["startSec"] - updated_words[1]["endSec"]
        self.assertGreaterEqual(gap2, 0.45)
        self.assertLessEqual(updated_words[2]["endSec"], shaped.size / sr + 0.02)

    def test_detect_leading_artifact_preserves_initial_sibilant_cluster_like_speaking(self):
        sr = 24000
        rng = np.random.default_rng(42)

        def _make_speaking_opening(with_clean_click: bool) -> np.ndarray:
            total_n = int(1.15 * sr)
            sig = (rng.normal(0.0, 1e-5, total_n)).astype(np.float32)
            if with_clean_click:
                # Genuine 30ms low-ZCR click at 0.05-0.08s followed by pure silence 0.08-0.44s
                t_c = np.arange(int(0.03 * sr), dtype=np.float32) / sr
                sig[int(0.05 * sr) : int(0.08 * sr)] = 0.015 * np.sin(2 * np.pi * 650.0 * t_c)
            else:
                # Soft inhale breath at 0.19-0.33s with a brief 10ms dip at 0.21s (Chunk #47 profile)
                t_b1 = np.arange(int(0.02 * sr), dtype=np.float32) / sr
                sig[int(0.19 * sr) : int(0.21 * sr)] = 0.0055 * np.sin(2 * np.pi * 550.0 * t_b1)
                sig[int(0.21 * sr) : int(0.22 * sr)] *= 0.2
                t_b2 = np.arange(int(0.11 * sr), dtype=np.float32) / sr
                sig[int(0.22 * sr) : int(0.33 * sr)] = 0.0062 * np.sin(2 * np.pi * 620.0 * t_b2)

            # Initial /s/ of "Speaking" at 0.44-0.54s (~ -42 dB, high ZCR ~ 0.55)
            n_s = int(0.10 * sr)
            t_s = np.arange(n_s, dtype=np.float32) / sr
            sib = 0.0095 * (
                0.65 * np.sin(2 * np.pi * 6600.0 * t_s)
                + 0.35 * np.sin(2 * np.pi * 7900.0 * t_s + 0.7)
            )
            sig[int(0.44 * sr) : int(0.44 * sr) + n_s] = sib.astype(np.float32)
            # /p/ stop closure at 0.54-0.60s remains near digital silence
            # Main vowel /i:/ at 0.61-1.05s (peak ~ 0.85, RMS ~ 0.22)
            n_v = int(0.44 * sr)
            t_v = np.arange(n_v, dtype=np.float32) / sr
            sig[int(0.61 * sr) : int(0.61 * sr) + n_v] = (
                0.32 * np.sin(2 * np.pi * 190.0 * t_v)
                + 0.50 * np.sin(2 * np.pi * 380.0 * t_v)
            ).astype(np.float32)
            return sig

        for with_click in (False, True):
            raw = _make_speaking_opening(with_click)
            out, info = audio_ops.detect_and_filter_leading_artifact(raw, sr)
            trimmed_sec = float(info.get("trimmedDurationSec") or 0.0) if info.get("action") == "trimmed" else 0.0
            # Must NEVER trim into /s/ starting at 0.44s (keep >= 20ms lead-in before 0.44s)
            self.assertLessEqual(
                trimmed_sec,
                0.420,
                f"Trimmed across initial /s/ consonant (with_click={with_click}): {info}",
            )
            # Verify /s/ energy right before the 60ms /p/ closure + 0.61s vowel is 100% intact
            orig_sib = raw[int(0.44 * sr) : int(0.54 * sr)]
            orig_sib_rms = float(np.sqrt(np.mean(orig_sib ** 2)))
            s_loc = int(round((0.44 - trimmed_sec) * sr))
            sib_post = out[s_loc : s_loc + int(0.10 * sr)]
            sib_rms = float(np.sqrt(np.mean(sib_post ** 2)))
            self.assertAlmostEqual(sib_rms, orig_sib_rms, delta=1e-4)

    def test_assemble_reports_exact_leading_trim_and_internal_compaction_cuts(self):
        sr = 24000
        # Build chunk with:
        # - isolated high-confidence 30ms click at 0.05-0.08s
        # - pure silence 0.08-0.44s
        # - word 1 ("Lower") at 0.44-0.84s
        # - oversized 0.80s dead-silence seam at 0.84-1.64s (compacted to ~0.38s)
        # - word 2 ("bills") at 1.64-2.04s (distinct 440 Hz tone so we can measure exact onset in output)
        total_n = int(2.14 * sr)
        sig = np.zeros(total_n, dtype=np.float32)
        t_c = np.arange(int(0.03 * sr), dtype=np.float32) / sr
        sig[int(0.05 * sr) : int(0.08 * sr)] = 0.014 * np.sin(2 * np.pi * 600.0 * t_c)
        t_w = np.arange(int(0.40 * sr), dtype=np.float32) / sr
        sig[int(0.44 * sr) : int(0.84 * sr)] = 0.30 * np.sin(2 * np.pi * 180.0 * t_w)
        sig[int(1.64 * sr) : int(2.04 * sr)] = 0.32 * np.sin(2 * np.pi * 440.0 * t_w)

        c0_path = os.path.join(self.dir, "c0_trim_and_seam.wav")
        out_path = os.path.join(self.dir, "master_out.wav")
        sf.write(c0_path, sig, sr, subtype="PCM_16")

        res = audio_ops.assemble(
            "audio.assemble",
            {
                "inputs": [{"path": c0_path, "gapAfterMs": 0}],
                "outputPath": out_path,
                "format": "wav",
                "mode": "sequential",
                "sampleRate": 44100,
            },
            _Ctx(),
        )
        seg0 = res["segments"][0]
        self.assertGreater(seg0.get("leadingTrimSec", 0.0), 0.35)
        cuts = seg0.get("compactedCuts") or []
        self.assertGreaterEqual(len(cuts), 1)

        # Map original pre-assembly word2 start (1.64s) through leadingTrimSec + compactedCuts
        t1 = max(0.0, 1.64 - float(seg0["leadingTrimSec"]))
        shift = 0.0
        for cut in cuts:
            if t1 <= cut["startSec"]:
                break
            elif t1 >= cut["endSec"]:
                shift += cut["removedSec"]
            else:
                shift += t1 - cut["startSec"]
                break
        mapped_w2_start = seg0["startSec"] + max(0.0, t1 - shift)

        # Measure actual onset of word 2 (second loud island) in master_out.wav
        master_wav, master_sr = sf.read(out_path, dtype="float32")
        env = np.abs(master_wav)
        # Word 1 ends around 0.425s; search after 0.55s for Word 2 onset
        s_search = int(0.55 * master_sr)
        w2_idx = s_search + int(np.argmax(env[s_search:] > 0.05))
        actual_w2_start = w2_idx / master_sr
        self.assertAlmostEqual(mapped_w2_start, actual_w2_start, delta=0.010)

    def test_shape_internal_pauses_lexical_boundary_conservation_prevents_mid_word_cuts(self):
        from types import SimpleNamespace

        sr = 24000

        def _seg_tone(dur_s: float, freq: float, amp: float = 0.24) -> np.ndarray:
            n = int(round(dur_s * sr))
            t = np.arange(n, dtype=np.float32) / sr
            env = np.ones(n, dtype=np.float32)
            fade = min(n // 4, int(0.008 * sr))
            if fade > 1:
                env[:fade] = np.linspace(0.05, 1.0, fade, dtype=np.float32)
                env[-fade:] = np.linspace(1.0, 0.05, fade, dtype=np.float32)
            return (amp * env * np.sin(2 * np.pi * freq * t)).astype(np.float32)

        # Case 1: Early DTW endSec ("more acceleration, so" where Whisper snapped e1 onto intra-word /t/ before "-tion")
        # Timeline:
        # [0.00..0.10] silence | [0.10..0.38] "more" (190Hz) | [0.38..0.90] "accelerat-" (220Hz)
        # | [0.90..0.935] intra-word /t/ stop closure (0.0) | [0.935..1.18] "-tion" (330Hz)
        # | [1.18..1.195] true inter-word dip (amp=0.004) | [1.195..1.48] "so" (440Hz) | [1.48..1.60] silence
        wave1 = np.concatenate([
            np.zeros(int(0.10 * sr), dtype=np.float32),
            _seg_tone(0.28, 190.0),
            _seg_tone(0.52, 220.0),
            np.zeros(int(0.035 * sr), dtype=np.float32),
            _seg_tone(0.245, 330.0),
            np.full(int(0.015 * sr), 0.002, dtype=np.float32),
            _seg_tone(0.285, 440.0),
            np.zeros(int(0.12 * sr), dtype=np.float32),
        ])
        skewed_asr1 = [
            {"word": " more", "startSec": 0.10, "endSec": 0.38, "probability": 0.99},
            {"word": " acceleration,", "startSec": 0.38, "endSec": 0.91, "probability": 0.99},
            {"word": " so", "startSec": 0.91, "endSec": 1.48, "probability": 0.99},
        ]

        class _AcousticAwareMockWhisper1:
            """Inspects actual frequency bands on either side of any inserted zero-silence run."""

            def transcribe(self, wav_path, **_kw):
                arr, s_rate = sf.read(wav_path, dtype="float32")
                # Locate inserted >= 150ms zero run inside the slice (excluding 0.20s outer padding)
                pad_n = int(0.18 * s_rate)
                core = arr[pad_n : len(arr) - pad_n] if len(arr) > 2 * pad_n else arr
                z = np.abs(core) < 1e-6
                ed = np.where(np.diff(np.concatenate(([0], z.astype(int), [0]))) != 0)[0].reshape(-1, 2)
                big_z = [(a + pad_n, b + pad_n) for a, b in ed if (b - a) >= int(0.15 * s_rate)]
                if not big_z:
                    return [SimpleNamespace(words=[])], None
                za, zb = big_z[0]
                right_seg = arr[zb : min(len(arr) - pad_n, zb + int(0.18 * s_rate))]
                # Check dominant frequency right after the inserted pause:
                # 330 Hz means "-tion" was severed onto the right side; 440 Hz means clean "so"!
                mag = np.abs(np.fft.rfft(right_seg))
                freqs = np.fft.rfftfreq(len(right_seg), 1.0 / s_rate)
                dom_f = float(freqs[int(np.argmax(mag))]) if len(mag) > 0 else 0.0
                if 280.0 <= dom_f <= 380.0:
                    # Cut happened at 0.91s inside "acceleration": "-tion" is orphaned before "so" (low prob)!
                    return [
                        SimpleNamespace(
                            words=[
                                SimpleNamespace(word=" acceleration,", start=0.25, end=round(za / s_rate - 0.05, 3), probability=0.95),
                                SimpleNamespace(word=" so", start=round(zb / s_rate + 0.26, 3), end=round(zb / s_rate + 0.52, 3), probability=0.36),
                            ]
                        )
                    ], None
                return [
                    SimpleNamespace(
                        words=[
                            SimpleNamespace(word=" more", start=0.20, end=0.45, probability=0.98),
                            SimpleNamespace(word=" acceleration,", start=0.45, end=round(za / s_rate, 3), probability=0.98),
                            SimpleNamespace(word=" so", start=round(zb / s_rate, 3), end=round(zb / s_rate + 0.28, 3), probability=0.98),
                        ]
                    )
                ], None

        shaped1, upd1, edits1 = audio_ops.shape_internal_punctuation_pauses(
            wave1,
            sr,
            "more acceleration, so",
            {"comma": 0.30, "period": 0.60, "questionExclamation": 0.50, "colonSemicolon": 0.40},
            skewed_asr1,
            whisper_model=_AcousticAwareMockWhisper1(),
            lang_code="en",
        )
        self.assertEqual(len(edits1), 1, f"Expected clean relocated cut at ~1.188s, got {edits1}")
        cut_sec_1 = edits1[0]["cutIdx"] / sr
        self.assertGreater(
            cut_sec_1,
            1.14,
            f"Cut at {cut_sec_1:.3f}s severed '-tion' inside 'acceleration' instead of cutting at ~1.188s!",
        )
        self.assertGreaterEqual(upd1[1]["endSec"], 1.14)

        # Case 2: Late DTW endSec ("table, according" where Whisper snapped e1 onto /k/ stop closure of "ac-cording")
        # [0.10..0.52] "table" (200Hz) | [0.52..0.535] true inter-word dip | [0.535..0.67] "a-" (310Hz)
        # | [0.67..0.705] intra-word /k/ closure (0.0) | [0.705..1.15] "-ccording" (240Hz)
        wave2 = np.concatenate([
            np.zeros(int(0.10 * sr), dtype=np.float32),
            _seg_tone(0.42, 200.0),
            np.full(int(0.015 * sr), 0.002, dtype=np.float32),
            _seg_tone(0.135, 310.0),
            np.zeros(int(0.035 * sr), dtype=np.float32),
            _seg_tone(0.445, 240.0),
            np.zeros(int(0.12 * sr), dtype=np.float32),
        ])
        skewed_asr2 = [
            {"word": " table,", "startSec": 0.10, "endSec": 0.68, "probability": 0.99},
            {"word": " according", "startSec": 0.68, "endSec": 1.15, "probability": 0.99},
        ]

        class _AcousticAwareMockWhisper2:
            def transcribe(self, wav_path, **_kw):
                arr, s_rate = sf.read(wav_path, dtype="float32")
                pad_n = int(0.18 * s_rate)
                core = arr[pad_n : len(arr) - pad_n] if len(arr) > 2 * pad_n else arr
                z = np.abs(core) < 1e-6
                ed = np.where(np.diff(np.concatenate(([0], z.astype(int), [0]))) != 0)[0].reshape(-1, 2)
                big_z = [(a + pad_n, b + pad_n) for a, b in ed if (b - a) >= int(0.15 * s_rate)]
                if not big_z:
                    return [SimpleNamespace(words=[])], None
                za, zb = big_z[0]
                left_tail = arr[max(pad_n, za - int(0.12 * s_rate)) : za]
                mag = np.abs(np.fft.rfft(left_tail))
                freqs = np.fft.rfftfreq(len(left_tail), 1.0 / s_rate)
                dom_f = float(freqs[int(np.argmax(mag))]) if len(mag) > 0 else 0.0
                if 270.0 <= dom_f <= 350.0:
                    # Cut happened at 0.68s inside "ac-cording": "according" spans across [za, zb]!
                    return [
                        SimpleNamespace(
                            words=[
                                SimpleNamespace(word=" table", start=0.20, end=round(za / s_rate - 0.15, 3), probability=0.98),
                                SimpleNamespace(word=" according", start=round(za / s_rate - 0.13, 3), end=round(zb / s_rate + 0.44, 3), probability=0.78),
                            ]
                        )
                    ], None
                return [
                    SimpleNamespace(
                        words=[
                            SimpleNamespace(word=" table,", start=0.20, end=round(za / s_rate, 3), probability=0.98),
                            SimpleNamespace(word=" according", start=round(zb / s_rate, 3), end=round(zb / s_rate + 0.60, 3), probability=0.98),
                        ]
                    )
                ], None

        _, _, edits2 = audio_ops.shape_internal_punctuation_pauses(
            wave2,
            sr,
            "table, according",
            {"comma": 0.30, "period": 0.60, "questionExclamation": 0.50, "colonSemicolon": 0.40},
            skewed_asr2,
            whisper_model=_AcousticAwareMockWhisper2(),
            lang_code="en",
        )
        self.assertEqual(len(edits2), 1, f"Expected clean relocated cut at ~0.528s, got {edits2}")
        cut_sec_2 = edits2[0]["cutIdx"] / sr
        self.assertLess(
            cut_sec_2,
            0.56,
            f"Cut at {cut_sec_2:.3f}s severed 'a-' inside 'according' instead of cutting at ~0.528s!",
        )

        # Case 3: Inseparably fused words where every candidate cut breaks lexical conservation -> skip safely!
        class _AlwaysBrokenMockWhisper:
            def transcribe(self, wav_path, **_kw):
                arr, s_rate = sf.read(wav_path, dtype="float32")
                return [
                    SimpleNamespace(
                        words=[
                            SimpleNamespace(word=" tableaccording", start=0.20, end=len(arr) / s_rate - 0.20, probability=0.42),
                        ]
                    )
                ], None

        shaped3, _, edits3 = audio_ops.shape_internal_punctuation_pauses(
            _seg_tone(1.20, 210.0),
            sr,
            "table, according",
            {"comma": 0.30, "period": 0.60, "questionExclamation": 0.50, "colonSemicolon": 0.40},
            [{"word": " table,", "startSec": 0.0, "endSec": 0.6, "probability": 0.99}, {"word": " according", "startSec": 0.6, "endSec": 1.2, "probability": 0.99}],
            whisper_model=_AlwaysBrokenMockWhisper(),
            lang_code="en",
        )
        self.assertEqual(edits3, [])
        self.assertEqual(len(shaped3), int(1.20 * sr))


if __name__ == "__main__":
    unittest.main()

