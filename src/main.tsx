import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import App from "./App";
import "./App.css";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { installProductionAntiInspect } from "./utils/antiInspect";
import { sanitizeDiagnostics } from "./services/license/licenseService";
import { isTauriRuntime } from "./services/ai/tauriBackend";
import { invoke } from "@tauri-apps/api/core";
import {
  purgeEphemeralWorkspaceStateFromLocalStorage,
  syncWorkspaceSessionWithProcessId,
} from "./services/tts/workspaceSessionStorage";
import { resetBatchJobsPreservingSettings } from "./services/batch/batchStorage";

installProductionAntiInspect();
purgeEphemeralWorkspaceStateFromLocalStorage();

const isProd = Boolean(
  (import.meta as unknown as { env?: { PROD?: boolean } })?.env?.PROD
);

window.addEventListener("error", (event) => {
  if (!isProd) {
    console.error("Global window.onerror caught:", event.error || event.message);
    try {
      localStorage.setItem(
        "voxlab_window_error",
        JSON.stringify({
          message: sanitizeDiagnostics(String(event.message || "")),
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          stack: event.error?.stack ? sanitizeDiagnostics(String(event.error.stack)) : undefined,
          time: new Date().toISOString(),
        })
      );
    } catch {}
  }
});

window.addEventListener("unhandledrejection", (event) => {
  if (!isProd) {
    console.error("Global unhandledrejection caught:", event.reason);
    try {
      localStorage.setItem(
        "voxlab_unhandled_rejection",
        JSON.stringify({
          reason: sanitizeDiagnostics(String(event.reason?.message || event.reason)),
          stack: event.reason?.stack ? sanitizeDiagnostics(String(event.reason.stack)) : undefined,
          time: new Date().toISOString(),
        })
      );
    } catch {}
  }
});

async function bootstrapApplication() {
  if (isTauriRuntime()) {
    try {
      const procId = await invoke<string>("get_process_session_id");
      await syncWorkspaceSessionWithProcessId({
        currentProcessId: procId,
        onFreshProcessLaunch: () => resetBatchJobsPreservingSettings(),
      });
    } catch (err) {
      console.warn("[bootstrap] Process session sync warning:", err);
    }
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

void bootstrapApplication();
