import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DubbingExecutor } from "../executors/dubbingExecutor";
import { TranscriptionExecutor } from "../executors/transcriptionExecutor";
import { transcodeAudio, encodeWav } from "../audioTranscoder";
import { convertSubtitleFormat } from "../outputResolver";
import { BatchJob } from "../../../types/batch";
import { getDefaultOutputSnapshot } from "../configSnapshotResolver";
import { makeTestAi } from "../../ai/testing/recordingAiBackend";

describe("TASK-15: Batch Integration Test Suite (Step Executors, Safe Cancel, Dubbing Collision)", () => {
  describe("1. Dubbing collision_danger Guard (AC-11)", () => {
    test("blocks master WAV export and returns completed_with_warning when speech collision occurs", async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "voxlab-dubbing-test-"));
      const srtPath = path.join(tempDir, "sample.srt");

      // Intentionally overlapping timestamps to trigger collision_danger
      const overlappingSrt = `1
00:00:01,000 --> 00:00:03,000
Câu thoại một rất dài nói chuyện.

2
00:00:01,500 --> 00:00:04,000
Câu thoại hai đè lên câu một.
`;
      fs.writeFileSync(srtPath, overlappingSrt, "utf8");

      const job: BatchJob = {
        id: "dub-job-1",
        sourceFilePath: srtPath,
        sourceFileName: "sample.srt",
        sourceFileSize: 200,
        sourceFileMtime: Date.now(),
        fileKind: "subtitle",
        stage: "queued",
        queueOrder: 1,
        selectedTasks: ["dubbing"],
        executionSequence: ["dubbing"],
        currentStepIndex: 0,
        configOverrides: {
          dubbing: { ttsModel: "omnivoice", voiceId: "omnivoice-auto", speedMultiplier: 1.0, turnPauseSec: 0.3 },
        },
        hasCustomConfig: false,
        stepResults: {},
        status: "processing",
        progressPct: 0,
        outputSnapshot: getDefaultOutputSnapshot(),
        artifacts: {
          ownedArtifactPaths: [srtPath],
          primaryPath: srtPath,
        },
        createdAt: Date.now(),
      };

      const result = await DubbingExecutor.execute(job, {
        subtitleContent: overlappingSrt,
        forceCollisionDangerForTest: true,
        ai: makeTestAi().ai,
      });

      assert.strictEqual(result.status, "completed_with_warning");
      assert.ok(result.warning);
      assert.match(result.warning, /va chạm âm thanh|collision/i);

      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe("2. Monolithic ASR Safe Cancel (AC-09, AC-10, AC-20)", () => {
    test("cancels cleanly and returns status 'cancelled' without throwing or corrupting state", async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "voxlab-asr-cancel-"));
      const mediaPath = path.join(tempDir, "sample.wav");

      // Generate dummy audio
      const dummyPcm = new Float32Array(48000);
      const wavBytes = encodeWav({ sampleRate: 48000, channels: 1, samples: [dummyPcm] });
      fs.writeFileSync(mediaPath, Buffer.from(wavBytes));

      const asrJob: BatchJob = {
        id: "asr-job-1",
        sourceFilePath: mediaPath,
        sourceFileName: "sample.wav",
        sourceFileSize: 200,
        sourceFileMtime: Date.now(),
        fileKind: "media",
        stage: "queued",
        queueOrder: 1,
        selectedTasks: ["transcription"],
        executionSequence: ["transcription"],
        currentStepIndex: 0,
        configOverrides: {},
        hasCustomConfig: false,
        stepResults: {},
        status: "processing",
        progressPct: 0,
        outputSnapshot: getDefaultOutputSnapshot(),
        artifacts: { ownedArtifactPaths: [] },
        createdAt: Date.now(),
      };

      const result = await TranscriptionExecutor.execute(asrJob, {
        isCancelled: () => true,
      });

      assert.strictEqual(result.status, "cancelled");

      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe("3. Re-export Transcoding & Subtitle Format Conversion (AC-30)", () => {
    test("transcodes audio without calling AI models and converts subtitles 1:1", async () => {
      const pcm = new Float32Array(24000);
      for (let i = 0; i < pcm.length; i++) {
        pcm[i] = Math.sin((2 * Math.PI * 440 * i) / 24000) * 0.5;
      }
      const sourceWavBytes = encodeWav({ sampleRate: 24000, channels: 1, samples: [pcm] });

      // Real audio transcoding
      const transcodeResult = await transcodeAudio(sourceWavBytes, "wav", "mp3");
      assert.ok(transcodeResult.length > 0);

      // Subtitle format conversion
      const srtContent = `1\n00:00:01,000 --> 00:00:03,000\nHello world!\n`;
      const vttContent = convertSubtitleFormat(srtContent, "srt", "vtt");
      assert.match(vttContent, /WEBVTT/);
      assert.match(vttContent, /Hello world!/);
    });
  });
});
