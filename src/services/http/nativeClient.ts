/**
 * Native HTTP client for VoxLab.
 * Transparently delegates to Tauri's native ureq backend to bypass browser CORS restrictions
 * when interacting with local LLMs (LM Studio, Ollama) and remote APIs.
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

export async function appHttpRequest(
  url: string,
  options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: any;
    timeoutSec?: number;
    signal?: AbortSignal;
  }
): Promise<AppHttpResponse> {
  if (options?.signal?.aborted) {
    throw new Error("CANCELLED: Request aborted by user.");
  }
  const method = (options?.method || "GET").toUpperCase();
  const headers = options?.headers || {};
  const timeoutSec = options?.timeoutSec || 60;
  const bodyStr =
    typeof options?.body === "string"
      ? options.body
      : options?.body !== undefined
      ? JSON.stringify(options.body)
      : undefined;

  // 1. In Tauri Desktop runtime: delegate to native ureq command (zero CORS restrictions)
  if (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  ) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const res = await invoke<{
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
      });
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
      console.warn("native_http_request error, falling back to fetch:", err?.message || err);
    }
  }

  // 2. Standard Fetch fallback (Node.js tests / browser dev)
  const fetchHeaders: Record<string, string> = { ...headers };
  if (bodyStr && !fetchHeaders["Content-Type"]) {
    fetchHeaders["Content-Type"] = "application/json";
  }

  const signal =
    options?.signal ||
    (typeof AbortSignal !== "undefined" && AbortSignal.timeout
      ? AbortSignal.timeout(timeoutSec * 1000)
      : undefined);

  const res = await fetch(url, {
    method,
    headers: fetchHeaders,
    body: bodyStr,
    signal,
  });

  const rawText = await res.text();
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
}
