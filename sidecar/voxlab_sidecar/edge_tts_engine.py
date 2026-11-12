"""Edge TTS synthesis engine for VoxLab sidecar."""
from __future__ import annotations

import asyncio
import os
import tempfile
import threading
import time
import urllib.request
from email.utils import parsedate_to_datetime
from datetime import timezone as tz
from typing import Any

import edge_tts
from edge_tts.drm import DRM
import soundfile as sf

from .protocol import SidecarError

_EDGE_LOOP: asyncio.AbstractEventLoop | None = None
_EDGE_LOOP_LOCK = threading.Lock()


def _get_edge_loop() -> asyncio.AbstractEventLoop:
    """Returns a persistent background asyncio event loop so concurrent Edge TTS calls
    multiplex cleanly without repeatedly creating/destroying Windows IOCP event loops.
    """
    global _EDGE_LOOP
    with _EDGE_LOOP_LOCK:
        if _EDGE_LOOP is not None and _EDGE_LOOP.is_running():
            return _EDGE_LOOP
        ready = threading.Event()
        holder: list[asyncio.AbstractEventLoop] = []

        def _runner() -> None:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            holder.append(loop)
            ready.set()
            loop.run_forever()

        t = threading.Thread(target=_runner, name="voxlab-edge-loop", daemon=True)
        t.start()
        ready.wait(timeout=5.0)
        _EDGE_LOOP = holder[0]
        return _EDGE_LOOP


def _sync_clock_skew_from_server() -> bool:
    """Fetches server Date header from Microsoft/Bing and updates edge_tts DRM clock skew."""
    for url in (
        "https://www.bing.com",
        "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=6A5AA1D4EAFF4E9FB37E23D68491D6F4",
    ):
        try:
            req = urllib.request.Request(
                url,
                method="HEAD",
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"},
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                date_str = resp.headers.get("Date")
        except urllib.error.HTTPError as http_err:
            date_str = http_err.headers.get("Date") if http_err.headers else None
        except Exception:
            date_str = None

        if date_str:
            try:
                parsed = parsedate_to_datetime(date_str)
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=tz.utc)
                server_ts = parsed.timestamp()
                client_ts = DRM.get_unix_timestamp()
                DRM.adj_clock_skew_seconds(server_ts - client_ts)
                return True
            except Exception:
                continue
    return False


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

    loop = _get_edge_loop()
    for attempt in range(3):
        try:
            fut = asyncio.run_coroutine_threadsafe(_do_synth(), loop)
            fut.result(timeout=75)
            break
        except edge_tts.exceptions.NoAudioReceived:
            if attempt < 2:
                time.sleep(0.3 * (attempt + 1))
                continue
            raise SidecarError("PROVIDER_UNAVAILABLE", "No audio received from Edge TTS service")
        except SidecarError:
            raise
        except Exception as e:
            err_str = str(e)
            if "voice" in err_str.lower() and "not found" in err_str.lower():
                raise SidecarError("VOICE_NOT_FOUND", f"Edge voice '{voice}' not found")
            if "403" in err_str:
                _sync_clock_skew_from_server()
            if attempt < 2:
                time.sleep(0.3 * (attempt + 1))
                continue
            raise SidecarError("NETWORK_ERROR", f"Edge TTS request failed: {e}")

    size_bytes = os.path.getsize(output_path) if os.path.exists(output_path) else 0
    try:
        info = sf.info(output_path)
        duration_sec = float(info.duration)
        sample_rate = int(info.samplerate)
    except Exception:
        # Edge outputs 24kHz 48kbps CBR mono MP3 (6000 bytes/sec)
        duration_sec = round(size_bytes / 6000.0, 3) if size_bytes > 0 else 0.0
        sample_rate = 24000
    if duration_sec <= 0.0 and size_bytes > 0:
        duration_sec = round(size_bytes / 6000.0, 3)

    return {
        "outputPath": output_path,
        "durationSec": duration_sec,
        "sampleRate": sample_rate,
        "sizeBytes": size_bytes,
        "format": "mp3",
    }
