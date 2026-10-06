"""Protocol-level tests for the sidecar request loop (no models required).

Run: sidecar/.venv/Scripts/python -m unittest discover -s sidecar/tests -v
"""
from __future__ import annotations

import io
import json
import os
import sys
import threading
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from voxlab_sidecar.protocol import SidecarError, Writer  # noqa: E402
from voxlab_sidecar.server import RequestContext, Server  # noqa: E402


class Capture(io.StringIO):
    def messages(self):
        return [json.loads(line) for line in self.getvalue().splitlines() if line.strip()]


def make_server():
    out = Capture()
    return Server(Writer(out)), out


def wait_for(out: Capture, req_id: str, timeout=5.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        for m in out.messages():
            if m.get("id") == req_id and "ok" in m:
                return m
        time.sleep(0.01)
    raise AssertionError(f"no terminal response for {req_id}")


class ProtocolTests(unittest.TestCase):
    def test_ping(self):
        server, out = make_server()
        server.handle_line('{"id":"a","method":"system.ping","params":{}}')
        self.assertEqual(out.messages()[-1], {"id": "a", "ok": True, "result": {"pong": True}})

    def test_malformed_and_invalid_requests_are_structured_errors(self):
        server, out = make_server()
        server.handle_line("not json")
        server.handle_line("[1,2]")
        server.handle_line('{"method":"system.ping"}')
        codes = [m["error"]["code"] for m in out.messages()]
        self.assertEqual(codes, ["INVALID_REQUEST"] * 3)

    def test_unknown_method(self):
        server, out = make_server()
        server.handle_line('{"id":"x","method":"nope","params":{}}')
        self.assertEqual(out.messages()[-1]["error"]["code"], "UNKNOWN_METHOD")

    def test_heavy_progress_then_ok(self):
        server, out = make_server()

        def job(_m, _p, ctx: RequestContext):
            ctx.progress(50, "half")
            return {"done": True}

        server.register_heavy("job", job)
        server.handle_line('{"id":"j","method":"job","params":{}}')
        resp = wait_for(out, "j")
        self.assertEqual(resp["result"], {"done": True})
        self.assertIn({"id": "j", "event": "progress", "data": {"pct": 50.0, "stage": "half"}}, out.messages())

    def test_busy_and_cancel(self):
        server, out = make_server()
        started = threading.Event()

        def slow(_m, _p, ctx: RequestContext):
            started.set()
            while True:
                ctx.check_cancelled()
                time.sleep(0.01)

        server.register_heavy("slow", slow)
        server.handle_line('{"id":"s1","method":"slow","params":{}}')
        self.assertTrue(started.wait(2))
        server.handle_line('{"id":"s2","method":"slow","params":{}}')
        self.assertEqual(wait_for(out, "s2")["error"]["code"], "BUSY")
        server.handle_line('{"id":"c","method":"cancel","params":{"target":"s1"}}')
        self.assertTrue(wait_for(out, "c")["result"]["cancelRequested"])
        self.assertEqual(wait_for(out, "s1")["error"]["code"], "CANCELLED")
        # worker slot is released after cancellation
        server.register_heavy("quick", lambda _m, _p, _c: {})
        server.handle_line('{"id":"q","method":"quick","params":{}}')
        self.assertTrue(wait_for(out, "q")["ok"])

    def test_engine_errors_are_structured(self):
        server, out = make_server()

        def fail(_m, _p, _c):
            raise SidecarError("MODEL_NOT_FOUND", "missing")

        def oom(_m, _p, _c):
            raise RuntimeError("CUDA out of memory. Tried to allocate")

        server.register_heavy("fail", fail)
        server.register_heavy("oom", oom)
        server.handle_line('{"id":"f","method":"fail","params":{}}')
        self.assertEqual(wait_for(out, "f")["error"]["code"], "MODEL_NOT_FOUND")
        server.handle_line('{"id":"o","method":"oom","params":{}}')
        self.assertEqual(wait_for(out, "o")["error"]["code"], "OUT_OF_MEMORY")

    def test_stdout_contains_only_json_lines(self):
        server, out = make_server()
        server.serve(io.StringIO('{"id":"p","method":"system.ping","params":{}}\n'
                                 '{"id":"z","method":"system.shutdown","params":{}}\n'))
        msgs = out.messages()  # raises if any non-JSON line was written
        self.assertEqual(msgs[0]["event"], "ready")
        self.assertEqual(msgs[-1], {"id": "z", "ok": True, "result": {}})

    def test_asr_rejects_missing_model_and_unloaded_state(self):
        from voxlab_sidecar.asr_engine import AsrEngine

        server, out = make_server()
        asr = AsrEngine()
        server.register_heavy("asr.load", asr.load)
        server.register_heavy("asr.transcribe", asr.transcribe)
        server.handle_line('{"id":"l","method":"asr.load","params":{"modelDir":"C:/definitely/missing"}}')
        self.assertEqual(wait_for(out, "l")["error"]["code"], "MODEL_NOT_FOUND")
        server.handle_line('{"id":"t","method":"asr.transcribe","params":{"audioPath":"x.wav"}}')
        self.assertEqual(wait_for(out, "t")["error"]["code"], "MODEL_NOT_LOADED")

    def test_tts_rejects_missing_model_and_unloaded_state(self):
        from voxlab_sidecar.tts.omnivoice_adapter import OmniVoiceAdapter
        from voxlab_sidecar.tts.service import TtsService

        server, out = make_server()
        tts = TtsService([OmniVoiceAdapter()])
        server.register_heavy("tts.load", tts.load)
        server.register_heavy("tts.synthesize", tts.synthesize)
        server.handle_line('{"id":"l","method":"tts.load","params":{"engine":"omnivoice","modelDir":"C:/missing"}}')
        self.assertEqual(wait_for(out, "l")["error"]["code"], "MODEL_NOT_FOUND")
        server.handle_line('{"id":"u","method":"tts.load","params":{"engine":"qwen-tts","modelDir":"C:/missing"}}')
        self.assertEqual(wait_for(out, "u")["error"]["code"], "ENGINE_NOT_INSTALLED")
        server.handle_line('{"id":"s","method":"tts.synthesize","params":{"text":"a","outputPath":"a.wav"}}')
        self.assertEqual(wait_for(out, "s")["error"]["code"], "MODEL_NOT_LOADED")


class CapabilityValidationTests(unittest.TestCase):
    """Unit tests of TtsService validation logic using a test-double adapter (no inference)."""

    def _service(self, **caps_overrides):
        import dataclasses

        import numpy as np
        from voxlab_sidecar.tts.base import Capabilities, TtsEngineAdapter
        from voxlab_sidecar.tts.service import TtsService

        caps = Capabilities(engine="dummy", display_name="Dummy", model_id="dummy", supported_languages=("en",),
                            supports_vietnamese=False, supports_voice_clone=False, reference_audio_required=False,
                            reference_text_required=False, supports_cuda=False, supports_cpu=True,
                            supports_speed=False, model_size_mb=1, sample_rate=16000)
        caps = dataclasses.replace(caps, **caps_overrides)

        class Dummy(TtsEngineAdapter):
            capabilities = caps
            python_package = "json"
            calls = 0

            def __init__(self):
                self._l = False
                self.device = None

            @property
            def loaded(self):
                return self._l

            def load(self, model_dir, device):
                self._l, self.device = True, device
                return {}

            def synthesize(self, req):
                Dummy.calls += 1
                return np.zeros(16000, dtype=np.float32) + 0.1, 16000

            def unload(self):
                self._l = False

        server, out = make_server()
        svc = TtsService([Dummy()])
        server.register_heavy("tts.load", svc.load)
        server.register_heavy("tts.synthesize", svc.synthesize)
        server.handle_line('{"id":"l","method":"tts.load","params":{"engine":"dummy","modelDir":".","device":"auto"}}')
        self.assertTrue(wait_for(out, "l")["ok"])
        return server, out, Dummy

    def _synth(self, server, out, rid, **params):
        import tempfile

        params.setdefault("text", "hello")
        params.setdefault("outputPath", os.path.join(tempfile.gettempdir(), f"voxlab-{rid}.wav"))
        server.handle_line(json.dumps({"id": rid, "method": "tts.synthesize", "params": params}))
        return wait_for(out, rid)

    def test_unsupported_language_clone_and_speed_are_rejected_without_inference(self):
        server, out, dummy = self._service()
        self.assertEqual(self._synth(server, out, "a", language="vi")["error"]["code"], "INVALID_REQUEST")
        self.assertEqual(self._synth(server, out, "b", refAudioPath=__file__)["error"]["code"], "INVALID_REQUEST")
        self.assertEqual(self._synth(server, out, "c", speed=1.2)["error"]["code"], "INVALID_REQUEST")
        self.assertEqual(self._synth(server, out, "d", engine="other")["error"]["code"], "MODEL_NOT_LOADED")
        self.assertEqual(dummy.calls, 0)
        ok = self._synth(server, out, "e", language="en")
        self.assertTrue(ok["ok"])
        self.assertEqual(ok["result"]["durationSec"], 1.0)
        self.assertEqual(dummy.calls, 1)

    def test_reference_requirements(self):
        server, out, _ = self._service(supports_voice_clone=True, reference_audio_required=True,
                                       reference_text_required=True)
        self.assertEqual(self._synth(server, out, "a")["error"]["code"], "INVALID_REQUEST")
        self.assertEqual(self._synth(server, out, "b", refAudioPath=__file__)["error"]["code"], "INVALID_REQUEST")
        self.assertTrue(self._synth(server, out, "c", refAudioPath=__file__, refText="hi")["ok"])

    def test_cpu_unsupported_engine_reports_device_unavailable(self):
        from voxlab_sidecar.tts.base import cuda_available

        server, out = make_server()
        from voxlab_sidecar.tts.omnivoice_adapter import OmniVoiceAdapter
        from voxlab_sidecar.tts.service import TtsService

        svc = TtsService([OmniVoiceAdapter()])
        with self.assertRaises(SidecarError) as cm:
            svc._resolve_device(OmniVoiceAdapter(), "cpu")
        self.assertEqual(cm.exception.code, "DEVICE_UNAVAILABLE")
        if cuda_available():
            self.assertEqual(svc._resolve_device(OmniVoiceAdapter(), "auto"), "cuda")


if __name__ == "__main__":
    unittest.main()
