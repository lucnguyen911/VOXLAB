"""OmniVoice adapter (k2-fsa/OmniVoice). Runtime: `core`."""
from __future__ import annotations

from typing import Any

import numpy as np

import os
from ..protocol import SidecarError
from .base import Capabilities, SynthesisRequest, TtsEngineAdapter, cuda_available, release_torch_memory


def _find_default_sample() -> str | None:
    appdata = os.environ.get("APPDATA")
    if appdata:
        p = os.path.join(appdata, "com.voxlab.app", "voices", "samples", "default_local.mp3")
        if os.path.isfile(p):
            return p
    base = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "..", "public", "audio", "samples", "default_local.mp3")
    )
    if os.path.isfile(base):
        return base
    return None


class OmniVoiceAdapter(TtsEngineAdapter):
    capabilities = Capabilities(
        engine="omnivoice",
        display_name="OmniVoice",
        model_id="omnivoice",
        supported_languages=("*",),  # 600+ languages, Vietnamese included (docs/languages.md)
        supports_vietnamese=True,
        supports_voice_clone=True,
        reference_audio_required=False,  # "auto" voice mode works without a reference
        # Auto-transcribed locally with faster-whisper if omitted by caller
        reference_text_required=False,
        supports_cuda=True,
        supports_cpu=False,  # not verified on CPU yet
        supports_speed=True,
        model_size_mb=3116,
        sample_rate=24000,
        notes=("Weights CC-BY-NC-4.0; audio tokenizer under Boson Higgs Audio 2 Community License.",),
    )
    python_package = "omnivoice"
    required_files = ("config.json", "model.safetensors", "audio_tokenizer/model.safetensors")

    def __init__(self) -> None:
        self._model = None
        self.device: str | None = None

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def load(self, model_dir: str, device: str) -> dict[str, Any]:
        import gc
        import os
        import torch
        from omnivoice import OmniVoice

        if device != "cuda" or not cuda_available():
            raise SidecarError("DEVICE_UNAVAILABLE", "OmniVoice requires CUDA (CPU execution not verified)")

        # Enable TF32 for high throughput on modern NVIDIA GPUs (Ampere / Ada / Blackwell)
        if hasattr(torch.backends, "cuda") and hasattr(torch.backends.cuda, "matmul"):
            torch.backends.cuda.matmul.allow_tf32 = True
        if hasattr(torch.backends, "cudnn"):
            torch.backends.cudnn.allow_tf32 = True
            torch.backends.cudnn.benchmark = True

        self._model = OmniVoice.from_pretrained(model_dir, device_map="cuda:0", dtype=torch.float16)
        self.device = device

        # Warm up CUDA kernels so the user's first synthesis is instantaneous (~0.9s)
        try:
            self._model.generate(text="Khởi động", num_step=2)
        except Exception:
            pass

        # Trim host RAM to free memory pages allocated during safetensors reading
        gc.collect()
        if os.name == "nt":
            try:
                import ctypes
                ctypes.windll.psapi.EmptyWorkingSet(ctypes.windll.kernel32.GetCurrentProcess())
            except Exception:
                pass

        vram_mb = int(torch.cuda.memory_allocated(0) // (1024 * 1024)) if torch.cuda.is_available() else 0
        gpu_name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "NVIDIA GPU"
        return {
            "dtype": "float16",
            "sampleRate": int(self._model.sampling_rate),
            "gpu": gpu_name,
            "vramMb": vram_mb,
            "device": "cuda:0",
        }

    def synthesize(self, req: SynthesisRequest) -> tuple[np.ndarray, int]:
        import os
        import torch

        kwargs: dict[str, Any] = {"text": req.text}
        if req.language:
            kwargs["language"] = req.language
        if req.ref_audio_path and os.path.isfile(req.ref_audio_path):
            from ..audio_ops import prepare_clone_reference
            ref_audio, ref_txt = prepare_clone_reference(req.ref_audio_path, req.ref_text, language=req.language)
            kwargs["ref_audio"] = ref_audio
            kwargs["ref_text"] = ref_txt
        else:
            # Fallback to local default sample to guarantee speaker consistency across document chunks
            default_sample = _find_default_sample()
            if default_sample and os.path.isfile(default_sample):
                kwargs["ref_audio"] = default_sample
                kwargs["ref_text"] = "Xin chào, đây là bản nghe thử giọng đọc mẫu trên VoxLab."
            else:
                # Deterministic seed fallback if no reference audio exists at all
                torch.manual_seed(42)
                if torch.cuda.is_available():
                    torch.cuda.manual_seed_all(42)

        if req.speed is not None:
            kwargs["speed"] = float(req.speed)
        if req.extra.get("numStep") is not None:
            kwargs["num_step"] = int(req.extra["numStep"])
        audios = self._model.generate(**kwargs)
        return np.asarray(audios[0], dtype=np.float32), int(self._model.sampling_rate)

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
