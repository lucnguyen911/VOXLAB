import React, { useState, useRef, useEffect } from "react";
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
} from "lucide-react";
import { BatchJob, BatchQcChunkItem, BatchStepResult } from "../../types/batch";
import { ChunkItem } from "../../types/ui";
import {
  validateChunkAudioQuality,
  countChunkQualityIssues,
  getIssueShortLabel,
  getChunkAudioSignature,
} from "../../services/audio/qualityValidator";
import {
  getSharedAiServices,
  readAudioFileBlobUrl,
  tauriAiFs,
} from "../../services/batch/batchRuntime";
import { getEngineAdvancedSettings } from "../../services/ai/ttsAdvancedSettings";
import { edgeTtsProvider } from "../../services/providers/edgeProvider";
import { getEffectiveRules } from "../../services/pronunciation";
import { computeChunkPausesMs } from "../../services/audio/masterExport";
import { generateSubtitlesFromChunks } from "../../services/subtitle/pipeline";
import { exportToSrt, exportToVtt } from "../../services/subtitle/exporter";
import { convertSubtitleFormat } from "../../services/batch/outputResolver";
import {
  DEFAULT_DIALOGUE_SETTINGS,
  DialogueGlobalSettings,
  DialogueSegment,
} from "../../types/dialogue";
import { calculateDialogueTimeline } from "../../services/dialogue/masterAssembly";
import { generateDialogueSrt } from "../../services/dialogue/srtExporter";
import { loadSubtitleSettings } from "../../services/subtitle/profiles";

export interface BatchTtsQcModalProps {
  job: BatchJob;
  isOpen: boolean;
  onClose: () => void;
  onSaveUpdatedJob: (updatedJob: BatchJob) => void;
}

type QcFilterTab = "all" | "issues" | "pass";

export const BatchTtsQcModal: React.FC<BatchTtsQcModalProps> = ({
  job,
  isOpen,
  onClose,
  onSaveUpdatedJob,
}) => {
  if (!isOpen) return null;

  // Locate the TTS or Dialogue step result containing QC chunks
  const stepTaskKey: "tts" | "dialogue" | undefined = job.stepResults.tts?.qcChunks?.length
    ? "tts"
    : job.stepResults.dialogue?.qcChunks?.length
    ? "dialogue"
    : undefined;
  const targetStep: BatchStepResult | undefined = stepTaskKey
    ? job.stepResults[stepTaskKey]
    : undefined;
  const isDialogue = stepTaskKey === "dialogue";

  const [chunks, setChunks] = useState<BatchQcChunkItem[]>(() =>
    targetStep?.qcChunks ? targetStep.qcChunks.map((c) => ({ ...c })) : []
  );
  const [filterTab, setFilterTab] = useState<QcFilterTab>("all");
  const [playingChunkId, setPlayingChunkId] = useState<string | null>(null);
  const [regeneratingIds, setRegeneratingIds] = useState<Set<string>>(new Set());
  const [isRegeneratingAll, setIsRegeneratingAll] = useState(false);
  const [isRebuildingMaster, setIsRebuildingMaster] = useState(false);
  const [hasUnsavedMasterChanges, setHasUnsavedMasterChanges] = useState(false);
  const [statusBanner, setStatusBanner] = useState<{
    type: "info" | "success" | "error";
    message: string;
  } | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeBlobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (activeBlobUrlRef.current) {
        URL.revokeObjectURL(activeBlobUrlRef.current);
        activeBlobUrlRef.current = null;
      }
    };
  }, []);

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (activeBlobUrlRef.current) {
      URL.revokeObjectURL(activeBlobUrlRef.current);
      activeBlobUrlRef.current = null;
    }
    setPlayingChunkId(null);
  };

  const handleTogglePlay = async (chunk: BatchQcChunkItem) => {
    if (playingChunkId === chunk.id) {
      stopAudio();
      return;
    }
    stopAudio();
    if (!chunk.audioFilePath) {
      setStatusBanner({
        type: "error",
        message: `Không tìm thấy đường dẫn file âm thanh của câu #${chunk.index}.`,
      });
      return;
    }
    try {
      const blobUrl = await readAudioFileBlobUrl(chunk.audioFilePath);
      activeBlobUrlRef.current = blobUrl;
      const audio = new Audio(blobUrl);
      audioRef.current = audio;
      setPlayingChunkId(chunk.id);
      audio.onended = () => {
        stopAudio();
      };
      audio.onerror = () => {
        stopAudio();
        setStatusBanner({
          type: "error",
          message: `Không thể phát file âm thanh của câu #${chunk.index}.`,
        });
      };
      await audio.play();
    } catch (err) {
      stopAudio();
      setStatusBanner({
        type: "error",
        message: `Lỗi đọc file âm thanh câu #${chunk.index}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }
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
    setHasUnsavedMasterChanges(true);
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
    if (!stepTaskKey || !targetStep) return;
    const nextStats = countChunkQualityIssues(toCheckableItems(nextChunks));
    const hasWarnOrErr = nextStats.errorCount > 0 || nextStats.warningCount > 0;
    const warningMsg = hasWarnOrErr
      ? isDialogue
        ? `Hậu kiểm chất lượng Hội thoại: ${nextStats.errorCount} lượt lỗi, ${nextStats.warningCount} lượt cảnh báo.`
        : `Hậu kiểm chất lượng TTS: ${nextStats.errorCount} đoạn lỗi, ${nextStats.warningCount} đoạn cảnh báo.`
      : undefined;

    const updatedStepResults = {
      ...job.stepResults,
      [stepTaskKey]: {
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

    const model = isDialogue
      ? dialogueSnapshot?.model || "omnivoice"
      : ttsSnapshot?.model || "omnivoice";
    const voiceId =
      targetChunk.voiceId ||
      (isDialogue
        ? (targetChunk.characterName &&
            dialogueSnapshot?.characterVoices?.[targetChunk.characterName]) ||
          dialogueSnapshot?.defaultVoiceId ||
          "omnivoice-auto"
        : ttsSnapshot?.voiceId || "omnivoice-auto");
    const rawSpeed = isDialogue ? dialogueSnapshot?.speed : ttsSnapshot?.speed;
    const speed = rawSpeed && rawSpeed !== 1 ? rawSpeed : undefined;

    const isOnlineVoice =
      typeof voiceId === "string" &&
      (voiceId.includes("Neural") ||
        voiceId.startsWith("edge_") ||
        voiceId.startsWith("google_"));

    const effectiveRules = getEffectiveRules();
    const advancedSettings = !isOnlineVoice
      ? getEngineAdvancedSettings(model)
      : undefined;

    const scratchScope = `${isDialogue ? "dlg" : "tts"}-${job.id}`.replace(
      /[^\w-]/g,
      "_"
    );
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
        ...(isDialogue ? { projectId: "dialogue" } : {}),
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
      isDialogue ? "dialogue" : "current"
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
    stopAudio();
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
        setHasUnsavedMasterChanges(true);
        const st = updated.qualityReview?.status;
        setStatusBanner({
          type: st === "error" ? "error" : "success",
          message:
            st === "pass"
              ? `Câu #${chunk.index} đã tạo lại và đạt chuẩn chất lượng!`
              : `Câu #${chunk.index} đã tạo lại (${
                  updated.qualityReview?.summary || "Cần kiểm tra"
                }). Nhấn "Ghép & Cập nhật file Master" để lưu file xuất.`,
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

  const handleRegenerateAllFlagged = async () => {
    const flagged = chunks.filter((c) => {
      const st = c.qualityReview?.status;
      const isConfirmed =
        Boolean(c.acknowledgedAudioSignature) &&
        c.acknowledgedAudioSignature ===
          getChunkAudioSignature({ ...c, status: "ready" });
      return st === "error" || (st === "warning" && !isConfirmed);
    });
    if (flagged.length === 0) return;

    stopAudio();
    setIsRegeneratingAll(true);
    let updatedList = [...chunks];

    try {
      for (let i = 0; i < flagged.length; i++) {
        const target = flagged[i];
        setRegeneratingIds((prev) => new Set(prev).add(target.id));
        setStatusBanner({
          type: "info",
          message: `Đang tạo lại câu lỗi/cảnh báo ${i + 1}/${flagged.length} (#${target.index})...`,
        });
        const updated = await regenerateSingleChunk(target);
        if (updated) {
          updatedList = updatedList.map((c) =>
            c.id === target.id ? updated : c
          );
          setChunks(updatedList);
          setHasUnsavedMasterChanges(true);
        }
        setRegeneratingIds((prev) => {
          const next = new Set(prev);
          next.delete(target.id);
          return next;
        });
      }
      setStatusBanner({
        type: "success",
        message: `Đã tạo lại xong ${flagged.length} câu. Nhấn "Ghép & Cập nhật file Master" để xuất lại file âm thanh hoàn chỉnh.`,
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

  const handleRebuildMaster = async () => {
    if (!targetStep) return;
    stopAudio();
    setIsRebuildingMaster(true);
    setStatusBanner({
      type: "info",
      message: "Đang ghép nối lại file Master Audio và đồng bộ phụ đề...",
    });

    try {
      const ai = await getSharedAiServices();
      if (!ai) {
        throw new Error("Local AI runtime chưa sẵn sàng.");
      }

      const audioArtifactPath = targetStep.outputArtifactPaths.find((p) =>
        /\.(wav|mp3)$/i.test(p)
      );
      const subArtifactPath = targetStep.outputArtifactPaths.find((p) =>
        /\.(srt|vtt)$/i.test(p)
      );

      if (!audioArtifactPath) {
        throw new Error("Không tìm thấy đường dẫn file Master Audio đã xuất.");
      }

      const format = audioArtifactPath.toLowerCase().endsWith(".mp3")
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
          outputPath: audioArtifactPath,
          format,
        });

        if (subArtifactPath) {
          const subSettings = loadSubtitleSettings();
          const srtContent = generateDialogueSrt(assembly.timeline, {
            aspectRatio: subSettings.aspectRatio,
            maxLines: subSettings.maxLines,
          });
          const finalSub = subArtifactPath.toLowerCase().endsWith(".vtt")
            ? convertSubtitleFormat(srtContent, "srt", "vtt")
            : srtContent;
          await tauriAiFs.writeText(subArtifactPath, finalSub);
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
          outputPath: audioArtifactPath,
          format,
        });

        if (subArtifactPath) {
          const cues = generateSubtitlesFromChunks(chunkItems);
          const subContent = subArtifactPath.toLowerCase().endsWith(".vtt")
            ? exportToVtt(cues)
            : exportToSrt(cues);
          await tauriAiFs.writeText(subArtifactPath, subContent);
        }
      }

      persistJobChunksState(chunks);
      setHasUnsavedMasterChanges(false);
      setStatusBanner({
        type: "success",
        message: "Đã ghép & cập nhật thành công file Master Audio và phụ đề!",
      });
    } catch (err) {
      setStatusBanner({
        type: "error",
        message: `Lỗi cập nhật file Master: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    } finally {
      setIsRebuildingMaster(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150 select-none">
      <div className="w-full max-w-4xl max-h-[88vh] bg-panel rounded-2xl border border-borderDefault shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-borderDefault bg-surface1 flex items-center justify-between flex-shrink-0">
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
                  Hậu kiểm & Chỉnh sửa {isDialogue ? "Hội thoại" : "TTS"}
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-surface3 text-textSecondary border border-borderDefault">
                  {chunks.length} câu
                </span>
              </div>
              <p
                className="text-[11px] text-textMuted font-mono truncate"
                title={job.sourceFileName}
              >
                {job.sourceFileName}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              stopAudio();
              onClose();
            }}
            className="p-1.5 text-textMuted hover:text-textPrimary rounded-lg hover:bg-surface2 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Summary & Filter Toolbar */}
        <div className="px-5 py-2.5 border-b border-borderDefault bg-surface2/40 flex flex-wrap items-center justify-between gap-2 text-xs flex-shrink-0">
          <div className="flex items-center gap-1.5">
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

          <div className="flex items-center gap-2">
            {totalIssues > 0 && (
              <button
                type="button"
                disabled={isRegeneratingAll || isRebuildingMaster}
                onClick={handleRegenerateAllFlagged}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-bold bg-warning/15 hover:bg-warning/25 text-warning border border-warning/30 transition-colors cursor-pointer disabled:opacity-50"
              >
                {isRegeneratingAll ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                <span>Tạo lại tất cả câu lỗi ({totalIssues})</span>
              </button>
            )}
          </div>
        </div>

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

        {/* Chunks List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {filteredChunks.length === 0 ? (
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
              const isPlaying = playingChunkId === chunk.id;
              const isRegen = regeneratingIds.has(chunk.id);

              return (
                <div
                  key={chunk.id}
                  className={`p-3 rounded-xl border transition-all space-y-2 ${
                    isError
                      ? "bg-danger/5 border-danger/40"
                      : isWarn
                      ? "bg-warning/5 border-warning/40"
                      : "bg-surface2/40 border-borderDefault"
                  }`}
                >
                  {/* Row 1: Meta + Badges + Actions */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-0.5 rounded bg-surface3 text-[11px] font-mono font-bold text-textPrimary">
                        #{chunk.index}
                      </span>

                      {chunk.characterName && (
                        <span className="px-2 py-0.5 rounded bg-accent/15 text-accent border border-accent/30 text-[11px] font-bold">
                          [{chunk.characterName}]
                        </span>
                      )}

                      <span className="text-[11px] text-textMuted font-mono">
                        {chunk.durationSec ? `${chunk.durationSec.toFixed(1)}s` : "0.0s"}
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

                      {/* Specific Issue Short Labels */}
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
                        onClick={() => handleTogglePlay(chunk)}
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
                            <span>Dừng</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3 h-3 fill-current" />
                            <span>Nghe</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleRegenerateOne(chunk)}
                        disabled={isRegen || isRegeneratingAll || isRebuildingMaster}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-surface3 hover:bg-surface2 text-textPrimary border border-borderDefault transition-colors cursor-pointer disabled:opacity-50"
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

                  {/* Detailed QC Issue Messages + Whisper Transcript */}
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
                          Whisper nghe được: &ldquo;{review.issues[0].asrRawExcerpt}&rdquo;
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-borderDefault bg-surface1 flex items-center justify-between gap-3 flex-shrink-0">
          <div className="text-[11px] text-textMuted flex items-center gap-2">
            <Volume2 className="w-3.5 h-3.5 text-accent shrink-0" />
            <span>
              {hasUnsavedMasterChanges
                ? "Có thay đổi âm thanh/văn bản chưa ghép vào file Master xuất ra."
                : "Mọi thay đổi sau khi tạo lại câu có thể ghép trực tiếp vào file Master."}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                stopAudio();
                onClose();
              }}
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-textSecondary hover:text-textPrimary hover:bg-surface2 transition-colors cursor-pointer"
            >
              Đóng
            </button>

            <button
              type="button"
              disabled={isRebuildingMaster || isRegeneratingAll || regeneratingIds.size > 0}
              onClick={handleRebuildMaster}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold bg-accent hover:bg-accentHover text-white shadow-xs transition-all cursor-pointer disabled:opacity-50"
            >
              {isRebuildingMaster ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              <span>Ghép & Cập nhật file Master</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
