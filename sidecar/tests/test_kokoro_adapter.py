"""Unit and integration tests for the pre-bundled Kokoro-82M ONNX TTS adapter."""
from __future__ import annotations

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from voxlab_sidecar.server import RequestContext
from voxlab_sidecar.tts import adapters_for_runtime
from voxlab_sidecar.tts.kokoro_adapter import (
    KokoroAdapter,
    _resolve_espeak_lang,
    _resolve_kokoro_voice,
    _split_kokoro_text,
    resolve_bundled_kokoro_dir,
)
from voxlab_sidecar.tts.service import TtsService


class KokoroAdapterTests(unittest.TestCase):
    def test_core_runtime_exposes_omnivoice_and_kokoro(self) -> None:
        adapters = adapters_for_runtime("core")
        engines = [a.capabilities.engine for a in adapters]
        self.assertIn("omnivoice", engines)
        self.assertIn("kokoro", engines)

    def test_resolve_bundled_kokoro_dir_finds_bundled_model(self) -> None:
        resolved = resolve_bundled_kokoro_dir("/nonexistent/user/models/kokoro-82m")
        self.assertTrue(os.path.isfile(os.path.join(resolved, "kokoro-v1.0.int8.onnx")))
        self.assertTrue(os.path.isfile(os.path.join(resolved, "voices-v1.0.bin")))

    def test_voice_and_lang_resolution(self) -> None:
        self.assertEqual(_resolve_kokoro_voice({"voiceId": "kokoro_af_heart"}), "af_heart")
        self.assertEqual(_resolve_kokoro_voice({"voice": "bm_george"}), "bm_george")
        self.assertEqual(_resolve_kokoro_voice({"voiceId": "unknown_voice_xyz"}), "af_heart")
        self.assertEqual(_resolve_espeak_lang("en", "af_heart"), "en-us")
        self.assertEqual(_resolve_espeak_lang("en", "bf_emma"), "en-gb")
        self.assertEqual(_resolve_espeak_lang("ja", "af_heart"), "ja")

    def test_split_kokoro_text_respects_max_chars(self) -> None:
        long_text = (
            "Sentence one is short. " * 20
            + "And here is a final concluding sentence for Kokoro."
        )
        chunks = _split_kokoro_text(long_text, max_chars=200)
        self.assertGreater(len(chunks), 2)
        for ch in chunks:
            self.assertLessEqual(len(ch), 200)

    def test_end_to_end_load_and_synthesize_without_user_model_dir(self) -> None:
        svc = TtsService([KokoroAdapter()])
        writer = type("_W", (), {"progress": lambda *_a, **_kw: None})()
        ctx = RequestContext("test_kokoro", writer)
        load_res = svc.load(
            "tts.load",
            {
                "engine": "kokoro",
                "modelDir": "C:/NonExistentModelsDir/kokoro-82m",
                "device": "cpu",
            },
            ctx,
        )
        self.assertEqual(load_res["engine"], "kokoro")
        self.assertEqual(load_res["sampleRate"], 24000)

        with tempfile.TemporaryDirectory() as tmp:
            out_wav = os.path.join(tmp, "out.wav")
            synth_res = svc.synthesize(
                "tts.synthesize",
                {
                    "engine": "kokoro",
                    "voiceId": "kokoro_bf_emma",
                    "text": "Hello from the pre-bundled Kokoro eighty-two million model on VoxLab.",
                    "outputPath": out_wav,
                    "speed": 1.05,
                },
                ctx,
            )
            self.assertEqual(synth_res["engine"], "kokoro")
            self.assertGreater(synth_res["durationSec"], 1.5)
            self.assertTrue(os.path.isfile(out_wav))
            self.assertGreater(os.path.getsize(out_wav), 20000)


if __name__ == "__main__":
    unittest.main()
