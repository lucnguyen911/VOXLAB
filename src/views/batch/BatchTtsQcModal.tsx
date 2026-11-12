import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  X,
  Play,
  Pause,
  RefreshCw,
  AlertTriangle,
  AlertCircle,
  Sparkles,
  FileAudio,
  Layers,
  ChevronDown,
  Clock,
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
  isChunkError,
  isChunkWarning,
  isChunkChecking,
  isChunkUnverified,
  getChunkBadgeInfo,
} from "../../services/audio/qualityValidator";
import {
  getSharedAiServices,
  tauriAiFs,
} from "../../services/batch/batchRuntime";
import { convertSubtitleFormat } from "../../services/batch/outputResolver";
import { getEngineAdvancedSettings } from "../../services/ai/ttsAdvancedSettings";
import { edgeTtsProvider } from "../../services/providers/edgeProvider";
import { getEffectiveRules } from "../../services/pronunciation";
import { computeChunkPausesMs } from "../../services/audio/masterExport";
import { generateSubtitlesFromChunks } from "../../services/subtitle/pipeline";
import { exportToSrt, exportToVtt, formatSrtTimestamp } from "../../services/subtitle/exporter";
import { parseSubtitle } from "../../services/subtitle/parser";
import { SubtitleCue } from "../../services/subtitle/types";
import {
  DEFAULT_DIALOGUE_SETTINGS,
  DialogueGlobalSettings,
  DialogueSegment,
} from "../../types/dialogue";
import { calculateDialogueTimeline } from "../../services/dialogue/masterAssembly";
import { generateDialogueSrt } from "../../services/dialogue/srtExporter";
import { loadSubtitleSettings } from "../../services/subtitle/profiles";
import { parsePauseDurationMs } from "../../services/pause";
import {
  BottomAudioPlayer,
  ActiveAudioTrack,
} from "../../components/layout/BottomAudioPlayer";

const AutoResizeTextarea: React.FC<{
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
}> = ({ value, onChange, className, placeholder }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  useEffect(() => {
    window.addEventListener("resize", adjustHeight);
    return () => window.removeEventListener("resize", adjustHeight);
  }, [adjustHeight]);

  return (
    <textarea
      ref={textareaRef}
      rows={1}
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
        adjustHeight();
      }}
      className={`cursor-text caret-accent ${className}`}
      placeholder={placeholder}
    />
  );
};

export interface BatchTtsQcModalProps {
  job: BatchJob;
  isOpen: boolean;
  onClose: () => void;
  onSaveUpdatedJob: (updatedJob: BatchJob) => void;
}

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

type StudioChunkRow = BatchQcChunkItem & {
  status: "ready" | "generating" | "modified";
};

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

  useEffect(() => {
    if (!availableTasks.includes(activeTask)) {
      setActiveTask(availableTasks[0] || "tts");
    }
  }, [job.id, availableTasks]);

  const targetStep: BatchStepResult | undefined = job.stepResults[activeTask];
  const isVoiceTask =
    activeTask === "tts" || activeTask === "dialogue" || activeTask === "dubbing";
  const isDialogue = activeTask === "dialogue";

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

  // Chunks state matching TTS / Dialogue Studio
  const [chunks, setChunks] = useState<StudioChunkRow[]>(() =>
    targetStep?.qcChunks
      ? targetStep.qcChunks.map((c) => ({ ...c, status: "ready" as const }))
      : []
  );

  // Subtitle cues state for Transcription / Translation
  const [subtitleCues, setSubtitleCues] = useState<
    (SubtitleCue & { isEdited?: boolean })[]
  >([]);
  const [isLoadingSubtitle, setIsLoadingSubtitle] = useState(false);

  const [selectedChunkId, setSelectedChunkId] = useState<string | null>(
    () => targetStep?.qcChunks?.[0]?.id || null
  );
  const [expandedIssuesChunks, setExpandedIssuesChunks] = useState<
    Record<string, boolean>
  >({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRebuildingMaster, setIsRebuildingMaster] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [statusBanner, setStatusBanner] = useState<{
    type: "info" | "success" | "error";
    message: string;
  } | null>(null);

  // BottomAudioPlayer state (identical to TTS / Dialogue workspace)
  const [activeTrack, setActiveTrack] = useState<ActiveAudioTrack | null>(null);
  const [isPlayingTrack, setIsPlayingTrack] = useState(false);

  useEffect(() => {
    const step = job.stepResults[activeTask];
    if (step?.qcChunks && step.qcChunks.length > 0) {
      setChunks(step.qcChunks.map((c) => ({ ...c, status: "ready" as const })));
      setSelectedChunkId(step.qcChunks[0].id);
    } else {
      setChunks([]);
      setSelectedChunkId(null);
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

  const qualityStats = countChunkQualityIssues(chunks);
  const modifiedChunks = chunks.filter((c) => c.status === "modified");

  const handlePlayChunk = (chunk: StudioChunkRow) => {
    if (!chunk.audioFilePath) {
      setStatusBanner({
        type: "error",
        message: `Không tìm thấy file âm thanh của đoạn #${String(chunk.index).padStart(2, "0")}.`,
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
      title: `Đoạn ${String(chunk.index).padStart(2, "0")}`,
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

  const handleChunkTextChange = (chunkId: string, newText: string) => {
    setChunks((prev) =>
      prev.map((c) =>
        c.id === chunkId ? { ...c, text: newText, status: "modified" } : c
      )
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

  const persistJobChunksState = (nextChunks: StudioChunkRow[]) => {
    if (!targetStep) return;
    const nextStats = countChunkQualityIssues(nextChunks);
    const hasWarnOrErr = nextStats.errorCount > 0 || nextStats.warningCount > 0;
    const warningMsg = hasWarnOrErr
      ? isDialogue
        ? `Hậu kiểm chất lượng Hội thoại: ${nextStats.errorCount} lượt lỗi, ${nextStats.warningCount} lượt cảnh báo.`
        : `Hậu kiểm chất lượng TTS: ${nextStats.errorCount} đoạn lỗi, ${nextStats.warningCount} đoạn cảnh báo.`
      : undefined;

    const cleanQcChunks: BatchQcChunkItem[] = nextChunks.map(
      ({ status: _st, ...rest }) => rest
    );

    const updatedStepResults = {
      ...job.stepResults,
      [activeTask]: {
        ...targetStep,
        status: (hasWarnOrErr
          ? "completed_with_warning"
          : "completed") as BatchStepResult["status"],
        warning: warningMsg,
        qcChunks: cleanQcChunks,
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
    targetChunk: StudioChunkRow
  ): Promise<StudioChunkRow | null> => {
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

    const taskPauses = isDialogue
      ? dialogueSnapshot?.pauses
      : activeTask === "dubbing"
      ? dubSnapshot?.pauses
      : ttsSnapshot?.pauses;

    let synthResult: {
      durationSec: number;
      outputPath: string;
      majorPunctuationSplit?: boolean;
    };
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
        punctuationPauses: taskPauses,
        ...(projectId !== "current" ? { projectId } : {}),
      });
    }

    if (taskPauses && typeof ai.enforcePunctuationPauses === "function") {
      const inner = targetChunk.text.trim().slice(0, -1);
      const needsShape = synthResult.majorPunctuationSplit
        ? /[,，、:;：；]/.test(inner)
        : /[,.;:!?…，、。；：！？]/.test(inner);
      if (needsShape) {
        try {
          const shaped = await ai.enforcePunctuationPauses({
            audioPath: synthResult.outputPath,
            text: targetChunk.text,
            punctuationPauses: taskPauses,
            speed,
            majorAlreadySplit: Boolean(synthResult.majorPunctuationSplit),
          });
          if (shaped && shaped.durationSec > 0) {
            synthResult.durationSec = shaped.durationSec;
          }
        } catch {
          // Non-blocking
        }
      }
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
      status: "ready",
      durationSec: synthResult.durationSec,
      audioFilePath: synthResult.outputPath,
      qualityReview,
      acknowledgedAt: undefined,
      acknowledgedAudioSignature: undefined,
    };
  };

  const handleRegenerateChunk = async (chunkId: string) => {
    const target = chunks.find((c) => c.id === chunkId);
    if (!target) return;

    setIsPlayingTrack(false);
    setIsGenerating(true);
    setChunks((prev) =>
      prev.map((c) => (c.id === chunkId ? { ...c, status: "generating" } : c))
    );

    try {
      const updated = await regenerateSingleChunk(target);
      if (updated) {
        const nextList = chunks.map((c) => (c.id === chunkId ? updated : c));
        setChunks(nextList);
        persistJobChunksState(nextList);
        setHasUnsavedChanges(true);
      } else {
        setChunks((prev) =>
          prev.map((c) => (c.id === chunkId ? { ...c, status: "ready" } : c))
        );
      }
    } catch (err) {
      setChunks((prev) =>
        prev.map((c) => (c.id === chunkId ? { ...c, status: "ready" } : c))
      );
      setStatusBanner({
        type: "error",
        message: `Lỗi tạo lại đoạn #${String(target.index).padStart(2, "0")}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRegenerateBatch = async (
    mode: "errors" | "warnings" | "modified"
  ) => {
    const targets = chunks.filter((c) => {
      if (mode === "modified") return c.status === "modified";
      if (mode === "errors") return isChunkError(c);
      if (mode === "warnings") return isChunkWarning(c);
      return false;
    });
    if (targets.length === 0) return;

    setIsPlayingTrack(false);
    setIsGenerating(true);
    let currentList = [...chunks];

    try {
      for (const target of targets) {
        currentList = currentList.map((c) =>
          c.id === target.id ? { ...c, status: "generating" } : c
        );
        setChunks([...currentList]);

        const updated = await regenerateSingleChunk(target);
        if (updated) {
          currentList = currentList.map((c) =>
            c.id === target.id ? updated : c
          );
          setChunks([...currentList]);
          setHasUnsavedChanges(true);
        } else {
          currentList = currentList.map((c) =>
            c.id === target.id ? { ...c, status: "ready" } : c
          );
          setChunks([...currentList]);
        }
      }
      persistJobChunksState(currentList);
    } catch (err) {
      setStatusBanner({
        type: "error",
        message: `Lỗi khi tạo lại hàng loạt: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveAndRebuild = async () => {
    setIsPlayingTrack(false);
    setIsRebuildingMaster(true);

    try {
      if (
        (!isVoiceTask || chunks.length === 0) &&
        activeSubtitlePath &&
        subtitleCues.length > 0
      ) {
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

      if (!targetStep) return;
      const ai = await getSharedAiServices();
      if (!ai) {
        throw new Error("Local AI runtime chưa sẵn sàng.");
      }
      if (!masterAudioPath) {
        throw new Error("Không tìm thấy đường dẫn file Master Audio đã xuất.");
      }

      // Regenerate any modified chunks first so Master Audio reflects edited text
      let workingChunks = [...chunks];
      const modifiedList = workingChunks.filter((c) => c.status === "modified");
      for (const modChunk of modifiedList) {
        const regen = await regenerateSingleChunk(modChunk);
        if (regen) {
          workingChunks = workingChunks.map((c) =>
            c.id === modChunk.id ? regen : c
          );
        }
      }
      setChunks(workingChunks);

      const format = masterAudioPath.toLowerCase().endsWith(".mp3")
        ? "mp3"
        : "wav";
      const sortedChunks = [...workingChunks].sort((a, b) => a.index - b.index);

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

      persistJobChunksState(workingChunks);
      setHasUnsavedChanges(false);
      setStatusBanner({
        type: "success",
        message: "Đã ghép & xuất cập nhật thành công file Master Audio và phụ đề!",
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

  const isMasterPlaying =
    activeTrack?.id === `master-${job.id}` && isPlayingTrack;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150 select-none">
      <div className="w-full max-w-6xl h-[88vh] bg-background rounded-2xl border border-borderDefault shadow-2xl flex flex-col overflow-hidden">
        {/* 1. SUBHEADER BAR — Identical to TtsWorkspace top bar */}
        <div className="h-12 border-b border-borderDefault bg-panel px-4 flex items-center justify-between flex-shrink-0 gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className="text-xs font-bold text-textPrimary truncate max-w-[320px]"
              title={job.sourceFileName}
            >
              {job.sourceFileName}
            </span>

            {/* Only show task switcher if the job executed multiple tasks */}
            {availableTasks.length > 1 && (
              <div className="inline-flex bg-surface2 rounded-lg p-0.5 border border-borderDefault/60 text-xs flex-shrink-0">
                {availableTasks.map((tKey) => {
                  const isActive = activeTask === tKey;
                  return (
                    <button
                      key={tKey}
                      type="button"
                      onClick={() => setActiveTask(tKey)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium transition-all whitespace-nowrap cursor-pointer ${
                        isActive
                          ? "bg-surface1 text-textPrimary font-semibold shadow-2xs"
                          : "text-textSecondary hover:text-textPrimary"
                      }`}
                    >
                      {getTaskIcon(tKey)}
                      <span>{TASK_LABELS[tKey]}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Actions matching TtsWorkspace studio header: Nghe toàn bộ | Ghép & xuất | Đóng */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {masterAudioPath && (
              <button
                type="button"
                onClick={handlePreviewMasterAudio}
                disabled={isGenerating || isRebuildingMaster}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shadow-xs transition-colors whitespace-nowrap cursor-pointer ${
                  isMasterPlaying
                    ? "bg-accent text-white shadow-2xs"
                    : "bg-surface2 hover:bg-surface3 text-textPrimary hover:text-accent border border-borderDefault hover:border-accent/40"
                }`}
                title="Nghe thử toàn bộ các đoạn ghép lại thành một bản thu hoàn chỉnh"
              >
                {isMasterPlaying ? (
                  <>
                    <Pause className="w-3.5 h-3.5 fill-current" />
                    <span>Tạm dừng</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-accent" />
                    <span>Nghe toàn bộ</span>
                  </>
                )}
              </button>
            )}

            {(chunks.length > 0 || subtitleCues.length > 0) && (
              <button
                type="button"
                onClick={handleSaveAndRebuild}
                disabled={isGenerating || isRebuildingMaster}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shadow-xs transition-colors whitespace-nowrap cursor-pointer bg-surface2 hover:bg-surface3 text-textPrimary hover:text-accent border border-borderDefault hover:border-accent/40"
                title="Ghép lại các đoạn âm thanh và cập nhật trực tiếp vào tệp kết quả xuất"
              >
                {isRebuildingMaster ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-accent" />
                ) : (
                  <FileAudio className="w-3.5 h-3.5 text-accent" />
                )}
                <span>
                  {isRebuildingMaster
                    ? "Đang ghép..."
                    : chunks.length > 0
                    ? "Ghép & xuất"
                    : "Lưu phụ đề"}
                </span>
                {hasUnsavedChanges && !isRebuildingMaster && (
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-warning ml-0.5"
                    title="Có thay đổi cần ghép & xuất lại"
                  />
                )}
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setIsPlayingTrack(false);
                onClose();
              }}
              className="p-1.5 text-textMuted hover:text-textPrimary rounded-lg hover:bg-surface2 transition-colors cursor-pointer ml-1"
              title="Đóng"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Optional transient status banner */}
        {statusBanner && (
          <div
            className={`px-4 py-1.5 text-xs font-medium flex items-center justify-between border-b flex-shrink-0 ${
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

        {/* 2. STUDIO BODY — 100% synchronized with TtsWorkspace Studio */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0 min-w-0">
          {isVoiceTask && chunks.length > 0 ? (
            <>
              {/* Header info bar with 4 distinct counters: Đạt | Cảnh báo | Lỗi | Chưa kiểm chứng */}
              <div className="flex flex-wrap items-center justify-between text-xs text-textMuted px-4 pt-4 pb-2 gap-2 shrink-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 font-mono text-xs">
                    <Layers className="w-3.5 h-3.5 text-accent" />
                    <span className="font-semibold text-textPrimary">
                      {chunks.length} đoạn
                    </span>
                  </div>

                  <div className="h-3.5 w-px bg-borderDefault mx-1" />

                  <div className="flex items-center gap-1.5 font-sans text-xs">
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                      title="Số đoạn đạt chuẩn chất lượng âm thanh"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      <span>Đạt: {qualityStats.passCount}</span>
                    </span>

                    {qualityStats.warningCount > 0 && (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                        title="Số đoạn có cảnh báo chất lượng"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        <span>Cảnh báo: {qualityStats.warningCount}</span>
                      </span>
                    )}

                    {qualityStats.errorCount > 0 && (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium bg-danger/10 text-danger border border-danger/20"
                        title="Số đoạn bị lỗi âm thanh"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-danger" />
                        <span>Lỗi: {qualityStats.errorCount}</span>
                      </span>
                    )}

                    {qualityStats.checkingCount > 0 && (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 animate-pulse"
                        title="Số đoạn đang được đối chiếu và phân tích chất lượng âm thanh"
                      >
                        <RefreshCw className="w-3 h-3 animate-spin text-cyan-400" />
                        <span>Đang kiểm tra: {qualityStats.checkingCount}</span>
                      </span>
                    )}

                    {qualityStats.unverifiedCount > 0 && (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium bg-surface3 text-textSecondary border border-borderDefault"
                        title="Số đoạn chưa kiểm chứng"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-textMuted" />
                        <span>
                          Chưa kiểm chứng: {qualityStats.unverifiedCount}
                        </span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Right selective regeneration buttons matching TtsWorkspace */}
                <div className="flex items-center gap-2 text-xs">
                  {qualityStats.errorCount > 0 && (
                    <button
                      type="button"
                      onClick={() => handleRegenerateBatch("errors")}
                      disabled={isGenerating}
                      className="flex items-center gap-1.5 px-2.5 py-1 bg-danger hover:bg-danger/90 text-white shadow-xs rounded-md text-xs font-semibold transition-all whitespace-nowrap cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
                      title="Chỉ tạo lại các đoạn bị lỗi đỏ"
                    >
                      <RefreshCw className="w-3 h-3 text-white" />
                      <span>Tạo lại {qualityStats.errorCount} lỗi</span>
                    </button>
                  )}

                  {qualityStats.warningCount > 0 && (
                    <button
                      type="button"
                      onClick={() => handleRegenerateBatch("warnings")}
                      disabled={isGenerating}
                      className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white shadow-xs rounded-md text-xs font-semibold transition-all whitespace-nowrap cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
                      title="Chỉ tạo lại các đoạn có cảnh báo chất lượng"
                    >
                      <RefreshCw className="w-3 h-3 text-white" />
                      <span>Tạo lại {qualityStats.warningCount} cảnh báo</span>
                    </button>
                  )}

                  {modifiedChunks.length > 0 && (
                    <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-warning/15 border border-warning/30 text-warning font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-warning" />
                      <span>{modifiedChunks.length} đoạn đã sửa</span>
                    </span>
                  )}

                  {qualityStats.errorCount === 0 &&
                    modifiedChunks.length > 0 && (
                      <button
                        type="button"
                        onClick={() => handleRegenerateBatch("modified")}
                        disabled={isGenerating}
                        className="flex items-center gap-1.5 px-2.5 py-1 bg-accent hover:bg-accentHover text-white shadow-xs rounded-md text-xs font-semibold transition-all whitespace-nowrap cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ml-1 active:scale-95"
                        title="Chỉ tạo lại các đoạn đã chỉnh sửa nội dung"
                      >
                        <RefreshCw className="w-3 h-3 text-white" />
                        <span>Tạo lại ({modifiedChunks.length}) đoạn sửa</span>
                      </button>
                    )}
                </div>
              </div>

              {/* Chunk Cards List — Exact match with TtsWorkspace Studio */}
              <div className="flex-1 overflow-y-auto px-4 pb-2 space-y-2.5 pr-3 min-h-0">
                {chunks.map((chunk) => {
                  const isSelected = selectedChunkId === chunk.id;
                  const isPlaying =
                    activeTrack?.id === chunk.id && isPlayingTrack;
                  const chunkIsError = isChunkError(chunk);
                  const chunkIsWarning = isChunkWarning(chunk);
                  const badgeInfo = getChunkBadgeInfo(chunk);
                  const pauseMs = parsePauseDurationMs(chunk.text) || 0;

                  return (
                    <div
                      key={chunk.id}
                      onClick={() => setSelectedChunkId(chunk.id)}
                      className={`p-3 rounded-xl border transition-[border-color,background-color,box-shadow] duration-150 cursor-pointer select-none space-y-2 min-h-[96px] ${
                        isSelected
                          ? "bg-accent/[0.04] border-accent/45 shadow-2xs"
                          : "bg-surface1 hover:bg-surface2/30 border-borderDefault hover:border-textMuted/40 shadow-2xs"
                      }`}
                    >
                      <div className="min-h-[28px] flex items-center justify-between gap-3">
                        {/* Left: Index & Character & Duration & Pause & Non-normal Badges */}
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          <span className="font-mono text-xs font-bold text-accent px-1.5 py-0.5 rounded-md bg-surface3/80 shrink-0">
                            {String(chunk.index).padStart(2, "0")}
                          </span>

                          {chunk.characterName && (
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-accent/15 text-accent border border-accent/30 shrink-0">
                              [{chunk.characterName}]
                            </span>
                          )}

                          {typeof chunk.durationSec === "number" &&
                            !Number.isNaN(chunk.durationSec) && (
                              <span className="font-mono text-xs text-textMuted font-medium shrink-0">
                                {chunk.durationSec.toFixed(1)}s
                              </span>
                            )}

                          {pauseMs > 0 && (
                            <span
                              className="font-mono text-xs font-semibold text-accent px-1.5 py-0.5 rounded-md bg-accent/10 border border-accent/25 shrink-0 flex items-center gap-1"
                              title={`Khoảng dừng nghỉ sau đoạn: ${pauseMs}ms`}
                            >
                              <Clock className="w-3 h-3 text-accent" />
                              <span>{(pauseMs / 1000).toFixed(1)}s pause</span>
                            </span>
                          )}

                          {/* Badges ONLY for non-normal states (No "Đạt chuẩn" or WPM clutter!) */}
                          {chunk.status === "generating" && (
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-accent/15 text-accent border border-accent/30 animate-pulse flex items-center gap-1.5 shrink-0">
                              <RefreshCw className="w-3 h-3 animate-spin" />
                              <span>Đang tạo...</span>
                            </span>
                          )}

                          {chunk.status === "modified" && (
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-warning/15 text-warning border border-warning/30 flex items-center gap-1 shrink-0">
                              <AlertCircle className="w-3.5 h-3.5" />
                              <span>Đã sửa</span>
                            </span>
                          )}

                          {chunkIsError &&
                            chunk.status !== "generating" &&
                            badgeInfo && (
                              <span
                                className="text-xs font-semibold px-2 py-0.5 rounded-md bg-danger/15 text-danger border border-danger/30 flex items-center gap-1.5 shrink-0"
                                title={
                                  chunk.qualityReview?.summary ||
                                  badgeInfo.fullBadgeText
                                }
                              >
                                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                                <span className="hidden sm:inline">
                                  {badgeInfo.fullBadgeText}
                                </span>
                                <span className="inline sm:hidden">
                                  {badgeInfo.compactBadgeText}
                                </span>
                              </span>
                            )}

                          {chunkIsWarning &&
                            chunk.status !== "generating" &&
                            badgeInfo && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedIssuesChunks((prev) => ({
                                    ...prev,
                                    [chunk.id]: !prev[chunk.id],
                                  }));
                                }}
                                className="text-xs font-semibold px-2 py-0.5 rounded-md bg-amber-500/15 hover:bg-amber-500/25 text-amber-500 border border-amber-500/30 flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer"
                                title="Bấm để xem chi tiết vấn đề"
                              >
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                <span className="hidden sm:inline">
                                  {badgeInfo.fullBadgeText}
                                </span>
                                <span className="inline sm:hidden">
                                  {badgeInfo.compactBadgeText}
                                </span>
                              </button>
                            )}

                          {isChunkChecking(chunk) &&
                            chunk.status !== "generating" && (
                              <span
                                className="text-xs font-medium px-2 py-0.5 rounded-md bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 flex items-center gap-1.5 shrink-0 animate-pulse"
                                title="Đang phân tích chất lượng âm thanh và đối chiếu phụ đề qua ASR..."
                              >
                                <RefreshCw className="w-3 h-3 animate-spin text-cyan-400" />
                                <span>Đang kiểm tra...</span>
                              </span>
                            )}

                          {isChunkUnverified(chunk) &&
                            chunk.status !== "generating" && (
                              <span
                                className="text-xs font-medium px-2 py-0.5 rounded-md bg-surface3 text-textSecondary border border-borderDefault flex items-center gap-1.5 shrink-0"
                                title={
                                  chunk.qualityReview?.summary ||
                                  "Đoạn âm thanh chưa được kiểm chứng qua ASR"
                                }
                              >
                                <span className="w-1.5 h-1.5 rounded-full bg-textMuted shrink-0" />
                                <span>Chưa kiểm chứng</span>
                              </span>
                            )}
                        </div>

                        {/* Right: Chunk Actions matching TtsWorkspace */}
                        <div
                          className="flex items-center gap-2 shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {chunk.status === "ready" && (
                            <button
                              type="button"
                              onClick={() => handlePlayChunk(chunk)}
                              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                                isPlaying
                                  ? "bg-accent text-white font-semibold shadow-2xs"
                                  : "bg-surface2 hover:bg-surface3 text-textPrimary border border-borderDefault/80"
                              }`}
                            >
                              {isPlaying ? (
                                <>
                                  <Pause className="w-3.5 h-3.5 fill-current" />
                                  <span>Tạm dừng</span>
                                </>
                              ) : (
                                <>
                                  <Play className="w-3.5 h-3.5 fill-accent" />
                                  <span>Nghe thử</span>
                                </>
                              )}
                            </button>
                          )}

                          {chunk.status === "modified" && (
                            <button
                              type="button"
                              onClick={() => handleRegenerateChunk(chunk.id)}
                              disabled={isGenerating}
                              className="flex items-center gap-1.5 px-2.5 py-1 bg-warning/15 hover:bg-warning/25 text-warning rounded-md text-xs border border-warning/30 transition-colors font-semibold cursor-pointer"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                              <span>Tạo lại</span>
                            </button>
                          )}

                          {chunkIsError && chunk.status !== "generating" && (
                            <button
                              type="button"
                              onClick={() => handleRegenerateChunk(chunk.id)}
                              disabled={isGenerating}
                              className="flex items-center gap-1.5 px-2.5 py-1 bg-danger/15 hover:bg-danger/25 text-danger rounded-md text-xs border border-danger/30 transition-colors font-semibold cursor-pointer"
                              title="Thử lại đoạn bị lỗi"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                              <span>Thử lại</span>
                            </button>
                          )}

                          {chunkIsWarning && chunk.status !== "generating" && (
                            <button
                              type="button"
                              onClick={() => handleRegenerateChunk(chunk.id)}
                              disabled={isGenerating}
                              className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-500/15 hover:bg-amber-500/25 text-amber-500 rounded-md text-xs border border-amber-500/30 transition-colors font-semibold cursor-pointer"
                              title="Tạo lại đoạn có cảnh báo"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                              <span>Tạo lại đoạn</span>
                            </button>
                          )}

                          {chunk.status === "ready" &&
                            !chunkIsError &&
                            !chunkIsWarning && (
                              <button
                                type="button"
                                onClick={() => handleRegenerateChunk(chunk.id)}
                                disabled={isGenerating}
                                className="flex items-center gap-1 px-2 py-1 bg-surface2 hover:bg-surface3 text-textSecondary hover:text-textPrimary rounded-md text-xs border border-borderDefault transition-colors cursor-pointer"
                                title="Tạo lại âm thanh đoạn này"
                              >
                                <RefreshCw className="w-3 h-3" />
                                <span>Tạo lại</span>
                              </button>
                            )}
                        </div>
                      </div>

                      {/* Clean Reading Text with Dynamic Auto-Resizing Textarea (borderless) */}
                      <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
                        <AutoResizeTextarea
                          value={chunk.text}
                          onChange={(val) => handleChunkTextChange(chunk.id, val)}
                          className="w-full bg-transparent border-0 px-1 py-1 text-[13px] text-textPrimary leading-[1.6] resize-none focus:outline-none focus:bg-surface2/50 focus:ring-1 focus:ring-accent/40 rounded-md transition-all font-normal overflow-hidden block"
                          placeholder="Nhập nội dung đoạn..."
                        />
                      </div>

                      {/* Expandable breakdown for detected issues — Exact match with TtsWorkspace */}
                      {chunk.qualityReview?.issues &&
                        chunk.qualityReview.issues.length > 0 && (
                          <div
                            className="pt-1.5 border-t border-borderDefault/40 text-xs"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <button
                                type="button"
                                onClick={() => {
                                  setExpandedIssuesChunks((prev) => ({
                                    ...prev,
                                    [chunk.id]: !prev[chunk.id],
                                  }));
                                }}
                                className="text-textSecondary hover:text-accent font-medium flex items-center gap-1 cursor-pointer transition-colors"
                              >
                                <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
                                <span>
                                  {expandedIssuesChunks[chunk.id]
                                    ? "Thu gọn chi tiết"
                                    : chunk.qualityReview.issues.length === 1
                                    ? "Xem chi tiết vấn đề"
                                    : `Xem tất cả ${chunk.qualityReview.issues.length} vấn đề phát hiện`}
                                </span>
                                <ChevronDown
                                  className={`w-3 h-3 transition-transform ${
                                    expandedIssuesChunks[chunk.id]
                                      ? "rotate-180"
                                      : ""
                                  }`}
                                />
                              </button>
                            </div>
                            {expandedIssuesChunks[chunk.id] && (
                              <div className="mt-2 space-y-2 pl-2 border-l-2 border-amber-500/40">
                                {chunk.qualityReview.issues.map((iss, idx) => {
                                  const shortLabel = getIssueShortLabel(iss.code);
                                  const hasTime =
                                    Array.isArray(iss.timeRange) &&
                                    iss.timeRange.length === 2;
                                  const timeStr = hasTime
                                    ? `${Math.floor(iss.timeRange![0] / 60)
                                        .toString()
                                        .padStart(2, "0")}:${Math.floor(
                                        iss.timeRange![0] % 60
                                      )
                                        .toString()
                                        .padStart(2, "0")}`
                                    : "";
                                  return (
                                    <div
                                      key={idx}
                                      className="text-textSecondary leading-snug flex items-start justify-between gap-2 py-0.5"
                                    >
                                      <div className="flex items-start gap-1.5 min-w-0 flex-1">
                                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0 mt-1.5" />
                                        <div className="min-w-0 flex-1">
                                          <div className="flex items-center gap-1.5 flex-wrap">
                                            <span className="font-semibold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded text-[11px]">
                                              {shortLabel}
                                            </span>
                                            {timeStr && (
                                              <span className="text-[11px] font-mono text-textMuted bg-surface2 px-1 py-0.5 rounded">
                                                {timeStr}
                                              </span>
                                            )}
                                            {iss.words && iss.words.length > 0 && (
                                              <span className="text-[11px] text-textSecondary italic">
                                                (Từ: {iss.words.join(", ")})
                                              </span>
                                            )}
                                          </div>
                                          <p className="mt-0.5 text-textPrimary text-xs">
                                            {iss.message}
                                          </p>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : isLoadingSubtitle ? (
            <div className="flex-1 flex items-center justify-center text-xs text-textMuted gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-accent" />
              <span>Đang tải danh sách câu phụ đề...</span>
            </div>
          ) : subtitleCues.length > 0 ? (
            /* Subtitle Cues Editor matching TranscriptionWorkspace */
            <div className="flex-1 overflow-y-auto p-4 space-y-2 min-h-0">
              {subtitleCues.map((cue) => (
                <div
                  key={cue.index}
                  className="py-2 px-3 rounded-lg border border-borderDefault bg-surface1 hover:bg-surface2/40 transition-all flex flex-col gap-1"
                >
                  <div className="flex items-center justify-between text-[11px] font-mono select-none">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-accent">
                        #{String(cue.index).padStart(3, "0")}
                      </span>
                      {cue.isEdited && (
                        <span
                          className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400"
                          title="Đã chỉnh sửa"
                        />
                      )}
                    </div>
                    <span className="text-textMuted">
                      {formatSrtTimestamp(cue.startSec)} →{" "}
                      {formatSrtTimestamp(cue.endSec)}
                    </span>
                  </div>
                  <AutoResizeTextarea
                    value={cue.text}
                    onChange={(val) => handleSubtitleCueChange(cue.index, val)}
                    className="w-full bg-transparent hover:bg-surface2/30 focus:bg-surface2/50 border border-transparent focus:border-accent/40 rounded px-1.5 py-0.5 text-xs sm:text-sm text-textPrimary leading-relaxed font-sans focus:outline-none resize-none overflow-hidden transition-colors"
                    placeholder="Nội dung phụ đề..."
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center space-y-2 text-xs text-textMuted">
              <Sparkles className="w-8 h-8 opacity-40 text-accent" />
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

          {/* 3. BOTTOM AUDIO PLAYER — Constrained to bottom of Studio just like TtsWorkspace */}
          {activeTrack && (
            <div className="mx-3 mb-3 shrink-0">
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
        </div>
      </div>
    </div>
  );
};
