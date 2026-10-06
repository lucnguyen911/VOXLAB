import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeJobConfigDiff,
  MockBatchJob,
  BatchGlobalDefaults,
  resolveJobSubfolderName,
  resolveJobOutputDir,
  loadBatchOutputSettings,
  saveBatchOutputSettings,
  BATCH_OUTPUT_SETTINGS_STORAGE_KEY,
  loadStoredDubbingSettings,
  saveStoredDubbingSettings,
  DUBBING_VOICE_STORAGE_KEY,
  DUBBING_VOICE_SETTINGS_KEY,
  loadStoredDialogueSettings,
  saveStoredDialogueSettings,
  DIALOGUE_SETTINGS_STORAGE_KEY,
} from "../BatchWorkspacePrototype";
import { loadStoredTtsSettings, saveStoredTtsSettings } from "../../components/inspector/TtsInspector";
import { loadSubtitleSettings, saveSubtitleSettings } from "../../services/subtitle";
import {
  loadTranslationSettings,
  saveTranslationSettings,
  TRANSLATION_SETTINGS_KEY,
} from "../../services/translation";
import {
  loadSavedGroupIds,
  saveGroupIds,
  NormalizerGroupId,
} from "../../services/normalizer";
import {
  loadGlobalRules,
  saveGlobalRules,
  GLOBAL_RULES_STORAGE_KEY,
  PronunciationRule,
} from "../../services/pronunciation";

describe("Gate D: Final Config Scope & Output Diff Verification Suite", () => {
  const BASE_SNAPSHOT: Partial<BatchGlobalDefaults> = {
    outputPath: "D:/VoxLabOutput/Batch_Export",
    saveInSourceFolder: false,
    collisionPolicy: "auto_rename",
    outputAudioFormat: "wav",
    outputSubtitleFormat: "srt",
    transcription: {
      whisperModel: "large-v3-turbo",
      audioLanguage: "auto",
      speechSpeed: "1.0",
      processingSpeed: "auto",
      aspectRatio: "16:9",
      maxLines: 1,
      outputFormat: "srt",
    },
    translation: {
      provider: "LM Studio (Qwen 3.5 Local)",
      sourceLanguage: "auto",
      targetLanguage: "vi",
      style: "cinema",
      contextAware: true,
    },
    dubbing: {
      ttsModel: "Omni Voice",
      voice: "Mai Chi (Sài Gòn)",
      speedMultiplier: 1.15,
      turnPauseSec: 0.3,
      autoFit: true,
      masterVolume: 1.0,
      collisionGuardrail: "wsola_autofit",
    },
  };

  const createFailedJob = (id: string, fileName: string): MockBatchJob => ({
    id,
    fileName,
    filePath: `D:/Media/${fileName}`,
    fileSize: "50.0 MB",
    fileKind: "media",
    stage: "queued",
    queueOrder: 1,
    selectedTasks: ["transcription", "translation", "dubbing"],
    executionSequence: ["transcription", "translation", "dubbing"],
    status: "failed_with_artifact",
    progressPct: 70,
    retryFromStep: "dubbing",
    effectiveConfigSnapshot: JSON.parse(JSON.stringify(BASE_SNAPSHOT)),
    configOverrides: {},
    hasCustomConfig: false,
    stepResults: {
      transcription: {
        task: "transcription",
        status: "completed",
        progressPct: 100,
        outputArtifactPaths: [`D:/VoxLabOutput/Batch_Export/${fileName}.srt`],
      },
      translation: {
        task: "translation",
        status: "completed",
        progressPct: 100,
        outputArtifactPaths: [`D:/VoxLabOutput/Batch_Export/${fileName}_vi.srt`],
      },
      dubbing: {
        task: "dubbing",
        status: "failed",
        progressPct: 40,
        error: "OOM on dubbing worker",
      },
    },
    outputArtifacts: {
      subtitles: [
        {
          path: `D:/VoxLabOutput/Batch_Export/${fileName}.srt`,
          label: "Phụ đề gốc (.srt)",
          cues: [{ time: "00:00.000 → 00:02.000", text: "Hello" }],
        },
        {
          path: `D:/VoxLabOutput/Batch_Export/${fileName}_vi.srt`,
          label: "Bản dịch Tiếng Việt (.srt)",
          cues: [{ time: "00:00.000 → 00:02.000", text: "Xin chào" }],
        },
      ],
    },
  });

  // =========================================================================
  // SITUATION 1: Đổi Global Defaults nhưng chưa Apply → job không được chọn không đổi CTA
  // =========================================================================
  it("SITUATION 1: Changing Global Defaults without applying -> unselected jobs strictly preserve snapshot and [Thử lại] CTA", () => {
    const job = createFailedJob("job-05", "audio_phong_van.wav");

    // Global defaults is changed in the modal/topbar (e.g. to a different model and voice)
    const modifiedGlobalDefaults: BatchGlobalDefaults = {
      outputPath: "E:/Completely/Different/Folder",
      saveInSourceFolder: true,
      collisionPolicy: "overwrite",
      outputAudioFormat: "mp3",
      outputSubtitleFormat: "vtt",
      tts: {} as any,
      dialogue: {} as any,
      transcription: {
        whisperModel: "tiny",
        audioLanguage: "en",
        speechSpeed: "0.8",
        processingSpeed: "4x",
        aspectRatio: "9:16",
        maxLines: 2,
        outputFormat: "vtt",
      },
      translation: {
        provider: "OpenAI Cloud",
        sourceLanguage: "en",
        targetLanguage: "ja",
        style: "default",
        contextAware: false,
      },
      dubbing: {
        ttsModel: "Different TTS",
        voice: "Voice Brand New",
        speedMultiplier: 1.5,
        turnPauseSec: 0.8,
        autoFit: false,
        masterVolume: 0.5,
        collisionGuardrail: "truncate",
      },
    };

    // Because the job was NOT selected and NOT applied, computeJobConfigDiff(job)
    // uses the job's own working config (which equals its effectiveConfigSnapshot).
    // Passing modifiedGlobalDefaults or ignoring it must yield unchanged diff!
    const diff = computeJobConfigDiff(job, modifiedGlobalDefaults);

    assert.equal(diff.isConfigChanged, false, "Job config must not be marked changed");
    assert.equal(diff.aiConfigChanged, false, "AI config must not be marked changed");
    assert.equal(diff.outputConfigChanged, false, "Output config must not be marked changed");
    assert.equal(diff.ctaType, "retry", "CTA must remain 'retry'");
    assert.equal(diff.ctaLabel, "Thử lại", "CTA button label must strictly be 'Thử lại'");
  });

  // =========================================================================
  // SITUATION 2: Apply cho 2/5 job lỗi → chỉ 2 job nhận cấu hình mới
  // =========================================================================
  it("SITUATION 2: Apply defaults to 2 of 5 failed jobs -> only the 2 selected jobs receive new config, remaining 3 stay [Thử lại]", () => {
    // 5 failed jobs
    const jobs: MockBatchJob[] = [
      createFailedJob("job-05", "job05.wav"),
      createFailedJob("job-10", "job10.mp4"),
      createFailedJob("job-11", "job11.txt"),
      createFailedJob("job-12", "job12.srt"),
      createFailedJob("job-13", "job13.wav"),
    ];

    // Initially, all 5 jobs have no overrides, so all 5 are 'retry'
    for (const j of jobs) {
      const d = computeJobConfigDiff(j);
      assert.equal(d.isConfigChanged, false);
      assert.equal(d.ctaType, "retry");
      assert.equal(d.ctaLabel, "Thử lại");
    }

    // User selects 2 jobs: job-05 and job-10
    const selectedJobIds = new Set(["job-05", "job-10"]);

    // New configuration to apply
    const appliedConfig: Partial<BatchGlobalDefaults> = {
      transcription: {
        whisperModel: "small", // Changed from large-v3-turbo
        audioLanguage: "auto",
        speechSpeed: "1.0",
        processingSpeed: "auto",
        aspectRatio: "16:9",
        maxLines: 1,
        outputFormat: "srt",
      },
      dubbing: {
        ttsModel: "Omni Voice",
        voice: "Thảo Trinh (Hà Nội)", // Changed from Mai Chi
        speedMultiplier: 1.15,
        turnPauseSec: 0.3,
        autoFit: true,
        masterVolume: 1.0,
        collisionGuardrail: "wsola_autofit",
      },
    };

    // Simulate handleApplyDefaultsToSelected
    const updatedJobs = jobs.map((j) => {
      if (selectedJobIds.has(j.id)) {
        const updated: MockBatchJob = {
          ...j,
          hasCustomConfig: true,
          configOverrides: appliedConfig,
        };
        const diff = computeJobConfigDiff(updated);
        return {
          ...updated,
          configChanged: diff.isConfigChanged,
          invalidatedFromStep: diff.invalidatedFromStep,
        };
      }
      return j; // Unselected jobs are untouched!
    });

    // Verify job-05 (selected)
    const diff05 = computeJobConfigDiff(updatedJobs[0]);
    assert.equal(diff05.isConfigChanged, true, "job-05 must be marked changed");
    assert.equal(diff05.aiConfigChanged, true, "job-05 AI config changed");
    assert.equal(diff05.ctaType, "regenerate_ai", "job-05 CTA must become regenerate_ai");
    assert.equal(diff05.ctaLabel, "Tạo lại", "job-05 CTA label must be 'Tạo lại'");
    assert.equal(diff05.invalidatedFromStep, "transcription", "job-05 invalidated from transcription (earliest AI diff)");

    // Verify job-10 (selected)
    const diff10 = computeJobConfigDiff(updatedJobs[1]);
    assert.equal(diff10.isConfigChanged, true, "job-10 must be marked changed");
    assert.equal(diff10.aiConfigChanged, true, "job-10 AI config changed");
    assert.equal(diff10.ctaType, "regenerate_ai", "job-10 CTA must become regenerate_ai");
    assert.equal(diff10.ctaLabel, "Tạo lại", "job-10 CTA label must be 'Tạo lại'");

    // Verify job-11, job-12, job-13 (UNSELECTED - must remain completely unchanged)
    for (let i = 2; i < 5; i++) {
      const unselectedJob = updatedJobs[i];
      const diffUnselected = computeJobConfigDiff(unselectedJob);
      assert.equal(diffUnselected.isConfigChanged, false, `${unselectedJob.id} must NOT be marked changed`);
      assert.equal(diffUnselected.ctaType, "retry", `${unselectedJob.id} CTA must remain 'retry'`);
      assert.equal(diffUnselected.ctaLabel, "Thử lại", `${unselectedJob.id} CTA label must remain 'Thử lại'`);
    }
  });

  // =========================================================================
  // SITUATION 3: Khôi phục cấu hình đúng snapshot → CTA trở về Thử lại
  // =========================================================================
  it("SITUATION 3: Restoring configuration to match snapshot exactly -> CTA reverts back to [Thử lại]", () => {
    const job = createFailedJob("job-05", "audio_phong_van.wav");

    // 1. Job is given an override (e.g. different voice)
    job.configOverrides = {
      dubbing: {
        ttsModel: "Omni Voice",
        voice: "Minh Quang (Hà Nội)", // Changed from Mai Chi (Sài Gòn)
        speedMultiplier: 1.15,
        turnPauseSec: 0.3,
        autoFit: true,
        masterVolume: 1.0,
        collisionGuardrail: "wsola_autofit",
      },
    };
    job.hasCustomConfig = true;

    // Diff is changed
    const diffChanged = computeJobConfigDiff(job);
    assert.equal(diffChanged.isConfigChanged, true);
    assert.equal(diffChanged.ctaType, "regenerate_ai");
    assert.equal(diffChanged.ctaLabel, "Tạo lại");
    assert.equal(diffChanged.invalidatedFromStep, "dubbing");

    // 2. User restores to snapshot (e.g. handleRestoreJobToSnapshot)
    job.configOverrides = {};
    job.hasCustomConfig = false;

    // Diff must revert cleanly to 'retry'
    const diffRestored = computeJobConfigDiff(job);
    assert.equal(diffRestored.isConfigChanged, false);
    assert.equal(diffRestored.aiConfigChanged, false);
    assert.equal(diffRestored.outputConfigChanged, false);
    assert.equal(diffRestored.ctaType, "retry");
    assert.equal(diffRestored.ctaLabel, "Thử lại");

    // 3. User manually inputs values that match snapshot exactly
    job.configOverrides = {
      dubbing: {
        ttsModel: "Omni Voice",
        voice: "Mai Chi (Sài Gòn)", // Same as snapshot!
        speedMultiplier: 1.15,
        turnPauseSec: 0.3,
        autoFit: true,
        masterVolume: 1.0,
        collisionGuardrail: "wsola_autofit",
      },
    };
    const diffManualMatch = computeJobConfigDiff(job);
    assert.equal(diffManualMatch.isConfigChanged, false, "Deep equality must detect identical config values");
    assert.equal(diffManualMatch.ctaType, "retry");
    assert.equal(diffManualMatch.ctaLabel, "Thử lại");
  });

  // =========================================================================
  // SITUATION 4: Chỉ đổi thư mục xuất → nhận diện đúng thay đổi, không sinh AI không cần thiết
  // =========================================================================
  it("SITUATION 4: Changing only Output directory -> identified as output-only, reuses valid artifacts, 0 AI calls, CTA is [Xuất lại]", () => {
    const job = createFailedJob("job-05", "audio_phong_van.wav");

    // Intermediate artifacts exist (transcription & translation completed with .srt)
    assert.ok(job.outputArtifacts?.subtitles && job.outputArtifacts.subtitles.length > 0);

    // User only changes outputPath
    job.configOverrides = {
      outputPath: "D:/VoxLabOutput/Custom_Target_Folder",
    };
    job.hasCustomConfig = true;

    const diff = computeJobConfigDiff(job);

    assert.equal(diff.isConfigChanged, true, "Must detect that config changed");
    assert.equal(diff.aiConfigChanged, false, "AI models / prompts / voices have NOT changed");
    assert.equal(diff.outputConfigChanged, true, "Must flag outputConfigChanged = true");
    assert.equal(diff.canReuseArtifacts, true, "Valid intermediate artifacts exist and must be reusable");
    assert.equal(diff.invalidatedFromStep, undefined, "No AI steps are invalidated");
    assert.equal(diff.ctaType, "re_export", "CTA type must be 're_export'");
    assert.equal(diff.ctaLabel, "Xuất lại", "CTA label must be 'Xuất lại'");

    // What if a job has NO intermediate artifacts? (e.g. failed at step 1 before creating any artifact)
    const freshFailedJob: MockBatchJob = {
      ...job,
      id: "job-fresh-fail",
      status: "failed",
      stepResults: {
        transcription: { task: "transcription", status: "failed", progressPct: 5, error: "Early failure" },
      },
      outputArtifacts: undefined,
      configOverrides: {
        outputPath: "D:/VoxLabOutput/Another_Folder",
      },
    };

    const diffNoArtifact = computeJobConfigDiff(freshFailedJob);
    assert.equal(diffNoArtifact.outputConfigChanged, true);
    assert.equal(diffNoArtifact.canReuseArtifacts, false, "No valid artifacts to reuse");
    assert.equal(diffNoArtifact.ctaType, "regenerate_ai", "Must fall back to regenerate to produce missing artifacts");
    assert.equal(diffNoArtifact.ctaLabel, "Tạo lại");
  });

  // =========================================================================
  // SITUATION 5: Cấu trúc thư mục đầu ra bắt buộc theo tên từng tệp & Xử lý trùng tên
  // =========================================================================
  it("SITUATION 5: Mandatory per-file subfolder structure and deterministic collision disambiguation", () => {
    // 1. Single file: dedicated subfolder is its base name
    const singleJob = { id: "job-1", fileName: "01.mp4", filePath: "D:/Media/01.mp4" };
    const subfolder1 = resolveJobSubfolderName(singleJob, [singleJob]);
    assert.equal(subfolder1, "01", "Single file subfolder must be base name '01'");

    const outputDir1 = resolveJobOutputDir(singleJob, { outputPath: "D:/VoxLabOutput", saveInSourceFolder: false }, [singleJob]);
    assert.equal(outputDir1, "D:/VoxLabOutput/01", "Must place outputs in D:/VoxLabOutput/01");

    // 2. Collision across different extensions: 01.mp4 vs 01.wav
    const jobMedia = { id: "job-m", fileName: "01.mp4", filePath: "D:/Media/01.mp4" };
    const jobAudio = { id: "job-a", fileName: "01.wav", filePath: "D:/Audio/01.wav" };
    const batchList = [jobMedia, jobAudio];

    const subfolderMedia = resolveJobSubfolderName(jobMedia, batchList);
    const subfolderAudio = resolveJobSubfolderName(jobAudio, batchList);
    assert.equal(subfolderMedia, "01_mp4", "Media job must disambiguate with extension '01_mp4'");
    assert.equal(subfolderAudio, "01_wav", "Audio job must disambiguate with extension '01_wav'");

    // 3. Collision across identical filename in different directories: D:/FolderA/01.mp4 vs D:/FolderB/01.mp4
    const jobDirA = { id: "job-a1", fileName: "01.mp4", filePath: "D:/FolderA/01.mp4" };
    const jobDirB = { id: "job-b1", fileName: "01.mp4", filePath: "D:/FolderB/01.mp4" };
    const batchListDirs = [jobDirA, jobDirB];

    const subfolderA = resolveJobSubfolderName(jobDirA, batchListDirs);
    const subfolderB = resolveJobSubfolderName(jobDirB, batchListDirs);
    assert.notEqual(subfolderA, subfolderB, "Duplicate filenames in different folders must not share same subfolder");
    assert.ok(subfolderA.includes("FolderA") || subfolderA.endsWith("1"), "Must include parent folder or index disambiguation");
    assert.ok(subfolderB.includes("FolderB") || subfolderB.endsWith("2"), "Must include parent folder or index disambiguation");
  });

  // =========================================================================
  // SITUATION 6: Vị trí lưu cùng thư mục với tệp gốc (saveInSourceFolder)
  // =========================================================================
  it("SITUATION 6: saveInSourceFolder = true places subfolder next to source file and preserves custom outputPath", () => {
    const job = { id: "job-source", fileName: "phong_su.mp4", filePath: "D:/VideoProjects/phong_su.mp4" };

    // When saveInSourceFolder is true: output directory is adjacent to source file
    const outputDirInSource = resolveJobOutputDir(
      job,
      { outputPath: "D:/VoxLabOutput/Batch_Export", saveInSourceFolder: true },
      [job]
    );
    assert.equal(
      outputDirInSource,
      "D:/VideoProjects/phong_su",
      "Must create dedicated subfolder adjacent to source file"
    );

    // When saveInSourceFolder is false: output directory is inside custom outputPath
    const outputDirCustom = resolveJobOutputDir(
      job,
      { outputPath: "D:/VoxLabOutput/Batch_Export", saveInSourceFolder: false },
      [job]
    );
    assert.equal(
      outputDirCustom,
      "D:/VoxLabOutput/Batch_Export/phong_su",
      "Must create dedicated subfolder inside common output path"
    );
  });

  // =========================================================================
  // SITUATION 7: Ghi nhớ cài đặt xuất tệp (Persistence & Default Restoration)
  // =========================================================================
  it("SITUATION 7: Local settings persistence loads, saves, and protects unselected jobs", () => {
    // Mock localStorage
    const store: Record<string, string> = {};
    const mockStorage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => {
        store[key] = val;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        for (const k in store) delete store[k];
      },
      length: 0,
      key: () => null,
    };
    (globalThis as any).localStorage = mockStorage;

    // 1. Initial load when storage is empty yields standard defaults
    const initial = loadBatchOutputSettings();
    assert.equal(initial.saveInSourceFolder, false);
    assert.equal(initial.collisionPolicy, "auto_rename");
    assert.equal(initial.outputAudioFormat, "wav");
    assert.equal(initial.outputSubtitleFormat, "srt");
    assert.equal(initial.concurrency, 1);

    // 2. Save user preferences
    saveBatchOutputSettings({
      saveInSourceFolder: true,
      outputPath: "E:/VoxLabCustomExport",
      collisionPolicy: "skip",
      outputAudioFormat: "mp3",
      outputSubtitleFormat: "vtt",
      concurrency: 3,
    });

    assert.ok(store[BATCH_OUTPUT_SETTINGS_STORAGE_KEY], "Storage key must be populated");

    // 3. Re-load restored settings
    const restored = loadBatchOutputSettings();
    assert.equal(restored.saveInSourceFolder, true);
    assert.equal(restored.outputPath, "E:/VoxLabCustomExport");
    assert.equal(restored.collisionPolicy, "skip");
    assert.equal(restored.outputAudioFormat, "mp3");
    assert.equal(restored.outputSubtitleFormat, "vtt");
    assert.equal(restored.concurrency, 3);

    // 4. Persistence serves only as defaults for next jobs; in-flight/failed jobs are strictly unaffected
    const existingJob = createFailedJob("job-frozen", "old_job.mp4");
    const diff = computeJobConfigDiff(existingJob);
    assert.equal(diff.isConfigChanged, false, "Existing job must not be silently mutated by saved persistent settings");
    assert.equal(diff.ctaType, "retry");

    // Clean up mock
    delete (globalThis as any).localStorage;
  });

  // =========================================================================
  // SITUATION 8: Đổi định dạng Audio / Phụ đề → Nhận diện outputConfigChanged và CTA là [Xuất lại]
  // =========================================================================
  it("SITUATION 8: Changing outputAudioFormat or outputSubtitleFormat triggers [Xuất lại] when artifacts exist", () => {
    const jobAudio = createFailedJob("job-fmt-audio", "audio_test.wav");
    jobAudio.configOverrides = { outputAudioFormat: "mp3" };
    jobAudio.hasCustomConfig = true;

    const diffAudio = computeJobConfigDiff(jobAudio);
    assert.equal(diffAudio.outputConfigChanged, true, "outputConfigChanged must be true when audio format changes");
    assert.equal(diffAudio.aiConfigChanged, false, "AI config is untouched");
    assert.equal(diffAudio.ctaType, "re_export", "CTA must be re_export");
    assert.equal(diffAudio.ctaLabel, "Xuất lại");
    assert.ok(diffAudio.diffSummary.some((d) => d.includes("Định dạng âm thanh")));

    const jobSub = createFailedJob("job-fmt-sub", "sub_test.wav");
    jobSub.configOverrides = { outputSubtitleFormat: "vtt" };
    jobSub.hasCustomConfig = true;

    const diffSub = computeJobConfigDiff(jobSub);
    assert.equal(diffSub.outputConfigChanged, true, "outputConfigChanged must be true when subtitle format changes");
    assert.equal(diffSub.aiConfigChanged, false, "AI config is untouched");
    assert.equal(diffSub.ctaType, "re_export", "CTA must be re_export");
    assert.equal(diffSub.ctaLabel, "Xuất lại");
    assert.ok(diffSub.diffSummary.some((d) => d.includes("Định dạng phụ đề")));
  });

  // =========================================================================
  // SITUATION 9: Đồng bộ thiết lập TTS với kho lưu trữ chung (AC-35)
  // =========================================================================
  it("SITUATION 9: TTS tab configuration synchronizes with TtsInspector stored settings", () => {
    const mockStorage: Record<string, string> = {
      voxlab_tts_settings: JSON.stringify({
        speed: 1.25,
        pitch: 0.95,
        volume: 1.5,
        pauses: { comma: 0.4, period: 0.8, questionExclamation: 1.2, colonSemicolon: 0.5 },
        concurrency: 3,
        exportSrt: true,
      }),
    };

    (globalThis as any).localStorage = {
      getItem: (k: string) => mockStorage[k] || null,
      setItem: (k: string, v: string) => {
        mockStorage[k] = v;
      },
    };

    // Load stored settings via helper
    const stored = loadStoredTtsSettings();
    assert.equal(stored.speed, 1.25);
    assert.equal(stored.pitch, 0.95);
    assert.equal(stored.volume, 1.5);
    assert.equal(stored.pauses.comma, 0.4);
    assert.equal(stored.concurrency, 3);
    assert.equal(stored.exportSrt, true);

    // Save updated settings
    saveStoredTtsSettings({ speed: 1.1, pauses: { comma: 0.5, period: 0.5, questionExclamation: 1.0, colonSemicolon: 0.6 } });
    const updated = loadStoredTtsSettings();
    assert.equal(updated.speed, 1.1);
    assert.equal(updated.pauses.comma, 0.5);

    // Clean up
    delete (globalThis as any).localStorage;
  });

  // =========================================================================
  // SITUATION 10: Đồng bộ thiết lập Phụ đề với SubtitleSettings (AC-36)
  // =========================================================================
  it("SITUATION 10: Subtitle tab configuration synchronizes with SubtitleSettings stored settings", () => {
    const mockStorage: Record<string, string> = {
      voxlab_subtitle_settings: JSON.stringify({
        whisperModel: "large-v3",
        audioLanguage: "vi",
        speechSpeed: 0.9,
        processingSpeed: "2x",
        aspectRatio: "9:16",
        maxLines: 1,
      }),
    };

    (globalThis as any).localStorage = {
      getItem: (k: string) => mockStorage[k] || null,
      setItem: (k: string, v: string) => {
        mockStorage[k] = v;
      },
    };

    // Load stored settings via helper
    const stored = loadSubtitleSettings();
    assert.equal(stored.whisperModel, "large-v3");
    assert.equal(stored.audioLanguage, "vi");
    assert.equal(stored.speechSpeed, 0.9);
    assert.equal(stored.processingSpeed, "2x");
    assert.equal(stored.aspectRatio, "9:16");
    assert.equal(stored.maxLines, 1);

    // Save updated settings
    saveSubtitleSettings({ whisperModel: "medium", aspectRatio: "1:1", maxLines: 2 });
    const updated = loadSubtitleSettings();
    assert.equal(updated.whisperModel, "medium");
    assert.equal(updated.aspectRatio, "1:1");
    assert.equal(updated.maxLines, 2);

    // Clean up
    delete (globalThis as any).localStorage;
  });

  // =========================================================================
  // SITUATION 11: Đồng bộ thiết lập Lồng tiếng với DubbingWorkspace (AC-37)
  // =========================================================================
  it("SITUATION 11: Dubbing tab configuration synchronizes with DubbingWorkspace stored settings", () => {
    const mockStorage: Record<string, string> = {
      [DUBBING_VOICE_STORAGE_KEY]: "voice_01",
      [DUBBING_VOICE_SETTINGS_KEY]: JSON.stringify({
        ttsModel: "Chatterbox Turbo",
        speed: 1.15,
        pitch: 0.90,
        volume: 1.25,
        pauses: { comma: 0.4, period: 0.6, questionExclamation: 1.1, colonSemicolon: 0.5 },
        concurrency: 2,
        autoFit: false,
      }),
    };

    (globalThis as any).localStorage = {
      getItem: (k: string) => mockStorage[k] || null,
      setItem: (k: string, v: string) => {
        mockStorage[k] = v;
      },
    };

    // Load stored settings via helper
    const stored = loadStoredDubbingSettings();
    assert.equal(stored.voice, "Thảo Trinh (Hà Nội)", "Voice ID 'voice_01' should resolve to voice name");
    assert.equal(stored.ttsModel, "Chatterbox Turbo");
    assert.equal(stored.speed, 1.15);
    assert.equal(stored.pitch, 0.90);
    assert.equal(stored.volume, 1.25);
    assert.equal(stored.pauses.comma, 0.4);
    assert.equal(stored.concurrency, 2);
    assert.equal(stored.autoFit, false);

    // Save updated settings
    saveStoredDubbingSettings({
      voice: "Minh Quang (Hà Nội)",
      speed: 1.05,
      pitch: 1.0,
      autoFit: true,
      concurrency: 3,
    });
    const updated = loadStoredDubbingSettings();
    assert.equal(updated.voice, "Minh Quang (Hà Nội)");
    assert.equal(updated.speed, 1.05);
    assert.equal(updated.pitch, 1.0);
    assert.equal(updated.autoFit, true);
    assert.equal(updated.concurrency, 3);

    // Clean up
    delete (globalThis as any).localStorage;
  });

  // =========================================================================
  // SITUATION 12: Đồng bộ thiết lập Dịch thuật với DubbingWorkspace (AC-38)
  // =========================================================================
  it("SITUATION 12: Translation tab configuration synchronizes with DubbingWorkspace stored settings", () => {
    const mockStorage: Record<string, string> = {
      [TRANSLATION_SETTINGS_KEY]: JSON.stringify({
        sourceLanguage: "en",
        targetLanguage: "vi",
        translationProviderId: "deepseek",
        translationStyle: "cinema",
      }),
    };

    (globalThis as any).localStorage = {
      getItem: (k: string) => mockStorage[k] || null,
      setItem: (k: string, v: string) => {
        mockStorage[k] = v;
      },
    };

    // Load stored settings via helper
    const stored = loadTranslationSettings();
    assert.equal(stored.sourceLanguage, "en");
    assert.equal(stored.targetLanguage, "vi");
    assert.equal(stored.translationProviderId, "deepseek");
    assert.equal(stored.translationStyle, "cinema");

    // Save updated settings (e.g. from Batch Global Config Modal)
    saveTranslationSettings({
      sourceLanguage: "ja",
      targetLanguage: "vi",
      translationProviderId: "gemini",
      translationStyle: "default",
    });
    const updated = loadTranslationSettings();
    assert.equal(updated.sourceLanguage, "ja");
    assert.equal(updated.targetLanguage, "vi");
    assert.equal(updated.translationProviderId, "gemini");
    assert.equal(updated.translationStyle, "default");

    // Verify localStorage was updated
    const rawSaved = JSON.parse(mockStorage[TRANSLATION_SETTINGS_KEY]);
    assert.equal(rawSaved.sourceLanguage, "ja");
    assert.equal(rawSaved.translationProviderId, "gemini");
    assert.equal(rawSaved.translationStyle, "default");

    // Clean up
    delete (globalThis as any).localStorage;
  });

  // =========================================================================
  // SITUATION 13: Đồng bộ thiết lập Hội thoại với DialogueWorkspace (AC-40)
  // =========================================================================
  it("SITUATION 13: Dialogue tab configuration synchronizes general settings with DialogueWorkspace stored settings", () => {
    const mockStorage: Record<string, string> = {
      [DIALOGUE_SETTINGS_STORAGE_KEY]: JSON.stringify({
        model: "Chatterbox Turbo",
        masterVolume: 1.5,
        turnPauseSec: 0,
        sameSpeakerPauseSec: 0,
        pauses: { comma: 0.3, period: 0.7, questionExclamation: 1.1, colonSemicolon: 0.5 },
        concurrency: 2,
        exportSrt: true,
      }),
    };

    (globalThis as any).localStorage = {
      getItem: (k: string) => mockStorage[k] || null,
      setItem: (k: string, v: string) => {
        mockStorage[k] = v;
      },
    };

    // Load stored settings via helper
    const stored = loadStoredDialogueSettings();
    assert.equal(stored.model, "Chatterbox Turbo");
    assert.equal(stored.masterVolume, 1.5);
    assert.equal(stored.pauses.comma, 0.3);
    assert.equal(stored.pauses.period, 0.7);
    assert.equal(stored.pauses.questionExclamation, 1.1);
    assert.equal(stored.pauses.colonSemicolon, 0.5);
    assert.equal(stored.concurrency, 2);
    assert.equal(stored.exportSrt, true);

    // Save updated settings (e.g. from Batch Global Config Modal)
    saveStoredDialogueSettings({
      model: "Omni Voice",
      masterVolume: 1.0,
      pauses: { comma: 0.5, period: 0.5, questionExclamation: 1.0, colonSemicolon: 0.6 },
      concurrency: 3,
      exportSrt: false,
    });
    const updated = loadStoredDialogueSettings();
    assert.equal(updated.model, "Omni Voice");
    assert.equal(updated.masterVolume, 1.0);
    assert.equal(updated.pauses.comma, 0.5);
    assert.equal(updated.concurrency, 3);
    assert.equal(updated.exportSrt, false);

    // Verify localStorage was updated
    const rawSaved = JSON.parse(mockStorage[DIALOGUE_SETTINGS_STORAGE_KEY]);
    assert.equal(rawSaved.model, "Omni Voice");
    assert.equal(rawSaved.masterVolume, 1.0);
    assert.equal(rawSaved.pauses.comma, 0.5);
    assert.equal(rawSaved.concurrency, 3);
    assert.equal(rawSaved.exportSrt, false);

    // Verify per-character data is excluded from global dialogue settings (general scope only)
    assert.equal((rawSaved as any).characters, undefined, "Per-character configuration must not be in global settings");
    assert.equal((rawSaved as any).narratorVoice, undefined, "Narrator voice selection must not be in global settings");

    // Clean up
    delete (globalThis as any).localStorage;
  });

  // =========================================================================
  // SITUATION 14: Đồng bộ thiết lập Văn bản & Thư viện phát âm chung (AC-41)
  // =========================================================================
  it("SITUATION 14: Text tab configuration synchronizes text normalization rule groups and shared pronunciation rules", () => {
    const mockStorage: Record<string, string> = {
      voxlab_normalization_enabled_groups: JSON.stringify(["whitespace", "punctuation"]),
      [GLOBAL_RULES_STORAGE_KEY]: JSON.stringify([
        {
          id: "rule-1",
          sourceText: "AI",
          spokenText: "Ây Ai",
          caseSensitive: true,
          enabled: true,
          scope: "global",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } satisfies PronunciationRule,
      ]),
    };

    const mockLocalStorage = {
      getItem: (k: string) => mockStorage[k] || null,
      setItem: (k: string, v: string) => {
        mockStorage[k] = v;
      },
    };

    (globalThis as any).window = { localStorage: mockLocalStorage };
    (globalThis as any).localStorage = mockLocalStorage;

    // 1. Verify loading normalization groups
    const initialGroups = loadSavedGroupIds();
    assert.deepEqual(initialGroups, ["whitespace", "punctuation"]);

    // 2. Save new normalization groups (e.g. from Batch Global Config Tab 'Văn bản')
    const updatedGroups: NormalizerGroupId[] = ["whitespace", "punctuation", "unicode", "numbers"];
    saveGroupIds(updatedGroups);
    assert.deepEqual(loadSavedGroupIds(), updatedGroups);
    assert.deepEqual(JSON.parse(mockStorage.voxlab_normalization_enabled_groups), updatedGroups);

    // 3. Verify loading shared pronunciation rules
    const initialRules = loadGlobalRules();
    assert.equal(initialRules.length, 1);
    assert.equal(initialRules[0].sourceText, "AI");
    assert.equal(initialRules[0].spokenText, "Ây Ai");

    // 4. Add a new rule (e.g. quick add from Batch Global Config Tab 'Văn bản')
    const newRule: PronunciationRule = {
      id: "rule-2",
      sourceText: "UBND",
      spokenText: "Ủy ban nhân dân",
      caseSensitive: true,
      enabled: true,
      scope: "global",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveGlobalRules([...initialRules, newRule]);

    const updatedRules = loadGlobalRules();
    assert.equal(updatedRules.length, 2);
    assert.equal(updatedRules[1].sourceText, "UBND");
    assert.equal(updatedRules[1].spokenText, "Ủy ban nhân dân");

    // 5. Clean up
    delete (globalThis as any).window;
    delete (globalThis as any).localStorage;
  });
});



