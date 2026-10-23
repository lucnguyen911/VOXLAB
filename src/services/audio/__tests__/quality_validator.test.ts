import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ChunkItem } from "../../../types/ui";
import {
  countChunkQualityIssues,
  isChunkError,
  isChunkWarning,
  isChunkUnverified,
  isChunkChecking,
  isChunkPass,
  isReviewCurrent,
  isReviewOutdated,
  QUALITY_VALIDATOR_VERSION,
  MAX_AUTO_VALIDATION_RETRIES,
  validateChunkAudioQuality,
  getIssueShortLabel,
  getChunkBadgeInfo,
  getChunkAudioSignature,
  isChunkConfirmed,
  hasChunkQualityWarningReview,
} from "../qualityValidator";
import { validateMasterBoundaries, validateChunksForExport } from "../masterExport";

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

  it("V9: recognizes RAPID_PACE, CROWDED_WORDS, and POSSIBLE_OMISSION as yellow warnings and doesn't count as error", () => {
    const chunks: ChunkItem[] = [
      {
        id: "chunk_pace",
        index: 1,
        text: "Too fast pace chunk",
        originalText: "Too fast pace chunk",
        status: "ready",
        durationSec: 2.1,
        pauseAfterMs: "auto",
        qualityReview: {
          status: "warning",
          issues: [
            {
              severity: "warning",
              code: "RAPID_PACE",
              message: "Tốc độ đọc dồn dập",
            },
          ],
          metrics: { wpm: 285.4, rawWpm: 285.4 },
          summary: "Tốc độ đọc dồn dập",
          checkedAt: Date.now(),
        },
      },
      {
        id: "chunk_crowded",
        index: 2,
        text: "Crowded words chunk",
        originalText: "Crowded words chunk",
        status: "ready",
        durationSec: 3.0,
        pauseAfterMs: "auto",
        qualityReview: {
          status: "warning",
          issues: [
            {
              severity: "warning",
              code: "CROWDED_WORDS",
              message: "Dính chữ",
            },
            {
              severity: "warning",
              code: "POSSIBLE_OMISSION",
              message: "Nuốt từ",
            },
          ],
          summary: "Dính chữ",
          checkedAt: Date.now(),
        },
      },
    ];

    const stats = countChunkQualityIssues(chunks);
    assert.equal(stats.errorCount, 0);
    assert.equal(stats.warningCount, 2);
    assert.equal(isChunkError(chunks[0]), false);
    assert.equal(isChunkWarning(chunks[0]), true);
    assert.equal(isChunkError(chunks[1]), false);
    assert.equal(isChunkWarning(chunks[1]), true);
  });

  it("V10: recognizes SUSPECTED_STUTTER, REPEATED_WORD, MISSING_WORD, and EXTRA_WORD as yellow warnings", () => {
    const chunks: ChunkItem[] = [
      {
        id: "chunk_stutter",
        index: 1,
        text: "Out in the Nevada desert, that comfortable certainty just shattered.",
        originalText: "Out in the Nevada desert, that comfortable certainty just shattered.",
        status: "ready",
        durationSec: 5.2,
        pauseAfterMs: "auto",
        qualityReview: {
          status: "warning",
          issues: [
            {
              severity: "warning",
              code: "SUSPECTED_STUTTER",
              message: 'Nghi vấn vấp âm gần từ "that comfortable" — khoảng 00:47. Vui lòng nghe kiểm tra.',
              words: ["that", "comfortable"],
              timeRange: [47.6, 48.2],
            },
          ],
          summary: 'Nghi vấn vấp âm gần từ "that comfortable" — khoảng 00:47. Vui lòng nghe kiểm tra.',
          checkedAt: Date.now(),
        },
      },
      {
        id: "chunk_missing",
        index: 2,
        text: "moving freight on diesel fuel",
        originalText: "moving freight on diesel fuel",
        status: "ready",
        durationSec: 3.1,
        pauseAfterMs: "auto",
        qualityReview: {
          status: "warning",
          issues: [
            {
              severity: "warning",
              code: "MISSING_WORD",
              message: 'Nghi vấn nuốt chữ tại từ "freight" — khoảng 00:01. Vui lòng nghe kiểm tra.',
              words: ["freight"],
              timeRange: [1.05, 1.10],
            },
          ],
          summary: 'Nghi vấn nuốt chữ tại từ "freight" — khoảng 00:01. Vui lòng nghe kiểm tra.',
          checkedAt: Date.now(),
        },
      },
    ];

    const stats = countChunkQualityIssues(chunks);
    assert.equal(stats.errorCount, 0);
    assert.equal(stats.warningCount, 2);
    assert.equal(isChunkError(chunks[0]), false);
    assert.equal(isChunkWarning(chunks[0]), true);
    assert.equal(isChunkError(chunks[1]), false);
    assert.equal(isChunkWarning(chunks[1]), true);
  });

  it("V11: recognizes SUSPECTED_SWALLOWED and PARTIAL_PRONUNCIATION as yellow warnings with span quotes", () => {
    const chunks: ChunkItem[] = [
      {
        id: "chunk_swallowed",
        index: 1,
        text: "Tesla cannot scale home robotics without building a vast nationwide rapid response mobile service network across North America.",
        originalText: "Tesla cannot scale home robotics without building a vast nationwide rapid response mobile service network across North America.",
        status: "ready",
        durationSec: 6.9,
        pauseAfterMs: "auto",
        qualityReview: {
          status: "warning",
          issues: [
            {
              severity: "warning",
              code: "SUSPECTED_SWALLOWED",
              message: "Vùng 'response mobile service' có dấu hiệu phát âm thiếu hoặc không rõ — khoảng 00:04. Vui lòng nghe lại.",
              words: ["response", "mobile"],
              timeRange: [4.28, 4.85],
            },
          ],
          summary: "Vùng 'response mobile service' có dấu hiệu phát âm thiếu hoặc không rõ — khoảng 00:04. Vui lòng nghe lại.",
          checkedAt: Date.now(),
        },
      },
      {
        id: "chunk_partial",
        index: 2,
        text: "rapid response mobile service",
        originalText: "rapid response mobile service",
        status: "ready",
        durationSec: 2.5,
        pauseAfterMs: "auto",
        qualityReview: {
          status: "warning",
          issues: [
            {
              severity: "warning",
              code: "PARTIAL_PRONUNCIATION",
              message: "Vùng 'response mobile service' có dấu hiệu phát âm dở dang hoặc thiếu âm tiết ('mo') — khoảng 00:00. Vui lòng nghe lại.",
              words: ["mobile", "mo"],
              timeRange: [0.88, 1.05],
            },
          ],
          summary: "Vùng 'response mobile service' có dấu hiệu phát âm dở dang hoặc thiếu âm tiết ('mo') — khoảng 00:00. Vui lòng nghe lại.",
          checkedAt: Date.now(),
        },
      },
    ];

    const stats = countChunkQualityIssues(chunks);
    assert.equal(stats.errorCount, 0);
    assert.equal(stats.warningCount, 2);
    assert.equal(isChunkError(chunks[0]), false);
    assert.equal(isChunkWarning(chunks[0]), true);
    assert.equal(isChunkError(chunks[1]), false);
    assert.equal(isChunkWarning(chunks[1]), true);
    assert.equal(chunks[0].qualityReview?.issues[0].code, "SUSPECTED_SWALLOWED");
    assert.equal(chunks[1].qualityReview?.issues[0].code, "PARTIAL_PRONUNCIATION");
  });

  it("V12: recognizes EXTRA_WORD and UNEXPECTED_LETTER_SPELLING as yellow warnings with contextual messages", () => {
    const chunks: ChunkItem[] = [
      {
        id: "chunk_extra",
        index: 1,
        text: "Inside an industrial plant, hazards are governed by corporate insurance policies.",
        originalText: "Inside an industrial plant, hazards are governed by corporate insurance policies.",
        status: "ready",
        durationSec: 5.5,
        pauseAfterMs: "auto",
        qualityReview: {
          status: "warning",
          issues: [
            {
              severity: "warning",
              code: "EXTRA_WORD",
              message: "Nghi vấn phát âm thừa từ 'It's' trước 'Inside' — khoảng 00:00. Vui lòng nghe lại.",
              words: ["its"],
              timeRange: [0.05, 0.25],
            },
          ],
          summary: "Nghi vấn phát âm thừa từ 'It's' trước 'Inside' — khoảng 00:00. Vui lòng nghe lại.",
          checkedAt: Date.now(),
        },
      },
      {
        id: "chunk_spelling",
        index: 2,
        text: "Comment BOT if you would trust a robot in your home.",
        originalText: "Comment BOT if you would trust a robot in your home.",
        status: "ready",
        durationSec: 4.2,
        pauseAfterMs: "auto",
        qualityReview: {
          status: "warning",
          issues: [
            {
              severity: "warning",
              code: "UNEXPECTED_LETTER_SPELLING",
              message: "Nghi vấn sinh thêm chữ cái 'T' sau 'BOT' — khoảng 00:01. Vui lòng nghe lại.",
              words: ["t"],
              timeRange: [0.95, 1.15],
            },
          ],
          summary: "Nghi vấn sinh thêm chữ cái 'T' sau 'BOT' — khoảng 00:01. Vui lòng nghe lại.",
          checkedAt: Date.now(),
        },
      },
    ];

    const stats = countChunkQualityIssues(chunks);
    assert.equal(stats.errorCount, 0);
    assert.equal(stats.warningCount, 2);
    assert.equal(isChunkError(chunks[0]), false);
    assert.equal(isChunkWarning(chunks[0]), true);
    assert.equal(isChunkError(chunks[1]), false);
    assert.equal(isChunkWarning(chunks[1]), true);
    assert.equal(chunks[0].qualityReview?.issues[0].code, "EXTRA_WORD");
    assert.equal(chunks[1].qualityReview?.issues[0].code, "UNEXPECTED_LETTER_SPELLING");
    assert.ok(chunks[0].qualityReview?.issues[0].message.includes("Nghi vấn phát âm thừa từ 'It's' trước 'Inside'"));
    assert.ok(chunks[1].qualityReview?.issues[0].message.includes("Nghi vấn sinh thêm chữ cái 'T' sau 'BOT'"));
  });

  it("V13: 4-status categorization correctly partitions chunks into Pass, Warning, Error, and Unverified", () => {
    const chunks: ChunkItem[] = [
      {
        id: "c_pass",
        index: 1,
        text: "Clean audio text",
        originalText: "Clean audio text",
        status: "ready",
        durationSec: 2.5,
        pauseAfterMs: "auto",
        qualityReview: {
          status: "pass",
          issues: [],
          summary: "Đạt",
          checkedAt: Date.now(),
        },
      },
      {
        id: "c_warn",
        index: 2,
        text: "Warning audio text with stutter",
        originalText: "Warning audio text with stutter",
        status: "ready",
        durationSec: 3.0,
        pauseAfterMs: "auto",
        qualityReview: {
          status: "warning",
          issues: [
            {
              severity: "warning",
              code: "SUSPECTED_STUTTER",
              message: "Nghi vấn vấp âm gần từ 'with'",
            },
          ],
          summary: "Nghi vấn vấp âm",
          checkedAt: Date.now(),
        },
      },
      {
        id: "c_err",
        index: 3,
        text: "Failed audio text",
        originalText: "Failed audio text",
        status: "failed",
        errorMessage: "Synthesis error",
        pauseAfterMs: "auto",
      },
      {
        id: "c_unverified",
        index: 4,
        text: "Audio with 0 ASR words detected",
        originalText: "Audio with 0 ASR words detected",
        status: "ready",
        durationSec: 2.0,
        pauseAfterMs: "auto",
        qualityReview: {
          status: "unverified",
          issues: [],
          summary: "Chưa kiểm chứng (ASR không nhận dạng được từ nào)",
          checkedAt: Date.now(),
        },
      },
    ];

    const stats = countChunkQualityIssues(chunks);
    assert.equal(stats.passCount, 1);
    assert.equal(stats.warningCount, 1);
    assert.equal(stats.errorCount, 1);
    assert.equal(stats.unverifiedCount, 1);

    assert.equal(isChunkPass(chunks[0]), true);
    assert.equal(isChunkWarning(chunks[1]), true);
    assert.equal(isChunkError(chunks[2]), true);
    assert.equal(isChunkUnverified(chunks[3]), true);
  });

  it("V14: validateMasterBoundaries flags excessive silence gaps (> 4.0s)", () => {
    const chunks: ChunkItem[] = [
      { id: "c1", index: 1, text: "Chunk 1", originalText: "Chunk 1", status: "ready", durationSec: 2.0, pauseAfterMs: "auto" },
      { id: "c2", index: 2, text: "Chunk 2", originalText: "Chunk 2", status: "ready", durationSec: 2.0, pauseAfterMs: "auto" },
      { id: "c3", index: 3, text: "Chunk 3", originalText: "Chunk 3", status: "ready", durationSec: 2.0, pauseAfterMs: "auto" },
    ];

    // Gap between c1 and c2 is 5000ms (> 4.0s), gap between c2 and c3 is 800ms
    const pausesMs = [5000, 800];
    const warnings = validateMasterBoundaries(chunks, pausesMs);

    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].type, "gap_too_long");
    assert.equal(warnings[0].chunkIndex, 0);
    assert.ok(warnings[0].message.includes("5.0s > 4.0s"));
  });

  it("V15: getIssueShortLabel maps all quality error and warning codes to ultra-short categories", () => {
    // 5 core groups
    assert.equal(getIssueShortLabel("SUSPECTED_STUTTER"), "Vấp từ");
    assert.equal(getIssueShortLabel("REPEATED_WORD"), "Lặp từ");
    assert.equal(getIssueShortLabel("REPEATED_WORDS"), "Lặp từ");
    assert.equal(getIssueShortLabel("MISSING_WORD"), "Thiếu từ");
    assert.equal(getIssueShortLabel("SUSPECTED_SWALLOWED"), "Thiếu từ");
    assert.equal(getIssueShortLabel("PARTIAL_PRONUNCIATION"), "Phát âm sai");
    assert.equal(getIssueShortLabel("SUSPECTED_MISPRONUNCIATION"), "Phát âm sai");
    assert.equal(getIssueShortLabel("EXTRA_WORD"), "Đọc thừa");
    assert.equal(getIssueShortLabel("UNEXPECTED_LETTER_SPELLING"), "Đọc thừa");
    assert.equal(getIssueShortLabel("ABNORMAL_PAUSE"), "Nghỉ bất thường");
    assert.equal(getIssueShortLabel("suspicious_intra_pause"), "Nghỉ bất thường");

    // Technical / error codes
    assert.equal(getIssueShortLabel("DURATION_TOO_SHORT"), "Audio quá ngắn");
    assert.equal(getIssueShortLabel("too_short"), "Audio quá ngắn");
    assert.equal(getIssueShortLabel("AUDIO_SILENT"), "Audio im lặng");
    assert.equal(getIssueShortLabel("FILE_CORRUPTED"), "File audio lỗi");

    // Fallbacks
    assert.equal(getIssueShortLabel("UNKNOWN_NEW_CODE"), "Cần kiểm tra");
    assert.equal(getIssueShortLabel(undefined), "Cần kiểm tra");
    assert.equal(getIssueShortLabel(""), "Cần kiểm tra");
  });

  it("V16: getChunkBadgeInfo deduplicates issues of same category and handles multi-category chunks", () => {
    // Case 1: 3 stutter warnings on the same chunk -> deduplicated to 1 label "Vấp từ"
    const chunk3Stutters: ChunkItem = {
      id: "c_stutter",
      index: 1,
      text: "Test text",
      originalText: "Test text",
      status: "ready",
      pauseAfterMs: "auto",
      qualityReview: {
        status: "warning",
        summary: "Nghi vấn vấp âm",
        checkedAt: Date.now(),
        issues: [
          { severity: "warning", code: "SUSPECTED_STUTTER", message: "Vấp 1" },
          { severity: "warning", code: "SUSPECTED_STUTTER", message: "Vấp 2" },
          { severity: "warning", code: "SUSPECTED_STUTTER", message: "Vấp 3" },
        ],
      },
    };
    const badge1 = getChunkBadgeInfo(chunk3Stutters);
    assert.ok(badge1);
    assert.equal(badge1.status, "warning");
    assert.equal(badge1.uniqueLabels.length, 1);
    assert.equal(badge1.fullBadgeText, "Vấp từ");
    assert.equal(badge1.compactBadgeText, "Vấp từ");
    assert.equal(badge1.issuesCount, 3);

    // Case 2: 3 stutters + 1 extra word -> "Vấp từ · Đọc thừa" (full) or "Vấp từ · +1" (compact)
    const chunkMulti: ChunkItem = {
      id: "c_multi",
      index: 2,
      text: "Test text multi",
      originalText: "Test text multi",
      status: "ready",
      pauseAfterMs: "auto",
      qualityReview: {
        status: "warning",
        summary: "Nghi vấn vấp âm và đọc thừa",
        checkedAt: Date.now(),
        issues: [
          { severity: "warning", code: "SUSPECTED_STUTTER", message: "Vấp 1" },
          { severity: "warning", code: "SUSPECTED_STUTTER", message: "Vấp 2" },
          { severity: "warning", code: "SUSPECTED_STUTTER", message: "Vấp 3" },
          { severity: "warning", code: "EXTRA_WORD", message: "Thừa từ" },
        ],
      },
    };
    const badge2 = getChunkBadgeInfo(chunkMulti);
    assert.ok(badge2);
    assert.equal(badge2.status, "warning");
    assert.deepEqual(badge2.uniqueLabels, ["Vấp từ", "Đọc thừa"]);
    assert.equal(badge2.fullBadgeText, "Vấp từ · Đọc thừa");
    assert.equal(badge2.compactBadgeText, "Vấp từ · +1");
    assert.equal(badge2.issuesCount, 4);

    // Case 3: 3 distinct categories -> "Vấp từ · Đọc thừa · Nghỉ bất thường" (full) or "Vấp từ · +2" (compact)
    const chunk3Categories: ChunkItem = {
      id: "c_tri",
      index: 3,
      text: "Test text tri",
      originalText: "Test text tri",
      status: "ready",
      pauseAfterMs: "auto",
      qualityReview: {
        status: "warning",
        summary: "Nhiều cảnh báo",
        checkedAt: Date.now(),
        issues: [
          { severity: "warning", code: "SUSPECTED_STUTTER", message: "Vấp" },
          { severity: "warning", code: "EXTRA_WORD", message: "Thừa" },
          { severity: "warning", code: "ABNORMAL_PAUSE", message: "Nghỉ" },
        ],
      },
    };
    const badge3 = getChunkBadgeInfo(chunk3Categories);
    assert.ok(badge3);
    assert.equal(badge3.fullBadgeText, "Vấp từ · Đọc thừa · Nghỉ bất thường");
    assert.equal(badge3.compactBadgeText, "Vấp từ · +2");
  });

  it("V17: getChunkBadgeInfo formats error and unverified chunks properly and returns null for pass", () => {
    // Chunk 03: 0.1s WAV error -> "Audio quá ngắn"
    const chunk03: ChunkItem = {
      id: "chunk_03",
      index: 3,
      text: "Too short",
      originalText: "Too short",
      status: "failed",
      durationSec: 0.1,
      pauseAfterMs: "auto",
      qualityReview: {
        status: "error",
        summary: "Thời lượng âm thanh quá ngắn (< 0.2s)",
        checkedAt: Date.now(),
        issues: [{ severity: "error", code: "DURATION_TOO_SHORT", message: "Quá ngắn" }],
      },
    };
    const badge03 = getChunkBadgeInfo(chunk03);
    assert.ok(badge03);
    assert.equal(badge03.status, "error");
    assert.equal(badge03.fullBadgeText, "Audio quá ngắn");

    // Unverified chunk -> "Chưa kiểm chứng"
    const chunkUnverified: ChunkItem = {
      id: "chunk_unv",
      index: 4,
      text: "Unverified text",
      originalText: "Unverified text",
      status: "ready",
      durationSec: 3.0,
      pauseAfterMs: "auto",
      qualityReview: {
        status: "unverified",
        summary: "Chưa kiểm chứng (ASR không khả dụng)",
        checkedAt: Date.now(),
        issues: [],
      },
    };
    const badgeUnv = getChunkBadgeInfo(chunkUnverified);
    assert.ok(badgeUnv);
    assert.equal(badgeUnv.status, "unverified");
    assert.equal(badgeUnv.fullBadgeText, "Chưa kiểm chứng");
    assert.equal(badgeUnv.compactBadgeText, "Chưa kiểm chứng");

    // Pass chunk -> null (no badge)
    const chunkPass: ChunkItem = {
      id: "chunk_01",
      index: 1,
      text: "Clean",
      originalText: "Clean",
      status: "ready",
      durationSec: 4.2,
      pauseAfterMs: "auto",
      qualityReview: {
        status: "pass",
        summary: "Đạt",
        checkedAt: Date.now(),
        issues: [],
      },
    };
    assert.equal(getChunkBadgeInfo(chunkPass), null);

    // Pending chunk -> null (no badge)
    const chunkPending: ChunkItem = {
      id: "chunk_05",
      index: 5,
      text: "Pending",
      originalText: "Pending",
      status: "pending",
      pauseAfterMs: "auto",
    };
    assert.equal(getChunkBadgeInfo(chunkPending), null);
  });

  it("V18: backend retains technical data (code, message, words, timeRange) while UI badge is concise", () => {
    const chunk: ChunkItem = {
      id: "c_detail",
      index: 1,
      text: "The steering wheel provides accurate feedback.",
      originalText: "The steering wheel provides accurate feedback.",
      status: "ready",
      durationSec: 3.5,
      pauseAfterMs: "auto",
      qualityReview: {
        status: "warning",
        summary: "Nghi vấn phát âm sai",
        checkedAt: Date.now(),
        issues: [
          {
            severity: "warning",
            code: "SUSPECTED_MISPRONUNCIATION",
            message: "Nghi vấn phát âm sai từ 'steering' (ASR ghi nhận 'steelering') — khoảng 00:01. Vui lòng nghe lại.",
            words: ["steering", "steelering"],
            timeRange: [1.2, 1.85],
          },
        ],
      },
    };

    // UI badge is strictly short
    const badge = getChunkBadgeInfo(chunk);
    assert.ok(badge);
    assert.equal(badge.fullBadgeText, "Phát âm sai");

    // Underlying technical data is completely preserved
    const issue = chunk.qualityReview!.issues[0];
    assert.equal(issue.code, "SUSPECTED_MISPRONUNCIATION");
    assert.deepEqual(issue.words, ["steering", "steelering"]);
    assert.deepEqual(issue.timeRange, [1.2, 1.85]);
    assert.ok(issue.message.includes("steelering"));
  });

  it("V19: detects outdated quality reviews and associates validatorVersion and asrModelId", async () => {
    assert.equal(QUALITY_VALIDATOR_VERSION, "3.1.0");

    const chunkNoAudio: ChunkItem = {
      id: "c_v19",
      index: 1,
      text: "Testing versioning",
      originalText: "Testing versioning",
      status: "ready",
      pauseAfterMs: "auto",
    };

    const review = await validateChunkAudioQuality(chunkNoAudio, undefined, undefined, undefined, "large-v3-turbo");
    assert.equal(review.validatorVersion, "3.1.0");
    assert.equal(review.asrModelId, "large-v3-turbo");

    const chunkWithCurrentReview: ChunkItem = {
      ...chunkNoAudio,
      status: "ready",
      audioUrl: "blob:mock",
      qualityReview: review,
    };
    assert.equal(isReviewOutdated(chunkWithCurrentReview), false);
    assert.equal(isReviewOutdated(chunkWithCurrentReview, "large-v3-turbo"), false);

    // Stale review due to different ASR model selected
    assert.equal(isReviewOutdated(chunkWithCurrentReview, "small"), true);
    assert.equal(isReviewOutdated(chunkWithCurrentReview, "large-v3"), true);

    // Stale review due to text modification
    const chunkModifiedText: ChunkItem = {
      ...chunkWithCurrentReview,
      text: "Testing versioning modified",
    };
    assert.equal(isReviewOutdated(chunkModifiedText), true);

    // Stale review due to older validator version
    const chunkOlderVersion: ChunkItem = {
      ...chunkWithCurrentReview,
      qualityReview: {
        ...review,
        validatorVersion: "1.0.0",
      },
    };
    assert.equal(isReviewOutdated(chunkOlderVersion), true);

    // Stale review due to audio signature mismatch
    const chunkMismatchedSig: ChunkItem = {
      ...chunkWithCurrentReview,
      durationSec: 9.9,
      qualityReview: {
        ...review,
        audioSignature: "blob:mock::2.0",
      },
    };
    assert.equal(isReviewOutdated(chunkMismatchedSig), true);
  });

  it("V20: getChunkAudioSignature generates deterministic signature and detects audio changes", () => {
    const chunkA: ChunkItem = {
      id: "c_v20_a",
      index: 1,
      text: "Testing signature",
      originalText: "Testing signature",
      status: "ready",
      durationSec: 2.5,
      audioUrl: "blob:http://localhost/1234",
      pauseAfterMs: "auto",
    };

    const sigA = getChunkAudioSignature(chunkA);
    assert.equal(sigA, "blob:http://localhost/1234::2.5");

    // Audio file path fallback
    const chunkB: ChunkItem = {
      ...chunkA,
      audioUrl: undefined,
      audioFilePath: "C:\\audio\\chunk_1.wav",
    };
    assert.equal(getChunkAudioSignature(chunkB), "C:\\audio\\chunk_1.wav::2.5");

    // Missing audio
    const chunkEmpty: ChunkItem = {
      ...chunkA,
      audioUrl: undefined,
      audioFilePath: undefined,
    };
    assert.equal(getChunkAudioSignature(chunkEmpty), "");
  });

  it("V21: confirmation ('Xác nhận đọc đúng') suppresses warnings without deleting review and invalidates on regenerate", () => {
    const warningChunk: ChunkItem = {
      id: "c_v21",
      index: 1,
      text: "zero point eight",
      originalText: "zero point eight",
      status: "ready",
      durationSec: 1.1,
      audioUrl: "blob:http://localhost/initial_audio",
      pauseAfterMs: "auto",
      qualityReview: {
        status: "warning",
        issues: [
          {
            severity: "warning",
            code: "SUSPECTED_SWALLOWED",
            message: "Nghi vấn nuốt chữ tại từ point",
            words: ["point"],
          },
        ],
        summary: "Nghi vấn nuốt chữ tại từ point",
        checkedAt: Date.now(),
        validatorVersion: QUALITY_VALIDATOR_VERSION,
      },
    };

    // Before confirmation: active warning
    assert.equal(isChunkConfirmed(warningChunk), false);
    assert.equal(isChunkWarning(warningChunk), true);
    assert.equal(hasChunkQualityWarningReview(warningChunk), true);
    let stats = countChunkQualityIssues([warningChunk]);
    assert.equal(stats.warningCount, 1);
    assert.equal(stats.passCount, 0);

    // Confirm audio as correct
    const confirmedChunk: ChunkItem = {
      ...warningChunk,
      acknowledgedAt: Date.now(),
      acknowledgedAudioSignature: getChunkAudioSignature(warningChunk),
    };

    // After confirmation: warning is acknowledged, does not block export or count as warning
    assert.equal(isChunkConfirmed(confirmedChunk), true);
    assert.equal(isChunkWarning(confirmedChunk), false);
    // Original review data is preserved!
    assert.equal(hasChunkQualityWarningReview(confirmedChunk), true);
    assert.equal(confirmedChunk.qualityReview?.issues.length, 1);
    stats = countChunkQualityIssues([confirmedChunk]);
    assert.equal(stats.warningCount, 0);

    // Regenerating chunk (new audio URL and new duration) automatically invalidates confirmation!
    const regeneratedChunk: ChunkItem = {
      ...confirmedChunk,
      audioUrl: "blob:http://localhost/new_audio_regenerated",
      durationSec: 1.25,
    };
    assert.equal(isChunkConfirmed(regeneratedChunk), false);
    assert.equal(isChunkWarning(regeneratedChunk), true);
    stats = countChunkQualityIssues([regeneratedChunk]);
    assert.equal(stats.warningCount, 1);

    // Error chunks cannot have errors silenced by warning confirmation
    const errorChunk: ChunkItem = {
      ...confirmedChunk,
      status: "failed",
    };
    assert.equal(isChunkError(errorChunk), true);
    assert.equal(isChunkWarning(errorChunk), false);
  });

  it("V22: automated v2.4.0 QC pipeline: yellow warnings do NOT block Master Export, red errors DO block", () => {
    // Case 1: Chunks with yellow warnings (e.g. SUSPECTED_SWALLOWED, MISSING_WORD)
    const warningChunks: ChunkItem[] = [
      {
        id: "c_warn_1",
        index: 1,
        text: "zero point eight",
        originalText: "zero point eight",
        status: "ready",
        durationSec: 1.5,
        audioUrl: "blob:http://localhost/audio1",
        pauseAfterMs: "auto",
        qualityReview: {
          status: "warning",
          issues: [
            {
              severity: "warning",
              code: "MISSING_WORD",
              message: "Nghi vấn nuốt chữ tại từ point",
              words: ["point"],
            },
          ],
          summary: "Nghi vấn nuốt chữ tại từ point",
          checkedAt: Date.now(),
          validatorVersion: QUALITY_VALIDATOR_VERSION,
        },
      },
    ];

    // Warning chunks are identified as warnings for listening review
    assert.equal(isChunkWarning(warningChunks[0]), true);
    assert.equal(isChunkError(warningChunks[0]), false);

    // CRITICAL REQUIREMENT (User Prompt Section 1):
    // Yellow warnings NEVER block Master Export!
    const exportResultWarning = validateChunksForExport(warningChunks);
    assert.equal(exportResultWarning.canExport, true, "Yellow warning must NOT block Master Export");
    assert.equal(exportResultWarning.invalidChunks.length, 0);

    // Case 2: Outdated review from v2.3.0 is recognized as outdated for automatic revalidation
    const outdatedChunk: ChunkItem = {
      ...warningChunks[0],
      qualityReview: {
        ...warningChunks[0].qualityReview!,
        validatorVersion: "2.3.0",
      },
    };
    assert.equal(isReviewOutdated(outdatedChunk), true, "Review from v2.3.0 must be detected as outdated");

    // Case 3: Chunks with red errors DO block Master Export
    const errorChunks: ChunkItem[] = [
      {
        id: "c_err_1",
        index: 1,
        text: "corrupted audio",
        originalText: "corrupted audio",
        status: "ready",
        durationSec: 0.1,
        audioUrl: "blob:http://localhost/audio_err",
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
          validatorVersion: QUALITY_VALIDATOR_VERSION,
        },
      },
    ];
    assert.equal(isChunkError(errorChunks[0]), true);
    const exportResultError = validateChunksForExport(errorChunks);
    assert.equal(exportResultError.canExport, false, "Red error MUST block Master Export");
    assert.equal(exportResultError.invalidChunks.length, 1);
  });

  it("V23: isChunkChecking and checkingCount in countChunkQualityIssues correctly partition checking chunks", () => {
    const checkingChunk: ChunkItem = {
      id: "chunk_checking_01",
      index: 1,
      text: "Testing audio speech synthesis",
      originalText: "Testing audio speech synthesis",
      status: "ready",
      durationSec: 2.5,
      pauseAfterMs: "auto",
      qualityReview: {
        status: "checking",
        issues: [],
        summary: "Đang kiểm tra...",
        checkedAt: Date.now(),
        validatorVersion: QUALITY_VALIDATOR_VERSION,
        asrModelId: "small",
      },
    };

    assert.equal(isChunkChecking(checkingChunk), true);
    assert.equal(isChunkUnverified(checkingChunk), false);
    assert.equal(isChunkPass(checkingChunk), false);
    assert.equal(isChunkError(checkingChunk), false);
    assert.equal(isChunkWarning(checkingChunk), false);

    const stats = countChunkQualityIssues([checkingChunk]);
    assert.equal(stats.checkingCount, 1);
    assert.equal(stats.unverifiedCount, 0);
    assert.equal(stats.passCount, 0);
    assert.equal(stats.errorCount, 0);
    assert.equal(stats.warningCount, 0);
    assert.equal(stats.checkingChunks[0].id, "chunk_checking_01");
  });

  it("V24: getChunkBadgeInfo formats checking status as 'Đang kiểm tra...'", () => {
    const checkingChunk: ChunkItem = {
      id: "chunk_checking_02",
      index: 2,
      text: "Checking badge text",
      originalText: "Checking badge text",
      status: "ready",
      durationSec: 1.8,
      pauseAfterMs: "auto",
      qualityReview: {
        status: "checking",
        issues: [],
        summary: "Đang kiểm tra...",
        checkedAt: Date.now(),
        validatorVersion: QUALITY_VALIDATOR_VERSION,
        asrModelId: "small",
      },
    };

    const badge = getChunkBadgeInfo(checkingChunk);
    assert.ok(badge);
    assert.equal(badge.status, "checking");
    assert.equal(badge.primaryLabel, "Đang kiểm tra...");
    assert.equal(badge.fullBadgeText, "Đang kiểm tra...");
  });

  it("V25: isReviewOutdated auto-recovers unverified chunks from missing model when ASR is ready", () => {
    const unverifiedFromMissingModel: ChunkItem = {
      id: "chunk_unverified_01",
      index: 1,
      text: "Unverified because model was missing",
      originalText: "Unverified because model was missing",
      status: "ready",
      durationSec: 3.0,
      pauseAfterMs: "auto",
      qualityReview: {
        status: "unverified",
        issues: [],
        summary: "Chưa kiểm chứng (không tìm thấy mô hình Whisper 'large-v3-turbo' cục bộ)",
        checkedAt: Date.now(),
        validatorVersion: QUALITY_VALIDATOR_VERSION,
        asrModelId: "large-v3-turbo",
      },
    };

    // When ASR is ready, this chunk should be marked outdated for auto-recovery
    assert.equal(isReviewOutdated(unverifiedFromMissingModel, "large-v3-turbo", true), true);

    // If ASR is not ready, do not mark outdated to avoid endless loops
    assert.equal(isReviewOutdated(unverifiedFromMissingModel, "large-v3-turbo", false), false);

    // When model changes to 'small', it is also outdated
    assert.equal(isReviewOutdated(unverifiedFromMissingModel, "small", true), true);

    // Once validated cleanly as pass with small, it is no longer outdated
    const passedChunk: ChunkItem = {
      ...unverifiedFromMissingModel,
      qualityReview: {
        status: "pass",
        issues: [],
        summary: "Đạt",
        checkedAt: Date.now(),
        validatorVersion: QUALITY_VALIDATOR_VERSION,
        asrModelId: "small",
      },
    };
    assert.equal(isReviewOutdated(passedChunk, "small", true), false);
  });

  it("V26: isReviewCurrent and isReviewOutdated invalidate review when chunk text is cleared to empty string", () => {
    const validChunk: ChunkItem = {
      id: "chunk_v26",
      index: 1,
      text: "Original sentence",
      originalText: "Original sentence",
      status: "ready",
      durationSec: 2.0,
      audioUrl: "blob:http://localhost/audio_v26",
      pauseAfterMs: "auto",
      qualityReview: {
        status: "pass",
        issues: [],
        summary: "Đạt",
        checkedAt: Date.now(),
        text: "Original sentence",
        validatorVersion: QUALITY_VALIDATOR_VERSION,
        audioSignature: "blob:http://localhost/audio_v26::2",
      },
    };

    assert.equal(isReviewCurrent(validChunk), true);
    assert.equal(isReviewOutdated(validChunk), false);

    // Clearing text to empty string or whitespace must invalidate the review
    const clearedChunk: ChunkItem = {
      ...validChunk,
      text: "",
    };
    assert.equal(isReviewCurrent(clearedChunk), false);
    assert.equal(isReviewOutdated(clearedChunk), true);

    const whitespaceChunk: ChunkItem = {
      ...validChunk,
      text: "   ",
    };
    assert.equal(isReviewCurrent(whitespaceChunk), false);
    assert.equal(isReviewOutdated(whitespaceChunk), true);
  });

  it("V27: getChunkAudioSignature includes audioRevision to invalidate in-place regenerated files with identical path and duration", () => {
    const rev1Chunk: ChunkItem = {
      id: "chunk_v27",
      index: 1,
      text: "Same text regenerated",
      originalText: "Same text regenerated",
      status: "ready",
      durationSec: 2.5,
      audioFilePath: "C:\\scratch\\tts\\chunk_v27.wav",
      audioRevision: 1,
      pauseAfterMs: "auto",
    };

    const sig1 = getChunkAudioSignature(rev1Chunk);
    assert.equal(sig1, "C:\\scratch\\tts\\chunk_v27.wav::2.5::v1");

    const reviewedRev1: ChunkItem = {
      ...rev1Chunk,
      acknowledgedAt: Date.now(),
      acknowledgedAudioSignature: sig1,
      qualityReview: {
        status: "warning",
        issues: [
          {
            severity: "warning",
            code: "SUSPECTED_SWALLOWED",
            message: "Nghi vấn nuốt chữ",
          },
        ],
        summary: "Nghi vấn nuốt chữ",
        checkedAt: Date.now(),
        text: "Same text regenerated",
        validatorVersion: QUALITY_VALIDATOR_VERSION,
        audioSignature: sig1,
      },
    };

    assert.equal(isReviewCurrent(reviewedRev1), true);
    assert.equal(isChunkConfirmed(reviewedRev1), true);

    // Regenerated in-place: same file path and same duration (2.5s), but audioRevision incremented to 2
    const rev2Chunk: ChunkItem = {
      ...reviewedRev1,
      audioRevision: 2,
    };
    const sig2 = getChunkAudioSignature(rev2Chunk);
    assert.equal(sig2, "C:\\scratch\\tts\\chunk_v27.wav::2.5::v2");
    assert.notEqual(sig1, sig2);
    assert.equal(isReviewCurrent(rev2Chunk), false);
    assert.equal(isReviewOutdated(rev2Chunk), true);
    assert.equal(isChunkConfirmed(rev2Chunk), false);
  });

  it("V28: isReviewOutdated matches uppercase 'Quá thời gian' timeout summary and caps auto-retries at MAX_AUTO_VALIDATION_RETRIES", () => {
    const timedOutChunk: ChunkItem = {
      id: "chunk_v28",
      index: 1,
      text: "Chunk that timed out during ASR",
      originalText: "Chunk that timed out during ASR",
      status: "ready",
      durationSec: 4.0,
      audioFilePath: "C:\\scratch\\tts\\chunk_v28.wav",
      pauseAfterMs: "auto",
      qualityReview: {
        status: "unverified",
        issues: [],
        summary: "Chưa kiểm chứng (Quá thời gian chờ ASR (25s))",
        checkedAt: Date.now(),
        text: "Chunk that timed out during ASR",
        validatorVersion: QUALITY_VALIDATOR_VERSION,
        asrModelId: "small",
        audioSignature: "C:\\scratch\\tts\\chunk_v28.wav::4",
        retryCount: 0,
      },
    };

    // With retryCount = 0 (< MAX_AUTO_VALIDATION_RETRIES) and ASR ready, it is marked outdated for auto-recovery
    assert.equal(isReviewOutdated(timedOutChunk, "small", true), true);

    // Once retryCount reaches MAX_AUTO_VALIDATION_RETRIES, it stops auto-retrying to prevent infinite timeout loops
    const exhaustedChunk: ChunkItem = {
      ...timedOutChunk,
      qualityReview: {
        ...timedOutChunk.qualityReview!,
        retryCount: MAX_AUTO_VALIDATION_RETRIES,
      },
    };
    assert.equal(isReviewOutdated(exhaustedChunk, "small", true), false);

    // Changing ASR model still triggers re-validation even after retry exhaustion on old model
    assert.equal(isReviewOutdated(exhaustedChunk, "large-v3-turbo", true), true);
  });

  it("V29: maps UNVERIFIED_PAUSE to 'Chưa kiểm chứng' and invalidates v3.0.0 reviews under v3.1.0", () => {
    assert.equal(getIssueShortLabel("UNVERIFIED_PAUSE"), "Chưa kiểm chứng");

    const v300Chunk: ChunkItem = {
      id: "chunk_v29",
      index: 1,
      text: "Testing v3.1.0 upgrade invalidation",
      originalText: "Testing v3.1.0 upgrade invalidation",
      status: "ready",
      durationSec: 3.2,
      audioFilePath: "C:\\scratch\\tts\\chunk_v29.wav",
      pauseAfterMs: "auto",
      qualityReview: {
        status: "warning",
        issues: [
          {
            severity: "warning",
            code: "ABNORMAL_PAUSE",
            message: "Old v3.0.0 false positive",
          },
        ],
        summary: "Nghi vấn ngắt bất thường",
        checkedAt: Date.now(),
        text: "Testing v3.1.0 upgrade invalidation",
        validatorVersion: "3.0.0",
        asrModelId: "large-v3-turbo",
        audioSignature: "C:\\scratch\\tts\\chunk_v29.wav::3.2",
      },
    };
    assert.equal(isReviewOutdated(v300Chunk, "large-v3-turbo", true), true);
  });
});

