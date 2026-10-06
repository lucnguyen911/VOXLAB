import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  generateSubtitlesFromText,
  generateSubtitlesFromChunks,
  generateSrtContent,
} from "../pipeline";
import {
  findProtectedSpans,
} from "../protectedSpans";
import {
  splitLongSentenceIntoClauses,
} from "../candidates";
import { getSubtitleProfile } from "../profiles";
import { validateSubtitles } from "../validator";
import { exportToSrt } from "../exporter";
import { ChunkItem } from "../../../types/ui";

describe("Subtitle SRT System Specification Tests (Sections 1 - 20)", () => {
  const profile9_16 = getSubtitleProfile("9:16");

  // 1. NORMAL SENTENCES
  it("Test 1: Normal sentences are segmented cleanly without losing tokens", () => {
    const text = "This is the first sentence. This is the second sentence.";
    const cues = generateSubtitlesFromText(text, { aspectRatio: "16:9" });

    assert.ok(cues.length >= 1, "Should generate at least 1 cue");
    const fullText = cues.map((c) => c.text).join(" ");
    assert.equal(fullText, text, "All tokens must be preserved in order");

    const val = validateSubtitles(cues, text);
    assert.equal(val.valid, true, `Validation must pass: ${val.errors.join(", ")}`);
  });

  // 2. SHORT SENTENCES (MERGING)
  it("Test 2: Short sentences merge into a unified cue when within profile constraints", () => {
    const text = "No. Not yet. Wait.";
    const cues = generateSubtitlesFromText(text, { aspectRatio: "16:9" });

    // In 16:9, total words = 4, width = 18 chars <= maxWidth (40)
    // Should merge into 1 concise cue
    assert.equal(cues.length, 1, "Short sentences should merge into a single cue in 16:9");
    assert.equal(cues[0].text, "No. Not yet. Wait.");
    assert.equal(validateSubtitles(cues, text).valid, true);
  });

  // 3. LONG SENTENCE
  it("Test 3: Long sentence splits at natural clause / comma boundaries", () => {
    const longText =
      "Trong những năm gần đây, trí tuệ nhân tạo đã phát triển rất nhanh, đặc biệt trong lĩnh vực sáng tạo nội dung số.";
    const cues = generateSubtitlesFromText(longText, { aspectRatio: "16:9" });

    assert.ok(cues.length >= 2, "Long sentence should be split into multiple readable cues");
    const fullText = cues.map((c) => c.text).join(" ");
    assert.equal(fullText, longText, "All tokens must be preserved");
    assert.equal(validateSubtitles(cues, longText).valid, true);
  });

  // 4. CONJUNCTION
  it("Test 4: Conjunction is not an automatic splitter; if split needed, splits before conjunction", () => {
    const text = "I wanted to leave, but it started raining.";
    const clauses = splitLongSentenceIntoClauses(text, profile9_16);

    // In 9:16 (maxWidth = 26), text is 42 chars so split is required
    // Priority rule: "but" stays with following clause
    if (clauses.length > 1) {
      assert.ok(
        clauses[0].endsWith(",") || clauses[0].endsWith("leave,"),
        `Left clause should end at comma: ${clauses[0]}`
      );
      assert.ok(
        clauses[1].startsWith("but") || clauses[1].startsWith("it"),
        `Right clause should start with conjunction: ${clauses[1]}`
      );
    }
  });

  // 5. LIST (No mechanical comma split)
  it("Test 5: List with commas is NOT mechanically split when fitting within profile", () => {
    const text = "Apple, orange, mango, banana, grape.";
    // In 16:9, length is 37 chars <= maxWidth 40
    const cues = generateSubtitlesFromText(text, { aspectRatio: "16:9" });

    assert.equal(cues.length, 1, "List that fits within profile should remain a single cue");
    assert.equal(cues[0].text, text);
  });

  // 6. DECIMAL (0.05 protected)
  it("Test 6: Decimal 0.05 is protected and never split into 0. and 05", () => {
    const text = "The threshold is 0.05. Continue.";
    const spans = findProtectedSpans(text);

    assert.ok(spans.some((s) => s.raw === "0.05" && s.type === "number"));

    const cues = generateSubtitlesFromText(text, { aspectRatio: "16:9" });
    const fullText = cues.map((c) => c.text).join(" ");
    assert.equal(fullText, text);

    // Ensure "0.05" is completely intact in one of the cues
    assert.ok(cues.some((c) => c.text.includes("0.05")));
    assert.ok(!cues.some((c) => c.text.includes("0.") && !c.text.includes("0.05")));
    assert.equal(validateSubtitles(cues, text).valid, true);
  });

  // 7. THOUSANDS (15.000 protected)
  it("Test 7: Thousands separator 15.000 is protected from sentence split", () => {
    const text = "The value is 15.000. Continue.";
    const spans = findProtectedSpans(text);
    assert.ok(spans.some((s) => s.raw === "15.000"));

    const cues = generateSubtitlesFromText(text, { aspectRatio: "16:9" });
    assert.ok(cues.some((c) => c.text.includes("15.000")));
    assert.equal(validateSubtitles(cues, text).valid, true);
  });

  // 8. MIXED NUMBER ($1,299.99 protected)
  it("Test 8: Mixed currency number $1,299.99 is protected", () => {
    const text = "The price is $1,299.99. Buy it now.";
    const spans = findProtectedSpans(text);
    assert.ok(spans.some((s) => s.raw === "$1,299.99" || s.raw.includes("1,299.99")));

    const cues = generateSubtitlesFromText(text, { aspectRatio: "16:9" });
    assert.ok(cues.some((c) => c.text.includes("$1,299.99")));
    assert.equal(validateSubtitles(cues, text).valid, true);
  });

  // 9. VERSION (v2.5.1 protected)
  it("Test 9: Version numbers like Version 2.5.1 or v2.5.1 are protected", () => {
    const text = "Version 2.5.1 is available. Update now.";
    const spans = findProtectedSpans(text);
    assert.ok(spans.some((s) => s.raw === "2.5.1" && s.type === "version"));

    const cues = generateSubtitlesFromText(text, { aspectRatio: "16:9" });
    assert.ok(cues.some((c) => c.text.includes("2.5.1")));
    assert.equal(validateSubtitles(cues, text).valid, true);
  });

  // 10. IP ADDRESS (192.168.1.1 protected)
  it("Test 10: IP address 192.168.1.1 is protected from boundary splits", () => {
    const text = "The server is 192.168.1.1. Connect to it.";
    const spans = findProtectedSpans(text);
    assert.ok(spans.some((s) => s.raw === "192.168.1.1" && s.type === "ip"));

    const cues = generateSubtitlesFromText(text, { aspectRatio: "16:9" });
    assert.ok(cues.some((c) => c.text.includes("192.168.1.1")));
    assert.equal(validateSubtitles(cues, text).valid, true);
  });

  // 11. DATE (24.09.2026 protected)
  it("Test 11: Date 24.09.2026 is protected", () => {
    const text = "The release date is 24.09.2026. Development continues.";
    const spans = findProtectedSpans(text);
    assert.ok(spans.some((s) => s.raw === "24.09.2026" && s.type === "date"));

    const cues = generateSubtitlesFromText(text, { aspectRatio: "16:9" });
    assert.ok(cues.some((c) => c.text.includes("24.09.2026")));
    assert.equal(validateSubtitles(cues, text).valid, true);
  });

  // 12. TIME (15:30 protected)
  it("Test 12: Time 15:30 is protected from colon clause splits", () => {
    const text = "The meeting starts at 15:30. Be ready.";
    const spans = findProtectedSpans(text);
    assert.ok(spans.some((s) => s.raw === "15:30" && s.type === "time"));

    const cues = generateSubtitlesFromText(text, { aspectRatio: "16:9" });
    assert.ok(cues.some((c) => c.text.includes("15:30")));
    assert.equal(validateSubtitles(cues, text).valid, true);
  });

  // 13. UNIT (3.5 GHz protected)
  it("Test 13: Number with unit 3.5 GHz is protected", () => {
    const text = "The speed is 3.5 GHz. Performance is stable.";
    const spans = findProtectedSpans(text);
    assert.ok(spans.some((s) => s.raw === "3.5 GHz" || s.raw.includes("3.5")));

    const cues = generateSubtitlesFromText(text, { aspectRatio: "16:9" });
    assert.ok(cues.some((c) => c.text.includes("3.5 GHz")));
    assert.equal(validateSubtitles(cues, text).valid, true);
  });

  // 14. PARAGRAPH
  it("Test 14: Paragraph break (\\n\\n) does NOT generate empty cues or force unnatural splits", () => {
    const text = "Câu một. Câu hai.\n\nCâu ba.";
    const cues = generateSubtitlesFromText(text, { aspectRatio: "16:9" });

    // No empty cues
    assert.ok(cues.every((c) => c.text.trim().length > 0));
    const fullNormalized = cues.map((c) => c.text).join(" ");
    assert.equal(fullNormalized, "Câu một. Câu hai. Câu ba.");
    assert.equal(validateSubtitles(cues, text).valid, true);
  });

  // 15. MULTIPLE BLANK LINES
  it("Test 15: Multiple blank lines (\\n\\n\\n\\n) do NOT generate empty cues", () => {
    const text = "Câu một.\n\n\n\nCâu hai.";
    const cues = generateSubtitlesFromText(text, { aspectRatio: "16:9" });

    assert.ok(cues.every((c) => c.text.trim().length > 0));
    assert.equal(cues.map((c) => c.text).join(" "), "Câu một. Câu hai.");
    assert.equal(validateSubtitles(cues, text).valid, true);
  });

  // 16. LONG URL
  it("Test 16: Long URL exceeding normal width does NOT crash or corrupt content", () => {
    const longUrl = "https://subtitles.voxlab.ai/documentation/v2/advanced-subtitle-segmentation-guide";
    const text = `Please visit ${longUrl} for details.`;
    const cues = generateSubtitlesFromText(text, { aspectRatio: "9:16" });

    // Even in 9:16 where maxWidth = 26, graceful fallback preserves the long URL intact
    assert.ok(cues.some((c) => c.text.includes(longUrl)));
    assert.equal(cues.map((c) => c.text).join(" "), text);
    assert.equal(validateSubtitles(cues, text).valid, true);
  });

  // 17. ASPECT RATIO ADAPTATION (16:9 vs 9:16 vs 1:1)
  it("Test 17: 9:16 generates more compact cues than 16:9 for the same text", () => {
    const sampleText =
      "Trí tuệ nhân tạo đang thay đổi cách chúng ta tạo ra nội dung âm thanh và video mỗi ngày.";

    const cues16_9 = generateSubtitlesFromText(sampleText, { aspectRatio: "16:9" });
    const cues9_16 = generateSubtitlesFromText(sampleText, { aspectRatio: "9:16" });

    // 9:16 has stricter width limit (maxWidth 26 vs 40), so it produces >= number of cues
    assert.ok(
      cues9_16.length >= cues16_9.length,
      `9:16 cues (${cues9_16.length}) should be >= 16:9 cues (${cues16_9.length})`
    );

    // Both preserve 100% of tokens
    assert.equal(cues16_9.map((c) => c.text).join(" "), sampleText);
    assert.equal(cues9_16.map((c) => c.text).join(" "), sampleText);
  });

  // 18. TTS CHUNKS INTEGRATION WITH REAL TIMELINE
  it("Test 18: generateSubtitlesFromChunks merges short chunks and respects real timestamps", () => {
    const createMockChunk = (
      index: number,
      text: string,
      durationSec: number
    ): ChunkItem => ({
      id: `chunk_${index}`,
      index,
      text,
      originalText: text,
      status: "ready",
      durationSec,
      pauseAfterMs: 500,
    });

    const chunks = [
      createMockChunk(1, "Đúng.", 1.0),
      createMockChunk(2, "Đi thôi.", 1.2),
      createMockChunk(3, "Nhanh lên.", 1.0),
    ];

    const cues = generateSubtitlesFromChunks(chunks, {
      aspectRatio: "16:9",
      punctuationPauses: {
        period: 0.5,
        comma: 0.5,
        questionExclamation: 1.0,
        colonSemicolon: 0.6,
      },
    });

    // In 16:9, "Đúng. Đi thôi. Nhanh lên." = 4 words, ~25 chars -> merges into 1 cue
    assert.equal(cues.length, 1);
    assert.equal(cues[0].text, "Đúng. Đi thôi. Nhanh lên.");
    assert.equal(cues[0].startSec, 0.0);
    // End timestamp includes chunk 1 (1.0) + pause (0.5) + chunk 2 (1.2) + pause (0.5) + chunk 3 (1.0) = 4.2s
    assert.equal(cues[0].endSec, 4.2);
  });

  // 19. EXPORTER SEPARATION (Pure Serialization)
  it("Test 19: exportToSrt generates clean standard SubRip format without mutating content", () => {
    const sampleCues = [
      { index: 1, startSec: 0.0, endSec: 2.5, text: "Dòng phụ đề một." },
      { index: 2, startSec: 3.0, endSec: 5.5, text: "Dòng phụ đề hai." },
    ];
    const srt = exportToSrt(sampleCues);

    const expected =
      "1\n00:00:00,000 --> 00:00:02,500\nDòng phụ đề một.\n\n" +
      "2\n00:00:03,000 --> 00:00:05,500\nDòng phụ đề hai.\n";

    assert.equal(srt, expected);
  });

  // 20. HIGHER LEVEL SRT OUTPUT
  it("Test 20: generateSrtContent produces valid SRT output with full invariants preserved", () => {
    const text = "Chào mừng bạn đến với VoxLab. Phiên bản v2.5.1 đã sẵn sàng.";
    const srt = generateSrtContent(text, { aspectRatio: "16:9" });

    assert.match(srt, /^1\n\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}\n/);
    assert.ok(srt.includes("Chào mừng"));
    assert.ok(srt.includes("v2.5.1"));
  });

  // 21. P0 REGRESSION: COMPOUND WORD INTEGRITY & NO FRAGMENTATION
  it("Test 21: Natural Vietnamese text preserves compound words across cues", () => {
    const text =
      "Chào mừng các bạn đã quay trở lại với series sản xuất nội dung âm thanh VoxLab. Hôm nay chúng ta sẽ thử nghiệm mô hình nhận diện giọng nói faster-whisper trên hệ thống. Độ trễ xử lý rất thấp và độ chính xác tương đối cao trên nhiều loại giọng đọc khác nhau.";
    const cues = generateSubtitlesFromText(text, { aspectRatio: "16:9" });

    // Verify compound word integrity across all cues
    const forbiddenBoundaries = [
      { firstEndsWith: "sản", nextStartsWith: "xuất" },
      { firstEndsWith: "nội", nextStartsWith: "dung" },
      { firstEndsWith: "âm", nextStartsWith: "thanh" },
      { firstEndsWith: "mô", nextStartsWith: "hình" },
      { firstEndsWith: "nhận", nextStartsWith: "diện" },
      { firstEndsWith: "giọng", nextStartsWith: "nói" },
      { firstEndsWith: "thử", nextStartsWith: "nghiệm" },
      { firstEndsWith: "hệ", nextStartsWith: "thống" },
      { firstEndsWith: "chính", nextStartsWith: "xác" },
    ];

    for (let i = 0; i < cues.length - 1; i++) {
      const c1 = cues[i].text.trim();
      const c2 = cues[i + 1].text.trim();
      for (const rule of forbiddenBoundaries) {
        const c1Ends = c1.endsWith(rule.firstEndsWith);
        const c2Starts = c2.startsWith(rule.nextStartsWith);
        assert.ok(
          !(c1Ends && c2Starts),
          `Cue boundary split compound word: "${c1}" | "${c2}" at (${rule.firstEndsWith} | ${rule.nextStartsWith})`
        );
      }
    }

    // Number of cues should be natural (6-8 cues), not fragmented (12+)
    assert.ok(
      cues.length <= 8,
      `Expected natural cue count (<=8), but got fragmented count: ${cues.length}`
    );
  });
});

