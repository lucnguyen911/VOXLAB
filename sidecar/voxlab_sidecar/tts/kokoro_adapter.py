"""Kokoro-82M ONNX adapter (hexgrad/Kokoro-82M via kokoro-onnx v1.0). Runtime: `core`.

Pre-bundled lightweight local TTS model (Apache-2.0) that works out-of-the-box
when installing VoxLab without requiring a manual model download in Settings.
"""
from __future__ import annotations

import os
import re
import sys
from typing import Any

import numpy as np

from ..protocol import SidecarError
from .base import (
    Capabilities,
    SynthesisRequest,
    TtsEngineAdapter,
    cuda_available,
    trim_process_working_set,
)

_DEFAULT_KOKORO_VOICE = "af_heart"

_KNOWN_KOKORO_VOICES = (
    "af_heart",
    "af_alloy",
    "af_aoede",
    "af_bella",
    "af_jessica",
    "af_kore",
    "af_nicole",
    "af_nova",
    "af_river",
    "af_sarah",
    "af_sky",
    "am_adam",
    "am_echo",
    "am_eric",
    "am_fenrir",
    "am_liam",
    "am_michael",
    "am_onyx",
    "am_puck",
    "am_santa",
    "bf_alice",
    "bf_emma",
    "bf_isabella",
    "bf_lily",
    "bm_daniel",
    "bm_fable",
    "bm_george",
    "bm_lewis",
)


def resolve_bundled_kokoro_dir(requested_dir: str | None = None) -> str:
    """Resolve the directory containing `kokoro-v1.0.int8.onnx` and `voices-v1.0.bin`.

    Checks `requested_dir` first (in case the user overrides it in `modelsDir`),
    then falls back to the pre-bundled `models/kokoro-82m` directory packaged
    with `voxlab-sidecar-core` or `sidecar/models/kokoro-82m` in dev mode.
    """
    candidates: list[str] = []
    if requested_dir:
        candidates.append(requested_dir)

    if getattr(sys, "frozen", False):
        exe_dir = os.path.dirname(os.path.abspath(sys.executable))
        candidates.extend([
            os.path.join(exe_dir, "models", "kokoro-82m"),
            os.path.join(exe_dir, "_internal", "models", "kokoro-82m"),
            os.path.join(os.path.dirname(exe_dir), "models", "kokoro-82m"),
        ])

    # Dev workspace layout: <repo>/sidecar/voxlab_sidecar/tts/kokoro_adapter.py -> <repo>/sidecar/models/kokoro-82m
    dev_dir = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "models", "kokoro-82m")
    )
    candidates.append(dev_dir)

    for cand in candidates:
        if cand and os.path.isfile(os.path.join(cand, "kokoro-v1.0.int8.onnx")) and os.path.isfile(
            os.path.join(cand, "voices-v1.0.bin")
        ):
            return cand

    return requested_dir or dev_dir


def _split_kokoro_text(text: str, max_chars: int = 280) -> list[str]:
    """Split text into sentence-aligned chunks <= `max_chars` to stay well within Kokoro's 510-phoneme window."""
    cleaned = re.sub(r"\s+", " ", (text or "").strip())
    if not cleaned:
        return []
    if len(cleaned) <= max_chars:
        return [cleaned]

    raw_sentences = re.split(r"(?<=[.!?;:\n])\s+", cleaned)
    chunks: list[str] = []
    current = ""
    for sent in raw_sentences:
        sent = sent.strip()
        if not sent:
            continue
        if len(sent) > max_chars:
            if current:
                chunks.append(current)
                current = ""
            # Further split long clauses on commas or words
            clauses = re.split(r"(?<=[,])\s+", sent)
            sub_curr = ""
            for cl in clauses:
                if not sub_curr:
                    sub_curr = cl
                elif len(sub_curr) + 1 + len(cl) <= max_chars:
                    sub_curr = f"{sub_curr} {cl}"
                else:
                    chunks.append(sub_curr)
                    sub_curr = cl
            if sub_curr:
                chunks.append(sub_curr)
        elif not current:
            current = sent
        elif len(current) + 1 + len(sent) <= max_chars:
            current = f"{current} {sent}"
        else:
            chunks.append(current)
            current = sent
    if current:
        chunks.append(current)
    return chunks or [cleaned]


def _resolve_kokoro_voice(extra: dict[str, Any], available_voices: set[str] | None = None) -> str:
    raw = str(
        extra.get("voice")
        or extra.get("voiceId")
        or extra.get("kokoroVoice")
        or _DEFAULT_KOKORO_VOICE
    ).strip()
    if raw.startswith("kokoro_"):
        raw = raw[len("kokoro_"):]
    valid_pool = available_voices if available_voices else set(_KNOWN_KOKORO_VOICES)
    if raw in valid_pool:
        return raw
    return _DEFAULT_KOKORO_VOICE


def _resolve_espeak_lang(language: str | None, voice_id: str) -> str:
    lang = (language or "").strip().lower()
    if lang in ("ja", "jp", "ja-jp"):
        return "ja"
    if lang in ("zh", "zh-cn", "zh-tw", "cmn"):
        return "cmn"
    if lang in ("es", "es-es", "es-mx"):
        return "es"
    if lang in ("fr", "fr-fr"):
        return "fr-fr"
    if lang in ("it", "it-it"):
        return "it"
    if lang in ("pt", "pt-br", "pt-pt"):
        return "pt-br"
    if voice_id.startswith(("bf_", "bm_")):
        return "en-gb"
    return "en-us"


class KokoroAdapter(TtsEngineAdapter):
    capabilities = Capabilities(
        engine="kokoro",
        display_name="Kokoro-82M",
        model_id="kokoro-82m",
        supported_languages=("en", "ja", "zh", "es", "fr", "it", "pt"),
        supports_vietnamese=False,
        supports_voice_clone=False,
        reference_audio_required=False,
        reference_text_required=False,
        supports_cuda=True,
        supports_cpu=True,
        supports_speed=True,
        model_size_mb=115,
        sample_rate=24000,
        notes=("Apache-2.0 pre-bundled ONNX local TTS engine (kokoro-v1.0.int8.onnx).",),
    )
    python_package = "kokoro_onnx"
    required_files = ("kokoro-v1.0.int8.onnx", "voices-v1.0.bin")

    def __init__(self) -> None:
        self._model: Any = None
        self._voices: set[str] = set()
        self.device: str | None = None

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def missing_files(self, model_dir: str) -> list[str]:
        resolved_dir = resolve_bundled_kokoro_dir(model_dir)
        return super().missing_files(resolved_dir)

    def load(self, model_dir: str, device: str) -> dict[str, Any]:
        from kokoro_onnx import Kokoro

        resolved_dir = resolve_bundled_kokoro_dir(model_dir)
        model_path = os.path.join(resolved_dir, "kokoro-v1.0.int8.onnx")
        voices_path = os.path.join(resolved_dir, "voices-v1.0.bin")
        if not os.path.isfile(model_path) or not os.path.isfile(voices_path):
            raise SidecarError(
                "MODEL_NOT_FOUND",
                f"Kokoro-82M model files not found in {resolved_dir}",
            )

        try:
            import onnxruntime as ort

            sess_opts = ort.SessionOptions()
            sess_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            sess_opts.intra_op_num_threads = max(2, min(8, os.cpu_count() or 4))
            sess_opts.inter_op_num_threads = 1
            avail = set(ort.get_available_providers())
            providers = ["CUDAExecutionProvider", "CPUExecutionProvider"] if (
                device != "cpu" and "CUDAExecutionProvider" in avail
            ) else ["CPUExecutionProvider"]
            sess = ort.InferenceSession(model_path, sess_options=sess_opts, providers=providers)
            self._model = Kokoro.from_session(sess, voices_path)
        except Exception:
            self._model = Kokoro(model_path, voices_path)
        try:
            self._voices = set(self._model.get_voices())
        except Exception:
            self._voices = set(_KNOWN_KOKORO_VOICES)
        self.device = device if device in ("cuda", "cpu") else ("cuda" if cuda_available() else "cpu")

        trim_process_working_set()
        return {
            "dtype": "int8",
            "sampleRate": 24000,
            "bundledDir": resolved_dir,
        }

    def synthesize(self, req: SynthesisRequest) -> tuple[np.ndarray, int]:
        if self._model is None:
            raise SidecarError("MODEL_NOT_LOADED", "Kokoro-82M is not loaded")

        voice_id = _resolve_kokoro_voice(req.extra or {}, self._voices)
        espeak_lang = _resolve_espeak_lang(req.language, voice_id)
        speed = float(req.speed) if req.speed is not None else 1.0
        speed = max(0.5, min(2.0, speed))

        chunks = _split_kokoro_text(req.text, max_chars=280)
        if not chunks:
            raise SidecarError("INVALID_REQUEST", "Text is empty after normalization")

        parts: list[np.ndarray] = []
        sample_rate = 24000
        for idx, chunk in enumerate(chunks):
            samples, sr = self._model.create(
                chunk,
                voice=voice_id,
                speed=speed,
                lang=espeak_lang,
            )
            sample_rate = int(sr)
            wav = np.asarray(samples, dtype=np.float32).squeeze()
            if wav.ndim == 0:
                continue
            parts.append(wav)
            if idx < len(chunks) - 1:
                parts.append(np.zeros(int(sample_rate * 0.08), dtype=np.float32))

        if not parts:
            raise SidecarError("SYNTHESIS_FAILED", "Kokoro-82M returned empty audio")

        full_wav = np.concatenate(parts) if len(parts) > 1 else parts[0]
        return full_wav, sample_rate

    def unload(self) -> None:
        self._model = None
        self._voices = set()
        self.device = None
        trim_process_working_set()
