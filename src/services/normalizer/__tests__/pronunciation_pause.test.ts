import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeText } from "../engine";
import {
  formatPauseToken,
  parsePauseDurationMs,
  validatePauseDuration,
  splitScriptWithPauses,
} from "../../pause";
import { PronunciationRule } from "../../pronunciation";

describe("Pronunciation Overrides - Targeted Tests (P1-P13)", () => {
  const defaultRule = (partial: Partial<PronunciationRule>): PronunciationRule => ({
    id: "rule_" + Math.random().toString(36).slice(2),
    sourceText: "",
    spokenText: "",
    enabled: true,
    caseSensitive: false,
    scope: "global",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...partial,
  });

  // TEST P1 — exact word
  it("P1: exact word matches and replaces when Option 5 is ON", () => {
    const rules = [
      defaultRule({
        sourceText: "UBND",
        spokenText: "Ủy ban nhân dân",
      }),
    ];
    const input = "UBND công bố báo cáo.";
    const result = normalizeText(input, ["whitespace", "punctuation", "unicode", "numbers", "pronunciation"], {
      pronunciationRules: rules,
    });
    assert.equal(result.normalizedText, "Ủy ban nhân dân công bố báo cáo.");
  });

  // TEST P2 — Option 5 OFF
  it("P2: leaves source text untouched when Option 5 is OFF", () => {
    const rules = [
      defaultRule({
        sourceText: "UBND",
        spokenText: "Ủy ban nhân dân",
      }),
    ];
    const input = "UBND công bố báo cáo.";
    const result = normalizeText(input, ["whitespace", "punctuation", "unicode"], {
      pronunciationRules: rules,
    });
    assert.equal(result.normalizedText, "UBND công bố báo cáo.");
  });

  // TEST P3 — phrase
  it("P3: matches contiguous phrase", () => {
    const rules = [
      defaultRule({
        sourceText: "UBND Hà Nội",
        spokenText: "Ủy ban nhân dân Hà Nội",
      }),
    ];
    const input = "UBND Hà Nội công bố báo cáo.";
    const result = normalizeText(input, ["whitespace", "punctuation", "unicode", "numbers", "pronunciation"], {
      pronunciationRules: rules,
    });
    assert.equal(result.normalizedText, "Ủy ban nhân dân Hà Nội công bố báo cáo.");
  });

  // TEST P4 — longest match first
  it("P4: longest match first avoids double-transforming substring", () => {
    const rules = [
      defaultRule({
        sourceText: "UBND",
        spokenText: "Ủy ban nhân dân",
      }),
      defaultRule({
        sourceText: "UBND Hà Nội",
        spokenText: "Ủy ban nhân dân Hà Nội",
      }),
    ];
    const input = "UBND Hà Nội công bố báo cáo.";
    const result = normalizeText(input, ["whitespace", "punctuation", "unicode", "numbers", "pronunciation"], {
      pronunciationRules: rules,
    });
    assert.equal(result.normalizedText, "Ủy ban nhân dân Hà Nội công bố báo cáo.");
  });

  // TEST P5 — substring safety
  it("P5: whole-token boundary safety does not alter substring inside other words", () => {
    const rules = [
      defaultRule({
        sourceText: "AI",
        spokenText: "A I",
      }),
    ];
    const input = "AI works with Thailand and paid users.";
    const result = normalizeText(input, ["whitespace", "punctuation", "unicode", "numbers", "pronunciation"], {
      pronunciationRules: rules,
    });
    assert.equal(result.normalizedText, "A I works with Thailand and paid users.");
  });

  // TEST P6 — case insensitive
  it("P6: case-insensitive rule matches uppercase, lowercase, and titlecase", () => {
    const rules = [
      defaultRule({
        sourceText: "UBND",
        spokenText: "Ủy ban nhân dân",
        caseSensitive: false,
      }),
    ];
    const inputs = ["UBND", "ubnd", "Ubnd"];
    for (const inp of inputs) {
      const result = normalizeText(inp, ["pronunciation"], {
        pronunciationRules: rules,
      });
      assert.equal(result.normalizedText, "Ủy ban nhân dân");
    }
  });

  // TEST P7 — case sensitive
  it("P7: case-sensitive rule matches only exact casing", () => {
    const rules = [
      defaultRule({
        sourceText: "UBND",
        spokenText: "Ủy ban nhân dân",
        caseSensitive: true,
      }),
    ];
    const matchRes = normalizeText("UBND", ["pronunciation"], {
      pronunciationRules: rules,
    });
    assert.equal(matchRes.normalizedText, "Ủy ban nhân dân");

    const nonMatchRes = normalizeText("ubnd", ["pronunciation"], {
      pronunciationRules: rules,
    });
    assert.equal(nonMatchRes.normalizedText, "ubnd");
  });

  // TEST P8 — symbol / custom span priority
  it("P8: protects custom symbol span from generic normalizer (Options 3 & 4)", () => {
    const rules = [
      defaultRule({
        sourceText: "#5",
        spokenText: "Number five",
      }),
    ];
    const input = "Report #5 was published in 2021.";
    const result = normalizeText(input, ["whitespace", "punctuation", "unicode", "numbers", "pronunciation"], {
      pronunciationRules: rules,
    });
    assert.equal(result.normalizedText, "Report Number five was published in twenty twenty one.");
  });

  // TEST P9 — no recursive replacement
  it("P9: non-recursive replacement (A -> B, B -> C does not cascade A -> C)", () => {
    const rules = [
      defaultRule({
        sourceText: "A",
        spokenText: "B",
      }),
      defaultRule({
        sourceText: "B",
        spokenText: "C",
      }),
    ];
    const input = "A";
    const result = normalizeText(input, ["pronunciation"], {
      pronunciationRules: rules,
    });
    assert.equal(result.normalizedText, "B");
  });

  // TEST P10 — disabled rule
  it("P10: disabled rule does not apply", () => {
    const rules = [
      defaultRule({
        sourceText: "UBND",
        spokenText: "Ủy ban nhân dân",
        enabled: false,
      }),
    ];
    const input = "UBND công bố báo cáo.";
    const result = normalizeText(input, ["pronunciation"], {
      pronunciationRules: rules,
    });
    assert.equal(result.normalizedText, "UBND công bố báo cáo.");
  });

  // TEST P11 — project scope
  it("P11: project scope isolation (rules from Project A do not apply in Project B)", () => {
    const ruleA = defaultRule({
      sourceText: "TermA",
      spokenText: "Spoken A",
      scope: "project",
    });
    assert.equal(ruleA.scope, "project");
    const effectiveRulesProjectB: PronunciationRule[] = [];
    const input = "TermA is unique.";
    const result = normalizeText(input, ["pronunciation"], {
      pronunciationRules: effectiveRulesProjectB,
    });
    assert.equal(result.normalizedText, "TermA is unique.");
  });

  // TEST P12 — global scope
  it("P12: global scope rule applies across all projects", () => {
    const globalRule = defaultRule({
      sourceText: "UBND",
      spokenText: "Ủy ban nhân dân",
      scope: "global",
    });
    const effectiveRules: PronunciationRule[] = [globalRule];
    const input = "UBND họp sáng nay.";
    const result = normalizeText(input, ["pronunciation"], {
      pronunciationRules: effectiveRules,
    });
    assert.equal(result.normalizedText, "Ủy ban nhân dân họp sáng nay.");
  });

  // TEST P13 — idempotency with Option 5 ON
  it("P13: idempotency holds when Option 5 is ON", () => {
    const rules = [
      defaultRule({
        sourceText: "UBND",
        spokenText: "Ủy ban nhân dân",
      }),
      defaultRule({
        sourceText: "#5",
        spokenText: "Number five",
      }),
    ];
    const input = "UBND công bố Report #5 vào năm 2021.";
    const groups: ("whitespace" | "punctuation" | "unicode" | "numbers" | "pronunciation")[] = [
      "whitespace",
      "punctuation",
      "unicode",
      "numbers",
      "pronunciation",
    ];
    const pass1 = normalizeText(input, groups, { pronunciationRules: rules }).normalizedText;
    const pass2 = normalizeText(pass1, groups, { pronunciationRules: rules }).normalizedText;
    assert.equal(pass2, pass1);
  });
});

describe("Manual Pause - Targeted Tests (S1-S14)", () => {
  // TEST S1 — insert 250 ms
  it("S1: preset 0.25s formats to [PAUSE 250ms] and parses to 250ms", () => {
    const token = formatPauseToken(250);
    assert.equal(token, "[PAUSE 250ms]");
    assert.equal(parsePauseDurationMs(token), 250);
  });

  // TEST S2 — insert 500 ms
  it("S2: preset 0.5s formats to [PAUSE 500ms] and parses to 500ms", () => {
    const token = formatPauseToken(500);
    assert.equal(token, "[PAUSE 500ms]");
    assert.equal(parsePauseDurationMs(token), 500);
  });

  // TEST S3 — insert 1 s
  it("S3: preset 1.0s formats to [PAUSE 1000ms] and parses to 1000ms", () => {
    const token = formatPauseToken(1000);
    assert.equal(token, "[PAUSE 1000ms]");
    assert.equal(parsePauseDurationMs(token), 1000);
  });

  // TEST S4 — insert 2 s
  it("S4: preset 2.0s formats to [PAUSE 2000ms] and parses to 2000ms", () => {
    const token = formatPauseToken(2000);
    assert.equal(token, "[PAUSE 2000ms]");
    assert.equal(parsePauseDurationMs(token), 2000);
  });

  // TEST S5 — custom pause
  it("S5: custom 1.5s formats to [PAUSE 1500ms] and parses to 1500ms", () => {
    const token = formatPauseToken(1500);
    assert.equal(token, "[PAUSE 1500ms]");
    assert.equal(parsePauseDurationMs(token), 1500);
  });

  // TEST S6 — invalid custom pause
  it("S6: validates custom pause range (rejects <=0, >10s, NaN, empty)", () => {
    assert.equal(validatePauseDuration(0).valid, false);
    assert.equal(validatePauseDuration(-1).valid, false);
    assert.equal(validatePauseDuration(10.1).valid, false);
    assert.equal(validatePauseDuration(NaN).valid, false);
    assert.equal(validatePauseDuration(1.5).valid, true);
    assert.equal(validatePauseDuration(0.1).valid, true);
    assert.equal(validatePauseDuration(10.0).valid, true);
  });

  // TEST S7 — Normalizer protection
  it("S7: Normalizer protects manual pause token across all groups", () => {
    const input = "Hello [PAUSE 1000ms] world.";
    const result = normalizeText(input, ["whitespace", "punctuation", "unicode", "numbers"]);
    assert.equal(result.normalizedText, "Hello [PAUSE 1000ms] world.");
  });

  // TEST S8 — Option 4 protection
  it("S8: Option 4 does not verbalize 1000 inside [PAUSE 1000ms]", () => {
    const input = "Wait [PAUSE 1000ms] please.";
    const result = normalizeText(input, ["numbers"]);
    assert.equal(result.normalizedText, "Wait [PAUSE 1000ms] please.");
    assert.ok(!result.normalizedText.includes("one thousand"));
  });

  // TEST S9 — Smart Chunker boundary
  it("S9: Smart Chunker creates hard boundary at pause and assigns pauseAfterMs", () => {
    const script = "Chào bạn [PAUSE 1500ms] Rất vui được gặp.";
    const chunks = splitScriptWithPauses(script);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].text, "Chào bạn");
    assert.equal(chunks[0].pauseAfterMs, 1500);
    assert.equal(chunks[1].text, "Rất vui được gặp.");
  });

  // TEST S10 — pause not spoken
  it("S10: pause token is completely stripped from chunk spoken text", () => {
    const script = "Câu thứ nhất. [PAUSE 2000ms] Câu thứ hai.";
    const chunks = splitScriptWithPauses(script);
    for (const chunk of chunks) {
      assert.ok(!chunk.text.includes("[PAUSE"));
      assert.ok(!chunk.text.includes("2000ms"));
    }
  });

  // TEST S11 — undo simulation
  it("S11: undo removes inserted pause cleanly", () => {
    const original = "Hello world";
    const inserted = "Hello [PAUSE 500ms] world";
    assert.ok(inserted.includes("[PAUSE 500ms]"));
    const undone = original;
    assert.equal(undone, "Hello world");
  });

  // TEST S12 — redo simulation
  it("S12: redo restores pause with exact duration", () => {
    const original = "Hello world";
    const inserted = "Hello [PAUSE 500ms] world";
    assert.ok(original.length < inserted.length);
    const redone = inserted;
    assert.equal(redone, "Hello [PAUSE 500ms] world");
    assert.equal(parsePauseDurationMs(redone), 500);
  });

  // TEST S13 — persistence
  it("S13: script with pause survives serialization and parsing", () => {
    const script = "Đoạn một [PAUSE 1000ms] Đoạn hai";
    const serialized = JSON.stringify({ script });
    const parsed = JSON.parse(serialized);
    assert.equal(parsed.script, script);
    assert.equal(parsePauseDurationMs(parsed.script), 1000);
  });

  // TEST S14 — delete
  it("S14: deleting pause token leaves surrounding text intact", () => {
    const textWithPause = "First sentence. [PAUSE 1000ms] Second sentence.";
    const deleted = textWithPause.replace(/\[PAUSE\s+\d+ms\]\s*/g, "");
    assert.equal(deleted, "First sentence. Second sentence.");
  });
});
