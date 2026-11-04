import React, { useState, useEffect } from "react";
import {
  X,
  Play,
  Square,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Sparkles,
  Volume2,
  Save,
  Loader2,
  ShieldAlert,
  Check,
  FolderOpen,
  FileText,
  Music,
  Mic,
  MessageSquare,
  Captions,
  Languages,
  Film,
} from "lucide-react";
import {
  BatchJob,
  BatchQcChunkItem,
  BatchStepResult,
  BatchTaskType,
} from "../../types/batch";
import { ChunkItem } from "../../types/ui";
import {
  validateChunkAudioQuality,
  countChunkQualityIssues,
  getIssueShortLabel,
  getChunkAudioSignature,
} from "../../services/audio/qualityValidator";
import {
  getSharedAiServices,
  showPathInFolder,
  tauriAiFs,
} from "../../services/batch/batchRuntime";
import { resolveJobOutputDirectory } from "../../services/batch/outputResolver";
import { getEngineAdvancedSettings } from "../../services/ai/ttsAdvancedSettings";
import { edgeTtsProvider } from "../../services/providers/edgeProvider";
import { getEffectiveRules } from "../../services/pronunciation";
import { computeChunkPausesMs } from "../../services/audio/masterExport";
import { generateSubtitlesFromChunks } from "../../services/subtitle/pipeline";
import { exportToSrt, exportToVtt, formatSrtTimestamp } from "../../services/subtitle/exporter";
import { parseSubtitle } from "../../services/subtitle/parser";
import { SubtitleCue } from "../../services/subtitle/types";
import { convertSubtitleFormat } from "../../services/batch/outputResolver";
import {
  DEFAULT_DIALOGUE_SETTINGS,
  DialogueGlobalSettings,
  DialogueSegment,
} from "../../types/dialogue";
import { calculateDialogueTimeline } from "../../services/dialogue/masterAssembly";
import { generateDialogueSrt } from "../../services/dialogue/srtExporter";
import { loadSubtitleSettings } from "../../services/subtitle/profiles";
import {
  BottomAudioPlayer,
  ActiveAudioTrack,
} from "../../components/layout/BottomAudioPlayer";

export interface BatchTtsQcModalProps {
  job: BatchJob;
  isOpen: boolean;
  onClose: () => void;
  onSaveUpdatedJob: (updatedJob: BatchJob) => void;
}

type QcFilterTab = "all" | "issues" | "pass";

const TASK_DISPLAY_ORDER: BatchTaskType[] = [
  "tts",
  "dialogue",
  "dubbing",
  "transcription",
  "translation",
];

const TASK_LABELS: Record<BatchTaskType, string> = {
  tts: "Text to Speech",
  dialogue: "Hội thoại",
  transcription: "Phụ đề",
  translation: "Dịch phụ đề",
  dubbing: "Lồng tiếng",
};

function getTaskIcon(task: BatchTaskType) {
  switch (task) {
    case "tts":
      return <Mic className="w-3.5 h-3.5" />;
    case "dialogue":
      return <MessageSquare className="w-3.5 h-3.5" />;
    case "transcription":
      return <Captions className="w-3.5 h-3.5" />;
    case "translation":
      return <Languages className="w-3.5 h-3.5" />;
    case "dubbing":
      return <Film className="w-3.5 h-3.5" />;
  }
}

export const BatchTtsQcModal: React.FC<BatchTtsQcModalProps> = ({
  job,
  isOpen,
  onClose,
  onSaveUpdatedJob,
}) => {
  if (!isOpen) return null;

  // Determine available tasks that ran or produced artifacts on this job
  const availableTasks = React.useMemo<BatchTaskType[]>(() => {
    const found: BatchTaskType[] = [];
    for (const task of TASK_DISPLAY_ORDER) {
      const sr = job.stepResults[task];
      if (
        sr &&
        (sr.status === "completed" ||
          sr.status === "completed_with_warning" ||
          (sr.qcChunks && sr.qcChunks.length > 0) ||
          (sr.outputArtifactPaths && sr.outputArtifactPaths.length > 0))
      ) {
        found.push(task);
      }
    }
    if (found.length === 0 && job.selectedTasks.length > 0) {
      return [...job.selectedTasks];
    }
    return found.length > 0 ? found : ["tts"];
  }, [job]);

  const [activeTask, setActiveTask] = useState<BatchTaskType>(
    () => availableTasks[0] || "tts"
  );

  // Sync activeTask if job changes
  useEffect(() => {
    if (!availableTasks.includes(activeTask)) {
      setActiveTask(availableTasks[0] || "tts");
    }
  }, [job.id, availableTasks]);

  const targetStep: BatchStepResult | undefined = job.stepResults[activeTask];
  const isVoiceTask =
    activeTask === "tts" || activeTask === "dialogue" || activeTask === "dubbing";
  const isDialogue = activeTask === "dialogue";

  // Find master audio and subtitle artifacts across either the active step or the whole job
  const masterAudioPath = React.useMemo(() => {
    const stepAudio = targetStep?.outputArtifactPaths?.find((p) =>
      /\.(wav|mp3)$/i.test(p)
    );
    if (stepAudio) return stepAudio;
    return job.artifacts.ownedArtifactPaths.find((p) => /\.(wav|mp3)$/i.test(p));
  }, [targetStep, job.artifacts.ownedArtifactPaths]);

  const activeSubtitlePath = React.useMemo(() => {
    const stepSub = targetStep?.outputArtifactPaths?.find((p) =>
      /\.(srt|vtt)$/i.test(p)
    );
    if (stepSub) return stepSub;
    return job.artifacts.ownedArtifactPaths.find((p) => /\.(srt|vtt)$/i.test(p));
  }, [targetStep, job.artifacts.ownedArtifactPaths]);

  // Chunks state for TTS / Dialogue / Dubbing
  const [chunks, setChunks] = useState<BatchQcChunkItem[]>(() =>
    targetStep?.qcChunks ? targetStep.qcChunks.map((c) => ({ ...c })) : []
  );

  // Subtitle cues state for Transcription / Translation (or fallback when no qcChunks exist)
  const [subtitleCues, setSubtitleCues] = useState<
    (SubtitleCue & { isEdited?: boolean })[]
  >([]);
  const [isLoadingSubtitle, setIsLoadingSubtitle] = useState(false);

  const [filterTab, setFilterTab] = useState<QcFilterTab>("all");
  const [regeneratingIds, setRegeneratingIds] = useState<Set<string>>(new Set());
  const [isRegeneratingAll, setIsRegeneratingAll] = useState(false);
  const [isRebuildingMaster, setIsRebuildingMaster] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [statusBanner, setStatusBanner] = useState<{
    type: "info" | "success" | "error";
    message: string;
  } | null>(null);

  // BottomAudioPlayer state (matches standalone TTS / Dialogue workspaces)
  const [activeTrack, setActiveTrack] = useState<ActiveAudioTrack | null>(null);
  const [isPlayingTrack, setIsPlayingTrack] = useState(false);

  // Reload chunks or subtitle cues when switching activeTask
  useEffect(() => {
    const step = job.stepResults[activeTask];
    if (step?.qcChunks && step.qcChunks.length > 0) {
      setChunks(step.qcChunks.map((c) => ({ ...c })));
    } else {
      setChunks([]);
    }
    setHasUnsavedChanges(false);
  }, [activeTask, job.id]);

  // Load subtitle file when viewing a subtitle step or when a voice step has no qcChunks
  useEffect(() => {
    let cancelled = false;
    const shouldLoadSub =
      (!isVoiceTask || chunks.length === 0) && Boolean(activeSubtitlePath);
    if (!shouldLoadSub || !activeSubtitlePath) {
      setSubtitleCues([]);
      return;
    }

    setIsLoadingSubtitle(true);
    tauriAiFs
      .readText(activeSubtitlePath)
      .then((raw) => {
        if (cancelled) return;
        const parsed = parseSubtitle(raw);
        setSubtitleCues(parsed.map((c) => ({ ...c, isEdited: false })));
      })
      .catch(() => {
        if (!cancelled) setSubtitleCues([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingSubtitle(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeTask, activeSubtitlePath, isVoiceTask, chunks.length]);

  const handleOpenFolder = async () => {
    const targetPath =
      masterAudioPath ||
      activeSubtitlePath ||
      job.artifacts.ownedArtifactPaths[0] ||
      resolveJobOutputDirectory(job);
    try {
      await showPathInFolder(targetPath);
    } catch (err) {
      setStatusBanner({
        type: "error",
        message: `Không thể mở thư mục: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }
  };

  const handlePlayChunk = (chunk: BatchQcChunkItem) => {
    if (!chunk.audioFilePath) {
      setStatusBanner({
        type: "error",
        message: `Không tìm thấy file âm thanh của câu #${chunk.index}.`,
      });
      return;
    }
    if (activeTrack?.id === chunk.id) {
      setIsPlayingTrack((prev) => !prev);
      return;
    }
    setActiveTrack({
      id: chunk.id,
      chunkIndex: chunk.index,
      voiceName: chunk.characterName
        ? `[${chunk.characterName}]`
        : chunk.voiceId || "Giọng TTS",
      title: `Câu #${chunk.index}`,
      durationSec: chunk.durationSec || 2.5,
      audioUrl: chunk.audioFilePath,
      text: chunk.text,
    });
    setIsPlayingTrack(true);
  };

  const handlePreviewMasterAudio = () => {
    if (!masterAudioPath) {
      setStatusBanner({
        type: "error",
        message: "Không tìm thấy tệp Master Audio đã xuất để nghe thử.",
      });
      return;
    }
    const masterTrackId = `master-${job.id}`;
    if (activeTrack?.id === masterTrackId) {
      setIsPlayingTrack((prev) => !prev);
      return;
    }
    const totalDur =
      chunks.reduce((acc, c) => acc + (c.durationSec || 0), 0) || 10;
    setActiveTrack({
      id: masterTrackId,
      voiceName: "Master Audio",
      title: masterAudioPath.split(/[\\/]/).pop() || job.sourceFileName,
      durationSec: totalDur,
      audioUrl: masterAudioPath,
      text: chunks.map((c) => c.text).join(" ") || job.sourceFileName,
    });
    setIsPlayingTrack(true);
  };

  const toCheckableItems = (list: BatchQcChunkItem[]) =>
    list.map((c) => ({
      ...c,
      status: "ready",
    }));

  const stats = countChunkQualityIssues(toCheckableItems(chunks));
  const totalIssues = stats.errorCount + stats.warningCount;

  const filteredChunks = chunks.filter((c) => {
    const st = c.qualityReview?.status;
    const isConfirmed =
      Boolean(c.acknowledgedAudioSignature) &&
      c.acknowledgedAudioSignature ===
        getChunkAudioSignature({ ...c, status: "ready" });
    const hasActiveIssue =
      st === "error" || (st === "warning" && !isConfirmed);
    if (filterTab === "issues") return hasActiveIssue;
    if (filterTab === "pass") return !hasActiveIssue;
    return true;
  });

  const handleTextChange = (chunkId: string, newText: string) => {
    setChunks((prev) =>
      prev.map((c) => (c.id === chunkId ? { ...c, text: newText } : c))
    );
    setHasUnsavedChanges(true);
  };

  const handleSubtitleCueChange = (cueIndex: number, newText: string) => {
    setSubtitleCues((prev) =>
      prev.map((c) =>
        c.index === cueIndex ? { ...c, text: newText, isEdited: true } : c
      )
    );
    setHasUnsavedChanges(true);
  };

  const handleAcknowledgeWarning = (chunk: BatchQcChunkItem) => {
    const sig = getChunkAudioSignature({ ...chunk, status: "ready" });
    const nextChunks = chunks.map((c) =>
      c.id === chunk.id
        ? {
            ...c,
            acknowledgedAt: Date.now(),
            acknowledgedAudioSignature: sig,
          }
        : c
    );
    setChunks(nextChunks);
    persistJobChunksState(nextChunks);
  };

  const persistJobChunksState = (nextChunks: BatchQcChunkItem[]) => {
    if (!targetStep) return;
    const nextStats = countChunkQualityIssues(toCheckableItems(nextChunks));
    const hasWarnOrErr = nextStats.errorCount > 0 || nextStats.warningCount > 0;
    const warningMsg = hasWarnOrErr
      ? isDialogue
        ? `Hậu kiểm chất lượng Hội thoại: ${nextStats.errorCount} lượt lỗi, ${nextStats.warningCount} lượt cảnh báo.`
        : `Hậu kiểm chất lượng TTS: ${nextStats.errorCount} đoạn lỗi, ${nextStats.warningCount} đoạn cảnh báo.`
      : undefined;

    const updatedStepResults = {
      ...job.stepResults,
      [activeTask]: {
        ...targetStep,
        status: (hasWarnOrErr
          ? "completed_with_warning"
          : "completed") as BatchStepResult["status"],
        warning: warningMsg,
        qcChunks: nextChunks,
        qcStats: {
          totalChunks: nextChunks.length,
          errorCount: nextStats.errorCount,
          warningCount: nextStats.warningCount,
          passCount: nextStats.passCount,
          unverifiedCount: nextStats.unverifiedCount,
        },
      },
    };

    const allSteps = Object.values(updatedStepResults).filter(
      Boolean
    ) as BatchStepResult[];
    const anyStepHasWarning = allSteps.some(
      (sr) => sr.status === "completed_with_warning" || Boolean(sr.warning)
    );
    const combinedWarnings = allSteps
      .map((sr) => sr.warning)
      .filter(Boolean)
      .join(" | ");

    const updatedJob: BatchJob = {
      ...job,
      status: anyStepHasWarning ? "completed_with_warning" : "completed",
      warningMessage: combinedWarnings || undefined,
      stepResults: updatedStepResults,
    };
    onSaveUpdatedJob(updatedJob);
  };

  const regenerateSingleChunk = async (
    targetChunk: BatchQcChunkItem
  ): Promise<BatchQcChunkItem | null> => {
    const ai = await getSharedAiServices();
    if (!ai) {
      setStatusBanner({
        type: "error",
        message: "Local AI runtime chưa sẵn sàng (sidecar không khả dụng).",
      });
      return null;
    }

    const ttsSnapshot =
      job.effectiveConfigSnapshot?.tasks.tts || job.configOverrides.tts;
    const dialogueSnapshot =
      job.effectiveConfigSnapshot?.tasks.dialogue || job.configOverrides.dialogue;
    const dubSnapshot =
      job.effectiveConfigSnapshot?.tasks.dubbing || job.configOverrides.dubbing;

    const model = isDialogue
      ? dialogueSnapshot?.model || "omnivoice"
      : activeTask === "dubbing"
      ? dubSnapshot?.ttsModel || "omnivoice"
      : ttsSnapshot?.model || "omnivoice";
    const voiceId =
      targetChunk.voiceId ||
      (isDialogue
        ? (targetChunk.characterName &&
            dialogueSnapshot?.characterVoices?.[targetChunk.characterName]) ||
          dialogueSnapshot?.defaultVoiceId ||
          "omnivoice-auto"
        : activeTask === "dubbing"
        ? dubSnapshot?.voiceId || "omnivoice-auto"
        : ttsSnapshot?.voiceId || "omnivoice-auto");
    const rawSpeed = isDialogue
      ? dialogueSnapshot?.speed
      : activeTask === "dubbing"
      ? dubSnapshot?.speed
      : ttsSnapshot?.speed;
    const speed = rawSpeed && rawSpeed !== 1 ? rawSpeed : undefined;

    const isOnlineVoice =
      typeof voiceId === "string" &&
      (voiceId.includes("Neural") ||
        voiceId.startsWith("edge_") ||
        voiceId.startsWith("google_"));

    const projectId = isDialogue
      ? "dialogue"
      : activeTask === "dubbing"
      ? "dubbing"
      : "current";
    const effectiveRules = getEffectiveRules(projectId);
    const advancedSettings = !isOnlineVoice
      ? getEngineAdvancedSettings(model)
      : undefined;

    const scratchScope = `${activeTask}-${job.id}`.replace(/[^\w-]/g, "_");
    const outputPath =
      targetChunk.audioFilePath ||
      (await ai.scratchPath(
        scratchScope,
        `regen_${targetChunk.index}_${Date.now()}.${isOnlineVoice ? "mp3" : "wav"}`
      ));

    let synthResult: { durationSec: number; outputPath: string };
    if (isOnlineVoice) {
      synthResult = await edgeTtsProvider.synthesize({
        voiceId,
        text: targetChunk.text,
        outputPath,
        speed,
      });
    } else {
      synthResult = await ai.synthesize({
        model,
        voiceId,
        text: targetChunk.text,
        outputPath,
        speed,
        advancedSettings,
        pronunciationRules: effectiveRules,
        ...(projectId !== "current" ? { projectId } : {}),
      });
    }

    const checkable: ChunkItem = {
      id: targetChunk.id,
      index: targetChunk.index,
      text: targetChunk.text,
      originalText: targetChunk.originalText || targetChunk.text,
      durationSec: synthResult.durationSec,
      pauseAfterMs: "auto",
      audioUrl: synthResult.outputPath,
      audioFilePath: synthResult.outputPath,
      status: "ready",
    };

    const qualityReview = await validateChunkAudioQuality(
      checkable,
      undefined,
      ai,
      speed,
      undefined,
      projectId
    );

    return {
      ...targetChunk,
      durationSec: synthResult.durationSec,
      audioFilePath: synthResult.outputPath,
      qualityReview,
      acknowledgedAt: undefined,
      acknowledgedAudioSignature: undefined,
    };
  };

  const handleRegenerateOne = async (chunk: BatchQcChunkItem) => {
    setIsPlayingTrack(false);
    setRegeneratingIds((prev) => new Set(prev).add(chunk.id));
    setStatusBanner({
      type: "info",
      message: `Đang tạo lại giọng đọc và hậu kiểm Whisper cho câu #${chunk.index}...`,
    });
    try {
      const updated = await regenerateSingleChunk(chunk);
      if (updated) {
        setChunks((prev) =>
          prev.map((c) => (c.id === chunk.id ? updated : c))
        );
        setHasUnsavedChanges(true);
        const st = updated.qualityReview?.status;
        setStatusBanner({
          type: st === "error" ? "error" : "success",
          message:
            st === "pass"
              ? `Câu #${chunk.index} đã tạo lại và đạt chuẩn chất lượng!`
              : `Câu #${chunk.index} đã tạo lại (${
                  updated.qualityReview?.summary || "Cần kiểm tra"
                }). Nhấn "Ghép & Cập nhật file xuất" để lưu vào tệp Master.`,
        });
      }
    } catch (err) {
      setStatusBanner({
        type: "error",
        message: `Lỗi tạo lại câu #${chunk.index}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    } finally {
      setRegeneratingIds((prev) => {
        const next = new Set(prev);
        next.delete(chunk.id);
        return next;
      });
    }
  };

  const handleRegenerateByFilter = async (mode: "all_issues" | "errors" | "warnings") => {
    const flagged = chunks.filter((c) => {
      const st = c.qualityReview?.status;
      const isConfirmed =
        Boolean(c.acknowledgedAudioSignature) &&
        c.acknowledgedAudioSignature ===
          getChunkAudioSignature({ ...c, status: "ready" });
      if (mode === "errors") return st === "error";
      if (mode === "warnings") return st === "warning" && !isConfirmed;
      return st === "error" || (st === "warning" && !isConfirmed);
    });
    if (flagged.length === 0) return;

    setIsPlayingTrack(false);
    setIsRegeneratingAll(true);
    let updatedList = [...chunks];

    try {
      for (let i = 0; i < flagged.length; i++) {
        const target = flagged[i];
        setRegeneratingIds((prev) => new Set(prev).add(target.id));
        setStatusBanner({
          type: "info",
          message: `Đang tạo lại câu ${i + 1}/${flagged.length} (#${target.index})...`,
        });
        const updated = await regenerateSingleChunk(target);
        if (updated) {
          updatedList = updatedList.map((c) =>
            c.id === target.id ? updated : c
          );
          setChunks(updatedList);
          setHasUnsavedChanges(true);
        }
        setRegeneratingIds((prev) => {
          const next = new Set(prev);
          next.delete(target.id);
          return next;
        });
      }
      setStatusBanner({
        type: "success",
        message: `Đã tạo lại xong ${flagged.length} câu. Nhấn "Ghép & Cập nhật file xuất" để lưu vào tệp Master.`,
      });
    } catch (err) {
      setStatusBanner({
        type: "error",
        message: `Lỗi khi tạo lại hàng loạt: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    } finally {
      setIsRegeneratingAll(false);
      setRegeneratingIds(new Set());
    }
  };

  const handleSaveAndRebuild = async () => {
    setIsPlayingTrack(false);
    setIsRebuildingMaster(true);

    try {
      // Case 1: Saving edited subtitle cues directly to .srt/.vtt file on disk
      if ((!isVoiceTask || chunks.length === 0) && activeSubtitlePath && subtitleCues.length > 0) {
        setStatusBanner({
          type: "info",
          message: "Đang lưu nội dung phụ đề đã chỉnh sửa...",
        });
        const isVtt = activeSubtitlePath.toLowerCase().endsWith(".vtt");
        const content = isVtt
          ? exportToVtt(subtitleCues)
          : exportToSrt(subtitleCues);
        await tauriAiFs.writeText(activeSubtitlePath, content);
        setSubtitleCues((prev) => prev.map((c) => ({ ...c, isEdited: false })));
        setHasUnsavedChanges(false);
        setStatusBanner({
          type: "success",
          message: "Đã lưu tệp phụ đề thành công!",
        });
        return;
      }

      // Case 2: Re-assembling Master Audio (+ synchronized subtitle) from chunks
      if (!targetStep) return;
      setStatusBanner({
        type: "info",
        message: "Đang ghép nối lại file Master Audio và đồng bộ phụ đề...",
      });

      const ai = await getSharedAiServices();
      if (!ai) {
        throw new Error("Local AI runtime chưa sẵn sàng.");
      }

      if (!masterAudioPath) {
        throw new Error("Không tìm thấy đường dẫn file Master Audio đã xuất.");
      }

      const format = masterAudioPath.toLowerCase().endsWith(".mp3")
        ? "mp3"
        : "wav";
      const sortedChunks = [...chunks].sort((a, b) => a.index - b.index);

      if (isDialogue) {
        const dialogueSnapshot =
          job.effectiveConfigSnapshot?.tasks.dialogue ||
          job.configOverrides.dialogue;
        const segments: DialogueSegment[] = sortedChunks.map((c) => ({
          id: c.id,
          index: c.index,
          characterId: c.characterName || "Narrator",
          characterName: c.characterName || "Narrator",
          rawText: c.originalText || c.text,
          cleanText: c.text,
          voiceId: c.voiceId,
          durationSec: c.durationSec,
          pauseAfterSec: 0,
          audioFilePath: c.audioFilePath,
          status: "ready",
        }));
        const globalSettings: DialogueGlobalSettings = {
          ...DEFAULT_DIALOGUE_SETTINGS,
          model: dialogueSnapshot?.model || DEFAULT_DIALOGUE_SETTINGS.model,
          sameSpeakerPauseSec: dialogueSnapshot?.sameSpeakerPauseSec ?? 0.3,
          ...(dialogueSnapshot?.pauses ? { pauses: dialogueSnapshot.pauses } : {}),
          exportSrt: dialogueSnapshot?.exportSrt ?? true,
        };
        const assembly = calculateDialogueTimeline(segments, globalSettings);
        await ai.assemble({
          inputs: assembly.timeline.map((entry, idx) => ({
            path: sortedChunks[idx].audioFilePath,
            gapAfterMs: Math.round(entry.pauseAfterSec * 1000),
          })),
          outputPath: masterAudioPath,
          format,
        });

        if (activeSubtitlePath) {
          const subSettings = loadSubtitleSettings();
          const srtContent = generateDialogueSrt(assembly.timeline, {
            aspectRatio: subSettings.aspectRatio,
            maxLines: subSettings.maxLines,
          });
          const finalSub = activeSubtitlePath.toLowerCase().endsWith(".vtt")
            ? convertSubtitleFormat(srtContent, "srt", "vtt")
            : srtContent;
          await tauriAiFs.writeText(activeSubtitlePath, finalSub);
        }
      } else {
        const ttsSnapshot =
          job.effectiveConfigSnapshot?.tasks.tts || job.configOverrides.tts;
        const chunkItems: ChunkItem[] = sortedChunks.map((c) => ({
          id: c.id,
          index: c.index,
          text: c.text,
          originalText: c.originalText || c.text,
          durationSec: c.durationSec,
          pauseAfterMs: "auto",
          audioUrl: c.audioFilePath,
          audioFilePath: c.audioFilePath,
          status: "ready",
        }));
        const pauses = computeChunkPausesMs(chunkItems, ttsSnapshot?.pauses);
        await ai.assemble({
          inputs: sortedChunks.map((c, idx) => ({
            path: c.audioFilePath,
            gapAfterMs: pauses[idx],
          })),
          outputPath: masterAudioPath,
          format,
        });

        if (activeSubtitlePath) {
          const cues = generateSubtitlesFromChunks(chunkItems);
          const subContent = activeSubtitlePath.toLowerCase().endsWith(".vtt")
            ? exportToVtt(cues)
            : exportToSrt(cues);
          await tauriAiFs.writeText(activeSubtitlePath, subContent);
        }
      }

      persistJobChunksState(chunks);
      setHasUnsavedChanges(false);
      setStatusBanner({
        type: "success",
        message: "Đã ghép & cập nhật thành công file Master Audio và phụ đề!",
      });
    } catch (err) {
      setStatusBanner({
        type: "error",
        message: `Lỗi cập nhật file xuất: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    } finally {
      setIsRebuildingMaster(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150 select-none">
      <div className="w-full max-w-5xl max-h-[90vh] bg-panel rounded-2xl border border-borderDefault shadow-2xl flex flex-col overflow-hidden">
        {/* 1. HEADER */}
        <div className="px-5 py-3.5 border-b border-borderDefault bg-surface1 flex items-center justify-between gap-3 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center border shrink-0 ${
                stats.errorCount > 0
                  ? "bg-danger/15 border-danger/30 text-danger"
                  : stats.warningCount > 0
                  ? "bg-warning/15 border-warning/30 text-warning"
                  : "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
              }`}
            >
              {stats.errorCount > 0 ? (
                <AlertCircle className="w-4.5 h-4.5" />
              ) : stats.warningCount > 0 ? (
                <AlertTriangle className="w-4.5 h-4.5" />
              ) : (
                <CheckCircle2 className="w-4.5 h-4.5" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-textPrimary truncate">
                  Chi tiết kết quả & Hậu kiểm
                </h3>
                <span className="text-[11px] font-mono text-textMuted truncate">
                  • {job.sourceFileName}
                </span>
              </div>

              {/* Task Switcher Tabs */}
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                {availableTasks.map((tKey) => {
                  const isActive = activeTask === tKey;
                  const sr = job.stepResults[tKey];
                  const tErr = sr?.qcStats?.errorCount ?? 0;
                  const tWarn = sr?.qcStats?.warningCount ?? 0;
                  return (
                    <button
                      key={tKey}
                      type="button"
                      onClick={() => setActiveTask(tKey)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-semibold border transition-colors cursor-pointer ${
                        isActive
                          ? "bg-accent/15 text-accent border-accent/40"
                          : "bg-surface2 hover:bg-surface3 text-textSecondary border-borderDefault"
                      }`}
                    >
                      {getTaskIcon(tKey)}
                      <span>{TASK_LABELS[tKey]}</span>
                      {(tErr > 0 || tWarn > 0) && (
                        <span
                          className={`px-1.5 py-0.2 rounded-full text-[9px] font-bold ${
                            tErr > 0
                              ? "bg-danger text-white"
                              : "bg-warning/25 text-warning"
                          }`}
                        >
                          {tErr + tWarn}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right Header Actions: Preview Master Audio + Open Folder + Close */}
          <div className="flex items-center gap-2 shrink-0">
            {masterAudioPath && (
              <button
                type="button"
                onClick={handlePreviewMasterAudio}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                  activeTrack?.id === `master-${job.id}` && isPlayingTrack
                    ? "bg-accent text-white border-accent shadow-2xs"
                    : "bg-surface2 hover:bg-surface3 text-textPrimary hover:text-accent border-borderDefault"
                }`}
                title="Nghe thử toàn bộ bản thu Master Audio kèm sóng âm"
              >
                <Music className="w-3.5 h-3.5" />
                <span>
                  {activeTrack?.id === `master-${job.id}` && isPlayingTrack
                    ? "Đang phát bản thu..."
                    : "Nghe toàn bộ"}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={handleOpenFolder}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-surface2 hover:bg-surface3 text-textPrimary border border-borderDefault transition-colors cursor-pointer"
              title="Mở thư mục chứa tệp xuất trong File Explorer"
            >
              <FolderOpen className="w-3.5 h-3.5 text-accent" />
              <span>Mở thư mục</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setIsPlayingTrack(false);
                onClose();
              }}
              className="p-1.5 text-textMuted hover:text-textPrimary rounded-lg hover:bg-surface2 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 2. SUB-TOOLBAR (For Voice Tasks with Chunks) */}
        {isVoiceTask && chunks.length > 0 && (
          <div className="px-5 py-2.5 border-b border-borderDefault bg-surface2/40 flex flex-wrap items-center justify-between gap-2 text-xs flex-shrink-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setFilterTab("all")}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer ${
                  filterTab === "all"
                    ? "bg-accent text-white"
                    : "bg-surface3 text-textSecondary hover:text-textPrimary"
                }`}
              >
                Tất cả ({chunks.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterTab("issues")}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
                  filterTab === "issues"
                    ? "bg-warning text-black font-bold"
                    : "bg-surface3 text-textSecondary hover:text-textPrimary"
                }`}
              >
                <AlertTriangle className="w-3 h-3" />
                <span>Cần kiểm tra ({totalIssues})</span>
              </button>
              <button
                type="button"
                onClick={() => setFilterTab("pass")}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
                  filterTab === "pass"
                    ? "bg-emerald-600 text-white"
                    : "bg-surface3 text-textSecondary hover:text-textPrimary"
                }`}
              >
                <CheckCircle2 className="w-3 h-3" />
                <span>Đạt chuẩn ({stats.passCount})</span>
              </button>
            </div>

            {/* Selective Regeneration Buttons matching Standalone TTS / Dialogue Studio */}
            <div className="flex items-center gap-2">
              {stats.errorCount > 0 && (
                <button
                  type="button"
                  disabled={isRegeneratingAll || isRebuildingMaster}
                  onClick={() => handleRegenerateByFilter("errors")}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-danger hover:bg-danger/90 text-white transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isRegeneratingAll ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="w-3.5 h-3.5" />
                  )}
                  <span>Tạo lại {stats.errorCount} lỗi</span>
                </button>
              )}

              {stats.warningCount > 0 && (
                <button
                  type="button"
                  disabled={isRegeneratingAll || isRebuildingMaster}
                  onClick={() => handleRegenerateByFilter("warnings")}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-500 hover:bg-amber-600 text-white transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isRegeneratingAll ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  <span>Tạo lại {stats.warningCount} cảnh báo</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Status Banner */}
        {statusBanner && (
          <div
            className={`px-5 py-2 text-xs font-medium flex items-center justify-between border-b flex-shrink-0 ${
              statusBanner.type === "error"
                ? "bg-danger/10 text-danger border-danger/25"
                : statusBanner.type === "success"
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
                : "bg-accent/10 text-accent border-accent/25"
            }`}
          >
            <span>{statusBanner.message}</span>
            <button
              type="button"
              onClick={() => setStatusBanner(null)}
              className="text-[11px] underline opacity-80 hover:opacity-100 cursor-pointer ml-3"
            >
              Đóng
            </button>
          </div>
        )}

        {/* 3. MAIN CONTENT AREA */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5 min-h-0">
          {isVoiceTask && chunks.length > 0 ? (
            filteredChunks.length === 0 ? (
              <div className="py-12 text-center text-xs text-textMuted">
                Không có câu nào trong bộ lọc này.
              </div>
            ) : (
              filteredChunks.map((chunk) => {
                const review = chunk.qualityReview;
                const isConfirmed =
                  Boolean(chunk.acknowledgedAudioSignature) &&
                  chunk.acknowledgedAudioSignature ===
                    getChunkAudioSignature({ ...chunk, status: "ready" });
                const isError = review?.status === "error";
                const isWarn = review?.status === "warning" && !isConfirmed;
                const isPlaying =
                  activeTrack?.id === chunk.id && isPlayingTrack;
                const isRegen = regeneratingIds.has(chunk.id);

                return (
                  <div
                    key={chunk.id}
                    className={`p-3 rounded-xl border transition-all space-y-2 ${
                      isPlaying
                        ? "bg-accent/[0.06] border-accent/60 ring-1 ring-accent/30"
                        : isError
                        ? "bg-danger/5 border-danger/40"
                        : isWarn
                        ? "bg-warning/5 border-warning/40"
                        : "bg-surface2/40 border-borderDefault"
                    }`}
                  >
                    {/* Top Row: Meta + Badges + Actions */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded bg-surface3 text-[11px] font-mono font-bold text-accent">
                          #{String(chunk.index).padStart(2, "0")}
                        </span>

                        {chunk.characterName && (
                          <span className="px-2 py-0.5 rounded bg-accent/15 text-accent border border-accent/30 text-[11px] font-bold">
                            [{chunk.characterName}]
                          </span>
                        )}

                        <span className="text-[11px] text-textMuted font-mono">
                          {chunk.durationSec
                            ? `${chunk.durationSec.toFixed(1)}s`
                            : "0.0s"}
                        </span>

                        {review?.metrics?.wpm ? (
                          <span className="text-[11px] text-textMuted font-mono">
                            • {Math.round(review.metrics.wpm)} WPM
                          </span>
                        ) : null}

                        {/* QC Status Pill */}
                        {isError ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-danger/20 text-danger border border-danger/35">
                            <AlertCircle className="w-3 h-3" />
                            <span>Lỗi</span>
                          </span>
                        ) : isWarn ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-warning/20 text-warning border border-warning/35">
                            <AlertTriangle className="w-3 h-3" />
                            <span>Cảnh báo</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>{isConfirmed ? "Đã xác nhận" : "Đạt chuẩn"}</span>
                          </span>
                        )}

                        {/* Issue Short Labels */}
                        {(isError || isWarn) &&
                          review?.issues?.map((iss, iIdx) => (
                            <span
                              key={iIdx}
                              className="px-2 py-0.5 rounded text-[10px] font-semibold bg-surface3 text-textPrimary border border-borderDefault"
                              title={iss.message}
                            >
                              {getIssueShortLabel(iss.code)}
                            </span>
                          ))}
                      </div>

                      {/* Chunk Action Buttons */}
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handlePlayChunk(chunk)}
                          disabled={isRegen}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer ${
                            isPlaying
                              ? "bg-accent text-white border-accent"
                              : "bg-surface3 hover:bg-surface2 text-textPrimary border-borderDefault"
                          }`}
                        >
                          {isPlaying ? (
                            <>
                              <Square className="w-3 h-3 fill-current" />
                              <span>Tạm dừng</span>
                            </>
                          ) : (
                            <>
                              <Play className="w-3 h-3 fill-current" />
                              <span>Nghe thử</span>
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleRegenerateOne(chunk)}
                          disabled={
                            isRegen || isRegeneratingAll || isRebuildingMaster
                          }
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer disabled:opacity-50 ${
                            isError
                              ? "bg-danger/15 hover:bg-danger/25 text-danger border-danger/30"
                              : isWarn
                              ? "bg-warning/15 hover:bg-warning/25 text-warning border-warning/30"
                              : "bg-surface3 hover:bg-surface2 text-textPrimary border-borderDefault"
                          }`}
                          title="Tạo lại âm thanh cho câu này và kiểm tra lại bằng Whisper"
                        >
                          {isRegen ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <RotateCcw className="w-3 h-3" />
                          )}
                          <span>Tạo lại</span>
                        </button>

                        {isWarn && (
                          <button
                            type="button"
                            onClick={() => handleAcknowledgeWarning(chunk)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 transition-colors cursor-pointer"
                            title="Xác nhận câu này đọc đúng, bỏ qua cảnh báo"
                          >
                            <Check className="w-3 h-3" />
                            <span>Bỏ qua</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Editable Textarea */}
                    <textarea
                      value={chunk.text}
                      onChange={(e) => handleTextChange(chunk.id, e.target.value)}
                      rows={2}
                      className="w-full px-3 py-1.5 rounded-lg bg-surface1 border border-borderDefault focus:border-accent focus:outline-none text-xs text-textPrimary resize-y leading-relaxed select-text"
                      placeholder="Nội dung văn bản của câu..."
                    />

                    {/* Detailed QC Issue Messages */}
                    {(isError || isWarn) && review && (
                      <div className="px-3 py-2 rounded-lg bg-surface1/80 border border-borderDefault/70 text-[11px] space-y-1">
                        {review.issues && review.issues.length > 0 ? (
                          review.issues.map((iss, idx) => (
                            <div
                              key={idx}
                              className="flex items-start gap-1.5 text-textSecondary"
                            >
                              <ShieldAlert
                                className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${
                                  iss.severity === "error"
                                    ? "text-danger"
                                    : "text-warning"
                                }`}
                              />
                              <span>{iss.message}</span>
                            </div>
                          ))
                        ) : (
                          <div className="text-textSecondary">{review.summary}</div>
                        )}
                        {review.issues?.[0]?.asrRawExcerpt && (
                          <div className="text-[10px] text-textMuted font-mono pt-0.5">
                            Whisper nghe được: &ldquo;
                            {review.issues[0].asrRawExcerpt}&rdquo;
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )
          ) : isLoadingSubtitle ? (
            <div className="py-12 text-center text-xs text-textMuted flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-accent" />
              <span>Đang tải danh sách câu phụ đề...</span>
            </div>
          ) : subtitleCues.length > 0 ? (
            /* Subtitle Cues Editor (for Transcription / Translation or jobs with .srt/.vtt) */
            subtitleCues.map((cue) => (
              <div
                key={cue.index}
                className="p-3 rounded-xl border border-borderDefault bg-surface2/40 space-y-1.5"
              >
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-surface3 font-bold text-accent">
                      #{String(cue.index).padStart(3, "0")}
                    </span>
                    {cue.isEdited && (
                      <span className="text-[10px] font-sans font-semibold text-warning">
                        • Đã chỉnh sửa
                      </span>
                    )}
                  </div>
                  <span className="text-textMuted">
                    {formatSrtTimestamp(cue.startSec)} →{" "}
                    {formatSrtTimestamp(cue.endSec)}
                  </span>
                </div>
                <textarea
                  value={cue.text}
                  onChange={(e) =>
                    handleSubtitleCueChange(cue.index, e.target.value)
                  }
                  rows={2}
                  className="w-full px-3 py-1.5 rounded-lg bg-surface1 border border-borderDefault focus:border-accent focus:outline-none text-xs text-textPrimary resize-y leading-relaxed select-text"
                />
              </div>
            ))
          ) : (
            <div className="py-12 text-center space-y-2 text-xs text-textMuted">
              <FileText className="w-8 h-8 mx-auto opacity-40 text-accent" />
              <p>
                Tệp này đã hoàn tất xử lý ({job.artifacts.ownedArtifactPaths.length}{" "}
                kết quả xuất).
              </p>
              {masterAudioPath && (
                <p className="text-[11px]">
                  Nhấn <strong>&ldquo;Nghe toàn bộ&rdquo;</strong> ở góc trên bên phải
                  để nghe thử bản thu Master Audio.
                </p>
              )}
            </div>
          )}
        </div>

        {/* 4. EMBEDDED WAVEFORM AUDIO PLAYER (Matches Standalone Workspaces) */}
        {activeTrack && (
          <div className="px-4 pb-3 pt-1 bg-panel shrink-0">
            <BottomAudioPlayer
              track={activeTrack}
              isPlaying={isPlayingTrack}
              onTogglePlay={() => setIsPlayingTrack((prev) => !prev)}
              onClose={() => {
                setIsPlayingTrack(false);
                setActiveTrack(null);
              }}
            />
          </div>
        )}

        {/* 5. FOOTER */}
        <div className="px-5 py-3 border-t border-borderDefault bg-surface1 flex items-center justify-between gap-3 flex-shrink-0">
          <div className="text-[11px] text-textMuted flex items-center gap-2">
            <Volume2 className="w-3.5 h-3.5 text-accent shrink-0" />
            <span>
              {hasUnsavedChanges
                ? "Có thay đổi câu chữ / âm thanh chưa lưu vào tệp kết quả xuất."
                : "Bạn có thể nghe thử từng câu, chỉnh sửa văn bản, tạo lại câu lỗi và cập nhật trực tiếp tệp xuất."}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setIsPlayingTrack(false);
                onClose();
              }}
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-textSecondary hover:text-textPrimary hover:bg-surface2 transition-colors cursor-pointer"
            >
              Đóng
            </button>

            {(chunks.length > 0 || subtitleCues.length > 0) && (
              <button
                type="button"
                disabled={
                  isRebuildingMaster ||
                  isRegeneratingAll ||
                  regeneratingIds.size > 0
                }
                onClick={handleSaveAndRebuild}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold bg-accent hover:bg-accentHover text-white shadow-xs transition-all cursor-pointer disabled:opacity-50"
              >
                {isRebuildingMaster ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                <span>
                  {chunks.length > 0
                    ? "Ghép & Cập nhật file xuất"
                    : "Lưu thay đổi phụ đề"}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
