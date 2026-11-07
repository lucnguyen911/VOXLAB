#!/usr/bin/env node
/**
 * Reproducible WebView startup benchmark (Phase 11 — /webperf).
 *
 * Drives Microsoft Edge (same Chromium engine as WebView2 used by Tauri on Windows) over raw CDP,
 * performs N cold loads of the production bundle at several CPU-throttling rates and reports
 * median / min / max for FCP, LCP, DOMContentLoaded, ScriptDuration and TaskDuration.
 *
 * Usage:
 *   npm run build && npx vite preview --port 4173 --strictPort   (in another terminal)
 *   node scripts/perf/webview-startup-bench.mjs [--url http://localhost:4173/] [--runs 7] [--rates 1,4,6] [--json out.json]
 *
 * No third-party dependencies: uses Node >= 22 global WebSocket + fetch.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "true"]);
    return acc;
  }, [])
);
const URL_UNDER_TEST = args.url || "http://localhost:4173/";
const RUNS = Number(args.runs || 7);
const RATES = String(args.rates || "1,4,6").split(",").map(Number);
const PORT = Number(args.port || 9333);
const EDGE_CANDIDATES = [
  args.browser,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean);
const browserPath = EDGE_CANDIDATES.find((p) => existsSync(p));
if (!browserPath) throw new Error("No Chromium-based browser found");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevtools() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return;
    } catch {
      /* not ready */
    }
    await sleep(100);
  }
  throw new Error("DevTools endpoint did not come up");
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        (this.listeners.get(msg.method) || []).forEach((fn) => fn(msg.params));
      }
    };
  }
  open() {
    return new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = rej;
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  once(method) {
    return new Promise((resolve) => {
      const fn = (p) => {
        this.listeners.set(method, (this.listeners.get(method) || []).filter((f) => f !== fn));
        resolve(p);
      };
      this.listeners.set(method, [...(this.listeners.get(method) || []), fn]);
    });
  }
  close() {
    this.ws.close();
  }
}

const INIT_SCRIPT = `
  window.__perf = { lcp: 0, longTasks: [] };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.lcp = e.startTime; })
      .observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.longTasks.push(e.duration); })
      .observe({ type: 'longtask', buffered: true });
  } catch (e) {}
`;

const COLLECT = `(() => {
  const nav = performance.getEntriesByType('navigation')[0] || {};
  const fcp = (performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime || 0;
  const lt = window.__perf.longTasks;
  return JSON.stringify({
    fcp, lcp: window.__perf.lcp, dcl: nav.domContentLoadedEventEnd || 0, load: nav.loadEventEnd || 0,
    longTaskCount: lt.length, longTaskTotal: lt.reduce((a, b) => a + b, 0), longTaskMax: lt.length ? Math.max(...lt) : 0,
    domNodes: document.getElementsByTagName('*').length,
  });
})()`;

function stats(values) {
  const s = [...values].sort((a, b) => a - b);
  const median = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  return { median: +median.toFixed(1), min: +s[0].toFixed(1), max: +s[s.length - 1].toFixed(1) };
}

async function main() {
  const profile = mkdtempSync(join(tmpdir(), "voxlab-perf-"));
  const browser = spawn(
    browserPath,
    [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--window-size=1440,900",
      "about:blank",
    ],
    { stdio: "ignore" }
  );
  try {
    await waitForDevtools();
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = targets.find((t) => t.type === "page");
    const cdp = new Cdp(page.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send("Page.enable");
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Performance.enable", { timeDomain: "timeTicks" });
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: INIT_SCRIPT });

    const report = { url: URL_UNDER_TEST, browser: browserPath, runs: RUNS, results: {} };
    for (const rate of RATES) {
      await cdp.send("Emulation.setCPUThrottlingRate", { rate });
      const samples = [];
      // one warm-up navigation (discarded) so V8/OS file cache state is comparable across rates
      for (let i = 0; i <= RUNS; i++) {
        await cdp.send("Page.navigate", { url: "about:blank" });
        await sleep(150);
        const loaded = cdp.once("Page.loadEventFired");
        await cdp.send("Page.navigate", { url: URL_UNDER_TEST });
        await loaded;
        await sleep(1500 * Math.max(1, rate / 2)); // let LCP / long tasks settle
        const { result } = await cdp.send("Runtime.evaluate", { expression: COLLECT, returnByValue: true });
        const perf = JSON.parse(result.value);
        const { metrics } = await cdp.send("Performance.getMetrics");
        const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
        perf.scriptMs = (m.ScriptDuration || 0) * 1000;
        perf.taskMs = (m.TaskDuration || 0) * 1000;
        perf.heapMb = (m.JSHeapUsedSize || 0) / 1048576;
        if (i > 0) samples.push(perf);
      }
      const keys = Object.keys(samples[0]);
      report.results[`cpu_${rate}x`] = Object.fromEntries(keys.map((k) => [k, stats(samples.map((s) => s[k]))]));
    }
    cdp.close();
    console.log(JSON.stringify(report, null, 2));
    if (args.json) writeFileSync(args.json, JSON.stringify(report, null, 2));
  } finally {
    browser.kill();
    await sleep(500);
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      /* Edge may still hold files briefly */
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
