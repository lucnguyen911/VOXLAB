"""Unit tests for Global Advanced TTS Settings in sidecar and TTS adapters."""
from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import MagicMock, patch
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

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

    def test_spoken_text_bot_normalization_preserves_acronyms_and_script(self):
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

        cases = [
            ("Comment BOT if you trust robots", "Comment bot if you trust robots"),
            ("Comment HUMAN if you trust robots", "Comment HUMAN if you trust robots"),
            ("The USA and FBI utilize AI models", "The USA and FBI utilize AI models"),
            ("ROBOT and BOTTOM are unaffected", "ROBOT and BOTTOM are unaffected"),
        ]

        with patch("soundfile.write"), patch("os.replace"), patch("os.path.isdir", return_value=True):
            for original_text, expected_spoken_text in cases:
                params = {
                    "engine": "test_engine",
                    "text": original_text,
                    "outputPath": "test_output.wav",
                }
                res = svc.synthesize("tts.synthesize", params, mock_ctx)
                req: SynthesisRequest = mock_adapter.synthesize.call_args[0][0]
                self.assertEqual(req.text, expected_spoken_text)



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
                "t_shift": 0.15,
                "layer_penalty_factor": 6.5,
                "duration": 8.5,
                "preprocess_prompt": False,
                "pad_duration": 0.2,
                "fade_duration": 0.15,
                "audio_chunk_duration": 20.0,
                "audio_chunk_threshold": 40.0,
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
        self.assertEqual(kwargs.get("t_shift"), 0.15)
        self.assertEqual(kwargs.get("layer_penalty_factor"), 6.5)
        self.assertEqual(kwargs.get("duration"), 8.5)
        self.assertEqual(kwargs.get("preprocess_prompt"), False)
        self.assertEqual(kwargs.get("pad_duration"), 0.2)
        self.assertEqual(kwargs.get("fade_duration"), 0.15)
        self.assertEqual(kwargs.get("audio_chunk_duration"), 20.0)
        self.assertEqual(kwargs.get("audio_chunk_threshold"), 40.0)

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
                "t_shift": 10.0,  # clamped to 5.0
                "layer_penalty_factor": -5.0,  # clamped to 0.0
                "duration": 500.0,  # clamped to 300.0
                "pad_duration": 10.0,  # clamped to 2.0
                "fade_duration": -1.0,  # clamped to 0.0
                "audio_chunk_duration": 100.0,  # clamped to 60.0
                "audio_chunk_threshold": 5.0,  # clamped to 10.0
            },
        )

        with patch("os.path.isfile", return_value=False):
            adapter.synthesize(req)

        kwargs = mock_model.generate.call_args[1]
        self.assertEqual(kwargs.get("num_step"), 128)
        self.assertEqual(kwargs.get("guidance_scale"), 1.0)
        self.assertEqual(kwargs.get("position_temperature"), 20.0)
        self.assertEqual(kwargs.get("class_temperature"), 0.0)
        self.assertEqual(kwargs.get("t_shift"), 5.0)
        self.assertEqual(kwargs.get("layer_penalty_factor"), 0.0)
        self.assertEqual(kwargs.get("duration"), 300.0)
        self.assertEqual(kwargs.get("pad_duration"), 2.0)
        self.assertEqual(kwargs.get("fade_duration"), 0.0)
        self.assertEqual(kwargs.get("audio_chunk_duration"), 60.0)
        self.assertEqual(kwargs.get("audio_chunk_threshold"), 10.0)

    def test_omnivoice_auto_duration_omitted_from_kwargs(self):
        adapter = OmniVoiceAdapter()
        mock_model = MagicMock()
        mock_model.sampling_rate = 24000
        mock_model.generate.return_value = [np.zeros(24000, dtype=np.float32)]
        adapter._model = mock_model

        # When duration is None or string "auto" or empty
        req = SynthesisRequest(
            text="Tự động tính độ dài",
            extra={"duration": None},
        )
        with patch("os.path.isfile", return_value=False):
            adapter.synthesize(req)

        kwargs = mock_model.generate.call_args[1]
        self.assertNotIn("duration", kwargs)


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
                "norm_loudness": False,
                # These unsupported keys must be ignored
                "cfg_weight": 0.5,
                "exaggeration": 0.8,
                "speed": 1.2,
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
        self.assertEqual(kwargs.get("norm_loudness"), False)
        self.assertNotIn("cfg_weight", kwargs)
        self.assertNotIn("exaggeration", kwargs)
        self.assertNotIn("speed", kwargs)


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
                "subtalker_dosample": False,
                "subtalker_top_k": 35,
                "subtalker_top_p": 0.92,
                "subtalker_temperature": 0.75,
                "max_new_tokens": 4096,
                "non_streaming_mode": True,
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
        self.assertEqual(kwargs.get("subtalker_dosample"), False)
        self.assertEqual(kwargs.get("subtalker_top_k"), 35)
        self.assertEqual(kwargs.get("subtalker_top_p"), 0.92)
        self.assertEqual(kwargs.get("subtalker_temperature"), 0.75)
        self.assertEqual(kwargs.get("max_new_tokens"), 4096)
        self.assertEqual(kwargs.get("non_streaming_mode"), True)

    def test_qwen_subtalker_and_tokens_clamping(self):
        adapter = QwenTtsAdapter()
        mock_model = MagicMock()
        mock_model.generate_voice_clone.return_value = ([np.zeros(24000, dtype=np.float32)], 24000)
        adapter._model = mock_model

        req = SynthesisRequest(
            text="Clamping check",
            extra={
                "subtalker_top_k": 9999,  # clamped to 200
                "subtalker_top_p": 2.5,  # clamped to 1.0
                "subtalker_temperature": 5.0,  # clamped to 2.0
                "max_new_tokens": 10000,  # clamped to 8192
            },
        )

        adapter.synthesize(req)
        kwargs = mock_model.generate_voice_clone.call_args[1]
        self.assertEqual(kwargs.get("subtalker_top_k"), 200)
        self.assertEqual(kwargs.get("subtalker_top_p"), 1.0)
        self.assertEqual(kwargs.get("subtalker_temperature"), 2.0)
        self.assertEqual(kwargs.get("max_new_tokens"), 8192)


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
            self.assertIn("requires a valid reference transcript", cm.exception.message)

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

    def test_prepare_clone_reference_trimmed_audio_replaces_ref_text_with_whisper_slice(self):
        """When audio is > 10s, user's 30s ref_text must NOT be used for the trimmed slice;
        it must be re-transcribed with Whisper for the slice."""
        from voxlab_sidecar.audio_ops import prepare_clone_reference

        mock_info = MagicMock()
        mock_info.duration = 30.0
        mock_info.samplerate = 24000
        mock_info.frames = 30 * 24000

        audio_data = np.zeros((10 * 24000, 1), dtype=np.float32)

        with patch("os.path.isfile", side_effect=lambda p: "_trimmed" not in str(p)), \
             patch("soundfile.info", return_value=mock_info), \
             patch("soundfile.read", return_value=(audio_data, 24000)), \
             patch("voxlab_sidecar.audio_ops.write_audio_atomic"), \
             patch("voxlab_sidecar.asr_engine.auto_transcribe_sample", return_value="Trimmed slice text") as mock_asr:
            audio_path, txt = prepare_clone_reference(
                "30s_audio.wav",
                ref_text="This is full 30 seconds audio transcript which must not be used",
                skip_transcribe=False
            )
            # The returned text must be the slice text, NOT the 30s text
            self.assertEqual(txt, "Trimmed slice text")
            mock_asr.assert_called_once()
            self.assertIn("_trimmed.wav", audio_path)

    def test_prepare_clone_reference_short_audio_preserves_user_ref_text(self):
        """When audio is <= 10s, user-provided ref_text is preserved and Whisper is NOT called."""
        from voxlab_sidecar.audio_ops import prepare_clone_reference

        mock_info = MagicMock()
        mock_info.duration = 7.0
        mock_info.samplerate = 24000

        with patch("os.path.isfile", return_value=True), \
             patch("soundfile.info", return_value=mock_info), \
             patch("voxlab_sidecar.asr_engine.auto_transcribe_sample") as mock_asr:
            audio_path, txt = prepare_clone_reference(
                "7s_audio.wav",
                ref_text="Accurate user transcript for 7s audio",
                skip_transcribe=False
            )
            self.assertEqual(audio_path, "7s_audio.wav")
            self.assertEqual(txt, "Accurate user transcript for 7s audio")
            mock_asr.assert_not_called()

    def test_prepare_clone_reference_trimmed_audio_with_skip_transcribe(self):
        """When audio is > 10s and skip_transcribe=True (Chatterbox / Qwen x-vector),
        audio is trimmed but Whisper is never called and text is empty."""
        from voxlab_sidecar.audio_ops import prepare_clone_reference

        mock_info = MagicMock()
        mock_info.duration = 20.0
        mock_info.samplerate = 24000
        mock_info.frames = 20 * 24000

        audio_data = np.zeros((10 * 24000, 1), dtype=np.float32)

        with patch("os.path.isfile", side_effect=lambda p: "_trimmed" not in str(p)), \
             patch("soundfile.info", return_value=mock_info), \
             patch("soundfile.read", return_value=(audio_data, 24000)), \
             patch("voxlab_sidecar.audio_ops.write_audio_atomic"), \
             patch("voxlab_sidecar.asr_engine.auto_transcribe_sample") as mock_asr:
            audio_path, txt = prepare_clone_reference(
                "20s_audio.wav",
                ref_text="Some text",
                skip_transcribe=True
            )
            self.assertEqual(txt, "")
            mock_asr.assert_not_called()
            self.assertIn("_trimmed.wav", audio_path)

    def test_omnivoice_clone_missing_ref_text_and_no_whisper_fails(self):
        """OmniVoice voice clone requires valid reference transcript matching audio."""
        from voxlab_sidecar.protocol import SidecarError
        mock_adapter = MagicMock()
        mock_adapter.capabilities = Capabilities(
            engine="omnivoice",
            display_name="OmniVoice",
            model_id="omnivoice",
            supported_languages=("*",),
            supports_vietnamese=True,
            supports_voice_clone=True,
            reference_audio_required=False,
            reference_text_required=False,
            supports_cuda=True,
            supports_cpu=False,
            supports_speed=True,
            model_size_mb=3116,
            sample_rate=24000,
        )
        mock_adapter.loaded = True

        svc = TtsService([mock_adapter])
        svc._active = mock_adapter

        mock_ctx = MagicMock()
        mock_ctx.cancelled = False

        params = {
            "engine": "omnivoice",
            "text": "Xin chao",
            "outputPath": "test_output.wav",
            "refAudioPath": "long_ref.wav",
        }

        with patch("os.path.isdir", return_value=True), \
             patch("os.path.isfile", return_value=True), \
             patch("voxlab_sidecar.audio_ops.prepare_clone_reference", return_value=("trimmed.wav", "")):
            with self.assertRaises(SidecarError) as cm:
                svc.synthesize("tts.synthesize", params, mock_ctx)
            self.assertEqual(cm.exception.code, "INVALID_REQUEST")
            self.assertIn("OmniVoice voice cloning requires a valid reference transcript", cm.exception.message)

    def test_chatterbox_service_sets_skip_transcribe_true(self):
        """Chatterbox service call passes skip_transcribe=True to prepare_clone_reference."""
        mock_adapter = MagicMock()
        mock_adapter.capabilities = Capabilities(
            engine="chatterbox",
            display_name="Chatterbox Turbo",
            model_id="chatterbox-turbo",
            supported_languages=("en",),
            supports_vietnamese=False,
            supports_voice_clone=True,
            reference_audio_required=True,
            reference_text_required=False,
            supports_cuda=True,
            supports_cpu=False,
            supports_speed=False,
            model_size_mb=2000,
            sample_rate=24000,
        )
        mock_adapter.loaded = True
        mock_adapter.synthesize.return_value = (np.zeros(24000, dtype=np.float32), 24000)

        svc = TtsService([mock_adapter])
        svc._active = mock_adapter

        mock_ctx = MagicMock()
        mock_ctx.cancelled = False

        params = {
            "engine": "chatterbox",
            "text": "Hello",
            "outputPath": "test_output.wav",
            "refAudioPath": "chatter_ref.wav",
        }

        with patch("soundfile.write"), patch("os.replace"), patch("os.path.isdir", return_value=True), \
             patch("os.path.isfile", return_value=True), \
             patch("voxlab_sidecar.audio_ops.prepare_clone_reference", return_value=("trimmed.wav", "")) as mock_prep:
            svc.synthesize("tts.synthesize", params, mock_ctx)
            mock_prep.assert_called_once()
            self.assertEqual(mock_prep.call_args[1].get("skip_transcribe"), True)


if __name__ == "__main__":
    unittest.main()

