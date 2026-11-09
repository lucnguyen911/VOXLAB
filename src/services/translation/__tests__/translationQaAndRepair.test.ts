import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isUntranslatedOrEnglishResidual,
  hasUnexpectedScriptHallucination,
  validateSingleUnitTranslation,
  sanitizeTranslatedUnitText,
  findUntranslatedCueIndices,
  findDefectiveSpeechGroups,
  parseGomRepairResponse,
} from "../translationQaAndRepair";
import { parseBatchTranslationResponse } from "../batchTranslationHelper";
import { TranslationManager } from "../manager";
import type { OriginalCue, TranslatedCue, DubbingSpeechGroup } from "../../../types/dubbing";
import type { TranslationProvider, BatchItem } from "../types";

describe("translationQaAndRepair — Audio-Factory QA & Gom Repair Engine", () => {
  it("detects untranslated English residuals from screenshot (#171-#175) when targetLang is vi", () => {
    const cases = [
      {
        src: "Every winter pothole,",
        dst: "Every winter pothole, every speed bump,",
      },
      {
        src: "every speed bump,",
        dst: "and every",
      },
      {
        src: "and every minor curb tap leaves",
        dst: "minor curb tap",
      },
      {
        src: "permanent microscopic cracks",
        dst: "leaves permanent microscopic cracks along those grain borders,",
      },
      {
        src: "along those grain borders.",
        dst: "which is",
      },
    ];

    for (const c of cases) {
      const check = isUntranslatedOrEnglishResidual(c.src, c.dst, "vi", "en");
      assert.equal(
        check.isUntranslated,
        true,
        `Expected "${c.dst}" to be flagged as untranslated English residual`
      );
      const issues = validateSingleUnitTranslation(c.src, c.dst, "vi", "en");
      assert.ok(issues.length > 0, `Expected "${c.dst}" to fail validation`);
    }
  });

  it("accepts valid Vietnamese translations and standalone proper nouns/numbers", () => {
    assert.deepEqual(
      validateSingleUnitTranslation(
        "Unlike steel, which can flex gently forever, aluminum never forgets a hit.",
        "Không giống như thép, có thể uốn cong nhẹ nhàng mãi mãi, nhôm không bao giờ quên một cú va đập.",
        "vi",
        "en"
      ),
      []
    );

    assert.deepEqual(
      validateSingleUnitTranslation("Tesla", "Tesla", "vi", "en"),
      []
    );

    assert.deepEqual(
      validateSingleUnitTranslation("2026", "2026", "vi", "en"),
      []
    );
  });

  it("detects unexpected CJK/Cyrillic script hallucinations when translating en -> vi", () => {
    assert.equal(
      hasUnexpectedScriptHallucination(
        "Every winter pothole leaves cracks.",
        "Mỗi ổ gà mùa đông để lại vết nứt 裂缝.",
        "vi"
      ),
      true
    );
    const issues = validateSingleUnitTranslation(
      "Every winter pothole leaves cracks.",
      "Mỗi ổ gà mùa đông để lại vết nứt 裂缝.",
      "vi",
      "en"
    );
    assert.ok(issues.includes("script_hallucination"));
  });

  it("sanitizes echoed IDs, markdown prefixes, and surrounding quotes", () => {
    assert.equal(
      sanitizeTranslatedUnitText('[171] "Mỗi ổ gà mùa đông để lại vết nứt."', 171),
      "Mỗi ổ gà mùa đông để lại vết nứt."
    );
  });

  it("parses multi-line wrapped [id] batch responses and JSON fallback maps", () => {
    const expectedItems: BatchItem[] = [
      { id: 168, text: "Unlike steel, which can flex gently forever." },
      { id: 171, text: "Every winter pothole, every speed bump leaves microscopic cracks." },
    ];

    const wrappedRaw = [
      "[168] Không giống như thép,",
      "có thể uốn cong nhẹ nhàng mãi mãi.",
      "[171] Mỗi ổ gà mùa đông, mỗi gờ giảm tốc",
      "đều để lại vết nứt siêu nhỏ.",
    ].join("\n");

    const parsedWrapped = parseBatchTranslationResponse(wrappedRaw, expectedItems);
    assert.equal(
      parsedWrapped.get(168),
      "Không giống như thép, có thể uốn cong nhẹ nhàng mãi mãi."
    );
    assert.equal(
      parsedWrapped.get(171),
      "Mỗi ổ gà mùa đông, mỗi gờ giảm tốc đều để lại vết nứt siêu nhỏ."
    );

    const jsonRaw = JSON.stringify([
      { id: 168, translation: "Không giống như thép." },
      { id: 171, text: "Mỗi ổ gà mùa đông." },
    ]);
    const parsedJson = parseBatchTranslationResponse(jsonRaw, expectedItems);
    assert.equal(parsedJson.get(168), "Không giống như thép.");
    assert.equal(parsedJson.get(171), "Mỗi ổ gà mùa đông.");

    const gomJson = parseGomRepairResponse(jsonRaw, expectedItems);
    assert.equal(gomJson.get(168), "Không giống như thép.");
    assert.equal(gomJson.get(171), "Mỗi ổ gà mùa đông.");
  });

  it("repairs only untranslated English groups via TranslationManager.repairUntranslatedCues", async () => {
    const originalCues: OriginalCue[] = [
      { index: 168, startSec: 312.04, endSec: 313.3, text: "Unlike steel," },
      { index: 169, startSec: 313.3, endSec: 315.3, text: "which can flex gently forever," },
      { index: 170, startSec: 315.3, endSec: 317.32, text: "aluminum never forgets a hit." },
      { index: 171, startSec: 317.32, endSec: 319.03, text: "Every winter pothole," },
      { index: 172, startSec: 319.03, endSec: 320.16, text: "every speed bump," },
      { index: 173, startSec: 320.16, endSec: 322.74, text: "and every minor curb tap leaves" },
      { index: 174, startSec: 322.74, endSec: 324.6, text: "permanent microscopic cracks" },
      { index: 175, startSec: 324.6, endSec: 326.62, text: "along those grain borders." },
    ];

    const currentTranslatedCues: TranslatedCue[] = [
      { index: 168, startSec: 312.04, endSec: 313.3, text: "Không giống như thép,", originalText: "Unlike steel," },
      { index: 169, startSec: 313.3, endSec: 315.3, text: "có thể uốn cong nhẹ nhàng mãi mãi,", originalText: "which can flex gently forever," },
      { index: 170, startSec: 315.3, endSec: 317.32, text: "nhôm không bao giờ quên một cú va đập.", originalText: "aluminum never forgets a hit." },
      { index: 171, startSec: 317.32, endSec: 319.03, text: "Every winter pothole, every speed bump,", originalText: "Every winter pothole," },
      { index: 172, startSec: 319.03, endSec: 320.16, text: "and every", originalText: "every speed bump," },
      { index: 173, startSec: 320.16, endSec: 322.74, text: "minor curb tap", originalText: "and every minor curb tap leaves" },
      { index: 174, startSec: 322.74, endSec: 324.6, text: "leaves permanent microscopic cracks along those grain borders,", originalText: "permanent microscopic cracks" },
      { index: 175, startSec: 324.6, endSec: 326.62, text: "which is", originalText: "along those grain borders." },
    ];

    const speechGroups: DubbingSpeechGroup[] = [
      {
        groupId: "group_168_170",
        sourceCueIds: [168, 169, 170],
        startSec: 312.04,
        endSec: 317.32,
        availableDurationSec: 5.28,
        sourceText: "Unlike steel, which can flex gently forever, aluminum never forgets a hit.",
        translatedText:
          "Không giống như thép, có thể uốn cong nhẹ nhàng mãi mãi, nhôm không bao giờ quên một cú va đập.",
        speechText:
          "Không giống như thép, có thể uốn cong nhẹ nhàng mãi mãi, nhôm không bao giờ quên một cú va đập.",
        breakReason: "terminal_punctuation",
        status: "idle",
      },
      {
        groupId: "group_171_175",
        sourceCueIds: [171, 172, 173, 174, 175],
        startSec: 317.32,
        endSec: 326.62,
        availableDurationSec: 9.3,
        sourceText:
          "Every winter pothole, every speed bump, and every minor curb tap leaves permanent microscopic cracks along those grain borders.",
        translatedText:
          "Every winter pothole, every speed bump, and every minor curb tap leaves permanent microscopic cracks along those grain borders.",
        speechText:
          "Every winter pothole, every speed bump, and every minor curb tap leaves permanent microscopic cracks along those grain borders.",
        breakReason: "terminal_punctuation",
        status: "idle",
      },
    ];

    const untranslatedIndices = findUntranslatedCueIndices(
      originalCues,
      currentTranslatedCues,
      "vi",
      "en"
    );
    assert.deepEqual(untranslatedIndices, [171, 172, 173, 174, 175]);

    const defectiveGroups = findDefectiveSpeechGroups(
      speechGroups,
      originalCues,
      currentTranslatedCues,
      "vi",
      "en"
    );
    assert.deepEqual(defectiveGroups.map((g) => g.groupId), ["group_171_175"]);

    const manager = TranslationManager.getInstance();
    const mockProvider: TranslationProvider = {
      id: "mock_repair_provider",
      displayName: "Mock Repair Provider",
      type: "lmstudio",
      badge: "Local",
      description: "Mock Repair Provider",
      async testConnection() {
        return { ok: true, message: "OK" };
      },
      async translate(): Promise<string> {
        return "Mỗi ổ gà mùa đông, mỗi gờ giảm tốc và mỗi cú chạm vỉa hè nhỏ đều để lại những vết nứt siêu hiển vi vĩnh viễn dọc theo ranh giới hạt đó.";
      },
    };
    manager.registerProvider(mockProvider);

    const repaired = await manager.repairUntranslatedCues(
      originalCues,
      currentTranslatedCues,
      speechGroups,
      "vi",
      "mock_repair_provider",
      undefined,
      "cinema",
      {
        sourceLang: "en",
        dubbingMode: "source_sync",
      }
    );

    assert.equal(repaired.repairedCueIndices.length, 5);
    assert.equal(repaired.translatedCues[0].text, "Không giống như thép,");
    const postRepairUntranslated = findUntranslatedCueIndices(
      originalCues,
      repaired.translatedCues,
      "vi",
      "en"
    );
    assert.deepEqual(postRepairUntranslated, []);
  });
});
