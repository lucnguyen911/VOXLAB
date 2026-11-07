#!/usr/bin/env node
/**
 * Reproducible WebView interaction benchmark (Phase 11 — /webperf).
 *
 * Runs against the Vite DEV server (React development build), because production builds are
 * locked behind the license gate outside Tauri (Security v3.1, by design). Dev React is slower
 * than production, so every number here is a conservative UPPER BOUND for the shipped app.
 *
 * The dev-only license opt-out (`localStorage.voxlab_enforce_license_policy = "0"`, documented in
 * licenseService.isCommercialGateEnabled, ignored in production builds) is applied to the throwaway
 * benchmark profile only.
 *
 * Scenarios:
 *   S1 nav     — click every sidebar workspace (INP per click)
 *   S2 typing  — keystroke latency in the TTS compose editor with an N-char document loaded
 *   S3 chunk   — "Chuyển sang tạo giọng" with an N-char document (click INP + settle time)
 *
 * Usage:
 *   node scripts/perf/webview-interaction-bench.mjs [--url http://localhost:1420/] [--rates 1,4] [--sizes 5000,30000,100000] [--json out.json]
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
const URL_UNDER_TEST = args.url || "http://localhost:1420/";
const RATES = String(args.rates || "1,4").split(",").map(Number);
const SIZES = String(args.sizes || "5000,30000,100000").split(",").map(Number);
const SCENARIOS = String(args.scenarios || "nav,typing,chunk").split(",");
const NAV_CYCLES = Number(args.navCycles || 3);
const PORT = Number(args.port || 9334);
const browserPath = [
  args.browser,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean).find((p) => existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...m) => console.error(`[${new Date().toISOString().slice(11, 19)}]`, ...m);
const NAV_LABELS = ["Text to Speech", "Hội Thoại", "Voice Clone", "Voice Library", "Phụ đề", "Dịch & Lồng tiếng", "Hàng loạt", "Lịch sử", "Cài đặt"];

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    };
  }
  open() {
    return new Promise((res, rej) => ((this.ws.onopen = res), (this.ws.onerror = rej)));
  }
  send(method, params = {}, timeoutMs = 90000) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
    });
  }
  async eval(expression) {
    const { result, exceptionDetails } = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  }
}

const INIT_SCRIPT = `
  try { localStorage.setItem('voxlab_enforce_license_policy', '0'); } catch (e) {}
  window.__perf = { events: [], longTasks: [] };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.interactionId) window.__perf.events.push({ name: e.name, start: e.startTime, dur: e.duration, proc: e.processingEnd - e.processingStart, delay: e.processingStart - e.startTime }); })
      .observe({ type: 'event', durationThreshold: 16, buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.longTasks.push({ start: e.startTime, dur: e.duration }); })
      .observe({ type: 'longtask', buffered: true });
  } catch (e) {}
`;

function stats(values) {
  if (!values.length) return { n: 0 };
  const s = [...values].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
  return { n: s.length, median: +q(0.5).toFixed(1), p75: +q(0.75).toFixed(1), max: +s[s.length - 1].toFixed(1) };
}

/** Builds a realistic narration document of ~n characters (sentences, commas, numbers, paragraphs). */
function makeDocument(n) {
  const sentences = [
    "To see why the charging delay myth falls apart in practice, you have to understand how commercial freight actually moves across America.",
    "Critics often imagine an eighteen wheeler pulling into a crowded highway rest stop and waiting three hours behind family sedans for an open plug.",
    "In reality, over eighty percent of regional and national retail freight runs on predictable, repeatable point to point routes.",
    "These trucks do not wander randomly across the map: they operate from depot to depot on strict schedules.",
    "Operating on the new Megawatt Charging System architecture, these cables deliver one point two megawatts of direct current power.",
    "By the time the dock doors close, the rig rolls, and the driver is back on the road in under thirty minutes.",
    "That vertical integration locks in stable energy prices for decades, which matters more than any single headline number.",
  ];
  let out = "";
  let i = 0;
  while (out.length < n) {
    out += sentences[i % sentences.length] + (i % 5 === 4 ? "\n\n" : " ");
    i++;
  }
  return out.slice(0, n);
}

async function clickByText(cdp, label, scope = "") {
  const rect = await cdp.eval(`(() => {
    const el = [...document.querySelectorAll('${scope} button, ${scope} a, ${scope} [role=button]')].find(e => e.innerText.trim() === ${JSON.stringify(label)} && e.offsetParent);
    if (!el) return null; el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (!rect) throw new Error(`Element not found: ${label}`);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await cdp.send("Input.dispatchMouseEvent", { type, x: rect.x, y: rect.y, button: "left", clickCount: 1 });
  }
}

async function resetPerf(cdp) {
  await cdp.eval(`(window.__perf.events = [], window.__perf.longTasks = [], performance.now())`);
}
async function readPerf(cdp) {
  return cdp.eval(`JSON.parse(JSON.stringify(window.__perf))`);
}
/** Resolves when the DOM has not changed for `quietMs`, returns elapsed ms since `t0`. */
async function settle(cdp, t0, quietMs = 400, timeoutMs = 30000) {
  return cdp.eval(`new Promise((resolve) => {
    let last = performance.now();
    const mo = new MutationObserver(() => { last = performance.now(); });
    mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    const tick = () => {
      const now = performance.now();
      if (now - last >= ${quietMs} || now - ${t0} > ${timeoutMs}) { mo.disconnect(); resolve(+(last - ${t0}).toFixed(1)); }
      else setTimeout(tick, 50);
    };
    setTimeout(tick, 50);
  })`);
}

async function setComposeText(cdp, text) {
  await cdp.eval(`(() => {
    const ta = [...document.querySelectorAll('textarea')].find(t => (t.getAttribute('placeholder') || '').includes('kịch bản'));
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(text)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  })()`);
}

async function main() {
  const profile = mkdtempSync(join(tmpdir(), "voxlab-perf-int-"));
  const browser = spawn(browserPath, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--headless=new",
    "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--window-size=1600,1000", "about:blank",
  ], { stdio: "ignore" });
  const report = { url: URL_UNDER_TEST, build: "vite-dev (React development, upper bound)", results: {} };
  try {
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch { /* wait */ }
      await sleep(100);
    }
    const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
    const cdp = new Cdp(page.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: INIT_SCRIPT });

    const loadApp = async () => {
      log("loading app", URL_UNDER_TEST);
      await cdp.send("Page.navigate", { url: URL_UNDER_TEST });
      const ok = await cdp.eval(`new Promise(async (r) => { for (let i = 0; i < 240; i++) { if (document.body && document.body.innerText.includes('Text to Speech')) return r(true); await new Promise(x => setTimeout(x, 250)); } r(false); })`);
      log("app shell ready:", ok);
      if (!ok) throw new Error("App shell did not render (license gate or build error)");
      await sleep(1500);
    };

    for (const rate of RATES) {
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      await loadApp();
      await cdp.send("Emulation.setCPUThrottlingRate", { rate });
      const r = {};

      if (SCENARIOS.includes("nav")) {
        const perLabel = Object.fromEntries(NAV_LABELS.map((l) => [l, []]));
        const longTasks = [];
        for (let c = 0; c < NAV_CYCLES; c++) {
          for (const label of NAV_LABELS) {
            log(`nav cycle ${c} -> ${label}`);
            const t0 = await resetPerf(cdp);
            await clickByText(cdp, label, "aside");
            await settle(cdp, t0, 300, 10000);
            const p = await readPerf(cdp);
            const clicks = p.events.filter((e) => e.name === "pointerup" || e.name === "click" || e.name === "pointerdown");
            if (c > 0) { // first cycle warms lazy state
              perLabel[label].push(clicks.length ? Math.max(...clicks.map((e) => e.dur)) : 0);
              longTasks.push(...p.longTasks.map((t) => t.dur));
            }
          }
        }
        r.nav = {
          inpPerWorkspace: Object.fromEntries(Object.entries(perLabel).map(([k, v]) => [k, stats(v)])),
          inpAll: stats(Object.values(perLabel).flat()),
          longTasks: stats(longTasks),
        };
      }

      if (SCENARIOS.includes("typing") || SCENARIOS.includes("chunk")) {
        for (const size of SIZES) {
          const doc = makeDocument(size);
          const key = `doc_${size}`;
          log(`doc scenario size=${size}`);
          r[key] = {};
          await clickByText(cdp, "Text to Speech", "aside");
          await sleep(800);
          await clickByText(cdp, "Soạn thảo", "main").catch(() => {});
          await sleep(800);
          let t0 = await resetPerf(cdp);
          await setComposeText(cdp, doc);
          r[key].loadSettleMs = await settle(cdp, t0, 400, 30000);

          if (SCENARIOS.includes("typing")) {
            const durs = [];
            for (let k = 0; k < 15; k++) {
              t0 = await resetPerf(cdp);
              await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", text: "a", key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
              await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
              await sleep(120 * Math.max(1, rate / 2));
              const p = await readPerf(cdp);
              const ev = p.events.filter((e) => e.name.startsWith("key") || e.name === "beforeinput" || e.name === "input");
              durs.push(ev.length ? Math.max(...ev.map((e) => e.dur)) : 0);
            }
            r[key].keystrokeInp = stats(durs);
          }

          if (SCENARIOS.includes("chunk")) {
            t0 = await resetPerf(cdp);
            await clickByText(cdp, "Chuyển sang tạo giọng", "main");
            const settleMs = await settle(cdp, t0, 500, 60000);
            const p = await readPerf(cdp);
            const clicks = p.events.filter((e) => e.name === "click" || e.name === "pointerup");
            r[key].chunkClickInp = clicks.length ? +Math.max(...clicks.map((e) => e.dur)).toFixed(1) : 0;
            r[key].chunkSettleMs = settleMs;
            r[key].chunkLongTaskTotal = +p.longTasks.reduce((a, t) => a + t.dur, 0).toFixed(1);
            r[key].chunkLongTaskMax = p.longTasks.length ? +Math.max(...p.longTasks.map((t) => t.dur)).toFixed(1) : 0;
            r[key].chunkCount = await cdp.eval(`document.querySelectorAll('main textarea').length`);
            r[key].domNodes = await cdp.eval(`document.getElementsByTagName('*').length`);

            // S4: keystroke latency inside one chunk textarea of the studio list (repeated interaction)
            await cdp.eval(`(() => { const ta = document.querySelector('main textarea'); ta.scrollIntoView({block:'center'}); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); })()`);
            await sleep(300);
            const sdurs = [];
            for (let k2 = 0; k2 < 15; k2++) {
              await resetPerf(cdp);
              await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", text: "a", key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
              await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
              await sleep(150 * Math.max(1, rate / 2));
              const p2 = await readPerf(cdp);
              const ev2 = p2.events.filter((e) => e.name.startsWith("key") || e.name === "beforeinput" || e.name === "input");
              sdurs.push(ev2.length ? Math.max(...ev2.map((e) => e.dur)) : 0);
            }
            r[key].studioKeystrokeInp = stats(sdurs);
          }
        }
      }
      report.results[`cpu_${rate}x`] = r;
    }
    console.log(JSON.stringify(report, null, 2));
    if (args.json) writeFileSync(args.json, JSON.stringify(report, null, 2));
  } finally {
    browser.kill();
    await sleep(500);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
