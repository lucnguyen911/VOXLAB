import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ChunkItem } from "../../../types/ui";
import {
  countChunkQualityIssues,
  isChunkError,
  isChunkWarning,
  isReviewCurrent,
  validateChunkAudioQuality,
} from "../qualityValidator";

describe("Audio Quality Validator Tests", () => {
  it("V1: countChunkQualityIssues returns 0 for clean ready chunks", () => {
    const chunks: ChunkItem[] = [
      {
        id: "chunk_01",
        index: 1,
        text: "Clean text 1",
        originalText: "Clean text 1",
        status: "ready",
        durationSec: 3.5,
        pauseAfterMs: "auto",
        qualityReview: {
          status: "pass",
          issues: [],
          summary: "Đạt",
          checkedAt: Date.now(),
        },
      },
      {
        id: "chunk_02",
        index: 2,
        text: "Clean text 2",
        originalText: "Clean text 2",
        status: "ready",
        durationSec: 4.1,
        pauseAfterMs: "auto",
        qualityReview: {
          status: "unverified",
          issues: [],
          summary: "Chưa kiểm chứng",
          checkedAt: Date.now(),
        },
      },
    ];

    const result = countChunkQualityIssues(chunks);
    assert.equal(result.errorCount, 0);
    assert.equal(result.warningCount, 0);
    assert.equal(result.errorChunks.length, 0);
    assert.equal(result.warningChunks.length, 0);
  });

  it("V2: counts failed chunk as 1 error", () => {
    const chunks: ChunkItem[] = [
      {
        id: "chunk_01",
        index: 1,
        text: "Failed chunk",
        originalText: "Failed chunk",
        status: "failed",
        errorMessage: "Network timeout",
        pauseAfterMs: "auto",
      },
    ];

    const result = countChunkQualityIssues(chunks);
    assert.equal(result.errorCount, 1);
    assert.equal(result.warningCount, 0);
    assert.equal(result.errorChunks[0].id, "chunk_01");
    assert.equal(isChunkError(chunks[0]), true);
    assert.equal(isChunkWarning(chunks[0]), false);
  });

  it("V3: counts chunk with error qualityReview as error", () => {
    const chunks: ChunkItem[] = [
      {
        id: "chunk_01",
        index: 1,
        text: "Corrupted audio",
        originalText: "Corrupted audio",
        status: "ready",
        durationSec: 0.1,
        pauseAfterMs: "auto",
        qualityReview: {
          status: "error",
          issues: [
            {
              severity: "error",
              code: "DURATION_TOO_SHORT",
              message: "Thời lượng âm thanh quá ngắn",
            },
          ],
          summary: "Thời lượng âm thanh quá ngắn",
          checkedAt: Date.now(),
        },
      },
    ];

    const result = countChunkQualityIssues(chunks);
    assert.equal(result.errorCount, 1);
    assert.equal(result.warningCount, 0);
    assert.equal(isChunkError(chunks[0]), true);
  });

  it("V4: counts a chunk with multiple warning issues as exactly 1 warning chunk (no count inflation)", () => {
    const chunks: ChunkItem[] = [
      {
        id: "chunk_01",
        index: 1,
        text: "It is the staggering cost of moving freight on diesel fuel, an economic burden baked into every physical product sold across the nation.",
        originalText: "It is the staggering cost of moving freight on diesel fuel, an economic burden baked into every physical product sold across the nation.",
        status: "ready",
        durationSec: 6.8,
        pauseAfterMs: "auto",
        qualityReview: {
          status: "warning",
          issues: [
            {
              severity: "warning",
              code: "ABNORMAL_PAUSE",
              message: "Phát hiện khoảng ngắt có thể bất thường giữa 'diesel' và 'fuel' (0.58s)",
              words: ["diesel", "fuel"],
              timeRange: [3.15, 3.73],
            },
            {
              severity: "warning",
              code: "ABNORMAL_PAUSE",
              message: "Phát hiện khoảng ngắt có thể bất thường giữa 'physical' và 'product' (0.52s)",
              words: ["physical", "product"],
              timeRange: [5.2, 5.72],
            },
          ],
          summary: "Phát hiện khoảng ngắt có thể bất thường giữa 'diesel' và 'fuel' (0.58s)",
          checkedAt: Date.now(),
        },
      },
    ];

    const result = countChunkQualityIssues(chunks);
    assert.equal(result.errorCount, 0);
    assert.equal(result.warningCount, 1);
    assert.equal(result.warningChunks[0].id, "chunk_01");
    assert.equal(isChunkWarning(chunks[0]), true);
    assert.equal(isChunkError(chunks[0]), false);
  });

  it("V5: priority rule - if a chunk has both error status and warning qualityReview, it counts only as Error (Red)", () => {
    const chunks: ChunkItem[] = [
      {
        id: "chunk_01",
        index: 1,
        text: "Conflicted chunk",
        originalText: "Conflicted chunk",
        status: "failed",
        errorMessage: "Synthesis crash",
        pauseAfterMs: "auto",
        qualityReview: {
          status: "warning",
          issues: [
            {
              severity: "warning",
              code: "ABNORMAL_PAUSE",
              message: "Potential pause",
            },
          ],
          summary: "Potential pause",
          checkedAt: Date.now(),
        },
      },
    ];

    const result = countChunkQualityIssues(chunks);
    assert.equal(result.errorCount, 1);
    assert.equal(result.warningCount, 0);
    assert.equal(isChunkError(chunks[0]), true);
    assert.equal(isChunkWarning(chunks[0]), false);
  });

  it("V6: modified status chunk is not counted as quality warning", () => {
    const chunks: ChunkItem[] = [
      {
        id: "chunk_01",
        index: 1,
        text: "Edited text",
        originalText: "Original text",
        status: "modified",
        pauseAfterMs: "auto",
      },
    ];

    const result = countChunkQualityIssues(chunks);
    assert.equal(result.errorCount, 0);
    assert.equal(result.warningCount, 0);
  });

  it("V7: isReviewCurrent verifies review matches chunk text", () => {
    const chunk: ChunkItem = {
      id: "chunk_01",
      index: 1,
      text: "New text",
      originalText: "Old text",
      status: "ready",
      pauseAfterMs: "auto",
      qualityReview: {
        status: "warning",
        issues: [],
        summary: "Old warning",
        checkedAt: Date.now(),
        text: "Old text",
      },
    };

    assert.equal(isReviewCurrent(chunk), false);

    const updatedChunk: ChunkItem = {
      ...chunk,
      qualityReview: {
        ...chunk.qualityReview!,
        text: "New text",
      },
    };
    assert.equal(isReviewCurrent(updatedChunk), true);
  });

  it("V8: validateChunkAudioQuality handles missing audio without throwing", async () => {
    const chunk: ChunkItem = {
      id: "chunk_01",
      index: 1,
      text: "Test text",
      originalText: "Test text",
      status: "pending",
      pauseAfterMs: "auto",
    };

    const review = await validateChunkAudioQuality(chunk);
    assert.equal(review.status, "error");
    assert.equal(review.issues[0]?.code, "NO_AUDIO");
  });
});
