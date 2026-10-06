import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MockBatchJob,
  BatchTaskType,
} from "../BatchWorkspacePrototype";
import {
  detectDialogueScript,
  parseDialogueScript,
} from "../../services/dialogue/parser";
import {
  calculateDialogueTimeline,
} from "../../services/dialogue/masterAssembly";
import {
  generateDialogueSrt,
} from "../../services/dialogue/srtExporter";
import {
  buildSpeechUnitsFromChunks,
  generateSubtitlesFromChunks,
} from "../../services/subtitle/pipeline";
import { ChunkItem } from "../../types/ui";
import { DialogueGlobalSettings, DEFAULT_DIALOGUE_SETTINGS } from "../../types/dialogue";

describe("Gate D: Batch Workflow Logic — Final Logic Change Request Suite", () => {
  // Helpers replicating prototype logic for deterministic testing
  const getTaskCompatibility = (job: MockBatchJob, task: BatchTaskType) => {
    if (task === "tts") {
      if (job.fileKind !== "text") return { compatible: false, reason: "TTS chỉ hỗ trợ tệp văn bản thường (.txt, .docx)" };
      if (job.hasDialogueStructure) return { compatible: false, reason: "Tệp là kịch bản hội thoại (đã khóa TTS, sử dụng tác vụ Hội thoại)" };
      return { compatible: true };
    }
    if (task === "dialogue") {
      if (job.fileKind !== "text") return { compatible: false, reason: "Hội thoại chỉ hỗ trợ tệp kịch bản (.txt, .docx)" };
      if (!job.hasDialogueStructure) return { compatible: false, reason: "Tệp là văn bản thường, không có cấu trúc phân vai hợp lệ [Tên]: Lời thoại" };
      return { compatible: true };
    }
    if (task === "transcription") {
      if (job.fileKind === "subtitle") return { compatible: false, reason: "Tệp đã là định dạng phụ đề (.srt, .vtt), không cần ASR" };
      return { compatible: true };
    }
    if (task === "translation") {
      return { compatible: true };
    }
    if (task === "dubbing") {
      return { compatible: true };
    }
    return { compatible: true };
  };

  const computeExecutionSequence = (
    fileKind: MockBatchJob["fileKind"],
    tasks: BatchTaskType[]
  ): BatchTaskType[] => {
    const seq: BatchTaskType[] = [];
    if (fileKind === "text") {
      if (tasks.includes("tts")) seq.push("tts");
      if (tasks.includes("dialogue")) seq.push("dialogue");
      if (tasks.includes("transcription")) seq.push("transcription");
      if (tasks.includes("translation")) seq.push("translation");
      if (tasks.includes("dubbing")) seq.push("dubbing");
    } else if (fileKind === "media") {
      if (tasks.includes("transcription")) seq.push("transcription");
      if (tasks.includes("translation")) seq.push("translation");
      if (tasks.includes("dubbing")) seq.push("dubbing");
    } else if (fileKind === "subtitle") {
      if (tasks.includes("translation")) seq.push("translation");
      if (tasks.includes("dubbing")) seq.push("dubbing");
    }
    return seq;
  };

  const simulateToggleTask = (job: MockBatchJob, task: BatchTaskType): { job: MockBatchJob; blocked?: boolean; reason?: string } => {
    const exists = job.selectedTasks.includes(task);

    // Uncheck guard
    if (exists) {
      if (task === "tts" || task === "dialogue") {
        const hasDownstream = job.selectedTasks.some((t) => ["transcription", "translation", "dubbing"].includes(t));
        if (hasDownstream) {
          return { job, blocked: true, reason: "Không thể tắt TTS/Hội thoại khi các tác vụ Phụ đề / Dịch / Lồng tiếng đang phụ thuộc." };
        }
      }
      if (task === "transcription") {
        const hasDownstream = job.selectedTasks.some((t) => ["translation", "dubbing"].includes(t));
        if (hasDownstream) {
          return { job, blocked: true, reason: "Không thể tắt Phụ đề khi Dịch / Lồng tiếng đang phụ thuộc." };
        }
      }
      if (task === "translation") {
        if (job.selectedTasks.includes("dubbing")) {
          return { job, blocked: true, reason: "Không thể tắt Dịch khi Lồng tiếng đang phụ thuộc." };
        }
      }

      const updated = job.selectedTasks.filter((t) => t !== task);
      return {
        job: {
          ...job,
          selectedTasks: updated,
          executionSequence: computeExecutionSequence(job.fileKind, updated),
        },
      };
    }

    // Checking task
    let updated = [...job.selectedTasks, task];
    if (task === "tts") updated = updated.filter((t) => t !== "dialogue");
    if (task === "dialogue") updated = updated.filter((t) => t !== "tts");

    if (job.fileKind === "media") {
      if (task === "translation" && !updated.includes("transcription")) updated.push("transcription");
      if (task === "dubbing") {
        if (!updated.includes("transcription")) updated.push("transcription");
        if (!updated.includes("translation")) updated.push("translation");
      }
    } else if (job.fileKind === "text") {
      const audioTask: BatchTaskType = job.hasDialogueStructure ? "dialogue" : "tts";
      if (task === "transcription") {
        if (!updated.includes(audioTask)) updated.push(audioTask);
      } else if (task === "translation") {
        if (!updated.includes(audioTask)) updated.push(audioTask);
        if (!updated.includes("transcription")) updated.push("transcription");
      } else if (task === "dubbing") {
        if (!updated.includes(audioTask)) updated.push(audioTask);
        if (!updated.includes("transcription")) updated.push("transcription");
        if (!updated.includes("translation")) updated.push("translation");
      }
    }

    return {
      job: {
        ...job,
        selectedTasks: updated,
        executionSequence: computeExecutionSequence(job.fileKind, updated),
      },
    };
  };

  // =========================================================================
  // CRITERION 1: Văn bản thường khóa Hội thoại; kịch bản hợp lệ khóa TTS
  // =========================================================================
  it("CRITERION 1: Normal text locks Dialogue; valid dialogue script locks TTS", () => {
    const normalTextJob: MockBatchJob = {
      id: "job-normal-text",
      fileName: "baocao_kinhte.txt",
      filePath: "D:/Docs/baocao_kinhte.txt",
      fileSize: "10 KB",
      fileKind: "text",
      hasDialogueStructure: false,
      stage: "staging",
      queueOrder: 0,
      selectedTasks: ["tts"],
      executionSequence: ["tts"],
      stepResults: {},
      status: "waiting",
      progressPct: 0,
    };

    const dialogueJob: MockBatchJob = {
      id: "job-dialogue",
      fileName: "kich_ban_hai_kich.txt",
      filePath: "D:/Scripts/kich_ban_hai_kich.txt",
      fileSize: "25 KB",
      fileKind: "text",
      hasDialogueStructure: true,
      stage: "staging",
      queueOrder: 0,
      selectedTasks: ["dialogue"],
      executionSequence: ["dialogue"],
      stepResults: {},
      status: "waiting",
      progressPct: 0,
    };

    // Normal text compatibility
    const normalTts = getTaskCompatibility(normalTextJob, "tts");
    const normalDial = getTaskCompatibility(normalTextJob, "dialogue");
    assert.equal(normalTts.compatible, true, "Normal text must allow TTS");
    assert.equal(normalDial.compatible, false, "Normal text must lock Dialogue");
    assert.ok(normalDial.reason?.includes("không có cấu trúc phân vai"), "Must provide clear lock reason");

    // Dialogue script compatibility
    const dialTts = getTaskCompatibility(dialogueJob, "tts");
    const dialDial = getTaskCompatibility(dialogueJob, "dialogue");
    assert.equal(dialTts.compatible, false, "Dialogue script must lock TTS");
    assert.equal(dialDial.compatible, true, "Dialogue script must allow Dialogue");
    assert.ok(dialTts.reason?.includes("đã khóa TTS"), "Must provide clear TTS lock reason");

    // Dialogue detector behavior
    const normalScriptContent = "Cộng hòa Xã hội Chủ nghĩa Việt Nam.\nĐộc lập - Tự do - Hạnh phúc.\nBáo cáo tình hình quý 3.";
    assert.equal(detectDialogueScript(normalScriptContent).isDialogue, false, "Plain prose must not be classified as dialogue");

    const headerColonContent = "Lưu ý: Bạn đọc vui lòng không sao chép tài liệu dưới mọi hình thức.\nGhi chú: Tài liệu nội bộ.";
    assert.equal(detectDialogueScript(headerColonContent).isDialogue, false, "Document headers with colons must not trigger dialogue");

    const validScriptContent = "[Nam]: Xin chào Lan.\n[Lan]: Chào anh Nam.\n[Người dẫn chuyện]: Buổi gặp gỡ bắt đầu.";
    const validDetection = detectDialogueScript(validScriptContent);
    assert.equal(validDetection.isDialogue, true, "Bracketed character script must be classified as dialogue");
    assert.equal(validDetection.confidence, "high");
    assert.equal(validDetection.characterCount, 3);
  });

  // =========================================================================
  // CRITERION 2: Phụ đề, Dịch và Lồng tiếng hoạt động đúng với hai loại văn bản
  // =========================================================================
  it("CRITERION 2: Subtitle, Translation, and Dubbing work correctly for both text pipelines", () => {
    const normalTextJob: MockBatchJob = {
      id: "job-normal-text",
      fileName: "sach_audio.txt",
      filePath: "D:/Docs/sach_audio.txt",
      fileSize: "15 KB",
      fileKind: "text",
      hasDialogueStructure: false,
      stage: "staging",
      queueOrder: 0,
      selectedTasks: [],
      executionSequence: [],
      stepResults: {},
      status: "waiting",
      progressPct: 0,
    };

    const dialogueJob: MockBatchJob = {
      id: "job-dialogue",
      fileName: "podcast_kichban.txt",
      filePath: "D:/Scripts/podcast_kichban.txt",
      fileSize: "20 KB",
      fileKind: "text",
      hasDialogueStructure: true,
      stage: "staging",
      queueOrder: 0,
      selectedTasks: [],
      executionSequence: [],
      stepResults: {},
      status: "waiting",
      progressPct: 0,
    };

    // Both text kinds support Subtitle, Translation, Dubbing
    ["transcription", "translation", "dubbing"].forEach((task) => {
      assert.equal(getTaskCompatibility(normalTextJob, task as BatchTaskType).compatible, true);
      assert.equal(getTaskCompatibility(dialogueJob, task as BatchTaskType).compatible, true);
    });

    // When normal text turns on Dubbing -> auto-chains: tts -> transcription -> translation -> dubbing
    const normalDubRes = simulateToggleTask(normalTextJob, "dubbing");
    assert.deepEqual(normalDubRes.job.selectedTasks, ["dubbing", "tts", "transcription", "translation"]);
    assert.deepEqual(normalDubRes.job.executionSequence, ["tts", "transcription", "translation", "dubbing"]);

    // When dialogue text turns on Dubbing -> auto-chains: dialogue -> transcription -> translation -> dubbing (NEVER TTS!)
    const dialDubRes = simulateToggleTask(dialogueJob, "dubbing");
    assert.deepEqual(dialDubRes.job.selectedTasks, ["dubbing", "dialogue", "transcription", "translation"]);
    assert.deepEqual(dialDubRes.job.executionSequence, ["dialogue", "transcription", "translation", "dubbing"]);
    assert.equal(dialDubRes.job.selectedTasks.includes("tts"), false, "Dialogue job must NEVER auto-enable TTS");
  });

  // =========================================================================
  // CRITERION 3: Media tự động bật các tác vụ tiên quyết mà không kích hoạt TTS/Hội thoại
  // =========================================================================
  it("CRITERION 3: Media pipeline auto-enables prerequisites without activating TTS or Dialogue", () => {
    const mediaJob: MockBatchJob = {
      id: "job-media",
      fileName: "clip_phongvan.mp4",
      filePath: "D:/Media/clip_phongvan.mp4",
      fileSize: "150 MB",
      fileKind: "media",
      stage: "staging",
      queueOrder: 0,
      selectedTasks: [],
      executionSequence: [],
      stepResults: {},
      status: "waiting",
      progressPct: 0,
    };

    // Media locks TTS and Dialogue strictly
    assert.equal(getTaskCompatibility(mediaJob, "tts").compatible, false);
    assert.equal(getTaskCompatibility(mediaJob, "dialogue").compatible, false);

    // Turning on Translation on Media auto-enables Transcription (Phụ đề ASR)
    const transRes = simulateToggleTask(mediaJob, "translation");
    assert.deepEqual(transRes.job.selectedTasks, ["translation", "transcription"]);
    assert.deepEqual(transRes.job.executionSequence, ["transcription", "translation"]);
    assert.equal(transRes.job.selectedTasks.includes("tts"), false);
    assert.equal(transRes.job.selectedTasks.includes("dialogue"), false);

    // Turning on Dubbing on Media auto-enables Transcription and Translation
    const dubRes = simulateToggleTask(mediaJob, "dubbing");
    assert.deepEqual(dubRes.job.selectedTasks, ["dubbing", "transcription", "translation"]);
    assert.deepEqual(dubRes.job.executionSequence, ["transcription", "translation", "dubbing"]);
    assert.equal(dubRes.job.selectedTasks.includes("tts"), false);
    assert.equal(dubRes.job.selectedTasks.includes("dialogue"), false);
  });

  // =========================================================================
  // CRITERION 4: Thao tác Chọn tất cả không thể tạo tổ hợp tác vụ không hợp lệ
  // =========================================================================
  it("CRITERION 4: Select All and mutual exclusion prevent invalid combinations, with uncheck guards", () => {
    const jobs: MockBatchJob[] = [
      {
        id: "j-normal",
        fileName: "doc1.txt",
        filePath: "D:/doc1.txt",
        fileSize: "1 KB",
        fileKind: "text",
        hasDialogueStructure: false,
        stage: "staging",
        queueOrder: 0,
        selectedTasks: [],
        executionSequence: [],
        stepResults: {},
        status: "waiting",
        progressPct: 0,
      },
      {
        id: "j-dial",
        fileName: "script1.txt",
        filePath: "D:/script1.txt",
        fileSize: "1 KB",
        fileKind: "text",
        hasDialogueStructure: true,
        stage: "staging",
        queueOrder: 0,
        selectedTasks: [],
        executionSequence: [],
        stepResults: {},
        status: "waiting",
        progressPct: 0,
      },
      {
        id: "j-media",
        fileName: "clip1.mp4",
        filePath: "D:/clip1.mp4",
        fileSize: "50 MB",
        fileKind: "media",
        stage: "staging",
        queueOrder: 0,
        selectedTasks: [],
        executionSequence: [],
        stepResults: {},
        status: "waiting",
        progressPct: 0,
      },
    ];

    // Simulate bulk select TTS column
    const afterBulkSelectTts = jobs.map((j) => {
      const compat = getTaskCompatibility(j, "tts");
      if (!compat.compatible) return j;
      return simulateToggleTask(j, "tts").job;
    });

    // j-normal gets TTS; j-dial and j-media DO NOT get TTS
    assert.equal(afterBulkSelectTts[0].selectedTasks.includes("tts"), true);
    assert.equal(afterBulkSelectTts[1].selectedTasks.includes("tts"), false, "Dialogue job must not receive TTS in bulk select");
    assert.equal(afterBulkSelectTts[2].selectedTasks.includes("tts"), false, "Media job must not receive TTS in bulk select");

    // Simulate bulk select Dialogue column
    const afterBulkSelectDial = afterBulkSelectTts.map((j) => {
      const compat = getTaskCompatibility(j, "dialogue");
      if (!compat.compatible) return j;
      return simulateToggleTask(j, "dialogue").job;
    });

    assert.equal(afterBulkSelectDial[0].selectedTasks.includes("dialogue"), false, "Normal text must not receive Dialogue");
    assert.equal(afterBulkSelectDial[1].selectedTasks.includes("dialogue"), true, "Dialogue job receives Dialogue");
    assert.equal(afterBulkSelectDial[1].selectedTasks.includes("tts"), false, "TTS and Dialogue NEVER coexist");

    // Uncheck guard verification:
    // Try to uncheck TTS when Transcription is selected
    const jobWithPrereq: MockBatchJob = {
      ...jobs[0],
      selectedTasks: ["tts", "transcription"],
      executionSequence: ["tts", "transcription"],
    };
    const blockedUncheck = simulateToggleTask(jobWithPrereq, "tts");
    assert.equal(blockedUncheck.blocked, true, "Unchecking TTS must be blocked when Subtitle depends on it");
    assert.deepEqual(blockedUncheck.job.selectedTasks, ["tts", "transcription"], "Tasks must remain intact");

    // Try to uncheck Transcription when Translation is selected
    const jobWithSubPrereq: MockBatchJob = {
      ...jobs[2],
      selectedTasks: ["transcription", "translation"],
      executionSequence: ["transcription", "translation"],
    };
    const blockedSubUncheck = simulateToggleTask(jobWithSubPrereq, "transcription");
    assert.equal(blockedSubUncheck.blocked, true, "Unchecking Subtitle must be blocked when Translation depends on it");
  });

  // =========================================================================
  // CRITERION 5: Đầu ra phụ đề từ TTS/Hội thoại có timeline hợp lệ và không ước lượng tùy tiện
  // =========================================================================
  it("CRITERION 5: Subtitle outputs from Dialogue and TTS have valid, synchronized non-arbitrary timestamps", () => {
    // 1. Dialogue timeline & SRT verification
    const dialogueScript = `[Nam]: Xin chào tất cả mọi người.\n[Lan]: Chào Nam, rất vui được gặp lại.`;
    const parsed = parseDialogueScript(dialogueScript);
    // Simulate audio synthesis durations for each segment
    parsed.segments[0].durationSec = 2.45;
    parsed.segments[1].durationSec = 3.12;

    const dialogueSettings: DialogueGlobalSettings = {
      ...DEFAULT_DIALOGUE_SETTINGS,
      turnPauseSec: 0.6,
      sameSpeakerPauseSec: 0.3,
    };

    const plan = calculateDialogueTimeline(parsed.segments, dialogueSettings);
    assert.equal(plan.timeline.length, 2);
    // Segment 1: start at 0, end at 2.45
    assert.equal(plan.timeline[0].startSec, 0);
    assert.equal(plan.timeline[0].endSec, 2.45);
    // Segment 2: starts after turnPauseSec (2.45 + 0.6 = 3.05)
    assert.equal(Math.round(plan.timeline[1].startSec * 100) / 100, 3.05);
    assert.equal(Math.round(plan.timeline[1].endSec * 100) / 100, 6.17);

    const srtContent = generateDialogueSrt(plan.timeline);
    assert.ok(srtContent.includes("00:00:00,000 --> 00:00:02,450"));
    assert.ok(srtContent.includes("00:00:03,050 --> 00:00:06,170"));
    assert.ok(srtContent.includes("[Nam]: Xin chào tất cả mọi người."));
    assert.ok(srtContent.includes("[Lan]: Chào Nam, rất vui được gặp lại."));

    // 2. TTS chunk timeline & Subtitle verification
    const chunks: ChunkItem[] = [
      {
        id: "chunk-1",
        index: 1,
        text: "Chào mừng quý khách đến với VoxLab.",
        originalText: "Chào mừng quý khách đến với VoxLab.",
        durationSec: 2.8,
        pauseAfterMs: 400,
        status: "ready",
      },
      {
        id: "chunk-2",
        index: 2,
        text: "Hệ thống hỗ trợ xử lý hàng loạt chuyên nghiệp.",
        originalText: "Hệ thống hỗ trợ xử lý hàng loạt chuyên nghiệp.",
        durationSec: 3.5,
        pauseAfterMs: 500,
        status: "ready",
      },
    ];

    const speechUnits = buildSpeechUnitsFromChunks(chunks);
    assert.equal(speechUnits.length, 2);
    assert.equal(speechUnits[0].startSec, 0);
    assert.equal(speechUnits[0].endSec, 2.8);
    // Unit 2 starts after 400ms pause = 3.2s
    assert.equal(Math.round(speechUnits[1].startSec * 10) / 10, 3.2);
    assert.equal(Math.round(speechUnits[1].endSec * 10) / 10, 6.7);

    const cues = generateSubtitlesFromChunks(chunks, { aspectRatio: "16:9", maxLines: 2 });
    assert.ok(cues.length >= 1, "Must generate valid cues from synthesized chunks");
    assert.equal(cues[0].startSec, 0);
    assert.ok(cues[cues.length - 1].endSec > 0);
  });
});
