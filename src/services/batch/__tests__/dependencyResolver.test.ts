import test from "node:test";
import assert from "node:assert/strict";
import {
  resolvePrerequisites,
  computeExecutionSequence,
  canUncheckTask,
  cascadeDeselect,
  shouldSkipTranslation,
} from "../dependencyResolver";

test("TASK-03: Dependency Resolver & Execution Sequence Suite", async (t) => {
  await t.test("Media + Translation auto-enables Transcription (AC-05)", () => {
    const res = resolvePrerequisites(["translation"], "media");
    assert.deepEqual(res.resolvedTasks, ["transcription", "translation"]);
    assert.ok(res.autoEnabledTasks.includes("transcription"));
    assert.ok(res.noticeMessages.some((msg) => msg.includes("tự động bật Phụ đề")));
  });

  await t.test("Media + Dubbing auto-enables Transcription & Translation when languages differ (AC-05)", () => {
    const res = resolvePrerequisites(["dubbing"], "media", false, "en", "vi");
    assert.deepEqual(res.resolvedTasks, ["transcription", "translation", "dubbing"]);
    assert.ok(res.autoEnabledTasks.includes("transcription"));
    assert.ok(res.autoEnabledTasks.includes("translation"));
  });

  await t.test("Media + Dubbing with identical languages does NOT enable Translation (AC-08)", () => {
    const res = resolvePrerequisites(["dubbing"], "media", false, "vi", "vi");
    assert.deepEqual(res.resolvedTasks, ["transcription", "dubbing"]);
    assert.ok(res.autoEnabledTasks.includes("transcription"));
    assert.ok(!res.autoEnabledTasks.includes("translation"));
  });

  await t.test("Normal text + Translation auto-enables TTS and Subtitles (transcription)", () => {
    const res = resolvePrerequisites(["translation"], "text", false);
    assert.deepEqual(res.resolvedTasks, ["tts", "transcription", "translation"]);
    assert.ok(res.autoEnabledTasks.includes("tts"));
    assert.ok(res.autoEnabledTasks.includes("transcription"));
    assert.ok(res.noticeMessages.some((msg) => msg.includes("tự động bật TTS")));
    assert.ok(res.noticeMessages.some((msg) => msg.includes("tự động bật Phụ đề")));
  });

  await t.test("Normal text + Dubbing auto-enables TTS -> Subtitles -> Translation -> Dubbing chain", () => {
    const res = resolvePrerequisites(["dubbing"], "text", false, "en", "vi");
    assert.deepEqual(res.resolvedTasks, ["tts", "transcription", "translation", "dubbing"]);
    assert.ok(res.autoEnabledTasks.includes("tts"));
    assert.ok(res.autoEnabledTasks.includes("transcription"));
    assert.ok(res.autoEnabledTasks.includes("translation"));
  });

  await t.test("Dialogue script text + Translation auto-enables Dialogue and Subtitles, NOT TTS", () => {
    const res = resolvePrerequisites(["translation"], "text", true);
    assert.deepEqual(res.resolvedTasks, ["dialogue", "transcription", "translation"]);
    assert.ok(res.autoEnabledTasks.includes("dialogue"));
    assert.ok(res.autoEnabledTasks.includes("transcription"));
    assert.ok(!res.autoEnabledTasks.includes("tts"));
    assert.ok(res.noticeMessages.some((msg) => msg.includes("tự động bật Hội thoại")));
    assert.ok(res.noticeMessages.some((msg) => msg.includes("tự động bật Phụ đề")));
  });

  await t.test("Dialogue script text + Dubbing auto-enables Dialogue -> Subtitles -> Translation -> Dubbing chain", () => {
    const res = resolvePrerequisites(["dubbing"], "text", true, "en", "vi");
    assert.deepEqual(res.resolvedTasks, ["dialogue", "transcription", "translation", "dubbing"]);
    assert.ok(res.autoEnabledTasks.includes("dialogue"));
    assert.ok(res.autoEnabledTasks.includes("transcription"));
    assert.ok(res.autoEnabledTasks.includes("translation"));
    assert.ok(!res.autoEnabledTasks.includes("tts"));
  });

  await t.test("Subtitle + Dubbing auto-enables Translation when languages differ", () => {
    const res = resolvePrerequisites(["dubbing"], "subtitle", false, "en", "vi");
    assert.deepEqual(res.resolvedTasks, ["translation", "dubbing"]);
    assert.ok(res.autoEnabledTasks.includes("translation"));
  });

  await t.test("computeExecutionSequence maintains DAG ordering across file kinds", () => {
    // Text: tts/dialogue -> transcription -> translation -> dubbing
    assert.deepEqual(
      computeExecutionSequence(["dubbing", "tts", "transcription", "translation"], "text"),
      ["tts", "transcription", "translation", "dubbing"]
    );

    // Media: transcription -> translation -> dubbing
    assert.deepEqual(
      computeExecutionSequence(["dubbing", "transcription", "translation"], "media"),
      ["transcription", "translation", "dubbing"]
    );

    // Subtitle: translation -> dubbing
    assert.deepEqual(
      computeExecutionSequence(["dubbing", "translation"], "subtitle"),
      ["translation", "dubbing"]
    );
  });

  await t.test("canUncheckTask prevents turning off prerequisite steps", () => {
    // Media: cannot uncheck transcription if translation is active
    const check1 = canUncheckTask("transcription", ["transcription", "translation"], "media");
    assert.equal(check1.canUncheck, false);
    assert.ok(check1.reason?.includes("Không thể tắt Phụ đề"));

    // Media: can uncheck translation if dubbing is not active
    const check2 = canUncheckTask("translation", ["transcription", "translation"], "media");
    assert.equal(check2.canUncheck, true);

    // Text: cannot uncheck TTS if translation or transcription is active
    const check3 = canUncheckTask("tts", ["tts", "translation"], "text");
    assert.equal(check3.canUncheck, false);
    assert.ok(check3.reason?.includes("Không thể tắt TTS"));

    const checkTextSub = canUncheckTask("tts", ["tts", "transcription"], "text");
    assert.equal(checkTextSub.canUncheck, false);

    const checkTextTrans = canUncheckTask("transcription", ["tts", "transcription", "translation"], "text");
    assert.equal(checkTextTrans.canUncheck, false);
    assert.ok(checkTextTrans.reason?.includes("Không thể tắt Phụ đề"));
  });

  await t.test("cascadeDeselect unchecks downstream dependent tasks", () => {
    // Media: unchecking transcription deselects translation and dubbing
    const remaining = cascadeDeselect(
      "transcription",
      ["transcription", "translation", "dubbing"],
      "media"
    );
    assert.deepEqual(remaining, []);

    // Text: unchecking translation deselects dubbing
    const textRemaining = cascadeDeselect("translation", ["tts", "transcription", "translation", "dubbing"], "text");
    assert.deepEqual(textRemaining, ["tts", "transcription"]);

    // Text: unchecking transcription deselects translation and dubbing
    const textSubRemaining = cascadeDeselect("transcription", ["tts", "transcription", "translation", "dubbing"], "text");
    assert.deepEqual(textSubRemaining, ["tts"]);

    // Text: unchecking TTS deselects transcription, translation, and dubbing
    const textTtsRemaining = cascadeDeselect("tts", ["tts", "transcription", "translation", "dubbing"], "text");
    assert.deepEqual(textTtsRemaining, []);
  });

  await t.test("shouldSkipTranslation returns true when sourceLanguage equals targetLanguage (AC-07, AC-08)", () => {
    const same = shouldSkipTranslation("vi", "vi");
    assert.equal(same.shouldSkip, true);
    assert.ok(same.skipReason?.includes("trùng ngôn ngữ đích"));

    const diff = shouldSkipTranslation("en", "vi");
    assert.equal(diff.shouldSkip, false);

    const auto = shouldSkipTranslation("auto", "vi");
    assert.equal(auto.shouldSkip, false);
  });
});
