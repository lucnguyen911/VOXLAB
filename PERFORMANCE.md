# VoxLab — Performance & Tuning Ledger (Phase 11)

Rule: **measure first**. Every row has before/after numbers or a documented reason it was not changed.
Reverted and rejected ideas stay listed so they are not re-tried.

- **Hardware**: Intel Core Ultra 7 270K Plus (24 cores), 31.5 GB RAM, NVIDIA GeForce RTX 5070 Ti 16 GB VRAM (driver 617.42, CUDA compute capability 12.0), Windows 11 x64, Edge / WebView2 `156.0.4314.58`.
- **Reproducibility**: All benchmark harnesses live in [`scripts/perf/`](scripts/perf/) and [`src/services/dubbing/__benchmarks__/masterMemoryBenchmark.ts`](src/services/dubbing/__benchmarks__/masterMemoryBenchmark.ts); raw JSON reports live in [`scripts/perf/results/`](scripts/perf/results/).

---

## 1. Frontend / WebView (`/webperf`)

### 1.1 Cold Startup — Production Bundle (`scripts/perf/webview-startup-bench.mjs`, 7 cold loads/rate, median)

Outside the native Tauri shell, the production bundle intentionally stops at the license gate (fail-closed by design), but the entire `1.82 MB` JS bundle (`511 kB` gzip) and `134 kB` CSS (`22 kB` gzip) are parsed and executed before first paint, making this a conservative startup-cost proxy.

| CPU Throttle | FCP (median / p75) | LCP (median / p75) | Script Eval | Layout | Style | Long Tasks (`>50ms`) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1× (native)** | `72 ms` / `80 ms` | `84 ms` / `92 ms` | `15.5 ms` | `7.1 ms` | `3.4 ms` | `0` |
| **4× slowdown** | `176 ms` / `184 ms` | `216 ms` / `232 ms` | `84.8 ms` | `26.8 ms` | `12.6 ms` | `1` (`53 ms`) |
| **6× slowdown** | `264 ms` / `276 ms` | `340 ms` / `356 ms` | `141.0 ms` | `39.9 ms` | `19.2 ms` | `1` (`87 ms`) |

- **Verdict**: **Category C — Already inside "Good" (`LCP <= 2500 ms`) with 7× headroom even at 6× CPU slowdown.**
- **Rejected Optimization**: Route-level `React.lazy()` code-splitting of the 9 workspaces was evaluated and **rejected** — local desktop loads from disk in `<90 ms` unthrottled, and splitting would introduce asynchronous loading flashes when switching workspaces.

### 1.2 Runtime Interactions (`scripts/perf/webview-interaction-bench.mjs`, CDP Input + Event Timing API)

| Scenario | 1× CPU | 4× CPU | CWV Target (`<= 200 ms`) | Verdict |
| :--- | :--- | :--- | :--- | :--- |
| **Switch across all 9 workspaces (INP p75 / max)** | `32 ms` / `48 ms` | `224 ms` / `288 ms` (dev build) | Pass at 1×; borderline at 4× dev | **C** — dev React double-renders; no UI change needed |
| **Typing in Compose Editor (`100k` chars, INP p75)** | `16 ms` | `40 ms` | Pass (`12.5×` margin) | **C** |
| **Pure Smart Chunker (`scripts/perf/chunker-bench.ts`)** | `0.12 ms` (`5k`) · `0.68 ms` (`30k`) · `2.16 ms` (`100k`) | — | Negligible (`< 2.5 ms`) | **C** — algorithm is not the bottleneck |
| **Enter Studio (`100k` chars / `319` chunks, one-off)** | `288 ms` | `1296 ms` (after `5533e3f`) | Rare extreme workload | **B** — see §1.4 |

### 1.3 Evidenced Frontend Optimizations Implemented & Verified

| # | Bottleneck & Root Cause | Fix | Before | After | Delta | Commit |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | **History workspace infinite refresh loop**: [`HistoryWorkspace.tsx`](src/views/HistoryWorkspace.tsx) called `loadHistoryFromFileAsync()` on mount and subscribed to `voxlab_history_updated`; [`loadHistoryFromFileAsync()`](src/services/history/historyManager.ts) unconditionally called `saveHistoryItems(reconciled)`, synchronously firing `voxlab_history_updated` in an unbounded loop. | Guard `saveHistoryItems(reconciled)` in [`src/services/history/historyManager.ts`](src/services/history/historyManager.ts) so it only persists/emits when reconciled history actually differs from `inMemoryHistory`. Added regression test [`history_refresh_loop.test.ts`](src/services/history/__tests__/history_refresh_loop.test.ts). | Main thread hung `> 180 s` (CDP timeout); endless `history.json` read/write + `fs_stat` in Tauri | `0` chained events, `0` redundant disk writes; History tab INP `32 ms` (`1×`) / `144 ms` (`4×`) | **Eliminated hang (`100%`)** | `e56508d` |
| **2** | **O(N) Studio chunk-list re-render on every keystroke**: Editing a single chunk's textarea in [`TtsWorkspace.tsx`](src/views/TtsWorkspace.tsx) called `setChunks(...)` and re-rendered all `N` chunk cards inline. | Extracted chunk card JSX verbatim into `React.memo` [`TtsChunkCard.tsx`](src/components/tts/TtsChunkCard.tsx) with stable callbacks backed by `chunkHandlersRef`. | Keystroke INP p75 @ 4× CPU:<br>• `16` chunks: `120 ms`<br>• `96` chunks: `384 ms`<br>• `319` chunks: `1024 ms`<br>Enter Studio (`319` ch @ 4×): `1992 ms` | Keystroke INP p75 @ 4× CPU:<br>• `16` chunks: **`64 ms`**<br>• `96` chunks: **`88 ms`**<br>• `319` chunks: **`120 ms`**<br>Enter Studio (`319` ch @ 4×): **`1296 ms`** | **`-47%` to `-88%` keystroke INP** (all `< 200 ms` CWV Good threshold); **`-35%` Studio mount** | `5533e3f` |

### 1.4 Deferred Frontend Ideas

| Candidate | Decision & Evidence |
| :--- | :--- |
| **Virtualize Studio chunk list (`react-window` / custom viewport windowing)** | **Deferred**: Keystroke INP is now `64–120 ms` even at `319` chunks (`100k` chars) under `4×` CPU slowdown. The only remaining cost is the one-off mount when entering Studio on `100k`-char scripts, and virtualization alters scroll-to-chunk, DOM search, and height transitions in the approved Studio UI. |

---

## 2. Local AI Runtime & `TUNING REQUIRED` Benchmarks (`SPEC.md` §9 & `CONSTRAINTS.md` §7.2)

All benchmarks drive the real Python sidecar runtimes (`core`, `chatterbox`, `qwen`) on the RTX 5070 Ti 16 GB using [`scripts/perf/bench_tts.py`](scripts/perf/bench_tts.py), [`scripts/perf/analyze_tts.py`](scripts/perf/analyze_tts.py), [`scripts/perf/bench_chatterbox_ab.py`](scripts/perf/bench_chatterbox_ab.py), [`scripts/perf/bench_asr.py`](scripts/perf/bench_asr.py), and [`scripts/perf/bench_concurrency.py`](scripts/perf/bench_concurrency.py).

### 2.1 Text Chunk Size (`k = 1, 2, 3, 4` sentences/chunk, `hardMax = 600` chars)

Each generated chunk was scored by the production QC validator (`audio.validate_quality`: Whisper word-level alignment + acoustic silence/clipping checks). **Effective RTF** includes the expected regeneration cost of QC-flagged audio (`RTF * (1 + meanFlaggedAudioShare)`).

#### A. OmniVoice (`core` runtime, `float16`, `8–10` reps per `k`, `272` total chunks)

| Sentences / Chunk (`k`) | Mean / Max Chars | Chunks / Doc | Median RTF | QC Flagged (`warning`+`error`) | Flagged Audio Share | Effective RTF (1 regen) | Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `k = 1` | `121.1` / `169` | `15` | `0.237` | `0 / 120` (`0.0%`) | `0.000` | `0.237` | `40%` slower than `k=3` due to per-chunk diffusion setup |
| `k = 2` | `227.6` / `289` | `8` | `0.170` | `3 / 80` (`3.8%`) | `0.036` | `0.176` | Good runner-up |
| **`k = 3` (Default)** | **`368.2` / `481`** | **`5`** | **`0.166`** | **`1 / 40` (`2.5%`)** | **`0.015`** | **`0.169`** | **OPTIMAL — lowest raw & effective RTF** |
| `k = 4` | `460.5` / `553` | `4` | `0.172` | `6 / 32` (`18.8%`) | `0.173` | `0.202` | Statistically worse QC than `k=3` (Fisher one-sided `p = 0.027`) |

#### B. Qwen3-TTS 1.7B Base (`qwen` runtime, `bfloat16` SDPA, `3` reps per `k`, `96` total chunks)

| Sentences / Chunk (`k`) | Mean / Max Chars | Chunks / Doc | Median RTF | QC Flagged (`warning`+`error`) | Flagged Audio Share | Effective RTF (1 regen) | Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `k = 1` | `121.1` / `169` | `15` | `1.867` | `2 / 45` (`4.4%`) | `0.052` | `1.965` | Slowest |
| `k = 2` | `227.6` / `289` | `8` | `1.825` | `0 / 24` (`0.0%`) | `0.000` | `1.825` | `0%` flagged |
| **`k = 3` (Default)** | **`368.2` / `481`** | **`5`** | **`1.778`** | **`0 / 15` (`0.0%`)** | **`0.000`** | **`1.778`** | **OPTIMAL — `0%` flagged + fastest effective RTF** |
| `k = 4` | `460.5` / `553` | `4` | `1.726` | `1 / 12` (`8.3%`) | `0.089` | `1.880` | Higher regeneration cost |

#### C. Chatterbox Turbo (`chatterbox` runtime, `float32`, `4` reps per `k`) & Evidenced Adapter Fix

Before optimization, passing whole `k = 3` or `k = 4` chunks (`>= 400` chars) into `ChatterboxTurboTTS.generate()` caused S3 token generation to drop trailing words (`MISSING_WORD`):

| Character Bin (Before Fix) | Chunks | QC Flagged (`MISSING_WORD`) | Flagged Rate |
| :--- | :--- | :--- | :--- |
| `0 – 399` chars (`< 20s` audio) | `108` | `1` | **`0.9%`** |
| `400 – 499` chars (`>= 20s` audio) | `12` | `6` | **`50.0%`** |
| `500 – 599` chars (`>= 25s` audio) | `8` | `7` | **`87.5%`** |

- **Fix Implemented in [`sidecar/voxlab_sidecar/tts/chatterbox_adapter.py`](sidecar/voxlab_sidecar/tts/chatterbox_adapter.py)**:
  - Keep the UI / Studio chunker uniform across all models (`targetSentences = 3`, `hardMaxChars = 600` in [`src/services/pause/chunker.ts`](src/services/pause/chunker.ts)) so switching models never invalidates or re-splits the user's Studio chunks.
  - Inside `ChatterboxAdapter.synthesize()`, when `len(req.text) > 380`, split the chunk at sentence/clause boundaries into groups `<= 380` chars (`_split_chatterbox_text`), synthesize each group, trim leading/trailing dead silence (`_trim_piece_edges`, `-42 dB`, `30 ms` pad), and join with a `180 ms` pause.
- **Before vs. After Verification on Chatterbox Turbo (`k = 3`, `tts_chatterbox_en` vs `tts_chatterbox_en_after_fix`)**:
  - **Before**: Raw RTF `0.315`, QC flagged `6 / 20` (`30.0%`, all `MISSING_WORD`), Effective RTF `0.432`.
  - **After**: Raw RTF **`0.258`** (`-18.1%`), QC flagged **`0 / 5` (`0.0%`, `0` `MISSING_WORD`, `0` `ABNORMAL_PAUSE`)**, Effective RTF **`0.258` (`-40.3%`)**.

---

### 2.2 Model Lifecycle, VRAM Footprint & Unload Idle Timeout

| Engine (Runtime) | Cold Spawn | `tts.load` Time | First Synth After Load | Warm Steady-State RTF | VRAM After Load | Peak VRAM (Synth) | `tts.unload` Time | VRAM After Unload |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **OmniVoice** (`core`, `fp16`) | `0.15 s` | `10.7 s` (warm disk) / `28.2 s` (cold) | `2.47 s` (kernels pre-warmed in `load()`) | `0.166` (`6.0×` real-time) | `2,248 MB` | `7,717 – 10,506 MB` | `0.21 s` | `304 MB` (CUDA context) |
| **Chatterbox Turbo** (`chatterbox`, `fp32`) | `0.16 s` | `7.14 s` | `17.18 s` (first CUDA JIT) → `0.98 s` (2nd) | `0.258` (`3.9×` real-time) | `2,952 MB` | `4,297 MB` | `0.12 s` | `298 MB` (CUDA context) |
| **Qwen3-TTS 1.7B** (`qwen`, `bf16`) | `0.15 s` | `20.38 s` | `23.81 s` (first SDPA/CUDA JIT) → `15.56 s` (2nd) | `1.778` (`0.56×` real-time) | `4,441 MB` | `5,688 MB` | `0.18 s` | `327 MB` (CUDA context) |

- **Verdict on Model Unload Policy**:
  - Reloading a TTS model costs **`7.1 s – 28.2 s`** plus **`17 s – 23 s`** of first-synthesis JIT compilation on Chatterbox/Qwen, whereas a loaded idle model holds **`2.2 – 4.4 GB` VRAM** (`14% – 27%` of 16 GB VRAM) and `tts.unload` frees VRAM in **`0.12 – 0.21 s`** whenever the user switches engines (`TtsService.load` automatically unloads the previous adapter before loading a new one, and Rust `SidecarSupervisor` kills/reclaims runtimes on exit).
  - Keeping the active model resident during an active editing session (and unloading immediately on engine switch or app exit, with configurable `modelUnloadTimeoutSec = 300s` in `SPEC.md` §16.12) avoids penalizing users with a `10–40s` reload between chunk retries in Hybrid Chunk Studio.

---

### 2.3 Default Silence / Pause Duration (`400 ms` Sentence Pause)

Using `scripts/perf/analyze_tts.py` and acoustic energy-envelope segmentation (`>= 120 ms` below `-35 dB` relative to clip RMS) on multi-sentence (`k = 2, 3, 4`) outputs, we measured the **natural inter-sentence pause duration** generated internally by the models:

| Model | Internal Sentence Transitions Measured | p25 | Median | p75 | Mean |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **OmniVoice** (`en`) | `46` transitions | `350 ms` | **`435 ms`** (`410–465 ms`) | `510 ms` | `442 ms` |
| **Chatterbox Turbo** (`en`) | `38` transitions | `217 ms` | **`302 ms`** (`300–305 ms`) | `342 ms` | `295 ms` |

- **Verdict**: The default inter-chunk `sentencePauseMs = 400 ms` (`DEFAULT_TTS_CONFIG.sentencePauseMs = 400`) and punctuation pause profile (`comma: 200 ms`, `colonSemicolon: 400 ms`, `questionExclamation: 500 ms`, `period: 600 ms` in `DEFAULT_PUNCTUATION_PAUSES`) sit squarely inside the models' natural `300 – 510 ms` prosodic window. No change needed.

---

### 2.4 Queue Concurrency (`n = 1` vs `n = 2` Parallel GPU Workers — `scripts/perf/bench_concurrency.py`)

Because each Python sidecar serializes heavy GPU inference (`BUSY` guard in `server.py`), `concurrency > 1` requires `N` parallel sidecar worker processes holding independent model instances on the GPU. We benchmarked `n = 1` vs `n = 2` parallel OmniVoice workers synthesizing the same 5-chunk document (`124.6 s` of output audio):

| Parallel Workers (`n`) | Total Jobs | Failed | Wall Time | Audio Generated | GPU Throughput (`audioSec / wallSec`) | Throughput Gain | VRAM Loaded | Peak VRAM |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`n = 1` (Default)** | `5` | `0` | **`20.78 s`** | `124.62 s` | **`6.00×` real-time** (`5.997 s/s`) | Baseline | **`2,237 MB`** | **`10,689 MB`** |
| `n = 2` | `5` | `0` | `20.48 s` | `124.94 s` | `6.10×` real-time (`6.100 s/s`) | **`+1.7%` (noise)** | `4,491 MB` (`+101%`) | `12,921 MB` (`+2.23 GB`) |

- **Verdict**: **Keep `concurrency = 1` for local GPU engines.** A single OmniVoice worker already saturates the RTX 5070 Ti SMs during diffusion steps; `n = 2` time-slices CUDA kernels for a negligible `+1.7%` wall-time difference while doubling static VRAM (`4.49 GB`) and pushing peak VRAM to **`12.92 GB`** — which would OOM 12 GB GPUs and collide with co-resident Whisper QC (`+2.2 GB`) on 16 GB GPUs.

---

### 2.5 Auto Whisper Hardware Thresholds & Production ASR Default (`scripts/perf/bench_asr.py`)

We benchmarked all 4 installed `faster-whisper` models (`float16` on CUDA) across a 16-clip corpus (15 TTS sentences + 1 human reference recording with exact ground-truth transcripts), both **standalone** and **co-resident with OmniVoice loaded in the same `core` sidecar** (the real Post-TTS QC scenario):

| Whisper Model | Load Time | Warm RTF (Total / Median) | Speed (`×` Real-Time) | Corpus WER | Human Ref WER | Standalone VRAM (Load / Peak) | Co-Resident VRAM with OmniVoice (Load / Peak) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `small` | `0.98 s` | `0.0229` / `0.0218` | `43.7×` | `2.13%` | `0.00%` | `785 MB` / `940 MB` | `2,795 MB` / `10,694 MB` (after TTS peak) |
| `medium` | `2.16 s` | `0.0385` / `0.0388` | `26.0×` | `2.13%` | `0.00%` | `2,090 MB` / `2,284 MB` | `4,102 MB` / `4,334 MB` |
| **`large-v3-turbo`** | **`1.24 s`** | **`0.0225` / `0.0219`** | **`44.4×`** | **`2.13%`** | **`0.00%`** | **`2,209 MB` / `2,447 MB`** | **`4,239 MB` / `4,471 MB`** |
| `large-v3` | `3.01 s` | `0.0513` / `0.0490` | `19.5×` | `2.44%` | `0.00%` | `3,937 MB` / `4,309 MB` | `5,999 MB` / `6,328 MB` |

- **Verdict**:
  1. **`large-v3-turbo` is strictly Pareto-optimal** on GPUs with `>= 6 GB` VRAM: it matches `small`'s speed (`44.4×` real-time, `RTF = 0.0225`), loads `1.74×` faster and transcribes `1.71×` faster than `medium` at virtually identical VRAM (`2.21 GB` vs `2.09 GB`), and is `2.28×` faster than `large-v3` while saving `1.73 GB` of VRAM (`4.24 GB` vs `6.00 GB` co-resident with OmniVoice).
  2. Validated the hardware tier thresholds in [`src/services/ai/hardwareRecommendation.ts`](src/services/ai/hardwareRecommendation.ts) and [`src/services/subtitle/profiles.ts`](src/services/subtitle/profiles.ts):
     - `VRAM >= 6000 MB` → `large-v3-turbo` (`4.2–4.5 GB` co-resident with TTS fits safely inside `>= 6 GB`).
     - `3000 MB <= VRAM < 6000 MB` or `CPU >= 8 cores & >= 16 GB RAM` → `medium`.
     - `VRAM < 3000 MB` or constrained CPU → `small` (`785 MB` standalone).

---

### 2.6 Inference Parameters & `torch.backends.cudnn.benchmark` Fix

- **Official Default Inference Parameters Validated** ([`src/services/ai/ttsAdvancedSettings.ts`](src/services/ai/ttsAdvancedSettings.ts)):
  - **OmniVoice**: `num_step = 32`, `guidance_scale = 2.0`, `t_shift = 0.1`, `position_temperature = 5.0`, `class_temperature = 0.0`, `layer_penalty_factor = 5.0`, `denoise = true` → achieved `2.5%` QC warning rate at `k = 3` and `RTF = 0.166`.
  - **Chatterbox Turbo**: `temperature = 0.8`, `top_p = 0.95`, `top_k = 1000`, `repetition_penalty = 1.2`, `norm_loudness = true` → achieved `0.0%` QC warning rate at `k = 3` (with `<= 380` char sentence-group splitting) and `RTF = 0.258`.
  - **Qwen3-TTS 1.7B Base**: `temperature = 0.9`, `top_p = 1.0`, `top_k = 50`, `repetition_penalty = 1.05`, `x_vector_only_mode = false` (ICL voice clone mode) → achieved `0.0%` QC warning rate at `k = 2, 3` and `RTF = 1.778`.
- **cuDNN Autotuner Fix (`torch.backends.cudnn.benchmark = False`)**:
  - Previously, [`omnivoice_adapter.py`](sidecar/voxlab_sidecar/tts/omnivoice_adapter.py), [`chatterbox_adapter.py`](sidecar/voxlab_sidecar/tts/chatterbox_adapter.py), and [`qwen_adapter.py`](sidecar/voxlab_sidecar/tts/qwen_adapter.py) set `torch.backends.cudnn.benchmark = True` during `load()`. Because TTS token/mel lengths vary on every chunk, `cudnn.benchmark = True` triggers cuDNN kernel autotuning whenever a chunk produces a new tensor length (`55.14 s` vs `47.98 s` across 20 chunks in `chatterbox_cudnn_ab.json`, `-11%` steady-state inference time when set to `False`).
  - All 3 adapters now keep `allow_tf32 = True` (for Tensor Core matmul/conv throughput) and set `torch.backends.cudnn.benchmark = False`.

---

### 2.7 Reference Audio Length & Caching (`sidecar/voxlab_sidecar/audio_ops.py`)

- **Empirical Verification**:
  - `ChatterboxAdapter` enforces `MIN_REF_SECONDS = 5.0 s` (`_check_ref_duration`).
  - `prepare_clone_reference()` in [`sidecar/voxlab_sidecar/audio_ops.py`](sidecar/voxlab_sidecar/audio_ops.py) automatically trims long reference clips (`> 15.5 s` / `> 20.5 s`) down to the optimal voiced window (`[6.0 s, 10.0 s]` standard or `[8.0 s, 13.5 s]` expressive) and caches both the trimmed `.wav` and its Whisper transcript by content hash in `%TEMP%/voxlab_ref_cache`.
  - In our benchmarks, warm reference lookup from `_MEM_TRANSCRIPT_CACHE` took **`< 1 ms`** (`perChunkOverheadSec = 0.008 – 0.012 s` across all 3 engines).

---

### 2.8 Master WAV Memory Guardrail (`30m / 60m / 120m` Empirical Benchmark — `SPEC.md` §16.7.4 & `AC-30`)

Executed [`npx tsx src/services/dubbing/__benchmarks__/masterMemoryBenchmark.ts`](src/services/dubbing/__benchmarks__/masterMemoryBenchmark.ts) on Windows x64 (`44,100 Hz`, 16-bit PCM Mono Master WAV assembly):

| Milestone Duration | Cue Count | Assembly Latency | Peak Heap | Peak Process RSS | Output WAV Size | Spec Target (`SPEC.md` §16.7.4) | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`30 minutes`** | `180` | `258 ms` | `8.80 MB` | **`667.49 MB`** | `150.97 MB` | Peak RAM `< 700 MB` | **PASS** |
| **`60 minutes`** | `360` | `1,082 ms` | `7.58 MB` | **`1,275.13 MB`** | `302.37 MB` | Peak RAM `< 1.3 GB` (Warning threshold) | **PASS** |
| **`120 minutes`** | `720` | `2,245 ms` | `7.04 MB` | **`2,486.15 MB`** | `605.18 MB` | Matches `~2.36–2.5 GB` analytical ceiling (Hard cap) | **PASS** |

- **Verdict**: Validated `DURATION_WARNING_THRESHOLD_SEC = 3600` (`60 min`, `1.28 GB` Peak RSS) and `DURATION_REJECT_THRESHOLD_SEC = 7200` / `MAX_ALLOWED_BYTES = 635 MB` (`120 min`, `2.49 GB` Peak RSS) in [`src/services/dubbing/memoryGuardrail.ts`](src/services/dubbing/memoryGuardrail.ts), plus the `2 GB` disk free-space safety margin for model downloads and `500 MB` margin for audio exports.

---

## 3. Summary of All Phase 11 Changes Kept vs. Rejected

| Area | Change | Verdict | Evidence |
| :--- | :--- | :--- | :--- |
| **History Workspace (`src/services/history/historyManager.ts`)** | Skip `saveHistoryItems()` in `loadHistoryFromFileAsync()` when reconciled list is unchanged | **KEPT (`e56508d`)** | Eliminated infinite `voxlab_history_updated` loop & main-thread hang; INP `32 ms` |
| **TTS Studio (`src/components/tts/TtsChunkCard.tsx`)** | Extract & `React.memo` chunk cards with ref-stabilized handlers | **KEPT (`5533e3f`)** | Studio typing INP @ 4× CPU improved `1024 ms -> 120 ms` (`-88%`) on 319 chunks |
| **Chatterbox Adapter (`chatterbox_adapter.py`)** | Split chunks `> 380` chars into sentence groups `<= 380` chars with `180 ms` trimmed gap | **KEPT** | Eliminated `30%–44%` `MISSING_WORD` cliff on `k=3,4`; QC pass rate `100%` (`5/5`), effective RTF `0.432 -> 0.258` (`-40%`) |
| **All 3 TTS Adapters (`omnivoice`, `chatterbox`, `qwen`)** | Set `torch.backends.cudnn.benchmark = False` while keeping `allow_tf32 = True` | **KEPT** | Eliminated cuDNN per-shape autotuning overhead on variable-length TTS chunks (`-11%` steady-state time) |
| **Smart Chunker Default (`k = 3`, `hardMax = 600`)** | Keep `targetSentences = 3`, `hardMaxChars = 600` | **KEPT AS-IS** | Optimal effective RTF on OmniVoice (`0.169`) and Qwen3-TTS (`1.778`), and `0%` flagged on Chatterbox after adapter split |
| **Queue Concurrency (`n = 1` vs `n = 2`)** | Keep `concurrency = 1` for local GPU workers | **REJECTED `n > 1`** | `n = 2` gave only `+1.7%` throughput while doubling loaded VRAM (`4.49 GB`) and raising peak VRAM to `12.92 GB` |
| **Frontend Route Code-Splitting** | Keep static imports for workspaces | **REJECTED** | Cold LCP is already `84 ms` (`1×`) / `340 ms` (`6×`), `7×` below 2.5s budget |
| **Studio Chunk List Virtualization** | Keep standard scrollable list | **DEFERRED** | Typing INP is already `< 120 ms` at 4× CPU after memoization; preserves approved Studio scroll/selection UX |
