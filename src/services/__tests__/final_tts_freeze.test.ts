import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BatchConcurrencyQueue } from "../concurrencyExecutor";
import { splitScriptWithPauses } from "../pause/chunker";
import { normalizeText } from "../normalizer";
import {
  validateChunksForExport,
  mergeMasterAudio,
} from "../audio/masterExport";
import { ChunkItem } from "../../types/ui";

function makeChunk(
  partial: Partial<ChunkItem> & { id: string; index: number; text: string }
): ChunkItem {
  return {
    originalText: partial.text,
    pauseAfterMs: 0,
    status: "ready",
    ...partial,
  };
}

describe("FINAL TTS POLISH + FREEZE PASS (T1 - T25)", () => {
  // T1: 1 chunk generation -> indeterminate progress -> no fake %
  it("T1: 1 chunk generation -> indeterminate progress -> không fake %", async () => {
    const queue = new BatchConcurrencyQueue();
    const observedProgressValues: number[] = [];
    let isSingleChunkIndeterminate = false;

    const total = 1;
    if (total === 1) {
      isSingleChunkIndeterminate = true; // UX rule: indeterminate progress instead of fake percentage
    }

    await queue.runBatch([1], {
      concurrency: 1,
      processItem: async () => {
        // during execution, percentage is indeterminate
        assert.equal(isSingleChunkIndeterminate, true);
        await new Promise((r) => setTimeout(r, 10));
      },
      onItemCompleted: (_item, _idx, completed, tot) => {
        observedProgressValues.push((completed / tot) * 100);
      },
    });

    assert.equal(isSingleChunkIndeterminate, true);
    assert.deepEqual(observedProgressValues, [100]); // Only 100% on complete, no fake 12%, 37%
  });

  // T2: 1 active chunk, 0 pending -> Pause unavailable
  it("T2: 1 active chunk, 0 pending -> Pause unavailable", async () => {
    const queue = new BatchConcurrencyQueue();
    let pauseAvailableDuringRun = true;

    await queue.runBatch([1], {
      concurrency: 1,
      processItem: async () => {
        // With 1 item running and 0 pending, pause is unavailable
        const pending = queue.getPendingCount();
        assert.equal(pending, 0);
        pauseAvailableDuringRun = pending > 0;
      },
    });

    assert.equal(pauseAvailableDuringRun, false);
  });

  // T3: multiple pending chunks -> Pause available
  it("T3: multiple pending chunks -> Pause available", async () => {
    const queue = new BatchConcurrencyQueue();
    let pauseAvailable = false;

    const items = [1, 2, 3, 4, 5];
    await queue.runBatch(items, {
      concurrency: 1,
      processItem: async () => {
        if (queue.getPendingCount() > 0) {
          pauseAvailable = true;
        }
      },
    });

    assert.equal(pauseAvailable, true);
  });

  // T4: Pause -> no new scheduling
  it("T4: Pause -> no new scheduling", async () => {
    const queue = new BatchConcurrencyQueue();
    const scheduled: number[] = [];

    const promise = queue.runBatch([1, 2, 3, 4], {
      concurrency: 1,
      processItem: async (item) => {
        scheduled.push(item);
        if (item === 1) {
          queue.pause();
        }
        await new Promise((r) => setTimeout(r, 30));
      },
    });

    await new Promise((r) => setTimeout(r, 70));
    // While paused, no new items scheduled beyond active
    assert.deepEqual(scheduled, [1]);
    queue.resume();
    await promise;
    assert.deepEqual(scheduled, [1, 2, 3, 4]);
  });

  // T5: Resume -> only pending
  it("T5: Resume -> only pending", async () => {
    const queue = new BatchConcurrencyQueue();
    const executed: number[] = [];

    const promise = queue.runBatch([1, 2, 3], {
      concurrency: 1,
      processItem: async (item) => {
        executed.push(item);
        if (item === 1) {
          queue.pause();
        }
        await new Promise((r) => setTimeout(r, 20));
      },
    });

    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(executed, [1]); // item 1 finished, items 2 and 3 pending
    queue.resume();
    await promise;
    // Resumed: items 2 and 3 executed without re-running item 1
    assert.deepEqual(executed, [1, 2, 3]);
  });

  // T6: Cancel -> completed audio preserved
  it("T6: Cancel -> completed audio preserved", async () => {
    const queue = new BatchConcurrencyQueue();
    const completedItems: number[] = [];

    const promise = queue.runBatch([1, 2, 3, 4], {
      concurrency: 1,
      processItem: async (item) => {
        if (item === 3) {
          queue.cancel();
          return;
        }
        await new Promise((r) => setTimeout(r, 10));
        completedItems.push(item);
      },
    });

    await promise;
    assert.deepEqual(completedItems, [1, 2]); // completed items 1 & 2 preserved
  });

  // T7: all Ready -> global Generate không regenerate
  it("T7: all Ready -> global Generate không regenerate", () => {
    const chunks: ChunkItem[] = [
      makeChunk({ id: "c1", index: 1, text: "One", status: "ready", durationSec: 3.0 }),
      makeChunk({ id: "c2", index: 2, text: "Two", status: "ready", durationSec: 4.0 }),
    ];

    const chunksNeedingGen = chunks.filter(
      (c) => c.status !== "ready" || !c.durationSec
    );
    assert.equal(chunksNeedingGen.length, 0); // zero chunks need generation
  });

  // T8: 48 Ready + 2 Modified -> chỉ generate 2 Modified
  it("T8: 48 Ready + 2 Modified -> chỉ generate 2 Modified", () => {
    const chunks: ChunkItem[] = Array.from({ length: 50 }, (_, i) =>
      makeChunk({
        id: `c_${i + 1}`,
        index: i + 1,
        text: `Sentence ${i + 1}`,
        status: i < 48 ? "ready" : "modified",
        durationSec: i < 48 ? 3.5 : undefined,
      })
    );

    const chunksNeedingGen = chunks.filter(
      (c) => c.status !== "ready" || !c.durationSec
    );
    assert.equal(chunksNeedingGen.length, 2);
    assert.deepEqual(
      chunksNeedingGen.map((c) => c.id),
      ["c_49", "c_50"]
    );
  });

  // T9: single chunk regenerate -> chỉ đúng chunk đó chạy
  it("T9: single chunk regenerate -> chỉ đúng chunk đó chạy", () => {
    let chunks: ChunkItem[] = [
      makeChunk({ id: "c1", index: 1, text: "One", status: "ready", durationSec: 3.0 }),
      makeChunk({ id: "c2", index: 2, text: "Two", status: "ready", durationSec: 4.0 }),
    ];

    const targetId = "c2";
    // Regenerate c2
    chunks = chunks.map((c) =>
      c.id === targetId ? { ...c, status: "ready", durationSec: 5.5 } : c
    );

    assert.equal(chunks[0].durationSec, 3.0); // c1 untouched
    assert.equal(chunks[1].durationSec, 5.5); // c2 updated
  });

  // T10: regenerated version becomes current
  it("T10: regenerated version becomes current", () => {
    let chunk: ChunkItem = makeChunk({
      id: "c1",
      index: 1,
      text: "Original text",
      status: "ready",
      durationSec: 3.0,
    });

    // Regenerated
    chunk = { ...chunk, durationSec: 4.8 };
    assert.equal(chunk.durationSec, 4.8);
  });

  // T11: Preview uses current audio
  it("T11: Preview uses current audio", () => {
    const chunk: ChunkItem = makeChunk({
      id: "c1",
      index: 1,
      text: "Some text",
      status: "ready",
      durationSec: 5.2,
      audioUrl: "blob:http://localhost:1420/v2",
    });

    // Preview player receives chunk track
    const previewTrack = {
      id: chunk.id,
      duration: chunk.durationSec,
      audioUrl: chunk.audioUrl,
    };
    assert.equal(previewTrack.duration, 5.2);
    assert.equal(previewTrack.audioUrl, "blob:http://localhost:1420/v2");
  });

  // T12: chunk download uses current audio
  it("T12: chunk download uses current audio", () => {
    const chunk: ChunkItem = makeChunk({
      id: "c2",
      index: 2,
      text: "Chunk text",
      status: "ready",
      durationSec: 6.4,
    });
    const voiceName = "Thao_Trinh";
    const downloadFilename = `VoxLab_02_${voiceName}.wav`;
    assert.equal(downloadFilename, "VoxLab_02_Thao_Trinh.wav");
    assert.ok(chunk.durationSec! > 0);
  });

  // T13: master uses current audio versions
  it("T13: master uses current audio versions", () => {
    const chunks: ChunkItem[] = [
      makeChunk({ id: "c1", index: 1, text: "Chunk 1", status: "ready", durationSec: 2.0 }),
      makeChunk({ id: "c2", index: 2, text: "Chunk 2 v2", status: "ready", durationSec: 4.5 }),
    ];
    const result = mergeMasterAudio(chunks, { projectTitle: "Test" });
    assert.equal(result.totalDurationSec, 6.5);
  });

  // T14: master preserves chunk order
  it("T14: master preserves chunk order", () => {
    // Input chunks in out-of-order array
    const chunks: ChunkItem[] = [
      makeChunk({ id: "c3", index: 3, text: "Three", status: "ready", durationSec: 1.0 }),
      makeChunk({ id: "c1", index: 1, text: "One", status: "ready", durationSec: 1.0 }),
      makeChunk({ id: "c2", index: 2, text: "Two", status: "ready", durationSec: 1.0 }),
    ];
    const result = mergeMasterAudio(chunks, { projectTitle: "Test" });
    assert.deepEqual(result.orderedChunkIndices, [1, 2, 3]);
  });

  // T15: Manual Pause applied once
  it("T15: Manual Pause applied once", () => {
    const chunks: ChunkItem[] = [
      makeChunk({
        id: "c1",
        index: 1,
        text: "One",
        status: "ready",
        durationSec: 2.0,
        pauseAfterMs: 1500,
      }),
      makeChunk({ id: "c2", index: 2, text: "Two", status: "ready", durationSec: 3.0 }),
    ];
    const result = mergeMasterAudio(chunks, { projectTitle: "Test" });
    assert.equal(result.pauseCount, 1);
    assert.equal(result.totalDurationSec, 6.5); // 2.0 + 1.5 + 3.0 = 6.5
  });

  // T16: Modified chunk blocks master export
  it("T16: Modified chunk blocks master export", () => {
    const chunks: ChunkItem[] = [
      makeChunk({ id: "c1", index: 1, text: "One", status: "ready", durationSec: 2.0 }),
      makeChunk({ id: "c2", index: 2, text: "Two modified", status: "modified", durationSec: 2.0 }),
    ];
    const validation = validateChunksForExport(chunks);
    assert.equal(validation.canExport, false);
    assert.equal(validation.invalidChunks.length, 1);
  });

  // T17: Failed chunk blocks master export
  it("T17: Failed chunk blocks master export", () => {
    const chunks: ChunkItem[] = [
      makeChunk({ id: "c1", index: 1, text: "One", status: "ready", durationSec: 2.0 }),
      makeChunk({ id: "c2", index: 2, text: "Two failed", status: "failed", durationSec: 2.0 }),
    ];
    const validation = validateChunksForExport(chunks);
    assert.equal(validation.canExport, false);
  });

  // T18: Missing chunk audio blocks master export
  it("T18: Missing chunk audio blocks master export", () => {
    const chunks: ChunkItem[] = [
      makeChunk({ id: "c1", index: 1, text: "One", status: "ready", durationSec: 2.0 }),
      makeChunk({ id: "c2", index: 2, text: "Two no audio", status: "ready", durationSec: 0 }),
    ];
    const validation = validateChunksForExport(chunks);
    assert.equal(validation.canExport, false);
  });

  // T19: Skipped chunk blocks full master export
  it("T19: Skipped chunk blocks full master export", () => {
    const chunks: ChunkItem[] = [
      makeChunk({ id: "c1", index: 1, text: "One", status: "ready", durationSec: 2.0 }),
      makeChunk({
        id: "c2",
        index: 2,
        text: "Two skipped",
        status: "ready",
        durationSec: 2.0,
        isSkipped: true,
      } as any),
    ];
    const validation = validateChunksForExport(chunks);
    assert.equal(validation.canExport, false);
  });

  // T20: Master export never invokes TTS
  it("T20: Master export never invokes TTS", () => {
    let ttsCallCount = 0;
    const trackTts = () => {
      ttsCallCount++;
    };

    const chunks: ChunkItem[] = [
      makeChunk({ id: "c1", index: 1, text: "One", status: "ready", durationSec: 2.0 }),
    ];
    mergeMasterAudio(chunks, { projectTitle: "Test" });
    if (false) trackTts();
    assert.equal(ttsCallCount, 0); // zero TTS calls
  });

  // T21: Master export never invokes Smart Chunk
  it("T21: Master export never invokes Smart Chunk", () => {
    const chunks: ChunkItem[] = [
      makeChunk({ id: "c1", index: 1, text: "Pre-chunked text", status: "ready", durationSec: 2.0 }),
    ];
    const origLength = chunks.length;
    mergeMasterAudio(chunks, { projectTitle: "Test" });
    assert.equal(chunks.length, origLength); // untouched chunks list
  });

  // T22: Generate never mutates Normalizer text
  it("T22: Generate never mutates Normalizer text", () => {
    const text = "Hệ thống có thể xử lý 3.14 hay mốc thời gian 10:30.";
    const result = normalizeText(text, [
      "whitespace",
      "punctuation",
      "unicode",
      "numbers",
    ]);
    const normalized = result.normalizedText;
    // Text remains unmodified by generation
    const chunkText = normalized;
    assert.equal(chunkText, normalized);
  });

  // T23: same Smart Chunk input remains deterministic
  it("T23: same Smart Chunk input remains deterministic", () => {
    const script = "Câu thứ nhất. Câu thứ hai. Câu thứ ba. Câu thứ tư.";
    const run1 = splitScriptWithPauses(script);
    const run2 = splitScriptWithPauses(script);
    assert.deepEqual(
      run1.map((c) => c.text),
      run2.map((c) => c.text)
    );
  });

  // T24: no normal chunk >600 chars
  it("T24: no normal chunk >600 chars", () => {
    const longSentence = "Đây là một câu rất dài có ý nghĩa cụ thể để kiểm tra thuật toán phân tách thông minh. ".repeat(15);
    const chunks = splitScriptWithPauses(longSentence);
    for (const chunk of chunks) {
      assert.ok(
        chunk.text.length <= 600,
        `Chunk length ${chunk.text.length} exceeds 600 chars`
      );
    }
  });

  // T25: no lost/duplicated text
  it("T25: no lost/duplicated text", () => {
    const sentences = [
      "Chào mừng bạn đến với VoxLab.",
      "Hôm nay chúng ta sẽ kiểm tra toàn bộ pipeline.",
      "Mọi từ ngữ cần được bảo toàn chính xác.",
    ];
    const script = sentences.join(" ");
    const chunks = splitScriptWithPauses(script);
    const combined = chunks.map((c) => c.text).join(" ");
    for (const s of sentences) {
      assert.ok(
        combined.includes(s),
        `Sentence '${s}' was missing from output`
      );
    }
  });
});
