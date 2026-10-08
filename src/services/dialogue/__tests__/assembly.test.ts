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

  it("calculates timeline with legacy fixed pause (turnPauseSec)", () => {
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

  it("calculates timeline with Min-Max turn pause range (0.40s - 0.70s) deterministically", () => {
    const plan1 = calculateDialogueTimeline(mockSegments, {
      ...DEFAULT_DIALOGUE_SETTINGS,
      turnPauseMinSec: 0.40,
      turnPauseMaxSec: 0.70,
      sameSpeakerPauseSec: 0.2,
    });

    const plan2 = calculateDialogueTimeline(mockSegments, {
      ...DEFAULT_DIALOGUE_SETTINGS,
      turnPauseMinSec: 0.40,
      turnPauseMaxSec: 0.70,
      sameSpeakerPauseSec: 0.2,
    });

    // Invariant: 100% deterministic (NO Math.random)
    assert.deepEqual(plan1, plan2);

    // Segment 1 ends with "!" ("Xin chào bạn Vy!") -> R = 0.72 -> 0.40 + 0.72 * 0.30 = 0.616s
    assert.equal(plan1.timeline[0].pauseAfterSec, 0.616);
    assert.equal(plan1.timeline[0].startSec, 0);
    assert.equal(plan1.timeline[0].endSec, 2.0);

    // Segment 2 (Vy -> Vy) uses sameSpeakerPauseSec = 0.2
    assert.equal(plan1.timeline[1].startSec, 2.616);
    assert.equal(plan1.timeline[1].pauseAfterSec, 0.2);
  });

  it("respects fixed gap when Min === Max", () => {
    const plan = calculateDialogueTimeline(mockSegments, {
      ...DEFAULT_DIALOGUE_SETTINGS,
      turnPauseMinSec: 0.50,
      turnPauseMaxSec: 0.50,
      sameSpeakerPauseSec: 0.2,
    });

    assert.equal(plan.timeline[0].pauseAfterSec, 0.50);
  });

  it("adjusts pause contextually for quick reply vs ellipsis thought", () => {
    const quickReplySegments: DialogueSegment[] = [
      {
        id: "s1",
        index: 1,
        characterName: "Nam",
        characterId: "nam",
        rawText: "Cậu có muốn đi không?",
        cleanText: "Cậu có muốn đi không?",
        durationSec: 2.0,
        pauseAfterSec: 0,
        status: "ready",
      },
      {
        id: "s2",
        index: 2,
        characterName: "Vy",
        characterId: "vy",
        rawText: "Vâng!",
        cleanText: "Vâng!",
        durationSec: 1.0,
        pauseAfterSec: 0,
        status: "ready",
      },
    ];

    const ellipsisSegments: DialogueSegment[] = [
      {
        id: "s1",
        index: 1,
        characterName: "Nam",
        characterId: "nam",
        rawText: "Tôi cũng không chắc nữa...",
        cleanText: "Tôi cũng không chắc nữa...",
        durationSec: 2.5,
        pauseAfterSec: 0,
        status: "ready",
      },
      {
        id: "s2",
        index: 2,
        characterName: "Vy",
        characterId: "vy",
        rawText: "Hãy nghĩ lại xem.",
        cleanText: "Hãy nghĩ lại xem.",
        durationSec: 2.0,
        pauseAfterSec: 0,
        status: "ready",
      },
    ];

    const settings = {
      ...DEFAULT_DIALOGUE_SETTINGS,
      turnPauseMinSec: 0.40,
      turnPauseMaxSec: 0.70,
    };

    const quickPlan = calculateDialogueTimeline(quickReplySegments, settings);
    const ellipsisPlan = calculateDialogueTimeline(ellipsisSegments, settings);

    // Quick reply ("Vâng!") has short reaction time: R = 0.15 -> 0.445s
    assert.equal(quickPlan.timeline[0].pauseAfterSec, 0.445);

    // Ellipsis ("...") has long reflection time: R = 0.90 -> 0.670s
    assert.equal(ellipsisPlan.timeline[0].pauseAfterSec, 0.670);

    // Invariant: min <= quickPause < ellipsisPause <= max
    assert.ok(quickPlan.timeline[0].pauseAfterSec < ellipsisPlan.timeline[0].pauseAfterSec);
    assert.ok(quickPlan.timeline[0].pauseAfterSec >= 0.40);
    assert.ok(ellipsisPlan.timeline[0].pauseAfterSec <= 0.70);
  });

  it("deducts existing natural silence without clipping speech", () => {
    const segmentsWithSilence: DialogueSegment[] = [
      {
        id: "s1",
        index: 1,
        characterName: "Nam",
        characterId: "nam",
        rawText: "Xin chào bạn Vy!",
        cleanText: "Xin chào bạn Vy!",
        durationSec: 2.0,
        pauseAfterSec: 0,
        status: "ready",
        trailingSilenceSec: 0.15, // Model left 150ms silence at end
      },
      {
        id: "s2",
        index: 2,
        characterName: "Vy",
        characterId: "vy",
        rawText: "Chào Nam!",
        cleanText: "Chào Nam!",
        durationSec: 2.0,
        pauseAfterSec: 0,
        status: "ready",
        leadingSilenceSec: 0.10, // Model left 100ms silence at start
      },
    ];

    const plan = calculateDialogueTimeline(segmentsWithSilence, {
      ...DEFAULT_DIALOGUE_SETTINGS,
      turnPauseMinSec: 0.50,
      turnPauseMaxSec: 0.50, // Fixed target gap = 0.50s
    });

    // Existing natural gap = 0.15 + 0.10 = 0.25s
    // Additional gap = 0.50 - 0.25 = 0.25s
    assert.equal(plan.timeline[0].pauseAfterSec, 0.25);

    // Now test when existing silence exceeds target gap:
    const segmentsWithExcessSilence: DialogueSegment[] = [
      {
        ...segmentsWithSilence[0],
        trailingSilenceSec: 0.40,
      },
      {
        ...segmentsWithSilence[1],
        leadingSilenceSec: 0.30, // Existing = 0.70s > 0.50s
      },
    ];

    const planExcess = calculateDialogueTimeline(segmentsWithExcessSilence, {
      ...DEFAULT_DIALOGUE_SETTINGS,
      turnPauseMinSec: 0.50,
      turnPauseMaxSec: 0.50,
    });

    // Invariant: Speech is NEVER clipped. If existing silence >= targetGap, additional gap is 0
    assert.equal(planExcess.timeline[0].pauseAfterSec, 0);
  });

  it("formats SRT timestamp correctly", () => {
    assert.equal(formatSrtTimestamp(0), "00:00:00,000");
    assert.equal(formatSrtTimestamp(2.5), "00:00:02,500");
    assert.equal(formatSrtTimestamp(65.123), "00:01:05,123");
    assert.equal(formatSrtTimestamp(3661.05), "01:01:01,050");
  });

  it("generates valid SubRip SRT content synchronized with timeline", () => {
    const plan = calculateDialogueTimeline(mockSegments, {
      ...DEFAULT_DIALOGUE_SETTINGS,
      turnPauseMinSec: 0,
      turnPauseMaxSec: 0,
    });
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
