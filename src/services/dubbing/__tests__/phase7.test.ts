import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { preflightMemoryCheck } from "../memoryGuardrail";
import { exportTranslatedSrt } from "../srtExport";
import { mergeMasterAudio } from "../masterAssembly";
import {
  OriginalCue,
  TranslatedCue,
  DubAudioSegment,
  TimingOverflowMetadata,
} from "../../../types/dubbing";

describe("Phase 7: Master WAV Assembly, Memory Preflight & Translated SRT Export", () => {
  describe("Memory Preflight Guardrail (TASK-17 / AC-30)", () => {
    it("allows 30 minutes (1800s) with no warnings", () => {
      const check = preflightMemoryCheck(1800);
      assert.equal(check.allowed, true);
      assert.equal(check.warningLevel, "none");
    });

    it("displays advisory warning for 65 minutes (3900s) without blocking", () => {
      const check = preflightMemoryCheck(3900);
      assert.equal(check.allowed, true);
      assert.equal(check.warningLevel, "warning_large");
      assert.ok(check.message?.includes("Dự án dài (> 60 phút)"));
    });

    it("unconditionally rejects projects exceeding 120 minutes (7260s / > 635MB)", () => {
      const check = preflightMemoryCheck(7260);
      assert.equal(check.allowed, false);
      assert.equal(check.warningLevel, "reject_oom");
      assert.ok(check.message?.includes("vượt quá giới hạn thời lượng 120 phút"));
    });
  });

  describe("Translated SRT Export (TASK-18 / AC-23)", () => {
    it("strictly preserves original timeline timestamps in exported SRT", () => {
      const translatedCues: TranslatedCue[] = [
        {
          index: 1,
          startSec: 1.25,
          endSec: 4.5,
          originalText: "Hello world.",
          text: "Xin chào thế giới.",
        },
        {
          index: 2,
          startSec: 5.0,
          endSec: 8.2,
          originalText: "Dubbing in progress.",
          text: "Đang lồng tiếng.",
        },
      ];

      const srt = exportTranslatedSrt(translatedCues);
      assert.ok(srt.includes("1\n00:00:01,250 --> 00:00:04,500\nXin chào thế giới."));
      assert.ok(srt.includes("2\n00:00:05,000 --> 00:00:08,200\nĐang lồng tiếng."));
    });
  });

  describe("Master WAV Audio Assembly (TASK-16 / AC-23)", () => {
    const originalCues: OriginalCue[] = [
      { index: 1, startSec: 0.0, endSec: 2.0, text: "Cue 1" },
      { index: 2, startSec: 3.0, endSec: 5.0, text: "Cue 2" },
    ];

    it("rejects assembly if any cue is not in 'ready' status", () => {
      const audioSegments: Record<number, DubAudioSegment> = {
        1: { cueIndex: 1, rawDurationSec: 2.0, targetDurationSec: 2.0, fittedDurationSec: 2.0, speedFactor: 1.0, audioStartSec: 0, audioEndSec: 2, status: "ready" },
        2: { cueIndex: 2, rawDurationSec: 2.0, targetDurationSec: 2.0, fittedDurationSec: 2.0, speedFactor: 1.0, audioStartSec: 3, audioEndSec: 5, status: "modified" }, // Not ready!
      };

      const result = mergeMasterAudio({
        originalCues,
        audioSegments,
        overflowAnalysis: {},
      });

      assert.equal(result.ok, false);
      assert.ok(result.reason?.includes("chưa có âm thanh sẵn sàng"));
    });

    it("rejects assembly if collision_danger is present", () => {
      const audioSegments: Record<number, DubAudioSegment> = {
        1: { cueIndex: 1, rawDurationSec: 3.5, targetDurationSec: 2.0, fittedDurationSec: 3.5, speedFactor: 1.0, audioStartSec: 0, audioEndSec: 3.5, status: "ready" },
        2: { cueIndex: 2, rawDurationSec: 2.0, targetDurationSec: 2.0, fittedDurationSec: 2.0, speedFactor: 1.0, audioStartSec: 3, audioEndSec: 5, status: "ready" },
      };

      const overflowAnalysis: Record<number, TimingOverflowMetadata> = {
        1: { cueIndex: 1, hasOverflow: true, overflowSec: 1.5, hasCollision: true, collisionWithIndex: 2, collisionSec: 0.5, warningLevel: "collision_danger" },
      };

      const result = mergeMasterAudio({
        originalCues,
        audioSegments,
        overflowAnalysis,
      });

      assert.equal(result.ok, false);
      assert.ok(result.reason?.includes("va chạm âm thanh"));
    });

    it("auto-resolves collisions and succeeds when autoResolveCollisions is true", () => {
      const audioSegments: Record<number, DubAudioSegment> = {
        1: { cueIndex: 1, rawDurationSec: 3.5, targetDurationSec: 2.0, fittedDurationSec: 3.5, speedFactor: 1.0, audioStartSec: 0, audioEndSec: 3.5, status: "ready" },
        2: { cueIndex: 2, rawDurationSec: 2.0, targetDurationSec: 2.0, fittedDurationSec: 2.0, speedFactor: 1.0, audioStartSec: 3, audioEndSec: 5, status: "ready" },
      };

      const overflowAnalysis: Record<number, TimingOverflowMetadata> = {
        1: { cueIndex: 1, hasOverflow: true, overflowSec: 1.5, hasCollision: true, collisionWithIndex: 2, collisionSec: 0.5, warningLevel: "collision_danger" },
      };

      const result = mergeMasterAudio({
        originalCues,
        audioSegments,
        overflowAnalysis,
        autoResolveCollisions: true,
      });

      assert.equal(result.ok, true);
      assert.ok(result.blob);
      assert.ok(result.resolvedSegments);
      assert.ok(result.resolvedSegments[1].speedFactor > 1.0);
    });

    it("successfully creates Master WAV Blob when all segments are ready without collision", () => {
      const audioSegments: Record<number, DubAudioSegment> = {
        1: { cueIndex: 1, rawDurationSec: 2.0, targetDurationSec: 2.0, fittedDurationSec: 2.0, speedFactor: 1.0, audioStartSec: 0, audioEndSec: 2, status: "ready" },
        2: { cueIndex: 2, rawDurationSec: 2.0, targetDurationSec: 2.0, fittedDurationSec: 2.0, speedFactor: 1.0, audioStartSec: 3, audioEndSec: 5, status: "ready" },
      };

      const overflowAnalysis: Record<number, TimingOverflowMetadata> = {
        1: { cueIndex: 1, hasOverflow: false, overflowSec: 0, hasCollision: false, collisionSec: 0, warningLevel: "none" },
        2: { cueIndex: 2, hasOverflow: false, overflowSec: 0, hasCollision: false, collisionSec: 0, warningLevel: "none" },
      };

      const result = mergeMasterAudio({
        originalCues,
        audioSegments,
        overflowAnalysis,
      });

      assert.equal(result.ok, true);
      assert.equal(result.totalDurationSec, 5.0);
      assert.ok(result.blob);
      assert.equal(result.blob?.type, "audio/wav");
      assert.ok((result.totalBytes || 0) > 44);
    });
  });
});
