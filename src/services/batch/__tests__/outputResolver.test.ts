import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveArtifactPath,
  resolveJobOutputDirectory,
  isArtifactModifiedExternally,
  shouldSkipDubbingArtifact,
  normalizePath,
  getFileDirectory,
  getFileStem,
} from "../outputResolver";
import { CredentialResolver } from "../credentialResolver";
import { BatchJob } from "../../../types/batch";

describe("OutputResolver & Safety Invariants (TASK-06 / AC-13, AC-17, AC-18, AC-31, AC-32)", () => {
  it("normalizes path separators and extracts directory and stem correctly", () => {
    const winPath = "C:\\Projects\\Media\\sample_video.mp4";
    assert.equal(normalizePath(winPath), "C:/Projects/Media/sample_video.mp4");
    assert.equal(getFileDirectory(winPath), "C:/Projects/Media");
    assert.equal(getFileStem(winPath), "sample_video");
  });

  it("isArtifactModifiedExternally detects changes correctly", () => {
    const recorded = { path: "a.wav", size: 1000, mtimeMs: 5000 };
    assert.equal(isArtifactModifiedExternally(recorded, { size: 1000, mtimeMs: 5000 }), false);
    assert.equal(isArtifactModifiedExternally(recorded, { size: 2000, mtimeMs: 5000 }), true);
    assert.equal(isArtifactModifiedExternally(recorded, { size: 1000, mtimeMs: 9000 }), true);
    assert.equal(isArtifactModifiedExternally(undefined, { size: 1000, mtimeMs: 5000 }), true);
    assert.equal(isArtifactModifiedExternally(recorded, null), false);
  });

  describe("AC-31 & AC-32: Job Output Directory Resolution", () => {
    it("resolves output directory next to source file when saveInSourceFolder = true", () => {
      const job: BatchJob = {
        id: "job-1",
        stage: "queued",
        queueOrder: 1,
        sourceFilePath: "D:/Audiobooks/ProjectA/chapter1.txt",
        sourceFileName: "chapter1.txt",
        sourceFileSize: 1024,
        sourceFileMtime: 1000,
        fileKind: "text",
        selectedTasks: ["tts"],
        executionSequence: ["tts"],
        currentStepIndex: 0,
        configOverrides: {},
        hasCustomConfig: false,
        outputSnapshot: {
          saveInSourceFolder: true,
          resolvedOutputDirectory: "E:/GlobalExport",
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

      const resolvedDir = resolveJobOutputDirectory(job);
      assert.equal(resolvedDir, "D:/Audiobooks/ProjectA/chapter1");
    });

    it("resolves output directory inside global outputPath when saveInSourceFolder = false", () => {
      const job: BatchJob = {
        id: "job-2",
        stage: "queued",
        queueOrder: 2,
        sourceFilePath: "D:/RawFootage/interview.mp4",
        sourceFileName: "interview.mp4",
        sourceFileSize: 2048,
        sourceFileMtime: 1000,
        fileKind: "media",
        selectedTasks: ["transcription"],
        executionSequence: ["transcription"],
        currentStepIndex: 0,
        configOverrides: {},
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

      const resolvedDir = resolveJobOutputDirectory(job);
      assert.equal(resolvedDir, "F:/VoxLabExports/interview");
    });

    it("applies disambiguator suffix for identically named files (AC-31)", () => {
      const job: BatchJob = {
        id: "job-3",
        stage: "queued",
        queueOrder: 3,
        sourceFilePath: "D:/Tape2/voiceover.wav",
        sourceFileName: "voiceover.wav",
        sourceFileSize: 4096,
        sourceFileMtime: 1000,
        fileKind: "media",
        selectedTasks: ["transcription"],
        executionSequence: ["transcription"],
        currentStepIndex: 0,
        configOverrides: {},
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

      const resolvedDir = resolveJobOutputDirectory(job, "part2");
      assert.equal(resolvedDir, "F:/VoxLabExports/voiceover_part2");
    });
  });

  describe("AC-17: External Modification Protection > Global Collision Policy", () => {
    const outputDir = "F:/VoxLabExports/my_job";
    const baseName = "master";
    const extension = "wav";

    it("writes to primary target path when destination does not exist", () => {
      const result = resolveArtifactPath({
        outputDir,
        baseName,
        extension,
        collisionPolicy: "overwrite",
        checkPathExists: () => false,
      });

      assert.equal(result.resolvedPath, "F:/VoxLabExports/my_job/master.wav");
      assert.equal(result.action, "write");
      assert.equal(result.isExternalModified, false);
    });

    it("honors collisionPolicy = 'skip' when file exists and matches fingerprint", () => {
      const recorded = {
        path: "F:/VoxLabExports/my_job/master.wav",
        size: 5000,
        mtimeMs: 1700000000000,
      };

      const result = resolveArtifactPath({
        outputDir,
        baseName,
        extension,
        collisionPolicy: "skip",
        recordedFingerprint: recorded,
        currentFileStats: { size: 5000, mtimeMs: 1700000000000 },
        checkPathExists: () => true,
      });

      assert.equal(result.resolvedPath, "F:/VoxLabExports/my_job/master.wav");
      assert.equal(result.action, "skip");
      assert.equal(result.isExternalModified, false);
    });

    it("honors collisionPolicy = 'overwrite' when file exists and matches fingerprint", () => {
      const recorded = {
        path: "F:/VoxLabExports/my_job/master.wav",
        size: 5000,
        mtimeMs: 1700000000000,
      };

      const result = resolveArtifactPath({
        outputDir,
        baseName,
        extension,
        collisionPolicy: "overwrite",
        recordedFingerprint: recorded,
        currentFileStats: { size: 5000, mtimeMs: 1700000000000 },
        checkPathExists: () => true,
      });

      assert.equal(result.resolvedPath, "F:/VoxLabExports/my_job/master.wav");
      assert.equal(result.action, "overwrite");
      assert.equal(result.isExternalModified, false);
    });

    it("CRITICAL AC-17: When file is externally modified, NEVER overwrites even if collisionPolicy = 'overwrite', fallbacks to auto_rename", () => {
      const recorded = {
        path: "F:/VoxLabExports/my_job/master.wav",
        size: 5000,
        mtimeMs: 1700000000000,
      };

      // File on disk has different size (edited externally)
      const currentDiskStats = {
        size: 6200, // Modified!
        mtimeMs: 1700000050000,
      };

      const existingPaths = new Set(["F:/VoxLabExports/my_job/master.wav"]);

      const result = resolveArtifactPath({
        outputDir,
        baseName,
        extension,
        collisionPolicy: "overwrite", // User selected overwrite!
        recordedFingerprint: recorded,
        currentFileStats: currentDiskStats,
        checkPathExists: (p) => existingPaths.has(p),
      });

      // Must NOT overwrite, must auto_rename!
      assert.equal(result.action, "auto_renamed");
      assert.equal(result.isExternalModified, true);
      assert.equal(result.resolvedPath, "F:/VoxLabExports/my_job/master_001.wav");
    });

    it("CRITICAL AC-17: Treats unrecorded existing file as externally modified and protects it", () => {
      const existingPaths = new Set(["F:/VoxLabExports/my_job/master.wav"]);

      const result = resolveArtifactPath({
        outputDir,
        baseName,
        extension,
        collisionPolicy: "overwrite",
        recordedFingerprint: undefined, // Never written by app
        currentFileStats: { size: 12000, mtimeMs: 1700000000000 },
        checkPathExists: (p) => existingPaths.has(p),
      });

      assert.equal(result.action, "auto_renamed");
      assert.equal(result.isExternalModified, true);
      assert.equal(result.resolvedPath, "F:/VoxLabExports/my_job/master_001.wav");
    });

    it("sequences numbered suffix correctly when _001 already exists", () => {
      const recorded = {
        path: "F:/VoxLabExports/my_job/master.wav",
        size: 5000,
        mtimeMs: 1700000000000,
      };
      const currentDiskStats = { size: 9999, mtimeMs: 1700000099000 };

      const existingPaths = new Set([
        "F:/VoxLabExports/my_job/master.wav",
        "F:/VoxLabExports/my_job/master_001.wav",
      ]);

      const result = resolveArtifactPath({
        outputDir,
        baseName,
        extension,
        collisionPolicy: "overwrite",
        recordedFingerprint: recorded,
        currentFileStats: currentDiskStats,
        checkPathExists: (p) => existingPaths.has(p),
      });

      assert.equal(result.resolvedPath, "F:/VoxLabExports/my_job/master_002.wav");
    });
  });

  describe("AC-18: Dubbing Granular Skip", () => {
    it("skips dubbing subtitle if srt exists and policy is skip", () => {
      const srtPath = "F:/Out/dubbing.srt";
      const checkExists = (p: string) => p === srtPath;

      const shouldSkipSrt = shouldSkipDubbingArtifact(srtPath, "skip", checkExists);
      assert.equal(shouldSkipSrt, true);
    });

    it("does NOT skip dubbing master wav if wav does not exist even when policy is skip", () => {
      const srtPath = "F:/Out/dubbing.srt";
      const wavPath = "F:/Out/dubbing.wav";
      const checkExists = (p: string) => p === srtPath; // srt exists, wav does not

      const shouldSkipWav = shouldSkipDubbingArtifact(wavPath, "skip", checkExists);
      assert.equal(shouldSkipWav, false);
    });
  });

  describe("CredentialResolver (Zero Leakage Invariant)", () => {
    it("returns empty credentials when no settings are in storage", () => {
      const creds = CredentialResolver.getProviderCredentials("unknown_provider");
      assert.deepEqual(creds, {});
    });
  });
});
