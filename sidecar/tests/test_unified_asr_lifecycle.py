import os
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from voxlab_sidecar.asr_engine import (
    AsrLifecycleManager,
    AsrEngine,
    get_shared_whisper_model,
    resolve_whisper_model_dir,
    canonicalize_whisper_model_id,
)
from voxlab_sidecar.protocol import SidecarError


class UnifiedAsrLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.mgr = AsrLifecycleManager.get_instance()
        self.mgr.unload()

    def tearDown(self):
        self.mgr.unload()

    def test_canonicalize_whisper_model_id(self):
        self.assertEqual(canonicalize_whisper_model_id("large-v3-turbo"), "large-v3-turbo")
        self.assertEqual(canonicalize_whisper_model_id("faster-whisper-large-v3-turbo"), "large-v3-turbo")
        self.assertEqual(canonicalize_whisper_model_id("large-v3"), "large-v3")
        self.assertEqual(canonicalize_whisper_model_id("faster-whisper-large-v3"), "large-v3")
        self.assertEqual(canonicalize_whisper_model_id("medium"), "medium")
        self.assertEqual(canonicalize_whisper_model_id("faster-whisper-medium"), "medium")
        self.assertEqual(canonicalize_whisper_model_id("small"), "small")
        self.assertEqual(canonicalize_whisper_model_id("faster-whisper-small"), "small")
        self.assertEqual(canonicalize_whisper_model_id(""), "large-v3-turbo")
        self.assertEqual(canonicalize_whisper_model_id(None), "large-v3-turbo")

    def test_singleton_engine_and_shared_whisper_use_same_instance(self):
        mock_whisper = MagicMock()
        with patch("faster_whisper.WhisperModel", return_value=mock_whisper):
            with patch("voxlab_sidecar.asr_engine.resolve_whisper_model_dir", return_value=("/mock/model_dir", "large-v3-turbo")):
                with patch("os.path.isfile", return_value=True):
                    # Load via AsrEngine
                    engine = AsrEngine()
                    ctx = MagicMock()
                    res = engine.load("asr.load", {"modelDir": "/mock/model_dir"}, ctx)
                    self.assertEqual(res["modelId"], "large-v3-turbo")

                    # Access via get_shared_whisper_model
                    shared = get_shared_whisper_model(model_id="large-v3-turbo")
                    self.assertIs(shared, mock_whisper)
                    self.assertIs(engine._model, mock_whisper)
                    self.assertIs(self.mgr.current_model, mock_whisper)

    def test_model_reuse_with_zero_duplicate_loading(self):
        mock_whisper = MagicMock()
        with patch("faster_whisper.WhisperModel", return_value=mock_whisper) as mock_cls:
            with patch("voxlab_sidecar.asr_engine.resolve_whisper_model_dir", return_value=("/mock/model_dir", "large-v3-turbo")):
                with patch("os.path.isfile", return_value=True):
                    # First load
                    m1 = self.mgr.get_or_load(model_dir_or_id="large-v3-turbo")
                    # Second call with same model
                    m2 = self.mgr.get_or_load(model_dir_or_id="large-v3-turbo")
                    # Third call via helper
                    m3 = get_shared_whisper_model(model_id="large-v3-turbo")

                    self.assertIs(m1, mock_whisper)
                    self.assertIs(m2, mock_whisper)
                    self.assertIs(m3, mock_whisper)
                    # Constructor called exactly once!
                    self.assertEqual(mock_cls.call_count, 1)

    def test_explicit_unload_frees_model_and_clears_status(self):
        mock_whisper = MagicMock()
        with patch("faster_whisper.WhisperModel", return_value=mock_whisper):
            with patch("voxlab_sidecar.asr_engine.resolve_whisper_model_dir", return_value=("/mock/model_dir", "medium")):
                with patch("os.path.isfile", return_value=True):
                    self.mgr.get_or_load(model_dir_or_id="medium")
                    self.assertTrue(self.mgr.status()["loaded"])
                    self.assertEqual(self.mgr.status()["modelId"], "medium")

                    self.mgr.unload()
                    status = self.mgr.status()
                    self.assertFalse(status["loaded"])
                    self.assertIsNone(status["modelId"])
                    self.assertIsNone(status["modelDir"])
                    self.assertIsNone(self.mgr.current_model)

    def test_explicit_missing_model_raises_and_never_falls_back_to_small(self):
        with patch("voxlab_sidecar.asr_engine.resolve_whisper_model_dir", return_value=(None, "large-v3-turbo")):
            with self.assertRaises(SidecarError) as cm:
                self.mgr.get_or_load(model_dir_or_id="large-v3-turbo")
            self.assertEqual(cm.exception.code, "MODEL_NOT_FOUND")
            self.assertIn("large-v3-turbo", cm.exception.message)
            # Must NOT silently load small!
            self.assertIsNone(self.mgr.current_model)

    def test_validate_audio_quality_records_requested_asr_model(self):
        from voxlab_sidecar import audio_quality

        mock_whisper = MagicMock()
        mock_seg = MagicMock()
        mock_word1 = MagicMock(word="hello", start=0.1, end=0.4, probability=0.95)
        mock_word2 = MagicMock(word="world", start=0.5, end=0.9, probability=0.95)
        mock_seg.words = [mock_word1, mock_word2]
        mock_whisper.transcribe.return_value = ([mock_seg], MagicMock(duration=1.0))

        with patch("voxlab_sidecar.audio_quality.validate_audio_file", return_value=(True, [], {"durationSec": 1.0, "sampleRate": 24000})):
            with patch("voxlab_sidecar.asr_engine.resolve_whisper_model_dir", return_value=("/mock/dir", "large-v3-turbo")):
                with patch("voxlab_sidecar.asr_engine.get_shared_whisper_model", return_value=mock_whisper):
                    res = audio_quality.validate_audio_quality(
                        audio_path="test.wav",
                        text="Hello world",
                        model_id="large-v3-turbo",
                    )
                    self.assertEqual(res["asrModelId"], "large-v3-turbo")
                    self.assertEqual(res["status"], "pass")


if __name__ == "__main__":
    unittest.main()
