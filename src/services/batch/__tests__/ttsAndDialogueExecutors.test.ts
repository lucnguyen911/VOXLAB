import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TtsExecutor } from "../executors/ttsExecutor";
import { DialogueExecutor } from "../executors/dialogueExecutor";
import { BatchJob } from "../../../types/batch";
import { makeTestAi } from "../../ai/testing/recordingAiBackend";

describe("TTS & Dialogue Step Executors (TASK-07 / AC-03, AC-04, AC-19)", () => {
  const baseTtsJob: BatchJob = {
    id: "job-tts-1",
    stage: "queued",
    queueOrder: 1,
    sourceFilePath: "D:/Audiobooks/chapter1.txt",
    sourceFileName: "chapter1.txt",
    sourceFileSize: 512,
    sourceFileMtime: 1000,
    fileKind: "text",
    selectedTasks: ["tts"],
    executionSequence: ["tts"],
    currentStepIndex: 0,
    configOverrides: {
      tts: {
        model: "omnivoice",
        voiceId: "omnivoice-auto",
        speed: 1.0,
        pitch: 0,
        volume: 100,
      },
    },
    hasCustomConfig: false,
    outputSnapshot: {
      saveInSourceFolder: false,
      resolvedOutputDirectory: "F:/VoxLabExports",
      collisionPolicy: "auto_rename",
      outputAudioFormat: "wav",
      outputSubtitleFormat: "srt",
    },
    artifacts: { ownedArtifactPaths: [] },
    status: "waiting",
    progressPct: 0,
    stepResults: {},
    createdAt: 1000,
  };

  describe("TtsExecutor", () => {
    it("synthesizes every chunk with the local engine and assembles a WAV master from the real chunk files", async () => {
      const progressUpdates: number[] = [];
      const { ai, backend } = makeTestAi();

      const result = await TtsExecutor.execute(baseTtsJob, {
        textContent: "Hôm nay trời rất đẹp. Chúng ta cùng đi dạo trong công viên nhé.",
        onProgress: (pct) => progressUpdates.push(pct),
        writeFile: async () => {},
        ai,
      });

      assert.equal(result.status, "completed");
      assert.equal(result.progressPct, 100);
      assert.ok(progressUpdates.includes(100));

      const audioPath = result.outputArtifactPaths.find((p) => p.endsWith(".wav"));
      assert.ok(audioPath, "Master audio WAV path must be registered");

      const synths = backend.calls.filter((c) => c.method === "tts.synthesize");
      assert.ok(synths.length >= 1);
      assert.ok(synths.every((c) => c.params.engine === "omnivoice" && c.runtime === "core"));
      assert.equal(synths[0].params.language, "vi");

      const assemble = backend.calls.find((c) => c.method === "audio.assemble");
      assert.ok(assemble);
      assert.equal(assemble.params.outputPath, audioPath);
      assert.equal(assemble.params.format, "wav");
      const inputs = assemble.params.inputs as { path: string }[];
      assert.deepEqual(inputs.map((i) => i.path), synths.map((s) => s.params.outputPath));
      // Model is loaded once for all chunks (one model resident; no reload per chunk).
      assert.equal(backend.methods().filter((m) => m === "tts.load").length, 1);
    });

    it("requests a real MP3 encode from the sidecar when outputAudioFormat is mp3", async () => {
      const mp3Job: BatchJob = {
        ...baseTtsJob,
        id: "job-tts-mp3",
        outputSnapshot: {
          ...baseTtsJob.outputSnapshot,
          outputAudioFormat: "mp3",
        },
      };
      const { ai, backend } = makeTestAi();
      const result = await TtsExecutor.execute(mp3Job, {
        textContent: "Thử nghiệm xuất tệp định dạng âm thanh MP3 thực tế.",
        ai,
      });

      assert.equal(result.status, "completed");
      const mp3Path = result.outputArtifactPaths.find((p) => p.endsWith(".mp3"));
      assert.ok(mp3Path, "MP3 artifact path must be registered");
      const assemble = backend.calls.find((c) => c.method === "audio.assemble");
      assert.equal(assemble?.params.format, "mp3");
      assert.equal(assemble?.params.outputPath, mp3Path);
    });

    it("text pipeline subtitles come from real synthesized durations and never call Whisper", async () => {
      const job: BatchJob = { ...baseTtsJob, selectedTasks: ["tts", "transcription"] };
      const written = new Map<string, Uint8Array | string>();
      const { ai, backend } = makeTestAi({ durationFor: () => 2 });
      const result = await TtsExecutor.execute(job, {
        textContent: "Câu thứ nhất. Câu thứ hai.",
        writeFile: async (p, c) => { written.set(p, c); },
        ai,
      });
      assert.equal(result.status, "completed");
      const srt = result.outputArtifactPaths.find((p) => p.endsWith(".srt"));
      assert.ok(srt);
      const content = written.get(srt!) as string;
      assert.ok(content.includes("00:00:00,000 --> 00:00:02,000"), content);
      assert.ok(!backend.methods().some((m) => m.startsWith("asr.")), "Text pipeline must not call ASR");
    });

    it("fails explicitly when the local AI runtime is unavailable (no simulated audio)", async () => {
      const result = await TtsExecutor.execute(baseTtsJob, { textContent: "Xin chào." });
      assert.equal(result.status, "failed");
      assert.ok(result.error?.includes("Local AI runtime"));
      assert.equal(result.outputArtifactPaths.length, 0);
    });

    it("fails with a reason and never falls back when the engine cannot serve the language", async () => {
      const job: BatchJob = {
        ...baseTtsJob,
        configOverrides: { tts: { ...baseTtsJob.configOverrides.tts!, model: "chatterbox_turbo" } },
      };
      const { ai, backend } = makeTestAi();
      const result = await TtsExecutor.execute(job, { textContent: "Xin chào các bạn.", ai });
      assert.equal(result.status, "failed");
      assert.ok(result.error?.includes("không hỗ trợ tiếng Việt"), result.error ?? "");
      assert.equal(backend.calls.length, 0, "No engine may be loaded or called");
    });

    it("rejects non-local models instead of silently substituting a local engine", async () => {
      const job: BatchJob = {
        ...baseTtsJob,
        configOverrides: { tts: { ...baseTtsJob.configOverrides.tts!, model: "edge-tts" } },
      };
      const { ai, backend } = makeTestAi();
      const result = await TtsExecutor.execute(job, { textContent: "Xin chào.", ai });
      assert.equal(result.status, "failed");
      assert.ok(result.error?.includes("không phải engine local"));
      assert.equal(backend.calls.length, 0);
    });

    it("maps a sidecar CANCELLED error to a cancelled step", async () => {
      const { ai } = makeTestAi({ failOn: { method: "tts.synthesize", code: "CANCELLED" } });
      const result = await TtsExecutor.execute(baseTtsJob, { textContent: "Câu một. Câu hai.", ai });
      assert.equal(result.status, "cancelled");
      assert.equal(result.outputArtifactPaths.length, 0);
    });

    it("cancels immediately when isCancelled returns true", async () => {
      const { ai } = makeTestAi();
      const result = await TtsExecutor.execute(baseTtsJob, {
        textContent: "Câu 1. Câu 2. Câu 3. Câu 4.",
        isCancelled: () => true,
        ai,
      });

      assert.equal(result.status, "cancelled");
      assert.equal(result.outputArtifactPaths.length, 0);
    });

    it("fails gracefully on empty content", async () => {
      const result = await TtsExecutor.execute(baseTtsJob, {
        textContent: "   ",
      });

      assert.equal(result.status, "failed");
      assert.ok(result.error?.includes("trống"));
    });
  });

  describe("DialogueExecutor", () => {
    const baseDialogueJob: BatchJob = {
      id: "job-dial-1",
      stage: "queued",
      queueOrder: 1,
      sourceFilePath: "D:/Scripts/dialogue.txt",
      sourceFileName: "dialogue.txt",
      sourceFileSize: 512,
      sourceFileMtime: 1000,
      fileKind: "text",
      selectedTasks: ["dialogue"],
      executionSequence: ["dialogue"],
      currentStepIndex: 0,
      configOverrides: {
        dialogue: {
          model: "omnivoice",
          defaultVoiceId: "voice-nam",
          turnPauseSec: 0.6,
          sameSpeakerPauseSec: 0.3,
          exportSrt: true,
          characterVoices: {
            Lan: "voice-lan",
            Nam: "voice-nam",
          },
        },
      },
      hasCustomConfig: false,
      outputSnapshot: {
        saveInSourceFolder: false,
        resolvedOutputDirectory: "F:/VoxLabExports",
        collisionPolicy: "auto_rename",
        outputAudioFormat: "wav",
        outputSubtitleFormat: "srt",
      },
      artifacts: { ownedArtifactPaths: [] },
      status: "waiting",
      progressPct: 0,
      stepResults: {},
      createdAt: 1000,
    };

    const validScript = `[Nam]: Xin chào Lan, hôm nay cậu có rảnh không?
[Lan]: Chào Nam! Chiều nay mình rảnh, có chuyện gì thế?
[Nam]: Chúng ta cùng đi xem phim mới nhé!`;

    const voices = (id: string) =>
      id === "voice-lan"
        ? { refAudioPath: "C:/voices/lan.wav", refText: "Xin chào", language: "vi" }
        : id === "voice-nam"
          ? { refAudioPath: "C:/voices/nam.wav", refText: "Chào bạn", language: "vi" }
          : null;

    it("executes dialogue script, assigns character voices, and exports master WAV and speaker SRT", async () => {
      const writtenFiles = new Map<string, Uint8Array | string>();
      const { ai, backend } = makeTestAi({}, voices);
      const result = await DialogueExecutor.execute(baseDialogueJob, {
        scriptContent: validScript,
        writeFile: async (path, content) => {
          writtenFiles.set(path, content);
        },
        ai,
      });

      assert.equal(result.status, "completed", result.error ?? "");
      assert.equal(result.progressPct, 100);

      const audioPath = result.outputArtifactPaths.find((p) => p.endsWith(".wav"));
      const srtPath = result.outputArtifactPaths.find((p) => p.endsWith(".srt"));

      assert.ok(audioPath, "Master audio WAV path must be registered");
      assert.ok(srtPath, "Speaker subtitle SRT path must be registered");

      // Verify SRT contains character speaker names
      const srtContent = writtenFiles.get(srtPath!) as string;
      assert.ok(srtContent.includes("[Nam]:"));
      assert.ok(srtContent.includes("[Lan]:"));

      // Each turn is synthesized with the character's own clone reference.
      const refs = backend.calls.filter((c) => c.method === "tts.synthesize").map((c) => c.params.refAudioPath);
      assert.deepEqual(refs, ["C:/voices/nam.wav", "C:/voices/lan.wav", "C:/voices/nam.wav"]);
      const assemble = backend.calls.find((c) => c.method === "audio.assemble");
      assert.equal(assemble?.params.outputPath, audioPath);
    });

    it("fails explicitly when the local AI runtime is unavailable", async () => {
      const result = await DialogueExecutor.execute(baseDialogueJob, { scriptContent: validScript });
      assert.equal(result.status, "failed");
      assert.equal(result.outputArtifactPaths.length, 0);
    });

    it("fails when script lacks dialogue markers", async () => {
      const plainText = "Đây là văn bản văn xuôi bình thường không có phân vai nhân vật nào.";
      const result = await DialogueExecutor.execute(baseDialogueJob, {
        scriptContent: plainText,
      });

      assert.equal(result.status, "failed");
      assert.ok(result.error?.includes("phân vai"));
    });

    it("cancels immediately when isCancelled returns true", async () => {
      const { ai } = makeTestAi({}, voices);
      const result = await DialogueExecutor.execute(baseDialogueJob, {
        scriptContent: validScript,
        isCancelled: () => true,
        ai,
      });

      assert.equal(result.status, "cancelled");
      assert.equal(result.outputArtifactPaths.length, 0);
    });
  });
});
