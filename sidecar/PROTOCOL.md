# VoxLab AI Sidecar — IPC Contract v1

Transport: **JSON Lines** over the sidecar process stdin/stdout (UTF-8, one JSON object per line).

- `stdout` carries **protocol messages only**.
- `stderr` carries human-readable diagnostics. Never contains license keys, API keys or user text bodies.
- The sidecar **never downloads models**. It runs with `HF_HUB_OFFLINE=1`; every model is loaded from an
  explicit local directory supplied by the caller (VoxLab Models directory managed by Settings).
- Audio is exchanged **by file path**, never as base64 over the pipe.

## Messages

Request (host → sidecar):

```json
{"id": "r-1", "method": "asr.transcribe", "params": { ... }}
```

Progress event (sidecar → host, zero or more per request):

```json
{"id": "r-1", "event": "progress", "data": {"pct": 42.0, "stage": "transcribing"}}
```

Terminal response (sidecar → host, exactly one per request):

```json
{"id": "r-1", "ok": true,  "result": { ... }}
{"id": "r-1", "ok": false, "error": {"code": "MODEL_NOT_FOUND", "message": "..."}}
```

Unsolicited startup message: `{"event": "ready", "data": {"protocol": 1, "pid": 1234}}`.

## Methods

| Method | Params | Result |
|---|---|---|
| `system.ping` | – | `{pong: true}` |
| `system.info` | – | python/torch/cuda/ctranslate2 versions, GPU name, VRAM, loaded models |
| `system.shutdown` | – | `{}` then process exits 0 |
| `cancel` | `{target: "<request id>"}` | `{cancelRequested: bool}` |
| `asr.load` | `{modelDir, device: "auto"\|"cuda"\|"cpu", computeType?}` | `{device, computeType, loadSec}` |
| `asr.transcribe` | `{audioPath, language?: "auto"\|code, wordTimestamps: bool, beamSize?, vad?: bool}` | `{language, languageProbability, durationSec, segments:[{id,startSec,endSec,text,words?:[{startSec,endSec,word,probability}]}]}` |
| `asr.unload` | – | `{}` |
| `tts.load` | `{modelDir, device: "auto"\|"cuda"\|"cpu"}` | `{device, dtype, sampleRate, loadSec}` |
| `tts.synthesize` | `{text, outputPath, language?, refAudioPath?, refText?, speed?, numStep?}` | `{outputPath, sampleRate, durationSec, inferenceSec}` |
| `tts.unload` | – | `{}` |

Only one inference (`asr.transcribe` / `tts.synthesize` / `*.load`) runs at a time; a second one returns `BUSY`.

## Cancellation

- `cancel` sets a cooperative flag. ASR checks it between decoded segments; TTS checks it between sentences.
- A cancelled request terminates with `ok:false, code: "CANCELLED"`. Partial output files are deleted.
- Hard cancel (an engine call that cannot be interrupted) is performed by the host killing the process;
  the host then reports `SIDECAR_CRASHED`/`CANCELLED` and respawns on next use (crash recovery).

## Error codes

`INVALID_REQUEST`, `UNKNOWN_METHOD`, `BUSY`, `CANCELLED`, `MODEL_NOT_FOUND`, `MODEL_NOT_LOADED`,
`MODEL_LOAD_FAILED`, `DEVICE_UNAVAILABLE`, `INPUT_NOT_FOUND`, `INFERENCE_FAILED`, `OUT_OF_MEMORY`,
`ENGINE_NOT_INSTALLED`, `INTERNAL`.

Host-side only (Rust): `SIDECAR_NOT_FOUND`, `SIDECAR_SPAWN_FAILED`, `SIDECAR_CRASHED`, `SIDECAR_TIMEOUT`.

## Device policy

`auto` → CUDA when the engine reports a usable CUDA device; otherwise CPU **only if the engine has been
verified to run on CPU**. An engine that cannot run on the selected device returns `DEVICE_UNAVAILABLE`
— it never silently pretends.
