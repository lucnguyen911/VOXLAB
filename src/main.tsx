import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";
import { ErrorBoundary } from "./components/ErrorBoundary";

window.addEventListener("error", (event) => {
  console.error("Global window.onerror caught:", event.error || event.message);
  try {
    localStorage.setItem(
      "voxlab_window_error",
      JSON.stringify({
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error?.stack,
        time: new Date().toISOString(),
      })
    );
  } catch {}
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("Global unhandledrejection caught:", event.reason);
  try {
    localStorage.setItem(
      "voxlab_unhandled_rejection",
      JSON.stringify({
        reason: String(event.reason?.message || event.reason),
        stack: event.reason?.stack,
        time: new Date().toISOString(),
      })
    );
  } catch {}
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
