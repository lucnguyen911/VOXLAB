import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculateTimingFit, MAX_DUB_SPEEDUP } from "../timingFit";
import {
  analyzeTimingCollision,
  canExportMasterWav,
} from "../collisionDetector";
import {
  encode16BitMonoWav,
  CANONICAL_SAMPLE_RATE,
  CANONICAL_NUM_CHANNELS,
  CANONICAL_BITS_PER_SAMPLE,
} from "../audioNormalizer";
import { DubbingSynthesisQueue } from "../synthesisQueue";
import { OriginalCue, TranslatedCue, DubAudioSegment } from "../../../types/dubbing";

describe("Phase 6: Audio Synthesis Queue, WSOLA Timing Fit & Collision Engine Suite", () => {
  describe("WSOLA Timing Fit Algorithm (TASK-14 / AC-22)", () => {
    it("applies 1.0x identity when raw duration fits inside available duration", () => {
      const fit = calculateTimingFit(2.5, 3.0);
      assert.equal(fit.speedFactor, 1.0);
      assert.equal(fit.fittedDurationSec, 2.5);
      assert.equal(fit.isStretched, false);
    });

    it("stretches speech when raw duration is slightly longer than available duration", () => {
      // 3.0s into 2.8s -> ratio = ~1.071
      const fit = calculateTimingFit(3.0, 2.8);
      assert.ok(fit.speedFactor > 1.0 && fit.speedFactor <= MAX_DUB_SPEEDUP);
      assert.equal(fit.isStretched, true);
      assert.equal(fit.fittedDurationSec, 2.8);
    });

    it("clamps speedup strictly to 1.20x ceiling when overflow is extreme (AC-22)", () => {
      // 5.0s into 2.0s -> desired factor 2.5x, MUST clamp to 1.20x
      const fit = calculateTimingFit(5.0, 2.0);
      assert.equal(fit.speedFactor, 1.20);
      assert.equal(fit.fittedDurationSec, Number((5.0 / 1.2).toFixed(3)));
      assert.equal(fit.isStretched, true);
    });
  });

  describe("Collision Detection Engine (TASK-15 / AC-22)", () => {
    const originalCues: OriginalCue[] = [
      { index: 1, startSec: 0.0, endSec: 2.0, text: "Cue 1" },
      { index: 2, startSec: 3.0, endSec: 5.0, text: "Cue 2" },
      { index: 3, startSec: 6.0, endSec: 8.0, text: "Cue 3" },
    ];

    it("marks warningLevel as 'none' when all audio segments fit within cue endSec", () => {
      const segments: Record<number, DubAudioSegment> = {
        1: { cueIndex: 1, rawDurationSec: 1.8, targetDurationSec: 2.0, fittedDurationSec: 1.8, speedFactor: 1.0, audioStartSec: 0.0, audioEndSec: 1.8, status: "ready" },
        2: { cueIndex: 2, rawDurationSec: 1.9, targetDurationSec: 2.0, fittedDurationSec: 1.9, speedFactor: 1.0, audioStartSec: 3.0, audioEndSec: 4.9, status: "ready" },
        3: { cueIndex: 3, rawDurationSec: 1.5, targetDurationSec: 2.0, fittedDurationSec: 1.5, speedFactor: 1.0, audioStartSec: 6.0, audioEndSec: 7.5, status: "ready" },
      };

      const analysis = analyzeTimingCollision(originalCues, segments);
      assert.equal(analysis[1].warningLevel, "none");
      assert.equal(analysis[2].warningLevel, "none");
      assert.equal(analysis[3].warningLevel, "none");

      const check = canExportMasterWav(analysis);
      assert.equal(check.allowed, true);
    });

    it("classifies as 'overflow_only' when audio exceeds cue endSec but ends before next cue (ALLOWS export)", () => {
      // Cue 1 ends at 2.0s, Next cue starts at 3.0s. Audio ends at 2.4s.
      const segments: Record<number, DubAudioSegment> = {
        1: { cueIndex: 1, rawDurationSec: 2.4, targetDurationSec: 2.0, fittedDurationSec: 2.4, speedFactor: 1.0, audioStartSec: 0.0, audioEndSec: 2.4, status: "ready" },
      };

      const analysis = analyzeTimingCollision(originalCues, segments);
      assert.equal(analysis[1].warningLevel, "overflow_only");
      assert.equal(analysis[1].hasOverflow, true);
      assert.equal(analysis[1].overflowSec, 0.4);
      assert.equal(analysis[1].hasCollision, false);

      const check = canExportMasterWav(analysis);
      assert.equal(check.allowed, true);
    });

    it("classifies as 'collision_danger' when audio overlaps subsequent cue startSec (BLOCKS export)", () => {
      // Cue 1 ends at 2.0s, Next cue starts at 3.0s. Audio ends at 3.5s (collides with Cue 2 by 0.5s!)
      const segments: Record<number, DubAudioSegment> = {
        1: { cueIndex: 1, rawDurationSec: 3.5, targetDurationSec: 2.0, fittedDurationSec: 3.5, speedFactor: 1.0, audioStartSec: 0.0, audioEndSec: 3.5, status: "ready" },
      };

      const analysis = analyzeTimingCollision(originalCues, segments);
      assert.equal(analysis[1].warningLevel, "collision_danger");
      assert.equal(analysis[1].hasCollision, true);
      assert.equal(analysis[1].collisionWithIndex, 2);
      assert.equal(analysis[1].collisionSec, 0.5);

      const check = canExportMasterWav(analysis);
      assert.equal(check.allowed, false);
      assert.ok(check.reason?.includes("va chạm"));
    });

    it("classifies overflow on the final cue as 'overflow_only' (ALLOWS export since no next cue)", () => {
      // Cue 3 ends at 8.0s, audio ends at 9.2s. No cue 4 exists.
      const segments: Record<number, DubAudioSegment> = {
        3: { cueIndex: 3, rawDurationSec: 3.2, targetDurationSec: 2.0, fittedDurationSec: 3.2, speedFactor: 1.0, audioStartSec: 6.0, audioEndSec: 9.2, status: "ready" },
      };

      const analysis = analyzeTimingCollision(originalCues, segments);
      assert.equal(analysis[3].warningLevel, "overflow_only");
      assert.equal(analysis[3].hasOverflow, true);
      assert.equal(analysis[3].hasCollision, false);

      const check = canExportMasterWav(analysis);
      assert.equal(check.allowed, true);
    });
  });

  describe("Canonical Audio Normalizer (TASK-13 / AC-27)", () => {
    it("generates a valid 44-byte WAV header matching Canonical 44.1kHz 16-bit Mono", () => {
      const dummySamples = new Float32Array(44100); // 1 second of audio
      const buffer = encode16BitMonoWav(dummySamples, CANONICAL_SAMPLE_RATE);

      const view = new DataView(buffer);
      const readString = (offset: number, length: number) => {
        let str = "";
        for (let i = 0; i < length; i++) {
          str += String.fromCharCode(view.getUint8(offset + i));
        }
        return str;
      };

      assert.equal(readString(0, 4), "RIFF");
      assert.equal(readString(8, 4), "WAVE");
      assert.equal(readString(12, 4), "fmt ");
      assert.equal(view.getUint16(20, true), 1); // PCM
      assert.equal(view.getUint16(22, true), CANONICAL_NUM_CHANNELS); // 1 Mono
      assert.equal(view.getUint32(24, true), CANONICAL_SAMPLE_RATE); // 44100 Hz
      assert.equal(view.getUint16(34, true), CANONICAL_BITS_PER_SAMPLE); // 16-bit
      assert.equal(readString(36, 4), "data");
      assert.equal(view.getUint32(40, true), 44100 * 2); // 88200 bytes
    });
  });

  describe("Dubbing Synthesis Queue (TASK-13)", () => {
    it("processes batch jobs and triggers callbacks in order", async () => {
      const completedCues: number[] = [];
      let finished = false;

      const queue = new DubbingSynthesisQueue({
        onJobCompleted: (cueIndex) => {
          completedCues.push(cueIndex);
        },
        onQueueFinished: () => {
          finished = true;
        },
      });

      const orig: OriginalCue = { index: 1, startSec: 0, endSec: 2, text: "Test" };
      const trans: TranslatedCue = { index: 1, startSec: 0, endSec: 2, originalText: "Test", text: "Thử nghiệm" };

      queue.setJobs([{ originalCue: orig, translatedCue: trans, voiceId: "voice1" }]);
      queue.start();

      // Wait brief tick for async job completion
      await new Promise((resolve) => setTimeout(resolve, 50));

      assert.deepEqual(completedCues, [1]);
      assert.equal(finished, true);
      assert.equal(queue.getState(), "completed");
    });
  });
});
