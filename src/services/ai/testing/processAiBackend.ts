/**
 * ProcessAiBackend — spawns and drives the real Python sidecar processes from Node/tsx.
 * Used for real end-to-end verification outside the Tauri WebView.
 *
 * Implements the exact same JSON Lines protocol as Rust SidecarManager (PROTOCOL.md).
 */
import { spawn, ChildProcess } from "node:child_process";
import * as path from "node:path";
import * as readline from "node:readline";
import { AiBackend, AiError, AiRequestOptions, AiRuntime, newRequestId } from "../types";

export class ProcessAiBackend implements AiBackend {
  private processes = new Map<AiRuntime, ChildProcess>();
  private pendingRequests = new Map<string, {
    resolve: (res: any) => void;
    reject: (err: any) => void;
    onProgress?: (p: { pct: number; stage: string }) => void;
  }>();

  constructor(private readonly projectRoot: string) {}

  private getRuntimePython(runtime: AiRuntime): string {
    const venvDir =
      runtime === "chatterbox"
        ? ".venv-chatterbox"
        : runtime === "qwen"
          ? ".venv-qwen"
          : ".venv";
    return path.join(this.projectRoot, "sidecar", venvDir, "Scripts", "python.exe");
  }

  private async ensureProcess(runtime: AiRuntime): Promise<ChildProcess> {
    const existing = this.processes.get(runtime);
    if (existing && !existing.killed && existing.exitCode === null) {
      return existing;
    }

    const pythonExe = this.getRuntimePython(runtime);
    const sidecarDir = path.join(this.projectRoot, "sidecar");

    const proc = spawn(pythonExe, ["-m", "voxlab_sidecar"], {
      cwd: sidecarDir,
      env: {
        ...process.env,
        PYTHONPATH: sidecarDir,
        HF_HUB_OFFLINE: "1",
        PYTHONUNBUFFERED: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.processes.set(runtime, proc);

    const rl = readline.createInterface({
      input: proc.stdout!,
      crlfDelay: Infinity,
    });

    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const msg = JSON.parse(trimmed);
        if (msg.event === "progress" && msg.id) {
          const req = this.pendingRequests.get(msg.id);
          req?.onProgress?.({ pct: msg.data?.pct ?? 0, stage: msg.data?.stage ?? "" });
        } else if (msg.id) {
          const req = this.pendingRequests.get(msg.id);
          if (req) {
            this.pendingRequests.delete(msg.id);
            if (msg.ok) {
              req.resolve(msg.result);
            } else {
              req.reject(new AiError(msg.error?.code || "INTERNAL", msg.error?.message || "Lỗi sidecar"));
            }
          }
        }
      } catch (err) {
        // ignore malformed line
      }
    });

    proc.stderr?.on("data", (data) => {
      // Diagnostic logging only
      const s = data.toString();
      if (process.env.DEBUG_SIDECAR) {
        process.stderr.write(`[sidecar:${runtime}] ${s}`);
      }
    });

    proc.on("exit", (code) => {
      this.processes.delete(runtime);
      for (const req of this.pendingRequests.values()) {
        req.reject(new AiError("SIDECAR_CRASHED", `Sidecar process exited with code ${code}`));
      }
      this.pendingRequests.clear();
    });

    // Wait for ping
    await new Promise((r) => setTimeout(r, 500));
    return proc;
  }

  async request<T = unknown>(
    runtime: AiRuntime,
    method: string,
    params: Record<string, unknown>,
    options?: AiRequestOptions
  ): Promise<T> {
    const proc = await this.ensureProcess(runtime);
    const reqId = options?.requestId || newRequestId(method.replace(/\W/g, ""));

    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(reqId, {
        resolve,
        reject,
        onProgress: options?.onProgress,
      });

      const payload = JSON.stringify({ id: reqId, method, params }) + "\n";
      proc.stdin!.write(payload, "utf8");
    });
  }

  async cancel(runtime: AiRuntime, requestId: string, hard: boolean): Promise<boolean> {
    const proc = this.processes.get(runtime);
    if (!proc) return false;

    if (hard) {
      proc.kill("SIGKILL");
      this.processes.delete(runtime);
      return true;
    }

    try {
      await this.request(runtime, "cancel", { target: requestId });
      return true;
    } catch {
      return false;
    }
  }

  async shutdownAll(): Promise<void> {
    for (const [runtime, proc] of this.processes.entries()) {
      try {
        await this.request(runtime, "system.shutdown", {});
      } catch {
        proc.kill();
      }
    }
    this.processes.clear();
  }
}
