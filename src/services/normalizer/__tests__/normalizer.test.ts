import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  NORMALIZER_GROUPS,
  getDefaultEnabledGroupIds,
  normalizeText,
  applyWhitespaceGroup,
  applyPunctuationGroup,
  applyUnicodeGroup,
  applyTypographyGroup,
  computeTokenDiff,
  computeWordDelta,
  computeCharDelta,
  type NormalizerGroupId,
} from "../index";

describe("Text Normalizer - 4 Core Groups", () => {
  it("has exactly 4 user-facing groups", () => {
    assert.equal(NORMALIZER_GROUPS.length, 4);
    const ids = NORMALIZER_GROUPS.map((g) => g.id);
    assert.deepEqual(ids, ["whitespace", "punctuation", "unicode", "numbers"]);
  });

  it("default enabled groups are the safe default ones (numbers is default OFF)", () => {
    const defaultIds = getDefaultEnabledGroupIds();
    assert.deepEqual(defaultIds, ["whitespace", "punctuation", "unicode"]);
  });

  it("whitespace group: collapses multiple spaces, trims lines, collapses excess blank lines", () => {
    const raw = "  Xin   chào    các bạn  \n\n\n\n  Đoạn   2  ";
    const res = applyWhitespaceGroup(raw);
    assert.equal(res, "Xin chào các bạn.\nĐoạn 2");
  });

  it("punctuation group: collapses repeated punctuation (collapse !!! -> !, ??? -> ?, ... -> .) while preserving ?! and ……", () => {
    // Repeated punctuation collapsed as per Section E4
    assert.equal(applyPunctuationGroup("No!!!!"), "No!");
    assert.equal(applyPunctuationGroup("What????"), "What?");
    assert.equal(applyPunctuationGroup("Really?!"), "Really?!");
    assert.equal(applyPunctuationGroup("Wait..."), "Wait.");
    assert.equal(applyPunctuationGroup("Chờ đã……"), "Chờ đã……");

    // Obvious formatting errors are cleaned
    assert.equal(applyPunctuationGroup("Hello , world !"), "Hello, world!");
    assert.equal(applyPunctuationGroup("Xin chào ."), "Xin chào.");
    assert.equal(applyPunctuationGroup("Xin chào, ."), "Xin chào.");
    assert.equal(applyPunctuationGroup("No   !!!!"), "No!");
  });

  it("unicode group: NFC normalization, strips zero-width chars and control codes, normalizes bullets to pauses, PRESERVES visible non-bullet symbols and currencies", () => {
    // NFC normalization
    assert.equal(applyUnicodeGroup("Viê\u0323t Nam"), "Việt Nam");
    // Zero-width space and control chars removal
    assert.equal(applyUnicodeGroup("Vox\u200BLab\uFEFF"), "VoxLab");
    // Non-breaking space converted to normal space
    assert.equal(applyUnicodeGroup("Xin\u00A0chào"), "Xin chào");

    // BULLETS converted to pauses as per Section F
    assert.equal(applyUnicodeGroup("• Tesla\n• Volvo"), "Tesla,\nVolvo.");
    assert.equal(applyUnicodeGroup("◆ Section 1"), "Section 1.");
    assert.equal(applyUnicodeGroup("■ Bước 1 ● Lưu ý ★ Đánh giá → Tiếp tục ✓ Hoàn tất"), "Bước 1, Lưu ý, Đánh giá → Tiếp tục ✓ Hoàn tất.");

    // Currency symbols and % MUST be preserved
    assert.equal(
      applyUnicodeGroup("Giá $12,000 và 10% giảm giá"),
      "Giá $12,000 và 10% giảm giá"
    );
    assert.equal(
      applyUnicodeGroup("€12.000 và 500.000₫"),
      "€12.000 và 500.000₫"
    );

    // Removal of '#' (markdown headings #, ##, ### and hashtag symbols)
    assert.equal(
      applyUnicodeGroup("# ELON MUSK'S $119B\n## INTRO.\n### THE NUMBERS"),
      "ELON MUSK'S $119B\nINTRO.\nTHE NUMBERS"
    );
    assert.equal(applyUnicodeGroup("Episode #1 và #hashtag"), "Episode 1 và hashtag");
    assert.equal(applyUnicodeGroup("https://voxlab.ai#section"), "https://voxlab.ai#section");
  });

  it("typography group: standardizes quotes while preserving em-dash (—), en-dash (–), and ellipsis (…)", () => {
    // Quotes standardized
    assert.equal(
      applyTypographyGroup("«VoxLab» là “phần mềm” tốt ‘nhất’"),
      '"VoxLab" là "phần mềm" tốt \'nhất\''
    );

    // Contractions and apostrophes preserved
    assert.equal(applyTypographyGroup("don’t"), "don't");
    assert.equal(applyTypographyGroup("America’s"), "America's");
    assert.equal(applyTypographyGroup("it’s"), "it's");

    // Em-dash (—) and en-dash (–) MUST BE PRESERVED in safe default
    assert.equal(
      applyTypographyGroup("Hello — world – test"),
      "Hello — world – test"
    );

    // Ellipsis glyph (…) MUST BE PRESERVED in safe default
    assert.equal(applyTypographyGroup("Wait…"), "Wait…");
  });
});

describe("Token Safety Guard - Protection Matrix", () => {
  it("Safe default normalization preserves all protected token formats without alteration", () => {
    const testCases = [
      "Chi phí là $12,000 cho gói cao cấp.",
      "Giá vé là €12.000 tại châu Âu.",
      "Số pi xấp xỉ 3.14.",
      "Tỉ lệ màn hình 16:9 và lúc 10:30 sáng.",
      "Cập nhật phiên bản v2.0 của phần mềm.",
      "Địa chỉ IP máy chủ là 127.0.0.1 trong mạng.",
      "Hiệu suất tăng 10% sau khi tối ưu.",
      "Truy cập website https://voxlab.ai hoặc gửi email tới name@example.com.",
      "Số lớn 12,000.50 USD và 12.000,50 EUR.",
    ];

    const defaultGroups = getDefaultEnabledGroupIds();

    for (const testText of testCases) {
      const res = normalizeText(testText, defaultGroups);
      assert.equal(res.normalizedText, testText, `Failed on: ${testText}`);
      assert.equal(res.hasChanges, false);
    }
  });

  it("Safe normalization protects abbreviations, initialisms, academic titles, versions, and domains", () => {
    const safeTokens = [
      "U.S.A.",
      "U.K.",
      "Ph.D.",
      "M.D.",
      "e.g.",
      "i.e.",
      "Dr.Smith",
      "Mr.Jones",
      "Mrs.Smith",
      "St.John",
      "v1.2.3",
      "Version 2.0",
      "Node.js",
      "example.com",
      "127.0.0.1",
    ];

    const defaultGroups = getDefaultEnabledGroupIds();

    for (const token of safeTokens) {
      const res = normalizeText(token, defaultGroups);
      assert.equal(res.normalizedText, token, `Failed to preserve token: ${token}`);
    }
  });

  it("Safe normalization preserves contractions and apostrophe variations", () => {
    const defaultGroups = getDefaultEnabledGroupIds();

    // Contractions with straight apostrophe
    assert.equal(normalizeText("don't", defaultGroups).normalizedText, "don't");
    assert.equal(normalizeText("it's", defaultGroups).normalizedText, "it's");
    assert.equal(normalizeText("America's", defaultGroups).normalizedText, "America's");

    // Contractions with curly apostrophe normalized to standard apostrophe without stray spaces
    assert.equal(normalizeText("John’s", defaultGroups).normalizedText, "John's");
    assert.equal(normalizeText("rock ’n’ roll", defaultGroups).normalizedText, "rock 'n' roll");
    assert.equal(normalizeText("1990’s", defaultGroups).normalizedText, "1990's");
    assert.equal(normalizeText("‘Hello’", defaultGroups).normalizedText, "Hello");
    assert.equal(normalizeText("“Hello”", defaultGroups).normalizedText, "Hello");
  });

  it("Safe normalization cleans spacing around protected tokens without corrupting tokens", () => {
    const raw = "Chi phí là  $12,000  ,  vào lúc  10:30  !   Website :  https://voxlab.ai  .";
    const expected = "Chi phí là $12,000, vào lúc 10:30! Website: https://voxlab.ai.";
    const res = normalizeText(raw, getDefaultEnabledGroupIds());
    assert.equal(res.normalizedText, expected);
  });

  it("Safe normalization distinguishes sentence boundaries from protected abbreviations", () => {
    // Normal sentences without space are fixed
    const sentences = "Hôm nay trời đẹp.Ngày mai có mưa.";
    const expectedSentences = "Hôm nay trời đẹp. Ngày mai có mưa.";
    assert.equal(normalizeText(sentences, getDefaultEnabledGroupIds()).normalizedText, expectedSentences);

    // Context containing initialisms, academic titles, domains, and versions preserves all tokens
    const complex = "Tôi sống ở U.S.A., tốt nghiệp Ph.D. vào năm 2022.Ghé thăm https://voxlab.ai hoặc example.com với Node.js v1.2.3 trên IP 127.0.0.1.";
    const expectedComplex = "Tôi sống ở U.S.A., tốt nghiệp Ph.D. vào năm 2022. Ghé thăm https://voxlab.ai hoặc example.com với Node.js v1.2.3 trên IP 127.0.0.1.";
    assert.equal(normalizeText(complex, getDefaultEnabledGroupIds()).normalizedText, expectedComplex);
  });

  it("Sentence boundary spacing properly handles abbreviations ending at sentence boundaries (Section 7)", () => {
    const defaultGroups = getDefaultEnabledGroupIds();

    // 1. Initialism at sentence boundary
    assert.equal(
      normalizeText("I live in U.S.A.Next sentence.", defaultGroups).normalizedText,
      "I live in U.S.A. Next sentence."
    );
    assert.equal(
      normalizeText("This works in U.K.Next example.", defaultGroups).normalizedText,
      "This works in U.K. Next example."
    );

    // 2. Academic abbreviation at sentence boundary
    assert.equal(
      normalizeText("He has a Ph.D.Next paragraph.", defaultGroups).normalizedText,
      "He has a Ph.D. Next paragraph."
    );

    // 3. Common abbreviation at sentence boundary
    assert.equal(
      normalizeText("See details etc.Next item.", defaultGroups).normalizedText,
      "See details etc. Next item."
    );

    // 4. Tech / domain token at sentence boundary
    assert.equal(
      normalizeText("Use Node.js.Next section.", defaultGroups).normalizedText,
      "Use Node.js. Next section."
    );
  });

  it("Placeholder Collision Guard: user content containing internal placeholder strings is NEVER corrupted", () => {
    const defaultGroups = getDefaultEnabledGroupIds();

    // User text containing exact historical placeholder patterns
    const raw = "Mã token là VOXPROT0TOKEN và VOXPROT1TOKEN cùng với $12,000 và U.S.A. ở đây.";
    const res = normalizeText(raw, defaultGroups);
    assert.equal(
      res.normalizedText,
      "Mã token là VOXPROT0TOKEN và VOXPROT1TOKEN cùng với $12,000 và U.S.A. ở đây."
    );
  });
});

describe("Safe Normalization - Real-world Safe Scenarios", () => {
  it("Scenario A: Repeated punctuation is collapsed while pairs like ?! are preserved", () => {
    const raw = "No!!!! What???? Really?! Wait... Chờ đã……";
    const expected = "No! What? Really?! Wait. Chờ đã……";
    const res = normalizeText(raw, getDefaultEnabledGroupIds());
    assert.equal(res.normalizedText, expected);
    assert.equal(res.hasChanges, true);
  });

  it("Scenario B: List bullets are normalized to voice-over pauses while non-bullet symbols like ✓ are preserved", () => {
    const raw = "Danh sách:\n• Tesla\n• Volvo\n◆ Mục đặc biệt\n✓ Đã xong";
    const expected = "Danh sách:\nTesla,\nVolvo,\nMục đặc biệt.\n✓ Đã xong";
    const res = normalizeText(raw, getDefaultEnabledGroupIds());
    assert.equal(res.normalizedText, expected);
    assert.equal(res.hasChanges, true);
  });

  it("Scenario C: Prose dashes convert to commas while single-character ellipsis is preserved", () => {
    const raw = "Hà Nội — Việt Nam – Thủ đô…";
    const expected = "Hà Nội, Việt Nam, Thủ đô…";
    const res = normalizeText(raw, getDefaultEnabledGroupIds());
    assert.equal(res.normalizedText, expected);
    assert.equal(res.hasChanges, true);
  });

  it("Scenario D: Quotes and contractions are properly canonicalized without corruption", () => {
    const raw = "“Hello world”, it’s America’s best tool, don’t worry!";
    const expected = "Hello world, it's America's best tool, don't worry!";
    const res = normalizeText(raw, getDefaultEnabledGroupIds());
    assert.equal(res.normalizedText, expected);
    assert.equal(res.hasChanges, true);
  });
});

describe("Normalization Engine - Pipeline, Diff & Idempotency", () => {
  it("Pipeline is idempotent: normalize(normalize(text)) == normalize(text)", () => {
    const raw = "  Tôi   đang thử nghiệm  , VoxLab!!!!   «Công nghệ mới»  —  phiên bản 2.0  \n\n\n\nĐoạn 2 ... \n\n";
    const defaultGroups = getDefaultEnabledGroupIds();
    const firstPass = normalizeText(raw, defaultGroups);
    const secondPass = normalizeText(firstPass.normalizedText, defaultGroups);

    assert.equal(secondPass.normalizedText, firstPass.normalizedText);
    assert.equal(secondPass.hasChanges, false);
    assert.equal(secondPass.totalChanges, 0);
  });

  it("Recomputing preview from original text preserves determinism on toggles", () => {
    const raw = "  Đoạn văn   «test»  !!!!";
    // With all default groups: quotes stripped, spaces cleaned, space before ! cleaned, !!!! collapsed to !
    const full = normalizeText(raw, ["whitespace", "punctuation", "unicode"]);
    assert.equal(full.normalizedText, "Đoạn văn test!");

    // Toggle unicode off -> quotes preserved as «test»
    const withoutUnicode = normalizeText(raw, ["whitespace", "punctuation"]);
    assert.equal(withoutUnicode.normalizedText, "Đoạn văn «test»!");

    // Toggle back on -> identical to full
    const backOn = normalizeText(raw, ["whitespace", "punctuation", "unicode"]);
    assert.equal(backOn.normalizedText, full.normalizedText);
  });

  it("Diff tokens accurately classify pure_deleted, replaced_old, pure_added, replaced_new", () => {
    const raw = "Xin    chào.bạn! «VoxLab»";
    const result = normalizeText(raw, getDefaultEnabledGroupIds());

    // Before reconstruction matches raw
    const reconstructedBefore = result.diffBefore.map((t) => t.text).join("");
    assert.equal(reconstructedBefore, raw);

    // After reconstruction matches normalizedText
    const reconstructedAfter = result.diffAfter.map((t) => t.text).join("");
    assert.equal(reconstructedAfter, result.normalizedText);

    // Ensure changed tokens exist
    const hasBeforeChanges = result.diffBefore.some((t) => t.type === "pure_deleted" || t.type === "replaced_old");
    const hasAfterChanges = result.diffAfter.some((t) => t.type === "pure_added" || t.type === "replaced_new");
    assert.ok(hasBeforeChanges, "diffBefore should have deletion or replacement tokens");
    assert.ok(hasAfterChanges, "diffAfter should have addition or replacement tokens");
  });

  it("Empty or whitespace-only input produces hasChanges: false gracefully", () => {
    const emptyResult = normalizeText("", getDefaultEnabledGroupIds());
    assert.equal(emptyResult.normalizedText, "");
    assert.equal(emptyResult.hasChanges, false);
    assert.equal(emptyResult.totalChanges, 0);
  });

  it("High performance on long text (>50,000 characters)", () => {
    const paragraph = "Trong tập podcast ngày hôm nay  , chúng ta sẽ cùng khám phá một chủ đề vô cùng hấp dẫn: Tương lai của Trí tuệ Nhân tạo trong việc sản xuất nội dung âm thanh dài tập!!!! Với sự bùng nổ của các mô hình học sâu tại phiên bản v2.0  —  việc tạo ra giọng nói tự nhiên, giàu cảm xúc đã không còn là đặc quyền của các phòng thu chuyên nghiệp.\n\n\n\n";
    const longText = paragraph.repeat(150); // ~55,000 chars
    assert.ok(longText.length > 50000);

    const startTime = performance.now();
    const result = normalizeText(longText, getDefaultEnabledGroupIds());
    const durationMs = performance.now() - startTime;

    assert.ok(result.hasChanges);
    assert.ok(durationMs < 250, `Normalization took ${durationMs}ms, should be < 250ms`);
  });
});

describe("Word Delta Calculation - Test Cases Matrix (Section 22)", () => {
  it("CASE 1 — Addition: detects +1 / -0 words", () => {
    const diff = computeTokenDiff("Tesla is fast.", "Tesla is very fast.");
    const delta = computeWordDelta(diff.diffBefore, diff.diffAfter);
    assert.equal(delta.addedWords, 1);
    assert.equal(delta.deletedWords, 0);
  });

  it("CASE 2 — Deletion: detects +0 / -1 words", () => {
    const diff = computeTokenDiff("Tesla is very fast.", "Tesla is fast.");
    const delta = computeWordDelta(diff.diffBefore, diff.diffAfter);
    assert.equal(delta.addedWords, 0);
    assert.equal(delta.deletedWords, 1);
  });

  it("CASE 3 — Replacement: detects replacement counts without collapsing to net 0", () => {
    const diff = computeTokenDiff("Tesla is very fast.", "Tesla is extremely efficient.");
    const delta = computeWordDelta(diff.diffBefore, diff.diffAfter);
    assert.equal(delta.addedWords, 2);
    assert.equal(delta.deletedWords, 2);
  });

  it("CASE 4 — Punctuation only: does not count punctuation marks as added/deleted words", () => {
    const diff = computeTokenDiff("Hello , world", "Hello, world");
    const delta = computeWordDelta(diff.diffBefore, diff.diffAfter);
    assert.equal(delta.addedWords, 0);
    assert.equal(delta.deletedWords, 0);
  });

  it("CASE 5 — Whitespace only: does not count whitespace changes as added/deleted words", () => {
    const diff = computeTokenDiff("Xin  chào", "Xin chào");
    const delta = computeWordDelta(diff.diffBefore, diff.diffAfter);
    assert.equal(delta.addedWords, 0);
    assert.equal(delta.deletedWords, 0);
  });

  it("Integration: normalizeText populates addedWords and deletedWords in NormalizationResult", () => {
    const res = normalizeText("“Hello world”", getDefaultEnabledGroupIds());
    assert.equal(res.hasChanges, true);
    // Quotes changed from “...” to "...", words remain Hello world (no word additions/deletions)
    assert.equal(res.addedWords, 0);
    assert.equal(res.deletedWords, 0);
  });
});

describe("Character Delta Calculation - Test Cases Matrix (Section 19)", () => {
  it("CASE 1 — Addition: abc -> abcd detects +1 / -0 chars", () => {
    const diff = computeTokenDiff("abc", "abcd");
    const delta = computeCharDelta(diff.diffBefore, diff.diffAfter);
    assert.equal(delta.addedChars, 1);
    assert.equal(delta.deletedChars, 0);
  });

  it("CASE 2 — Deletion: abcd -> abc detects +0 / -1 chars", () => {
    const diff = computeTokenDiff("abcd", "abc");
    const delta = computeCharDelta(diff.diffBefore, diff.diffAfter);
    assert.equal(delta.addedChars, 0);
    assert.equal(delta.deletedChars, 1);
  });

  it("CASE 3 — Replacement: abc -> axc detects +1 / -1 chars", () => {
    const diff = computeTokenDiff("abc", "axc");
    const delta = computeCharDelta(diff.diffBefore, diff.diffAfter);
    assert.equal(delta.addedChars, 1);
    assert.equal(delta.deletedChars, 1);
  });

  it("CASE 4 — Whitespace deletion: Xin  chào -> Xin chào detects +0 / -1 chars", () => {
    const diff = computeTokenDiff("Xin  chào", "Xin chào");
    const delta = computeCharDelta(diff.diffBefore, diff.diffAfter);
    assert.equal(delta.addedChars, 0);
    assert.equal(delta.deletedChars, 1);
  });

  it("CASE 5 — Quote replacement: “VoxLab” -> \"VoxLab\" detects +2 / -2 chars", () => {
    const diff = computeTokenDiff("“VoxLab”", '"VoxLab"');
    const delta = computeCharDelta(diff.diffBefore, diff.diffAfter);
    assert.equal(delta.addedChars, 2);
    assert.equal(delta.deletedChars, 2);
  });

  it("CASE 6 — Punctuation spacing: Xin chào .Hôm nay -> Xin chào. Hôm nay detects +1 / -1 chars", () => {
    const diff = computeTokenDiff("Xin chào .Hôm nay", "Xin chào. Hôm nay");
    const delta = computeCharDelta(diff.diffBefore, diff.diffAfter);
    assert.equal(delta.addedChars, 1);
    assert.equal(delta.deletedChars, 1);
  });

  it("CASE 7 — No change: Before == After detects +0 / -0 chars", () => {
    const diff = computeTokenDiff("Hello world", "Hello world");
    const delta = computeCharDelta(diff.diffBefore, diff.diffAfter);
    assert.equal(delta.addedChars, 0);
    assert.equal(delta.deletedChars, 0);
  });

  it("Integration: normalizeText populates addedChars and deletedChars in NormalizationResult", () => {
    const res = normalizeText("“VoxLab”", getDefaultEnabledGroupIds());
    assert.equal(res.hasChanges, true);
    assert.equal(res.addedChars, 0);
    assert.equal(res.deletedChars, 2);
  });

  it("Regression: removes excess whitespace around punctuation without false highlights on adjacent words", () => {
    const sample = 'Hôm nay   ngày 16/09/2026 , tôi nói: "VoxLab thật tuyệt vời..." !';
    const res = normalizeText(sample, getDefaultEnabledGroupIds());
    assert.equal(res.hasChanges, true);
    assert.equal(res.addedChars, 0);
    assert.equal(res.deletedChars, 8);

    // Verify word "tôi" is NOT in any non-equal diff token
    const nonEqualBefore = res.diffBefore.filter(t => t.type !== "equal");
    const nonEqualAfter = res.diffAfter.filter(t => t.type !== "equal");
    assert.ok(!nonEqualBefore.some(t => t.text.includes("tôi")), "Word 'tôi' must not be marked changed in Before");
    assert.ok(!nonEqualAfter.some(t => t.text.includes("tôi")), "Word 'tôi' must not be marked changed in After");
  });
});

describe("Safe Normalization - Section 14 Rule Independence Matrix", () => {
  it("Test A: Disabling 'whitespace' group preserves multiple spaces", () => {
    const res = normalizeText("Xin  chào", ["punctuation", "unicode"]);
    assert.equal(res.normalizedText, "Xin  chào");
    assert.equal(res.hasChanges, false);
  });

  it("Test B: Disabling 'punctuation' group preserves punctuation format errors", () => {
    const res = normalizeText("Xin chào .Hôm nay", ["whitespace", "unicode"]);
    assert.equal(res.normalizedText, "Xin chào .Hôm nay");
    assert.equal(res.hasChanges, false);
  });

  it("Test C: Disabling 'unicode' group preserves curly quotes", () => {
    const res = normalizeText("“VoxLab”", ["whitespace", "punctuation"]);
    assert.equal(res.normalizedText, "“VoxLab”");
    assert.equal(res.hasChanges, false);
  });

  it("Test D: Disabling 'unicode' group preserves invisible/zero-width characters", () => {
    const res = normalizeText("\u200BTest", ["whitespace", "punctuation"]);
    assert.equal(res.normalizedText, "\u200BTest");
    assert.equal(res.hasChanges, false);
  });

  it("Test E: Disabling 'unicode' group preserves # heading characters", () => {
    const res = normalizeText("# Heading", ["whitespace", "punctuation"]);
    assert.equal(res.normalizedText, "# Heading");
    assert.equal(res.hasChanges, false);
  });
});

describe("Voice Over Normalizer - Bullet/List Marker Handling", () => {
  const defaultGroups = getDefaultEnabledGroupIds();

  it("Test A: standard bullets (•) convert to comma-separated list with period at end", () => {
    const input = "• lower cost\n• lower weight\n• easier repair";
    const expected = "lower cost,\nlower weight,\neasier repair.";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, expected);
  });

  it("Test B: diamond bullets (◆) convert to comma-separated list with period at end", () => {
    const input = "◆ Battery systems\n◆ Motor systems\n◆ Charging systems";
    const expected = "Battery systems,\nMotor systems,\nCharging systems.";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, expected);
  });

  it("Test C: leading introductory clause before bullets is preserved untouched", () => {
    const input = "Benefits:\n• lower cost\n• lower weight\n• easier repair";
    const expected = "Benefits:\nlower cost,\nlower weight,\neasier repair.";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, expected);
  });

  it("Test D: pre-existing item punctuation is normalized without duplication", () => {
    const input = "• lower cost.\n• lower weight.\n• easier repair.";
    const expected = "lower cost,\nlower weight,\neasier repair.";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, expected);
  });

  it("Test E: standalone single-item bullet normalizes with period (no comma)", () => {
    const input = "• lower cost";
    const expected = "lower cost.";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, expected);
  });
});

describe("Voice Over Normalizer - Blank Line / Paragraph Break & List Interaction (Section 22)", () => {
  const defaultGroups = getDefaultEnabledGroupIds();

  it("TEST A: paragraph without period adds period and collapses blank line", () => {
    const input = "Tesla reduced the cost\n\nThe new platform uses fewer parts";
    const expected = "Tesla reduced the cost.\nThe new platform uses fewer parts";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, expected);
  });

  it("TEST B: paragraph already ending with period preserves period without duplication", () => {
    const input = "Tesla reduced the cost.\n\nThe new platform uses fewer parts.";
    const expected = "Tesla reduced the cost.\nThe new platform uses fewer parts.";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, expected);
  });

  it("TEST C: multiple blank lines collapsed to single newline boundary without duplicate periods", () => {
    const input = "Tesla reduced the cost\n\n\n\nThe new platform uses fewer parts";
    const expected = "Tesla reduced the cost.\nThe new platform uses fewer parts";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, expected);
  });

  it("TEST D: paragraph ending with question mark does not append period (?.)", () => {
    const input = "Is it cheaper?\n\nYes.";
    const expected = "Is it cheaper?\nYes.";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, expected);
  });

  it("TEST E: paragraph ending with exclamation mark does not append period (!.)", () => {
    const input = "This matters!\n\nThe next point follows.";
    const expected = "This matters!\nThe next point follows.";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, expected);
  });

  it("TEST F: list with introductory clause ending with colon preserves colon and normalizes bullets", () => {
    const input = "The benefits are:\n\n• lower cost\n\n• lower weight\n\n• easier repair";
    const expected = "The benefits are:\nlower cost,\nlower weight,\neasier repair.";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, expected);
  });

  it("TEST G: bullets with blank lines in-between maintain list flow with commas and period", () => {
    const input = "• lower cost\n\n• lower weight\n\n• easier repair";
    const expected = "lower cost,\nlower weight,\neasier repair.";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, expected);
  });

  it("TEST H: mixed bullet types with blank lines maintain list flow", () => {
    const input = "◆ Battery systems\n\n■ Motor systems\n\n● Charging systems";
    const expected = "Battery systems,\nMotor systems,\nCharging systems.";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, expected);
  });

  it("TEST I: list followed by ordinary paragraph with blank line ends list with period without duplicate", () => {
    const input = "• lower cost\n• lower weight\n• easier repair\n\nThe next issue is battery production.";
    const expected = "lower cost,\nlower weight,\neasier repair.\nThe next issue is battery production.";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, expected);
  });

  it("TEST J — IDEMPOTENCY: normalize(normalize(input)) === normalize(input) across all patterns", () => {
    const testCases = [
      "Tesla reduced the cost\n\nThe new platform uses fewer parts",
      "Tesla reduced the cost.\n\nThe new platform uses fewer parts.",
      "Tesla reduced the cost\n\n\n\nThe new platform uses fewer parts",
      "Is it cheaper?\n\nYes.",
      "This matters!\n\nThe next point follows.",
      "The benefits are:\n\n• lower cost\n\n• lower weight\n\n• easier repair",
      "• lower cost\n\n• lower weight\n\n• easier repair",
      "◆ Battery systems\n\n■ Motor systems\n\n● Charging systems",
      "• lower cost\n• lower weight\n• easier repair\n\nThe next issue is battery production.",
      "There are three reasons:\n\nFirst, cost matters.",
      "The reasons include,\n\nlower cost and lower weight.",
    ];

    for (const text of testCases) {
      const pass1 = normalizeText(text, defaultGroups).normalizedText;
      const pass2 = normalizeText(pass1, defaultGroups).normalizedText;
      assert.equal(pass2, pass1, `Idempotency violation for:\n${text}\nPass 1:\n${pass1}\nPass 2:\n${pass2}`);
    }
  });

  it("Section 15: paragraph after colon preserves colon without appending period (:.)", () => {
    const input = "There are three reasons:\n\nFirst, cost matters.";
    const expected = "There are three reasons:\nFirst, cost matters.";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, expected);
  });

  it("Section 16: paragraph after comma preserves comma without appending period (,.)", () => {
    const input = "The reasons include,\n\nlower cost and lower weight.";
    const expected = "The reasons include,\nlower cost and lower weight.";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, expected);
  });

  it("Section 7: blank lines containing spaces and tabs are properly collapsed", () => {
    const input = "Tesla reduced the cost\n   \n\t  \nThe new platform uses fewer parts";
    const expected = "Tesla reduced the cost.\nThe new platform uses fewer parts";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, expected);
  });

  it("Section 13: list items with pre-existing punctuation and blank lines do not duplicate punctuation", () => {
    const input = "• lower cost.\n\n• lower weight.\n\n• easier repair.";
    const expected = "lower cost,\nlower weight,\neasier repair.";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, expected);
  });
});

describe("Voice Over Normalizer - Final Logic Verification Pass (Sections 6-13, 27-29)", () => {
  const defaultGroups = getDefaultEnabledGroupIds();

  it("Section 6: dash-based list (- item) converts to comma-separated list with period at end", () => {
    const input = "- lower cost\n- lower weight\n- easier repair";
    const expected = "lower cost,\nlower weight,\neasier repair.";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, expected);
  });

  it("Section 6: en-dash and em-dash lists (– item, — item) convert to list pauses", () => {
    const inputEn = "– lower cost\n– lower weight\n– easier repair";
    const expected = "lower cost,\nlower weight,\neasier repair.";
    assert.equal(normalizeText(inputEn, defaultGroups).normalizedText, expected);

    const inputEm = "— lower cost\n— lower weight\n— easier repair";
    assert.equal(normalizeText(inputEm, defaultGroups).normalizedText, expected);
  });

  it("Section 7 & 36 (TEST 4): non-list dashes (ranges, hyphenated words, prose dashes) are NEVER treated as lists", () => {
    // Range
    const rangeInput = "10-15";
    const rangeRes = normalizeText(rangeInput, defaultGroups).normalizedText;
    assert.equal(rangeRes, "10-15");

    // Hyphenated word (lexical compound normalizes to space for TTS)
    const hyphenInput = "well-known";
    const hyphenRes = normalizeText(hyphenInput, defaultGroups).normalizedText;
    assert.equal(hyphenRes, "well known");

    // Prose dash
    const proseInput = "Tesla changed the design — engineers noticed immediately.";
    const proseRes = normalizeText(proseInput, defaultGroups).normalizedText;
    assert.equal(proseRes, "Tesla changed the design, engineers noticed immediately.");
  });

  it("Section 13: list items with semantic question mark or exclamation mark preserve their punctuation without duplicate comma", () => {
    const inputQ = "• Is it cheaper?\n• Does it weigh less?";
    const expectedQ = "Is it cheaper?\nDoes it weigh less?";
    const resQ = normalizeText(inputQ, defaultGroups);
    assert.equal(resQ.normalizedText, expectedQ);

    const inputEx = "• This matters!\n• This is crucial!";
    const expectedEx = "This matters!\nThis is crucial!";
    const resEx = normalizeText(inputEx, defaultGroups);
    assert.equal(resEx.normalizedText, expectedEx);
  });

  it("Section 10: list introduction ending with dash normalizes dash to colon separator", () => {
    const input = "The main benefits —\n• lower cost\n• lower weight";
    const expected = "The main benefits:\nlower cost,\nlower weight.";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, expected);
  });

  it("Section 11: inline list on a single line normalizes to comma-separated voice-over text", () => {
    const input = "Benefits: • lower cost • lower weight • easier repair";
    const expected = "Benefits: lower cost, lower weight, easier repair.";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, expected);
  });

  it("Section 29: content preservation verifies wording is strictly preserved without paraphrasing or rewriting", () => {
    const input = "Tesla reduced lower production cost.";
    const res = normalizeText(input, defaultGroups).normalizedText;
    assert.equal(res, "Tesla reduced lower production cost.");
    assert.ok(!res.includes("cheaper manufacturing"));
  });

  it("Section 31: Idempotency holds across all dash lists, inline lists, semantic marks, and prose dashes", () => {
    const samples = [
      "- lower cost\n- lower weight\n- easier repair",
      "– lower cost\n– lower weight\n– easier repair",
      "— lower cost\n— lower weight\n— easier repair",
      "The main benefits —\n• lower cost\n• lower weight",
      "Benefits: • lower cost • lower weight • easier repair",
      "• Is it cheaper?\n• Does it weigh less?",
      "• This matters!\n• This is crucial!",
      "10-15",
      "well-known",
      "Tesla changed the design — engineers noticed immediately.",
    ];

    for (const sample of samples) {
      const pass1 = normalizeText(sample, defaultGroups).normalizedText;
      const pass2 = normalizeText(pass1, defaultGroups).normalizedText;
      assert.equal(pass2, pass1, `Idempotency failed for: ${sample}`);
    }
  });
});

describe("Text Normalizer V1 - Final Implementation Pass Matrix", () => {
  it("Option 1: [newline without punctuation] Xin chào\\nCác bạn -> Xin chào. Các bạn", () => {
    const res = normalizeText("Xin  chào\nCác bạn", ["whitespace"]);
    assert.equal(res.normalizedText, "Xin chào. Các bạn");
  });

  it("Option 1: [newline after period] preserves punctuation without duplicate", () => {
    const res = normalizeText("Xin chào.\nCác bạn", ["whitespace"]);
    assert.equal(res.normalizedText, "Xin chào.\nCác bạn");
  });

  it("Option 1: [newline after !] preserves punctuation without duplicate", () => {
    const res = normalizeText("Xin chào!\nCác bạn", ["whitespace"]);
    assert.equal(res.normalizedText, "Xin chào!\nCác bạn");
  });

  it("Option 1: [newline after ?] preserves punctuation without duplicate", () => {
    const res = normalizeText("Bạn khỏe không?\nTôi rất khỏe.", ["whitespace"]);
    assert.equal(res.normalizedText, "Bạn khỏe không?\nTôi rất khỏe.");
  });

  it("Option 1: [multiple blank lines] collapses correctly to voice-over pause", () => {
    const res = normalizeText("Xin chào\n\n\nCác bạn", ["whitespace"]);
    assert.equal(res.normalizedText, "Xin chào.\nCác bạn");
  });

  it("Option 1: [whitespace-only blank lines] collapses correctly", () => {
    const res = normalizeText("Xin chào\n   \t  \nCác bạn", ["whitespace"]);
    assert.equal(res.normalizedText, "Xin chào.\nCác bạn");
  });

  it("Option 1: [list preservation] does not turn newlines between bullet items into period", () => {
    const input = "• lower cost\n• lower weight\n• easier repair";
    const res = normalizeText(input, ["whitespace"]);
    assert.equal(res.normalizedText, "• lower cost\n• lower weight\n• easier repair");
  });

  it("Option 2: [space before punctuation removed] Xin chào . -> Xin chào.", () => {
    const res = normalizeText("Xin chào .", ["punctuation"]);
    assert.equal(res.normalizedText, "Xin chào.");
  });

  it("Option 2: [space before comma removed] Hello , world -> Hello, world", () => {
    const res = normalizeText("Hello , world", ["punctuation"]);
    assert.equal(res.normalizedText, "Hello, world");
  });

  it("Option 2: [missing space after punctuation] Xin chào.Bạn khỏe không? -> Xin chào. Bạn khỏe không?", () => {
    const res = normalizeText("Xin chào.Bạn khỏe không?", ["punctuation"]);
    assert.equal(res.normalizedText, "Xin chào. Bạn khỏe không?");
  });

  it("Option 2: [capitalization after sentence boundary] chào .bạn -> chào. Bạn", () => {
    const res = normalizeText("chào .bạn", ["punctuation"]);
    assert.equal(res.normalizedText, "chào. Bạn");
  });

  it("Option 2: [no forced capitalization after colon] Tesla: the next generation preserved", () => {
    const res = normalizeText("Tesla: the next generation", ["punctuation"]);
    assert.equal(res.normalizedText, "Tesla: the next generation");
  });

  it("Option 2: [collapse repeated punctuation] Hay quá !!! -> Hay quá!", () => {
    const res = normalizeText("Hay quá !!!", ["punctuation"]);
    assert.equal(res.normalizedText, "Hay quá!");
  });

  it("Option 2: [collapse repeated punctuation] Really??? -> Really?", () => {
    const res = normalizeText("Really???", ["punctuation"]);
    assert.equal(res.normalizedText, "Really?");
  });

  it("Option 2: [collapse repeated punctuation] Hello... -> Hello.", () => {
    const res = normalizeText("Hello...", ["punctuation"]);
    assert.equal(res.normalizedText, "Hello.");
  });

  it("Option 2: [mixed punctuation preserved] Really?! and What!? preserved", () => {
    assert.equal(normalizeText("Really?!", ["punctuation"]).normalizedText, "Really?!");
    assert.equal(normalizeText("What!?", ["punctuation"]).normalizedText, "What!?");
  });

  it("Option 2: [decimal and technical protection] 1.2, 1.07, v1.2.3, Node.js, 127.0.0.1 preserved", () => {
    const input = "Use v1.2.3 on Node.js at 127.0.0.1 with 1.2 and 1.07 ratio.";
    const res = normalizeText(input, ["punctuation"]);
    assert.equal(res.normalizedText, input);
  });

  it("Option 3: [double quote removal] Tesla \"downgrading\" the Semi. -> Tesla downgrading the Semi.", () => {
    const res = normalizeText('Tesla "downgrading" the Semi.', ["unicode"]);
    assert.equal(res.normalizedText, "Tesla downgrading the Semi.");
  });

  it("Option 3: [quoted speech] Musk said: \"We are ready.\" -> Musk said: We are ready.", () => {
    const res = normalizeText('Musk said: "We are ready."', ["unicode"]);
    assert.equal(res.normalizedText, "Musk said: We are ready.");
  });

  it("Option 3: [single quote delimiter removal] He called it 'crazy'. -> He called it crazy.", () => {
    const res = normalizeText("He called it 'crazy'.", ["unicode"]);
    assert.equal(res.normalizedText, "He called it crazy.");
  });

  it("Option 3: [lexical apostrophe protection] we're, can't, Musk's, Tesla's, America's, grandchildren's", () => {
    const input = "We're sure Musk's vision can't stop Tesla's and America's grandchildren's future.";
    const res = normalizeText(input, ["unicode"]);
    assert.equal(res.normalizedText, input);
  });

  it("Option 3: [markdown header removal] ## INTRO -> INTRO", () => {
    const res = normalizeText("## INTRO", ["unicode"]);
    assert.equal(res.normalizedText, "INTRO");
  });

  it("Option 3: [bullet and list normalization] •, ◆, and dash lists", () => {
    const input = "• lower cost\n\n• lower weight\n\n• easier repair";
    const res = normalizeText(input, ["unicode"]);
    assert.equal(res.normalizedText, "lower cost,\nlower weight,\neasier repair.");
  });

  it("Option 3: [dash disambiguation] range 10-15 preserved, well-known -> well known, Shin-Etsu preserved", () => {
    const input = "Shin-Etsu is well-known for 10-15 components.";
    const res = normalizeText(input, ["unicode"]);
    assert.equal(res.normalizedText, "Shin-Etsu is well known for 10-15 components.");
  });

  it("Option 3: [semantic symbol protection when Option 4 is OFF] $119B, 13.5%, 1.2 MW, 20 km/h preserved", () => {
    const input = "The project costs $119B, consumes 1.2 MW at 20 km/h and grew 13.5%.";
    const res = normalizeText(input, ["unicode"]);
    assert.equal(res.normalizedText, input);
  });

  it("Option 4: [basic integer & thousands] 15,000 and 150,000", () => {
    assert.equal(normalizeText("15,000", ["numbers" as any]).normalizedText, "fifteen thousand");
    assert.equal(normalizeText("150,000", ["numbers" as any]).normalizedText, "one hundred fifty thousand");
  });

  it("Option 4: [decimals & zero preservation] 1.2 and 1.07", () => {
    assert.equal(normalizeText("1.2", ["numbers" as any]).normalizedText, "one point two");
    assert.equal(normalizeText("1.07", ["numbers" as any]).normalizedText, "one point zero seven");
  });

  it("Option 4: [percentage] 13.5%", () => {
    assert.equal(normalizeText("13.5%", ["numbers" as any]).normalizedText, "thirteen point five percent");
  });

  it("Option 4: [currency noun and attributive] costs $119B vs a $119B project", () => {
    assert.equal(
      normalizeText("The project costs $119B.", ["numbers" as any]).normalizedText,
      "The project costs one hundred and nineteen billion dollars."
    );
    assert.equal(
      normalizeText("a $119B project", ["numbers" as any]).normalizedText,
      "a one hundred and nineteen billion dollar project"
    );
  });

  it("Option 4: [unit noun and attributive] consumes 1.2 MW vs a 1.2 MW system", () => {
    assert.equal(
      normalizeText("The system consumes 1.2 MW.", ["numbers" as any]).normalizedText,
      "The system consumes one point two megawatts."
    );
    assert.equal(
      normalizeText("a 1.2 MW system", ["numbers" as any]).normalizedText,
      "a one point two megawatt system"
    );
  });

  it("Option 4: [compound unit] 20 km/h", () => {
    assert.equal(
      normalizeText("20 km/h", ["numbers" as any]).normalizedText,
      "twenty kilometers per hour"
    );
  });

  it("Option 4: [range] 10-15", () => {
    assert.equal(
      normalizeText("The range is 10-15 units.", ["numbers" as any]).normalizedText,
      "The range is ten to fifteen units."
    );
  });

  it("Option 4: [year] in 2021", () => {
    assert.equal(
      normalizeText("in 2021", ["numbers" as any]).normalizedText,
      "in twenty twenty one"
    );
  });

  it("Option 4: [model identifier & technical token safety] AI5, RTX-5090, v1.2.3, 1/2 preserved", () => {
    const input = "AI5 and RTX-5090 run v1.2.3 with ratio 1/2.";
    assert.equal(normalizeText(input, ["numbers" as any]).normalizedText, input);
  });

  it("Section J1: Mixed sample with Options 1+2+3 ON, Option 4 OFF", () => {
    const input = `## INTRO

Musk's answer is: "We're ready."

The project costs $119B.

• lower cost

• lower weight

• easier repair

The system consumes 1.2 MW.

Production increased by 13.5%.

The range is 10-15 units.

Shin-Etsu remains a supplier.`;

    const expected = `INTRO.

Musk's answer is: We're ready.

The project costs $119B.

lower cost,
lower weight,
easier repair.

The system consumes 1.2 MW.

Production increased by 13.5%.

The range is 10-15 units.

Shin-Etsu remains a supplier.`;

    const res = normalizeText(input, ["whitespace", "punctuation", "unicode"]);
    assert.equal(
      res.normalizedText.replace(/\r\n/g, "\n").replace(/\n+/g, "\n").trim(),
      expected.replace(/\r\n/g, "\n").replace(/\n+/g, "\n").trim()
    );
  });

  it("Section J2: Mixed sample with Options 1+2+3+4 ON", () => {
    const input = `## INTRO

Musk's answer is: "We're ready."

The project costs $119B.

• lower cost

• lower weight

• easier repair

The system consumes 1.2 MW.

Production increased by 13.5%.

The range is 10-15 units.

Shin-Etsu remains a supplier.`;

    const expected = `INTRO.

Musk's answer is: We're ready.

The project costs one hundred and nineteen billion dollars.

lower cost,
lower weight,
easier repair.

The system consumes one point two megawatts.

Production increased by thirteen point five percent.

The range is ten to fifteen units.

Shin-Etsu remains a supplier.`;

    const res = normalizeText(input, ["whitespace", "punctuation", "unicode", "numbers"]);
    assert.equal(
      res.normalizedText.replace(/\r\n/g, "\n").replace(/\n+/g, "\n").trim(),
      expected.replace(/\r\n/g, "\n").replace(/\n+/g, "\n").trim()
    );
  });
});

describe("Micro Fix Pass - Targeted Tests A through O", () => {
  it("TEST A — °C: 5°C -> five degrees Celsius", () => {
    const res = normalizeText("The temperature reached 5°C.", ["whitespace", "punctuation", "unicode", "numbers"]);
    assert.equal(res.normalizedText, "The temperature reached five degrees Celsius.");
  });

  it("TEST B — °F: 32°F -> thirty two degrees Fahrenheit", () => {
    const res = normalizeText("The temperature reached 32°F.", ["whitespace", "punctuation", "unicode", "numbers"]);
    assert.equal(res.normalizedText, "The temperature reached thirty two degrees Fahrenheit.");
  });

  it("TEST C — YEAR: In 2021 -> In twenty twenty one", () => {
    const res = normalizeText("In 2021 the company expanded.", ["whitespace", "punctuation", "unicode", "numbers"]);
    assert.equal(res.normalizedText, "In twenty twenty one the company expanded.");
  });

  it("TEST D — YEAR RANGE: From 2020 to 2021 -> From twenty twenty to twenty twenty one", () => {
    const res = normalizeText("From 2020 to 2021.", ["whitespace", "punctuation", "unicode", "numbers"]);
    assert.equal(res.normalizedText, "From twenty twenty to twenty twenty one.");
  });

  it("TEST E — PROSE EM DASH: em dash becomes comma pause in prose", () => {
    const res = normalizeText("Tesla — engineers noticed the change immediately.", ["whitespace", "punctuation", "unicode"]);
    assert.equal(res.normalizedText, "Tesla, engineers noticed the change immediately.");
  });

  it("TEST F — PARENTHETICAL PROSE DASH: parenthetical dashes become commas", () => {
    const res = normalizeText("The result — surprisingly — was positive.", ["whitespace", "punctuation", "unicode"]);
    assert.equal(res.normalizedText, "The result, surprisingly, was positive.");
  });

  it("TEST G — DASH LIST REGRESSION: - lower cost remains list", () => {
    const input = "- lower cost\n- lower weight\n- easier repair";
    const expected = "lower cost,\nlower weight,\neasier repair.";
    const res = normalizeText(input, ["whitespace", "punctuation", "unicode"]);
    assert.equal(res.normalizedText, expected);
  });

  it("TEST H — RANGE REGRESSION: 10-15 -> ten to fifteen when Option 4 ON", () => {
    const res = normalizeText("The range is 10-15 units.", ["whitespace", "punctuation", "unicode", "numbers"]);
    assert.equal(res.normalizedText, "The range is ten to fifteen units.");
  });

  it("TEST I — PROPER NAME REGRESSION: Shin-Etsu remains unchanged", () => {
    const res = normalizeText("Shin-Etsu remains a supplier.", ["whitespace", "punctuation", "unicode", "numbers"]);
    assert.equal(res.normalizedText, "Shin-Etsu remains a supplier.");
  });

  it("TEST J — SINGLE NEWLINE CONTINUATION: Thank you\\nfor testing. -> Thank you for testing.", () => {
    const res = normalizeText("Thank you\nfor testing.", ["whitespace"]);
    assert.equal(res.normalizedText, "Thank you for testing.");
  });

  it("TEST K — LINE WRAP CONTINUATION: The system is designed\\nto reduce production costs.", () => {
    const input = "The system is designed\nto reduce production costs.";
    const expected = "The system is designed to reduce production costs.";
    const res = normalizeText(input, ["whitespace"]);
    assert.equal(res.normalizedText, expected);
  });

  it("TEST L — CLEAR SENTENCE NEWLINE: Xin chào\\nCác bạn -> Xin chào. Các bạn", () => {
    const res = normalizeText("Xin chào\nCác bạn", ["whitespace"]);
    assert.equal(res.normalizedText, "Xin chào. Các bạn");
  });

  it("TEST M — BLANK PARAGRAPH: First paragraph\n\nSecond paragraph", () => {
    const res = normalizeText("First paragraph\n\nSecond paragraph", ["whitespace"]);
    assert.equal(res.normalizedText, "First paragraph.\nSecond paragraph");
  });

  it("TEST N — LIST + BLANK LINES: • lower cost\\n\\n• lower weight\\n\\n• easier repair", () => {
    const input = "• lower cost\n\n• lower weight\n\n• easier repair";
    const expected = "lower cost,\nlower weight,\neasier repair.";
    const res = normalizeText(input, ["whitespace", "punctuation", "unicode"]);
    assert.equal(res.normalizedText, expected);
  });

  it("TEST O — IDEMPOTENCY: normalize(normalize(input)) === normalize(input) for all new cases", () => {
    const testCases = [
      "The temperature reached 5°C.",
      "The temperature reached 32°F.",
      "In 2021 the company expanded.",
      "From 2020 to 2021.",
      "Tesla — engineers noticed the change immediately.",
      "The result — surprisingly — was positive.",
      "- lower cost\n- lower weight\n- easier repair",
      "Thank you\nfor testing.",
      "The system is designed\nto reduce production costs.",
      "Xin chào\nCác bạn",
      "First paragraph\n\nSecond paragraph",
      "• lower cost\n\n• lower weight\n\n• easier repair",
    ];

    const allGroups: NormalizerGroupId[] = ["whitespace", "punctuation", "unicode", "numbers"];
    for (const sample of testCases) {
      const pass1 = normalizeText(sample, allGroups).normalizedText;
      const pass2 = normalizeText(pass1, allGroups).normalizedText;
      assert.equal(pass2, pass1, `Idempotency failed for: ${sample}`);
    }
  });
});

describe("Structural Separator Normalization (S1 - S16)", () => {
  const defaultGroups: NormalizerGroupId[] = ["whitespace", "punctuation", "unicode"];

  it("S1: First section\\n---\\nSecond section -> First section.\\nSecond section", () => {
    const input = "First section\n---\nSecond section";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, "First section.\nSecond section");
  });

  it("S2: First section.\\n---\\nSecond section. -> no duplicate period", () => {
    const input = "First section.\n---\nSecond section.";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, "First section.\nSecond section.");
  });

  it("S3: First section\\n__________\\nSecond section -> separator removed + paragraph boundary", () => {
    const input = "First section\n__________\nSecond section";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, "First section.\nSecond section");
  });

  it("S4: First section\\n***\\nSecond section -> separator removed + paragraph boundary", () => {
    const input = "First section\n***\nSecond section";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, "First section.\nSecond section");
  });

  it("S5: First section\\n===\\nSecond section -> separator removed + paragraph boundary", () => {
    const input = "First section\n===\nSecond section";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, "First section.\nSecond section");
  });

  it("S6: First section\\n~~~~\\nSecond section -> separator removed + paragraph boundary", () => {
    const input = "First section\n~~~~\nSecond section";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, "First section.\nSecond section");
  });

  it("S7: separator at start of document -> deleted without leading dot", () => {
    const input = "---\nHello world.";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, "Hello world.");
  });

  it("S8: separator at end of document -> deleted without trailing dot/cruft", () => {
    const input = "Hello world.\n---";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, "Hello world.");
  });

  it("S9: multiple consecutive separators -> ONE paragraph boundary", () => {
    const input = "First section\n---\n______\n***\nSecond section";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, "First section.\nSecond section");
  });

  it("S10: bullet list behavior preserved untouched", () => {
    const input = "- lower cost\n- lower weight\n- easier repair";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, "lower cost,\nlower weight,\neasier repair.");
  });

  it("S11: numeric range 10-15 preserved", () => {
    const res = normalizeText("10-15", ["whitespace", "punctuation", "unicode"]);
    assert.equal(res.normalizedText, "10-15");
  });

  it("S12: well-known lexical compound normalizes to well known for TTS", () => {
    const res = normalizeText("well-known", defaultGroups);
    assert.equal(res.normalizedText, "well known");
  });

  it("S13: Shin-Etsu proper name preserved", () => {
    const res = normalizeText("Shin-Etsu", defaultGroups);
    assert.equal(res.normalizedText, "Shin-Etsu");
  });

  it("S14: RTX-5090 technical token preserved", () => {
    const res = normalizeText("RTX-5090", defaultGroups);
    assert.equal(res.normalizedText, "RTX-5090");
  });

  it("S15: Tesla — engineers noticed the change immediately. remains prose dash comma", () => {
    const input = "Tesla — engineers noticed the change immediately.";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, "Tesla, engineers noticed the change immediately.");
  });

  it("S16: Idempotency holds across all separator patterns", () => {
    const testCases = [
      "First section\n---\nSecond section",
      "First section.\n---\nSecond section.",
      "First section\n__________\nSecond section",
      "First section\n***\nSecond section",
      "First section\n===\nSecond section",
      "First section\n~~~~\nSecond section",
      "---\nHello world.",
      "Hello world.\n---",
      "First section\n---\n______\n***\nSecond section",
      "Really?\n---\nNext section.",
      "Amazing!\n---\nNext section.",
      "Section A\n- - -\nSection B",
      "Section A\n* * *\nSection B",
      "Section A\n_ _ _\nSection B",
    ];

    for (const sample of testCases) {
      const pass1 = normalizeText(sample, defaultGroups).normalizedText;
      const pass2 = normalizeText(pass1, defaultGroups).normalizedText;
      assert.equal(pass2, pass1, `Idempotency failed for: ${sample}`);
    }
  });

  it("Option 3 OFF does not apply separator normalization", () => {
    const input = "First section.\n\n---\n\nSecond section.";
    const res = normalizeText(input, ["whitespace", "punctuation"]); // Option 3 omitted
    assert.match(res.normalizedText, /---/);
  });

  it("ACTUAL script pattern from user report", () => {
    const input =
      "For seven years, every time Tesla showed off the Semi, the same comment showed up underneath the video.\n\n---\n\nFor years, this truck lived in an uncomfortable middle ground.";
    const expected =
      "For seven years, every time Tesla showed off the Semi, the same comment showed up underneath the video.\nFor years, this truck lived in an uncomfortable middle ground.";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, expected);
    assert.doesNotMatch(res.normalizedText, /---/);
    assert.doesNotMatch(res.normalizedText, /___/);
    assert.doesNotMatch(res.normalizedText, /\*\*\*/);
  });

  it("Preserves question mark and exclamation mark before separator", () => {
    assert.equal(
      normalizeText("Really?\n---\nNext section.", defaultGroups).normalizedText,
      "Really?\nNext section."
    );
    assert.equal(
      normalizeText("Amazing!\n---\nNext section.", defaultGroups).normalizedText,
      "Amazing!\nNext section."
    );
  });

  it("Supports spaced separators: - - -, * * *, _ _ _", () => {
    assert.equal(
      normalizeText("First section\n- - -\nSecond section", defaultGroups).normalizedText,
      "First section.\nSecond section"
    );
    assert.equal(
      normalizeText("First section\n* * *\nSecond section", defaultGroups).normalizedText,
      "First section.\nSecond section"
    );
    assert.equal(
      normalizeText("First section\n_ _ _\nSecond section", defaultGroups).normalizedText,
      "First section.\nSecond section"
    );
  });
});

describe("Lexical Hyphen Normalization (H1 - H17)", () => {
  const defaultGroups: NormalizerGroupId[] = ["whitespace", "punctuation", "unicode"];

  it("H1: low-margin -> low margin", () => {
    const res = normalizeText("low-margin", defaultGroups);
    assert.equal(res.normalizedText, "low margin");
  });

  it("H2: metal-bending -> metal bending", () => {
    const res = normalizeText("metal-bending", defaultGroups);
    assert.equal(res.normalizedText, "metal bending");
  });

  it("H3: twenty-five-thousand-dollar -> twenty five thousand dollar", () => {
    const res = normalizeText("twenty-five-thousand-dollar", defaultGroups);
    assert.equal(res.normalizedText, "twenty five thousand dollar");
  });

  it("H4: state-backed -> state backed", () => {
    const res = normalizeText("state-backed", defaultGroups);
    assert.equal(res.normalizedText, "state backed");
  });

  it("H5: full-blown -> full blown", () => {
    const res = normalizeText("full-blown", defaultGroups);
    assert.equal(res.normalizedText, "full blown");
  });

  it("H6: twenty-cent-per-mile -> twenty cent per mile", () => {
    const res = normalizeText("twenty-cent-per-mile", defaultGroups);
    assert.equal(res.normalizedText, "twenty cent per mile");
  });

  it("H7: thirty-five-dollar-per-kilowatt-hour -> thirty five dollar per kilowatt hour", () => {
    const res = normalizeText("thirty-five-dollar-per-kilowatt-hour", defaultGroups);
    assert.equal(res.normalizedText, "thirty five dollar per kilowatt hour");
  });

  it("H8: 10-15 preserves range behavior", () => {
    const res = normalizeText("10-15", defaultGroups);
    assert.equal(res.normalizedText, "10-15");
    const withNumbers = normalizeText("10-15", ["whitespace", "punctuation", "unicode", "numbers"]);
    assert.equal(withNumbers.normalizedText, "ten to fifteen");
  });

  it("H9: negative number -5, -10°C, -3.5 preserved", () => {
    const res = normalizeText("Temperature is -5 and -10°C, diff -3.5.", defaultGroups);
    assert.match(res.normalizedText, /-5/);
    assert.match(res.normalizedText, /-10°C/);
    assert.match(res.normalizedText, /-3.5/);
  });

  it("H10: RTX-5090 technical token unchanged", () => {
    const res = normalizeText("RTX-5090", defaultGroups);
    assert.equal(res.normalizedText, "RTX-5090");
  });

  it("H11: X-1 technical token unchanged", () => {
    const res = normalizeText("X-1", defaultGroups);
    assert.equal(res.normalizedText, "X-1");
  });

  it("H12: Shin-Etsu proper name unchanged", () => {
    const res = normalizeText("Shin-Etsu", defaultGroups);
    assert.equal(res.normalizedText, "Shin-Etsu");
  });

  it("H13: Mercedes-Benz proper name unchanged", () => {
    const res = normalizeText("Mercedes-Benz", defaultGroups);
    assert.equal(res.normalizedText, "Mercedes-Benz");
  });

  it("H14: - lower cost bullet list unchanged", () => {
    const input = "- lower cost\n- lower weight";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, "lower cost,\nlower weight.");
  });

  it("H15: standalone separator --- remains paragraph boundary", () => {
    const input = "First section.\n---\nSecond section.";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, "First section.\nSecond section.");
  });

  it("H16: Tesla — engineers noticed the change. prose dash unchanged", () => {
    const input = "Tesla — engineers noticed the change.";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, "Tesla, engineers noticed the change.");
  });

  it("H17: Idempotency holds across all lexical hyphen cases", () => {
    const samples = [
      "low-margin",
      "metal-bending",
      "twenty-five-thousand-dollar",
      "state-backed",
      "full-blown",
      "twenty-cent-per-mile",
      "thirty-five-dollar-per-kilowatt-hour",
      "high-strength steel",
      "battery-electric vehicle",
      "real-world testing",
      "cost-effective solution",
    ];
    for (const sample of samples) {
      const pass1 = normalizeText(sample, defaultGroups).normalizedText;
      const pass2 = normalizeText(pass1, defaultGroups).normalizedText;
      assert.equal(pass2, pass1, `Idempotency failed for: ${sample}`);
    }
  });

  it("Real script case A: competing in low-margin metal-bending against China's state-backed supply chain", () => {
    const input = "competing in low-margin metal-bending against China's state-backed supply chain";
    const expected = "competing in low margin metal bending against China's state backed supply chain";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, expected);
  });

  it("Real script case B: Musk killed the twenty-five-thousand-dollar Model 2.", () => {
    const input = "Musk killed the twenty-five-thousand-dollar Model 2.";
    const expected = "Musk killed the twenty five thousand dollar Model 2.";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, expected);
  });

  it("Real script case C: a one-hundred-percent tariff", () => {
    const input = "a one-hundred-percent tariff";
    const expected = "a one hundred percent tariff";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, expected);
  });

  it("Real script case D: twenty-cent-per-mile Cybercabs", () => {
    const input = "twenty-cent-per-mile Cybercabs";
    const expected = "twenty cent per mile Cybercabs";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, expected);
  });

  it("Real script case E: thirty-five-dollar-per-kilowatt-hour advanced manufacturing production credit", () => {
    const input = "thirty-five-dollar-per-kilowatt-hour advanced manufacturing production credit";
    const expected = "thirty five dollar per kilowatt hour advanced manufacturing production credit";
    const res = normalizeText(input, defaultGroups);
    assert.equal(res.normalizedText, expected);
  });

  it("Option 3 OFF does not normalize lexical hyphens", () => {
    const input = "low-margin metal-bending";
    const res = normalizeText(input, ["whitespace", "punctuation"]); // Option 3 omitted
    assert.equal(res.normalizedText, "low-margin metal-bending");
  });
});

