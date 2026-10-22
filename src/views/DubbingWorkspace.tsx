import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Languages,
  UploadCloud,
  Sparkles,
  Download,
  AlertTriangle,
  AlertCircle,
  RefreshCw,
  Volume2,
  Zap,
  Play,
  Pause,
  X,
  RotateCcw,
  Gauge,
  Activity,
  Clock,
  ChevronRight,
  Settings2,
} from "lucide-react";
import { VoiceProfile, SettingsGroup, PunctuationPauses } from "../types/ui";
import {
  DEFAULT_PUNCTUATION_PAUSES,
  sanitizePunctuationPauses,
} from "../services/pause/punctuationPause";
import {
  OriginalCue,
  TranslatedCue,
  DubAudioSegment,
  TimingOverflowMetadata,
  DubbingHandoffSnapshot,
  DubbingMode,
  DubbingSpeechGroup,
  normalizeDubbingMode,
} from "../types/dubbing";
import { generateNarrationAlignedSrt } from "../services/dubbing/alignedSrtGenerator";
import { ReviewGrid } from "../components/dubbing/ReviewGrid";
import { BottomAudioPlayer, ActiveAudioTrack } from "../components/layout/BottomAudioPlayer";
import { VoiceSelector } from "../components/dubbing/VoiceSelector";
import { parseSubtitleContent } from "../services/subtitle/parser";
import { exportToSrt } from "../services/subtitle/exporter";
import {
  TRANSLATION_TARGET_LANGUAGES,
  TRANSLATION_SOURCE_LANGUAGES,
} from "../services/subtitle/languages";
import { SearchableLanguageSelect } from "../components/common/SearchableLanguageSelect";
import {
  translationManager,
  loadTranslationSettings,
  saveTranslationSettings,
} from "../services/translation";
import { TranslationStyle } from "../services/translation/types";
import {
  saveDubbingSessionBackup,
  loadDubbingSessionBackup,
} from "../services/dubbing/sessionStorage";
import { analyzeTimingCollision, canExportMasterWav } from "../services/dubbing/collisionDetector";
import { resolveTimingCollisions, countCollisions } from "../services/dubbing/autoFit";
import { mergeMasterAudio } from "../services/dubbing/masterAssembly";
import {
  DubbingSynthesisQueue,
  DubbingSynthesisJob,
  synthesizeAndFitDubbingUnit,
  verifyDubbingSegmentQuality,
} from "../services/dubbing/synthesisQueue";
import {
  planDubbingSpeechGroups,
  findSpeechGroupByCueIndex,
  rebuildGroupAfterCueEdit,
  expandGroupSegmentToCueSegments,
  normalizeCueTextForSpeech,
} from "../services/dubbing/speechPlanner";
import {
  updateNarrationGroupText,
  applyFullNarrationScriptEdit,
  buildTranslatedNarrationScriptText,
} from "../services/dubbing/freeNarrationScript";
import { extractFilesFromDropEvent, useTauriDropZone } from "../services/fileDropHelper";
import { useI18n } from "../i18n/context";
import { createEffectiveVoiceSnapshot } from "../services/providers";
import { getEngineAdvancedSettings } from "../services/ai/ttsAdvancedSettings";
import { getSharedAiServices, readAudioFileBlobUrl } from "../services/batch/batchRuntime";
import { recordCompletedJobToHistory } from "../services/history/historyManager";
import {
  QUALITY_VALIDATOR_VERSION,
  validateChunkAudioQuality,
  getChunkAudioSignature,
  isReviewOutdated,
  isChunkError,
  isChunkWarning,
} from "../services/audio/qualityValidator";
import {
  loadSubtitleSettings,
  getSubtitleProfile,
  wrapCueTextBalanced,
} from "../services/subtitle";
import {
  checkAsrReadiness,
  applyAsrModelSwitch,
  type AsrReadinessResult,
} from "../services/ai/asrReadiness";
import { AsrReadinessModal } from "../components/modals/AsrReadinessModal";

export interface DubbingWorkspaceProps {
  handoffSnapshot?: DubbingHandoffSnapshot | null;
  voices: VoiceProfile[];
  activeVoiceId?: string;
  onChangeActiveVoice?: (id: string) => void;
  activeModel?: string;
  onChangeModel?: (model: string) => void;
  onOpenVoiceModal?: () => void;
  onNavigateToSettings?: (group?: SettingsGroup) => void;
}

export const DubbingWorkspace: React.FC<DubbingWorkspaceProps> = ({
  handoffSnapshot,
  voices,
  activeVoiceId,
  onChangeActiveVoice,
  activeModel,
  onChangeModel,
  onOpenVoiceModal,
  onNavigateToSettings,
}) => {
  const { t, lang } = useI18n();

  // Core Project State
  const [sourceMediaName, setSourceMediaName] = useState<string>(
    handoffSnapshot?.sourceMediaName || ""
  );
  const [originalCues, setOriginalCues] = useState<OriginalCue[]>(
    handoffSnapshot?.cues || []
  );
  const [translatedCues, setTranslatedCues] = useState<TranslatedCue[]>([]);
  const [audioSegments, setAudioSegments] = useState<Record<number, DubAudioSegment>>({});
  const [overflowAnalysis, setOverflowAnalysis] = useState<Record<number, TimingOverflowMetadata>>({});
  const [dubbingMode, setDubbingMode] = useState<DubbingMode>(() => {
    try {
      if (typeof localStorage !== "undefined") {
        const saved = localStorage.getItem("voxlab_dubbing_mode");
        if (saved) {
          return normalizeDubbingMode(saved);
        }
      }
    } catch {}
    return "source_sync";
  });
  const [speechGroups, setSpeechGroups] = useState<DubbingSpeechGroup[]>([]);

  // Configuration State
  const [sourceLang, setSourceLang] = useState<string>(() => {
    return loadTranslationSettings().sourceLanguage || "auto";
  });
  const [targetLang, setTargetLang] = useState<string>(() => {
    return loadTranslationSettings().targetLanguage || "vi";
  });
  const [translationStyle, setTranslationStyle] = useState<TranslationStyle>(() => {
    return loadTranslationSettings().translationStyle || "default";
  });


  const [selectedProviderId, setSelectedProviderId] = useState<string>(() => {
    return loadTranslationSettings().translationProviderId || "google";
  });
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>(() => {
    try {
      if (typeof localStorage !== "undefined") {
        const saved = localStorage.getItem("voxlab_dubbing_selected_voice");
        if (saved && voices.some((v) => v.id === saved)) {
          return saved;
        }
      }
    } catch {}
    return activeVoiceId || voices[0]?.id || "";
  });
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    return activeModel || "Omni Voice";
  });

  const prevActiveVoiceIdRef = useRef<string | undefined>(activeVoiceId);

  // On mount, align parent activeVoiceId with DubbingWorkspace's restored selectedVoiceId so VoiceSelectionModal highlights the right voice
  useEffect(() => {
    if (selectedVoiceId && selectedVoiceId !== activeVoiceId) {
      prevActiveVoiceIdRef.current = selectedVoiceId;
      onChangeActiveVoice?.(selectedVoiceId);
    }
  }, []);

  // Sync activeVoiceId when the user selects a new voice in VoiceSelectionModal
  useEffect(() => {
    if (activeVoiceId && activeVoiceId !== prevActiveVoiceIdRef.current) {
      prevActiveVoiceIdRef.current = activeVoiceId;
      setSelectedVoiceId(activeVoiceId);
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem("voxlab_dubbing_selected_voice", activeVoiceId);
        }
      } catch {}
    }
  }, [activeVoiceId]);

  // Sync activeModel if updated externally
  useEffect(() => {
    if (activeModel && activeModel !== selectedModel) {
      setSelectedModel(activeModel);
    }
  }, [activeModel]);

  const handleSelectVoice = useCallback(
    (id: string) => {
      prevActiveVoiceIdRef.current = id;
      setSelectedVoiceId(id);
      onChangeActiveVoice?.(id);
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem("voxlab_dubbing_selected_voice", id);
        }
      } catch {}
    },
    [onChangeActiveVoice]
  );

  const handleModelChange = useCallback(
    (m: string) => {
      setSelectedModel(m);
      onChangeModel?.(m);
    },
    [onChangeModel]
  );

  const handleDubbingModeChange = useCallback(
    (modeRaw: unknown) => {
      const mode = normalizeDubbingMode(modeRaw);
      setDubbingMode(mode);
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem("voxlab_dubbing_mode", mode);
        }
      } catch {}

      // Invalidate existing ready audio segments so audio is not mistakenly reused across mismatched mode timelines
      setAudioSegments((prev) => {
        let changed = false;
        const updated: Record<number, DubAudioSegment> = {};
        for (const [key, seg] of Object.entries(prev)) {
          const id = Number(key);
          if (seg.status === "ready" || seg.status === "modified") {
            updated[id] = {
              ...seg,
              status: "needs_generation",
            };
            changed = true;
          } else {
            updated[id] = seg;
          }
        }
        if (changed) {
          setRestoredNotice(
            mode === "free_narration"
              ? "Đã chuyển sang Thuyết minh tự do. Vui lòng bấm 'Lồng tiếng cho kịch bản' để tạo giọng đọc tự nhiên nối tiếp."
              : "Đã chuyển sang Đồng bộ video gốc. Vui lòng bấm 'Lồng tiếng cho kịch bản' để tạo giọng đọc khớp timeline gốc."
          );
        }
        const activeSegs = changed ? updated : prev;
        setOverflowAnalysis(analyzeTimingCollision(originalCues, activeSegs, mode));
        return activeSegs;
      });
    },
    [originalCues]
  );

  // Dubbing voice settings (speed, pitch, volume, pauses). Concurrency fixed at 1.
  const [speed, setSpeed] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("voxlab_dubbing_voice_settings");
      if (saved) return JSON.parse(saved).speed ?? 1.0;
    } catch {}
    return 1.0;
  });
  const [pitch, setPitch] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("voxlab_dubbing_voice_settings");
      if (saved) return JSON.parse(saved).pitch ?? 1.0;
    } catch {}
    return 1.0;
  });
  const [volume, setVolume] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("voxlab_dubbing_voice_settings");
      if (saved) return JSON.parse(saved).volume ?? 1.0;
    } catch {}
    return 1.0;
  });
  const [pauses, setPauses] = useState<PunctuationPauses>(() => {
    try {
      const saved = localStorage.getItem("voxlab_dubbing_voice_settings");
      if (saved) {
        const p = JSON.parse(saved).pauses;
        return sanitizePunctuationPauses(p);
      }
    } catch {}
    return { ...DEFAULT_PUNCTUATION_PAUSES };
  });
  // Concurrency is fixed to 1 across VoxLab
  const concurrency = 1;
  const [isPausesOpen, setIsPausesOpen] = useState<boolean>(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState<boolean>(false);

  // Persist dubbing voice settings
  useEffect(() => {
    try {
      localStorage.setItem(
        "voxlab_dubbing_voice_settings",
        JSON.stringify({ speed, pitch, volume, pauses, concurrency: 1 })
      );
    } catch {}
  }, [speed, pitch, volume, pauses]);

  const handleResetSettings = () => {
    setSpeed(1.0);
    setPitch(1.0);
    setVolume(1.0);
    setPauses({ ...DEFAULT_PUNCTUATION_PAUSES });
  };

  const handlePauseChange = (key: keyof typeof pauses, value: number) => {
    setPauses((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  // Execution & Progress State
  const [isTranslating, setIsTranslating] = useState<boolean>(false);
  const [isTranslationPaused, setIsTranslationPaused] = useState<boolean>(false);
  const [translationProgress, setTranslationProgress] = useState<{ done: number; total: number } | null>(null);
  const translationControlRef = useRef<{ isPaused: boolean; isCancelled: boolean }>({
    isPaused: false,
    isCancelled: false,
  });

  const [isGeneratingAudio, setIsGeneratingAudio] = useState<boolean>(false);
  const [isAudioPaused, setIsAudioPaused] = useState<boolean>(false);
  const [audioProgress, setAudioProgress] = useState<{ done: number; total: number } | null>(null);
  const [activePreviewCueIndex, setActivePreviewCueIndex] = useState<number | null>(null);
  const [isPlayingCueAudio, setIsPlayingCueAudio] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [restoredNotice, setRestoredNotice] = useState<string>("");
  const [autoFitEnabled, setAutoFitEnabled] = useState<boolean>(false);

  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Unified ASR Model from Subtitle Settings for Post-Synthesis Quality Check
  const [currentAsrModel, setCurrentAsrModel] = useState<string>(() => {
    return loadSubtitleSettings().whisperModel;
  });
  const [isAsrReady, setIsAsrReady] = useState<boolean>(true);
  const [asrReadinessResult, setAsrReadinessResult] = useState<AsrReadinessResult | null>(null);
  const [isCheckingAsrReadiness, setIsCheckingAsrReadiness] = useState<boolean>(false);
  const pendingGenerationActionRef = useRef<(() => void) | null>(null);
  const inFlightValidationsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const syncAsrModel = () => {
      const m = loadSubtitleSettings().whisperModel;
      setCurrentAsrModel((prev) => (prev !== m ? m : prev));
    };
    window.addEventListener("focus", syncAsrModel);
    window.addEventListener("storage", syncAsrModel);
    return () => {
      window.removeEventListener("focus", syncAsrModel);
      window.removeEventListener("storage", syncAsrModel);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    checkAsrReadiness(currentAsrModel).then((res) => {
      if (!cancelled) {
        setIsAsrReady(res.ready);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [currentAsrModel]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const synthesisQueueRef = useRef<DubbingSynthesisQueue | null>(null);

  // Unmount cleanup to cancel active synthesis queue
  useEffect(() => {
    return () => {
      if (synthesisQueueRef.current) {
        synthesisQueueRef.current.cancel();
      }
    };
  }, []);

  // Recompute speechGroups whenever originalCues are loaded/changed and speechGroups are empty or mismatched
  useEffect(() => {
    if (originalCues.length === 0) {
      setSpeechGroups([]);
      return;
    }
    setSpeechGroups((prev) => {
      const totalCovered = prev.reduce((acc, g) => acc + g.sourceCueIds.length, 0);
      if (prev.length > 0 && totalCovered === originalCues.length) {
        return prev;
      }
      return planDubbingSpeechGroups(originalCues, translatedCues);
    });
  }, [originalCues, translatedCues]);

  // Restore session backup on mount if handoffSnapshot is absent
  useEffect(() => {
    if (!handoffSnapshot || !handoffSnapshot.cues || handoffSnapshot.cues.length === 0) {
      const restored = loadDubbingSessionBackup();
      if (restored && restored.backup.originalCues && restored.backup.originalCues.length > 0) {
        setOriginalCues(restored.backup.originalCues);
        setTranslatedCues(restored.backup.translatedCues);
        if (restored.backup.speechGroups && restored.backup.speechGroups.length > 0) {
          setSpeechGroups(restored.backup.speechGroups);
        } else {
          setSpeechGroups(
            planDubbingSpeechGroups(
              restored.backup.originalCues,
              restored.backup.translatedCues
            )
          );
        }
        if (restored.backup.dubbingMode) {
          setDubbingMode(restored.backup.dubbingMode);
        }
        setSourceMediaName(restored.backup.sourceMediaName || "");
        setTargetLang(restored.backup.targetLang || "vi");
        setSelectedProviderId(restored.backup.selectedProviderId || "google");
        const savedLocalVoice =
          typeof localStorage !== "undefined"
            ? localStorage.getItem("voxlab_dubbing_selected_voice")
            : null;
        const voiceToRestore =
          savedLocalVoice && voices.some((v) => v.id === savedLocalVoice)
            ? savedLocalVoice
            : restored.backup.selectedVoiceId;
        if (voiceToRestore && voices.some((v) => v.id === voiceToRestore)) {
          handleSelectVoice(voiceToRestore);
        }
        setAudioSegments(restored.restoredAudioSegments || {});
        setOverflowAnalysis(restored.backup.overflowAnalysis || {});
        setRestoredNotice(
          "Đã khôi phục kịch bản dịch từ phiên trước. Vui lòng bấm 'Lồng tiếng cho kịch bản' để tổng hợp lại file thoại."
        );
      }
    }
  }, []);

  // Auto-persist session backup to sessionStorage
  useEffect(() => {
    if (originalCues.length > 0) {
      saveDubbingSessionBackup({
        sourceMediaName,
        sourceDurationSec: originalCues[originalCues.length - 1]?.endSec || 0,
        sourceLang: "auto",
        targetLang,
        selectedProviderId,
        selectedVoiceId,
        dubbingMode,
        originalCues,
        translatedCues,
        speechGroups,
        audioSegments,
        overflowAnalysis,
      });
    }
  }, [
    originalCues,
    translatedCues,
    speechGroups,
    dubbingMode,
    audioSegments,
    overflowAnalysis,
    sourceMediaName,
    targetLang,
    selectedProviderId,
    selectedVoiceId,
  ]);

  // Sync snapshot if handoff occurs while component is mounted
  useEffect(() => {
    if (handoffSnapshot && handoffSnapshot.cues.length > 0) {
      setOriginalCues(handoffSnapshot.cues);
      setSourceMediaName(handoffSnapshot.sourceMediaName || "Handoff từ Phụ đề");
      const initTrans: TranslatedCue[] = handoffSnapshot.cues.map((c) => ({
        index: c.index,
        startSec: c.startSec,
        endSec: c.endSec,
        originalText: c.text,
        text: c.text,
        subtitleText: c.text,
        speechFragmentText: normalizeCueTextForSpeech(c.text),
        isEdited: false,
      }));
      const groups = planDubbingSpeechGroups(handoffSnapshot.cues, initTrans);
      setTranslatedCues(initTrans);
      setSpeechGroups(groups);
      setAudioSegments({});
      setOverflowAnalysis({});
      setErrorMessage("");
      setRestoredNotice("");
    }
  }, [handoffSnapshot]);

  // Handle local subtitle file import (.srt / .vtt / .txt)
  const handleImportFile = (file: File) => {
    const isSupported = /\.(srt|vtt|txt)$/i.test(file.name);
    if (!isSupported) {
      setErrorMessage("Vui lòng chọn tệp phụ đề định dạng .srt hoặc .vtt.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const cues = parseSubtitleContent(text);
        if (!cues || cues.length === 0) {
          throw new Error("Tệp phụ đề trống hoặc không đúng định dạng.");
        }
        setOriginalCues(cues);
        setSourceMediaName(file.name);
        const initTrans: TranslatedCue[] = cues.map((c) => ({
          index: c.index,
          startSec: c.startSec,
          endSec: c.endSec,
          originalText: c.text,
          text: c.text,
          subtitleText: c.text,
          speechFragmentText: normalizeCueTextForSpeech(c.text),
          isEdited: false,
        }));
        const groups = planDubbingSpeechGroups(cues, initTrans);
        setTranslatedCues(initTrans);
        setSpeechGroups(groups);
        setAudioSegments({});
        setOverflowAnalysis({});
        setErrorMessage("");
      } catch (err: any) {
        setErrorMessage(err.message || "Không thể phân tích cú pháp file phụ đề.");
      }
    };
    reader.onerror = () => {
      setErrorMessage("Không thể đọc tệp phụ đề.");
    };
    reader.readAsText(file);
  };

  const reviewGridDropZoneRef = useRef<HTMLDivElement>(null);

  useTauriDropZone(reviewGridDropZoneRef, {
    enabled: true,
    allowedExtensions: ["srt", "vtt", "txt"],
    onDragStateChange: setIsDragging,
    onDropFiles: (files) => {
      const subFile =
        files.find((f) => {
          const ext = f.name.toLowerCase();
          return ext.endsWith(".srt") || ext.endsWith(".vtt") || ext.endsWith(".txt");
        }) || files[0];
      if (subFile) {
        handleImportFile(subFile);
      }
    },
  });

  // Drag and Drop handlers for subtitle files in the central ReviewGrid drop zone
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) {
      return;
    }
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    try {
      const files = await extractFilesFromDropEvent(e);
      if (files.length > 0) {
        const subFile =
          files.find((f) => {
            const ext = f.name.toLowerCase();
            return ext.endsWith(".srt") || ext.endsWith(".vtt") || ext.endsWith(".txt");
          }) || files[0];
        handleImportFile(subFile);
      }
    } catch (err) {
      console.warn("Failed to extract dropped files in DubbingWorkspace:", err);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleImportFile(e.dataTransfer.files[0]);
      }
    }
  };

  // Inline edit handler for translated cue text — invalidates only the edited cue or its speech group
  const handleUpdateText = (index: number, newText: string) => {
    const nextTranslated = translatedCues.map((c) =>
      c.index === index
        ? {
            ...c,
            text: newText,
            subtitleText: newText,
            speechFragmentText: normalizeCueTextForSpeech(newText),
            isEdited: true,
            projectionNeedsReview: false,
          }
        : c
    );
    setTranslatedCues(nextTranslated);

    // Update the affected speech group's speechText and invalidate only its audio segments
    const { updatedGroups, updatedSegments } = rebuildGroupAfterCueEdit(
      speechGroups,
      nextTranslated,
      index,
      audioSegments
    );
    setSpeechGroups(updatedGroups);
    setAudioSegments(updatedSegments);
  };

  const handleUpdateGroupText = (groupId: string, newGroupText: string) => {
    const activeGroups =
      speechGroups.length > 0
        ? speechGroups
        : planDubbingSpeechGroups(originalCues, translatedCues);
    const { updatedGroups, updatedTranslatedCues, updatedSegments } =
      updateNarrationGroupText(
        activeGroups,
        originalCues,
        translatedCues,
        groupId,
        newGroupText,
        audioSegments
      );
    setSpeechGroups(updatedGroups);
    setTranslatedCues(updatedTranslatedCues);
    setAudioSegments(updatedSegments);
  };

  const handleUpdateFullNarrationScript = (fullScriptText: string) => {
    const activeGroups =
      speechGroups.length > 0
        ? speechGroups
        : planDubbingSpeechGroups(originalCues, translatedCues);
    const { updatedGroups, updatedTranslatedCues, updatedSegments } =
      applyFullNarrationScriptEdit(
        activeGroups,
        originalCues,
        translatedCues,
        fullScriptText,
        audioSegments
      );
    setSpeechGroups(updatedGroups);
    setTranslatedCues(updatedTranslatedCues);
    setAudioSegments(updatedSegments);
  };

  // Automatically trigger background quality validation for any ready primary segment whose review is outdated or missing
  // Deferred when isGeneratingAudio is true so Whisper QC never competes with active TTS synthesis
  useEffect(() => {
    if (!isAsrReady || isGeneratingAudio) return;

    const candidates = Object.values(audioSegments).filter((seg) => {
      if (seg.isGroupPrimary === false) return false;
      if (seg.status !== "ready" || (!seg.audioFilePath && !seg.audioUrl)) {
        return false;
      }
      if (!isReviewOutdated(seg, currentAsrModel)) {
        return false;
      }
      const sig = `${seg.cueIndex}::${getChunkAudioSignature(seg)}::${currentAsrModel}`;
      return !inFlightValidationsRef.current.has(sig);
    });

    if (candidates.length === 0) return;

    const target = candidates[0];
    const sig = `${target.cueIndex}::${getChunkAudioSignature(target)}::${currentAsrModel}`;
    inFlightValidationsRef.current.add(sig);

    const memberIndices =
      target.groupCueIndices && target.groupCueIndices.length > 0
        ? target.groupCueIndices
        : [target.cueIndex];

    setAudioSegments((prev) => {
      const curr = prev[target.cueIndex];
      if (!curr || curr.status !== "ready") return prev;
      const checkingReview = {
        status: "checking" as const,
        summary: "Đang kiểm tra...",
        issues: [],
        checkedAt: Date.now(),
        audioSignature: getChunkAudioSignature(curr),
        validatorVersion: QUALITY_VALIDATOR_VERSION,
        asrModelId: currentAsrModel,
      };
      const next = { ...prev };
      for (const idx of memberIndices) {
        if (next[idx]) {
          next[idx] = { ...next[idx], qualityReview: checkingReview };
        }
      }
      return next;
    });

    const transCue = translatedCues.find((c) => c.index === target.cueIndex);
    const segmentForValidation: DubAudioSegment = {
      ...target,
      text: target.text ?? transCue?.text ?? "",
    };
    const langHint = target.effectiveVoiceSnapshot?.language || targetLang || "vi";
    const speedRatio = Number(
      ((target.effectiveVoiceSnapshot?.speed || speed || 1.0) * (target.speedFactor || 1.0)).toFixed(2)
    );

    validateChunkAudioQuality(
      segmentForValidation,
      langHint,
      undefined,
      speedRatio,
      currentAsrModel,
      "dubbing"
    )
      .then((qualityReview) => {
        setAudioSegments((prev) => {
          const curr = prev[target.cueIndex];
          if (!curr || getChunkAudioSignature(curr) !== getChunkAudioSignature(target)) {
            return prev;
          }
          const next = { ...prev };
          for (const idx of memberIndices) {
            if (next[idx]) {
              next[idx] = {
                ...next[idx],
                qualityReview,
              };
            }
          }
          return next;
        });
      })
      .finally(() => {
        inFlightValidationsRef.current.delete(sig);
      });
  }, [audioSegments, currentAsrModel, isAsrReady, isGeneratingAudio, translatedCues, targetLang, speed]);

  // Batch AI Translation
  const handleTranslateAll = async () => {
    if (!originalCues || originalCues.length === 0) return;

    // Check if local provider is reachable before translating
    try {
      const activeProvider = translationManager.getProvider(selectedProviderId);
      if (
        activeProvider &&
        (activeProvider.type === "lmstudio" || activeProvider.type === "ollama") &&
        typeof activeProvider.testConnection === "function"
      ) {
        const testRes = await activeProvider.testConnection();
        if (!testRes.ok) {
          setErrorMessage(
            testRes.message ||
              `Máy chủ ${activeProvider.displayName} chưa khả dụng (${
                (activeProvider as any).endpoint || "localhost"
              }). Vui lòng kiểm tra máy chủ nội bộ hoặc chủ động chọn nhà cung cấp khác.`
          );
          return;
        }
      }
    } catch (connErr: any) {
      setErrorMessage(
        connErr?.message ||
          "Không thể kết nối tới nhà cung cấp dịch thuật nội bộ. Vui lòng kiểm tra máy chủ."
      );
      return;
    }

    setIsTranslating(true);
    setIsTranslationPaused(false);
    translationControlRef.current = { isPaused: false, isCancelled: false };
    setTranslationProgress({ done: 0, total: originalCues.length });
    setErrorMessage("");

    try {
      const translated = await translationManager.translateOriginalCues(
        originalCues,
        targetLang,
        selectedProviderId,
        (done, total) => {
          setTranslationProgress({ done, total });
        },
        translationStyle,
        {
          sourceLang,
          useSpeechGroups: true,
          dubbingMode,
          strict: true,
          isPaused: () => translationControlRef.current.isPaused,
          isCancelled: () => translationControlRef.current.isCancelled,
        }
      );

      if (translationControlRef.current.isCancelled) {
        return;
      }

      setTranslatedCues(translated);
      const managerGroups = translationManager.getLastSpeechGroups();
      const nextGroups =
        managerGroups && managerGroups.length > 0
          ? managerGroups
          : planDubbingSpeechGroups(originalCues, translated);
      setSpeechGroups(nextGroups);

      // Invalidate existing audio segments: mark all as needs_generation
      setAudioSegments((prev) => {
        const updated: Record<number, DubAudioSegment> = {};
        for (const key of Object.keys(prev)) {
          const idx = Number(key);
          updated[idx] = {
            ...prev[idx],
            status: "needs_generation",
          };
        }
        return updated;
      });
    } catch (err: any) {
      if (!translationControlRef.current.isCancelled) {
        setErrorMessage(err.message || "Lỗi dịch thuật kịch bản.");
      }
    } finally {
      setIsTranslating(false);
      setIsTranslationPaused(false);
      setTranslationProgress(null);
    }
  };

  const handleTogglePauseTranslation = () => {
    if (isTranslationPaused) {
      translationControlRef.current.isPaused = false;
      setIsTranslationPaused(false);
    } else {
      translationControlRef.current.isPaused = true;
      setIsTranslationPaused(true);
    }
  };

  const handleCancelTranslation = () => {
    translationControlRef.current.isCancelled = true;
    setIsTranslating(false);
    setIsTranslationPaused(false);
    setTranslationProgress(null);
  };

  // Export Translated SRT (Always allowed; retains 100% source timestamps)
  const handleExportTranslatedSrt = () => {
    if (!translatedCues || translatedCues.length === 0) return;

    const settings = loadSubtitleSettings();
    const profile = getSubtitleProfile(settings.aspectRatio, settings.maxLines);

    const srtCues = translatedCues.map((c) => ({
      index: c.index,
      startSec: c.startSec,
      endSec: c.endSec,
      text: (c.subtitleText || c.text).includes("\n")
        ? c.subtitleText || c.text
        : wrapCueTextBalanced(c.subtitleText || c.text, profile),
    }));

    const srtContent = exportToSrt(srtCues);
    const baseName = sourceMediaName.replace(/\.[^/.]+$/, "") || "phu_de";
    const isRefSrt = dubbingMode === "free_narration";
    const filename = isRefSrt
      ? `${baseName}_${targetLang}_ref_source_timing.srt`
      : `${baseName}_${targetLang}.srt`;

    const blob = new Blob([srtContent], { type: "text/plain;charset=utf-8" });
    if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
      void (async () => {
        try {
          const { save } = await import("@tauri-apps/plugin-dialog");
          const chosenPath = await save({
            defaultPath: filename,
            filters: [{ name: "SubRip Subtitle (*.srt)", extensions: ["srt"] }],
          });
          if (!chosenPath) return;
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("fs_write_text", { path: chosenPath, content: srtContent });
          recordCompletedJobToHistory({
            jobKey: `dub_${baseName}`,
            title: `${baseName} (${sourceLang} → ${targetLang})`,
            category: "dubbing",
            tasks: ["translation"],
            status: "completed",
            chunkCount: translatedCues.length,
            artifacts: [
              {
                label: isRefSrt
                  ? `Phụ đề tham khảo theo mốc gốc (.SRT - ${targetLang.toUpperCase()})`
                  : `Phụ đề đã dịch (.SRT - ${targetLang.toUpperCase()})`,
                filePath: chosenPath,
                type: "subtitle",
                task: "translation",
                subtitleContent: srtContent,
                isTimelineSynced: !isRefSrt,
              },
            ],
          });
          await invoke("fs_show_in_folder", { path: chosenPath }).catch(() => {});
        } catch (err) {
          console.warn("Could not save translated SRT via Tauri:", err);
        }
      })();
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Export Translated Text (.TXT) for Mode 2 (free_narration)
  const handleExportTxt = () => {
    if (!translatedCues || translatedCues.length === 0) return;

    const fullText = buildTranslatedNarrationScriptText(speechGroups, translatedCues);

    const baseName = sourceMediaName.replace(/\.[^/.]+$/, "") || "kich_ban_dich";
    const filename = `${baseName}_${targetLang}.txt`;

    const blob = new Blob([fullText], { type: "text/plain;charset=utf-8" });
    if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
      void (async () => {
        try {
          const { save } = await import("@tauri-apps/plugin-dialog");
          const chosenPath = await save({
            defaultPath: filename,
            filters: [{ name: "Plain Text (*.txt)", extensions: ["txt"] }],
          });
          if (!chosenPath) return;
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("fs_write_text", { path: chosenPath, content: fullText });
          recordCompletedJobToHistory({
            jobKey: `dub_${baseName}`,
            title: `${baseName} (${sourceLang} → ${targetLang})`,
            category: "dubbing",
            tasks: ["translation"],
            status: "completed",
            chunkCount: translatedCues.length,
            artifacts: [
              {
                label: `Kịch bản dịch (.TXT - ${targetLang.toUpperCase()})`,
                filePath: chosenPath,
                type: "text",
                task: "translation",
                subtitleContent: fullText,
                isTimelineSynced: false,
              },
            ],
          });
          await invoke("fs_show_in_folder", { path: chosenPath }).catch(() => {});
        } catch (err) {
          console.warn("Could not save translated TXT via Tauri:", err);
        }
      })();
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Export Re-Timed Aligned SRT (.SRT) for Mode 2 (free_narration)
  const handleExportAlignedSrt = () => {
    if (originalCues.length === 0 || translatedCues.length === 0) return;

    const res = generateNarrationAlignedSrt({
      speechGroups:
        speechGroups.length > 0
          ? speechGroups
          : planDubbingSpeechGroups(originalCues, translatedCues),
      originalCues,
      translatedCues,
      audioSegments,
      pauseBetweenGroupsSec: pauses.period ?? 0.45,
      mode: "narration",
    });

    if (!res.ok || !res.srtContent) {
      setErrorMessage(
        res.reason ||
          "Không thể tạo phụ đề đồng bộ. Hãy chắc chắn toàn bộ các đoạn thuyết minh đã được tạo âm thanh hoàn chỉnh."
      );
      return;
    }

    const baseName = sourceMediaName.replace(/\.[^/.]+$/, "") || "phu_de";
    const filename = `${baseName}_aligned.srt`;

    const blob = new Blob([res.srtContent], { type: "text/plain;charset=utf-8" });
    if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
      void (async () => {
        try {
          const { save } = await import("@tauri-apps/plugin-dialog");
          const chosenPath = await save({
            defaultPath: filename,
            filters: [{ name: "SubRip Subtitle (*.srt)", extensions: ["srt"] }],
          });
          if (!chosenPath) return;
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("fs_write_text", { path: chosenPath, content: res.srtContent });
          recordCompletedJobToHistory({
            jobKey: `dub_${baseName}`,
            title: `${baseName} (${sourceLang} → ${targetLang})`,
            category: "dubbing",
            tasks: ["translation", "dubbing"],
            status: "completed",
            chunkCount: translatedCues.length,
            artifacts: [
              {
                label: "Phụ đề đồng bộ giọng đọc (.SRT)",
                filePath: chosenPath,
                type: "subtitle",
                task: "dubbing",
                subtitleContent: res.srtContent,
                isTimelineSynced: true,
              },
            ],
          });
          await invoke("fs_show_in_folder", { path: chosenPath }).catch(() => {});
        } catch (err) {
          console.warn("Could not save aligned SRT via Tauri:", err);
        }
      })();
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const executeCuesBatchSynthesis = (targetCues: OriginalCue[]) => {
    if (targetCues.length === 0) return;
    setIsGeneratingAudio(true);
    setIsAudioPaused(false);
    setErrorMessage("");

    const snapshot = createEffectiveVoiceSnapshot(selectedVoiceId, voices, {
      activeModel: selectedModel,
      speed,
      pitch,
      volume,
    });
    const advancedSettings = getEngineAdvancedSettings(selectedModel);

    const activeGroups =
      speechGroups.length > 0
        ? speechGroups
        : planDubbingSpeechGroups(originalCues, translatedCues);
    const groupByPrimaryCue = new Map<number, DubbingSpeechGroup>();
    for (const grp of activeGroups) {
      if (grp.sourceCueIds.length > 0) {
        groupByPrimaryCue.set(grp.sourceCueIds[0], grp);
      }
    }

    let jobs: DubbingSynthesisJob[];

    if (activeGroups.length > 0) {
      const targetCueSet = new Set(targetCues.map((c) => c.index));
      const targetGroups = activeGroups.filter((g) =>
        g.sourceCueIds.some((id) => targetCueSet.has(id))
      );

      jobs = targetGroups.map((group) => {
        const firstCueIdx = group.sourceCueIds[0];
        const lastCueIdx = group.sourceCueIds[group.sourceCueIds.length - 1];
        const orig =
          originalCues.find((c) => c.index === firstCueIdx) || originalCues[0];
        const lastOrigArrayIdx = originalCues.findIndex(
          (c) => c.index === lastCueIdx
        );
        const trans = translatedCues.find((c) => c.index === firstCueIdx) || {
          index: orig.index,
          startSec: orig.startSec,
          endSec: orig.endSec,
          originalText: orig.text,
          text: orig.text,
          isEdited: false,
        };
        return {
          originalCue: orig,
          translatedCue: trans,
          speechGroup: group,
          dubbingMode,
          voiceId: selectedVoiceId || "voice_01",
          nextCue:
            lastOrigArrayIdx >= 0
              ? originalCues[lastOrigArrayIdx + 1]
              : undefined,
          autoFit: dubbingMode === "free_narration" ? false : autoFitEnabled,
          voiceSettings: {
            speed,
            pitch,
            volume,
          },
          voiceSnapshot: snapshot,
          advancedSettings,
          asrModelId: currentAsrModel,
        };
      });
    } else {
      jobs = targetCues.map((orig) => {
        const origArrayIdx = originalCues.findIndex(
          (c) => c.index === orig.index
        );
        const trans = translatedCues.find((c) => c.index === orig.index) || {
          index: orig.index,
          startSec: orig.startSec,
          endSec: orig.endSec,
          originalText: orig.text,
          text: orig.text,
          isEdited: false,
        };
        return {
          originalCue: orig,
          translatedCue: trans,
          dubbingMode,
          voiceId: selectedVoiceId || "voice_01",
          nextCue:
            origArrayIdx >= 0 ? originalCues[origArrayIdx + 1] : undefined,
          autoFit: dubbingMode === "free_narration" ? false : autoFitEnabled,
          voiceSettings: {
            speed,
            pitch,
            volume,
          },
          voiceSnapshot: snapshot,
          advancedSettings,
          asrModelId: currentAsrModel,
        };
      });
    }

    setAudioProgress({ done: 0, total: jobs.length });

    const expandSegmentUpdate = (
      prev: Record<number, DubAudioSegment>,
      cueIndex: number,
      segment: DubAudioSegment
    ): Record<number, DubAudioSegment> => {
      const grp = groupByPrimaryCue.get(cueIndex);
      if (grp && grp.sourceCueIds.length > 0) {
        const expanded = expandGroupSegmentToCueSegments(
          grp,
          segment,
          originalCues
        );
        return { ...prev, ...expanded };
      }
      return { ...prev, [cueIndex]: segment };
    };

    const queue = new DubbingSynthesisQueue(
      {
        onJobStarted: (cueIndex) => {
          const grp = groupByPrimaryCue.get(cueIndex);
          const memberIds =
            grp && grp.sourceCueIds.length > 0 ? grp.sourceCueIds : [cueIndex];
          setAudioSegments((prev) => {
            const next = { ...prev };
            for (const id of memberIds) {
              next[id] = {
                ...(prev[id] || {
                  cueIndex: id,
                  rawDurationSec: 0,
                  targetDurationSec: 0,
                  fittedDurationSec: 0,
                  speedFactor: 1.0,
                  audioStartSec: 0,
                  audioEndSec: 0,
                }),
                groupId: grp?.groupId,
                groupCueIndices: grp?.sourceCueIds,
                isGroupPrimary: id === cueIndex,
                primaryCueIndex: cueIndex,
                status: "generating",
              };
            }
            return next;
          });
        },
        onJobChecking: (cueIndex, segment) => {
          setAudioSegments((prev) => {
            const next = expandSegmentUpdate(prev, cueIndex, segment);
            const newCollisions = analyzeTimingCollision(originalCues, next, dubbingMode);
            setOverflowAnalysis(newCollisions);
            return next;
          });
        },
        onJobCompleted: (cueIndex, segment) => {
          setAudioSegments((prev) => {
            const next = expandSegmentUpdate(prev, cueIndex, segment);
            const newCollisions = analyzeTimingCollision(originalCues, next, dubbingMode);
            setOverflowAnalysis(newCollisions);
            return next;
          });
        },
        onJobFailed: (cueIndex, errMsg) => {
          const grp = groupByPrimaryCue.get(cueIndex);
          const memberIds =
            grp && grp.sourceCueIds.length > 0 ? grp.sourceCueIds : [cueIndex];
          setAudioSegments((prev) => {
            const next = { ...prev };
            for (const id of memberIds) {
              next[id] = {
                ...(prev[id] || {
                  cueIndex: id,
                  rawDurationSec: 0,
                  targetDurationSec: 0,
                  fittedDurationSec: 0,
                  speedFactor: 1.0,
                  audioStartSec: 0,
                  audioEndSec: 0,
                }),
                status: "failed",
                errorMessage: errMsg,
              };
            }
            return next;
          });
        },
        onProgress: (done, total) => {
          setAudioProgress({ done, total });
        },
        onQueueFinished: () => {
          setIsGeneratingAudio(false);
          setIsAudioPaused(false);
          setAudioProgress(null);
          synthesisQueueRef.current = null;
          if (autoFitEnabled && dubbingMode !== "free_narration") {
            setAudioSegments((current) => {
              const resolved = resolveTimingCollisions(originalCues, current);
              setOverflowAnalysis(
                analyzeTimingCollision(originalCues, resolved, dubbingMode)
              );
              return resolved;
            });
          }
        },
      },
      concurrency
    );

    synthesisQueueRef.current = queue;
    queue.setJobs(jobs);
    queue.start();
  };

  // Batch Audio Generation across all cues using DubbingSynthesisQueue (TASK-13)
  const handleStartBatchSynthesis = async (bypassAsrCheck = false) => {
    if (originalCues.length === 0) return;

    if (!bypassAsrCheck) {
      setIsCheckingAsrReadiness(true);
      try {
        const readiness = await checkAsrReadiness(currentAsrModel);
        setIsAsrReady(readiness.ready);
        if (!readiness.ready) {
          pendingGenerationActionRef.current = () => {
            void handleStartBatchSynthesis(true);
          };
          setAsrReadinessResult(readiness);
          return;
        }
      } finally {
        setIsCheckingAsrReadiness(false);
      }
    }

    executeCuesBatchSynthesis(originalCues);
  };

  const handleRegenerateErrorCues = async (bypassAsrCheck = false) => {
    const errorCues = originalCues.filter((orig) => {
      const seg = audioSegments[orig.index];
      return seg && seg.isGroupPrimary !== false ? isChunkError(seg) : false;
    });
    if (errorCues.length === 0) return;

    if (!bypassAsrCheck) {
      setIsCheckingAsrReadiness(true);
      try {
        const readiness = await checkAsrReadiness(currentAsrModel);
        setIsAsrReady(readiness.ready);
        if (!readiness.ready) {
          pendingGenerationActionRef.current = () => {
            void handleRegenerateErrorCues(true);
          };
          setAsrReadinessResult(readiness);
          return;
        }
      } finally {
        setIsCheckingAsrReadiness(false);
      }
    }

    executeCuesBatchSynthesis(errorCues);
  };

  const handleRegenerateWarningCues = async (bypassAsrCheck = false) => {
    const warningCues = originalCues.filter((orig) => {
      const seg = audioSegments[orig.index];
      return seg && seg.isGroupPrimary !== false ? isChunkWarning(seg) : false;
    });
    if (warningCues.length === 0) return;

    if (!bypassAsrCheck) {
      setIsCheckingAsrReadiness(true);
      try {
        const readiness = await checkAsrReadiness(currentAsrModel);
        setIsAsrReady(readiness.ready);
        if (!readiness.ready) {
          pendingGenerationActionRef.current = () => {
            void handleRegenerateWarningCues(true);
          };
          setAsrReadinessResult(readiness);
          return;
        }
      } finally {
        setIsCheckingAsrReadiness(false);
      }
    }

    executeCuesBatchSynthesis(warningCues);
  };

  const handleTogglePauseAudio = () => {
    if (isAudioPaused) {
      synthesisQueueRef.current?.resume();
      setIsAudioPaused(false);
    } else {
      synthesisQueueRef.current?.pause();
      setIsAudioPaused(true);
    }
  };

  const handleCancelAudio = () => {
    if (synthesisQueueRef.current) {
      synthesisQueueRef.current.cancel();
      synthesisQueueRef.current = null;
    }
    setIsGeneratingAudio(false);
    setIsAudioPaused(false);
    setAudioProgress(null);
  };

  // Single Cue / Single Speech Group Generation & Regeneration
  const handleRegenerateAudio = async (cueIndex: number, bypassAsrCheck = false) => {
    const origIdx = originalCues.findIndex((c) => c.index === cueIndex);
    const orig = originalCues[origIdx];
    const trans = translatedCues.find((c) => c.index === cueIndex);
    if (!orig || !trans) return;

    if (!bypassAsrCheck) {
      setIsCheckingAsrReadiness(true);
      try {
        const readiness = await checkAsrReadiness(currentAsrModel);
        setIsAsrReady(readiness.ready);
        if (!readiness.ready) {
          pendingGenerationActionRef.current = () => {
            void handleRegenerateAudio(cueIndex, true);
          };
          setAsrReadinessResult(readiness);
          return;
        }
      } finally {
        setIsCheckingAsrReadiness(false);
      }
    }

    const activeGroups =
      speechGroups.length > 0
        ? speechGroups
        : planDubbingSpeechGroups(originalCues, translatedCues);
    const targetGroup = findSpeechGroupByCueIndex(activeGroups, cueIndex);
    const memberIds =
      targetGroup && targetGroup.sourceCueIds.length > 0
        ? targetGroup.sourceCueIds
        : [cueIndex];
    const primaryCueIndex = memberIds[0];
    const lastCueIndex = memberIds[memberIds.length - 1];
    const primaryOrig =
      originalCues.find((c) => c.index === primaryCueIndex) || orig;
    const primaryTrans =
      translatedCues.find((c) => c.index === primaryCueIndex) || trans;
    const lastOrigIdx = originalCues.findIndex((c) => c.index === lastCueIndex);
    const nextCue =
      lastOrigIdx >= 0 ? originalCues[lastOrigIdx + 1] : undefined;

    setAudioSegments((prev) => {
      const next = { ...prev };
      for (const id of memberIds) {
        next[id] = {
          ...(prev[id] || {
            cueIndex: id,
            rawDurationSec: 0,
            targetDurationSec: 0,
            fittedDurationSec: 0,
            speedFactor: 1.0,
            audioStartSec: primaryOrig.startSec,
            audioEndSec: primaryOrig.endSec,
          }),
          groupId: targetGroup?.groupId,
          groupCueIndices: targetGroup?.sourceCueIds,
          isGroupPrimary: id === primaryCueIndex,
          primaryCueIndex,
          status: "generating",
        };
      }
      return next;
    });

    try {
      const snapshot = createEffectiveVoiceSnapshot(selectedVoiceId, voices, {
        activeModel: selectedModel,
        speed,
        pitch,
        volume,
      });
      const advancedSettings = getEngineAdvancedSettings(selectedModel);

      const job: DubbingSynthesisJob = {
        originalCue: primaryOrig,
        translatedCue: primaryTrans,
        speechGroup: targetGroup,
        dubbingMode,
        voiceId: selectedVoiceId || "voice_01",
        nextCue,
        autoFit: dubbingMode === "free_narration" ? false : autoFitEnabled,
        voiceSettings: {
          speed,
          pitch,
          volume,
        },
        voiceSnapshot: snapshot,
        advancedSettings,
        asrModelId: currentAsrModel,
      };

      const checkingSegment = await synthesizeAndFitDubbingUnit(job);
      if (!checkingSegment) return;

      setAudioSegments((prev) => {
        const expanded =
          targetGroup && targetGroup.sourceCueIds.length > 0
            ? expandGroupSegmentToCueSegments(
                targetGroup,
                checkingSegment,
                originalCues
              )
            : { [primaryCueIndex]: checkingSegment };
        const updated: Record<number, DubAudioSegment> = {
          ...prev,
          ...expanded,
        };
        setOverflowAnalysis(analyzeTimingCollision(originalCues, updated, dubbingMode));
        return updated;
      });

      const verifiedSegment = await verifyDubbingSegmentQuality(
        checkingSegment,
        job
      );

      setAudioSegments((prev) => {
        const expanded =
          targetGroup && targetGroup.sourceCueIds.length > 0
            ? expandGroupSegmentToCueSegments(
                targetGroup,
                verifiedSegment,
                originalCues
              )
            : { [primaryCueIndex]: verifiedSegment };
        return {
          ...prev,
          ...expanded,
        };
      });
    } catch (err: any) {
      setErrorMessage(
        `Lỗi tạo âm thanh cho câu #${cueIndex}: ${err?.message || err}`
      );
      setAudioSegments((prev) => {
        const next = { ...prev };
        for (const id of memberIds) {
          next[id] = {
            ...(prev[id] || {
              cueIndex: id,
              rawDurationSec: 0,
              targetDurationSec: 0,
              fittedDurationSec: 0,
              speedFactor: 1.0,
              audioStartSec: primaryOrig.startSec,
              audioEndSec: primaryOrig.endSec,
            }),
            status: "failed",
            errorMessage: err?.message || String(err),
          };
        }
        return next;
      });
    }
  };

  // One-click Auto-Fit across all colliding cues (capped at 1.20x per SPEC AC-22)
  // One-click Auto-Fit across all colliding cues (capped at 1.20x per SPEC AC-22)
  const handleAutoFitAll = () => {
    if (originalCues.length === 0 || dubbingMode === "free_narration") return;
    const resolved = resolveTimingCollisions(originalCues, audioSegments);
    const newCollisions = analyzeTimingCollision(originalCues, resolved, dubbingMode);
    setAudioSegments(resolved);
    setOverflowAnalysis(newCollisions);
  };

  // Export Master Audio WAV
  const handleExportMasterWav = async () => {
    if (originalCues.length === 0) return;

    const activeSegments =
      autoFitEnabled && dubbingMode !== "free_narration"
        ? resolveTimingCollisions(originalCues, audioSegments)
        : audioSegments;
    const activeOverflow =
      autoFitEnabled && dubbingMode !== "free_narration"
        ? analyzeTimingCollision(originalCues, activeSegments, dubbingMode)
        : overflowAnalysis;

    const incompleteCues = originalCues.filter(
      (c) =>
        !activeSegments[c.index] || activeSegments[c.index].status !== "ready"
    );
    if (incompleteCues.length > 0) {
      setErrorMessage(
        `Có ${incompleteCues.length} câu chưa có âm thanh sẵn sàng (câu #${incompleteCues
          .map((c) => c.index)
          .slice(0, 5)
          .join(", ")}...). Vui lòng tạo audio toàn bộ kịch bản trước khi xuất.`
      );
      return;
    }

    const collisionCheck = canExportMasterWav(activeOverflow, dubbingMode);
    if (!collisionCheck.allowed) {
      setErrorMessage(
        collisionCheck.reason || "Phát hiện nguy cơ đè tiếng (collision_danger)."
      );
      return;
    }

    try {
      const baseStem = sourceMediaName.replace(/\.[^/.]+$/, "") || "phu_de";
      let chosenPath: string | null = null;

      // 1. If running under Tauri desktop environment, prompt native Save Dialog
      if (
        typeof window !== "undefined" &&
        (window as any).__TAURI_INTERNALS__
      ) {
        try {
          const { save } = await import("@tauri-apps/plugin-dialog");
          chosenPath = await save({
            defaultPath: `${baseStem}_master.wav`,
            filters: [
              { name: "Audio WAV (*.wav)", extensions: ["wav"] },
              { name: "Audio MP3 (*.mp3)", extensions: ["mp3"] },
              { name: "Tất cả các tệp (*.*)", extensions: ["*"] },
            ],
          });
          if (!chosenPath) return; // User cancelled
        } catch (dialogErr) {
          console.warn("Tauri save dialog error:", dialogErr);
        }
      }

      // 2. If chosenPath and local AI sidecar available, use native timeline assembly
      const ai = await getSharedAiServices();
      const primaryCues = originalCues.filter(
        (c) => activeSegments[c.index]?.isGroupPrimary !== false
      );
      const hasAllFilePaths = primaryCues.every((c) =>
        Boolean(activeSegments[c.index]?.audioFilePath)
      );

      if (chosenPath && ai && hasAllFilePaths) {
        const isMp3 = chosenPath.toLowerCase().endsWith(".mp3");
        let inputs: Array<{ path: string; startSec: number }>;
        let totalDurationSec: number;

        if (dubbingMode === "free_narration") {
          let currentCursor = 0;
          inputs = [];
          const pauseGap = pauses.period ?? 0.45;
          for (const c of primaryCues) {
            const seg = activeSegments[c.index];
            const dur = seg.fittedDurationSec || seg.rawDurationSec || 0;
            inputs.push({
              path: seg.audioFilePath!,
              startSec: currentCursor,
            });
            currentCursor += dur + pauseGap;
          }
          totalDurationSec = Math.max(0.1, currentCursor);
        } else {
          inputs = primaryCues.map((c) => ({
            path: activeSegments[c.index].audioFilePath!,
            startSec: activeSegments[c.index].audioStartSec,
          }));
          totalDurationSec = Math.max(...originalCues.map((c) => c.endSec));
        }

        await ai.assemble({
          mode: "timeline",
          inputs,
          totalDurationSec,
          outputPath: chosenPath,
          format: isMp3 ? "mp3" : "wav",
        });

        if (autoFitEnabled && dubbingMode !== "free_narration") {
          setAudioSegments(activeSegments);
          setOverflowAnalysis(activeOverflow);
        }

        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("fs_show_in_folder", { path: chosenPath });
        } catch (folderErr) {
          console.warn("Could not reveal file in folder:", folderErr);
        }

        const voiceProfile = voices.find((v) => v.id === selectedVoiceId);
        const warningCount = Object.values(activeOverflow).filter(
          (o) => o && o.warningLevel !== "none"
        ).length;
        recordCompletedJobToHistory({
          jobKey: `dub_${baseStem}`,
          title: `${baseStem} (${sourceLang} → ${targetLang})`,
          category: "dubbing",
          tasks: ["translation", "dubbing"],
          durationSec: totalDurationSec,
          chunkCount: primaryCues.length,
          status:
            warningCount > 0 && dubbingMode !== "free_narration"
              ? "completed_with_warning"
              : "completed",
          statusWarning:
            warningCount > 0 && dubbingMode !== "free_narration"
              ? `Có ${warningCount} câu thoại đã được nén tốc độ (WSOLA Auto-Fit) để khớp thời lượng gốc.`
              : undefined,
          artifacts: [
            {
              label: `Master Dubbed Audio (${voiceProfile?.name || selectedVoiceId})`,
              filePath: chosenPath,
              type: "audio",
              task: "dubbing",
              audioDurationSec: totalDurationSec,
              isTimelineSynced: true,
            },
          ],
        });

        alert(`Đã xuất Master Audio thành công:\n${chosenPath}`);
        return;
      }

      // 3. Fallback: Assemble audio buffer via Web Audio API or PCM merger
      let sampleMap = new Map<number, Float32Array>();
      if (typeof window !== "undefined" && (window.AudioContext || (window as any).webkitAudioContext)) {
        try {
          const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
          const ctx = new AudioCtx();
          await Promise.all(
            originalCues.map(async (cue) => {
              const seg = activeSegments[cue.index];
              let url = seg?.fittedAudioUrl || seg?.audioUrl;
              if (!url && seg?.audioFilePath) {
                try {
                  url = await readAudioFileBlobUrl(seg.audioFilePath);
                } catch {}
              }
              if (!url) return;
              try {
                const resp = await fetch(url);
                const arr = await resp.arrayBuffer();
                const audioBuf = await ctx.decodeAudioData(arr);
                sampleMap.set(cue.index, audioBuf.getChannelData(0));
              } catch (e) {
                console.warn("Failed to decode cue audio buffer for cue", cue.index, e);
              }
            })
          );
        } catch (ctxErr) {
          console.warn("AudioContext decode error:", ctxErr);
        }
      }

      const res = mergeMasterAudio({
        originalCues,
        audioSegments: activeSegments,
        overflowAnalysis: activeOverflow,
        sampleGetter: (idx) => sampleMap.get(idx) || null,
        autoResolveCollisions: autoFitEnabled && dubbingMode !== "free_narration",
        mode: dubbingMode,
        pauseBetweenGroupsSec: pauses.period ?? 0.45,
      });

      if (!res.ok) {
        setErrorMessage(res.reason || "Không thể xuất file Master WAV.");
        return;
      }

      if (res.resolvedSegments && res.resolvedOverflow && dubbingMode !== "free_narration") {
        setAudioSegments(res.resolvedSegments);
        setOverflowAnalysis(res.resolvedOverflow);
      }

      if (res.blob) {
        const filename = `${baseStem}_master.wav`;
        const url = URL.createObjectURL(res.blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (err: any) {
      console.error("Master WAV export error:", err);
      setErrorMessage(err?.message || "Lỗi khi xuất tệp Master Audio.");
    }
  };

  // Available Providers from translation manager, filtered by translationStyle
  const allProviders = translationManager.listProviders();
  const availableProviders = useMemo(() => {
    if (translationStyle === "cinema") {
      // Google Translate does not support context-aware prompting; only LLMs supported
      return allProviders.filter((p) => p.type !== "google");
    }
    return allProviders;
  }, [allProviders, translationStyle]);

  // Keep selectedProviderId valid if current selection is not supported in active style
  useEffect(() => {
    if (availableProviders.length > 0 && !availableProviders.some((p) => p.id === selectedProviderId)) {
      setSelectedProviderId(availableProviders[0].id);
    }
  }, [availableProviders, selectedProviderId]);

  const currentProvider = availableProviders.find((p) => p.id === selectedProviderId) || availableProviders[0];
  const isProviderUnconfigured = Boolean(
    (currentProvider?.type === "gemini" && !currentProvider.apiKey) ||
    (currentProvider?.type === "deepseek" && !currentProvider.apiKey) ||
    (currentProvider?.type === "openai" && !currentProvider.apiKey) ||
    (currentProvider?.type === "qwen" && !currentProvider.apiKey) ||
    (currentProvider?.type === "lmstudio" && !currentProvider.endpoint) ||
    (currentProvider?.type === "ollama" && !currentProvider.endpoint) ||
    (currentProvider?.type === "custom" && !currentProvider.endpoint)
  );

  // Check if any collision exists (only relevant in source_sync mode)
  const hasCollisionDanger =
    dubbingMode !== "free_narration" &&
    Object.values(overflowAnalysis).some(
      (m) => m.warningLevel === "collision_danger"
    );
  const collidingCuesCount =
    dubbingMode !== "free_narration" ? countCollisions(overflowAnalysis) : 0;

  // Active Dubbing Preview Track (persists while paused until explicitly closed)
  const activeDubTrack: ActiveAudioTrack | null = useMemo(() => {
    if (activePreviewCueIndex === null) return null;
    const seg = audioSegments[activePreviewCueIndex];
    const audioUrl = seg?.fittedAudioUrl || seg?.audioUrl;
    if (!audioUrl) return null;
    const orig = originalCues.find((c) => c.index === activePreviewCueIndex);
    const trans = translatedCues.find((c) => c.index === activePreviewCueIndex);
    const voice = voices.find((v) => v.id === (selectedVoiceId || activeVoiceId));
    const dur =
      seg?.fittedDurationSec ||
      seg?.rawDurationSec ||
      (orig ? Math.max(0.1, orig.endSec - orig.startSec) : 4.0);
    return {
      id: `dub_cue_${activePreviewCueIndex}`,
      chunkIndex: activePreviewCueIndex,
      title: `Câu ${activePreviewCueIndex < 10 ? `0${activePreviewCueIndex}` : activePreviewCueIndex} · Lồng tiếng`,
      voiceName: seg?.effectiveVoiceSnapshot?.voiceName || voice?.name || "Lồng tiếng",
      durationSec: dur,
      audioUrl,
      text: trans?.text || orig?.text,
    };
  }, [activePreviewCueIndex, audioSegments, originalCues, translatedCues, voices, selectedVoiceId, activeVoiceId]);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-background relative">
      {/* Hidden File Input for Subtitle (.srt / .vtt) */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={(e) => {
          if (e.target.files && e.target.files[0]) {
            handleImportFile(e.target.files[0]);
          }
        }}
        accept=".srt,.vtt,text/plain"
        className="hidden"
      />

      {/* Top Workspace Header Bar */}
      <div className="h-12 border-b border-borderDefault bg-surface1 px-4 flex items-center justify-between flex-shrink-0 z-20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center text-accent">
            <Languages className="w-4 h-4" />
          </div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-textPrimary">
              {t.nav.dubbing}
            </h2>
            {sourceMediaName && (
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-surface2 text-textSecondary border border-borderDefault">
                {sourceMediaName}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Mode Switcher Pill Control */}
          <div className="flex items-center bg-surface2 p-0.5 rounded-lg border border-borderDefault">
            <button
              type="button"
              onClick={() => handleDubbingModeChange("source_sync")}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                dubbingMode === "source_sync"
                  ? "bg-accent text-white shadow-2xs"
                  : "text-textSecondary hover:text-textPrimary"
              }`}
              title="Chế độ 1 — Đồng bộ video gốc: Khớp 100% mốc thời gian và thời lượng video ban đầu"
            >
              Đồng bộ video gốc
            </button>
            <button
              type="button"
              onClick={() => handleDubbingModeChange("free_narration")}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                dubbingMode === "free_narration"
                  ? "bg-accent text-white shadow-2xs"
                  : "text-textSecondary hover:text-textPrimary"
              }`}
              title="Chế độ 2 — Thuyết minh tự do: Dịch tự nhiên theo câu/đoạn, không giới hạn timeline gốc"
            >
              Thuyết minh tự do
            </button>
          </div>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-surface2 hover:bg-surface3 text-textPrimary rounded-md border border-borderDefault text-xs font-semibold transition-colors cursor-pointer shadow-2xs"
            title="Tải lên tệp hoặc thư mục phụ đề (.srt, .vtt, .txt)"
          >
            <UploadCloud className="w-3.5 h-3.5 text-accent" />
            <span>Tải Lên</span>
          </button>
        </div>
      </div>

      {/* Restored Session Notification Banner */}
      {restoredNotice && (
        <div className="px-4 py-2 bg-blue-500/10 border-b border-blue-500/20 text-blue-400 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 flex-shrink-0" />
            <span>{restoredNotice}</span>
          </div>
          <button
            onClick={() => setRestoredNotice("")}
            className="text-textMuted hover:text-textPrimary cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Unconfigured Provider Warning Banner (TASK-20 Deep-Link) */}
      {isProviderUnconfigured && (
        <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-amber-400 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>
              Nhà cung cấp <strong>{currentProvider?.displayName}</strong> chưa được cấu hình API Key hoặc Endpoint.
            </span>
          </div>
          <button
            type="button"
            onClick={() => onNavigateToSettings?.("translation")}
            className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-semibold rounded border border-amber-500/40 text-[11px] transition-colors cursor-pointer"
          >
            Cấu hình trong Settings ➔
          </button>
        </div>
      )}

      {/* Error / Warning Alert Banner */}
      {errorMessage && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-red-400 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button
            onClick={() => setErrorMessage("")}
            className="text-textMuted hover:text-textPrimary cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Workspace Main Body: Center Grid & Right Controls Inspector */}
      <div className="flex-1 flex overflow-hidden">
        {/* Center: Side-by-Side Review Grid (Allowed Drop Zone) */}
        <div
          ref={reviewGridDropZoneRef}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className="flex-1 flex flex-col overflow-hidden relative min-w-0"
        >
          {/* Drag and Drop Active Overlay when cues exist */}
          {isDragging && originalCues.length > 0 && (
            <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-xs flex items-center justify-center p-6 pointer-events-none">
              <div className="w-full h-full rounded-2xl border-2 border-dashed border-accent bg-accent/10 flex flex-col items-center justify-center text-center p-6">
                <UploadCloud className="w-12 h-12 text-accent mb-4 animate-bounce" />
                <h3 className="text-xl font-bold text-textPrimary mb-2">
                  Kéo thả file phụ đề vào đây
                </h3>
                <p className="text-xs text-textMuted">
                  Hỗ trợ định dạng .srt, .vtt
                </p>
              </div>
            </div>
          )}

          <ReviewGrid
            originalCues={originalCues}
            translatedCues={translatedCues}
            speechGroups={speechGroups}
            audioSegments={audioSegments}
            overflowAnalysis={overflowAnalysis}
            dubbingMode={dubbingMode}
            playingCueIndex={isPlayingCueAudio ? activePreviewCueIndex : null}
            collidingCount={collidingCuesCount}
            isGeneratingAudio={isGeneratingAudio || isCheckingAsrReadiness}
            onAutoFitAll={handleAutoFitAll}
            onUpdateText={handleUpdateText}
            onUpdateGroupText={handleUpdateGroupText}
            onUpdateFullNarrationScript={handleUpdateFullNarrationScript}
            onPlayAudio={(idx) => {
              if (activePreviewCueIndex === idx) {
                setIsPlayingCueAudio((prev) => !prev);
              } else {
                setActivePreviewCueIndex(idx);
                setIsPlayingCueAudio(true);
              }
            }}
            onRegenerateAudio={(idx) => {
              void handleRegenerateAudio(idx);
            }}
            onRegenerateErrors={() => {
              void handleRegenerateErrorCues();
            }}
            onRegenerateWarnings={() => {
              void handleRegenerateWarningCues();
            }}
            onSelectFile={() => fileInputRef.current?.click()}
            isDragging={isDragging}
            bottomPlayer={
              activeDubTrack ? (
                <BottomAudioPlayer
                  track={activeDubTrack}
                  isPlaying={isPlayingCueAudio}
                  onTogglePlay={() => setIsPlayingCueAudio((prev) => !prev)}
                  onClose={() => {
                    setIsPlayingCueAudio(false);
                    setActivePreviewCueIndex(null);
                  }}
                  className="mx-0 mb-0"
                />
              ) : null
            }
          />
        </div>

        {/* Right Inspector Panel: Subtitle Translation & Dubbing Controls */}
        <aside className="w-[380px] border-l border-borderDefault bg-surface1 select-none flex-shrink-0 flex flex-col h-full overflow-hidden text-xs">
          {/* PHẦN 1: DỊCH PHỤ ĐỀ (Vừa vặn nội dung, không thừa khoảng trống) */}
          <div className="flex-shrink-0 border-b border-borderDefault flex flex-col bg-surface1">
            <div className="p-3.5 pb-2 space-y-2.5">
              <div className="flex items-center gap-2 pb-0.5">
                <Languages className="w-4 h-4 text-accent" />
                <span className="font-bold text-xs text-textPrimary uppercase tracking-wide">
                  Dịch Phụ Đề
                </span>
              </div>

              {/* Phong Cách Dịch */}
              <div className="space-y-1">
                <label className="block text-[11px] font-semibold text-textMuted uppercase tracking-wider">
                  Phong Cách Dịch
                </label>
                <select
                  value={translationStyle}
                  onChange={(e) => {
                    const val = e.target.value as TranslationStyle;
                    setTranslationStyle(val);
                    try {
                      const current = loadTranslationSettings();
                      saveTranslationSettings({ ...current, translationStyle: val });
                    } catch {
                      // ignore
                    }
                    if (val === "cinema" && selectedProviderId === "google") {
                      const supported = allProviders.filter((p) => p.type !== "google");
                      if (supported.length > 0) {
                        setSelectedProviderId(supported[0].id);
                      }
                    }
                  }}
                  className="w-full h-[32px] bg-surface2/50 hover:bg-surface2/80 border border-borderDefault rounded-lg px-2.5 text-xs text-textPrimary focus:border-accent focus:outline-none transition-colors cursor-pointer"
                >
                  <option value="default">Mặc định</option>
                  <option value="cinema">Điện ảnh</option>
                </select>
              </div>

              {/* Model Dịch */}
              <div className="space-y-1">
                <label className="block text-[11px] font-semibold text-textMuted uppercase tracking-wider">
                  Model Dịch
                </label>
                <select
                  value={selectedProviderId}
                  onChange={(e) => setSelectedProviderId(e.target.value)}
                  className="w-full h-[32px] bg-surface2/50 hover:bg-surface2/80 border border-borderDefault rounded-lg px-2.5 text-xs text-textPrimary focus:border-accent focus:outline-none transition-colors cursor-pointer"
                >
                  {availableProviders.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName} ({p.badge})
                    </option>
                  ))}
                </select>
              </div>

              {/* Ngôn Ngữ Gốc & Ngôn Ngữ Đích (Cùng dòng) */}
              <div className="grid grid-cols-2 gap-2">
                {/* Ngôn Ngữ Gốc */}
                <div className="space-y-1">
                  <label className="block text-[11px] font-semibold text-textMuted uppercase tracking-wider truncate">
                    {lang === "en" ? "Source Language" : lang === "zh" ? "源语言" : lang === "ja" ? "原言語" : "Ngôn Ngữ Gốc"}
                  </label>
                  <SearchableLanguageSelect
                    value={sourceLang}
                    onChange={(val) => {
                      setSourceLang(val);
                      try {
                        const current = loadTranslationSettings();
                        saveTranslationSettings({ ...current, sourceLanguage: val });
                      } catch {
                        // ignore
                      }
                    }}
                    languages={TRANSLATION_SOURCE_LANGUAGES}
                    size="sm"
                    dropdownAlign="left"
                    ariaLabel={lang === "en" ? "Source language" : lang === "zh" ? "源语言" : lang === "ja" ? "原言語" : "Ngôn ngữ gốc"}
                  />
                </div>

                {/* Ngôn Ngữ Đích */}
                <div className="space-y-1">
                  <label className="block text-[11px] font-semibold text-textMuted uppercase tracking-wider truncate">
                    {lang === "en" ? "Target Language" : lang === "zh" ? "目标语言" : lang === "ja" ? "対象言語" : "Ngôn Ngữ Đích"}
                  </label>
                  <SearchableLanguageSelect
                    value={targetLang}
                    onChange={(val) => {
                      setTargetLang(val);
                      try {
                        const current = loadTranslationSettings();
                        saveTranslationSettings({ ...current, targetLanguage: val });
                      } catch {
                        // ignore
                      }
                    }}
                    languages={TRANSLATION_TARGET_LANGUAGES}
                    size="sm"
                    dropdownAlign="right"
                    ariaLabel={lang === "en" ? "Target language" : lang === "zh" ? "目标语言" : lang === "ja" ? "対象言語" : "Ngôn ngữ đích"}
                  />
                </div>
              </div>
            </div>

            {/* Actions for Translation */}
            <div className="p-3 pt-1 pb-3.5 space-y-2 flex-shrink-0">
              {/* Integrated Progress Button for Translation */}
              {(() => {
                const transTotal = originalCues.length;
                const transDone = translationProgress?.done || 0;
                const transPercent = transTotal > 0 ? Math.min(100, Math.round((transDone / transTotal) * 100)) : 0;

                if (isTranslating) {
                  if (isTranslationPaused) {
                    return (
                      <div className="flex items-center gap-2 w-full h-[46px]">
                        <button
                          type="button"
                          onClick={handleTogglePauseTranslation}
                          title={`Tiếp tục dịch (${transDone}/${transTotal} câu - ${transPercent}%)`}
                          className="flex-1 h-full px-2 rounded-xl text-xs font-semibold shadow-md transition-all flex flex-col items-center justify-center gap-0.5 bg-accent hover:bg-accentHover text-white cursor-pointer active:scale-[0.98]"
                        >
                          <div className="flex items-center gap-1.5">
                            <Play className="w-3.5 h-3.5 fill-white" />
                            <span>Tiếp tục</span>
                          </div>
                          <span className="text-[10px] font-mono opacity-85 font-normal">
                            {transDone}/{transTotal} ({transPercent}%)
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelTranslation}
                          title="Hủy tiến trình dịch thuật"
                          className="flex-1 h-full px-2 rounded-xl text-xs font-semibold transition-all flex flex-col items-center justify-center gap-0.5 bg-surface2 hover:bg-danger/15 text-textSecondary hover:text-danger border border-borderDefault hover:border-danger/30 cursor-pointer active:scale-[0.98]"
                        >
                          <div className="flex items-center gap-1.5">
                            <X className="w-3.5 h-3.5" />
                            <span>Hủy</span>
                          </div>
                          <span className="text-[10px] opacity-70 font-normal">
                            Dừng tác vụ
                          </span>
                        </button>
                      </div>
                    );
                  }

                  return (
                    <button
                      type="button"
                      onClick={handleTogglePauseTranslation}
                      title={`Bấm để tạm dừng (Đang dịch: ${transDone}/${transTotal} câu)`}
                      className="w-full h-[46px] rounded-xl text-xs font-semibold shadow-xs transition-all relative overflow-hidden flex items-center justify-center cursor-pointer border border-borderDefault/80 bg-surface2 dark:bg-surface3 group select-none active:scale-[0.99]"
                    >
                      <div
                        className="absolute inset-y-0 left-0 bg-accent transition-[width] duration-300 ease-out shadow-[0_0_12px_rgba(56,189,248,0.25)]"
                        style={{ width: `${Math.max(transPercent, 2)}%` }}
                      />
                      {transPercent > 0 && transPercent < 100 && (
                        <div
                          className="absolute inset-y-0 w-8 bg-gradient-to-r from-transparent via-white/25 to-transparent pointer-events-none transition-all duration-300 ease-out -translate-x-full"
                          style={{ left: `${Math.max(transPercent, 2)}%` }}
                        />
                      )}
                      {/* Base text layer */}
                      <div className="absolute inset-0 flex items-center justify-center gap-2 text-textPrimary font-bold px-3 w-full select-none">
                        <span className="relative flex items-center justify-center w-4 h-4 flex-shrink-0">
                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-accent group-hover:opacity-0 transition-opacity" />
                          <Pause className="w-3.5 h-3.5 fill-textPrimary text-textPrimary absolute opacity-0 group-hover:opacity-100 transition-opacity" />
                        </span>
                        <span className="truncate">
                          Đang dịch: {transDone}/{transTotal} câu ({transPercent}%)
                        </span>
                      </div>
                      {/* Inverted text layer */}
                      <div
                        className="absolute inset-0 flex items-center justify-center gap-2 text-white font-bold px-3 w-full pointer-events-none select-none"
                        style={{
                          clipPath: `inset(0 calc(100% - ${Math.max(transPercent, 2)}%) 0 0)`,
                        }}
                      >
                        <span className="relative flex items-center justify-center w-4 h-4 flex-shrink-0">
                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-white group-hover:opacity-0 transition-opacity" />
                          <Pause className="w-3.5 h-3.5 fill-white absolute opacity-0 group-hover:opacity-100 transition-opacity" />
                        </span>
                        <span className="truncate">
                          Đang dịch: {transDone}/{transTotal} câu ({transPercent}%)
                        </span>
                      </div>
                    </button>
                  );
                }

                return (
                  <button
                    type="button"
                    disabled={originalCues.length === 0}
                    onClick={handleTranslateAll}
                    className={`w-full h-[46px] px-3 rounded-xl text-xs font-semibold shadow-md transition-all flex items-center justify-center gap-2 ${
                      originalCues.length === 0
                        ? "bg-surface3 text-textMuted cursor-not-allowed border border-borderDefault/50"
                        : "bg-accent hover:bg-accentHover text-white cursor-pointer active:scale-[0.98] hover:shadow-lg hover:shadow-accent/20"
                    }`}
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>Dịch toàn bộ kịch bản</span>
                  </button>
                );
              })()}

              {/* Nút Xuất file phụ đề / văn bản */}
              {dubbingMode === "free_narration" ? (
                <div className="space-y-1.5 pt-0.5">
                  <button
                    type="button"
                    disabled={translatedCues.length === 0}
                    onClick={handleExportTxt}
                    className="w-full py-2 bg-surface1 hover:bg-surface2 text-textPrimary border border-borderDefault rounded-lg font-medium text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Xuất toàn bộ kịch bản dịch dạng văn bản thuần (.TXT) để dùng dựng phim hoặc lồng tiếng tự do"
                  >
                    <Download className="w-3.5 h-3.5 text-textMuted" />
                    <span>Xuất văn bản dịch (.TXT)</span>
                  </button>
                  <button
                    type="button"
                    disabled={translatedCues.length === 0}
                    onClick={handleExportTranslatedSrt}
                    className="w-full py-2 bg-surface1 hover:bg-surface2 text-textPrimary border border-borderDefault rounded-lg font-medium text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Xuất file phụ đề tham chiếu (.SRT) kế thừa mốc thời gian gốc để đối chiếu"
                  >
                    <Download className="w-3.5 h-3.5 text-textMuted" />
                    <span>Xuất phụ đề tham chiếu (.SRT)</span>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={translatedCues.length === 0}
                  onClick={handleExportTranslatedSrt}
                  className="w-full py-2 bg-surface1 hover:bg-surface2 text-textPrimary border border-borderDefault rounded-lg font-medium text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Xuất file phụ đề đã dịch (.SRT) kế thừa 100% mốc thời gian gốc"
                >
                  <Download className="w-3.5 h-3.5 text-textMuted" />
                  <span>Xuất phụ đề đã dịch (.SRT)</span>
                </button>
              )}
            </div>
          </div>

          {/* PHẦN 2: LỒNG TIẾNG (Mở rộng toàn bộ chiều dài còn lại) */}
          <div className="flex-1 min-h-0 flex flex-col">
            {/* Scrollable Settings */}
            <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5">
              <div className="flex items-center justify-between pb-0.5">
                <div className="flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-accent" />
                  <span className="font-bold text-xs text-textPrimary uppercase tracking-wide">
                    Lồng Tiếng
                  </span>
                </div>
                {speechGroups.length > 0 && (
                  <span
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/25"
                    title={`Gộp ${originalCues.length} phụ đề thành ${speechGroups.length} nhóm câu thoại hoàn chỉnh`}
                  >
                    {speechGroups.length} nhóm câu
                  </span>
                )}
              </div>

              {/* Chế độ Dịch & Lồng tiếng */}
              <div className="space-y-1">
                <label className="block text-[11px] font-semibold text-textMuted uppercase tracking-wider">
                  Chế Độ Dịch & Lồng Tiếng
                </label>
                <select
                  value={dubbingMode}
                  onChange={(e) => handleDubbingModeChange(e.target.value)}
                  className="w-full h-[32px] bg-surface2/50 hover:bg-surface2/80 border border-borderDefault rounded-lg px-2.5 text-xs text-textPrimary focus:border-accent focus:outline-none transition-colors cursor-pointer"
                >
                  <option value="source_sync">
                    Chế độ 1: Đồng bộ video gốc (source_sync)
                  </option>
                  <option value="free_narration">
                    Chế độ 2: Thuyết minh tự do (free_narration)
                  </option>
                </select>
                <p className="text-[11px] text-textMuted leading-tight pt-0.5">
                  {dubbingMode === "source_sync"
                    ? "Giữ nguyên hình ảnh, thời lượng và mốc thoại gốc. Hỗ trợ Auto-Fit WSOLA tối đa 1.20x."
                    : "Dịch tự nhiên theo câu/đoạn, không giới hạn timeline gốc. Ghép nối daisy-chain mượt mà."}
                </p>
              </div>

              {/* Giọng lồng tiếng & Model đọc */}
              <VoiceSelector
                voices={voices}
                selectedVoiceId={selectedVoiceId}
                onSelectVoice={handleSelectVoice}
                onOpenVoiceModal={onOpenVoiceModal}
                activeModel={selectedModel}
                onChangeModel={handleModelChange}
              />

              {/* Cài đặt (Tốc độ, Cao độ, Âm lượng) với Đặt lại */}
              <div className="border-t border-borderDefault/60 pt-2 space-y-3">
                <div className="flex items-center justify-between pb-0.5">
                  <label className="block text-[11px] font-semibold text-textMuted uppercase tracking-wider">
                    {t.inspector.settings}
                  </label>
                  <button
                    type="button"
                    onClick={handleResetSettings}
                    title={t.inspector.resetSettingsTooltip}
                    className="flex items-center gap-1 text-xs text-textMuted hover:text-accent focus-visible:ring-1 focus-visible:ring-accent rounded px-1.5 py-0.5 transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>{t.inspector.resetSettings}</span>
                  </button>
                </div>

                {/* Speed Slider */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-textSecondary flex items-center gap-1.5 font-medium">
                      <Gauge className="w-3.5 h-3.5 text-textMuted" />
                      <span>{t.inspector.speed}</span>
                    </span>
                    <span className="font-mono text-accent font-semibold">
                      {speed.toFixed(2)}×
                    </span>
                  </div>
                  <div className="relative flex items-center">
                    <input
                      type="range"
                      min="0.5"
                      max="1.5"
                      step="0.05"
                      value={speed}
                      onChange={(e) => setSpeed(parseFloat(e.target.value))}
                      className="w-full accent-accent bg-surface3 h-1.5 rounded-full appearance-none cursor-pointer"
                    />
                  </div>
                  <div className="flex justify-between text-[11px] text-textMuted pt-0.5">
                    <span>0.5×</span>
                    <span>1.5×</span>
                  </div>
                </div>

                {/* Pitch Slider */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-textSecondary flex items-center gap-1.5 font-medium">
                      <Activity className="w-3.5 h-3.5 text-textMuted" />
                      <span>{t.inspector.pitch}</span>
                    </span>
                    <span className="font-mono text-accent font-semibold">
                      {pitch.toFixed(2)}
                    </span>
                  </div>
                  <div className="relative flex items-center">
                    <input
                      type="range"
                      min="0.5"
                      max="1.5"
                      step="0.05"
                      value={pitch}
                      onChange={(e) => setPitch(parseFloat(e.target.value))}
                      className="w-full accent-accent bg-surface3 h-1.5 rounded-full appearance-none cursor-pointer"
                    />
                  </div>
                  <div className="flex justify-between text-[11px] text-textMuted pt-0.5">
                    <span>{t.inspector.low}</span>
                    <span>{t.inspector.high}</span>
                  </div>
                </div>

                {/* Volume Slider */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-textSecondary flex items-center gap-1.5 font-medium">
                      <Volume2 className="w-3.5 h-3.5 text-textMuted" />
                      <span>{t.inspector.volume}</span>
                    </span>
                    <span className="font-mono text-accent font-semibold">
                      {Math.round(volume * 100)}%
                    </span>
                  </div>
                  <div className="relative flex items-center">
                    <input
                      type="range"
                      min="0"
                      max="2.0"
                      step="0.05"
                      value={volume}
                      onChange={(e) => setVolume(parseFloat(e.target.value))}
                      className="w-full accent-accent bg-surface3 h-1.5 rounded-full appearance-none cursor-pointer"
                    />
                  </div>
                  <div className="flex justify-between text-[11px] text-textMuted pt-0.5">
                    <span>0%</span>
                    <span>200%</span>
                  </div>
                </div>
              </div>

              {/* Ngắt nghỉ (Collapsible) */}
              <div className="pt-2 border-t border-borderDefault/60">
                <button
                  type="button"
                  onClick={() => setIsPausesOpen(!isPausesOpen)}
                  className="w-full flex items-center justify-between py-1.5 px-1 rounded-md text-xs font-semibold text-textSecondary hover:text-textPrimary hover:bg-surface2/40 outline-none focus:outline-none transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-accent" />
                    <span className="uppercase tracking-wider font-bold">
                      {t.inspector.pausesTitle}
                    </span>
                  </div>
                  <ChevronRight
                    className={`w-3.5 h-3.5 transition-transform duration-200 ${
                      isPausesOpen ? "rotate-90" : ""
                    }`}
                  />
                </button>

                {isPausesOpen && (
                  <div className="space-y-3 pt-2">
                    <div className="grid grid-cols-2 gap-3">
                      {/* Comma Pause */}
                      <div className="space-y-1">
                        <span className="text-xs font-medium text-textSecondary block truncate">
                          {t.inspector.comma}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min="0.1"
                            max="3.0"
                            step="0.1"
                            value={pauses.comma}
                            onChange={(e) =>
                              handlePauseChange("comma", parseFloat(e.target.value) || 0.1)
                            }
                            className="w-full h-8 bg-surface1 border border-borderDefault rounded-lg px-2 text-xs text-textPrimary font-mono text-center focus:border-accent focus:outline-none"
                          />
                          <span className="text-textMuted text-[11px] flex-shrink-0">
                            {t.inspector.sec}
                          </span>
                        </div>
                      </div>

                      {/* Period Pause */}
                      <div className="space-y-1">
                        <span className="text-xs font-medium text-textSecondary block truncate">
                          {t.inspector.period}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min="0.2"
                            max="5.0"
                            step="0.1"
                            value={pauses.period}
                            onChange={(e) =>
                              handlePauseChange("period", parseFloat(e.target.value) || 0.2)
                            }
                            className="w-full h-8 bg-surface1 border border-borderDefault rounded-lg px-2 text-xs text-textPrimary font-mono text-center focus:border-accent focus:outline-none"
                          />
                          <span className="text-textMuted text-[11px] flex-shrink-0">
                            {t.inspector.sec}
                          </span>
                        </div>
                      </div>

                      {/* Question & Exclamation Pause */}
                      <div className="space-y-1">
                        <span className="text-xs font-medium text-textSecondary block truncate">
                          {t.inspector.questionExclamation}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min="0.2"
                            max="5.0"
                            step="0.1"
                            value={pauses.questionExclamation}
                            onChange={(e) =>
                              handlePauseChange("questionExclamation", parseFloat(e.target.value) || 0.2)
                            }
                            className="w-full h-8 bg-surface1 border border-borderDefault rounded-lg px-2 text-xs text-textPrimary font-mono text-center focus:border-accent focus:outline-none"
                          />
                          <span className="text-textMuted text-[11px] flex-shrink-0">
                            {t.inspector.sec}
                          </span>
                        </div>
                      </div>

                      {/* Colon & Semicolon Pause */}
                      <div className="space-y-1">
                        <span className="text-xs font-medium text-textSecondary block truncate">
                          {t.inspector.colonSemicolon}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min="0.1"
                            max="3.0"
                            step="0.1"
                            value={pauses.colonSemicolon}
                            onChange={(e) =>
                              handlePauseChange("colonSemicolon", parseFloat(e.target.value) || 0.1)
                            }
                            className="w-full h-8 bg-surface1 border border-borderDefault rounded-lg px-2 text-xs text-textPrimary font-mono text-center focus:border-accent focus:outline-none"
                          />
                          <span className="text-textMuted text-[11px] flex-shrink-0">
                            {t.inspector.sec}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Nâng cao (Collapsible) */}
              <div className="pt-2 border-t border-borderDefault/60">
                <button
                  type="button"
                  onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
                  className="w-full flex items-center justify-between py-1.5 px-1 rounded-md text-xs font-semibold text-textSecondary hover:text-textPrimary hover:bg-surface2/40 outline-none focus:outline-none transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-1.5">
                    <Settings2 className="w-3.5 h-3.5 text-accent" />
                    <span className="uppercase tracking-wider font-bold">
                      {t.inspector.advanced}
                    </span>
                  </div>
                  <ChevronRight
                    className={`w-3.5 h-3.5 transition-transform duration-200 ${
                      isAdvancedOpen ? "rotate-90" : ""
                    }`}
                  />
                </button>

                {isAdvancedOpen && (
                  <div className="space-y-3 pt-2">
                    {/* Khớp thời gian file gốc toggle (Chỉ cho source_sync) */}
                    {dubbingMode === "source_sync" ? (
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-textSecondary font-medium select-none flex items-center gap-1.5">
                            <Zap className={`w-3.5 h-3.5 ${autoFitEnabled ? "text-accent" : "text-textMuted"}`} />
                            Khớp thời gian file gốc
                          </span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={autoFitEnabled}
                            onClick={() => setAutoFitEnabled((prev) => !prev)}
                            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                              autoFitEnabled ? "bg-accent" : "bg-surface3"
                            }`}
                            title={`Khớp thời gian file gốc: ${autoFitEnabled ? "Bật (ON)" : "Tắt (OFF)"}`}
                          >
                            <span
                              aria-hidden="true"
                              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                                autoFitEnabled ? "translate-x-4" : "translate-x-0"
                              }`}
                            />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-[11px] text-textMuted italic">
                        Chế độ Thuyết minh tự do phát âm theo tốc độ tự nhiên, không ép mốc thời gian video gốc.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Quick action to fix all collisions if any exist (source_sync only) */}
              {dubbingMode === "source_sync" && hasCollisionDanger && (
                <button
                  type="button"
                  onClick={handleAutoFitAll}
                  className="w-full py-2 px-3 rounded-lg font-semibold text-xs bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs animate-in fade-in"
                  title="Tự động tính toán lại tốc độ đọc để triệt tiêu toàn bộ va chạm thời lượng"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>Khớp thời lượng toàn bộ ({collidingCuesCount} câu)</span>
                </button>
              )}
            </div>

            {/* Sticky Bottom Actions for Dubbing */}
            <div className="p-3 border-t border-borderDefault/70 bg-surface1/95 backdrop-blur-xs flex-shrink-0 space-y-2">
              {/* Integrated Progress Button for Dubbing */}
              {(() => {
                const audioTotal =
                  audioProgress?.total ||
                  (speechGroups.length > 0
                    ? speechGroups.length
                    : originalCues.length);
                const audioDone = audioProgress?.done || 0;
                const audioPercent = audioTotal > 0 ? Math.min(100, Math.round((audioDone / audioTotal) * 100)) : 0;

                if (isGeneratingAudio) {
                  if (isAudioPaused) {
                    return (
                      <div className="flex items-center gap-2 w-full h-[52px]">
                        <button
                          type="button"
                          onClick={handleTogglePauseAudio}
                          title={`Tiếp tục lồng tiếng (${audioDone}/${audioTotal} câu - ${audioPercent}%)`}
                          className="flex-1 h-full px-2 rounded-xl text-xs font-semibold shadow-md transition-all flex flex-col items-center justify-center gap-0.5 bg-accent hover:bg-accentHover text-white cursor-pointer active:scale-[0.98]"
                        >
                          <div className="flex items-center gap-1.5">
                            <Play className="w-3.5 h-3.5 fill-white" />
                            <span>Tiếp tục</span>
                          </div>
                          <span className="text-[10px] font-mono opacity-85 font-normal">
                            {audioDone}/{audioTotal} ({audioPercent}%)
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelAudio}
                          title="Hủy tiến trình lồng tiếng"
                          className="flex-1 h-full px-2 rounded-xl text-xs font-semibold transition-all flex flex-col items-center justify-center gap-0.5 bg-surface2 hover:bg-danger/15 text-textSecondary hover:text-danger border border-borderDefault hover:border-danger/30 cursor-pointer active:scale-[0.98]"
                        >
                          <div className="flex items-center gap-1.5">
                            <X className="w-3.5 h-3.5" />
                            <span>Hủy</span>
                          </div>
                          <span className="text-[10px] opacity-70 font-normal">
                            Dừng tác vụ
                          </span>
                        </button>
                      </div>
                    );
                  }

                  return (
                    <button
                      type="button"
                      onClick={handleTogglePauseAudio}
                      title={`Bấm để tạm dừng (Đang lồng tiếng: ${audioDone}/${audioTotal} câu)`}
                      className="w-full h-[52px] rounded-xl text-xs font-semibold shadow-xs transition-all relative overflow-hidden flex items-center justify-center cursor-pointer border border-borderDefault/80 bg-surface2 dark:bg-surface3 group select-none active:scale-[0.99]"
                    >
                      <div
                        className="absolute inset-y-0 left-0 bg-accent transition-[width] duration-300 ease-out shadow-[0_0_12px_rgba(56,189,248,0.25)]"
                        style={{ width: `${Math.max(audioPercent, 2)}%` }}
                      />
                      {audioPercent > 0 && audioPercent < 100 && (
                        <div
                          className="absolute inset-y-0 w-8 bg-gradient-to-r from-transparent via-white/25 to-transparent pointer-events-none transition-all duration-300 ease-out -translate-x-full"
                          style={{ left: `${Math.max(audioPercent, 2)}%` }}
                        />
                      )}
                      {/* Base text layer */}
                      <div className="absolute inset-0 flex items-center justify-center gap-2 text-textPrimary font-bold px-3 w-full select-none">
                        <span className="relative flex items-center justify-center w-4 h-4 flex-shrink-0">
                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-accent group-hover:opacity-0 transition-opacity" />
                          <Pause className="w-3.5 h-3.5 fill-textPrimary text-textPrimary absolute opacity-0 group-hover:opacity-100 transition-opacity" />
                        </span>
                        <span className="truncate">
                          Đang lồng tiếng: {audioDone}/{audioTotal} câu ({audioPercent}%)
                        </span>
                      </div>
                      {/* Inverted text layer */}
                      <div
                        className="absolute inset-0 flex items-center justify-center gap-2 text-white font-bold px-3 w-full pointer-events-none select-none"
                        style={{
                          clipPath: `inset(0 calc(100% - ${Math.max(audioPercent, 2)}%) 0 0)`,
                        }}
                      >
                        <span className="relative flex items-center justify-center w-4 h-4 flex-shrink-0">
                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-white group-hover:opacity-0 transition-opacity" />
                          <Pause className="w-3.5 h-3.5 fill-white absolute opacity-0 group-hover:opacity-100 transition-opacity" />
                        </span>
                        <span className="truncate">
                          Đang lồng tiếng: {audioDone}/{audioTotal} câu ({audioPercent}%)
                        </span>
                      </div>
                    </button>
                  );
                }

                return (
                  <button
                    type="button"
                    disabled={originalCues.length === 0 || isCheckingAsrReadiness}
                    onClick={() => void handleStartBatchSynthesis()}
                    className={`w-full h-[52px] px-3 rounded-xl text-xs font-semibold shadow-md transition-all flex items-center justify-center gap-2 ${
                      originalCues.length === 0 || isCheckingAsrReadiness
                        ? "bg-surface3 text-textMuted cursor-not-allowed border border-borderDefault/50"
                        : "bg-accent hover:bg-accentHover text-white cursor-pointer active:scale-[0.98] hover:shadow-lg hover:shadow-accent/20"
                    }`}
                  >
                    <Volume2 className="w-4 h-4" />
                    <span>Lồng tiếng cho kịch bản</span>
                  </button>
                );
              })()}

              {/* Nút Xuất phụ đề đồng bộ âm thanh (.SRT) (Chỉ có trong chế độ free_narration) */}
              {dubbingMode === "free_narration" && (
                <button
                  type="button"
                  disabled={
                    originalCues.length === 0 ||
                    Object.values(audioSegments).every((s) => s.status !== "ready")
                  }
                  onClick={handleExportAlignedSrt}
                  className="w-full py-2 bg-surface1 hover:bg-surface2 text-textPrimary border border-borderDefault rounded-lg font-medium text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-2xs"
                  title="Xuất file phụ đề có mốc thời gian được căn chỉnh tự động theo đúng dòng thời gian âm thanh mới tạo"
                >
                  <Download className="w-3.5 h-3.5 text-accent" />
                  <span>Xuất phụ đề đồng bộ âm thanh (.SRT)</span>
                </button>
              )}

              {/* Nút Xuất Master Audio (.WAV) */}
              <button
                type="button"
                disabled={
                  originalCues.length === 0 ||
                  (dubbingMode === "source_sync" && !autoFitEnabled && hasCollisionDanger)
                }
                onClick={handleExportMasterWav}
                className={`w-full py-2 rounded-lg font-semibold text-xs transition-colors flex items-center justify-center gap-1.5 shadow-2xs ${
                  dubbingMode === "source_sync" && !autoFitEnabled && hasCollisionDanger
                    ? "bg-red-500/20 text-red-400 border border-red-500/30 cursor-not-allowed"
                    : "bg-surface1 hover:bg-surface2 text-textPrimary border border-borderDefault cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                }`}
                title={
                  dubbingMode === "free_narration"
                    ? "Ghép toàn bộ các đoạn thuyết minh nối tiếp thành file âm thanh Master WAV (44.1kHz 16-bit Mono)"
                    : "Ghép toàn bộ các đoạn thoại lồng tiếng vào file âm thanh tổng Master WAV (44.1kHz 16-bit Mono)"
                }
              >
                <Download className="w-3.5 h-3.5 text-textMuted" />
                <span>
                  {dubbingMode === "free_narration"
                    ? "Xuất Master Audio Thuyết minh (.WAV)"
                    : "Xuất Master Audio Đồng bộ (.WAV)"}
                </span>
              </button>

              {dubbingMode === "source_sync" && hasCollisionDanger && autoFitEnabled && (
                <div className="p-2 bg-blue-500/10 border border-blue-500/20 rounded-md text-blue-400 text-[11px] flex items-start gap-1.5">
                  <Zap className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span>
                    Sẽ tự động khớp thời lượng cho {collidingCuesCount} câu va chạm khi xuất Master WAV.
                  </span>
                </div>
              )}

              {dubbingMode === "source_sync" && hasCollisionDanger && !autoFitEnabled && (
                <div className="p-2 bg-red-500/10 border border-red-500/20 rounded-md text-red-400 text-[11px] flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span>
                    Bị chặn xuất Master Audio do có câu thoại bị đè lên mốc bắt đầu của câu kế tiếp (Bật Auto-Fit để tự động xử lý).
                  </span>
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* Pre-flight ASR Readiness Modal */}
      <AsrReadinessModal
        isOpen={Boolean(asrReadinessResult)}
        readiness={asrReadinessResult}
        onClose={() => {
          setAsrReadinessResult(null);
          pendingGenerationActionRef.current = null;
        }}
        onSwitchModelAndProceed={(newModelId: string) => {
          applyAsrModelSwitch(newModelId);
          setCurrentAsrModel(newModelId);
          setIsAsrReady(true);
          setAsrReadinessResult(null);
          const action = pendingGenerationActionRef.current;
          pendingGenerationActionRef.current = null;
          if (action) action();
        }}
        onNavigateToTranscription={() => {
          setAsrReadinessResult(null);
          pendingGenerationActionRef.current = null;
          try {
            window.dispatchEvent(
              new CustomEvent("voxlab:navigate", { detail: { tab: "transcription" } })
            );
          } catch {
            // ignore
          }
        }}
      />
    </div>
  );
};
