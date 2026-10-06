import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseDialogueScript,
  detectDialogueScript,
  normalizeCharacterId,
  stripStageDirections,
  guessGenderFromName,
} from "../parser";
import { SAMPLE_VIETNAMESE_DIALOGUE } from "../sampleScripts";

describe("Smart Dialogue Parser Suite", () => {
  it("normalizes character ID correctly", () => {
    assert.equal(normalizeCharacterId("Nam"), "nam");
    assert.equal(normalizeCharacterId("Người dẫn chuyện"), "người_dẫn_chuyện");
    assert.equal(normalizeCharacterId("  Vy  "), "vy");
  });

  it("strips stage directions and emotional cues", () => {
    assert.equal(stripStageDirections("Xin chào (vui vẻ)!"), "Xin chào!");
    assert.equal(stripStageDirections("(thì thầm) Cậu nghe rõ không?"), "Cậu nghe rõ không?");
    assert.equal(stripStageDirections("Haha! [cười lớn]"), "Haha!");
  });

  it("parses sample Vietnamese dialogue accurately", () => {
    const result = parseDialogueScript(SAMPLE_VIETNAMESE_DIALOGUE);
    assert.equal(result.characters.length, 3);
    assert.equal(result.characters[0].name, "Nam");
    assert.equal(result.characters[1].name, "Vy");
    assert.equal(result.characters[2].name, "Lan");

    assert.equal(result.characters[0].segmentCount, 2);
    assert.equal(result.characters[1].segmentCount, 2);
    assert.equal(result.characters[2].segmentCount, 1);

    assert.equal(result.segments.length, 5);
    assert.equal(result.segments[0].characterName, "Nam");
    assert.equal(result.segments[1].characterName, "Vy");
    assert.equal(result.segments[4].characterName, "Lan");
  });

  it("preserves existing character voiceId and settings when re-parsing", () => {
    const initial = parseDialogueScript(SAMPLE_VIETNAMESE_DIALOGUE);
    initial.characters[0].voiceId = "voice_nam_khanh";
    initial.characters[0].speed = 1.1;

    const updatedScript = `${SAMPLE_VIETNAMESE_DIALOGUE}\n[Nam]: Cảm ơn các bạn đã lắng nghe.`;
    const reParsed = parseDialogueScript(updatedScript, initial.characters);

    const nam = reParsed.characters.find((c) => c.id === "nam");
    assert.ok(nam);
    assert.equal(nam.voiceId, "voice_nam_khanh");
    assert.equal(nam.speed, 1.1);
    assert.equal(nam.segmentCount, 3);
  });

  it("guesses gender from character name", () => {
    assert.equal(guessGenderFromName("Nam"), "male");
    assert.equal(guessGenderFromName("Anh Ba"), "male");
    assert.equal(guessGenderFromName("Bố"), "male");
    assert.equal(guessGenderFromName("Vy"), "female");
    assert.equal(guessGenderFromName("Cô Lan"), "female");
    assert.equal(guessGenderFromName("Mẹ"), "female");
    assert.equal(guessGenderFromName("Robot 01"), null);
  });

  it("initializes character speed with default 1.0 and volume/pitch at 1.0", () => {
    const result = parseDialogueScript("[Minh]: Xin chào!");
    assert.equal(result.characters[0].speed, 1.0);
    assert.equal(result.characters[0].pitch, 1.0);
    assert.equal(result.characters[0].volume, 1.0);
  });

  describe("detectDialogueScript classification", () => {
    it("classifies bracketed dialogue scripts with high confidence", () => {
      const script = `[Nam]: Xin chào Lan.\n[Lan]: Chào Nam.\n[Người dẫn chuyện]: Câu chuyện bắt đầu.`;
      const detected = detectDialogueScript(script);
      assert.equal(detected.isDialogue, true);
      assert.equal(detected.confidence, "high");
      assert.equal(detected.characterCount, 3);
    });

    it("classifies plain text as normal text (not dialogue)", () => {
      const plainText = "Hôm nay thời tiết rất đẹp. Chúng tôi đi dạo công viên và đọc sách.";
      const detected = detectDialogueScript(plainText);
      assert.equal(detected.isDialogue, false);
      assert.equal(detected.confidence, "none");
    });

    it("does not classify isolated headers or notes as dialogue", () => {
      const noteText = "Lưu ý: Mọi người cần kiểm tra kỹ thông tin trước khi gửi biểu mẫu.\nSau đó nộp lại cho ban quản lý.";
      const detected = detectDialogueScript(noteText);
      assert.equal(detected.isDialogue, false);
    });

    it("flags ambiguous colon lines with warning", () => {
      const ambiguous = "Bác Ba: Hãy nhớ lời dặn.";
      const detected = detectDialogueScript(ambiguous);
      assert.equal(detected.isDialogue, false);
      assert.equal(detected.confidence, "ambiguous");
      assert.ok(detected.warning);
    });
  });
});
