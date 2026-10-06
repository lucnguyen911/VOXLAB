/**
 * Local AI runtime boundary (Gate E). The frontend never talks to Python directly:
 * React/TS → Tauri command `ai_request` → Rust SidecarManager → Python sidecar (JSON Lines).
 *
 * `AiBackend` is the only seam where tests may inject a double.
 */

export type AiRuntime = "core" | "chatterbox" | "qwen";

export interface AiProgress {
  pct: number;
  stage: string;
}

export interface AiRequestOptions {
  requestId?: string;
  onProgress?: (p: AiProgress) => void;
}

export interface AiBackend {
  request<T = unknown>(
    runtime: AiRuntime,
    method: string,
    params: Record<string, unknown>,
    options?: AiRequestOptions
  ): Promise<T>;
  /** Soft cancel asks the engine to stop at its next checkpoint; hard cancel kills the sidecar process. */
  cancel(runtime: AiRuntime, requestId: string, hard: boolean): Promise<boolean>;
}

/** Structured error mirroring sidecar/PROTOCOL.md error codes. */
export class AiError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AiError";
    this.code = code;
  }
  static from(e: unknown): AiError {
    if (e instanceof AiError) return e;
    if (e && typeof e === "object" && "code" in e && "message" in e) {
      const o = e as { code: unknown; message: unknown };
      return new AiError(String(o.code), String(o.message));
    }
    return new AiError("INTERNAL", e instanceof Error ? e.message : String(e));
  }
}

let requestCounter = 0;
export function newRequestId(prefix = "ui"): string {
  requestCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${requestCounter}`;
}
