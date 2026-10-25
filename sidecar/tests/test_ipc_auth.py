"""Security v3.1 mutual HMAC-SHA256 authentication tests for VoxLab Python sidecar."""
from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from voxlab_sidecar import ipc_auth
from voxlab_sidecar.protocol import Writer
from voxlab_sidecar.server import Server

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Capture(io.StringIO):
    def messages(self) -> list[dict]:
        return [json.loads(line) for line in self.getvalue().splitlines() if line.strip()]


class IpcAuthTests(unittest.TestCase):
    def setUp(self) -> None:
        self._saved_env = {
            k: os.environ.get(k)
            for k in (
                "VOXLAB_IPC_PEPPER",
                "VOXLAB_SPAWN_SEED",
                "VOXLAB_HOST_PID",
                "VOXLAB_REQUIRE_HOST_AUTH",
            )
        }
        ipc_auth._CACHED_MASTER_KEY = None
        ipc_auth._SEEN_NONCES.clear()

    def tearDown(self) -> None:
        for k, v in self._saved_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        ipc_auth._CACHED_MASTER_KEY = None
        ipc_auth._SEEN_NONCES.clear()

    def test_ipc_master_key_matches_rust_kdf_vector_and_no_plaintext_seed_in_source(self) -> None:
        os.environ.pop("VOXLAB_IPC_PEPPER", None)
        ipc_auth._CACHED_MASTER_KEY = None
        key_hex = ipc_auth.derive_ipc_master_key().hex()
        self.assertEqual(
            key_hex,
            "b9be04b95b7c32feabcf63817ce78067d9e3a3a6cff1397620e75a5c2e607200",
        )
        src_path = os.path.abspath(ipc_auth.__file__)
        with open(src_path, "r", encoding="utf-8") as f:
            source_text = f.read()
        self.assertNotIn("VoxLab::SidecarIPC::MutualHMAC", source_text)

    def test_server_blocks_unauthenticated_rpc_when_auth_required(self) -> None:
        out = Capture()
        server = Server(Writer(out), runtime="core", require_auth=True)
        server.handle_line('{"id":"p1","method":"system.ping","params":{}}')
        self.assertEqual(out.messages()[-1]["error"]["code"], "UNAUTHORIZED_HOST")

        # Shutdown remains allowed so host teardown never hangs
        server.handle_line('{"id":"sd","method":"system.shutdown","params":{}}')
        self.assertTrue(out.messages()[-1]["ok"])

    def test_valid_mutual_handshake_unlocks_server_and_returns_valid_ack(self) -> None:
        spawn_seed = "a1" * 32
        host_pid = os.getpid()
        os.environ["VOXLAB_SPAWN_SEED"] = spawn_seed
        os.environ["VOXLAB_HOST_PID"] = str(host_pid)

        out = Capture()
        server = Server(Writer(out), runtime="core", require_auth=True)

        nonce = "b2" * 32
        ts = int(time.time())
        session_key = ipc_auth.derive_session_key(spawn_seed, host_pid, "core")
        sig = ipc_auth.compute_host_auth_sig(session_key, "core", nonce, ts)

        server.handle_line(
            json.dumps(
                {
                    "id": "auth-1",
                    "method": "system.authenticate",
                    "params": {"nonce": nonce, "ts": ts, "sig": sig},
                }
            )
        )
        auth_resp = out.messages()[-1]
        self.assertTrue(auth_resp["ok"], auth_resp)
        res = auth_resp["result"]
        expected_ack = ipc_auth.compute_sidecar_ack_sig(
            session_key, "core", host_pid, res["sidecarPid"], nonce
        )
        self.assertEqual(res["ack"], expected_ack)

        # Now system.ping is authorized
        server.handle_line('{"id":"p2","method":"system.ping","params":{}}')
        self.assertEqual(out.messages()[-1], {"id": "p2", "ok": True, "result": {"pong": True}})

    def test_rejects_forged_signature_expired_timestamp_and_replayed_nonce(self) -> None:
        spawn_seed = "c3" * 32
        host_pid = os.getpid()
        os.environ["VOXLAB_SPAWN_SEED"] = spawn_seed
        os.environ["VOXLAB_HOST_PID"] = str(host_pid)

        out = Capture()
        server = Server(Writer(out), runtime="core", require_auth=True)
        session_key = ipc_auth.derive_session_key(spawn_seed, host_pid, "core")
        now = int(time.time())

        # 1. Forged signature
        server.handle_line(
            json.dumps(
                {
                    "id": "bad-sig",
                    "method": "system.authenticate",
                    "params": {"nonce": "d4" * 32, "ts": now, "sig": "00" * 32},
                }
            )
        )
        self.assertEqual(out.messages()[-1]["error"]["code"], "UNAUTHORIZED_HOST")

        # 2. Expired timestamp (-180s)
        old_ts = now - 180
        old_nonce = "e5" * 32
        old_sig = ipc_auth.compute_host_auth_sig(session_key, "core", old_nonce, old_ts)
        server.handle_line(
            json.dumps(
                {
                    "id": "old-ts",
                    "method": "system.authenticate",
                    "params": {"nonce": old_nonce, "ts": old_ts, "sig": old_sig},
                }
            )
        )
        self.assertEqual(out.messages()[-1]["error"]["code"], "UNAUTHORIZED_HOST")

        # 3. Valid authentication followed by replay of identical nonce on second server
        valid_nonce = "f6" * 32
        valid_sig = ipc_auth.compute_host_auth_sig(session_key, "core", valid_nonce, now)
        server.handle_line(
            json.dumps(
                {
                    "id": "ok-1",
                    "method": "system.authenticate",
                    "params": {"nonce": valid_nonce, "ts": now, "sig": valid_sig},
                }
            )
        )
        self.assertTrue(out.messages()[-1]["ok"])

        server2 = Server(Writer(out), runtime="core", require_auth=True)
        server2.handle_line(
            json.dumps(
                {
                    "id": "replay-1",
                    "method": "system.authenticate",
                    "params": {"nonce": valid_nonce, "ts": now, "sig": valid_sig},
                }
            )
        )
        self.assertEqual(out.messages()[-1]["error"]["code"], "UNAUTHORIZED_HOST")

    def test_standalone_subprocess_with_require_host_auth_rejects_unauthorized_caller(self) -> None:
        env = dict(os.environ, PYTHONUNBUFFERED="1", VOXLAB_REQUIRE_HOST_AUTH="1")
        env.pop("VOXLAB_SPAWN_SEED", None)
        env.pop("VOXLAB_HOST_PID", None)
        proc = subprocess.Popen(
            [sys.executable, "-m", "voxlab_sidecar", "--runtime", "core"],
            cwd=ROOT,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            env=env,
        )
        try:
            assert proc.stdout is not None and proc.stdin is not None
            ready = json.loads(proc.stdout.readline())
            self.assertEqual(ready["event"], "ready")

            proc.stdin.write('{"id":"unauth-1","method":"system.ping","params":{}}\n')
            proc.stdin.flush()
            resp = json.loads(proc.stdout.readline())
            self.assertFalse(resp["ok"])
            self.assertEqual(resp["error"]["code"], "UNAUTHORIZED_HOST")
        finally:
            if proc.stdin is not None:
                proc.stdin.close()
            if proc.stdout is not None:
                proc.stdout.close()
            proc.kill()
            proc.wait(timeout=10)


if __name__ == "__main__":
    unittest.main()
