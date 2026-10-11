import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ChunkItem } from "../../../types/ui";
import {
  countChunkQualityIssues,
  isChunkError,
  isChunkWarning,
  isChunkUnverified,
  isChunkPass,
  isReviewCurrent,
  isReviewOutdated,
  QUALITY_VALIDATOR_VERSION,
  validateChunkAudioQuality,
  getIssueShortLabel,
  getChunkBadgeInfo,
} from "../qualityValidator";
import { validateMasterBoundaries } from "../masterExport";

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

  it("V19: detects outdated quality reviews and associates validatorVersion", async () => {
    assert.equal(QUALITY_VALIDATOR_VERSION, "2.2.0");

    const chunkNoAudio: ChunkItem = {
      id: "c_v19",
      index: 1,
      text: "Testing versioning",
      originalText: "Testing versioning",
      status: "pending",
      pauseAfterMs: "auto",
    };

    const review = await validateChunkAudioQuality(chunkNoAudio);
    assert.equal(review.validatorVersion, "2.2.0");

    const chunkWithCurrentReview: ChunkItem = {
      ...chunkNoAudio,
      status: "ready",
      audioUrl: "blob:mock",
      qualityReview: review,
    };
    assert.equal(isReviewOutdated(chunkWithCurrentReview), false);

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
  });
});
