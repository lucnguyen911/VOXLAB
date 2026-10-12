import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ChunkItem } from "../../../types/ui";
import {
  generateTtsQualityLog,
  generateTtsQualityJson,
} from "../ttsLogExporter";

describe("TTS Quality Log Exporter Tests", () => {
  const mockChunks: ChunkItem[] = [
    {
      id: "chunk_01",
      index: 0,
      text: "Chào mừng quý thính giả đến với kênh kiến thức công nghệ VoxLab.",
      originalText: "Chào mừng quý thính giả đến với kênh kiến thức công nghệ VoxLab.",
      status: "ready",
      durationSec: 4.2,
      pauseAfterMs: 600,
      qualityReview: {
        status: "pass",
        issues: [],
        summary: "Đạt chuẩn phát âm",
        checkedAt: Date.now(),
        text: "Chào mừng quý thính giả đến với kênh kiến thức công nghệ VoxLab.",
      },
    },
    {
      id: "chunk_02",
      index: 1,
      text: "Trong tập podcast ngày hôm nay chúng ta sẽ cùng khám phá một chủ đề vô cùng hấp dẫn.",
      originalText: "Trong tập podcast ngày hôm nay chúng ta sẽ cùng khám phá một chủ đề vô cùng hấp dẫn.",
      status: "ready",
      durationSec: 9.6,
      pauseAfterMs: 600,
      qualityReview: {
        status: "warning",
        issues: [
          {
            severity: "warning",
            code: "ABNORMAL_PAUSE",
            message: "Phát hiện khoảng ngắt có thể bất thường giữa 'podcast' và 'ngày' (0.58s)",
            timeRange: [2.4, 2.98],
            words: ["podcast", "ngày"],
          },
        ],
        summary: "Phát hiện khoảng ngắt bất thường 0.58s",
        checkedAt: Date.now(),
        text: "Trong tập podcast ngày hôm nay chúng ta sẽ cùng khám phá một chủ đề vô cùng hấp dẫn.",
        metrics: {
          wpm: 135,
          detectedWordsCount: 18,
          sourceWordsCount: 18,
        },
      },
    },
    {
      id: "chunk_03",
      index: 2,
      text: "Mô hình TTS đọc các số thập phân như zero point eight một cách chính xác.",
      originalText: "Mô hình TTS đọc các số thập phân như zero point eight một cách chính xác.",
      status: "ready",
      durationSec: 5.1,
      pauseAfterMs: 600,
      qualityReview: {
        status: "warning",
        issues: [
          {
            severity: "warning",
            code: "SUSPECTED_SWALLOWED",
            message: "Nghi vấn nuốt từ 'point'",
            timeRange: [3.1, 3.5],
            words: ["point"],
          },
        ],
        summary: "Nghi vấn nuốt từ 'point'",
        checkedAt: Date.now(),
        text: "Mô hình TTS đọc các số thập phân như zero point eight một cách chính xác.",
      },
    },
    {
      id: "chunk_04",
      index: 3,
      text: "Đoạn văn bản này bị lỗi kết nối trong quá trình tạo audio.",
      originalText: "Đoạn văn bản này bị lỗi kết nối trong quá trình tạo audio.",
      status: "failed",
      errorMessage: "Python sidecar worker connection timeout after 30s",
      pauseAfterMs: "auto",
    },
  ];

  it("generateTtsQualityLog generates complete, structured text report", () => {
    const fixedDate = new Date(2026, 9, 13, 2, 30, 0); // 2026-10-13 02:30:00
    const log = generateTtsQualityLog(mockChunks, {
      projectTitle: "Kịch bản Podcast Công Nghệ",
      activeModel: "OmniVoice",
      activeVoiceName: "Thảo Trinh (Hà Nội)",
      speed: 1.0,
      pitch: 1.0,
      volume: 1.0,
      punctuationPauses: {
        comma: 0.2,
        period: 0.6,
        questionExclamation: 0.5,
        colonSemicolon: 0.4,
      },
      exportedAt: fixedDate,
    });

    // Check Header
    assert.ok(log.includes("VOXLAB — NHẬT KÝ CẢNH BÁO & LỖI TTS"));
    assert.ok(log.includes("Dự án / Tiêu đề: Kịch bản Podcast Công Nghệ"));
    assert.ok(log.includes("Mô hình AI: OmniVoice"));
    assert.ok(log.includes("Giọng đọc: Thảo Trinh (Hà Nội)"));
    assert.ok(log.includes("Tốc độ: 1x | Cao độ: 1x | Âm lượng: 1x"));
    assert.ok(log.includes("Phẩy (,): 0.2s | Chấm (.): 0.6s"));

    // Check Stats
    assert.ok(log.includes("Tổng số đoạn (Chunks): 4"));
    assert.ok(log.includes("Đạt chuẩn (Pass): 1 đoạn"));
    assert.ok(log.includes("Cảnh báo chất lượng (Warning): 2 đoạn"));
    assert.ok(log.includes("Lỗi nghiêm trọng / Thất bại (Error/Failed): 1 đoạn"));

    // Check Issue categories
    assert.ok(log.includes("Nghỉ bất thường (ABNORMAL_PAUSE): 1"));
    assert.ok(log.includes("Thiếu từ (SUSPECTED_SWALLOWED): 1"));
    assert.ok(log.includes("Lỗi tạo audio (FAILED): 1"));

    // Check Problematic Chunk 2 Details
    assert.ok(log.includes("[ĐOẠN 02] (ID: chunk_02)"));
    assert.ok(log.includes("Trạng thái: CẢNH BÁO CHẤT LƯỢNG (WARNING)"));
    assert.ok(log.includes("Phát hiện khoảng ngắt có thể bất thường giữa 'podcast' và 'ngày' (0.58s)"));
    assert.ok(log.includes("[Thời điểm: 00:02.40 - 00:02.98]"));
    assert.ok(log.includes("Tốc độ: 135 WPM"));

    // Check Problematic Chunk 3 Details
    assert.ok(log.includes("[ĐOẠN 03] (ID: chunk_03)"));
    assert.ok(log.includes("Nghi vấn nuốt từ 'point'"));
    assert.ok(log.includes("Từ ngữ liên quan: 'point'"));

    // Check Failed Chunk 4 Details
    assert.ok(log.includes("[ĐOẠN 04] (ID: chunk_04)"));
    assert.ok(log.includes("Trạng thái: LỖI TẠO AUDIO (FAILED)"));
    assert.ok(log.includes("Lỗi runtime hệ thống: Python sidecar worker connection timeout after 30s"));

    // Passing Chunk 1 should NOT be in the problematic list
    assert.ok(!log.includes("[ĐOẠN 01] (ID: chunk_01)"));
  });

  it("handles case where 100% chunks pass quality validation", () => {
    const cleanChunks: ChunkItem[] = [
      {
        id: "chunk_01",
        index: 0,
        text: "Câu một hoàn hảo.",
        originalText: "Câu một hoàn hảo.",
        status: "ready",
        durationSec: 2.5,
        pauseAfterMs: 600,
        qualityReview: {
          status: "pass",
          issues: [],
          summary: "Đạt chuẩn",
          checkedAt: Date.now(),
        },
      },
    ];

    const log = generateTtsQualityLog(cleanChunks);
    assert.ok(log.includes("Đạt chuẩn (Pass): 1 đoạn"));
    assert.ok(log.includes("Không phát hiện bất kỳ cảnh báo hoặc lỗi nào sau khi tạo TTS."));
    assert.ok(log.includes("Toàn bộ 1 đoạn âm thanh đều đạt chuẩn chất lượng."));
  });

  it("generateTtsQualityJson creates valid JSON structure", () => {
    const json = generateTtsQualityJson(mockChunks, {
      projectTitle: "Kịch bản Test",
      activeModel: "OmniVoice",
    });

    assert.equal(json.generator, "VoxLab TTS Quality Validator");
    assert.equal(json.projectTitle, "Kịch bản Test");
    assert.equal(json.statistics.totalChunks, 4);
    assert.equal(json.statistics.passCount, 1);
    assert.equal(json.statistics.warningCount, 2);
    assert.equal(json.statistics.errorCount, 1);
    assert.equal(json.problematicChunks.length, 3);
    assert.equal(json.problematicChunks[0].id, "chunk_02");
    assert.equal(json.problematicChunks[1].id, "chunk_03");
    assert.equal(json.problematicChunks[2].id, "chunk_04");
  });
});
