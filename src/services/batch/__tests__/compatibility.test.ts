import test from "node:test";
import assert from "node:assert/strict";
import {
  detectFileKind,
  checkTaskCompatibility,
  getFileCompatibilityReport,
  validateTaskSelection,
} from "../compatibilityDetector";
import { validateDialogueScript } from "../dialogueValidator";

test("TASK-02: Compatibility Detector & Dialogue Contract Validator Suite", async (t) => {
  await t.test("File kind detection identifies extensions accurately", () => {
    // Text
    assert.equal(detectFileKind("document.txt"), "text");
    assert.equal(detectFileKind("report.DOCX"), "text");

    // Media
    assert.equal(detectFileKind("video.mp4"), "media");
    assert.equal(detectFileKind("movie.mkv"), "media");
    assert.equal(detectFileKind("clip.avi"), "media");
    assert.equal(detectFileKind("footage.mov"), "media");
    assert.equal(detectFileKind("audio.mp3"), "media");
    assert.equal(detectFileKind("recording.wav"), "media");
    assert.equal(detectFileKind("voice.m4a"), "media");
    assert.equal(detectFileKind("music.flac"), "media");

    // Subtitle
    assert.equal(detectFileKind("subs.srt"), "subtitle");
    assert.equal(detectFileKind("captions.VTT"), "subtitle");

    // Unsupported
    assert.equal(detectFileKind("archive.zip"), null);
    assert.equal(detectFileKind("image.png"), null);
    assert.equal(detectFileKind("script.py"), null);
  });

  await t.test("Dialogue contract validator distinguishes dialogue vs normal text", () => {
    // Empty text
    const emptyRes = validateDialogueScript("   \n\t ");
    assert.equal(emptyRes.isDialogueScript, false);

    // Normal prose text
    const normalText = `
      Ngày xửa ngày xưa, ở một ngôi làng nọ có hai vợ chồng nghèo sinh sống.
      Họ luôn chăm chỉ làm ăn và giúp đỡ mọi người xung quanh.
    `;
    const normalRes = validateDialogueScript(normalText);
    assert.equal(normalRes.isDialogueScript, false);

    // Valid bracketed dialogue script
    const bracketedScript = `
      [Nam]: Chào Lan, hôm nay cậu có rảnh không?
      [Lan]: Chào Nam! Chiều nay mình rảnh sau 3 giờ đấy.
      [Người dẫn chuyện]: Cả hai cùng nhau đi dạo bên bờ hồ.
    `;
    const bracketedRes = validateDialogueScript(bracketedScript);
    assert.equal(bracketedRes.isDialogueScript, true);
    assert.equal(bracketedRes.characterCount, 3);
    assert.ok(bracketedRes.characterNames.includes("Nam"));
    assert.ok(bracketedRes.characterNames.includes("Lan"));

    // Valid unbracketed dialogue script
    const unbracketedScript = `
      Thầy giáo: Các em mở sách trang 45 ra nhé.
      Học sinh: Thưa thầy, hôm nay kiểm tra bài cũ ạ?
    `;
    const unbracketedRes = validateDialogueScript(unbracketedScript);
    assert.equal(unbracketedRes.isDialogueScript, true);
    assert.equal(unbracketedRes.characterCount, 2);
  });

  await t.test("Media pipeline locks TTS and Dialogue, allows Transcription, Translation, Dubbing", () => {
    const report = getFileCompatibilityReport("interview.mp4");
    assert.equal(report.fileKind, "media");
    assert.equal(report.isCompatible, true);

    assert.equal(report.tasks.tts.isCompatible, false);
    assert.equal(report.tasks.dialogue.isCompatible, false);
    assert.equal(report.tasks.transcription.isCompatible, true);
    assert.equal(report.tasks.translation.isCompatible, true);
    assert.equal(report.tasks.dubbing.isCompatible, true);
  });

  await t.test("Subtitle pipeline locks TTS, Dialogue, Transcription, allows Translation, Dubbing", () => {
    const report = getFileCompatibilityReport("subtitles.srt");
    assert.equal(report.fileKind, "subtitle");
    assert.equal(report.isCompatible, true);

    assert.equal(report.tasks.tts.isCompatible, false);
    assert.equal(report.tasks.dialogue.isCompatible, false);
    assert.equal(report.tasks.transcription.isCompatible, false);
    assert.equal(report.tasks.translation.isCompatible, true);
    assert.equal(report.tasks.dubbing.isCompatible, true);
  });

  await t.test("Normal text locks Dialogue, allows TTS, Subtitles (from audio timing), Translation, Dubbing", () => {
    const report = getFileCompatibilityReport("article.txt", false);
    assert.equal(report.fileKind, "text");
    assert.equal(report.isDialogueScript, false);

    assert.equal(report.tasks.tts.isCompatible, true);
    assert.equal(report.tasks.dialogue.isCompatible, false);
    assert.equal(report.tasks.transcription.isCompatible, true);
    assert.equal(report.tasks.translation.isCompatible, true);
    assert.equal(report.tasks.dubbing.isCompatible, true);
  });

  await t.test("Dialogue script text locks TTS, allows Dialogue, Subtitles (from audio timing), Translation, Dubbing", () => {
    const report = getFileCompatibilityReport("script.txt", true);
    assert.equal(report.fileKind, "text");
    assert.equal(report.isDialogueScript, true);

    assert.equal(report.tasks.tts.isCompatible, false);
    assert.equal(report.tasks.dialogue.isCompatible, true);
    assert.equal(report.tasks.transcription.isCompatible, true);
    assert.equal(report.tasks.translation.isCompatible, true);
    assert.equal(report.tasks.dubbing.isCompatible, true);
  });


  await t.test("Mutual exclusion rejects selecting both TTS and Dialogue", () => {
    const validation = validateTaskSelection(["tts", "dialogue"], "text", false);
    assert.equal(validation.isValid, false);
    assert.ok(validation.error?.includes("Không thể chọn đồng thời TTS và Hội thoại"));
  });

  await t.test("checkTaskCompatibility returns detailed reasons for incompatible tasks", () => {
    const res = checkTaskCompatibility("media", "tts");
    assert.equal(res.isCompatible, false);
    assert.ok(res.reason?.includes("không hỗ trợ"));

    const textDialogueRes = checkTaskCompatibility("text", "dialogue", false);
    assert.equal(textDialogueRes.isCompatible, false);
    assert.ok(textDialogueRes.reason?.includes("chưa có định dạng phân vai"));
  });

  await t.test("Validation rejects empty tasks and incompatible tasks", () => {
    // Empty
    const emptyCheck = validateTaskSelection([], "media");
    assert.equal(emptyCheck.isValid, false);

    // Media selecting TTS
    const mediaTts = validateTaskSelection(["tts"], "media");
    assert.equal(mediaTts.isValid, false);
    assert.ok(mediaTts.error?.includes("tts"));

    // Subtitle selecting ASR
    const subAsr = validateTaskSelection(["transcription"], "subtitle");
    assert.equal(subAsr.isValid, false);

    // Valid Media selection
    const mediaValid = validateTaskSelection(["transcription", "translation", "dubbing"], "media");
    assert.equal(mediaValid.isValid, true);
  });
});
