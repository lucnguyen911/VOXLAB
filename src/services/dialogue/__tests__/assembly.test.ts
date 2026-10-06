import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculateDialogueTimeline } from "../masterAssembly";
import { formatSrtTimestamp, generateDialogueSrt } from "../srtExporter";
import { DialogueSegment, DEFAULT_DIALOGUE_SETTINGS } from "../../../types/dialogue";

describe("Dialogue Assembly & SRT Exporter Suite", () => {
  const mockSegments: DialogueSegment[] = [
    {
      id: "seg_1",
      index: 1,
      characterName: "Nam",
      characterId: "nam",
      rawText: "Câu 1",
      cleanText: "Xin chào bạn Vy!",
      durationSec: 2.0,
      pauseAfterSec: 0.3,
      status: "ready",
    },
    {
      id: "seg_2",
      index: 2,
      characterName: "Vy",
      characterId: "vy",
      rawText: "Câu 2",
      cleanText: "Chào Nam, rất vui được gặp!",
      durationSec: 3.0,
      pauseAfterSec: 0.3,
      status: "ready",
    },
    {
      id: "seg_3",
      index: 3,
      characterName: "Vy",
      characterId: "vy",
      rawText: "Câu 3",
      cleanText: "Hôm nay chúng ta bàn gì nào?",
      durationSec: 2.5,
      pauseAfterSec: 0.2,
      status: "ready",
    },
  ];

  it("calculates timeline with speaker-switch pause vs same-speaker pause", () => {
    const plan = calculateDialogueTimeline(mockSegments, {
      ...DEFAULT_DIALOGUE_SETTINGS,
      turnPauseSec: 0.5,
      sameSpeakerPauseSec: 0.2,
    });

    assert.equal(plan.timeline.length, 3);

    // Segment 1 (Nam -> Vy): start = 0, duration = 2.0, pause = 0.5 (turn pause)
    assert.equal(plan.timeline[0].startSec, 0);
    assert.equal(plan.timeline[0].endSec, 2.0);
    assert.equal(plan.timeline[0].pauseAfterSec, 0.5);

    // Segment 2 (Vy -> Vy): start = 2.0 + 0.5 = 2.5, duration = 3.0, pause = 0.2 (same speaker pause)
    assert.equal(plan.timeline[1].startSec, 2.5);
    assert.equal(plan.timeline[1].endSec, 5.5);
    assert.equal(plan.timeline[1].pauseAfterSec, 0.2);

    // Segment 3 (Last): start = 5.5 + 0.2 = 5.7, duration = 2.5, pause = 0
    assert.equal(plan.timeline[2].startSec, 5.7);
    assert.equal(plan.timeline[2].endSec, 8.2);
    assert.equal(plan.timeline[2].pauseAfterSec, 0);

    assert.equal(plan.totalDurationSec, 8.2);
  });

  it("formats SRT timestamp correctly", () => {
    assert.equal(formatSrtTimestamp(0), "00:00:00,000");
    assert.equal(formatSrtTimestamp(2.5), "00:00:02,500");
    assert.equal(formatSrtTimestamp(65.123), "00:01:05,123");
    assert.equal(formatSrtTimestamp(3661.05), "01:01:01,050");
  });

  it("generates valid SubRip SRT content with [Speaker]: text (default 0s gap between turns)", () => {
    const plan = calculateDialogueTimeline(mockSegments, DEFAULT_DIALOGUE_SETTINGS);
    const srt = generateDialogueSrt(plan.timeline);

    assert.ok(srt.includes("1\n00:00:00,000 --> 00:00:02,000\n[Nam]: Xin chào bạn Vy!"));
    assert.ok(srt.includes("2\n00:00:02,000 --> 00:00:05,000\n[Vy]: Chào Nam, rất vui được gặp!"));
  });

  it("strips pause tokens from SRT subtitles while keeping clean dialogue", () => {
    const srt = generateDialogueSrt([
      {
        segmentId: "s1",
        index: 1,
        characterName: "Nam",
        characterId: "nam",
        text: "Vy ơi có rảnh không? [PAUSE 500ms]",
        startSec: 0,
        endSec: 2.5,
        durationSec: 2.5,
        pauseAfterSec: 0,
      },
    ]);
    assert.ok(srt.includes("[Nam]: Vy ơi có rảnh không?"));
    assert.ok(!srt.includes("[PAUSE"));
  });

  it("respects maxLines: 1 by keeping dialogue cue on a single line even if long", () => {
    const srt = generateDialogueSrt(
      [
        {
          segmentId: "s1",
          index: 1,
          characterName: "Nam",
          characterId: "nam",
          text: "Hôm nay thời tiết ở thành phố rất là tuyệt vời và mát mẻ bạn có muốn đi dạo không?",
          startSec: 0,
          endSec: 4.0,
          durationSec: 4.0,
          pauseAfterSec: 0,
        },
      ],
      { aspectRatio: "9:16", maxLines: 1 }
    );
    assert.ok(
      srt.includes(
        "[Nam]: Hôm nay thời tiết ở thành phố rất là tuyệt vời và mát mẻ bạn có muốn đi dạo không?"
      )
    );
  });

  it("respects maxLines: 2 and 9:16 portrait ratio by wrapping long dialogue into 2 lines", () => {
    const srt = generateDialogueSrt(
      [
        {
          segmentId: "s1",
          index: 1,
          characterName: "Nam",
          characterId: "nam",
          text: "Hôm nay thời tiết ở thành phố rất là tuyệt vời và mát mẻ bạn có muốn đi dạo không?",
          startSec: 0,
          endSec: 4.0,
          durationSec: 4.0,
          pauseAfterSec: 0,
        },
      ],
      { aspectRatio: "9:16", maxLines: 2 }
    );
    // Split into 2 lines with newline
    const lines = srt.split("\n");
    // Find lines of text after timestamp (line 0: 1, line 1: 00:00... --> ..., line 2: part1, line 3: part2)
    assert.ok(lines[2].length > 0 && lines[3].length > 0);
    assert.ok(lines[2].startsWith("[Nam]:"));
  });
});
