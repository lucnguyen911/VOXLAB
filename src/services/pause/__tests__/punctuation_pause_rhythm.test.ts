import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectTrailingPunctuation,
  getTargetPauseMs,
  calculateEffectiveSilenceGapMs,
  detectTrailingSilenceMs,
  DEFAULT_PUNCTUATION_PAUSES,
} from "../punctuationPause";
import {
  mergeMasterAudio,
  generateSrtFromChunks,
} from "../../audio/masterExport";
import { smartChunkScript } from "../chunker";
import { ChunkItem, PunctuationPauses } from "../../../types/ui";

describe("Punctuation-Driven Pause Rhythm & Simplification (Cases 1 - 8)", () => {
  const config: PunctuationPauses = {
    period: 0.5, // 500ms
    comma: 0.5, // 500ms
    questionExclamation: 1.0, // 1000ms
    colonSemicolon: 0.6, // 600ms
  };

  const createMockChunk = (
    index: number,
    text: string,
    durationSec = 3.0,
    trailingSilenceMs = 0,
    pauseAfterMs: number | "auto" = "auto"
  ): ChunkItem => ({
    id: `chunk_${String(index).padStart(2, "0")}`,
    index,
    text,
    originalText: text,
    status: "ready",
    durationSec,
    trailingSilenceMs,
    pauseAfterMs,
  });

  // Case 1: Single paragraph ("Câu một. Câu hai.") -> exact 500ms pause after period
  it("Case 1: Single paragraph has exact period pause (500ms) after '.'", () => {
    const text1 = "Câu một.";
    const text2 = "Câu hai.";

    const pauseMs = getTargetPauseMs(text1, config);
    assert.equal(pauseMs, 500, "Target pause for '.' must be exactly 500ms");

    const chunks = [
      createMockChunk(1, text1, 3.0),
      createMockChunk(2, text2, 4.0),
    ];

    const result = mergeMasterAudio(chunks, { punctuationPauses: config });
    // Total duration: 3.0s + 0.5s pause + 4.0s = 7.5s
    assert.equal(result.totalDurationSec, 7.5);
    assert.equal(result.pauseCount, 1);
  });

  // Case 2: Multi-paragraph ("Câu một.\n\nCâu hai.") -> pause remains 500ms, NO paragraph pause accumulated
  it("Case 2: Multi-paragraph (\\n\\n) does NOT accumulate paragraph pause, pause remains 500ms", () => {
    const rawScript = "Câu một.\n\nCâu hai.";
    const chunksFromScript = smartChunkScript(rawScript);

    // Chunks should split by paragraph
    assert.equal(chunksFromScript.length, 2);
    assert.equal(chunksFromScript[0].text, "Câu một.");
    assert.equal(chunksFromScript[1].text, "Câu hai.");

    const chunks = [
      createMockChunk(1, chunksFromScript[0].text, 3.0),
      createMockChunk(2, chunksFromScript[1].text, 4.0),
    ];

    const result = mergeMasterAudio(chunks, { punctuationPauses: config });
    // Total duration must be 3.0s + 0.5s + 4.0s = 7.5s (strictly identical to Case 1)
    assert.equal(result.totalDurationSec, 7.5);
    assert.equal(result.pauseCount, 1);
  });

  // Case 3: Multiple blank lines ("Câu một.\n\n\n\nCâu hai.") -> pause remains exactly 500ms
  it("Case 3: Multiple empty lines (\\n\\n\\n\\n) do NOT accumulate pause, pause remains 500ms", () => {
    const rawScript = "Câu một.\n\n\n\nCâu hai.";
    const chunksFromScript = smartChunkScript(rawScript);

    assert.equal(chunksFromScript.length, 2);
    assert.equal(chunksFromScript[0].text, "Câu một.");
    assert.equal(chunksFromScript[1].text, "Câu hai.");

    const chunks = [
      createMockChunk(1, chunksFromScript[0].text, 3.0),
      createMockChunk(2, chunksFromScript[1].text, 4.0),
    ];

    const result = mergeMasterAudio(chunks, { punctuationPauses: config });
    assert.equal(result.totalDurationSec, 7.5);
    assert.equal(result.pauseCount, 1);
  });

  // Case 4: Single newline ("Câu một.\nCâu hai.") -> pause remains exactly 500ms
  it("Case 4: Single newline (\\n) does NOT add silence, pause remains exactly 500ms", () => {
    const rawScript = "Câu một.\nCâu hai.";
    const chunksFromScript = smartChunkScript(rawScript);

    const chunks = [
      createMockChunk(1, chunksFromScript[0]?.text || "Câu một.", 3.0),
      createMockChunk(2, chunksFromScript[1]?.text || "Câu hai.", 4.0),
    ];

    const result = mergeMasterAudio(chunks, { punctuationPauses: config });
    assert.equal(result.totalDurationSec, 7.5);
    assert.equal(result.pauseCount, 1);
  });

  // Case 5: Differing punctuation ("Câu một. Câu hai? Câu ba!")
  // -> 500ms after #1 (.), 1000ms after #2 (?), 0ms after #3 (! is last chunk)
  it("Case 5: Differing punctuation applies specific pauses: 500ms (.), 1000ms (?), 0ms at end", () => {
    const p1 = getTargetPauseMs("Câu một.", config);
    const p2 = getTargetPauseMs("Câu hai?", config);
    const p3 = getTargetPauseMs("Câu ba!", config);

    assert.equal(p1, 500, "Period pause must be 500ms");
    assert.equal(p2, 1000, "Question pause must be 1000ms");
    assert.equal(p3, 1000, "Exclamation pause must be 1000ms");

    const chunks = [
      createMockChunk(1, "Câu một.", 2.0),
      createMockChunk(2, "Câu hai?", 3.0),
      createMockChunk(3, "Câu ba!", 4.0),
    ];

    const result = mergeMasterAudio(chunks, { punctuationPauses: config });
    // Duration: 2.0 + 0.5 (.) + 3.0 + 1.0 (?) + 4.0 + 0 (end) = 10.5s
    assert.equal(result.totalDurationSec, 10.5);
    assert.equal(result.pauseCount, 2);
  });

  // Case 6: Technical chunk boundary without punctuation -> pause = 0ms
  it("Case 6: Technical boundary without ending punctuation produces 0ms pause", () => {
    const rawNoPunct = "đoạn bị cắt ngang giữa chừng mà không có dấu";
    const punctType = detectTrailingPunctuation(rawNoPunct);
    assert.equal(punctType, "none");

    const pauseMs = getTargetPauseMs(rawNoPunct, config);
    assert.equal(pauseMs, 0, "No punctuation must produce 0ms pause");

    const chunks = [
      createMockChunk(1, rawNoPunct, 3.0),
      createMockChunk(2, "tiếp tục phần còn lại của câu.", 2.0),
    ];

    const result = mergeMasterAudio(chunks, { punctuationPauses: config });
    // Duration: 3.0s + 0s pause + 2.0s = 5.0s
    assert.equal(result.totalDurationSec, 5.0);
    assert.equal(result.pauseCount, 0);
  });

  // Case 7: Trailing silence of model audio deduction
  // Target 500ms:
  // - with 200ms existing silence -> adds 300ms (total = 500ms)
  // - with >= 500ms existing silence -> adds 0ms
  it("Case 7: Trailing silence is subtracted from target pause to prevent silence stacking", () => {
    // 200ms existing silence
    const gap1 = calculateEffectiveSilenceGapMs(500, 200);
    assert.equal(gap1, 300, "500ms target - 200ms model silence = 300ms inserted silence");

    // 500ms existing silence
    const gap2 = calculateEffectiveSilenceGapMs(500, 500);
    assert.equal(gap2, 0, "500ms target - 500ms model silence = 0ms inserted silence");

    // Verify DEFAULT_PUNCTUATION_PAUSES defaults
    assert.equal(DEFAULT_PUNCTUATION_PAUSES.comma, 0.3);
    assert.equal(DEFAULT_PUNCTUATION_PAUSES.period, 0.6);
    assert.equal(DEFAULT_PUNCTUATION_PAUSES.questionExclamation, 0.7);
    assert.equal(DEFAULT_PUNCTUATION_PAUSES.colonSemicolon, 0.4);

    // Verify detectTrailingSilenceMs on synthetic waveform with trailing zeros
    const sampleRate = 44100;
    const testSamples = new Int16Array(sampleRate); // 1.0s total
    // Fill first 0.8s with tone, last 0.2s (200ms) with 0
    for (let i = 0; i < Math.floor(sampleRate * 0.8); i++) {
      testSamples[i] = 16000;
    }
    const detectedSilence = detectTrailingSilenceMs(testSamples, sampleRate);
    assert.equal(detectedSilence, 200, "Should detect approx 200ms of trailing silence");
    const chunksWithModelSilence = [
      createMockChunk(1, "Câu một.", 3.0, 200), // 3.0s audio including 200ms trailing silence
      createMockChunk(2, "Câu hai.", 4.0, 0),
    ];

    const result = mergeMasterAudio(chunksWithModelSilence, { punctuationPauses: config });
    // 3.0s + 0.3s (effective gap) + 4.0s = 7.3s
    assert.equal(result.totalDurationSec, 7.3);
  });

  // Case 8: SRT synchronization with audio timeline
  it("Case 8: SRT subtitle timeline strictly matches audio timeline with punctuation pause", () => {
    const chunks = [
      createMockChunk(1, "Câu thứ nhất.", 3.0, 0),
      createMockChunk(2, "Câu thứ hai.", 4.0, 0),
    ];

    const srt = generateSrtFromChunks(chunks, { punctuationPauses: config });
    const master = mergeMasterAudio(chunks, { punctuationPauses: config });

    // Audio: 3.0s + 0.5s pause + 4.0s = 7.5s
    assert.equal(master.totalDurationSec, 7.5);

    // SRT expectations:
    // Subtitle 1: 00:00:00,000 --> 00:00:03,000
    // 500ms pause in audio -> Subtitle 2 must start at 00:00:03,500
    // Subtitle 2: 00:00:03,500 --> 00:00:07,500
    const expectedSrt =
      "1\n00:00:00,000 --> 00:00:03,000\nCâu thứ nhất.\n\n" +
      "2\n00:00:03,500 --> 00:00:07,500\nCâu thứ hai.\n";

    assert.equal(srt, expectedSrt);
  });
});
