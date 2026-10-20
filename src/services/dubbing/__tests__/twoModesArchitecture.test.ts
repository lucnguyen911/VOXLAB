import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  OriginalCue,
  TranslatedCue,
  DubAudioSegment,
  normalizeDubbingMode,
} from "../../../types/dubbing";
import { planDubbingSpeechGroups } from "../speechPlanner";
import { buildBatchTranslationPrompt } from "../../translation/batchTranslationHelper";
import { analyzeTimingCollision, canExportMasterWav } from "../collisionDetector";
import { mergeMasterAudio } from "../masterAssembly";
import {
  calculateNarrationGroupOffsets,
  generateNarrationAlignedSrt,
} from "../alignedSrtGenerator";

describe("Two-Modes Architecture: source_sync vs free_narration", () => {
  // Test Data
  const sampleOriginalCues: OriginalCue[] = [
    { index: 1, startSec: 1.0, endSec: 3.5, text: "Chào mừng các bạn" },
    { index: 2, startSec: 3.6, endSec: 6.0, text: "đến với kênh của chúng tôi." },
    { index: 3, startSec: 7.0, endSec: 9.0, text: "Hôm nay chúng ta sẽ tìm hiểu." },
  ];

  const sampleTranslatedCues: TranslatedCue[] = [
    {
      index: 1,
      startSec: 1.0,
      endSec: 3.5,
      originalText: "Chào mừng các bạn",
      text: "Welcome everybody",
    },
    {
      index: 2,
      startSec: 3.6,
      endSec: 6.0,
      originalText: "đến với kênh của chúng tôi.",
      text: "to our channel.",
    },
    {
      index: 3,
      startSec: 7.0,
      endSec: 9.0,
      originalText: "Hôm nay chúng ta sẽ tìm hiểu.",
      text: "Today we will learn more.",
    },
  ];

  describe("Giai đoạn 1: Mode Normalization & Speech Group Architecture", () => {
    it("normalizes modern and legacy dubbing mode strings correctly", () => {
      // Modern modes
      assert.equal(normalizeDubbingMode("source_sync"), "source_sync");
      assert.equal(normalizeDubbingMode("free_narration"), "free_narration");

      // Backward compatibility for legacy modes
      assert.equal(normalizeDubbingMode("sentence_group"), "source_sync");
      assert.equal(normalizeDubbingMode("cue_strict"), "source_sync");

      // Fallback for null/undefined/garbage
      assert.equal(normalizeDubbingMode(null), "source_sync");
      assert.equal(normalizeDubbingMode(undefined), "source_sync");
      assert.equal(normalizeDubbingMode("unknown_mode"), "source_sync");
    });

    it("plans DubbingSpeechGroups populating translatedText and speechText for both modes", () => {
      const groups = planDubbingSpeechGroups(sampleOriginalCues, sampleTranslatedCues);
      assert.ok(groups.length >= 1);

      // Group 1 should merge cue 1 and 2 into one full sentence
      const g1 = groups[0];
      assert.deepEqual(g1.sourceCueIds, [1, 2]);
      assert.equal(g1.speechText, "Welcome everybody to our channel.");
      assert.equal(g1.translatedText, "Welcome everybody to our channel.");
      assert.equal(g1.sourceText, "Chào mừng các bạn đến với kênh của chúng tôi.");

      // Source cue timestamps must remain strictly intact
      assert.equal(sampleOriginalCues[0].startSec, 1.0);
      assert.equal(sampleOriginalCues[0].endSec, 3.5);
      assert.equal(sampleOriginalCues[1].startSec, 3.6);
      assert.equal(sampleOriginalCues[1].endSec, 6.0);
    });
  });

  describe("Giai đoạn 2: Translation Prompts for Two Modes", () => {
    it("builds uncompressed storytelling prompt for free_narration", () => {
      const { system, user } = buildBatchTranslationPrompt(
        [
          {
            id: 1,
            text: "Welcome everybody to our channel.",
          },
        ],
        "vi",
        "default",
        {
          dubbingMode: "free_narration",
        }
      );

      // free_narration prompt directives
      assert.match(system, /narration translator/i);
      assert.match(system, /YouTube narration/i);
      assert.match(system, /Do NOT artificially compress/i);
      assert.match(user, /\[1\] Welcome everybody to our channel\./);
    });

    it("builds time-constrained concise prompt for source_sync", () => {
      const { system, user } = buildBatchTranslationPrompt(
        [
          {
            id: 1,
            text: "Welcome everybody to our channel.",
          },
        ],
        "vi",
        "default",
        {
          dubbingMode: "source_sync",
        }
      );

      assert.match(system, /matches spoken timing/i);
      assert.match(system, /concise, natural phrasing/i);
      assert.match(user, /\[1\] Welcome everybody to our channel\./);
    });
  });

  describe("Giai đoạn 3: Collision Engine & Export Gating across Modes", () => {
    const collidingSegments: Record<number, DubAudioSegment> = {
      1: {
        cueIndex: 1,
        rawDurationSec: 5.0, // Exceeds cue 1 end (3.5s) and collides with cue 2 start (3.6s)!
        targetDurationSec: 2.5,
        fittedDurationSec: 5.0,
        speedFactor: 1.0,
        audioStartSec: 1.0,
        audioEndSec: 6.0,
        status: "ready",
        isGroupPrimary: true,
      },
      2: {
        cueIndex: 2,
        rawDurationSec: 2.4,
        targetDurationSec: 2.4,
        fittedDurationSec: 2.4,
        speedFactor: 1.0,
        audioStartSec: 3.6,
        audioEndSec: 6.0,
        status: "ready",
        isGroupPrimary: false,
      },
      3: {
        cueIndex: 3,
        rawDurationSec: 2.0,
        targetDurationSec: 2.0,
        fittedDurationSec: 2.0,
        speedFactor: 1.0,
        audioStartSec: 7.0,
        audioEndSec: 9.0,
        status: "ready",
        isGroupPrimary: true,
      },
    };

    it("detects collision_danger and blocks Master WAV export in source_sync mode", () => {
      const overflow = analyzeTimingCollision(sampleOriginalCues, collidingSegments, "source_sync");
      assert.equal(overflow[1].warningLevel, "collision_danger");
      assert.equal(overflow[1].collisionWithIndex, 2);
      assert.ok((overflow[1].collisionSec || 0) > 0);

      const check = canExportMasterWav(overflow, "source_sync");
      assert.equal(check.allowed, false);
      assert.match(check.reason || "", /va chạm/i);
    });

    it("completely bypasses collision warnings and permits Master WAV export in free_narration mode", () => {
      // The exact same audio segments in free_narration should have zero collisions
      const overflow = analyzeTimingCollision(sampleOriginalCues, collidingSegments, "free_narration");
      assert.equal(overflow[1].warningLevel, "none");
      assert.equal(overflow[2].warningLevel, "none");
      assert.equal(overflow[3].warningLevel, "none");

      const check = canExportMasterWav(overflow, "free_narration");
      assert.equal(check.allowed, true);
      assert.equal(check.reason, undefined);
    });
  });

  describe("Giai đoạn 3 & 4: Master Audio Linear Assembly (Daisy-Chain) & Aligned SRT", () => {
    const readyAudioSegments: Record<number, DubAudioSegment> = {
      1: {
        cueIndex: 1,
        rawDurationSec: 4.0,
        targetDurationSec: 2.5,
        fittedDurationSec: 4.0,
        speedFactor: 1.0,
        audioStartSec: 1.0,
        audioEndSec: 5.0,
        status: "ready",
        isGroupPrimary: true,
        groupId: "g1",
        groupCueIndices: [1, 2],
      },
      2: {
        cueIndex: 2,
        rawDurationSec: 0,
        targetDurationSec: 0,
        fittedDurationSec: 0,
        speedFactor: 1.0,
        audioStartSec: 1.0,
        audioEndSec: 5.0,
        status: "ready",
        isGroupPrimary: false,
        groupId: "g1",
        groupCueIndices: [1, 2],
      },
      3: {
        cueIndex: 3,
        rawDurationSec: 3.0,
        targetDurationSec: 2.0,
        fittedDurationSec: 3.0,
        speedFactor: 1.0,
        audioStartSec: 7.0,
        audioEndSec: 10.0,
        status: "ready",
        isGroupPrimary: true,
        groupId: "g2",
        groupCueIndices: [3],
      },
    };

    it("calculates sequential daisy-chain timeline offsets for free_narration", () => {
      const groups = planDubbingSpeechGroups(sampleOriginalCues, sampleTranslatedCues);
      const pauseGap = 0.5; // 500ms natural breath pause
      const offsets = calculateNarrationGroupOffsets(groups, readyAudioSegments, pauseGap);

      // Group 1 (cues 1 & 2): duration 4.0s
      const g1Offset = offsets.get(groups[0].groupId);
      assert.ok(g1Offset);
      assert.equal(g1Offset.startSec, 0.0);
      assert.equal(g1Offset.endSec, 4.0);
      assert.equal(g1Offset.durationSec, 4.0);

      // Group 2 (cue 3): starts at g1 end (4.0s) + pauseGap (0.5s) = 4.5s
      const g2Offset = offsets.get(groups[1].groupId);
      assert.ok(g2Offset);
      assert.equal(g2Offset.startSec, 4.5);
      assert.equal(g2Offset.endSec, 7.5);
      assert.equal(g2Offset.durationSec, 3.0);
    });

    it("assembles master audio with sequential timeline in free_narration mode", () => {
      // Dummy PCM sample generator (1 sec = 44100 float samples)
      const sampleMap = new Map<number, Float32Array>([
        [1, new Float32Array(44100 * 4)], // 4.0s
        [3, new Float32Array(44100 * 3)], // 3.0s
      ]);

      const res = mergeMasterAudio({
        originalCues: sampleOriginalCues,
        audioSegments: readyAudioSegments,
        overflowAnalysis: {},
        sampleGetter: (idx) => sampleMap.get(idx) || null,
        mode: "free_narration",
        pauseBetweenGroupsSec: 0.5,
      });

      assert.equal(res.ok, true);
      assert.ok(res.blob);
      assert.equal(res.totalDurationSec, 7.5); // 4.0s + 0.5s pause + 3.0s = 7.5s

      // Check resolved segments have updated linear audioStartSec and audioEndSec
      assert.ok(res.resolvedSegments);
      assert.equal(res.resolvedSegments[1].audioStartSec, 0.0);
      assert.equal(res.resolvedSegments[1].audioEndSec, 4.0);
      assert.equal(res.resolvedSegments[3].audioStartSec, 4.5);
      assert.equal(res.resolvedSegments[3].audioEndSec, 7.5);
    });

    it("generates newly synchronized Aligned SRT derived strictly from actual narration timeline", () => {
      const groups = planDubbingSpeechGroups(sampleOriginalCues, sampleTranslatedCues);
      const res = generateNarrationAlignedSrt({
        speechGroups: groups,
        originalCues: sampleOriginalCues,
        translatedCues: sampleTranslatedCues,
        audioSegments: readyAudioSegments,
        pauseBetweenGroupsSec: 0.5,
        mode: "cue",
      });

      assert.equal(res.ok, true);
      assert.ok(res.srtContent);
      assert.ok(res.cues);
      assert.equal(res.cues.length, 3);

      // Cue 1 starts at 0.0s (not 1.0s)
      assert.equal(res.cues[0].startSec, 0.0);
      // Constituent cue 2 within group 1 is timed proportionally inside [0.0, 4.0]
      assert.ok(res.cues[1].startSec > res.cues[0].startSec);
      assert.equal(res.cues[1].endSec, 4.0);

      // Cue 3 starts at 4.5s (not 7.0s) and ends at 7.5s (not 9.0s)
      assert.equal(res.cues[2].startSec, 4.5);
      assert.equal(res.cues[2].endSec, 7.5);
      assert.equal(res.cues[2].text, "Today we will learn more.");

      // Verify SRT formatting (HH:MM:SS,mmm --> HH:MM:SS,mmm)
      assert.match(res.srtContent, /00:00:00,000 --> 00:00:0/);
      assert.match(res.srtContent, /00:00:04,500 --> 00:00:07,500/);
    });

    it("blocks aligned SRT generation if any required audio segment is not ready", () => {
      const groups = planDubbingSpeechGroups(sampleOriginalCues, sampleTranslatedCues);
      const incompleteSegments: Record<number, DubAudioSegment> = {
        ...readyAudioSegments,
        3: {
          ...readyAudioSegments[3],
          status: "needs_generation",
        },
      };

      const res = generateNarrationAlignedSrt({
        speechGroups: groups,
        originalCues: sampleOriginalCues,
        translatedCues: sampleTranslatedCues,
        audioSegments: incompleteSegments,
      });

      assert.equal(res.ok, false);
      assert.match(res.reason || "", /chưa có âm thanh/i);
    });
  });
});
