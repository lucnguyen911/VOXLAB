"""Mutual HMAC-SHA256 authentication between the VoxLab Rust host and Python sidecar."""
from __future__ import annotations

import ctypes
from ctypes import wintypes
import hashlib
import hmac
import os
import sys
import time
from typing import Any

from .protocol import SidecarError

KDF_ROUNDS = 2048
AUTH_TIMESTAMP_SKEW_SEC = 60

_MASK_A = (
    249, 196, 215, 34, 45, 56, 11, 22, 97, 108, 127, 74, 85, 160, 179, 190, 137, 148,
    231, 242, 253, 200, 219, 38, 49, 60, 15, 26, 101, 112, 67, 78, 89, 164, 183, 130,
    141, 152, 235, 246, 193, 204, 223, 42, 53, 0, 19, 30, 105, 116, 71, 82, 93, 168,
)
_MASK_B = (
    175, 178, 81, 67, 80, 189, 111, 125, 234, 196, 213, 248, 226, 28, 103, 12, 73, 46,
    95, 77, 36, 192, 213, 48, 56, 39, 241, 16, 96, 126, 79, 93, 15, 190, 171, 164,
    187, 165, 170, 132, 138, 72, 128, 116, 162, 112, 181, 101, 233, 251, 213, 153, 192, 125,
)

_CACHED_MASTER_KEY: bytes | None = None
_SEEN_NONCES: set[str] = set()


def _reconstruct_ipc_seed() -> bytes:
    raw = bytearray(len(_MASK_A))
    for idx, (a, b) in enumerate(zip(_MASK_A, _MASK_B)):
        raw[idx] = ((a ^ b) - (idx * 7)) & 0xFF
    base = bytes(raw)
    for idx in range(len(raw)):
        raw[idx] = 0
    if not getattr(sys, "frozen", False):
        pepper = os.environ.get("VOXLAB_IPC_PEPPER", "").strip()
        if pepper:
            return base + b"::" + pepper.encode("utf-8")
    return base


def derive_ipc_master_key() -> bytes:
    """Derives the 32-byte IPC master key identically to Rust `crypto_seal::ipc_master_key`."""
    global _CACHED_MASTER_KEY
    if _CACHED_MASTER_KEY is not None:
        return _CACHED_MASTER_KEY
    seed = _reconstruct_ipc_seed()
    state = hashlib.sha256(seed).digest()
    for round_idx in range(KDF_ROUNDS):
        state = hmac.new(seed, state + round_idx.to_bytes(4, "big"), hashlib.sha256).digest()
    _CACHED_MASTER_KEY = state
    return state


def derive_session_key(spawn_seed_hex: str, host_pid: int, runtime: str) -> bytes:
    """Derives per-spawn mutual authentication session key."""
    material = f"{spawn_seed_hex}|{host_pid}|{runtime}".encode("utf-8")
    return hmac.new(derive_ipc_master_key(), material, hashlib.sha256).digest()


def _is_valid_hex(val: str, expected_len: int | None = None) -> bool:
    if expected_len is not None and len(val) != expected_len:
        return False
    if len(val) < 32 or len(val) % 2 != 0:
        return False
    try:
        bytes.fromhex(val)
        return True
    except ValueError:
        return False


def _is_live_ancestor_pid(target_pid: int) -> bool:
    """Verifies `target_pid` is alive and in the ancestor chain of the current sidecar process."""
    if target_pid <= 0:
        return False
    if target_pid == os.getpid() or target_pid == os.getppid():
        return True
    if os.name != "nt":
        return False

    try:
        th32cs_snapprocess = 0x00000002
        invalid_handle_value = ctypes.c_void_p(-1).value

        class ProcessEntry32(ctypes.Structure):
            _fields_ = [
                ("dwSize", wintypes.DWORD),
                ("cntUsage", wintypes.DWORD),
                ("th32ProcessID", wintypes.DWORD),
                ("th32DefaultHeapID", ctypes.c_size_t),
                ("th32ModuleID", wintypes.DWORD),
                ("cntThreads", wintypes.DWORD),
                ("th32ParentProcessID", wintypes.DWORD),
                ("pcPriClassBase", wintypes.LONG),
                ("dwFlags", wintypes.DWORD),
                ("szExeFile", ctypes.c_char * 260),
            ]

        k32 = ctypes.windll.kernel32
        k32.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
        k32.CreateToolhelp32Snapshot.restype = ctypes.c_void_p
        k32.Process32First.argtypes = [ctypes.c_void_p, ctypes.POINTER(ProcessEntry32)]
        k32.Process32First.restype = wintypes.BOOL
        k32.Process32Next.argtypes = [ctypes.c_void_p, ctypes.POINTER(ProcessEntry32)]
        k32.Process32Next.restype = wintypes.BOOL
        k32.CloseHandle.argtypes = [ctypes.c_void_p]
        k32.CloseHandle.restype = wintypes.BOOL

        snap = k32.CreateToolhelp32Snapshot(th32cs_snapprocess, 0)
        if snap is None or snap == invalid_handle_value:
            return False

        parent_map: dict[int, int] = {}
        try:
            entry = ProcessEntry32()
            entry.dwSize = ctypes.sizeof(ProcessEntry32)
            ok = k32.Process32First(snap, ctypes.byref(entry))
            while ok:
                parent_map[int(entry.th32ProcessID)] = int(entry.th32ParentProcessID)
                ok = k32.Process32Next(snap, ctypes.byref(entry))
        finally:
            k32.CloseHandle(snap)

        if target_pid not in parent_map:
            return False

        cur = os.getpid()
        for _ in range(6):
            parent = parent_map.get(cur, 0)
            if parent <= 0 or parent == cur:
                break
            if parent == target_pid:
                return True
            cur = parent
        return False
    except Exception:
        return os.getppid() == target_pid


def compute_host_auth_sig(session_key: bytes, runtime: str, nonce: str, ts: int) -> str:
    msg = f"HOST_AUTH_V3.1|{runtime}|{nonce}|{ts}".encode("utf-8")
    return hmac.new(session_key, msg, hashlib.sha256).hexdigest()


def compute_sidecar_ack_sig(
    session_key: bytes, runtime: str, host_pid: int, sidecar_pid: int, nonce: str
) -> str:
    msg = f"SIDECAR_ACK_V3.1|{runtime}|{host_pid}|{sidecar_pid}|{nonce}".encode("utf-8")
    return hmac.new(session_key, msg, hashlib.sha256).hexdigest()


def verify_and_ack_host_auth(
    params: dict[str, Any], runtime: str, check_ancestry: bool = True
) -> dict[str, Any]:
    """Verifies the host's HMAC challenge and returns a mutually signed ACK."""
    spawn_seed = os.environ.get("VOXLAB_SPAWN_SEED", "").strip()
    raw_host_pid = os.environ.get("VOXLAB_HOST_PID", "").strip()
    if not _is_valid_hex(spawn_seed, expected_len=64) or not raw_host_pid.isdigit():
        raise SidecarError(
            "UNAUTHORIZED_HOST",
            "Missing or invalid VoxLab host spawn credentials.",
        )

    host_pid = int(raw_host_pid)
    if check_ancestry and not _is_live_ancestor_pid(host_pid):
        raise SidecarError(
            "UNAUTHORIZED_HOST",
            "Sidecar process ancestry does not match authorized VoxLab host.",
        )

    nonce = params.get("nonce")
    ts_raw = params.get("ts")
    sig = params.get("sig")
    if (
        not isinstance(nonce, str)
        or not _is_valid_hex(nonce, expected_len=64)
        or not isinstance(ts_raw, (int, float))
        or isinstance(ts_raw, bool)
        or not isinstance(sig, str)
        or not _is_valid_hex(sig, expected_len=64)
    ):
        raise SidecarError("UNAUTHORIZED_HOST", "Malformed host authentication payload.")

    ts = int(ts_raw)
    now = int(time.time())
    if abs(now - ts) > AUTH_TIMESTAMP_SKEW_SEC:
        raise SidecarError("UNAUTHORIZED_HOST", "Expired or skewed host authentication timestamp.")

    if nonce in _SEEN_NONCES:
        raise SidecarError("UNAUTHORIZED_HOST", "Replay of host authentication nonce rejected.")

    session_key = derive_session_key(spawn_seed, host_pid, runtime)
    expected_sig = compute_host_auth_sig(session_key, runtime, nonce, ts)
    if not hmac.compare_digest(sig.lower(), expected_sig):
        raise SidecarError("UNAUTHORIZED_HOST", "Invalid host HMAC signature.")

    if len(_SEEN_NONCES) >= 256:
        _SEEN_NONCES.clear()
    _SEEN_NONCES.add(nonce)

    sidecar_pid = os.getpid()
    ack = compute_sidecar_ack_sig(session_key, runtime, host_pid, sidecar_pid, nonce)
    return {
        "authenticated": True,
        "runtime": runtime,
        "sidecarPid": sidecar_pid,
        "ack": ack,
    }
