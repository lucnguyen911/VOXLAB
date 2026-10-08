"""Qwen3-TTS 1.7B Base adapter (QwenLM/Qwen3-TTS, Qwen/Qwen3-TTS-12Hz-1.7B-Base). Runtime: `qwen`.

Runs in its own venv because qwen-tts pins transformers 4.57.x. The Base variant only does
zero-shot voice cloning, so a reference clip and its transcript are mandatory.
"""
from __future__ import annotations

from typing import Any

import numpy as np

from ..protocol import SidecarError
from .base import Capabilities, SynthesisRequest, TtsEngineAdapter, cuda_available, release_torch_memory

# ISO 639-1 → language names accepted by qwen_tts.
LANGUAGE_NAMES = {
    "zh": "Chinese", "en": "English", "ja": "Japanese", "ko": "Korean", "de": "German",
    "fr": "French", "ru": "Russian", "pt": "Portuguese", "es": "Spanish", "it": "Italian",
}


class QwenTtsAdapter(TtsEngineAdapter):
    capabilities = Capabilities(
        engine="qwen",
        display_name="Qwen3-TTS 1.7B Base",
        model_id="qwen3-tts-1.7b-base",
        supported_languages=tuple(LANGUAGE_NAMES),  # model card: 10 languages, no Vietnamese
        supports_vietnamese=False,
        supports_voice_clone=True,
        reference_audio_required=True,  # Base variant = voice clone only
        reference_text_required=True,   # ICL clone mode needs the reference transcript
        supports_cuda=True,
        supports_cpu=False,  # not verified on CPU
        supports_speed=False,
        model_size_mb=4334,
        sample_rate=24000,
        notes=("No Vietnamese.", "Reference audio and transcript required.", "Weights and code Apache-2.0."),
    )
    python_package = "qwen_tts"
    required_files = (
        "config.json", "generation_config.json", "model.safetensors", "vocab.json", "merges.txt",
        "tokenizer_config.json", "preprocessor_config.json", "speech_tokenizer/model.safetensors",
        "speech_tokenizer/config.json",
    )

    def __init__(self) -> None:
        self._model = None
        self.device: str | None = None

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def load(self, model_dir: str, device: str) -> dict[str, Any]:
        if device != "cuda" or not cuda_available():
            raise SidecarError("DEVICE_UNAVAILABLE", "Qwen3-TTS requires CUDA (CPU execution not verified)")
        import gc
        import os
        import torch
        if hasattr(torch.backends, "cuda") and hasattr(torch.backends.cuda, "matmul"):
            torch.backends.cuda.matmul.allow_tf32 = True
        if hasattr(torch.backends, "cudnn"):
            torch.backends.cudnn.allow_tf32 = True
            torch.backends.cudnn.benchmark = True
        from qwen_tts import Qwen3TTSModel

        # flash-attn is optional upstream and not available on Windows; use PyTorch SDPA.
        self._model = Qwen3TTSModel.from_pretrained(
            model_dir, device_map="cuda:0", dtype=torch.bfloat16, attn_implementation="sdpa")
        self.device = device

        gc.collect()
        if os.name == "nt":
            try:
                import ctypes
                ctypes.windll.psapi.EmptyWorkingSet(ctypes.windll.kernel32.GetCurrentProcess())
            except Exception:
                pass

        vram_mb = int(torch.cuda.memory_allocated(0) // (1024 * 1024)) if torch.cuda.is_available() else 0
        gpu_name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "NVIDIA GPU"
        return {"dtype": "bfloat16", "sampleRate": 24000, "gpu": gpu_name, "vramMb": vram_mb, "device": "cuda:0"}

    def synthesize(self, req: SynthesisRequest) -> tuple[np.ndarray, int]:
        language = LANGUAGE_NAMES.get(req.language, "Auto") if req.language else "Auto"
        kwargs: dict[str, Any] = {}
        extra = req.extra or {}
        temperature = extra.get("temperature")
        if temperature is not None:
            kwargs["temperature"] = max(0.1, min(2.0, float(temperature)))

        top_p = extra.get("top_p", extra.get("topP"))
        if top_p is not None:
            kwargs["top_p"] = max(0.1, min(1.0, float(top_p)))

        top_k = extra.get("top_k", extra.get("topK"))
        if top_k is not None:
            kwargs["top_k"] = max(1, min(200, int(top_k)))

        rep_pen = extra.get("repetition_penalty", extra.get("repetitionPenalty"))
        if rep_pen is not None:
            kwargs["repetition_penalty"] = max(1.0, min(2.0, float(rep_pen)))

        do_sample = extra.get("do_sample", extra.get("doSample"))
        if do_sample is not None:
            kwargs["do_sample"] = bool(do_sample)

        sub_sample = extra.get("subtalker_dosample", extra.get("subtalkerDosample"))
        if sub_sample is not None:
            kwargs["subtalker_dosample"] = bool(sub_sample)

        sub_top_k = extra.get("subtalker_top_k", extra.get("subtalkerTopK"))
        if sub_top_k is not None:
            kwargs["subtalker_top_k"] = max(1, min(200, int(sub_top_k)))

        sub_top_p = extra.get("subtalker_top_p", extra.get("subtalkerTopP"))
        if sub_top_p is not None:
            kwargs["subtalker_top_p"] = max(0.1, min(1.0, float(sub_top_p)))

        sub_temp = extra.get("subtalker_temperature", extra.get("subtalkerTemperature"))
        if sub_temp is not None:
            kwargs["subtalker_temperature"] = max(0.1, min(2.0, float(sub_temp)))

        max_new_tokens = extra.get("max_new_tokens", extra.get("maxNewTokens"))
        if max_new_tokens is not None:
            kwargs["max_new_tokens"] = max(256, min(8192, int(max_new_tokens)))

        non_streaming = extra.get("non_streaming_mode", extra.get("nonStreamingMode"))
        if non_streaming is not None:
            kwargs["non_streaming_mode"] = bool(non_streaming)

        x_vec = extra.get("x_vector_only_mode", extra.get("xVectorOnlyMode"))
        x_vector_only_mode = bool(x_vec) if x_vec is not None else False

        wavs, sr = self._model.generate_voice_clone(
            text=req.text,
            language=language,
            ref_audio=req.ref_audio_path,
            ref_text=req.ref_text,
            x_vector_only_mode=x_vector_only_mode,
            **kwargs,
        )
        return np.asarray(wavs[0], dtype=np.float32).reshape(-1), int(sr)

    def unload(self) -> None:
        self._model = None
        self.device = None
        release_torch_memory()
        import os
        if os.name == "nt":
            try:
                import ctypes
                ctypes.windll.psapi.EmptyWorkingSet(ctypes.windll.kernel32.GetCurrentProcess())
            except Exception:
                pass
