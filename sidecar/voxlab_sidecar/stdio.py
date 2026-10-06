"""Isolate the JSON Lines protocol pipes from the process standard handles.

Why: on Windows a synchronous ReadFile pending on the stdin pipe (the request loop) blocks any other
thread that queries that same handle (GetFileType / DuplicateHandle). Native DLL initialisers do
exactly that — e.g. `import scipy.special` loading the Fortran/OpenMP runtime inside the worker
thread deadlocked `tts.load` for OmniVoice. Native libraries may also print to fd 1, which would
corrupt the protocol stream.

Fix: the protocol uses private, non-inheritable duplicates of the original pipes, while the process
standard input becomes NUL and standard output is redirected to stderr (diagnostics only).
"""
from __future__ import annotations

import io
import os
import sys
from typing import TextIO

STD_INPUT_HANDLE = -10
STD_OUTPUT_HANDLE = -11


def _set_win_std_handle(which: int, fd: int) -> None:
    import ctypes
    import msvcrt

    ctypes.windll.kernel32.SetStdHandle(which, msvcrt.get_osfhandle(fd))


def isolate_protocol_streams() -> tuple[TextIO, TextIO]:
    """Return (protocol_in, protocol_out) text streams; rebinds fd 0 → NUL and fd 1 → stderr."""
    sys.stdout.flush()
    in_fd, out_fd = os.dup(0), os.dup(1)
    os.set_inheritable(in_fd, False)
    os.set_inheritable(out_fd, False)

    null_fd = os.open(os.devnull, os.O_RDONLY)
    os.dup2(null_fd, 0)
    os.close(null_fd)
    os.dup2(2, 1)
    if os.name == "nt":
        _set_win_std_handle(STD_INPUT_HANDLE, 0)
        _set_win_std_handle(STD_OUTPUT_HANDLE, 1)

    protocol_in = io.TextIOWrapper(io.BufferedReader(io.FileIO(in_fd, "rb")), encoding="utf-8")
    protocol_out = io.TextIOWrapper(io.BufferedWriter(io.FileIO(out_fd, "wb")), encoding="utf-8",
                                    newline="\n", write_through=True)
    # Python-level stray prints from libraries go to stderr, never to the protocol stream.
    sys.stdin = open(os.devnull, encoding="utf-8")  # noqa: SIM115 - lives for the process
    sys.stdout = sys.stderr
    return protocol_in, protocol_out
