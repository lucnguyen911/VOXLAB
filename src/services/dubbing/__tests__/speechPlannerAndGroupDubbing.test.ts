import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCueTextForSpeech,
  planDubbingSpeechGroups,
  findSpeechGroupByCueIndex,
  rebuildGroupAfterCueEdit,
  expandGroupSegmentToCueSegments,
} from "../speechPlanner";
import {
  projectGroupTranslationToCues,
  validateProjectedCues,
} from "../../translation/groupProjection";
import { translationManager } from "../../translation/manager";
import { TranslationProvider } from "../../translation/types";
import {
  MAX_DUB_SPEEDUP,
  calculateTimingFit,
  stretchWavBufferWithWsola,
} from "../timingFit";
import { encode16BitMonoWav, decodeWavBuffer } from "../audioNormalizer";
import { analyzeTimingCollision, canExportMasterWav } from "../collisionDetector";
import { mergeMasterAudio } from "../masterAssembly";
import { DubbingSynthesisQueue } from "../synthesisQueue";
import { exportToSrt } from "../../subtitle/exporter";
import { OriginalCue, TranslatedCue, DubAudioSegment } from "../../../types/dubbing";

describe("DubbingSpeechPlanner — Sentence & Clause Grouping", () => {
  it("strips subtitle display newlines into spaces for translation and TTS", () => {
    const raw = "Almost every automaker\nhas dreamed of building a robot.";
    assert.equal(
      normalizeCueTextForSpeech(raw),
      "Almost every automaker has dreamed of building a robot."
    );
  });

  it("groups multi-cue sentences until terminal punctuation and respects long pauses", () => {
    const cues: OriginalCue[] = [
      { index: 1, startSec: 0.0, endSec: 2.1, text: "Almost every automaker\nin the world" },
      { index: 2, startSec: 2.1, endSec: 4.3, text: "has dreamed of building\na humanoid robot," },
      { index: 3, startSec: 4.3, endSec: 6.5, text: "and Tesla is now\nleading the race." },
      // 1.1s pause gap before Cue 4
      { index: 4, startSec: 7.6, endSec: 9.8, text: "However, mass production\nremains a huge challenge." },
    ];

    const groups = planDubbingSpeechGroups(cues);
    assert.equal(groups.length, 2);

    assert.deepEqual(groups[0].sourceCueIds, [1, 2, 3]);
    assert.equal(groups[0].startSec, 0.0);
    assert.equal(groups[0].endSec, 6.5);
    assert.equal(
      groups[0].sourceText,
      "Almost every automaker in the world has dreamed of building a humanoid robot, and Tesla is now leading the race."
    );
    assert.ok(!groups[0].sourceText.includes("\n"));

    assert.deepEqual(groups[1].sourceCueIds, [4]);
    assert.equal(
      groups[1].sourceText,
      "However, mass production remains a huge challenge."
    );
  });

  it("never merges across speaker changes, chapter headers, or user-defined breaks", () => {
    const cues: OriginalCue[] = [
      { index: 1, startSec: 0.0, endSec: 2.0, text: "CHƯƠNG 1: KHỞI ĐẦU" },
      { index: 2, startSec: 2.1, endSec: 4.0, text: "[Host]: Chào mừng các bạn\nđến với chương trình" },
      { index: 3, startSec: 4.0, endSec: 6.0, text: "hôm nay của chúng tôi" },
      { index: 4, startSec: 6.1, endSec: 8.2, text: "[Guest]: Cảm ơn bạn đã mời tôi." },
    ];

    const groups = planDubbingSpeechGroups(cues);
    assert.equal(groups.length, 3);
    assert.deepEqual(groups[0].sourceCueIds, [1]);
    assert.equal(groups[0].breakReason, "chapter_header");
    assert.deepEqual(groups[1].sourceCueIds, [2, 3]);
    assert.equal(groups[1].breakReason, "speaker_change");
    assert.deepEqual(groups[2].sourceCueIds, [4]);

    // User-forced break after cue 2
    const transWithUserBreak: TranslatedCue[] = cues.map((c) => ({
      index: c.index,
      startSec: c.startSec,
      endSec: c.endSec,
      originalText: c.text,
      text: c.text,
      forceGroupBreakAfter: c.index === 2,
    }));
    const groupsWithUserBreak = planDubbingSpeechGroups(cues, transWithUserBreak);
    assert.equal(groupsWithUserBreak.length, 4);
    assert.deepEqual(groupsWithUserBreak[1].sourceCueIds, [2]);
    assert.equal(groupsWithUserBreak[1].breakReason, "user_break");
    assert.deepEqual(groupsWithUserBreak[2].sourceCueIds, [3]);
  });

  it("splits overly long multi-clause sentences along natural clause boundaries", () => {
    const cues: OriginalCue[] = [
      { index: 1, startSec: 0.0, endSec: 3.5, text: "When engineers tore down the first prototype of the humanoid actuator system," },
      { index: 2, startSec: 3.5, endSec: 7.0, text: "they discovered that the planetary roller screw accounted for over half of the cost," },
      { index: 3, startSec: 7.0, endSec: 10.5, text: "which meant that traditional suppliers could not manufacture it at scale," },
      { index: 4, startSec: 10.5, endSec: 14.0, text: "so the team had to redesign the entire gearbox from scratch in-house." },
    ];

    const groups = planDubbingSpeechGroups(cues, [], undefined, {
      softMaxDurationSec: 6.5,
      softMaxChars: 130,
    });
    assert.ok(groups.length >= 2, "Should split long 4-clause sentence at a clause boundary");
    const coveredIds = groups.flatMap((g) => g.sourceCueIds);
    assert.deepEqual(coveredIds, [1, 2, 3, 4]);
    assert.equal(groups[0].breakReason, "max_length_clause");
  });
});

describe("Context-Aware Group Translation & Phrase Projection", () => {
  it("projects group translation onto constituent cues at phrase boundaries while preserving word order and numbers", () => {
    const groupCues: OriginalCue[] = [
      { index: 1, startSec: 0.0, endSec: 2.2, text: "At a price of $299\na month," },
      { index: 2, startSec: 2.2, endSec: 4.8, text: "this robot can work\n24 hours a day." },
    ];
    const groups = planDubbingSpeechGroups(groupCues);
    assert.equal(groups.length, 1);

    const groupTranslated =
      "Với mức giá $299 mỗi tháng, robot này có thể làm việc 24 giờ mỗi ngày.";
    const projection = projectGroupTranslationToCues(
      groupCues,
      groupTranslated
    );

    assert.equal(projection.reliable, true);
    assert.equal(projection.needsReview, false);
    assert.equal(projection.projectedTexts.length, 2);

    const valid = validateProjectedCues(
      groupCues,
      projection.projectedTexts,
      groupTranslated
    );
    assert.equal(valid.valid, true);
    // Joined projected cues must equal the full group translation
    assert.equal(projection.projectedTexts.join(" "), groupTranslated);
  });

  it("strips newlines before calling translation provider and preserves 1:1 cue count and timestamps", async () => {
    const seenInputs: string[] = [];

    const mockProvider: TranslationProvider = {
      id: "mock-group-provider",
      displayName: "Mock Group Provider",
      type: "gemini",
      badge: "Cloud",
      description: "Mock Group Provider",
      async translate(text) {
        seenInputs.push(text);
        return `Dịch: ${text}`;
      },
    };
    (translationManager as any).builtInProviders.set(
      "mock-group-provider",
      mockProvider
    );

    const originalCues: OriginalCue[] = [
      { index: 1, startSec: 0.0, endSec: 2.0, text: "First line\nsecond line," },
      { index: 2, startSec: 2.0, endSec: 4.0, text: "third line\nfourth line." },
    ];

    const translated = await translationManager.translateOriginalCues(
      originalCues,
      "vi",
      "mock-group-provider"
    );

    assert.equal(translated.length, 2);
    // Provider must never receive raw '\n' inside cue/group text
    assert.ok(seenInputs.length > 0);
    for (const input of seenInputs) {
      assert.ok(!input.includes("\n"), `Input should not contain newline: ${JSON.stringify(input)}`);
    }
    // 1:1 cue count and timestamps preserved
    assert.equal(translated[0].index, 1);
    assert.equal(translated[0].startSec, 0.0);
    assert.equal(translated[0].endSec, 2.0);
    assert.equal(translated[1].index, 2);
    assert.equal(translated[1].startSec, 2.0);
    assert.equal(translated[1].endSec, 4.0);
  });
});

describe("WSOLA WAV Time-Stretching & 1.20x Ceiling Verification", () => {
  it("enforces MAX_DUB_SPEEDUP = 1.20x across calculateTimingFit even if higher maxSpeedup is passed", () => {
    assert.equal(MAX_DUB_SPEEDUP, 1.2);
    const fit = calculateTimingFit(3.6, 2.4, 1.45);
    assert.equal(fit.speedFactor, 1.2);
    assert.equal(fit.fittedDurationSec, 3.0);
    assert.equal(fit.isStretched, true);
  });

  it("stretches WAV buffer directly with pitch-preserving WSOLA and verifies actual post-stretch WAV duration", () => {
    const sampleRate = 24000;
    const rawDurationSec = 2.4;
    const totalSamples = Math.round(sampleRate * rawDurationSec);
    const samples = new Float32Array(totalSamples);
    // Generate 220Hz sine wave with speech-like amplitude envelope including tail
    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      const env = i > totalSamples - 2400 ? (totalSamples - i) / 2400 : 1.0;
      samples[i] = Math.sin(2 * Math.PI * 220 * t) * 0.5 * env;
    }

    const wavBytes = encode16BitMonoWav(samples, sampleRate);
    const speedFactor = 1.18;
    const stretched = stretchWavBufferWithWsola(wavBytes, speedFactor);

    assert.equal(stretched.isStretched, true);
    const expectedDuration = rawDurationSec / speedFactor; // ~2.034s
    assert.ok(
      Math.abs(stretched.fittedDurationSec - expectedDuration) <= 0.05,
      `Expected stretched duration ~${expectedDuration.toFixed(3)}s, got ${stretched.fittedDurationSec}s`
    );

    // Decode the stretched WAV bytes and verify its actual sample count & non-zero tail
    const decoded = decodeWavBuffer(stretched.wavBuffer);
    assert.equal(decoded.sampleRate, sampleRate);
    assert.ok(
      Math.abs(decoded.durationSec - stretched.fittedDurationSec) <= 0.005,
      "Metadata duration must match actual WAV PCM sample duration"
    );
  });
});

describe("Deferred Whisper QC, Partial Edit Invalidation & Master WAV / SRT Invariants", () => {
  it("invalidates only the edited speech group when user edits a cue, preserving other ready groups", () => {
    const cues: OriginalCue[] = [
      { index: 1, startSec: 0.0, endSec: 2.0, text: "First part of group one," },
      { index: 2, startSec: 2.0, endSec: 4.0, text: "second part of group one." },
      { index: 3, startSec: 5.0, endSec: 7.5, text: "Independent second group." },
    ];
    const trans: TranslatedCue[] = [
      { index: 1, startSec: 0.0, endSec: 2.0, originalText: cues[0].text, text: "Phần đầu nhóm một," },
      { index: 2, startSec: 2.0, endSec: 4.0, originalText: cues[1].text, text: "phần hai nhóm một." },
      { index: 3, startSec: 5.0, endSec: 7.5, originalText: cues[2].text, text: "Nhóm thứ hai độc lập." },
    ];

    const initialGroups = planDubbingSpeechGroups(cues, trans).map((g) => ({
      ...g,
      status: "ready" as const,
    }));
    assert.equal(initialGroups.length, 2);

    const existingSegments: Record<number, DubAudioSegment> = {
      1: {
        cueIndex: 1,
        groupId: initialGroups[0].groupId,
        groupCueIndices: [1, 2],
        isGroupPrimary: true,
        primaryCueIndex: 1,
        rawDurationSec: 3.5,
        targetDurationSec: 4.0,
        fittedDurationSec: 3.5,
        speedFactor: 1.0,
        audioStartSec: 0.0,
        audioEndSec: 3.5,
        status: "ready",
      },
      2: {
        cueIndex: 2,
        groupId: initialGroups[0].groupId,
        groupCueIndices: [1, 2],
        isGroupPrimary: false,
        primaryCueIndex: 1,
        rawDurationSec: 0,
        targetDurationSec: 2.0,
        fittedDurationSec: 0,
        speedFactor: 1.0,
        audioStartSec: 2.0,
        audioEndSec: 2.0,
        status: "ready",
      },
      3: {
        cueIndex: 3,
        groupId: initialGroups[1].groupId,
        groupCueIndices: [3],
        isGroupPrimary: true,
        primaryCueIndex: 3,
        rawDurationSec: 2.0,
        targetDurationSec: 2.5,
        fittedDurationSec: 2.0,
        speedFactor: 1.0,
        audioStartSec: 5.0,
        audioEndSec: 7.0,
        status: "ready",
      },
    };

    // User edits cue #2
    const updatedTrans = trans.map((c) =>
      c.index === 2 ? { ...c, text: "phần hai đã chỉnh sửa.", isEdited: true } : c
    );
    const { updatedGroups, updatedSegments } = rebuildGroupAfterCueEdit(
      initialGroups,
      updatedTrans,
      2,
      existingSegments
    );

    assert.equal(updatedGroups[0].status, "modified");
    assert.equal(updatedGroups[0].isUserModified, true);
    assert.equal(
      updatedGroups[0].speechText,
      "Phần đầu nhóm một, phần hai đã chỉnh sửa."
    );
    assert.equal(updatedSegments[1].status, "modified");
    assert.equal(updatedSegments[2].status, "modified");

    // Group 2 and segment 3 remain untouched and ready!
    assert.equal(updatedGroups[1].status, "ready");
    assert.equal(updatedGroups[1].speechText, "Nhóm thứ hai độc lập.");
    assert.equal(updatedSegments[3].status, "ready");

    // Find group by cue index
    const found = findSpeechGroupByCueIndex(updatedGroups, 2);
    assert.equal(found?.groupId, updatedGroups[0].groupId);
  });

  it("places group audio once in Master WAV and preserves 1:1 SRT export timestamps", () => {
    const cues: OriginalCue[] = [
      { index: 1, startSec: 0.0, endSec: 2.0, text: "Hello world," },
      { index: 2, startSec: 2.0, endSec: 4.0, text: "welcome to VoxLab." },
      { index: 3, startSec: 4.5, endSec: 6.5, text: "Let us begin." },
    ];
    const trans: TranslatedCue[] = [
      { index: 1, startSec: 0.0, endSec: 2.0, originalText: cues[0].text, text: "Xin chào thế giới," },
      { index: 2, startSec: 2.0, endSec: 4.0, originalText: cues[1].text, text: "chào mừng đến VoxLab." },
      { index: 3, startSec: 4.5, endSec: 6.5, originalText: cues[2].text, text: "Hãy bắt đầu nào." },
    ];

    const groups = planDubbingSpeechGroups(cues, trans);
    assert.equal(groups.length, 2);

    // Expand group 1 (cues 1 & 2) primary segment across cues 1 and 2
    const group1Primary: DubAudioSegment = {
      cueIndex: 1,
      groupId: groups[0].groupId,
      groupCueIndices: [1, 2],
      isGroupPrimary: true,
      primaryCueIndex: 1,
      text: groups[0].speechText,
      rawDurationSec: 3.6,
      targetDurationSec: 4.0,
      fittedDurationSec: 3.6,
      speedFactor: 1.0,
      audioStartSec: 0.0,
      audioEndSec: 3.6,
      status: "ready",
    };
    const group2Primary: DubAudioSegment = {
      cueIndex: 3,
      groupId: groups[1].groupId,
      groupCueIndices: [3],
      isGroupPrimary: true,
      primaryCueIndex: 3,
      text: groups[1].speechText,
      rawDurationSec: 1.8,
      targetDurationSec: 2.0,
      fittedDurationSec: 1.8,
      speedFactor: 1.0,
      audioStartSec: 4.5,
      audioEndSec: 6.3,
      status: "ready",
    };

    const audioSegments = {
      ...expandGroupSegmentToCueSegments(groups[0], group1Primary, cues),
      ...expandGroupSegmentToCueSegments(groups[1], group2Primary, cues),
    };

    const overflow = analyzeTimingCollision(cues, audioSegments);
    assert.equal(canExportMasterWav(overflow).allowed, true);

    const sampleCalls: number[] = [];
    const mergeRes = mergeMasterAudio({
      originalCues: cues,
      audioSegments,
      overflowAnalysis: overflow,
      sampleGetter: (idx) => {
        sampleCalls.push(idx);
        return new Float32Array(1000).fill(0.25);
      },
    });

    assert.equal(mergeRes.ok, true);
    // Master assembly must only fetch audio for primary segments (1 and 3), never follower cue 2!
    assert.deepEqual(sampleCalls, [1, 3]);

    // SRT export must preserve all 3 cues with exact original timestamps
    const srtText = exportToSrt(
      trans.map((c) => ({
        index: c.index,
        startSec: c.startSec,
        endSec: c.endSec,
        text: c.text,
      }))
    );
    assert.ok(srtText.includes("00:00:00,000 --> 00:00:02,000"));
    assert.ok(srtText.includes("00:00:02,000 --> 00:00:04,000"));
    assert.ok(srtText.includes("00:00:04,500 --> 00:00:06,500"));
  });

  it("runs DubbingSynthesisQueue in sentence_group mode without blocking TTS on Whisper QC", async () => {
    const cues: OriginalCue[] = [
      { index: 1, startSec: 0.0, endSec: 2.0, text: "Part one," },
      { index: 2, startSec: 2.0, endSec: 4.2, text: "part two." },
    ];
    const trans: TranslatedCue[] = [
      { index: 1, startSec: 0.0, endSec: 2.0, originalText: cues[0].text, text: "Phần một," },
      { index: 2, startSec: 2.0, endSec: 4.2, originalText: cues[1].text, text: "phần hai." },
    ];
    const groups = planDubbingSpeechGroups(cues, trans);
    assert.equal(groups.length, 1);

    const startedIndices: number[] = [];
    const completedSegments: DubAudioSegment[] = [];

    await new Promise<void>((resolve, reject) => {
      const queue = new DubbingSynthesisQueue({
        onJobStarted: (idx) => {
          startedIndices.push(idx);
        },
        onJobCompleted: (_idx, seg) => {
          completedSegments.push(seg);
        },
        onJobFailed: (_idx, err) => reject(new Error(err)),
        onProgress: () => {},
        onQueueFinished: () => resolve(),
      });

      queue.setJobs([
        {
          originalCue: cues[0],
          translatedCue: trans[0],
          speechGroup: groups[0],
          voiceId: "voice_01",
          autoFit: true,
        },
      ]);
      queue.start();
    });

    assert.deepEqual(startedIndices, [1]);
    assert.equal(completedSegments.length, 1);
    assert.equal(completedSegments[0].groupId, groups[0].groupId);
    assert.deepEqual(completedSegments[0].groupCueIndices, [1, 2]);
  });
});
