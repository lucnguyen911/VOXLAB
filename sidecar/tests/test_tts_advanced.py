"""Unit tests for Global Advanced TTS Settings in sidecar and TTS adapters."""
from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch
import numpy as np

from voxlab_sidecar.tts.base import Capabilities, SynthesisRequest
from voxlab_sidecar.tts.service import TtsService
from voxlab_sidecar.tts.omnivoice_adapter import OmniVoiceAdapter
from voxlab_sidecar.tts.chatterbox_adapter import ChatterboxAdapter
from voxlab_sidecar.tts.qwen_adapter import QwenTtsAdapter


class TestTtsServiceAdvancedSettings(unittest.TestCase):
    def test_service_forwards_advanced_settings_dict(self):
        # Create a mock adapter
        mock_adapter = MagicMock()
        mock_adapter.capabilities = Capabilities(
            engine="test_engine",
            display_name="Test Engine",
            model_id="test-model",
            supported_languages=("*",),
            supports_vietnamese=True,
            supports_voice_clone=False,
            reference_audio_required=False,
            reference_text_required=False,
            supports_cuda=True,
            supports_cpu=True,
            supports_speed=True,
            model_size_mb=100,
            sample_rate=24000,
        )
        mock_adapter.loaded = True
        mock_adapter.synthesize.return_value = (np.zeros(24000, dtype=np.float32), 24000)

        svc = TtsService([mock_adapter])
        svc._active = mock_adapter

        mock_ctx = MagicMock()
        mock_ctx.cancelled = False

        # Synthesize with advancedSettings dict
        params = {
            "engine": "test_engine",
            "text": "Hello world",
            "outputPath": "test_output.wav",
            "advancedSettings": {
                "num_step": 48,
                "guidance_scale": 3.0,
                "denoise": True,
            },
        }

        with patch("soundfile.write"), patch("os.replace"), patch("os.path.isdir", return_value=True):
            svc.synthesize("tts.synthesize", params, mock_ctx)

        # Check call arguments
        mock_adapter.synthesize.assert_called_once()
        req: SynthesisRequest = mock_adapter.synthesize.call_args[0][0]
        self.assertEqual(req.text, "Hello world")
        self.assertEqual(req.extra.get("num_step"), 48)
        self.assertEqual(req.extra.get("guidance_scale"), 3.0)
        self.assertEqual(req.extra.get("denoise"), True)


class TestOmniVoiceAdapterAdvancedSettings(unittest.TestCase):
    def test_omnivoice_parameters_and_clamping(self):
        adapter = OmniVoiceAdapter()
        mock_model = MagicMock()
        mock_model.sampling_rate = 24000
        mock_model.generate.return_value = [np.zeros(24000, dtype=np.float32)]
        adapter._model = mock_model

        req = SynthesisRequest(
            text="Kiểm tra âm thanh",
            extra={
                "num_step": 36,
                "guidance_scale": 2.5,
                "denoise": False,
                "position_temperature": 4.5,
                "class_temperature": 0.1,
                "postprocess_output": True,
            },
        )

        with patch("os.path.isfile", return_value=False):
            audio, sr = adapter.synthesize(req)

        self.assertEqual(sr, 24000)
        mock_model.generate.assert_called_once()
        kwargs = mock_model.generate.call_args[1]
        self.assertEqual(kwargs.get("num_step"), 36)
        self.assertEqual(kwargs.get("guidance_scale"), 2.5)
        self.assertEqual(kwargs.get("denoise"), False)
        self.assertEqual(kwargs.get("position_temperature"), 4.5)
        self.assertEqual(kwargs.get("class_temperature"), 0.1)
        self.assertEqual(kwargs.get("postprocess_output"), True)

    def test_omnivoice_clamping_out_of_bounds(self):
        adapter = OmniVoiceAdapter()
        mock_model = MagicMock()
        mock_model.sampling_rate = 24000
        mock_model.generate.return_value = [np.zeros(24000, dtype=np.float32)]
        adapter._model = mock_model

        req = SynthesisRequest(
            text="Kiểm tra âm thanh",
            extra={
                "num_step": 9999,  # clamped to 128
                "guidance_scale": 0.2,  # clamped to 1.0
                "position_temperature": 99.0,  # clamped to 20.0
                "class_temperature": -1.0,  # clamped to 0.0
            },
        )

        with patch("os.path.isfile", return_value=False):
            adapter.synthesize(req)

        kwargs = mock_model.generate.call_args[1]
        self.assertEqual(kwargs.get("num_step"), 128)
        self.assertEqual(kwargs.get("guidance_scale"), 1.0)
        self.assertEqual(kwargs.get("position_temperature"), 20.0)
        self.assertEqual(kwargs.get("class_temperature"), 0.0)


class TestChatterboxAdapterAdvancedSettings(unittest.TestCase):
    def test_chatterbox_turbo_parameters_and_clamping(self):
        adapter = ChatterboxAdapter()
        mock_model = MagicMock()
        mock_model.sr = 24000
        mock_model.generate.return_value = np.zeros(24000, dtype=np.float32)
        adapter._model = mock_model

        req = SynthesisRequest(
            text="Testing Chatterbox Turbo settings",
            extra={
                "temperature": 0.65,
                "top_p": 0.92,
                "top_k": 800,
                "repetition_penalty": 1.25,
                # These unsupported keys must be ignored
                "cfg_weight": 0.5,
                "exaggeration": 0.8,
            },
        )

        audio, sr = adapter.synthesize(req)
        self.assertEqual(sr, 24000)
        mock_model.generate.assert_called_once()
        kwargs = mock_model.generate.call_args[1]
        self.assertEqual(kwargs.get("temperature"), 0.65)
        self.assertEqual(kwargs.get("top_p"), 0.92)
        self.assertEqual(kwargs.get("top_k"), 800)
        self.assertEqual(kwargs.get("repetition_penalty"), 1.25)
        self.assertNotIn("cfg_weight", kwargs)
        self.assertNotIn("exaggeration", kwargs)


class TestQwenAdapterAdvancedSettings(unittest.TestCase):
    def test_qwen_parameters_and_icl_mode(self):
        adapter = QwenTtsAdapter()
        mock_model = MagicMock()
        mock_model.generate_voice_clone.return_value = ([np.zeros(24000, dtype=np.float32)], 24000)
        adapter._model = mock_model

        req = SynthesisRequest(
            text="Hello world test",
            language="en",
            ref_audio_path="sample.wav",
            ref_text="Reference transcript",
            extra={
                "temperature": 0.85,
                "top_p": 0.98,
                "top_k": 40,
                "repetition_penalty": 1.08,
                "do_sample": True,
                "x_vector_only_mode": False,
            },
        )

        audio, sr = adapter.synthesize(req)
        self.assertEqual(sr, 24000)
        mock_model.generate_voice_clone.assert_called_once()
        kwargs = mock_model.generate_voice_clone.call_args[1]
        self.assertEqual(kwargs.get("temperature"), 0.85)
        self.assertEqual(kwargs.get("top_p"), 0.98)
        self.assertEqual(kwargs.get("top_k"), 40)
        self.assertEqual(kwargs.get("repetition_penalty"), 1.08)
        self.assertEqual(kwargs.get("do_sample"), True)
        self.assertEqual(kwargs.get("x_vector_only_mode"), False)


class TestQwenServiceAndOps(unittest.TestCase):
    def _create_mock_qwen_service(self):
        mock_adapter = MagicMock()
        mock_adapter.capabilities = Capabilities(
            engine="qwen",
            display_name="Qwen3-TTS 1.7B Base",
            model_id="qwen3-tts-1.7b-base",
            supported_languages=("zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"),
            supports_vietnamese=False,
            supports_voice_clone=True,
            reference_audio_required=True,
            reference_text_required=True,
            supports_cuda=True,
            supports_cpu=False,
            supports_speed=False,
            model_size_mb=4334,
            sample_rate=24000,
        )
        mock_adapter.loaded = True
        mock_adapter.synthesize.return_value = (np.zeros(24000, dtype=np.float32), 24000)

        svc = TtsService([mock_adapter])
        svc._active = mock_adapter
        return svc, mock_adapter

    def test_qwen_x_vector_only_mode_no_ref_text_success(self):
        svc, mock_adapter = self._create_mock_qwen_service()
        mock_ctx = MagicMock()
        mock_ctx.cancelled = False

        params = {
            "engine": "qwen",
            "text": "Hello world",
            "outputPath": "test_output.wav",
            "refAudioPath": "sample_ref.wav",
            # refText is omitted
            "advancedSettings": {
                "x_vector_only_mode": True,
            },
        }

        with patch("soundfile.write"), patch("os.replace"), patch("os.path.isdir", return_value=True), \
             patch("os.path.isfile", return_value=True), \
             patch("voxlab_sidecar.audio_ops.prepare_clone_reference", return_value=("sample_ref.wav", "")) as mock_prep:
            svc.synthesize("tts.synthesize", params, mock_ctx)

        # Verified: prepare_clone_reference was called with skip_transcribe=True
        mock_prep.assert_called_once()
        self.assertEqual(mock_prep.call_args[1].get("skip_transcribe"), True)

        # Verified: adapter.synthesize received x_vector_only_mode=True
        mock_adapter.synthesize.assert_called_once()
        req: SynthesisRequest = mock_adapter.synthesize.call_args[0][0]
        self.assertEqual(req.ref_audio_path, "sample_ref.wav")
        self.assertTrue(req.extra.get("x_vector_only_mode"))

    def test_qwen_icl_mode_with_ref_text_success(self):
        svc, mock_adapter = self._create_mock_qwen_service()
        mock_ctx = MagicMock()
        mock_ctx.cancelled = False

        params = {
            "engine": "qwen",
            "text": "Hello world",
            "outputPath": "test_output.wav",
            "refAudioPath": "sample_ref.wav",
            "refText": "Matching reference text",
            "advancedSettings": {
                "x_vector_only_mode": False,
            },
        }

        with patch("soundfile.write"), patch("os.replace"), patch("os.path.isdir", return_value=True), \
             patch("os.path.isfile", return_value=True), \
             patch("voxlab_sidecar.audio_ops.prepare_clone_reference", return_value=("sample_ref.wav", "Matching reference text")) as mock_prep:
            svc.synthesize("tts.synthesize", params, mock_ctx)

        mock_prep.assert_called_once()
        self.assertEqual(mock_prep.call_args[1].get("skip_transcribe"), False)
        mock_adapter.synthesize.assert_called_once()

    def test_qwen_icl_mode_missing_ref_text_and_no_whisper_fails(self):
        from voxlab_sidecar.protocol import SidecarError
        svc, _ = self._create_mock_qwen_service()
        mock_ctx = MagicMock()
        mock_ctx.cancelled = False

        params = {
            "engine": "qwen",
            "text": "Hello world",
            "outputPath": "test_output.wav",
            "refAudioPath": "sample_ref.wav",
            # refText is omitted, and Whisper auto-transcribe returns empty ""
            "advancedSettings": {
                "x_vector_only_mode": False,
            },
        }

        with patch("soundfile.write"), patch("os.replace"), patch("os.path.isdir", return_value=True), \
             patch("os.path.isfile", return_value=True), \
             patch("voxlab_sidecar.audio_ops.prepare_clone_reference", return_value=("sample_ref.wav", "")):
            with self.assertRaises(SidecarError) as cm:
                svc.synthesize("tts.synthesize", params, mock_ctx)
            self.assertEqual(cm.exception.code, "INVALID_REQUEST")
            self.assertIn("requires refText", cm.exception.message)

    def test_qwen_missing_ref_audio_fails_in_both_modes(self):
        from voxlab_sidecar.protocol import SidecarError
        svc, _ = self._create_mock_qwen_service()
        mock_ctx = MagicMock()
        mock_ctx.cancelled = False

        for x_vec in (True, False):
            params = {
                "engine": "qwen",
                "text": "Hello world",
                "outputPath": "test_output.wav",
                "advancedSettings": {
                    "x_vector_only_mode": x_vec,
                },
            }
            with patch("os.path.isdir", return_value=True):
                with self.assertRaises(SidecarError) as cm:
                    svc.synthesize("tts.synthesize", params, mock_ctx)
                self.assertEqual(cm.exception.code, "INVALID_REQUEST")
                self.assertIn("requires a reference audio", cm.exception.message)

    def test_prepare_clone_reference_skips_whisper_when_skip_transcribe_is_true(self):
        from voxlab_sidecar.audio_ops import prepare_clone_reference

        mock_info = MagicMock()
        mock_info.duration = 6.0
        mock_info.samplerate = 24000

        with patch("os.path.isfile", return_value=True), \
             patch("soundfile.info", return_value=mock_info), \
             patch("voxlab_sidecar.asr_engine.auto_transcribe_sample") as mock_asr:
            audio_path, txt = prepare_clone_reference("mock.wav", ref_text=None, skip_transcribe=True)
            self.assertEqual(audio_path, "mock.wav")
            self.assertEqual(txt, "")
            mock_asr.assert_not_called()


if __name__ == "__main__":
    unittest.main()
