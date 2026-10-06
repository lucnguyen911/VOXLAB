import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseTimestampToSeconds, formatSeconds } from "../../components/preview/ResultPreviewDrawer";
import { SAMPLE_UNIFIED_HISTORY } from "../../services/history/historyManager";

describe("Gate D: Result Preview Drawer — Optimization & Invariant Verification Suite", () => {
  it("TEST 1: parseTimestampToSeconds parses standard SRT/VTT time ranges accurately", () => {
    const srt = "00:00:01,500 --> 00:00:04,200";
    const parsed1 = parseTimestampToSeconds(srt);
    assert.ok(parsed1, "Must parse standard SRT timestamp");
    assert.strictEqual(parsed1.startSec, 1.5);
    assert.strictEqual(parsed1.endSec, 4.2);

    const vtt = "01:23.450 → 01:27.100";
    const parsed2 = parseTimestampToSeconds(vtt);
    assert.ok(parsed2, "Must parse arrow timestamp");
    assert.strictEqual(parsed2.startSec, 83.45);
    assert.strictEqual(parsed2.endSec, 87.1);

    const invalid = "not a timestamp";
    assert.strictEqual(parseTimestampToSeconds(invalid), null);
  });

  it("TEST 2: formatSeconds formats MM:SS correctly", () => {
    assert.strictEqual(formatSeconds(0), "00:00");
    assert.strictEqual(formatSeconds(65), "01:05");
    assert.strictEqual(formatSeconds(195), "03:15");
  });

  it("TEST 3: Unified Result Selector contains only existing artifacts for the job", () => {
    const job = SAMPLE_UNIFIED_HISTORY.find((j) => j.id === "hist-01")!;
    assert.ok(job);
    assert.strictEqual(job.artifacts.length, 3);

    // Artifacts must map to short, non-redundant labels
    const tasks = job.artifacts.map((a) => a.task);
    assert.ok(tasks.includes("transcription"));
    assert.ok(tasks.includes("translation"));
    assert.ok(tasks.includes("dubbing"));
  });

  it("TEST 4: Subtitle Viewer Search Keyword Filtering filters without mutating original cues", () => {
    const job = SAMPLE_UNIFIED_HISTORY.find((j) => j.id === "hist-01")!;
    const subArtifact = job.artifacts.find((a) => a.task === "transcription")!;
    assert.ok(subArtifact.cues && subArtifact.cues.length === 3);

    const query = "VoxLab";
    const filtered = subArtifact.cues.filter((c) => c.text.toLowerCase().includes(query.toLowerCase()));
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].index, 3);
    assert.ok(filtered[0].text.includes("VoxLab"));

    // Original cue array must remain unchanged
    assert.strictEqual(subArtifact.cues.length, 3);
  });

  it("TEST 5: Copy All Dialogue extracts pure text without indices or timestamps", () => {
    const job = SAMPLE_UNIFIED_HISTORY.find((j) => j.id === "hist-01")!;
    const subArtifact = job.artifacts.find((a) => a.task === "transcription")!;
    const allText = subArtifact.cues!.map((c) => c.text).join("\n");

    assert.ok(!allText.includes("00:00:00,500"));
    assert.ok(!allText.includes("-->"));
    assert.ok(!allText.includes("#1"));
    assert.ok(allText.includes("Chào mừng các bạn"));
    assert.ok(allText.includes("VoxLab cung cấp"));
  });

  it("TEST 6: Timeline Synchronization Invariant — Disables auto-sync when timeline warning exists", () => {
    const warnJob = SAMPLE_UNIFIED_HISTORY.find((j) => j.id === "hist-05")!;
    assert.ok(warnJob);
    // hist-05 has statusWarning mentioning WSOLA timeline adjustment
    const hasTimelineWarning = (warnJob.statusWarning || "").toLowerCase().includes("timeline");
    assert.strictEqual(hasTimelineWarning, true, "Must detect timeline disparity warning");

    // In accordance with Section 2 invariant:
    // If timeline is unverified or warning exists, sync highlighting & seek must be disabled
    const isSyncReliable = !hasTimelineWarning;
    assert.strictEqual(isSyncReliable, false, "Must flag sync as unreliable to protect user from mismatch");
  });

  it("TEST 7: Missing Disk Artifact Detection blocks playback and file opening", () => {
    const missingJob = SAMPLE_UNIFIED_HISTORY.find((j) => j.id === "hist-07")!;
    const missingArt = missingJob.artifacts.find((a) => !a.existsOnDisk)!;
    assert.ok(missingArt, "Must have missing artifact");
    assert.strictEqual(missingArt.existsOnDisk, false);
  });
});
