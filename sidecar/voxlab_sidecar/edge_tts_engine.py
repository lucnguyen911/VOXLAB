"""Edge TTS synthesis engine for VoxLab sidecar."""
from __future__ import annotations

import asyncio
import os
import tempfile
from typing import Any

import edge_tts
import soundfile as sf

from .protocol import SidecarError


def synthesize_edge_tts(
    text: str,
    voice: str,
    output_path: str | None = None,
    rate: str = "+0%",
    pitch: str = "+0Hz",
    volume: str = "+0%",
) -> dict[str, Any]:
    """Synthesizes text using Microsoft Edge online TTS and returns audio metadata."""
    if not text or not text.strip():
        raise SidecarError("INVALID_PARAMS", "text must not be empty")
    if not voice or not voice.strip():
        raise SidecarError("INVALID_PARAMS", "voice must not be empty")

    if not output_path:
        fd, output_path = tempfile.mkstemp(suffix=".mp3", prefix="voxlab_edge_preview_")
        os.close(fd)

    async def _do_synth() -> None:
        comm = edge_tts.Communicate(text=text, voice=voice, rate=rate, pitch=pitch, volume=volume)
        with open(output_path, "wb") as f:
            has_audio = False
            async for chunk in comm.stream():
                if chunk["type"] == "audio":
                    f.write(chunk["data"])
                    has_audio = True
            if not has_audio:
                raise SidecarError("PROVIDER_UNAVAILABLE", "Edge TTS returned no audio data")

    last_err = None
    for attempt in range(3):
        try:
            asyncio.run(_do_synth())
            last_err = None
            break
        except edge_tts.exceptions.NoAudioReceived as e:
            last_err = e
            if attempt < 2:
                import time
                time.sleep(0.3 * (attempt + 1))
                continue
            raise SidecarError("PROVIDER_UNAVAILABLE", "No audio received from Edge TTS service")
        except SidecarError:
            raise
        except Exception as e:
            last_err = e
            err_str = str(e)
            if "voice" in err_str.lower() and "not found" in err_str.lower():
                raise SidecarError("VOICE_NOT_FOUND", f"Edge voice '{voice}' not found")
            if attempt < 2:
                import time
                time.sleep(0.3 * (attempt + 1))
                continue
            raise SidecarError("NETWORK_ERROR", f"Edge TTS request failed: {e}")

    try:
        info = sf.info(output_path)
        duration_sec = info.duration
        sample_rate = info.samplerate
    except Exception:
        duration_sec = 0.0
        sample_rate = 24000

    size_bytes = os.path.getsize(output_path) if os.path.exists(output_path) else 0

    return {
        "outputPath": output_path,
        "durationSec": duration_sec,
        "sampleRate": sample_rate,
        "sizeBytes": size_bytes,
        "format": "mp3",
    }
