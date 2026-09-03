# VoxLab — Project Constraints & Quality Bar

**Last updated**: 2026-09-03 (Phase 0 — Project Constraints)  
**Target Platform**: Windows 10/11 64-bit (CPU & NVIDIA GPU)  
**Primary Stack**: Tauri v2 (Rust) + React 19 + TypeScript + Vite  

---

## 1. Quality Floor (Always Enforced, Non-Negotiable)

- **Zero Suppression Comments**: No `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `# noqa`, `# type: ignore` without an approved documented exception.
- **No Unimplemented Stubs**: No `throw new Error("Not implemented")`, no empty `catch {}` blocks that swallow errors silently.
- **Zero Secrets in Source**: No hard-coded API keys, tokens, or machine-specific absolute paths.
- **No Test / Check Weakening**: Never delete tests, remove assertions, or weaken validation to make builds pass.
- **Verifiable Diffs**: This file (`CONSTRAINTS.md`) cannot be edited down or weakened to bypass a failing check.

---

## 2. Enforced Engineering Constraints

| Dimension | Rule | Checked by | Runs at |
| :--- | :--- | :--- | :--- |
| **Types (Frontend)** | Zero type errors (`strict: true`) | `npm run build` (`tsc --noEmit`) | Every edit / task end |
| **Lint / Formatting** | Zero errors from config | `npm run lint` / `biome check` | Every edit / task end |
| **Types & Compile (Backend)** | Zero warnings/errors | `cargo check --manifest-path src-tauri/Cargo.toml` | Every edit / task end |
| **Native Build & Link** | Clean executable compilation | `cargo build --manifest-path src-tauri/Cargo.toml` | Milestone end |
| **Secrets & Credentials** | Zero leaked credentials | Git diff inspection / scanning | Every commit |
| **Tests (Frontend & Rust)** | All unit and integration tests pass | `npm test` & `cargo test` | Task end, Verify |
| **Process Hygiene** | Subprocesses gracefully terminated on exit | Process supervisor check | Runtime test |

---

## 3. Architecture & Boundary Constraints

### 3.1 Frontend / Backend Boundary
- **React Frontend**: Strictly presentation and UI state. Does **NOT** directly execute shell commands, manage raw file streams, or call Python/C++ model runtimes directly.
- **Tauri Native Layer (Rust)**:
  - Serves as the secure IPC bridge and orchestrator.
  - Manages background processes, hardware detection, file system access, and generation queue.
  - Enforces input validation, path sanitization, and resource cleanup.
- **Model Engine Boundary**:
  - Model runtimes (Python / faster-whisper / TTS engines) run in **isolated processes/workers** managed by Rust.
  - Communication between Rust and model workers uses clean, versioned IPC (e.g. standard I/O JSON-RPC or local localhost socket).
  - Runtime crash in a model worker must **NOT** crash the desktop UI window.

### 3.2 Model & Hardware Resource Policy
- **On-Demand Loading**: Models are loaded only when requested by a job and unloaded when idle.
- **Single Active Heavy Engine**: Do not load multiple heavy models (e.g. TTS + Whisper + LLM) into VRAM simultaneously unless the hardware profile explicitly permits it.
- **Hardware Profile Awareness**: Automatic hardware detection (RAM, VRAM, CPU cores, NVIDIA CUDA) determines available model options and concurrency.
- **TUNING REQUIRED Parameters** (safe defaults required, no guessed optimization):
  - Model unload timeout (default: 120s idle).
  - Queue concurrency (default: 1 sequential generation worker).
  - Text chunk length & audio buffer size.
  - Generation batch size.

### 3.3 Storage & File System
- **Local-First**: All data, settings, project files, and generated audio remain on the user's local machine.
- **No Complex External DB**: Use lightweight embedded local storage (e.g. structured JSON or local SQLite via Rust).
- **Non-Destructive Operations**: Never overwrite existing user files without explicit confirmation or unique filename versioning (`file_001.wav`).
- **Path Portability**: No machine-specific hardcoded paths; use standard Windows AppData / local cache directories.

### 3.4 Privacy & Network Policy
- **Core Functionality 100% Local**: TTS, transcription, and normalization must operate completely offline without internet connection.
- **Zero Telemetry / Tracking**: No analytics, usage tracking, or user data sent to external servers.
- **Model Downloads**: External network access is permitted *only* for user-initiated model downloads, verified via checksums.

---

## 4. Measured Metrics (Ratchet Policy)

| Metric | Baseline | Target Direction |
| :--- | :--- | :--- |
| **Frontend Bundle Size** | ~195 kB | Must not exceed 1.5 MB uncompressed |
| **Cold Startup Time (Skeleton)** | < 1.5s | Must remain under 3.0s |
| **Memory Footprint (Idle UI)** | < 120 MB RAM | Must remain responsive and low-profile |

---

## 5. Exceptions & Waivers

*Currently none. Any exception requires explicit user approval, rationale, and expiry date.*
