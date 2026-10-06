import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateTranslationResponse1to1 } from "../validator";
import { OriginalCue, TranslatedCue } from "../../../types/dubbing";
import { TranslationManager } from "../manager";

describe("1:1 Translation Invariant Validator Suite (TASK-09 / AC-26)", () => {
  const sampleOriginal: OriginalCue[] = [
    { index: 1, startSec: 0.0, endSec: 2.5, text: "Welcome to VoxLab AI studio." },
    { index: 2, startSec: 3.0, endSec: 6.2, text: "High quality voice dubbing made easy." },
    { index: 3, startSec: 7.0, endSec: 9.8, text: "Export clean master audio seamlessly." },
  ];

  it("passes validation when 1:1 invariant is perfectly satisfied", () => {
    const validTranslated: TranslatedCue[] = [
      {
        index: 1,
        startSec: 0.0,
        endSec: 2.5,
        originalText: "Welcome to VoxLab AI studio.",
        text: "Chào mừng bạn đến với studio AI VoxLab.",
      },
      {
        index: 2,
        startSec: 3.0,
        endSec: 6.2,
        originalText: "High quality voice dubbing made easy.",
        text: "Lồng tiếng chất lượng cao một cách dễ dàng.",
      },
      {
        index: 3,
        startSec: 7.0,
        endSec: 9.8,
        originalText: "Export clean master audio seamlessly.",
        text: "Xuất âm thanh tổng hoàn chỉnh liền mạch.",
      },
    ];

    const result = validateTranslationResponse1to1(sampleOriginal, validTranslated);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it("rejects when AI provider merges cues or drops cues (fewer translated cues)", () => {
    const droppedCue: TranslatedCue[] = [
      {
        index: 1,
        startSec: 0.0,
        endSec: 2.5,
        originalText: "Welcome to VoxLab AI studio.",
        text: "Chào mừng bạn đến với studio AI VoxLab.",
      },
      {
        index: 2,
        startSec: 3.0,
        endSec: 6.2,
        originalText: "High quality voice dubbing made easy.",
        text: "Lồng tiếng chất lượng cao một cách dễ dàng.",
      },
      // Cue #3 was dropped!
    ];

    const result = validateTranslationResponse1to1(sampleOriginal, droppedCue);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("không khớp với số lượng câu gốc")));
    assert.ok(result.errors.some((e) => e.includes("bị bỏ sót")));
  });

  it("rejects when AI provider splits cues (extra translated cues)", () => {
    const splitCues: TranslatedCue[] = [
      {
        index: 1,
        startSec: 0.0,
        endSec: 2.5,
        originalText: "Welcome to VoxLab AI studio.",
        text: "Chào mừng bạn đến với studio AI VoxLab.",
      },
      {
        index: 2,
        startSec: 3.0,
        endSec: 4.5,
        originalText: "High quality voice dubbing made easy.",
        text: "Lồng tiếng chất lượng cao.",
      },
      {
        index: 3,
        startSec: 4.5,
        endSec: 6.2,
        originalText: "High quality voice dubbing made easy.",
        text: "Một cách dễ dàng.",
      },
      {
        index: 4,
        startSec: 7.0,
        endSec: 9.8,
        originalText: "Export clean master audio seamlessly.",
        text: "Xuất âm thanh tổng hoàn chỉnh liền mạch.",
      },
    ];

    const result = validateTranslationResponse1to1(sampleOriginal, splitCues);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("không khớp với số lượng câu gốc")));
  });

  it("rejects when timestamps are drifted or altered from source subtitle timeline", () => {
    const driftedTimestamps: TranslatedCue[] = [
      {
        index: 1,
        startSec: 0.5, // Drifted! Original was 0.0
        endSec: 2.5,
        originalText: "Welcome to VoxLab AI studio.",
        text: "Chào mừng bạn đến với studio AI VoxLab.",
      },
      {
        index: 2,
        startSec: 3.0,
        endSec: 6.5, // Drifted! Original was 6.2
        originalText: "High quality voice dubbing made easy.",
        text: "Lồng tiếng chất lượng cao một cách dễ dàng.",
      },
      {
        index: 3,
        startSec: 7.0,
        endSec: 9.8,
        originalText: "Export clean master audio seamlessly.",
        text: "Xuất âm thanh tổng hoàn chỉnh liền mạch.",
      },
    ];

    const result = validateTranslationResponse1to1(sampleOriginal, driftedTimestamps);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("Mốc bắt đầu câu #1 bị sai lệch")));
    assert.ok(result.errors.some((e) => e.includes("Mốc kết thúc câu #2 bị sai lệch")));
  });

  it("rejects when translated text is empty or blank", () => {
    const emptyText: TranslatedCue[] = [
      {
        index: 1,
        startSec: 0.0,
        endSec: 2.5,
        originalText: "Welcome to VoxLab AI studio.",
        text: "",
      },
      {
        index: 2,
        startSec: 3.0,
        endSec: 6.2,
        originalText: "High quality voice dubbing made easy.",
        text: "   ",
      },
      {
        index: 3,
        startSec: 7.0,
        endSec: 9.8,
        originalText: "Export clean master audio seamlessly.",
        text: "Xuất âm thanh tổng hoàn chỉnh liền mạch.",
      },
    ];

    const result = validateTranslationResponse1to1(sampleOriginal, emptyText);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("Nội dung dịch tại câu #1 bị rỗng")));
    assert.ok(result.errors.some((e) => e.includes("Nội dung dịch tại câu #2 bị rỗng")));
  });

  it("rejects when originalText reference is modified or corrupted", () => {
    const wrongRef: TranslatedCue[] = [
      {
        index: 1,
        startSec: 0.0,
        endSec: 2.5,
        originalText: "Something completely different",
        text: "Chào mừng.",
      },
      {
        index: 2,
        startSec: 3.0,
        endSec: 6.2,
        originalText: sampleOriginal[1].text,
        text: "Lồng tiếng.",
      },
      {
        index: 3,
        startSec: 7.0,
        endSec: 9.8,
        originalText: sampleOriginal[2].text,
        text: "Xuất file.",
      },
    ];

    const result = validateTranslationResponse1to1(sampleOriginal, wrongRef);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("Trường originalText tại câu #1 không khớp")));
  });

  it("integrates into TranslationManager.translateOriginalCues seamlessly", async () => {
    const manager = TranslationManager.getInstance();
    const result = await manager.translateOriginalCues(sampleOriginal, "vi", "google");

    assert.equal(result.length, 3);
    assert.equal(result[0].index, 1);
    assert.equal(result[0].startSec, 0.0);
    assert.equal(result[0].endSec, 2.5);
    assert.ok(result[0].text.length > 0);
    assert.equal(result[0].originalText, sampleOriginal[0].text);
  });
});
