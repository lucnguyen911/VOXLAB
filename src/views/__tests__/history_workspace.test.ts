import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SAMPLE_UNIFIED_HISTORY,
  filterHistoryItems,
  deleteHistoryItem,
  syncBatchJobToHistory,
  recordCompletedJobToHistory,
  parseSubtitleContentToHistoryCues,
  loadHistoryItems,
} from "../../services/history/historyManager";

describe("Gate D: History Workspace — Job-Centric & Filter Specification", () => {
  it("CRITERION 1: Job-Centric Grouping — Batch jobs group all artifacts under 1 single record", () => {
    const batchJob = SAMPLE_UNIFIED_HISTORY.find((item) => item.id === "hist-01");
    assert.ok(batchJob, "Batch job hist-01 must exist");
    assert.strictEqual(batchJob.isBatch, true);
    assert.strictEqual(batchJob.title, "video_gioi_thieu_khoa_hoc.mp4");
    assert.strictEqual(batchJob.artifacts.length, 3, "Batch job must group 3 artifacts in 1 record");

    // Check individual artifact types under the unified record
    const subArtifact = batchJob.artifacts.find((a) => a.task === "transcription");
    const transArtifact = batchJob.artifacts.find((a) => a.task === "translation");
    const dubArtifact = batchJob.artifacts.find((a) => a.task === "dubbing");

    assert.ok(subArtifact, "Must contain transcription subtitle artifact");
    assert.ok(transArtifact, "Must contain translation subtitle artifact");
    assert.ok(dubArtifact, "Must contain dubbing audio artifact");

    assert.strictEqual(subArtifact.type, "subtitle");
    assert.strictEqual(dubArtifact.type, "audio");
    assert.ok(subArtifact.cues && subArtifact.cues.length > 0, "Subtitle artifact must contain cues");
  });

  it("CRITERION 2: Multi-Task Matching — Batch job with multiple tasks matches each corresponding filter tab", () => {
    // hist-01 has tasks: ["transcription", "translation", "dubbing"]
    const allFiltered = filterHistoryItems(SAMPLE_UNIFIED_HISTORY, "all", "");
    assert.ok(allFiltered.some((i) => i.id === "hist-01"), "Matches 'all'");

    const batchFiltered = filterHistoryItems(SAMPLE_UNIFIED_HISTORY, "batch", "");
    assert.ok(batchFiltered.some((i) => i.id === "hist-01"), "Matches 'batch'");

    const transFiltered = filterHistoryItems(SAMPLE_UNIFIED_HISTORY, "transcription", "");
    assert.ok(transFiltered.some((i) => i.id === "hist-01"), "Matches 'transcription' filter");

    const translFiltered = filterHistoryItems(SAMPLE_UNIFIED_HISTORY, "translation", "");
    assert.ok(translFiltered.some((i) => i.id === "hist-01"), "Matches 'translation' filter");

    const dubFiltered = filterHistoryItems(SAMPLE_UNIFIED_HISTORY, "dubbing", "");
    assert.ok(dubFiltered.some((i) => i.id === "hist-01"), "Matches 'dubbing' filter");

    // Must NOT match TTS or Dialogue
    const ttsFiltered = filterHistoryItems(SAMPLE_UNIFIED_HISTORY, "tts", "");
    assert.strictEqual(ttsFiltered.some((i) => i.id === "hist-01"), false, "hist-01 must not match TTS filter");

    const diagFiltered = filterHistoryItems(SAMPLE_UNIFIED_HISTORY, "dialogue", "");
    assert.strictEqual(diagFiltered.some((i) => i.id === "hist-01"), false, "hist-01 must not match Dialogue filter");
  });

  it("CRITERION 3: Search Query Filtering — Searches across title, source path, and output artifact names", () => {
    // Search by source title
    const searchByTitle = filterHistoryItems(SAMPLE_UNIFIED_HISTORY, "all", "khoa_hoc");
    assert.strictEqual(searchByTitle.length, 1);
    assert.strictEqual(searchByTitle[0].id, "hist-01");

    // Search by nested artifact file name
    const searchByArtifact = filterHistoryItems(SAMPLE_UNIFIED_HISTORY, "all", "phim_tai_lieu_thien_nhien_dub.wav");
    assert.strictEqual(searchByArtifact.length, 1);
    assert.strictEqual(searchByArtifact[0].id, "hist-05");

    // Search by artifact label keyword
    const searchByLabel = filterHistoryItems(SAMPLE_UNIFIED_HISTORY, "all", "Fit Timeline");
    assert.strictEqual(searchByLabel.length, 1);
    assert.strictEqual(searchByLabel[0].id, "hist-01");
  });

  it("CRITERION 4: Sorting Invariant — Records are sorted strictly newest-first (descending timestamp)", () => {
    const list = filterHistoryItems(SAMPLE_UNIFIED_HISTORY, "all", "");
    for (let i = 0; i < list.length - 1; i++) {
      assert.ok(
        list[i].timestamp >= list[i + 1].timestamp,
        `Item at index ${i} (${list[i].timestamp}) must be >= index ${i + 1} (${list[i + 1].timestamp})`
      );
    }
  });

  it("CRITERION 5: Safe Deletion Invariant — Deletes history record metadata only without touching disk", () => {
    const initialCount = SAMPLE_UNIFIED_HISTORY.length;
    const testList = [...SAMPLE_UNIFIED_HISTORY];
    const targetId = "hist-02";

    const updated = deleteHistoryItem(targetId, testList);
    assert.strictEqual(updated.length, initialCount - 1);
    assert.strictEqual(updated.some((i) => i.id === targetId), false);

    // Verify source path and artifacts info are still well-formed in other items
    const remaining = updated[0];
    assert.ok(remaining.outputDirectory.length > 0);
  });

  it("CRITERION 6: Warning & Partial Commit Invariants — Preserves artifacts on warning or failed steps", () => {
    // Job with warning
    const warnJob = SAMPLE_UNIFIED_HISTORY.find((item) => item.status === "completed_with_warning");
    assert.ok(warnJob, "completed_with_warning job must exist");
    assert.ok(warnJob.statusWarning && warnJob.statusWarning.includes("WSOLA"));
    assert.strictEqual(warnJob.artifacts.length, 3);

    // Job failed at translation but preserved ASR artifact
    const failedWithArtJob = SAMPLE_UNIFIED_HISTORY.find((item) => item.status === "failed_with_artifact");
    assert.ok(failedWithArtJob, "failed_with_artifact job must exist");
    assert.strictEqual(failedWithArtJob.artifacts.length, 1);
    assert.strictEqual(failedWithArtJob.artifacts[0].task, "transcription");
  });

  it("CRITERION 7: Missing Disk Artifact Detection — Flags existsOnDisk = false correctly", () => {
    const missingFileJob = SAMPLE_UNIFIED_HISTORY.find((item) => item.id === "hist-07");
    assert.ok(missingFileJob, "hist-07 must exist");
    const missingArtifact = missingFileJob.artifacts.find((a) => !a.existsOnDisk);
    assert.ok(missingArtifact, "Must have an artifact with existsOnDisk = false");
    assert.strictEqual(missingArtifact.fileName, "sach_noi_lich_su_am_thanh.mp3");
  });

  it("CRITERION 8: Batch Synchronization — syncBatchJobToHistory converts and stores completed BatchJob", () => {
    const testBatchJob = {
      id: "job-sync-test-99",
      fileName: "video_demo_khoa_hoc_ai.mp4",
      filePath: "D:/Media/video_demo_khoa_hoc_ai.mp4",
      fileSize: "45.0 MB",
      selectedTasks: ["transcription", "dubbing"] as ("transcription" | "dubbing")[],
      status: "completed" as const,
      outputPath: "D:/VoxLabOutput/Batch_Export/video_demo_khoa_hoc_ai",
      outputArtifacts: {
        audioPath: "D:/VoxLabOutput/Batch_Export/video_demo_khoa_hoc_ai/video_demo_khoa_hoc_ai_master.wav",
        audioDuration: 120,
        subtitles: [
          {
            path: "D:/VoxLabOutput/Batch_Export/video_demo_khoa_hoc_ai/video_demo_khoa_hoc_ai_sub.srt",
            label: "Phụ đề ASR",
            cues: [{ time: "00:00:01,000 --> 00:00:03,000", text: "Xin chào các bạn." }],
          },
        ],
      },
    };

    const synced = syncBatchJobToHistory(testBatchJob);
    assert.ok(synced, "Synced history item must be created");
    assert.strictEqual(synced.id, "hist-job-sync-test-99");
    assert.strictEqual(synced.title, "video_demo_khoa_hoc_ai.mp4");
    assert.strictEqual(synced.category, "batch");
    assert.strictEqual(synced.isBatch, true);
    assert.strictEqual(synced.artifacts.length, 2, "Must contain 1 audio and 1 subtitle artifact");

    const audioArt = synced.artifacts.find((a) => a.type === "audio");
    const subArt = synced.artifacts.find((a) => a.type === "subtitle");
    assert.ok(audioArt, "Must have audio artifact");
    assert.ok(subArt, "Must have subtitle artifact");
    assert.strictEqual(subArt.cues?.length, 1);
    assert.strictEqual(subArt.cues[0].text, "Xin chào các bạn.");
  });

  it("CRITERION 9: Single-Workspace Recording & Multi-Artifact Merging via recordCompletedJobToHistory", () => {
    const srtText = `1\n00:00:00,500 --> 00:00:02,500\nChào mừng bạn đến với VoxLab.\n\n2\n00:00:03,000 --> 00:00:05,500\nHệ thống lồng tiếng tự động.`;
    const parsedCues = parseSubtitleContentToHistoryCues(srtText);
    assert.strictEqual(parsedCues.length, 2);
    assert.strictEqual(parsedCues[0].startSec, 0.5);
    assert.strictEqual(parsedCues[0].endSec, 2.5);
    assert.strictEqual(parsedCues[1].text, "Hệ thống lồng tiếng tự động.");

    // Step 1: Export translated SRT in Dubbing workspace
    const firstRecord = recordCompletedJobToHistory({
      jobKey: "dub_review_xe_2026",
      title: "review_xe_2026 (en → vi)",
      category: "dubbing",
      tasks: ["translation"],
      status: "completed",
      chunkCount: 2,
      artifacts: [
        {
          filePath: "D:/VoxLabOutput/review_xe_2026_vi.srt",
          type: "subtitle",
          task: "translation",
          label: "Phụ đề đã dịch (.SRT - VI)",
          subtitleContent: srtText,
          isTimelineSynced: true,
        },
      ],
    });

    assert.strictEqual(firstRecord.artifacts.length, 1);
    assert.strictEqual(firstRecord.artifacts[0].cues?.length, 2);

    // Step 2: Export Master Audio in the same session with the same jobKey
    const mergedRecord = recordCompletedJobToHistory({
      jobKey: "dub_review_xe_2026",
      title: "review_xe_2026 (en → vi)",
      category: "dubbing",
      tasks: ["translation", "dubbing"],
      durationSec: 65,
      status: "completed_with_warning",
      statusWarning: "Có 1 câu thoại đã được nén tốc độ (WSOLA Auto-Fit).",
      artifacts: [
        {
          filePath: "D:/VoxLabOutput/review_xe_2026_master.wav",
          type: "audio",
          task: "dubbing",
          label: "Master Dubbed Audio",
          audioDurationSec: 65,
          isTimelineSynced: true,
        },
      ],
    });

    assert.strictEqual(mergedRecord.id, firstRecord.id, "Must merge into the same job card ID");
    assert.strictEqual(mergedRecord.artifacts.length, 2, "Must contain both SRT and Master WAV artifacts");
    assert.ok(mergedRecord.tasks.includes("translation") && mergedRecord.tasks.includes("dubbing"));
    assert.strictEqual(mergedRecord.status, "completed_with_warning");
    assert.strictEqual(loadHistoryItems()[0].id, mergedRecord.id, "Newest merged record must be at top of history");
  });
});
