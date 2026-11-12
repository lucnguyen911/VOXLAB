"""Qwen3-TTS 1.7B Base adapter (QwenLM/Qwen3-TTS, Qwen/Qwen3-TTS-12Hz-1.7B-Base). Runtime: `qwen`.

Runs in its own venv because qwen-tts pins transformers 4.57.x. The Base variant only does
zero-shot voice cloning, so a reference clip and its transcript are mandatory.
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import numpy as np

from ..protocol import SidecarError
from .base import (
    Capabilities,
    SynthesisRequest,
    TtsEngineAdapter,
    apply_clamped_extra,
    configure_cuda_backends,
    cuda_available,
    cuda_load_summary,
    release_torch_memory,
    trim_process_working_set,
)

# ISO 639-1 → language names accepted by qwen_tts.
LANGUAGE_NAMES = {
    "zh": "Chinese", "en": "English", "ja": "Japanese", "ko": "Korean", "de": "German",
    "fr": "French", "ru": "Russian", "pt": "Portuguese", "es": "Spanish", "it": "Italian",
}

_QWEN_EXTRA_SPECS = (
    ("temperature", None, float, 0.1, 2.0),
    ("top_p", "topP", float, 0.1, 1.0),
    ("top_k", "topK", int, 1, 200),
    ("repetition_penalty", "repetitionPenalty", float, 1.0, 2.0),
    ("do_sample", "doSample", bool, None, None),
    ("subtalker_dosample", "subtalkerDosample", bool, None, None),
    ("subtalker_top_k", "subtalkerTopK", int, 1, 200),
    ("subtalker_top_p", "subtalkerTopP", float, 0.1, 1.0),
    ("subtalker_temperature", "subtalkerTemperature", float, 0.1, 2.0),
    ("max_new_tokens", "maxNewTokens", int, 256, 8192),
    ("non_streaming_mode", "nonStreamingMode", bool, None, None),
)


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
        supports_speed=True,  # pitch-preserving time-stretch postprocessing in TtsService
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
        import torch
        from qwen_tts import Qwen3TTSModel

        configure_cuda_backends()

        # flash-attn is optional upstream and not available on Windows; use PyTorch SDPA.
        self._model = Qwen3TTSModel.from_pretrained(
            model_dir, device_map="cuda:0", dtype=torch.bfloat16, attn_implementation="sdpa")
        self.device = device
        trim_process_working_set()
        return cuda_load_summary("bfloat16", 24000)

    def synthesize(self, req: SynthesisRequest) -> tuple[np.ndarray, int]:
        import numpy as np

        language = LANGUAGE_NAMES.get(req.language, "Auto") if req.language else "Auto"
        kwargs: dict[str, Any] = {}
        extra = req.extra or {}
        apply_clamped_extra(kwargs, extra, _QWEN_EXTRA_SPECS)

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
