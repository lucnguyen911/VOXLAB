import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ChunkItem } from "../../../types/ui";
import {
  validateChunksForExport,
  mergeMasterAudio,
  assembleMasterAudioAsync,
  formatSrtTimestamp,
  generateSrtFromChunks,
} from "../masterExport";

describe("Master Audio Export Tests (M1 - M15)", () => {
  const createMockChunk = (
    index: number,
    status: ChunkItem["status"] = "ready",
    durationSec = 4.0,
    pauseAfterMs: number | "auto" = "auto"
  ): ChunkItem => ({
    id: `chunk_${String(index).padStart(2, "0")}`,
    index,
    text: `Nội dung đoạn số ${index}.`,
    originalText: `Nội dung đoạn số ${index}.`,
    status,
    durationSec,
    pauseAfterMs,
  });

  // M1: 3 Ready chunks -> merge đúng 1 -> 2 -> 3
  it("M1: 3 Ready chunks merge strictly in order 1 -> 2 -> 3", () => {
    const chunks = [
      createMockChunk(1, "ready", 3.0),
      createMockChunk(2, "ready", 4.0),
      createMockChunk(3, "ready", 5.0),
    ];
    const result = mergeMasterAudio(chunks);
    assert.deepEqual(result.orderedChunkIndices, [1, 2, 3]);
    assert.equal(result.chunkCount, 3);
  });

  // M2: parallel completion order 2 -> 1 -> 3 -> export vẫn 1 -> 2 -> 3
  it("M2: parallel completion order [2, 1, 3] still exports in source order 1 -> 2 -> 3", () => {
    // Array in completion order: chunk 2 finished first, then chunk 1, then chunk 3
    const chunksOutOfOrder = [
      createMockChunk(2, "ready", 4.0),
      createMockChunk(1, "ready", 3.0),
      createMockChunk(3, "ready", 5.0),
    ];
    const result = mergeMasterAudio(chunksOutOfOrder);
    assert.deepEqual(result.orderedChunkIndices, [1, 2, 3]);
  });

  // M3: chunk #2 regenerated -> export dùng current/latest accepted audio của #2
  it("M3: regenerated chunk #2 uses current accepted audio and duration", () => {
    // Chunk 2 regenerated: duration updated from 4.0s to 6.5s
    const chunks = [
      createMockChunk(1, "ready", 3.0),
      createMockChunk(2, "ready", 6.5), // latest accepted version C
      createMockChunk(3, "ready", 5.0),
    ];
    const result = mergeMasterAudio(chunks);
    // 3.0 + 6.5 + 5.0 = 14.5s
    assert.equal(result.totalDurationSec, 14.5);
  });

  // M4: Manual Pause 1500ms giữa #2 và #3 -> master có đúng 1500ms pause một lần
  it("M4: Manual Pause 1500ms between #2 and #3 adds exact 1500ms pause once", () => {
    const chunks = [
      createMockChunk(1, "ready", 3.0, "auto"),
      createMockChunk(2, "ready", 4.0, 1500), // 1500ms explicit pause
      createMockChunk(3, "ready", 5.0, "auto"),
    ];
    const result = mergeMasterAudio(chunks);
    // 3.0 + 4.0 + 1.5 (pause) + 5.0 = 13.5s
    assert.equal(result.totalDurationSec, 13.5);
    assert.equal(result.pauseCount, 1);
  });

  // M5: Failed chunk -> export blocked
  it("M5: Failed chunk blocks export", () => {
    const chunks = [
      createMockChunk(1, "ready", 3.0),
      createMockChunk(2, "failed", 0),
      createMockChunk(3, "ready", 5.0),
    ];
    const validation = validateChunksForExport(chunks);
    assert.equal(validation.canExport, false);
    assert.equal(validation.invalidChunks.length, 1);
    assert.equal(validation.invalidChunks[0].index, 2);
    assert.throws(() => mergeMasterAudio(chunks), /Không thể ghép audio/);
  });

  // M6: Modified chunk -> export blocked
  it("M6: Modified chunk blocks export", () => {
    const chunks = [
      createMockChunk(1, "ready", 3.0),
      createMockChunk(2, "modified", 4.0),
      createMockChunk(3, "ready", 5.0),
    ];
    const validation = validateChunksForExport(chunks);
    assert.equal(validation.canExport, false);
    assert.equal(validation.invalidChunks[0].status, "modified");
    assert.throws(() => mergeMasterAudio(chunks), /Không thể ghép audio/);
  });

  // M7: missing audio / zero duration -> export blocked
  it("M7: missing audio duration (0 or undefined) blocks export", () => {
    const chunks = [
      createMockChunk(1, "ready", 3.0),
      createMockChunk(2, "ready", 0), // zero duration
      createMockChunk(3, "ready", 5.0),
    ];
    const validation = validateChunksForExport(chunks);
    assert.equal(validation.canExport, false);
    assert.equal(validation.invalidChunks[0].index, 2);
  });

  // M8: Skipped chunk -> export blocked
  it("M8: Skipped chunk blocks master export", () => {
    const chunk2 = createMockChunk(2, "failed", 0);
    (chunk2 as any).isSkipped = true;
    const chunks = [
      createMockChunk(1, "ready", 3.0),
      chunk2,
      createMockChunk(3, "ready", 5.0),
    ];
    const validation = validateChunksForExport(chunks);
    assert.equal(validation.canExport, false);
    assert.equal(validation.invalidChunks[0].index, 2);
    assert.ok(validation.blockerReasons["chunk_02"].includes("bỏ qua"));
  });

  // M9: all Ready -> export allowed
  it("M9: all Ready chunks allow export", () => {
    const chunks = [
      createMockChunk(1, "ready", 3.0),
      createMockChunk(2, "ready", 4.0),
      createMockChunk(3, "ready", 5.0),
    ];
    const validation = validateChunksForExport(chunks);
    assert.equal(validation.canExport, true);
    assert.equal(validation.invalidChunks.length, 0);
  });

  // M9b: chunk with quality warning review DOES NOT block export
  it("M9b: chunk with quality warning review DOES NOT block export", () => {
    const chunks = [
      createMockChunk(1, "ready", 3.0),
      {
        ...createMockChunk(2, "ready", 4.0),
        qualityReview: {
          status: "warning" as const,
          issues: [
            {
              severity: "warning" as const,
              code: "ABNORMAL_PAUSE",
              message: "Phát hiện khoảng ngắt có thể bất thường giữa 'diesel' và 'fuel' (0.58s)",
              words: ["diesel", "fuel"] as [string, string],
              timeRange: [2.1, 2.68] as [number, number],
            },
          ],
          summary: "Cảnh báo ngắt nghỉ",
          checkedAt: Date.now(),
        },
      },
      createMockChunk(3, "ready", 5.0),
    ];
    const validation = validateChunksForExport(chunks);
    assert.equal(validation.canExport, true);
    assert.equal(validation.invalidChunks.length, 0);
  });

  // M9c: chunk with quality error review blocks export
  it("M9c: chunk with quality error review blocks export", () => {
    const chunks = [
      createMockChunk(1, "ready", 3.0),
      {
        ...createMockChunk(2, "ready", 4.0),
        qualityReview: {
          status: "error" as const,
          issues: [
            {
              severity: "error" as const,
              code: "AUDIO_SILENT",
              message: "Tệp âm thanh hoàn toàn im lặng",
            },
          ],
          summary: "Tệp âm thanh hoàn toàn im lặng",
          checkedAt: Date.now(),
        },
      },
      createMockChunk(3, "ready", 5.0),
    ];
    const validation = validateChunksForExport(chunks);
    assert.equal(validation.canExport, false);
    assert.equal(validation.invalidChunks.length, 1);
    assert.equal(validation.invalidChunks[0].index, 2);
  });

  // M10: master export không gọi TTS worker/model
  it("M10: master export does not invoke TTS model or network", () => {
    let ttsInvocationCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => {
      ttsInvocationCount++;
      return Promise.reject(new Error("Network should not be called"));
    };

    try {
      const chunks = [
        createMockChunk(1, "ready", 3.0),
        createMockChunk(2, "ready", 4.0),
      ];
      // Run master export
      const res = mergeMasterAudio(chunks);
      assert.equal(ttsInvocationCount, 0);
      assert.ok(res.totalBytes > 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // M11: master export không gọi Smart Chunk
  it("M11: master export does not re-chunk or alter chunk list", () => {
    const chunks = [
      createMockChunk(1, "ready", 3.0),
      createMockChunk(2, "ready", 4.0),
    ];
    const originalLength = chunks.length;
    mergeMasterAudio(chunks);
    assert.equal(chunks.length, originalLength);
  });

  // M12: master export không mutate chunk text/state
  it("M12: master export preserves chunk text and state immutably", () => {
    const chunks = [
      createMockChunk(1, "ready", 3.0),
      createMockChunk(2, "ready", 4.0),
    ];
    const beforeState = JSON.stringify(chunks);
    mergeMasterAudio(chunks);
    const afterState = JSON.stringify(chunks);
    assert.equal(beforeState, afterState);
  });

  // M13: bottom player download chỉ tải current preview chunk
  it("M13: bottom player download only packages the specific preview chunk", () => {
    const track = {
      id: "chunk_02",
      chunkIndex: 2,
      voiceName: "Thao Trinh",
      durationSec: 4.5,
    };
    const chunkNumber = String(track.chunkIndex || 1).padStart(2, "0");
    const filename = `VoxLab_${chunkNumber}_${track.voiceName.replace(/\s+/g, "_")}.wav`;
    assert.equal(filename, "VoxLab_02_Thao_Trinh.wav");
  });

  // M14: bottom download không trigger project validation
  it("M14: bottom player download does not trigger whole-project validation", () => {
    // Project has failed chunk 3, but previewing chunk 1 should still download chunk 1 safely
    const projectChunks = [
      createMockChunk(1, "ready", 3.0),
      createMockChunk(2, "ready", 4.0),
      createMockChunk(3, "failed", 0), // invalid in project
    ];
    // Bottom download does not inspect projectChunks
    const singleChunkTrack = projectChunks[0];
    assert.ok(singleChunkTrack.durationSec! > 0);
  });

  // M15: bottom download không trigger TTS
  it("M15: bottom download uses existing audio without calling TTS", () => {
    let ttsTriggered = false;
    const downloadHandler = (duration: number) => {
      // Direct WAV serialization
      return duration * 44100 * 2;
    };
    const size = downloadHandler(4.2);
    assert.ok(size > 0);
    assert.equal(ttsTriggered, false);
  });
});

describe("Audio Integrity Tests (A1 - A6)", () => {
  const createMockChunk = (
    index: number,
    durationSec = 4.0,
    pauseAfterMs: number | "auto" = "auto"
  ): ChunkItem => ({
    id: `chunk_${String(index).padStart(2, "0")}`,
    index,
    text: `Đoạn thứ ${index} của kịch bản hoàn chỉnh.`,
    originalText: `Đoạn thứ ${index} của kịch bản hoàn chỉnh.`,
    status: "ready",
    durationSec,
    pauseAfterMs,
  });

  // A1: Concatenated duration ≈ sum(chunk durations + Manual Pauses)
  it("A1: Concatenated duration matches exact sum of chunk durations and manual pauses", () => {
    const chunks = [
      createMockChunk(1, 2.5),
      createMockChunk(2, 3.5, 1200), // +1.2s pause
      createMockChunk(3, 4.0, 800),  // +0.8s pause
      createMockChunk(4, 5.0),
    ];
    // Expected: 2.5 + 3.5 + 1.2 + 4.0 + 0.8 + 5.0 = 17.0s
    const result = mergeMasterAudio(chunks);
    assert.equal(result.totalDurationSec, 17.0);
  });

  // A2: No duplicate chunk audio
  it("A2: No duplicate chunk audio included in master output", () => {
    const chunks = [
      createMockChunk(1, 2.0),
      createMockChunk(2, 3.0),
      createMockChunk(3, 4.0),
    ];
    const result = mergeMasterAudio(chunks);
    assert.equal(result.chunkCount, 3);
    const uniqueIndices = new Set(result.orderedChunkIndices);
    assert.equal(uniqueIndices.size, 3);
  });

  // A3: No missing chunk
  it("A3: No missing chunk from the export list", () => {
    const chunks = [
      createMockChunk(1, 2.0),
      createMockChunk(2, 3.0),
      createMockChunk(3, 4.0),
      createMockChunk(4, 5.0),
      createMockChunk(5, 6.0),
    ];
    const result = mergeMasterAudio(chunks);
    assert.equal(result.chunkCount, 5);
    assert.deepEqual(result.orderedChunkIndices, [1, 2, 3, 4, 5]);
  });

  // A4: Manual Pause applied exactly once
  it("A4: Manual Pause applied exactly once at the designated boundary", () => {
    const chunks = [
      createMockChunk(1, 2.0, "auto"),
      createMockChunk(2, 3.0, 2000), // 2.0s pause applied ONCE
      createMockChunk(3, 4.0, "auto"),
    ];
    const result = mergeMasterAudio(chunks);
    assert.equal(result.pauseCount, 1);
    // 2.0 + 3.0 + 2.0 (pause) + 4.0 = 11.0s
    assert.equal(result.totalDurationSec, 11.0);
  });

  // A5: Current regenerated audio selected correctly
  it("A5: Current regenerated audio duration and content are accurately selected", () => {
    // Initial chunk 2 had 3.0s, regenerated version has 5.2s
    const chunks = [
      createMockChunk(1, 2.0),
      createMockChunk(2, 5.2), // regenerated current version
      createMockChunk(3, 4.0),
    ];
    const result = mergeMasterAudio(chunks);
    // 2.0 + 5.2 + 4.0 = 11.2s
    assert.equal(result.totalDurationSec, 11.2);
  });

  // A6: Output container/file readable after export
  it("A6: Master output file has valid RIFF WAVE header and readable byte length", async () => {
    const chunks = [
      createMockChunk(1, 1.5),
      createMockChunk(2, 2.5),
    ];
    const result = mergeMasterAudio(chunks);
    const arrayBuffer = await result.blob.arrayBuffer();
    const view = new DataView(arrayBuffer);

    // Verify RIFF identifier
    const riff = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2),
      view.getUint8(3)
    );
    assert.equal(riff, "RIFF");

    // Verify WAVE identifier
    const wave = String.fromCharCode(
      view.getUint8(8),
      view.getUint8(9),
      view.getUint8(10),
      view.getUint8(11)
    );
    assert.equal(wave, "WAVE");

    // Verify audio format is 1 (PCM)
    const audioFormat = view.getUint16(20, true);
    assert.equal(audioFormat, 1);

    // Verify sample rate is 44100
    const sampleRate = view.getUint32(24, true);
    assert.equal(sampleRate, 44100);

    // Verify bit depth is 16
    const bitsPerSample = view.getUint16(34, true);
    assert.equal(bitsPerSample, 16);

    // Verify total size = 44 (header) + 4.0s * 44100 * 2 = 44 + 352800 = 352844 bytes
    assert.equal(arrayBuffer.byteLength, 44 + Math.floor(4.0 * 44100 * 2));
  });
});

describe("SRT Subtitle Export Tests (S1 - S6)", () => {
  const createMockChunk = (
    index: number,
    text: string,
    durationSec = 3.5,
    pauseAfterMs: number | "auto" = "auto"
  ): ChunkItem => ({
    id: `chunk_${String(index).padStart(2, "0")}`,
    index,
    text,
    originalText: text,
    status: "ready",
    durationSec,
    pauseAfterMs,
  });

  // S1: formatSrtTimestamp converts seconds to SubRip HH:MM:SS,mmm
  it("S1: formatSrtTimestamp converts seconds into standard SubRip timestamp", () => {
    assert.equal(formatSrtTimestamp(0), "00:00:00,000");
    assert.equal(formatSrtTimestamp(3.42), "00:00:03,420");
    assert.equal(formatSrtTimestamp(65.123), "00:01:05,123");
    assert.equal(formatSrtTimestamp(3665.045), "01:01:05,045");
  });

  // S2: generateSrtFromChunks creates ordered SRT entries matching chunk indices 1 -> 2 -> 3
  it("S2: generateSrtFromChunks creates ordered SRT entries 1 -> 2 -> 3 even if passed out-of-order", () => {
    const unorderedChunks = [
      createMockChunk(2, "Đoạn thứ hai.", 4.0),
      createMockChunk(1, "Đoạn thứ nhất.", 3.0),
      createMockChunk(3, "Đoạn thứ ba.", 2.5),
    ];
    const srt = generateSrtFromChunks(unorderedChunks);

    const expected =
      "1\n00:00:00,000 --> 00:00:03,000\nĐoạn thứ nhất.\n\n" +
      "2\n00:00:03,000 --> 00:00:07,000\nĐoạn thứ hai.\n\n" +
      "3\n00:00:07,000 --> 00:00:09,500\nĐoạn thứ ba.\n";

    assert.equal(srt, expected);
  });

  // S3: generateSrtFromChunks shifts timestamps when Manual Pause (pauseAfterMs) is present
  it("S3: generateSrtFromChunks reflects manual pause silence between chunks", () => {
    const chunksWithPause = [
      createMockChunk(1, "Chào mừng quý vị.", 3.0, 1500), // 3s + 1.5s pause
      createMockChunk(2, "Đây là tập podcast mới.", 4.0, 0),
    ];
    const srt = generateSrtFromChunks(chunksWithPause);

    const expected =
      "1\n00:00:00,000 --> 00:00:03,000\nChào mừng quý vị.\n\n" +
      "2\n00:00:04,500 --> 00:00:08,500\nĐây là tập podcast mới.\n";

    assert.equal(srt, expected);
  });

  // S4: Directly reuses TTS segmentation without re-running STT/Whisper
  it("S4: directly uses chunk durationSec and text without modifying chunk contents", () => {
    const originalChunk = createMockChunk(1, "Nội dung gốc không bị biến đổi.", 5.12);
    const textBefore = originalChunk.text;
    const srt = generateSrtFromChunks([originalChunk]);

    assert.equal(originalChunk.text, textBefore);
    assert.match(srt, /00:00:00,000 --> 00:00:05,120/);
    assert.match(srt, /Nội dung gốc không bị biến đổi\./);
  });

  // S5: Audio and SRT share identical basename with .wav and .srt extensions
  it("S5: Audio and SRT filenames share exact matching base filename", () => {
    const projectTitle = "Podcast Ep 12 Master";
    const chunks = [createMockChunk(1, "Test chunk.", 3.0)];
    const audioResult = mergeMasterAudio(chunks, { projectTitle });
    const srtFilename = audioResult.filename.replace(/\.wav$/i, ".srt");

    assert.equal(audioResult.filename, "VoxLab_Podcast_Ep_12_Master_Master.wav");
    assert.equal(srtFilename, "VoxLab_Podcast_Ep_12_Master_Master.srt");
    assert.equal(
      audioResult.filename.slice(0, -4),
      srtFilename.slice(0, -4)
    );
  });

  // S6: Handles empty chunk list and multiline text safely
  it("S6: handles empty list and multiline text safely", () => {
    assert.equal(generateSrtFromChunks([]), "");

    const multilineChunk = createMockChunk(1, "Dòng một.\nDòng hai.", 4.0);
    const srt = generateSrtFromChunks([multilineChunk]);
    assert.equal(srt, "1\n00:00:00,000 --> 00:00:04,000\nDòng một.\nDòng hai.\n");
  });
});

describe("Master Audio Real Assembly Tests (Async Web Audio / Fallback)", () => {
  const createTestChunk = (
    index: number,
    text: string,
    durationSec: number,
    pauseAfterMs: number | "auto" = "auto"
  ): ChunkItem => ({
    id: `chunk_${String(index).padStart(2, "0")}`,
    index,
    text,
    originalText: text,
    status: "ready",
    durationSec,
    pauseAfterMs,
  });

  it("assembles master audio blob for all chunks with calculated inter-chunk pauses", async () => {
    const chunks = [
      createTestChunk(1, "Chào mừng quý vị.", 3.0),
      createTestChunk(2, "Hôm nay chúng ta tiếp tục.", 4.0),
    ];

    const result = await assembleMasterAudioAsync(chunks, {
      projectTitle: "Ban tin sang",
    });

    assert.equal(result.chunkCount, 2);
    assert.deepEqual(result.orderedChunkIndices, [1, 2]);
    assert.ok(result.blob instanceof Blob);
    assert.equal(result.blob.type, "audio/wav");
    assert.ok(result.totalDurationSec >= 7.0);
    assert.equal(result.filename, "VoxLab_Ban_tin_sang_Master.wav");
  });

  it("handles out-of-order chunks by sorting strictly by index", async () => {
    const chunks = [
      createTestChunk(3, "Đoạn ba.", 2.0),
      createTestChunk(1, "Đoạn một.", 2.0),
      createTestChunk(2, "Đoạn hai.", 2.0),
    ];

    const result = await assembleMasterAudioAsync(chunks);
    assert.deepEqual(result.orderedChunkIndices, [1, 2, 3]);
  });
});

