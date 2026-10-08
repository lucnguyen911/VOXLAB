/**
 * LocalAiServices — the single dependency Batch/TTS/Dialogue/Dubbing use for local inference.
 * Engine-agnostic: callers pass a VoxLab model id; the TtsEngineAdapter registry decides the runtime.
 *
 * Model lifecycle: one TTS model resident at a time (Rust unloads other runtimes on `tts.load`).
 */
import { AiBackend, AiError, AiRuntime, newRequestId } from "./types";
import {
  DevicePreference,
  TtsEngineCapabilities,
  checkEngineSupport,
  resolveLocalEngine,
} from "./ttsEngines";
import { getEngineAdvancedSettings } from "./ttsAdvancedSettings";

export interface AiFs {
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  listDir(path: string): Promise<string[]>;
  removeFile(path: string): Promise<void>;
  scratchDir(name: string): Promise<string>;
}

export interface AiRuntimeSettings {
  modelsDir: string;
  device: DevicePreference;
  /** Folder name of the faster-whisper model in modelsDir. Dev baseline: "faster-whisper-small". */
  asrModelId: string;
}

export interface VoiceReference {
  refAudioPath: string;
  refText?: string;
  language?: string;
}

/** Returns the clone reference for a voice id, or null for an engine's built-in/default voice. */
export type VoiceReferenceResolver = (voiceId: string) => VoiceReference | null;

export interface SynthesizeRequest {
  model: string;
  voiceId: string;
  text: string;
  outputPath: string;
  language?: string;
  speed?: number;
  sampleRate?: number;
  advancedSettings?: Record<string, unknown>;
  onProgress?: (pct: number, stage: string) => void;
}

export interface SynthesizeResult {
  outputPath: string;
  durationSec: number;
  sampleRate: number;
  engine: string;
}

export interface AsrSegment {
  id: number;
  startSec: number;
  endSec: number;
  text: string;
  words?: { startSec: number; endSec: number; word: string; probability: number }[];
}

export interface TranscribeResult {
  language: string;
  languageProbability: number;
  durationSec: number;
  segments: AsrSegment[];
}

export interface AssembleInput {
  path: string;
  gapAfterMs?: number;
  startSec?: number;
}

export interface AssembleResult {
  outputPath: string;
  format: "wav" | "mp3";
  sampleRate: number;
  durationSec: number;
  peakAmplitude: number;
  segments: { index: number; startSec: number; endSec: number; durationSec: number }[];
}

const VI_DIACRITICS = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;

/** Minimal guard so an English-only engine is never fed Vietnamese text silently. */
export function detectTextLanguage(text: string): string | undefined {
  return VI_DIACRITICS.test(text) ? "vi" : undefined;
}

function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  return dir.endsWith(sep) ? dir + name : dir + sep + name;
}

export class LocalAiServices {
  private loadedTts: { runtime: AiRuntime; key: string } | null = null;
  private loadedAsrKey: string | null = null;
  private active: { runtime: AiRuntime; requestId: string } | null = null;

  constructor(
    private readonly backend: AiBackend,
    readonly fs: AiFs,
    private readonly settings: () => AiRuntimeSettings,
    private readonly resolveVoice: VoiceReferenceResolver = () => null
  ) {}

  /** Throws AiError("UNSUPPORTED") with a user-facing reason — never falls back to another engine. */
  resolveEngine(model: string, voiceId: string, text: string, language?: string, speed?: number): {
    caps: TtsEngineCapabilities;
    ref: VoiceReference | null;
    language?: string;
  } {
    const caps = resolveLocalEngine(model);
    if (!caps) {
      throw new AiError("UNSUPPORTED", `Model "${model}" không phải engine local (OmniVoice / Chatterbox Turbo / Qwen TTS).`);
    }
    const ref = this.resolveVoice(voiceId);
    const lang = language || ref?.language || detectTextLanguage(text);
    const check = checkEngineSupport(caps, {
      language: lang,
      hasReferenceAudio: Boolean(ref?.refAudioPath),
      hasReferenceText: Boolean(ref?.refText?.trim()),
      speed,
      device: this.settings().device,
    });
    if (!check.ok) throw new AiError("UNSUPPORTED", check.reason || "Engine không hỗ trợ yêu cầu này.");
    return { caps, ref, language: lang };
  }

  private async call<T>(runtime: AiRuntime, method: string, params: Record<string, unknown>,
                        onProgress?: (pct: number, stage: string) => void): Promise<T> {
    const requestId = newRequestId(method.replace(/\W/g, ""));
    this.active = { runtime, requestId };
    try {
      return await this.backend.request<T>(runtime, method, params, {
        requestId,
        onProgress: onProgress ? (p) => onProgress(p.pct, p.stage) : undefined,
      });
    } finally {
      if (this.active?.requestId === requestId) this.active = null;
    }
  }

  private async ensureTtsLoaded(caps: TtsEngineCapabilities, onProgress?: (pct: number, stage: string) => void) {
    const s = this.settings();
    const modelDir = joinPath(s.modelsDir, caps.modelId);
    const key = `${caps.engine}|${modelDir}|${s.device}`;
    if (this.loadedTts?.runtime === caps.runtime && this.loadedTts.key === key) return;

    // Model switch lifecycle: unload previous model from VRAM before loading the next one
    if (this.loadedTts) {
      const prev = this.loadedTts;
      this.loadedTts = null;
      try {
        await this.call(prev.runtime, "tts.unload", {}, onProgress);
      } catch {
        // ignore unload error
      }
    }

    await this.call(caps.runtime, "tts.load", { engine: caps.engine, modelDir, device: s.device }, onProgress);
    this.loadedTts = { runtime: caps.runtime, key };
  }

  async synthesize(req: SynthesizeRequest): Promise<SynthesizeResult> {
    const { caps, ref, language } = this.resolveEngine(req.model, req.voiceId, req.text, req.language, req.speed);
    const params: Record<string, unknown> = {
      engine: caps.engine,
      text: req.text,
      outputPath: req.outputPath,
    };
    if (language) params.language = language;
    if (ref?.refAudioPath) params.refAudioPath = ref.refAudioPath;
    if (ref?.refText) params.refText = ref.refText;
    if (req.speed !== undefined && caps.supportsSpeed) params.speed = req.speed;
    if (req.sampleRate !== undefined) params.sampleRate = req.sampleRate;

    const advanced = req.advancedSettings || getEngineAdvancedSettings(caps.engine);
    if (advanced && Object.keys(advanced).length > 0) {
      params.advancedSettings = advanced;
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      await this.ensureTtsLoaded(caps, req.onProgress);
      try {
        const r = await this.call<{ outputPath: string; durationSec: number; sampleRate: number; engine: string }>(
          caps.runtime, "tts.synthesize", params, req.onProgress);
        return r;
      } catch (e) {
        const err = AiError.from(e);
        // Sidecar restarted (crash/hard cancel) or another runtime took the GPU: reload once.
        if (attempt === 0 && err.code === "MODEL_NOT_LOADED") {
          this.loadedTts = null;
          continue;
        }
        if (err.code === "SIDECAR_CRASHED" || err.code === "CANCELLED") this.loadedTts = null;
        throw err;
      }
    }
    throw new AiError("INTERNAL", "unreachable");
  }

  async transcribe(audioPath: string, language: string | "auto", wordTimestamps: boolean,
                   onProgress?: (pct: number, stage: string) => void,
                   asrModelId?: string): Promise<TranscribeResult> {
    const s = this.settings();
    const modelDir = joinPath(s.modelsDir, asrModelId || s.asrModelId);
    const key = `${modelDir}|${s.device}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (this.loadedAsrKey !== key) {
        await this.call("core", "asr.load", { modelDir, device: s.device }, onProgress);
        this.loadedAsrKey = key;
      }
      try {
        return await this.call<TranscribeResult>("core", "asr.transcribe",
          { audioPath, language: language || "auto", wordTimestamps }, onProgress);
      } catch (e) {
        const err = AiError.from(e);
        if (attempt === 0 && err.code === "MODEL_NOT_LOADED") {
          this.loadedAsrKey = null;
          continue;
        }
        if (err.code === "SIDECAR_CRASHED" || err.code === "CANCELLED") this.loadedAsrKey = null;
        throw err;
      }
    }
    throw new AiError("INTERNAL", "unreachable");
  }

  async assemble(params: {
    inputs: AssembleInput[];
    outputPath: string;
    format: "wav" | "mp3";
    mode?: "sequential" | "timeline";
    totalDurationSec?: number;
    sampleRate?: number;
  }, onProgress?: (pct: number, stage: string) => void): Promise<AssembleResult> {
    return this.call<AssembleResult>("core", "audio.assemble", {
      sampleRate: 44100,
      ...params,
    }, onProgress);
  }

  /** Soft cancel first; if the engine is inside one blocking call, hard-cancel (kill) after graceMs. */
  async cancelActive(graceMs = 1500): Promise<void> {
    const a = this.active;
    if (!a) return;
    await this.backend.cancel(a.runtime, a.requestId, false).catch(() => false);
    await new Promise((r) => setTimeout(r, graceMs));
    if (this.active?.requestId === a.requestId) {
      await this.backend.cancel(a.runtime, a.requestId, true).catch(() => false);
      if (a.runtime === this.loadedTts?.runtime) this.loadedTts = null;
      if (a.runtime === "core") this.loadedAsrKey = null;
    }
  }

  async scratchPath(scope: string, fileName: string): Promise<string> {
    return joinPath(await this.fs.scratchDir(scope), fileName);
  }
}
