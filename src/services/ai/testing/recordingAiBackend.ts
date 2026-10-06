/**
 * TEST-ONLY boundary double for `AiBackend` (the single seam documented in ../types.ts).
 *
 * It replaces only the Tauri IPC hop so orchestration logic (engine resolution, load/unload,
 * chunk timing, assembly requests, cancel) runs for real in unit tests. It is never imported by
 * production code and is never used as evidence that inference works — real inference is verified
 * separately against the Python sidecar.
 */
import type { AiBackend, AiRequestOptions, AiRuntime } from "../types";
import { AiError } from "../types";
import { LocalAiServices, type AiFs, type VoiceReferenceResolver } from "../localAiServices";

export interface RecordedCall {
  runtime: AiRuntime;
  method: string;
  params: Record<string, unknown>;
  requestId?: string;
}

export interface RecordingBackendOptions {
  /** Synthetic duration per synthesized utterance (tests decide; default 0.08 s per char, min 0.5 s). */
  durationFor?: (text: string) => number;
  asrSegments?: { id: number; startSec: number; endSec: number; text: string }[];
  asrLanguage?: string;
  /** Throw this for the given method (once if `once`). */
  failOn?: { method: string; code: string; message?: string; once?: boolean };
  /** Delay (ms) before resolving tts.synthesize / asr.transcribe — lets tests cancel mid-flight. */
  delayMs?: number;
}

export class RecordingAiBackend implements AiBackend {
  readonly calls: RecordedCall[] = [];
  readonly cancels: { runtime: AiRuntime; requestId: string; hard: boolean }[] = [];
  private pending = new Map<string, (e: unknown) => void>();

  constructor(private readonly opts: RecordingBackendOptions = {}) {}

  methods(): string[] {
    return this.calls.map((c) => c.method);
  }

  async request<T = unknown>(runtime: AiRuntime, method: string, params: Record<string, unknown>,
                             options?: AiRequestOptions): Promise<T> {
    this.calls.push({ runtime, method, params: { ...params }, requestId: options?.requestId });
    const f = this.opts.failOn;
    if (f && f.method === method) {
      if (f.once) this.opts.failOn = undefined;
      throw new AiError(f.code, f.message || f.code);
    }
    if (this.opts.delayMs && (method === "tts.synthesize" || method === "asr.transcribe")) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, this.opts.delayMs);
        if (options?.requestId) {
          this.pending.set(options.requestId, (e) => { clearTimeout(t); reject(e); });
        }
      });
    }
    options?.onProgress?.({ pct: 100, stage: method });
    return this.respond(method, params) as T;
  }

  async cancel(runtime: AiRuntime, requestId: string, hard: boolean): Promise<boolean> {
    this.cancels.push({ runtime, requestId, hard });
    const reject = this.pending.get(requestId);
    if (reject) {
      this.pending.delete(requestId);
      reject(new AiError(hard ? "SIDECAR_CRASHED" : "CANCELLED", "cancelled"));
      return true;
    }
    return false;
  }

  private respond(method: string, params: Record<string, unknown>): unknown {
    switch (method) {
      case "tts.load":
      case "asr.load":
        return { loaded: true };
      case "tts.synthesize": {
        const text = String(params.text ?? "");
        const d = this.opts.durationFor ? this.opts.durationFor(text) : Math.max(0.5, text.length * 0.08);
        return { outputPath: params.outputPath, durationSec: d, sampleRate: 24000, engine: params.engine };
      }
      case "asr.transcribe":
        return {
          language: this.opts.asrLanguage ?? "en",
          languageProbability: 0.99,
          durationSec: 10,
          segments: this.opts.asrSegments ?? [
            { id: 0, startSec: 0.5, endSec: 2.5, text: "Hello and welcome." },
            { id: 1, startSec: 3.0, endSec: 5.0, text: "This is a test." },
          ],
        };
      case "audio.assemble": {
        const inputs = (params.inputs as { path: string; gapAfterMs?: number; startSec?: number }[]) || [];
        let t = 0;
        const segments = inputs.map((inp, index) => {
          const start = params.mode === "timeline" ? inp.startSec ?? 0 : t;
          const dur = 1;
          t = start + dur + (inp.gapAfterMs ?? 0) / 1000;
          return { index, startSec: start, endSec: start + dur, durationSec: dur };
        });
        return {
          outputPath: params.outputPath,
          format: params.format,
          sampleRate: 24000,
          durationSec: (params.totalDurationSec as number) ?? t,
          peakAmplitude: 0.5,
          segments,
        };
      }
      default:
        return {};
    }
  }
}

export function memoryAiFs(): AiFs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async readText(p) { const v = files.get(p); if (v === undefined) throw new Error(`ENOENT ${p}`); return v; },
    async writeText(p, c) { files.set(p, c); },
    async listDir() { return []; },
    async removeFile(p) { files.delete(p); },
    async scratchDir(name) { return `C:/scratch/${name}`; },
  };
}

/** Real LocalAiServices wired to the recording double. */
export function makeTestAi(opts: RecordingBackendOptions = {}, resolveVoice?: VoiceReferenceResolver) {
  const backend = new RecordingAiBackend(opts);
  const ai = new LocalAiServices(
    backend,
    memoryAiFs(),
    () => ({ modelsDir: "C:/models", device: "auto", asrModelId: "faster-whisper-small" }),
    resolveVoice
  );
  return { backend, ai };
}
