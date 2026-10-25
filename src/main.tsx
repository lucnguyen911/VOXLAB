import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { installProductionAntiInspect } from "./utils/antiInspect";
import { sanitizeDiagnostics } from "./services/license/licenseService";

installProductionAntiInspect();

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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
