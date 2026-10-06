"""TTS engine adapters. Which adapters a sidecar process exposes depends on its runtime."""
from __future__ import annotations

from .base import TtsEngineAdapter


def adapters_for_runtime(runtime: str) -> list[TtsEngineAdapter]:
    # Imports are lazy so a runtime never imports another engine's dependency stack.
    if runtime == "core":
        from .omnivoice_adapter import OmniVoiceAdapter

        return [OmniVoiceAdapter()]
    if runtime == "chatterbox":
        from .chatterbox_adapter import ChatterboxAdapter

        return [ChatterboxAdapter()]
    if runtime == "qwen":
        from .qwen_adapter import QwenTtsAdapter

        return [QwenTtsAdapter()]
    raise ValueError(f"unknown runtime '{runtime}'")
