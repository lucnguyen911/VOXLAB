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


if __name__ == "__main__":
    unittest.main()

