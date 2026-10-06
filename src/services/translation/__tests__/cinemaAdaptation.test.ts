import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { adaptCueToCinemaStyle, condenseVietnameseCinemaLine } from "../cinemaAdaptation";
import { TranslationManager } from "../manager";
import { OriginalCue } from "../../../types/dubbing";

describe("Cinema Dubbing Adaptation & Context-Aware Translation Suite", () => {
  it("condenses wordy Vietnamese translation into punchy cinema style fitting duration", () => {
    // 2.4s duration: approx 7-8 words max
    const verboseLine = "giống như là một người đang đứng ở trong căn bếp của bạn ngay lúc này";
    const condensed = condenseVietnameseCinemaLine(verboseLine, 2.4);

    assert.ok(condensed.length < verboseLine.length, "Should be shorter than verbose line");
    assert.ok(condensed.includes("bếp"), "Should preserve core meaning");
    // Should remove fillers like 'giống như là một người', 'ở trong căn', 'ngay lúc này'
  });

  it("preserves short natural lines without needless truncation", () => {
    const naturalLine = "Hình ảnh này.";
    const result = condenseVietnameseCinemaLine(naturalLine, 2.5);
    assert.equal(result, "Hình ảnh này.");
  });

  it("adapts cue with surrounding scene context", () => {
    const cue: OriginalCue = {
      index: 2,
      startSec: 2.21,
      endSec: 4.65,
      text: "like a person is standing in your kitchen right now,",
    };
    const prevCues: OriginalCue[] = [
      { index: 1, startSec: 0.16, endSec: 2.21, text: "Picture this. A machine built" },
    ];
    const nextCues: OriginalCue[] = [
      { index: 3, startSec: 5.19, endSec: 7.41, text: "holding a knife three inches from your grandmother's hand." },
    ];

    const rawTranslation = "giống như một người đang đứng trong nhà bếp của bạn ngay bây giờ,";
    const adapted = adaptCueToCinemaStyle({
      cue,
      prevCues,
      nextCues,
      rawTranslation,
      targetLang: "vi",
    });

    assert.ok(adapted.length <= rawTranslation.length);
    assert.ok(adapted.includes("bếp"));
  });

  it("integrates into TranslationManager with cinema style and preserves 1:1 invariant", async () => {
    const manager = TranslationManager.getInstance();
    const cues: OriginalCue[] = [
      { index: 1, startSec: 0.0, endSec: 2.0, text: "Picture this." },
      { index: 2, startSec: 2.2, endSec: 4.6, text: "A robot in your kitchen." },
    ];

    const translated = await manager.translateOriginalCues(
      cues,
      "vi",
      "google",
      undefined,
      "cinema"
    );

    assert.equal(translated.length, 2);
    assert.equal(translated[0].index, 1);
    assert.equal(translated[1].index, 2);
    assert.equal(translated[0].startSec, 0.0);
    assert.equal(translated[1].startSec, 2.2);
    assert.ok(translated[0].text.length > 0);
    assert.ok(translated[1].text.length > 0);
  });
});
