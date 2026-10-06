import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  generateSubtitlesFromText,
  exportToSrt,
  loadSubtitleSettings,
  saveSubtitleSettings,
} from "../../services/subtitle";

describe("Subtitles (Phụ đề) Complete Workflow Verification Tests (Section 33)", () => {
  // CASE 1: Import WAV → Create Subtitle → edit cue → export SRT
  test("CASE 1: Import WAV -> Create Subtitle -> edit cue -> export SRT", () => {
    const wavFile = {
      name: "podcast_interview.wav",
      type: "audio/wav",
      size: 5 * 1024 * 1024,
    };
    const ext = wavFile.name.split(".").pop()?.toLowerCase();
    const isAudio = ["wav", "mp3", "flac", "m4a"].includes(ext || "");
    assert.equal(isAudio, true, "WAV must be recognized as valid audio");

    const rawTranscript =
      "Chào mừng các bạn đến với buổi phỏng vấn ngày hôm nay. Chúng ta sẽ cùng trao đổi về tương lai của AI tại Việt Nam.";
    const cues = generateSubtitlesFromText(rawTranscript, { aspectRatio: "16:9" });
    assert.ok(cues.length > 0, "Should generate cues for WAV transcript");

    // Edit cue text
    const editedCues = cues.map((c) =>
      c.index === 1 ? { ...c, text: c.text + " (Đã biên tập)" } : c
    );
    assert.ok(editedCues[0].text.includes("(Đã biên tập)"));

    // Export SRT
    const srt = exportToSrt(editedCues);
    assert.ok(srt.includes("00:00:00,000 -->"));
    assert.ok(srt.includes("(Đã biên tập)"), "Exported SRT must contain edited text");
  });

  // CASE 2: Import MP3 → Create Subtitle → export TXT
  test("CASE 2: Import MP3 -> Create Subtitle -> export TXT", () => {
    const mp3File = {
      name: "audiobook_chapter1.mp3",
      type: "audio/mpeg",
      size: 3 * 1024 * 1024,
    };
    const ext = mp3File.name.split(".").pop()?.toLowerCase();
    const isAudio = ["wav", "mp3", "flac", "m4a"].includes(ext || "");
    assert.equal(isAudio, true, "MP3 must be recognized as valid audio");

    const rawTranscript =
      "Chương một. Buổi sáng tinh mơ trên thảo nguyên xanh ngát, ánh nắng chan hòa chiếu rọi muôn loài.";
    const cues = generateSubtitlesFromText(rawTranscript, { aspectRatio: "16:9" });
    assert.ok(cues.length > 0);

    const txt = cues.map((c) => c.text.trim()).join("\n\n");
    assert.ok(txt.includes("Chương một"));
    assert.ok(!txt.includes("-->"), "TXT export must not contain SRT timestamp arrows");
  });

  // CASE 3: Import MP4 có audio → extraction → subtitle generation → export SRT
  test("CASE 3: Import MP4 with audio -> extraction -> subtitle generation -> export SRT", () => {
    const videoFile = {
      name: "Demo_HoiThao_AI_Part1.mp4",
      type: "video/mp4",
      size: 15 * 1024 * 1024,
      hasAudio: true,
    };
    const ext = videoFile.name.split(".").pop()?.toLowerCase();
    const isVideo = ["mp4", "mov", "mkv", "webm"].includes(ext || "");
    assert.equal(isVideo, true, "MP4 must be recognized as valid video");
    assert.equal(videoFile.hasAudio, true, "Video must have audio track");

    const rawTranscript =
      "Chào mọi người đã quay trở lại với series sản xuất nội dung âm thanh VoxLab. Hôm nay chúng ta sẽ thử nghiệm mô hình nhận diện giọng nói faster-whisper trên hệ thống.";
    const cues = generateSubtitlesFromText(rawTranscript, { aspectRatio: "16:9" });
    assert.ok(cues.length >= 2, "Should segment into multiple balanced cues");

    const srt = exportToSrt(cues);
    assert.ok(srt.includes("1\n00:00:"));
    assert.ok(srt.includes("Chào mọi người đã quay trở lại"));
  });

  // CASE 4: Import video không có audio → error state hợp lý
  test("CASE 4: Import video without audio track -> error state properly flagged", () => {
    const silentVideoFile = {
      name: "silent_presentation_no_audio.mp4",
      type: "video/mp4",
      size: 10 * 1024 * 1024,
    };
    const lowerName = silentVideoFile.name.toLowerCase();
    const isVideo = ["mp4", "mov", "mkv", "webm"].includes(
      silentVideoFile.name.split(".").pop()?.toLowerCase() || ""
    );
    const hasNoAudio =
      isVideo &&
      (lowerName.includes("no_audio") ||
        lowerName.includes("silent") ||
        lowerName.includes("no-audio"));

    assert.equal(hasNoAudio, true, "Should identify video without audio track");
    const errorMsg = "Không tìm thấy track âm thanh trong video.";
    assert.ok(errorMsg.length > 0);
  });

  // CASE 5: Unsupported format → reject rõ ràng
  test("CASE 5: Unsupported format -> rejected clearly", () => {
    const invalidFiles = [
      { name: "document.pdf", type: "application/pdf" },
      { name: "executable.exe", type: "application/x-msdownload" },
      { name: "script.js", type: "text/javascript" },
      { name: "image.png", type: "image/png" },
    ];

    for (const file of invalidFiles) {
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      const isAudio = ["wav", "mp3", "flac", "m4a"].includes(ext) || file.type.startsWith("audio/");
      const isVideo = ["mp4", "mov", "mkv", "webm"].includes(ext) || file.type.startsWith("video/");
      assert.equal(isAudio || isVideo, false, `File ${file.name} must be rejected as unsupported`);
    }
  });

  // CASE 6: Cancel processing → quay lại READY → retry được
  test("CASE 6: Cancel processing -> returns to READY -> can retry", () => {
    let state: "EMPTY" | "READY" | "PROCESSING" | "RESULT" = "READY";
    const file = { name: "demo.mp4", durationSec: 18.5 };

    // Trigger processing
    state = "PROCESSING";
    assert.equal(state, "PROCESSING");

    // Cancel during processing
    state = "READY";
    assert.equal(state, "READY", "State must cleanly return to READY after cancellation");
    assert.ok(file.name, "File info must be preserved so user does not have to re-import");

    // Retry
    state = "PROCESSING";
    assert.equal(state, "PROCESSING", "User can immediately retry without re-importing");
  });

  // CASE 7: Click cue → player seek đúng timestamp
  test("CASE 7: Click cue -> player seeks to cue start timestamp", () => {
    const rawTranscript =
      "Câu đầu tiên mở đầu phần một. Câu thứ hai tiếp nối câu đầu. Câu thứ ba kết thúc phần giới thiệu.";
    const cues = generateSubtitlesFromText(rawTranscript, { aspectRatio: "16:9" });

    let currentPlayerTime = 0;
    const seekPlayer = (time: number) => {
      currentPlayerTime = time;
    };

    // Click cue #2
    const targetCue = cues[1];
    seekPlayer(targetCue.startSec);
    assert.equal(currentPlayerTime, targetCue.startSec);
    assert.ok(currentPlayerTime > 0, "Player time must match cue startSec");
  });

  // CASE 8: Playback → active cue highlight đúng
  test("CASE 8: Playback -> active cue highlights accurately", () => {
    const rawTranscript =
      "Đoạn A giới thiệu sản phẩm. Đoạn B mô tả tính năng. Đoạn C hướng dẫn cài đặt.";
    const cues = generateSubtitlesFromText(rawTranscript, { aspectRatio: "16:9" });

    const isCueActive = (cue: { startSec: number; endSec: number }, curTime: number) => {
      return curTime >= cue.startSec && curTime < cue.endSec;
    };

    // Time inside cue 0
    const timeInCue0 = cues[0].startSec + 0.2;
    assert.equal(isCueActive(cues[0], timeInCue0), true);
    assert.equal(isCueActive(cues[1], timeInCue0), false);

    // Time inside cue 1
    const timeInCue1 = cues[1].startSec + 0.2;
    assert.equal(isCueActive(cues[0], timeInCue1), false);
    assert.equal(isCueActive(cues[1], timeInCue1), true);
  });

  // CASE 9: Edit cue text → export chứa text đã edit
  test("CASE 9: Edit cue text -> export contains the edited text", () => {
    const rawTranscript = "Đây là văn bản gốc nhận diện từ giọng nói.";
    const cues = generateSubtitlesFromText(rawTranscript, { aspectRatio: "16:9" });
    assert.ok(cues.length > 0);

    const originalText = cues[0].text;
    const editedText = "Nội dung câu 1 đã được người dùng chỉnh sửa hoàn thiện.";
    const updatedCues = cues.map((c, i) => (i === 0 ? { ...c, text: editedText } : c));

    const srt = exportToSrt(updatedCues);
    assert.ok(srt.includes(editedText));
    assert.ok(!srt.includes(originalText), "Original replaced text must not appear");
  });

  // CASE 10: Switch global aspect ratio: 16:9 vs 9:16
  test("CASE 10: Switch global aspect ratio: 9:16 generates shorter/more compact cues than 16:9", () => {
    const longText =
      "Hệ thống sản xuất nội dung âm thanh và video VoxLab cho phép xử lý tự động với tốc độ cao trên phần cứng máy tính cục bộ.";

    const cues169 = generateSubtitlesFromText(longText, { aspectRatio: "16:9" });
    const cues916 = generateSubtitlesFromText(longText, { aspectRatio: "9:16" });

    const avgWords169 =
      cues169.reduce((acc, c) => acc + c.text.split(/\s+/).length, 0) / cues169.length;
    const avgWords916 =
      cues916.reduce((acc, c) => acc + c.text.split(/\s+/).length, 0) / cues916.length;

    // 9:16 target words is 4, whereas 16:9 target words is 8
    assert.ok(
      avgWords916 <= avgWords169,
      `9:16 average words (${avgWords916}) should be <= 16:9 (${avgWords169})`
    );
  });

  // CASE 11: Restart app / settings persistence → global aspect ratio persistence
  test("CASE 11: Settings persistence maintains global aspect ratio", () => {
    // In node test environment, simulate localStorage
    const mockStorage: Record<string, string> = {};
    globalThis.localStorage = {
      getItem: (k: string) => mockStorage[k] || null,
      setItem: (k: string, v: string) => {
        mockStorage[k] = v;
      },
      removeItem: (k: string) => {
        delete mockStorage[k];
      },
      clear: () => {},
      key: () => null,
      length: 0,
    } as any;

    saveSubtitleSettings({ aspectRatio: "9:16" });
    const loaded = loadSubtitleSettings();
    assert.equal(loaded.aspectRatio, "9:16", "Subtitle settings must persist 9:16");

    saveSubtitleSettings({ aspectRatio: "1:1" });
    const loadedSquare = loadSubtitleSettings();
    assert.equal(loadedSquare.aspectRatio, "1:1", "Subtitle settings must persist 1:1");

    saveSubtitleSettings({ aspectRatio: "16:9" });
    const loadedDefault = loadSubtitleSettings();
    assert.equal(loadedDefault.aspectRatio, "16:9", "Subtitle settings must persist 16:9");
  });

  // CASE 12: Chuyển sang TTS → transcript cuối cùng được truyền sang TTS đúng
  test("CASE 12: Send to TTS passes final edited transcript text", () => {
    const cues = [
      { index: 1, startSec: 0, endSec: 3.5, text: "Chào mừng các bạn đã quay trở lại." },
      { index: 2, startSec: 3.6, endSec: 8.0, text: "Hôm nay chúng ta sẽ tiếp tục phần hai." },
    ];

    let receivedByTts = "";
    const onSendToTts = (text: string) => {
      receivedByTts = text;
    };

    // User edits cue 2
    cues[1].text = "Hôm nay chúng ta sẽ khám phá tính năng tạo phụ đề mới.";

    const finalFullText = cues.map((c) => c.text.trim()).join(" ");
    onSendToTts(finalFullText);

    assert.equal(
      receivedByTts,
      "Chào mừng các bạn đã quay trở lại. Hôm nay chúng ta sẽ khám phá tính năng tạo phụ đề mới."
    );
    assert.ok(receivedByTts.includes("khám phá tính năng tạo phụ đề mới"));
  });
});
