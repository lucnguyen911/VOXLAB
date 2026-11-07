import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  loadHistoryFromFileAsync,
  getHistoryRevision,
  resetHistoryManagerForTesting,
  saveHistoryItems,
  SAMPLE_UNIFIED_HISTORY,
} from "../historyManager";

/**
 * Regression guard (Phase 11 perf finding): HistoryWorkspace refreshes from disk on mount AND on every
 * `voxlab_history_updated` event. loadHistoryFromFileAsync() used to call saveHistoryItems()
 * unconditionally, which dispatches that same event -> unbounded refresh loop (UI lock-up in WebView
 * when the chain is microtask-only; endless history.json read/write + fs_stat churn inside Tauri).
 */
describe("History refresh loop guard", () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  let target: EventTarget;

  beforeEach(() => {
    resetHistoryManagerForTesting();
    target = new EventTarget();
    (globalThis as { window?: unknown }).window = {
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      dispatchEvent: target.dispatchEvent.bind(target),
    };
  });

  afterEach(() => {
    (globalThis as { window?: unknown }).window = originalWindow;
    resetHistoryManagerForTesting();
  });

  it("does not re-save (nor re-notify) when the reconciled history is unchanged", async () => {
    saveHistoryItems(SAMPLE_UNIFIED_HISTORY.slice(0, 3));
    await loadHistoryFromFileAsync();
    const revisionAfterFirstLoad = getHistoryRevision();

    let notifications = 0;
    target.addEventListener("voxlab_history_updated", () => notifications++);
    await loadHistoryFromFileAsync();

    assert.equal(getHistoryRevision(), revisionAfterFirstLoad, "unchanged reload must not bump revision");
    assert.equal(notifications, 0, "unchanged reload must not dispatch voxlab_history_updated");
  });

  it("a subscriber that reloads on every update (HistoryWorkspace pattern) settles instead of looping", async () => {
    saveHistoryItems(SAMPLE_UNIFIED_HISTORY.slice(0, 3));
    let refreshes = 0;
    const MAX = 50;
    target.addEventListener("voxlab_history_updated", () => {
      refreshes++;
      if (refreshes < MAX) void loadHistoryFromFileAsync();
    });

    await loadHistoryFromFileAsync(); // mount refresh
    await new Promise((r) => setTimeout(r, 50)); // let any chained refreshes run

    assert.ok(refreshes < 3, `expected the refresh chain to settle, got ${refreshes} chained refreshes`);
  });

  it("still saves and notifies when the reload brings real changes", async () => {
    saveHistoryItems(SAMPLE_UNIFIED_HISTORY.slice(0, 2));
    await loadHistoryFromFileAsync();
    const before = getHistoryRevision();

    saveHistoryItems(SAMPLE_UNIFIED_HISTORY.slice(0, 3)); // a workspace recorded a new job
    assert.ok(getHistoryRevision() > before, "a real change must bump the revision");
  });
});
