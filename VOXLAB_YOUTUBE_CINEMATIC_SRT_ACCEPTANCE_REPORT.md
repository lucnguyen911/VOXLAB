# VOXLAB YOUTUBE CINEMATIC SRT ACCEPTANCE REPORT (PHASE B)

**Repository:** `lucnguyen911/VOXLAB`  
**Branch:** `master`  
**Phase A Baseline Commit:** `3a93aad961332eb8d6261c6b8ad03af5a1a2103a`

---

## 1. Root Cause Analysis of Legacy `14.srt` (Chunk-Copying Defect)

In the legacy implementation:
1. **`generateSrtFromChunks()` (`src/services/audio/masterExport.ts`)** called `generateSubtitlesFromChunks(chunks)` where `buildSpeechUnitsFromChunks()` mapped each TTS synthesis chunk (`200–350` characters, `13–23` seconds) into a single monolithic `SpeechUnit` (`isHardBoundary: true`).
2. **`generateSubtitlesFromChunks()` (`src/services/subtitle/pipeline.ts`)** pushed `1 SpeechUnit = 1 SubtitleCue` directly without decomposing clauses, without running ASR word-timestamp alignment on the Master WAV, and without wrapping into balanced 1–2 lines.
3. Consequently, exporting `14.srt` from an 85-chunk TTS session produced **85 single-line cues** averaging **211.5 characters** per line (up to **352 characters**) and **13.87 seconds** duration per cue, using estimated chunk durations rather than acoustic speech boundaries.

---

## 2. New ASR-Driven YouTube Cinematic Subtitle Architecture

All SRT generation workflows across **TTS Studio**, **Dialogue Studio**, **Batch TTS**, **Batch Transcription**, and the **Subtitle (Phụ đề) Tab** now follow a unified ASR-driven YouTube Cinematic Subtitle pipeline:

```mermaid
flowchart LR
    A["Master Audio (WAV/MP3)"] --> B["Unified ASR Engine (word_timestamps=True)"]
    B --> C["Script-Assisted Orthographic Recovery"]
    C --> D["Protected Span Map (Numbers, Units, Proper Nouns, Lists)"]
    D --> E["Semantic & Clause Scoring + Global DP Segmentation"]
    E --> F["Balanced 1-2 Line Wrapper (16:9<=32, 1:1<=29, 9:16<=26)"]
    F --> G["Acoustic Onset Alignment (-30 dBFS) & CPS Boundary Smoothing"]
    G --> H["Hard Invariant Validator (Content, Layout, Timing, Anti-Chunk-Copy)"]
    H --> I["SubRip (.srt) Export"]
```

### Key Architectural Components

1. **Sidecar YouTube Cinematic Subtitle Optimizer (`sidecar/voxlab_sidecar/subtitle_optimizer.py`):**
   - **Layout Profiles:**
     - `16:9` (YouTube Landscape): `max_width = 32`, `target_width = 26`, `max_lines = 2`, `target_cps = 14.5`, `max_cps = 20.0`, `min_duration = 1.0s`, `max_duration = 5.5s`.
     - `1:1` (Square): `max_width = 29`, `target_width = 24`, `max_lines = 2`.
     - `9:16` (Shorts/Reels/TikTok): `max_width = 26`, `target_width = 21`, `max_lines = 2`.
   - **Script-Assisted Orthographic Recovery (`recover_orthography_from_script`):**
     - Uses acoustic word timestamps from `AsrEngine` (`word_timestamps=True`) while recovering exact brand capitalization (`PepsiCo`, `Sysco`, `Tesla's`) and compact technical notation (`1.55 kWh per mile`, `82,000`) from the source script when spoken forms match.
   - **Protected Spans (`build_protected_boundary_map`):**
     - Protects numbers + units + rate phrases (`1.55 kWh per mile`, `2 kilowatt hours per mile`, `82,000 pounds`, `37 tons`, `13.5 million real miles`), 3-item coordinate noun lists (`cars, trucks, and robots`), 2-item proper noun pairs (`PepsiCo and Sysco`), and prohibits dangling function words (`FORBIDDEN_ENDINGS`: articles, prepositions, auxiliaries, conjunctions, possessives, pronouns) at the end of a cue or line 1.
   - **Global Dynamic Programming + Balanced 1–2 Line Wrapping (`_segment_block`, `_wrap_words`):**
     - Evaluates candidate cues over `[1..16]` words, rewarding natural punctuation, clause conjunction boundaries (`.`, `?`, `!`, `, and`, `, or`, `, but`), and pause gaps (`>= 0.25s`), while penalizing high CPS, line imbalance, and unpunctuated mid-phrase splits.
   - **Acoustic Onset Alignment & CPS Smoothing (`_assign_display_times`):**
     - Aligns cue start times to the actual `-30 dBFS` speech onset in the 16 kHz waveform and bidirectionally smooths cue boundaries across natural inter-cue silence so reading speed stays within `<= 20.0 CPS` without creating any overlap.
   - **Hard Invariant Validator (`validate_final_cues`):**
     - Enforces `content_invariant` (100% normalized lexical preservation), `layout` (`<= max_lines`, `<= max_width`), `timing` (`0` overlaps, monotonic timestamps), `forbidden_endings` (`0` dangling function words at cue end), `max_cps` (`<= 20.0`), and `anti_chunk_copy` (`total_cues >= source_chunk_count * 2.5` for multi-chunk scripts).
   - **Zero-Redundant ASR Cache (`_MASTER_ASR_CACHE`):**
     - Keyed by `(abspath, mtime_ns, size, canonical_model_id, language)`. Switching aspect ratios (`16:9` / `9:16` / `1:1`) or `maxLines` (`1` / `2`) re-runs the DP optimizer in `< 50 ms` without re-invoking Whisper.

2. **Desktop Runtime & UI Integration:**
   - **RPC Endpoints (`sidecar/voxlab_sidecar/__main__.py` & `src/services/ai/localAiServices.ts`):** Added `subtitle.generate_srt` (heavy) and `subtitle.optimize` (light).
   - **Master Export (`src/services/audio/masterExport.ts`):** Added `generateMasterSrtWithAsr()` and upgraded `generateSrtFromChunks()` / `generateSubtitlesFromChunks()` to decompose chunks into YouTube Cinematic cues.
   - **TTS Workspace (`src/views/TtsWorkspace.tsx`):** Displays clear step-by-step progress (`Đang ghép Master Audio...` -> `Đang nhận dạng & căn chỉnh phụ đề bằng <Model>...` -> `Đang tối ưu phụ đề YouTube...` -> `Hoàn tất xuất WAV + SRT`) and exports ASR-aligned cinematic SRT alongside Master WAV.
   - **Dialogue, Batch TTS, Batch Transcription, and Subtitle Tab (`DialogueWorkspace.tsx`, `ttsExecutor.ts`, `transcriptionExecutor.ts`, `TranscriptionWorkspace.tsx`):** All wired to the unified YouTube Cinematic Subtitle Optimizer.

---

## 3. Mandatory 7-Sentence Benchmark Results

Verified via `sidecar/tests/test_subtitle_optimizer.py` (`9/9` tests passing):

### Sentence 1
**Input:** `If you are over 55, you remember when a diesel truck meant America was working.`
```text
Cue 1:
If you are over 55,

Cue 2:
you remember when a diesel truck
meant America was working.
```

### Sentence 2
**Input:** `Tesla's Semi pulls 82,000 pounds, about 37 tons, with a motor roughly the size of one single piston from a 15-liter diesel engine.`
```text
Cue 1:
Tesla's Semi pulls
82,000 pounds, about 37 tons,

Cue 2:
with a motor roughly the size
of one single piston

Cue 3:
from a 15-liter diesel engine.
```

### Sentence 3
**Input:** `That is less than 2 kilowatt hours per mile, or more precisely 1.55 kWh per mile.`
```text
Cue 1:
That is less than
2 kilowatt hours per mile,

Cue 2:
or more precisely
1.55 kWh per mile.
```

### Sentence 4
**Input:** `It is coming for the money, and when freight costs change, the price of everything you buy changes with it.`
```text
Cue 1:
It is coming for the money,
and when freight costs change,

Cue 2:
the price of everything
you buy changes with it.
```

### Sentence 5
**Input:** `One architecture across cars, trucks, and robots.`
```text
Cue 1:
One architecture
across cars, trucks, and robots.
```

### Sentence 6
**Input:** `PepsiCo and Sysco have already logged millions of miles.`
```text
Cue 1:
PepsiCo and Sysco have already
logged millions of miles.
```

### Sentence 7
**Input:** `Shut it down.`
```text
Cue 1:
Shut it down.
```

---

## 4. Real-World Acceptance Verification on `14.wav` (20m19s Master Audio, 85 Chunks)

Executed using `large-v3-turbo` on `C:\Users\lucng\Downloads\14.wav` with the 85 source chunks from `C:\Users\lucng\Downloads\14.srt`:

| Metric | Legacy VoxLab (`14.srt`) | Reference Audio Factory (`001_14.srt`) | New VoxLab Cinematic (`14_voxlab_cinematic.srt`) | Requirement | Status |
|---|---:|---:|---:|---|:---:|
| **Total Cues** | 85 | 461 | **472** | `380 – 520` (Anti-chunk-copy) | **PASS** |
| **Max Lines per Cue** | 1 (unwrapped) | 2 | **2** (`avg 1.59`) | `<= 2 lines` (`0` cues > 2 lines) | **PASS** |
| **Average Line Length** | 211.5 chars | ~23 chars | **22.0 chars** | `<= 32 chars` (`16:9` YouTube) | **PASS** |
| **Max Line Length** | 352 chars | 38 chars | **32 chars** | `<= 32 chars` (`0` lines > 32) | **PASS** |
| **Lines > 32 Characters** | 85 / 85 (100%) | 12 | **0 / 751 (0%)** | `0` violations | **PASS** |
| **Average Cue Duration** | 13.87 s | ~2.5 s | **2.47 s** | `1.0 s – 5.5 s` | **PASS** |
| **Average / Max CPS** | 15.3 / 15.9 | ~14.8 / 21.5 | **14.6 / 19.9** | `<= 20.0 CPS` | **PASS** |
| **Timestamp Overlaps** | 0 | 0 | **0** | `0` overlaps | **PASS** |
| **Forbidden Cue Endings** | N/A | N/A | **0** | `0` dangling function words | **PASS** |
| **Content Preservation** | 100% | ASR-only | **100%** (Script-recovered) | Zero word loss/addition | **PASS** |

### First 25 Cues of Generated `14_voxlab_cinematic.srt`

```srt
1
00:00:00,000 --> 00:00:01,560
If you are over 55,

2
00:00:01,920 --> 00:00:05,460
you remember when a diesel truck
meant America was working.

3
00:00:05,480 --> 00:00:07,520
The rumble at the truck stop.

4
00:00:07,680 --> 00:00:09,947
The black smoke
on the interstate.

5
00:00:10,180 --> 00:00:13,280
The paycheck that kept
your whole town alive.

6
00:00:13,600 --> 00:00:16,440
Now a factory in Nevada
is building a machine

7
00:00:16,440 --> 00:00:17,500
that analysts say

8
00:00:17,500 --> 00:00:19,640
was designed to squeeze
all of that.

9
00:00:19,640 --> 00:00:24,460
Tesla's Semi pulls
82,000 pounds, about 37 tons,

10
00:00:24,680 --> 00:00:27,920
with a motor roughly the size
of one single piston

11
00:00:27,920 --> 00:00:30,360
from a 15-liter diesel engine.

12
00:00:30,840 --> 00:00:32,940
Pilot trucks have already logged

13
00:00:32,940 --> 00:00:36,540
more than
13.5 million real miles.

14
00:00:36,640 --> 00:00:38,740
This truck is not
coming for glory.

15
00:00:38,760 --> 00:00:42,627
It is coming for the money,
and when freight costs change,

16
00:00:42,780 --> 00:00:45,640
the price of everything
you buy changes with it.

17
00:00:45,640 --> 00:00:47,520
If you drove one,

18
00:00:47,600 --> 00:00:48,900
loved someone who did,

19
00:00:48,920 --> 00:00:51,740
or simply count
on full grocery shelves,

20
00:00:51,860 --> 00:00:53,280
this affects you.

21
00:00:53,400 --> 00:00:54,300
Stay with me,

22
00:00:54,305 --> 00:00:56,164
because the part
that should frighten

23
00:00:56,164 --> 00:00:58,780
the diesel industry is not
the truck itself.

24
00:00:58,800 --> 00:01:01,240
It is what Tesla
built behind it,

25
00:01:01,240 --> 00:01:02,880
and by the end of this video,
```

---

## 5. Automated Test & Build Verification Summary

- **Python Sidecar Unit Tests (`136/136` passing):**
  - `..\sidecar\.venv\Scripts\python.exe -m unittest discover -s tests -v` -> `Ran 136 tests in 7.070s - OK` (includes `test_subtitle_optimizer.py`, `test_audio_quality.py`, `test_unified_asr_lifecycle.py`).
- **TypeScript Unit Tests (`69/69` passing):**
  - `npx tsx --test src/services/subtitle/__tests__/subtitle_pipeline.test.ts src/services/subtitle/__tests__/subtitles_settings_workflow.test.ts src/services/dialogue/__tests__/assembly.test.ts src/services/pause/__tests__/punctuation_pause_rhythm.test.ts src/views/__tests__/subtitles_workflow.test.ts src/services/audio/__tests__/quality_validator_preflight_recovery.test.ts src/services/ai/__tests__/hardware_recommendation.test.ts` -> `69 pass, 0 fail`.
- **Frontend & Rust Desktop Compilation:**
  - `npx tsc --noEmit` -> `0 errors`
  - `npm run build` -> `✓ built in 4.32s`
  - `cargo check` (`src-tauri`) -> `Finished dev profile in 5.53s (0 errors)`
