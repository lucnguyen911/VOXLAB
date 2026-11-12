# Changelog — VoxLab Desktop

All notable changes to **VoxLab** are documented in this file.

## [1.0.7] — 2026-11-13

### Added
- **Preview Audio Bar Custom Save Dialog**:
  - Clicking the Download button on `BottomAudioPlayer` during chunk/line/cue preview in `TTS`, `Dialogue`, and `Dubbing` now opens the native OS Save As dialog (defaulting to the last-used export directory and canonical chunk filename) instead of silently downloading into the Windows `Downloads` folder.

### Fixed
- **Post-QC (`Hậu kiểm`) False-Positive Elimination & Missing-Word Recall (`v4.1.0`)**:
  - Added waveform envelope bridge validation (`measure_gap_acoustic_bridge_metrics`) so natural articulatory/prosodic transitions (`earth owns`, `the touch`, `of hours`, `rental unit`) no longer trigger false `ABNORMAL_PAUSE` alerts while true disconnected hesitations remain flagged.
  - Added context-aware isolated-slice verification (`verify_suspect_slice_in_context`) and singular↔plural acoustic duration/sibilant energy guards so ASR prompt hallucinations neither produce false `SUSPECTED_STUTTER` alerts (e.g. `"shear"`) nor mask dropped words (e.g. missing `"dollars"` in repeated currency phrases).
- **Batch (`Hàng loạt`) Full 5-Task Model & Voice Synchronization**:
  - Fixed Batch `Phụ đề` (`transcription`) failing with `faster-whisper model '<id>' not found on disk` when using custom `modelsDir` by canonicalizing `faster-whisper-<id>` folder paths and propagating `modelsDir` + live model/voice change events to `batchRuntime`.
  - Synchronized local & cloned engines (`kokoro_82m`, `omnivoice`, `chatterbox_turbo`, `qwen_tts_1_7b`), online providers (`Google TTS` & `Edge TTS`), workspace default hydration, and step-0 failure labels/retries across all 5 Batch tasks (`Phụ đề`, `Dịch`, `TTS`, `Hội thoại`, `Lồng tiếng`) and `BatchTtsQcModal`.

## [1.0.6] — 2026-11-12

### Added
- **In-Chunk Punctuation Pause Shaping (`NGẮT NGHỈ`: `,`, `.`, `?!`, `:;`)**:
  - Two-tier prosodic punctuation pause control inside single chunks across Clone (`OmniVoice`, `Chatterbox Turbo`, `Qwen3-TTS`), Local (`Kokoro-82M`), and Online (`Edge`, `Google`) voices, effective on both batch generation and single-chunk Regenerate (`Tạo lại`).
- **4-Layer Anti-ASR-Mishearing Protection (`Post-QC v4.0.0`)**:
  - Context-free vocabulary `hotwords`, General American flapped-`/ɾ/` homophones + open/closed compound matching + Vietnamese–English loanword transliterations, isolated lexicon-guided slice arbitration, and full `spokenText` alignment.

### Fixed
- **Eliminated False Warnings on `Whisper Large V3` & `Whisper Large V3 Turbo`**:
  - Added waveform-energy word-boundary re-anchoring (`reanchor_asr_word_timestamps`) and 2-word neighbor bleed peeling so `Whisper Large V3`'s `-120ms .. -400ms` timestamp left-shift and tail-stretched punctuation pauses no longer trigger false `ABNORMAL_PAUSE` or `SUSPECTED_STUTTER` alerts while still catching real skipped-comma, stutter, repeat, and missing-word defects.
- **Post-QC Speed & Subtitle Model Selector Decoupling**:
  - Cached post-shaped primary ASR word alignments (`<1ms` reuse on immediate Post-QC) and decoupled the `Mô hình phụ đề (Whisper)` dropdown from wiping/re-running completed chunk reviews.

## [1.0.0] — 2026-11-11 (Commercial General Availability Release)

### Added
- **Zero-Python Client AI Runtime Bootstrap & Manual Model Installer**:
  - Bundled standalone `uv.exe` (`sidecar/build_sidecars.ps1`) and Rust installer orchestrator (`src-tauri/src/ai/installer.rs`) that automatically detects NVIDIA CUDA vs. CPU hardware and provisions isolated Python AI runtimes (`faster-whisper`, `omnivoice`, `chatterbox_turbo`, `qwen_tts_1_7b`) on first launch without requiring system Python/Git/CUDA Toolkit on client PCs.
  - Added manual model download & cancellation controls in **Cài đặt → Mô hình** while pre-bundling Apache-2.0 **Kokoro-82M** (`int8` ONNX) + **Edge-TTS** out of the box.
- **Tactile Luxury Studio Design System & Frameless Unified Header**:
  - Upgraded the entire UI (`src/App.css`, `TopBar`, `Sidebar`, `TtsInspector`, `SettingsWorkspace`, `BottomAudioPlayer`) with a 4-tier 3D tactile hardware button system, 4-layer warm Travertine/Porcelain & Obsidian surface elevation, recessed input wells, and unified frameless Windows 11 studio titlebar controls.
  - Bundled offline variable multilingual technical typography (`Inter Variable` + `JetBrains Mono Variable` with Vietnamese diacritic optimization) and high-contrast Golden Pulse `V` application icons.
- **Prosodic & Syntactic TTS Quality Validation (`v3.8`)**:
  - Added ASR acronym/initialism expansion alignment (`Triple A` ↔ `AAA`) to eliminate false-positive missing-word alerts, clause-break acoustic pause detection before conjunctions/complementizers, and tighter compound-noun / preposition-NP cohesion thresholds (`sidecar/voxlab_sidecar/audio_quality.py`).

### Fixed
- **Accurate Installed Physical RAM Reporting**:
  - Queried SMBIOS physical memory sticks via Win32 `GetPhysicallyInstalledSystemMemory` (`sidecar/voxlab_sidecar/__main__.py`) and normalized DDR capacity tiers (`formatInstalledRamGb` in `src/services/ai/hardwareRecommendation.ts`) so BIOS/iGPU/NPU Hardware Reserved memory no longer causes `32 GB` PCs to display `31 GB`.

## [0.1.0] — 2026-11-10 (Commercial Production Release — Security v3.1 & Acoustic Cohesion v3)

### Added
- **Multi-Layer Anti-Reverse-Engineering & License Security v3.1**:
  - **Layer 1 (Rust Binary Hardening)**: Compile-time polymorphic SplitMix64 string cipher (`src-tauri/build.rs`, `src-tauri/src/security/obf.rs`) with `std::hint::black_box` + `ZeroizingBytes` volatile zeroization; release profile hardened with `lto = true`, `codegen-units = 1`, `panic = "abort"`, `strip = "symbols"`.
  - **Layer 2 (Vault Integrity & Fail-Closed Anti-Tamper)**: RFC 2104 `HMAC-SHA256` (`integrity_tag`) + dynamic 2048-round KDF DPAPI entropy on `license.enc` (`src-tauri/src/security/license_storage.rs`), OS debugger detection (`IsDebuggerPresent`, `CheckRemoteDebuggerPresent`) with fail-closed lockout (`src-tauri/src/security/anti_tamper.rs`), and IPC filesystem boundary protection isolating `license.enc`, `device_profile.enc`, and `gemini_keys.enc`.
  - **Layer 3 (Mutual HMAC Host↔Sidecar Handshake & PyArmor Pipeline)**: `system.authenticate` challenge-response protocol (`src-tauri/src/ai/sidecar.rs`, `sidecar/voxlab_sidecar/ipc_auth.py`) binding sidecar execution to `VOXLAB_SPAWN_SEED`, `VOXLAB_HOST_PID`, and runtime identity; fail-closed PyArmor + PyInstaller packaging (`sidecar/build_sidecars.ps1`).
  - **Layer 4 (WebView2 & Bundle Hardening)**: Disabled production sourcemaps, stripped `debugger` statements, enforced production DevTools shortcut guards (`src/utils/antiInspect.ts`), and hardened Content-Security-Policy (`src-tauri/tauri.conf.json`).
- **Subtitle Translation QA & "Gom Repair" Engine (`Audio-Factory` Architecture)**:
  - Automatic detection of untranslated English residuals (`untranslated_copy`, `untranslated_english`), empty translations, foreign script hallucinations (`script_hallucination`), and abnormal duplicate translations (`src/services/translation/translationQaAndRepair.ts`).
  - Automatic post-translation repair pass (`TranslationManager.repairUntranslatedCues`) plus a 1-click **`Dịch bù X câu sót`** button in the Dubbing Review Grid header (`src/components/dubbing/ReviewGrid.tsx`).
  - Multi-line `[id]` continuation line parser and JSON object/array coercion fallback in `parseBatchTranslationResponse` (`src/services/translation/batchTranslationHelper.ts`).
- **Dubbing WSOLA `1.20x` + Elastic Ripple Shift (`source_sync` mode)**:
  - Pitch-preserving WSOLA time-stretching up to `1.20x` combined with automatic **Elastic Ripple Shift** (`src/services/dubbing/autoFit.ts`, `src/services/dubbing/collisionDetector.ts`, `src/services/dubbing/masterAssembly.ts`) that smoothly delays subsequent cues when speech exceeds `1.20x` and recovers timing drift across natural silence gaps without blocking Master WAV export.
- **ASR Post-QC Enhancements (`faster-whisper` Unified Engine)**:
  - Tuned Silero VAD parameters specifically for synthesized TTS audio (`DEFAULT_TTS_VAD_PARAMETERS`: `threshold=0.40`, `min_speech_duration_ms=150`, `min_silence_duration_ms=400`, `speech_pad_ms=400`) and `condition_on_previous_text=False` to prevent edge-clipping and hallucination loops (`sidecar/voxlab_sidecar/asr_engine.py`, `sidecar/voxlab_sidecar/audio_quality.py`).
  - Automatic `CUDA -> CPU (int8)` fallback when GPU VRAM contention or CTranslate2/cuBLAS runtime errors occur during concurrent TTS + ASR post-QC.

### Changed
- **Edge-TTS Reliability (`edge-tts 7.3.1`)**:
  - Upgraded `edge-tts` to `7.3.1` (`Sec-MS-GEC-Version=2-143.0.3650.75`) with automatic server clock-skew synchronization and retry backoff (`sidecar/voxlab_sidecar/edge_tts_engine.py`).
- **Voice Clone & Voice Library Polish**:
  - Curated Local Preset Voices to 4 verified high-quality studio references (`Thảo Trinh (Hà Nội)`, `Nam Anh (Sài Gòn)`, `Sarah (US Professional)`, `David (UK Documentary)`), unified language/accent filtering (`src/constants/voiceFilters.ts`), and removed dead prototype code (`src/views/BatchWorkspacePrototype.tsx`).
- **Speech Group Preview & Bottom Audio Player**:
  - Clarified grouped cue playback with `Nghe nhóm` badge/tooltip on follower cues (`src/components/dubbing/CueRow.tsx`) and accurate full-group duration + group title display on `BottomAudioPlayer` (`src/views/DubbingWorkspace.tsx`).

### Fixed
- **Dubbing Cancel & Clean-Slate Restart Race Condition**:
  - Fixed `BUSY: another heavy task is running` error when cancelling an active dubbing run, switching voices, and restarting full-script dubbing by synchronously awaiting `ai_cancel_task` and clearing stale audio segments (`src/views/DubbingWorkspace.tsx`, `src/services/ai/localAiServices.ts`, `src/services/providers/edgeProvider.ts`).
- **Performance & Memory**:
  - Resolved `HistoryWorkspace` storage polling loop, memoized `TtsChunkCard` (`-88%` typing INP on 319-chunk scripts), capped Chatterbox Turbo chunk size at `250` chars (`0%` tail-drop rate), and disabled `cudnn.benchmark` on variable-length TTS inputs (`PERFORMANCE.md`).
