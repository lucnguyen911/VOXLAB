import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveTimingCollisions } from "../autoFit";
import { analyzeTimingCollision, canExportMasterWav } from "../collisionDetector";
import { OriginalCue, DubAudioSegment } from "../../../types/dubbing";

describe("Dubbing Auto-Fit & Adaptive Time-Stretch Suite", () => {
  const originalCues: OriginalCue[] = [
    { index: 1, startSec: 0.0, endSec: 2.0, text: "Cue 1" },
    { index: 2, startSec: 2.2, endSec: 4.6, text: "Cue 2" },
    { index: 3, startSec: 4.6, endSec: 7.0, text: "Cue 3" },
    { index: 4, startSec: 7.5, endSec: 9.0, text: "Cue 4" },
  ];

  it("leaves segments untouched when there are no collisions", () => {
    const segments: Record<number, DubAudioSegment> = {
      1: { cueIndex: 1, rawDurationSec: 1.8, targetDurationSec: 2.0, fittedDurationSec: 1.8, speedFactor: 1.0, audioStartSec: 0.0, audioEndSec: 1.8, status: "ready" },
      2: { cueIndex: 2, rawDurationSec: 2.2, targetDurationSec: 2.4, fittedDurationSec: 2.2, speedFactor: 1.0, audioStartSec: 2.2, audioEndSec: 4.4, status: "ready" },
    };

    const resolved = resolveTimingCollisions(originalCues, segments);
    assert.equal(resolved[1].fittedDurationSec, 1.8);
    assert.equal(resolved[2].fittedDurationSec, 2.2);

    const analysis = analyzeTimingCollision(originalCues, resolved);
    assert.equal(canExportMasterWav(analysis).allowed, true);
  });

  it("resolves single collision by accelerating speed factor (<= 1.20x) to fit before next cue", () => {
    // Cue 2 starts at 2.2s, Cue 3 starts at 4.6s (window = 2.4s).
    // Raw audio is 2.8s (ends at 5.0s -> collides with Cue 3 by 0.4s, requires ~1.18x <= 1.20x).
    const segments: Record<number, DubAudioSegment> = {
      1: { cueIndex: 1, rawDurationSec: 1.8, targetDurationSec: 2.0, fittedDurationSec: 1.8, speedFactor: 1.0, audioStartSec: 0.0, audioEndSec: 1.8, status: "ready" },
      2: { cueIndex: 2, rawDurationSec: 2.8, targetDurationSec: 2.4, fittedDurationSec: 2.8, speedFactor: 1.0, audioStartSec: 2.2, audioEndSec: 5.0, status: "ready" },
      3: { cueIndex: 3, rawDurationSec: 2.0, targetDurationSec: 2.4, fittedDurationSec: 2.0, speedFactor: 1.0, audioStartSec: 4.6, audioEndSec: 6.6, status: "ready" },
    };

    // Before auto-fit: collision exists, export blocked
    const beforeAnalysis = analyzeTimingCollision(originalCues, segments);
    assert.equal(beforeAnalysis[2].warningLevel, "collision_danger");
    assert.equal(canExportMasterWav(beforeAnalysis).allowed, false);

    // After auto-fit:
    const resolved = resolveTimingCollisions(originalCues, segments);
    const afterAnalysis = analyzeTimingCollision(originalCues, resolved);

    assert.notEqual(afterAnalysis[2].warningLevel, "collision_danger");
    assert.equal(canExportMasterWav(afterAnalysis).allowed, true);
    assert.ok(resolved[2].audioEndSec <= originalCues[2].startSec);
    assert.ok(resolved[2].speedFactor > 1.0 && resolved[2].speedFactor <= 1.2);
  });

  it("resolves multiple consecutive collisions across cues within the 1.20x ceiling", () => {
    // Both Cue 2 (window 2.4s) and Cue 3 (window 2.9s before Cue 4 at 7.5s) collide with subsequent cues
    const segments: Record<number, DubAudioSegment> = {
      2: { cueIndex: 2, rawDurationSec: 2.8, targetDurationSec: 2.4, fittedDurationSec: 2.8, speedFactor: 1.0, audioStartSec: 2.2, audioEndSec: 5.0, status: "ready" },
      3: { cueIndex: 3, rawDurationSec: 3.3, targetDurationSec: 2.4, fittedDurationSec: 3.3, speedFactor: 1.0, audioStartSec: 4.6, audioEndSec: 7.9, status: "ready" },
    };

    const resolved = resolveTimingCollisions(originalCues, segments);
    const afterAnalysis = analyzeTimingCollision(originalCues, resolved);

    assert.equal(afterAnalysis[2].warningLevel !== "collision_danger", true);
    assert.equal(afterAnalysis[3].warningLevel !== "collision_danger", true);
    assert.equal(canExportMasterWav(afterAnalysis).allowed, true);
  });

  it("enforces MAX_DUB_SPEEDUP = 1.20x without fake duration clamping when overflow exceeds 1.20x", () => {
    // Cue 2 window before Cue 3 is 2.4s (4.6 - 2.2).
    // Raw duration 3.6s at 1.20x max speedup is 3.0s -> still ends at 5.2s > 4.6s!
    const segments: Record<number, DubAudioSegment> = {
      2: { cueIndex: 2, rawDurationSec: 3.6, targetDurationSec: 2.4, fittedDurationSec: 3.6, speedFactor: 1.0, audioStartSec: 2.2, audioEndSec: 5.8, status: "ready" },
      3: { cueIndex: 3, rawDurationSec: 2.0, targetDurationSec: 2.4, fittedDurationSec: 2.0, speedFactor: 1.0, audioStartSec: 4.6, audioEndSec: 6.6, status: "ready" },
    };

    const resolved = resolveTimingCollisions(originalCues, segments, { maxSpeedup: 1.45 });
    assert.equal(resolved[2].speedFactor, 1.2);
    assert.equal(resolved[2].fittedDurationSec, 3.0);
    assert.equal(resolved[2].audioEndSec, 5.2);

    const afterAnalysis = analyzeTimingCollision(originalCues, resolved);
    assert.equal(afterAnalysis[2].warningLevel, "collision_danger");
    assert.equal(canExportMasterWav(afterAnalysis).allowed, false);
  });

  it("preserves overflow_only status when audio fits into silence gap without colliding", () => {
    // Cue 1 ends at 2.0s, Cue 2 starts at 2.2s. Gap is 0.2s.
    // Audio ends at 2.1s (overflows cue 1 endSec, but finishes before Cue 2 starts at 2.2s)
    const segments: Record<number, DubAudioSegment> = {
      1: { cueIndex: 1, rawDurationSec: 2.1, targetDurationSec: 2.0, fittedDurationSec: 2.1, speedFactor: 1.0, audioStartSec: 0.0, audioEndSec: 2.1, status: "ready" },
    };

    const resolved = resolveTimingCollisions(originalCues, segments);
    const analysis = analyzeTimingCollision(originalCues, resolved);

    assert.equal(analysis[1].warningLevel, "overflow_only");
    assert.equal(canExportMasterWav(analysis).allowed, true);
  });
});
