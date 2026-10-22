/**
 * Native HTTP client for VoxLab.
 * Transparently delegates to Tauri's native ureq backend to bypass browser CORS restrictions
 * when interacting with local LLMs (LM Studio, Ollama) and remote APIs.
 * Supports true in-flight request cancellation via requestId + AbortSignal / isCancelled callback.
 * Falls back to standard browser/Node fetch in test and web environments.
 */

export interface AppHttpResponse {
  ok: boolean;
  status: number;
  statusText: string;
  data: any;
  text: string;
  retryAfter?: string;
}

let httpRequestCounter = 0;

function isTauriDesktopRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

export async function cancelNativeHttpRequest(requestId: string): Promise<void> {
  if (!requestId || !isTauriDesktopRuntime()) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("cancel_native_http_request", { requestId });
  } catch {
    // Ignore errors when cancelling completed or non-existent requests
  }
}

export async function appHttpRequest(
  url: string,
  options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: any;
    timeoutSec?: number;
    signal?: AbortSignal;
    isCancelled?: () => boolean;
    requestId?: string;
  }
): Promise<AppHttpResponse> {
  const isAbortedNow = (): boolean =>
    Boolean(options?.signal?.aborted || options?.isCancelled?.());

  if (isAbortedNow()) {
    throw new Error("CANCELLED: Request aborted by user.");
  }

  const requestId =
    options?.requestId || `http_req_${Date.now()}_${++httpRequestCounter}`;
  const method = (options?.method || "GET").toUpperCase();
  const headers = options?.headers || {};
  const timeoutSec = options?.timeoutSec || 60;
  const bodyStr =
    typeof options?.body === "string"
      ? options.body
      : options?.body !== undefined
      ? JSON.stringify(options.body)
      : undefined;

  const internalAbortController = new AbortController();
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let onExternalAbort: (() => void) | null = null;

  const triggerCancel = () => {
    if (!internalAbortController.signal.aborted) {
      internalAbortController.abort();
    }
    void cancelNativeHttpRequest(requestId);
  };

  if (options?.signal) {
    if (options.signal.aborted) {
      triggerCancel();
      throw new Error("CANCELLED: Request aborted by user.");
    }
    onExternalAbort = () => triggerCancel();
    options.signal.addEventListener("abort", onExternalAbort, { once: true });
  }

  if (options?.isCancelled) {
    pollInterval = setInterval(() => {
      try {
        if (options.isCancelled?.()) {
          triggerCancel();
        }
      } catch {
        // Ignore callback errors
      }
    }, 50);
  }

  const cleanupCancelWatchers = () => {
    if (pollInterval !== null) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    if (options?.signal && onExternalAbort) {
      options.signal.removeEventListener("abort", onExternalAbort);
      onExternalAbort = null;
    }
  };

  // Create a promise that rejects immediately when internalAbortController aborts
  const abortPromise = new Promise<never>((_, reject) => {
    if (internalAbortController.signal.aborted) {
      reject(new Error("CANCELLED: Request aborted by user."));
      return;
    }
    internalAbortController.signal.addEventListener(
      "abort",
      () => {
        reject(new Error("CANCELLED: Request aborted by user."));
      },
      { once: true }
    );
  });

  try {
    // 1. In Tauri Desktop runtime: delegate to native ureq command (zero CORS restrictions)
    if (isTauriDesktopRuntime()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const res = await Promise.race([
          invoke<{
            status: number;
            statusText?: string;
            status_text?: string;
            body: string;
            retryAfter?: string;
            retry_after?: string;
          }>("native_http_request", {
            method,
            url,
            headers,
            body: bodyStr,
            timeoutSec,
            requestId,
          }),
          abortPromise,
        ]);

        if (isAbortedNow() || internalAbortController.signal.aborted) {
          throw new Error("CANCELLED: Request aborted by user.");
        }

        let parsedData: any = null;
        try {
          parsedData = JSON.parse(res.body);
        } catch {
          parsedData = res.body;
        }
        return {
          ok: res.status >= 200 && res.status < 300,
          status: res.status,
          statusText: res.statusText || res.status_text || "",
          data: parsedData,
          text: res.body,
          retryAfter: res.retryAfter || res.retry_after || undefined,
        };
      } catch (err: any) {
        const errMsg = String(err?.message || err || "");
        if (
          isAbortedNow() ||
          internalAbortController.signal.aborted ||
          errMsg.toUpperCase().includes("CANCELLED") ||
          errMsg.toLowerCase().includes("aborted") ||
          err?.name === "AbortError"
        ) {
          throw new Error("CANCELLED: Request aborted by user.");
        }
        console.warn("native_http_request error, falling back to fetch:", errMsg);
      }
    }

    if (isAbortedNow() || internalAbortController.signal.aborted) {
      throw new Error("CANCELLED: Request aborted by user.");
    }

    // 2. Standard Fetch fallback (Node.js tests / browser dev)
    const fetchHeaders: Record<string, string> = { ...headers };
    if (bodyStr && !fetchHeaders["Content-Type"]) {
      fetchHeaders["Content-Type"] = "application/json";
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    if (timeoutSec > 0) {
      timeoutId = setTimeout(() => {
        if (!internalAbortController.signal.aborted) {
          internalAbortController.abort(new Error(`HTTP timeout after ${timeoutSec}s`));
        }
      }, timeoutSec * 1000);
    }

    try {
      const res = await Promise.race([
        fetch(url, {
          method,
          headers: fetchHeaders,
          body: bodyStr,
          signal: internalAbortController.signal,
        }),
        abortPromise,
      ]);

      const rawText = await Promise.race([res.text(), abortPromise]);

      if (isAbortedNow() || internalAbortController.signal.aborted) {
        throw new Error("CANCELLED: Request aborted by user.");
      }

      let parsedData: any = null;
      try {
        parsedData = JSON.parse(rawText);
      } catch {
        parsedData = rawText;
      }

      const retryAfterHeader =
        typeof res.headers?.get === "function"
          ? res.headers.get("retry-after") || res.headers.get("Retry-After") || undefined
          : undefined;

      return {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        data: parsedData,
        text: rawText,
        retryAfter: retryAfterHeader,
      };
    } catch (fetchErr: any) {
      if (isAbortedNow()) {
        throw new Error("CANCELLED: Request aborted by user.");
      }
      const msg = String(fetchErr?.message || fetchErr || "");
      if (
        msg.toUpperCase().includes("CANCELLED") ||
        fetchErr?.name === "AbortError" ||
        msg.toLowerCase().includes("aborted")
      ) {
        throw new Error("CANCELLED: Request aborted by user.");
      }
      throw fetchErr;
    } finally {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    }
  } finally {
    cleanupCancelWatchers();
  }
}
