/**
 * Production AiBackend: Tauri IPC → Rust SidecarManager → Python sidecar.
 */
import { AiBackend, AiError, AiRequestOptions, AiRuntime, newRequestId } from "./types";

interface ProgressPayload {
  runtime: string;
  requestId: string;
  pct: number;
  stage: string;
}

export function isTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w.__TAURI_INTERNALS__ || w.__TAURI__);
}

export class TauriAiBackend implements AiBackend {
  private listeners = new Map<string, (p: { pct: number; stage: string }) => void>();
  private unlisten: Promise<() => void> | null = null;

  private async ensureListener(): Promise<void> {
    if (!this.unlisten) {
      const { listen } = await import("@tauri-apps/api/event");
      this.unlisten = listen<ProgressPayload>("ai://progress", (event) => {
        const cb = this.listeners.get(event.payload.requestId);
        cb?.({ pct: event.payload.pct, stage: event.payload.stage });
      });
    }
    await this.unlisten;
  }

  async request<T = unknown>(
    runtime: AiRuntime,
    method: string,
    params: Record<string, unknown>,
    options: AiRequestOptions = {}
  ): Promise<T> {
    const requestId = options.requestId ?? newRequestId(runtime);
    if (options.onProgress) {
      await this.ensureListener();
      this.listeners.set(requestId, options.onProgress);
    }
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<T>("ai_request", { runtime, method, params, requestId });
    } catch (e) {
      throw AiError.from(e);
    } finally {
      this.listeners.delete(requestId);
    }
  }

  async cancel(runtime: AiRuntime, requestId: string, hard: boolean): Promise<boolean> {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<boolean>("ai_cancel", { runtime, requestId, hard });
    } catch (e) {
      throw AiError.from(e);
    }
  }
}
