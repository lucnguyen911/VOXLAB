import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  splitScriptWithPauses,
  splitLongSentence,
  calculateBalancedSentenceCounts,
} from "../chunker";
import {
  BatchConcurrencyQueue,
} from "../../concurrencyExecutor";

describe("Smart Chunking Tests (C1 - C15)", () => {
  // C1 — three normal sentences in same paragraph
  it("C1: three normal sentences in same paragraph group into 1 chunk", () => {
    const input = "Câu thứ nhất rất ngắn. Câu thứ hai cũng ngắn. Câu thứ ba kết thúc đoạn.";
    const chunks = splitScriptWithPauses(input);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].text, input);
  });

  // C2 — four normal sentences
  it("C2: four normal sentences group into balanced 2 + 2 chunks", () => {
    const input = "Câu một. Câu hai. Câu ba. Câu bốn.";
    const chunks = splitScriptWithPauses(input);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].text, "Câu một. Câu hai.");
    assert.equal(chunks[1].text, "Câu ba. Câu bốn.");
  });

  // C3 — five sentences
  it("C3: five sentences group into 3 + 2 chunks when under 600 chars", () => {
    const input = "Câu một. Câu hai. Câu ba. Câu bốn. Câu năm.";
    const chunks = splitScriptWithPauses(input);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].text, "Câu một. Câu hai. Câu ba.");
    assert.equal(chunks[1].text, "Câu bốn. Câu năm.");
  });

  // C4 — three sentences exceed 600 chars
  it("C4: three sentences exceeding 600 chars split before hard max", () => {
    // Sentence 1: 250 chars
    const s1 = "Đoạn văn này bắt đầu bằng một câu khá dài để kiểm tra giới hạn của hệ thống tạo giọng nói tự động của VoxLab nhằm đảm bảo rằng mỗi chunk được tạo ra luôn đáp ứng tiêu chuẩn về độ dài và không gây quá tải cho các mô hình ngôn ngữ lớn hoặc mô hình sinh âm.";
    // Sentence 2: 250 chars
    const s2 = "Tiếp theo là câu thứ hai cũng có độ dài tương đương khoảng hai trăm năm mươi ký tự với mục đích kiểm thử khả năng gom cụm thông minh của thuật toán Smart Chunking khi tổng số ký tự của hai câu đã xấp xỉ ngưỡng năm trăm ký tự trong một phân đoạn âm.";
    // Sentence 3: 200 chars
    const s3 = "Và đây là câu thứ ba, nếu gộp chung vào hai câu trước thì tổng số ký tự chắc chắn sẽ vượt quá giới hạn sáu trăm ký tự cho phép nên hệ thống bắt buộc phải tách sang một chunk riêng biệt ngay.";

    const input = `${s1} ${s2} ${s3}`;
    const chunks = splitScriptWithPauses(input);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].text, `${s1} ${s2}`);
    assert.ok(chunks[0].text.length <= 600);
    assert.equal(chunks[1].text, s3);
    assert.ok(chunks[1].text.length <= 600);
  });

  // C5 — two sentences before paragraph break
  it("C5: two sentences before paragraph break do not aggressively merge across paragraph boundary", () => {
    const paraA = "Câu một của đoạn một. Câu hai của đoạn một.";
    const paraB = "Câu ba của đoạn hai. Câu bốn của đoạn hai.";
    const input = `${paraA}\n\n${paraB}`;
    const chunks = splitScriptWithPauses(input);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].text, paraA);
    assert.equal(chunks[1].text, paraB);
  });

  // C6 — Manual Pause
  it("C6: Manual Pause creates hard split before and after pause with pauseAfterMs assigned", () => {
    const input = "Câu trước khoảng dừng. [PAUSE 1500ms] Câu sau khoảng dừng một. Câu sau khoảng dừng hai.";
    const chunks = splitScriptWithPauses(input);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].text, "Câu trước khoảng dừng.");
    assert.equal(chunks[0].pauseAfterMs, 1500);
    assert.equal(chunks[1].text, "Câu sau khoảng dừng một. Câu sau khoảng dừng hai.");
    assert.equal(chunks[1].pauseAfterMs, "auto");
    assert.ok(!chunks[0].text.includes("[PAUSE"));
    assert.ok(!chunks[1].text.includes("[PAUSE"));
  });

  // C7 — one sentence >600 chars
  it("C7: one sentence >600 chars falls back to clause/comma/space split", () => {
    // Construct a single sentence > 600 chars with semicolons, colons, and commas
    const part1 = "Hệ thống tổng hợp giọng nói VoxLab hỗ trợ xử lý kịch bản dài với chất lượng cao; đảm bảo độ mượt mà và tự nhiên trong từng âm tiết";
    const part2 = "đồng thời cung cấp khả năng phân đoạn thông minh dựa trên cấu trúc ngữ nghĩa sâu của từng câu văn trong đoạn kịch bản cần phát âm";
    const part3 = "bao gồm việc nhận diện các điểm ngắt nghỉ hợp lý như dấu chấm phẩy, dấu hai chấm, dấu phẩy phân tách các mệnh đề phụ trong câu";
    const part4 = "và các khoảng trắng an toàn nhằm tránh việc cắt ngang các từ ghép hoặc các ký hiệu kỹ thuật đặc biệt đang được bảo vệ trong hệ thống";
    const part5 = "để kết quả đầu ra luôn là các phân đoạn hoàn chỉnh, phù hợp với giới hạn độ dài của các mô hình sinh âm thanh trí tuệ nhân tạo hiện đại.";

    const longSentence = `${part1}; ${part2}; ${part3}, ${part4}, ${part5}`;
    assert.ok(longSentence.length > 600);

    const parts = splitLongSentence(longSentence, 600);
    assert.ok(parts.length >= 2);
    for (const p of parts) {
      assert.ok(p.length <= 600, `Part exceeded 600 chars: ${p.length}`);
    }
  });

  // C8 — exactly 600 chars
  it("C8: exactly 600 chars is allowed in a single chunk", () => {
    // 599 chars + "." = 600 chars
    const base = "A".repeat(599) + ".";
    assert.equal(base.length, 600);
    const chunks = splitScriptWithPauses(base);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].text.length, 600);
  });

  // C9 — >600 chars
  it("C9: >600 chars is not allowed for normal chunk", () => {
    const longText = "Từ đầu câu ".repeat(60) + ".";
    assert.ok(longText.length > 600);
    const chunks = splitScriptWithPauses(longText);
    for (const c of chunks) {
      assert.ok(c.text.length <= 600, `Chunk length ${c.text.length} exceeded 600`);
    }
  });

  // C10 — custom pronunciation span
  it("C10: does not split inside custom pronunciation protected span", () => {
    const placeholder = "VOX_PRON_P12345_XOV";
    const prefix = "Mô hình xử lý kịch bản với cụm từ tùy chỉnh ";
    const suffix = " kết thúc câu một cách an toàn.";
    const input = `${prefix}${placeholder}${suffix}`;
    const chunks = splitScriptWithPauses(input);
    assert.ok(chunks[0].text.includes(placeholder));
  });

  // C11 — number/unit token
  it("C11: does not split inside number/unit semantic tokens", () => {
    const input = "Dự án tiêu tốn $119B và đạt hiệu suất 1.2 MW với tốc độ 20 km/h tăng trưởng 13.5% trong dải 10-15 ngày.";
    const chunks = splitScriptWithPauses(input);
    assert.equal(chunks.length, 1);
    assert.ok(chunks[0].text.includes("$119B"));
    assert.ok(chunks[0].text.includes("1.2 MW"));
    assert.ok(chunks[0].text.includes("20 km/h"));
    assert.ok(chunks[0].text.includes("13.5%"));
    assert.ok(chunks[0].text.includes("10-15"));
  });

  // C12 — ordering
  it("C12: chunk indices preserve strict source order", () => {
    const input = "Câu một. Câu hai. Câu ba. Câu bốn. Câu năm. Câu sáu. Câu bảy.";
    const chunks = splitScriptWithPauses(input);
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0].index, 1);
    assert.equal(chunks[0].id, "chunk_01");
    assert.equal(chunks[1].index, 2);
    assert.equal(chunks[1].id, "chunk_02");
    assert.equal(chunks[2].index, 3);
    assert.equal(chunks[2].id, "chunk_03");
  });

  // C13 — deterministic
  it("C13: same input and options produce identical chunks across runs", () => {
    const input = "Musk killed the twenty-five-thousand-dollar Model 2. Instead of competing in low-margin metal-bending against China's state-backed supply chain, Tesla is deploying twenty-cent-per-mile Cybercabs. Battery credit is thirty-five-dollar-per-kilowatt-hour.";
    const run1 = splitScriptWithPauses(input);
    const run2 = splitScriptWithPauses(input);
    assert.deepEqual(run1, run2);
  });

  // C14 — no empty chunks
  it("C14: no empty chunks generated even with trailing spaces or blank lines", () => {
    const input = "   \n\n  Câu thứ nhất.   \n\n\n  Câu thứ hai.  \n\n   ";
    const chunks = splitScriptWithPauses(input);
    assert.ok(chunks.length > 0);
    for (const c of chunks) {
      assert.ok(c.text.trim().length > 0);
    }
  });

  // C15 — no text loss / duplication
  it("C15: concatenating spoken chunk text reproduces normalized content without missing words", () => {
    const input = "Câu thứ nhất rất rõ ràng. Câu thứ hai bổ sung ý nghĩa. Câu thứ ba kết luận vấn đề. Câu thứ tư mở ra hướng đi mới.";
    const chunks = splitScriptWithPauses(input);
    const concatenated = chunks.map((c) => c.text).join(" ");
    assert.equal(concatenated, input);
  });
});

describe("Generation Queue & Progress Tests (Q1 - Q12)", () => {
  const calcPercent = (completed: number, total: number): number => {
    return total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  };

  // Q1 — 10 chunks, 0 completed -> 0%
  it("Q1: 10 chunks, 0 completed -> 0%", () => {
    assert.equal(calcPercent(0, 10), 0);
  });

  // Q2 — 10 chunks, 5 completed -> 50%
  it("Q2: 10 chunks, 5 completed -> 50%", () => {
    assert.equal(calcPercent(5, 10), 50);
  });

  // Q3 — 10 chunks, 10 completed -> 100%
  it("Q3: 10 chunks, 10 completed -> 100%", () => {
    assert.equal(calcPercent(10, 10), 100);
  });

  // Q4 — parallel jobs running do not count until completed
  it("Q4: parallel jobs running do not count until completed", async () => {
    const queue = new BatchConcurrencyQueue();
    const items = [1, 2, 3, 4, 5, 6];
    const progressHistory: number[] = [];

    await queue.runBatch(items, {
      concurrency: 2,
      processItem: async () => {
        await new Promise((r) => setTimeout(r, 20));
      },
      onItemCompleted: (_item, _idx, completed, total) => {
        progressHistory.push(calcPercent(completed, total));
      },
    });

    // Every recorded progress corresponds strictly to a completed item:
    // 1/6 (17%), 2/6 (33%), 3/6 (50%), 4/6 (67%), 5/6 (83%), 6/6 (100%)
    assert.equal(progressHistory.length, 6);
    assert.equal(progressHistory[0], 17);
    assert.equal(progressHistory[progressHistory.length - 1], 100);
  });

  // Q5 & Q6 — Pause prevents new jobs from starting, active jobs finish
  it("Q5 & Q6: Pause prevents new jobs from starting, active jobs finish", async () => {
    const queue = new BatchConcurrencyQueue();
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const started: number[] = [];
    const completed: number[] = [];

    const promise = queue.runBatch(items, {
      concurrency: 2,
      processItem: async (item) => {
        started.push(item);
        await new Promise((r) => setTimeout(r, 40));
        completed.push(item);
      },
    });

    // Wait for first pair to start
    await new Promise((r) => setTimeout(r, 15));
    queue.pause();
    assert.equal(queue.isQueuePaused(), true);

    // Wait until active jobs finish
    await new Promise((r) => setTimeout(r, 60));
    // At this point, only the 2 items that were active when pause was called should have completed
    assert.equal(completed.length, 2);
    // And no new items should have started
    assert.equal(started.length, 2);

    // Resume and let finish
    queue.resume();
    await promise;
    assert.equal(completed.length, 8);
  });

  // Q7 — Resume continues pending chunks
  it("Q7: Resume continues pending chunks from exact pause position", async () => {
    const queue = new BatchConcurrencyQueue();
    const items = ["A", "B", "C", "D"];
    const finished: string[] = [];

    const promise = queue.runBatch(items, {
      concurrency: 1,
      processItem: async (item) => {
        await new Promise((r) => setTimeout(r, 20));
        finished.push(item);
      },
    });

    await new Promise((r) => setTimeout(r, 10));
    queue.pause();

    await new Promise((r) => setTimeout(r, 30));
    assert.equal(finished.length, 1);
    assert.equal(finished[0], "A");

    queue.resume();
    await promise;
    assert.deepEqual(finished, ["A", "B", "C", "D"]);
  });

  // Q8 & Q9 — Cancel preserves completed results & prevents remaining from starting
  it("Q8 & Q9: Cancel preserves completed results and prevents remaining from starting", async () => {
    const queue = new BatchConcurrencyQueue();
    const items = [10, 20, 30, 40, 50];
    const completed: number[] = [];

    const promise = queue.runBatch(items, {
      concurrency: 1,
      processItem: async (item) => {
        await new Promise((r) => setTimeout(r, 25));
        completed.push(item);
      },
    });

    // Let item 1 and 2 finish
    await new Promise((r) => setTimeout(r, 60));
    queue.cancel();
    assert.equal(queue.isQueueCancelled(), true);

    await promise;
    // Items 10 and 20 completed and preserved
    assert.ok(completed.length >= 2 && completed.length < 5);
    assert.equal(completed[0], 10);
    assert.equal(completed[1], 20);
  });

  // Q10 — retry failed chunk does not regenerate completed chunks
  it("Q10: retry failed chunk only re-runs the failed chunk", async () => {
    const queue = new BatchConcurrencyQueue();
    const items = ["chunk_1", "chunk_2", "chunk_3"];
    const runCounts: Record<string, number> = {
      chunk_1: 0,
      chunk_2: 0,
      chunk_3: 0,
    };

    let hasFailedOnce = false;

    await queue.runBatch(items, {
      concurrency: 1,
      processItem: async (id) => {
        runCounts[id]++;
        if (id === "chunk_2" && !hasFailedOnce) {
          hasFailedOnce = true;
          throw new Error("Simulated worker error on chunk_2");
        }
      },
      onItemFailed: async (_item, _idx, _err) => {
        return "retry" as const;
      },
    });

    // chunk_1 ran once
    assert.equal(runCounts["chunk_1"], 1);
    // chunk_2 ran twice (failed once, retried once successfully)
    assert.equal(runCounts["chunk_2"], 2);
    // chunk_3 ran once
    assert.equal(runCounts["chunk_3"], 1);
  });

  // Q11 — parallel completion order does not change final audio order
  it("Q11: parallel completion order does not change final audio order", async () => {
    const queue = new BatchConcurrencyQueue();
    const items = [
      { id: "chunk_1", delayMs: 40 },
      { id: "chunk_2", delayMs: 10 }, // chunk_2 finishes first
      { id: "chunk_3", delayMs: 30 },
      { id: "chunk_4", delayMs: 15 },
    ];

    const resultsByIndex: string[] = new Array(items.length);

    await queue.runBatch(items, {
      concurrency: 2,
      processItem: async (item, index) => {
        await new Promise((r) => setTimeout(r, item.delayMs));
        resultsByIndex[index] = `audio_for_${item.id}`;
      },
    });

    // Regardless of completion order, final ordering strictly matches index:
    assert.deepEqual(resultsByIndex, [
      "audio_for_chunk_1",
      "audio_for_chunk_2",
      "audio_for_chunk_3",
      "audio_for_chunk_4",
    ]);
  });

  // Q12 — generation state resets correctly for a NEW generation job
  it("Q12: generation state resets correctly for a new generation job", () => {
    const queue = new BatchConcurrencyQueue();
    queue.pause();
    queue.cancel();
    assert.equal(queue.isQueuePaused(), false); // cancel resets pause
    assert.equal(queue.isQueueCancelled(), true);

    queue.reset();
    assert.equal(queue.isQueuePaused(), false);
    assert.equal(queue.isQueueCancelled(), false);
    assert.equal(queue.getStatus(), "idle");
  });
});

describe("Balanced Tail Chunking Tests (B1 - B12)", () => {
  // B1: 1 sentence -> 1 chunk
  it("B1: 1 sentence -> 1 chunk [1]", () => {
    assert.deepEqual(calculateBalancedSentenceCounts(1, 3), [1]);
    const chunks = splitScriptWithPauses("Câu một duy nhất.");
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].text, "Câu một duy nhất.");
  });

  // B2: 2 sentences -> 1 chunk [2]
  it("B2: 2 sentences -> 1 chunk [2]", () => {
    assert.deepEqual(calculateBalancedSentenceCounts(2, 3), [2]);
    const chunks = splitScriptWithPauses("Câu một. Câu hai.");
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].text, "Câu một. Câu hai.");
  });

  // B3: 3 sentences -> 1 chunk [3]
  it("B3: 3 sentences -> 1 chunk [3]", () => {
    assert.deepEqual(calculateBalancedSentenceCounts(3, 3), [3]);
    const chunks = splitScriptWithPauses("Câu một. Câu hai. Câu ba.");
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].text, "Câu một. Câu hai. Câu ba.");
  });

  // B4: 4 sentences -> 2 chunks [2, 2]
  it("B4: 4 sentences -> 2 chunks [2, 2]", () => {
    assert.deepEqual(calculateBalancedSentenceCounts(4, 3), [2, 2]);
    const chunks = splitScriptWithPauses("Câu 1. Câu 2. Câu 3. Câu 4.");
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].text, "Câu 1. Câu 2.");
    assert.equal(chunks[1].text, "Câu 3. Câu 4.");
  });

  // B5: 5 sentences -> 2 chunks [3, 2]
  it("B5: 5 sentences -> 2 chunks [3, 2]", () => {
    assert.deepEqual(calculateBalancedSentenceCounts(5, 3), [3, 2]);
    const chunks = splitScriptWithPauses("Câu 1. Câu 2. Câu 3. Câu 4. Câu 5.");
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].text, "Câu 1. Câu 2. Câu 3.");
    assert.equal(chunks[1].text, "Câu 4. Câu 5.");
  });

  // B6: 6 sentences -> 2 chunks [3, 3]
  it("B6: 6 sentences -> 2 chunks [3, 3]", () => {
    assert.deepEqual(calculateBalancedSentenceCounts(6, 3), [3, 3]);
    const chunks = splitScriptWithPauses("Câu 1. Câu 2. Câu 3. Câu 4. Câu 5. Câu 6.");
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].text, "Câu 1. Câu 2. Câu 3.");
    assert.equal(chunks[1].text, "Câu 4. Câu 5. Câu 6.");
  });

  // B7: 7 sentences -> 3 chunks [3, 2, 2]
  it("B7: 7 sentences -> 3 chunks [3, 2, 2]", () => {
    assert.deepEqual(calculateBalancedSentenceCounts(7, 3), [3, 2, 2]);
    const chunks = splitScriptWithPauses("Câu 1. Câu 2. Câu 3. Câu 4. Câu 5. Câu 6. Câu 7.");
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0].text, "Câu 1. Câu 2. Câu 3.");
    assert.equal(chunks[1].text, "Câu 4. Câu 5.");
    assert.equal(chunks[2].text, "Câu 6. Câu 7.");
  });

  // B8: 8 sentences -> 3 chunks [3, 3, 2]
  it("B8: 8 sentences -> 3 chunks [3, 3, 2]", () => {
    assert.deepEqual(calculateBalancedSentenceCounts(8, 3), [3, 3, 2]);
    const chunks = splitScriptWithPauses("Câu 1. Câu 2. Câu 3. Câu 4. Câu 5. Câu 6. Câu 7. Câu 8.");
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0].text, "Câu 1. Câu 2. Câu 3.");
    assert.equal(chunks[1].text, "Câu 4. Câu 5. Câu 6.");
    assert.equal(chunks[2].text, "Câu 7. Câu 8.");
  });

  // B9: 9 sentences -> 3 chunks [3, 3, 3]
  it("B9: 9 sentences -> 3 chunks [3, 3, 3]", () => {
    assert.deepEqual(calculateBalancedSentenceCounts(9, 3), [3, 3, 3]);
    const chunks = splitScriptWithPauses("Câu 1. Câu 2. Câu 3. Câu 4. Câu 5. Câu 6. Câu 7. Câu 8. Câu 9.");
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0].text, "Câu 1. Câu 2. Câu 3.");
    assert.equal(chunks[1].text, "Câu 4. Câu 5. Câu 6.");
    assert.equal(chunks[2].text, "Câu 7. Câu 8. Câu 9.");
  });

  // B10: 10 sentences -> 4 chunks [3, 3, 2, 2]
  it("B10: 10 sentences -> 4 chunks [3, 3, 2, 2]", () => {
    assert.deepEqual(calculateBalancedSentenceCounts(10, 3), [3, 3, 2, 2]);
    const chunks = splitScriptWithPauses("Câu 1. Câu 2. Câu 3. Câu 4. Câu 5. Câu 6. Câu 7. Câu 8. Câu 9. Câu 10.");
    assert.equal(chunks.length, 4);
    assert.equal(chunks[0].text, "Câu 1. Câu 2. Câu 3.");
    assert.equal(chunks[1].text, "Câu 4. Câu 5. Câu 6.");
    assert.equal(chunks[2].text, "Câu 7. Câu 8.");
    assert.equal(chunks[3].text, "Câu 9. Câu 10.");
  });

  // B11: character limit has higher priority than balanced tail
  it("B11: 4 sentences exceeding 600 chars prioritizes hardMax over balanced 2+2", () => {
    const s1 = "Đoạn văn đầu tiên này rất dài với mục đích đẩy tổng số ký tự của phân đoạn lên mức ba trăm năm mươi ký tự nhằm kiểm thử ngưỡng giới hạn an toàn của hệ thống VoxLab khi xử lý phân đoạn thông minh đa câu.";
    const s2 = "Đoạn văn thứ hai cũng có độ dài tương tự khoảng ba trăm năm mươi ký tự để khi gộp chung với câu một thì tổng ký tự vượt quá sáu trăm ký tự cho phép của hệ thống tổng hợp giọng nói.";
    const s3 = "Câu thứ ba ngắn gọn.";
    const s4 = "Câu thứ tư cũng ngắn.";
    const input = `${s1} ${s2} ${s3} ${s4}`;
    const chunks = splitScriptWithPauses(input);
    for (const c of chunks) {
      assert.ok(c.text.length <= 600, `Chunk length ${c.text.length} exceeded 600`);
    }
  });

  // B12: balanced tail chunking does not cross paragraph or manual pause boundaries
  it("B12: balanced tail chunking strictly respects paragraph and manual pause boundaries", () => {
    const para1 = "Đoạn một câu một. Đoạn một câu hai. Đoạn một câu ba.";
    const para2 = "Đoạn hai câu một.";
    const input = `${para1}\n\n${para2}`;
    const chunks = splitScriptWithPauses(input);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].text, para1);
    assert.equal(chunks[1].text, para2);

    const pauseInput = "Câu một. Câu hai. Câu ba. [PAUSE 500ms] Câu bốn.";
    const pauseChunks = splitScriptWithPauses(pauseInput);
    assert.equal(pauseChunks.length, 2);
    assert.equal(pauseChunks[0].text, "Câu một. Câu hai. Câu ba.");
    assert.equal(pauseChunks[0].pauseAfterMs, 500);
    assert.equal(pauseChunks[1].text, "Câu bốn.");
  });
});

describe("Queue Race Condition & Hardening Tests (QR1 - QR10)", () => {
  // QR1: Concurrency level 2x runs with maxObservedActive <= 2
  it("QR1: Concurrency level 2x runs with maxObservedActive <= 2", async () => {
    const queue = new BatchConcurrencyQueue();
    const items = [1, 2, 3, 4, 5, 6];
    const telemetry = await queue.runBatch(items, {
      concurrency: 2,
      processItem: async () => {
        await new Promise((r) => setTimeout(r, 20));
      },
    });
    assert.ok(telemetry.maxObservedActive <= 2);
    assert.equal(telemetry.completedCount, 6);
  });

  // QR2: Parallel pause halts new tasks immediately while active finish
  it("QR2: Parallel pause halts new tasks immediately while active finish", async () => {
    const queue = new BatchConcurrencyQueue();
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const started: number[] = [];
    const completed: number[] = [];

    const promise = queue.runBatch(items, {
      concurrency: 2,
      processItem: async (item) => {
        started.push(item);
        await new Promise((r) => setTimeout(r, 35));
        completed.push(item);
      },
    });

    await new Promise((r) => setTimeout(r, 15));
    queue.pause();
    assert.equal(queue.isQueuePaused(), true);

    await new Promise((r) => setTimeout(r, 60));
    assert.equal(completed.length, 2);
    assert.equal(started.length, 2);

    queue.resume();
    await promise;
    assert.equal(completed.length, 8);
  });

  // QR3: Parallel resume wakes workers and finishes all items
  it("QR3: Parallel resume wakes workers and finishes all items", async () => {
    const queue = new BatchConcurrencyQueue();
    const items = [1, 2, 3, 4, 5, 6];
    const done: number[] = [];

    const promise = queue.runBatch(items, {
      concurrency: 2,
      processItem: async (item) => {
        await new Promise((r) => setTimeout(r, 20));
        done.push(item);
      },
    });

    await new Promise((r) => setTimeout(r, 10));
    queue.pause();
    await new Promise((r) => setTimeout(r, 30));

    queue.resume();
    await promise;
    assert.equal(done.length, 6);
  });

  // QR4: Cancel unblocks paused workers immediately without hanging
  it("QR4: Cancel unblocks paused workers immediately without hanging", async () => {
    const queue = new BatchConcurrencyQueue();
    const items = [1, 2, 3, 4];
    const done: number[] = [];

    const promise = queue.runBatch(items, {
      concurrency: 2,
      processItem: async (item) => {
        await new Promise((r) => setTimeout(r, 30));
        done.push(item);
      },
    });

    await new Promise((r) => setTimeout(r, 10));
    queue.pause();
    queue.cancel();
    assert.equal(queue.isQueueCancelled(), true);

    await promise;
    assert.ok(done.length <= 2);
  });

  // QR5: Duplicate completion prevention: Set ensures completed count never exceeds total items
  it("QR5: Set ensures completed count never exceeds total items", async () => {
    const queue = new BatchConcurrencyQueue();
    const items = [1, 2, 3, 4];
    const progressRecords: number[] = [];

    const telemetry = await queue.runBatch(items, {
      concurrency: 2,
      processItem: async () => {
        await new Promise((r) => setTimeout(r, 15));
      },
      onItemCompleted: (_item, _idx, completed, total) => {
        progressRecords.push(completed);
        assert.ok(completed <= total);
      },
    });

    assert.equal(telemetry.completedCount, 4);
    assert.ok(Math.max(...progressRecords) <= 4);
  });

  // QR6: Progress % never exceeds 100%
  it("QR6: Progress percentage never exceeds 100%", async () => {
    const queue = new BatchConcurrencyQueue();
    const items = [1, 2, 3];
    const percentages: number[] = [];

    await queue.runBatch(items, {
      concurrency: 2,
      processItem: async () => {
        await new Promise((r) => setTimeout(r, 10));
      },
      onItemCompleted: (_item, _idx, completed, total) => {
        const pct = Math.min(100, Math.round((completed / total) * 100));
        percentages.push(pct);
      },
    });

    for (const p of percentages) {
      assert.ok(p <= 100 && p >= 0);
    }
  });

  // QR7: Skipped items tracked in telemetry without counting as completed
  it("QR7: Skipped items are tracked in telemetry without counting as completed", async () => {
    const queue = new BatchConcurrencyQueue();
    const items = ["chunk_1", "chunk_2", "chunk_3"];

    const telemetry = await queue.runBatch(items, {
      concurrency: 1,
      processItem: async (id) => {
        if (id === "chunk_2") throw new Error("Item 2 failed");
      },
      onItemFailed: async () => {
        return "skip" as const;
      },
    });

    assert.equal(telemetry.completedCount, 2);
    assert.equal(telemetry.skippedCount, 1);
    assert.equal(telemetry.itemCount, 3);
  });

  // QR8: Rapid pause/resume stress test does not deadlock or lose items
  it("QR8: Rapid pause/resume stress test does not deadlock or lose items", async () => {
    const queue = new BatchConcurrencyQueue();
    const items = Array.from({ length: 12 }, (_, i) => i + 1);
    const completed: number[] = [];

    const promise = queue.runBatch(items, {
      concurrency: 3,
      processItem: async (item) => {
        await new Promise((r) => setTimeout(r, 15));
        completed.push(item);
      },
    });

    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 8));
      queue.pause();
      await new Promise((r) => setTimeout(r, 5));
      queue.resume();
    }

    await promise;
    assert.equal(completed.length, 12);
  });

  // QR9: Cancel during active retry halts cleanly
  it("QR9: Cancel during active retry halts cleanly", async () => {
    const queue = new BatchConcurrencyQueue();
    const items = [1, 2, 3, 4];
    let retryAttempt = 0;

    const promise = queue.runBatch(items, {
      concurrency: 1,
      processItem: async (item) => {
        if (item === 2) {
          retryAttempt++;
          throw new Error("Simulated failure for retry");
        }
      },
      onItemFailed: async () => {
        if (retryAttempt === 1) {
          queue.cancel();
          return "cancel" as const;
        }
        return "retry" as const;
      },
    });

    await promise;
    assert.equal(queue.isQueueCancelled(), true);
  });

  // QR10: Reset restores clean initial state ready for new run
  it("QR10: Reset restores clean initial state ready for new run", () => {
    const queue = new BatchConcurrencyQueue();
    queue.pause();
    queue.cancel();
    queue.reset();

    assert.equal(queue.getStatus(), "idle");
    assert.equal(queue.isQueuePaused(), false);
    assert.equal(queue.isQueueCancelled(), false);
    assert.equal(queue.getActiveWorkers(), 0);
    assert.equal(queue.getMaxObserved(), 0);
  });
});
