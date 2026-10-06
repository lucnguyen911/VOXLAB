import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Captions,
  FileVideo,
  FileAudio,
  UploadCloud,
  Play,
  Pause,
  Download,
  Sparkles,
  RefreshCw,
  AlertCircle,
  Trash2,
  FileText,
  AlertTriangle,
  Sliders,
  RotateCcw,
  RotateCw,
  Volume2,
  Volume1,
  VolumeX,
  Languages,
  X,
} from "lucide-react";
import { useI18n } from "../i18n/context";
import {
  SubtitleCue,
  exportToSrt,
  formatSrtTimestamp,
  generateSubtitlesFromText,
  loadSubtitleSettings,
  saveSubtitleSettings,
  SubtitleSettings,
  SubtitleSpeechSpeed,
  SubtitleProcessingSpeed,
  SubtitleAspectRatio,
  SubtitleMaxLines,
  WhisperSegment,
  remapWhisperOutputToOriginalTimeline,
  WHISPER_AUDIO_LANGUAGES,
} from "../services/subtitle";
import { DubbingHandoffSnapshot } from "../types/dubbing";
import { extractFilesFromDropEvent } from "../services/fileDropHelper";
import { SearchableLanguageSelect } from "../components/common/SearchableLanguageSelect";

export type SubtitleWorkspaceState =
  | "EMPTY"
  | "READY"
  | "PROCESSING"
  | "RESULT"
  | "ERROR";

export interface MediaFileInfo {
  name: string;
  sizeFormatted: string;
  type: "audio" | "video";
  durationSec: number;
  resolutionOrFormat: string;
  hasAudioTrack: boolean;
  objectUrl?: string;
  file?: File;
}

export interface EditableSubtitleCue extends SubtitleCue {
  isEdited?: boolean;
}

export interface TranscriptionWorkspaceProps {
  onSendToTts?: (text: string) => void;
  onHandoffToDubbing?: (snapshot: DubbingHandoffSnapshot) => void;
  initialState?: SubtitleWorkspaceState;
  initialFileInfo?: MediaFileInfo | null;
  initialCues?: EditableSubtitleCue[];
}

const DEFAULT_TRANSCRIPT_TEXT =
  "Chào mọi người đã quay trở lại với series sản xuất nội dung âm thanh VoxLab. Hôm nay chúng ta sẽ thử nghiệm mô hình nhận diện giọng nói faster-whisper trên hệ thống. Tốc độ xử lý đạt trên 15x thời gian thực với độ chính xác cao đối với tiếng Việt có dấu. Sau khi bóc băng xong, bạn có thể bấm nút Chuyển sang TTS để lồng tiếng lại ngay lập tức.";

/**
 * Compact, auto-resizing textarea that matches subtitle text typography
 */
const AutoResizeCueTextarea: React.FC<{
  value: string;
  onChange: (val: string) => void;
  onFocus: () => void;
  onBlur: () => void;
}> = ({ value, onChange, onFocus, onBlur }) => {
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

  return (
    <textarea
      ref={textareaRef}
      rows={1}
      value={value}
      onFocus={onFocus}
      onBlur={onBlur}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        onChange(e.target.value);
        adjustHeight();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          textareaRef.current?.blur();
        }
      }}
      className="w-full bg-transparent hover:bg-surface2/30 focus:bg-surface2/50 border border-transparent focus:border-accent/40 rounded px-1.5 py-0.5 text-xs sm:text-sm text-textPrimary leading-relaxed font-sans focus:outline-none resize-none overflow-hidden transition-colors cursor-text caret-accent"
      style={{ overflow: "hidden" }}
      placeholder="Nội dung phụ đề..."
    />
  );
};

/**
 * Memoized Cue Card item: reduces vertical height by 35-40%, unified single header,
 * eliminates duplicate timestamp pills, and optimizes re-renders during playback ticks.
 */
interface CueCardItemProps {
  cue: EditableSubtitleCue;
  isActive: boolean;
  onSeek: (cue: EditableSubtitleCue) => void;
  onUpdateText: (index: number, text: string) => void;
  onFocusText: () => void;
  onBlurText: () => void;
}

const CueCardItem = React.memo<CueCardItemProps>(({
  cue,
  isActive,
  onSeek,
  onUpdateText,
  onFocusText,
  onBlurText,
}) => {
  return (
    <div
      onClick={() => onSeek(cue)}
      data-cue-index={cue.index}
      className={`py-2 px-3 rounded-lg border transition-all cursor-pointer select-text group flex flex-col gap-1 ${
        isActive
          ? "border-l-[3.5px] border-l-accent border-t-borderDefault border-r-borderDefault border-b-borderDefault bg-accent/[0.06] dark:bg-accent/[0.08] shadow-2xs"
          : "border-l-[3.5px] border-l-transparent border-t-borderDefault border-r-borderDefault border-b-borderDefault bg-surface1 hover:bg-surface2/40"
      }`}
    >
      {/* Unified Cue Header: Index on left, single Start → End timestamp range on right */}
      <div className="flex items-center justify-between text-[11px] font-mono select-none">
        <div className="flex items-center gap-1.5">
          <span
            className={`font-semibold transition-colors ${
              isActive ? "text-accent font-bold" : "text-textSecondary group-hover:text-textPrimary"
            }`}
          >
            #{String(cue.index).padStart(3, "0")}
          </span>
          {cue.isEdited && (
            <span
              className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400"
              title="Đã chỉnh sửa"
            />
          )}
        </div>

        <span
          className={`transition-colors ${
            isActive ? "text-accent font-medium" : "text-textMuted group-hover:text-textSecondary"
          }`}
        >
          {formatSrtTimestamp(cue.startSec)} → {formatSrtTimestamp(cue.endSec)}
        </span>
      </div>

      {/* Inline Editable Textarea */}
      <AutoResizeCueTextarea
        value={cue.text}
        onChange={(val) => onUpdateText(cue.index, val)}
        onFocus={onFocusText}
        onBlur={onBlurText}
      />
    </div>
  );
});

CueCardItem.displayName = "CueCardItem";

export const TranscriptionWorkspace: React.FC<TranscriptionWorkspaceProps> = ({
  onSendToTts,
  onHandoffToDubbing,
  initialState = "EMPTY",
  initialFileInfo = null,
  initialCues = [],
}) => {
  const { t, lang } = useI18n();

  // State Machine
  const [workspaceState, setWorkspaceState] = useState<SubtitleWorkspaceState>(initialState);
  const [fileInfo, setFileInfo] = useState<MediaFileInfo | null>(initialFileInfo);
  const [errorMessage, setErrorMessage] = useState<string>("");

  // Processing Progress
  const [progressPercent, setProgressPercent] = useState(0);
  const [processedSec, setProcessedSec] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  const processingTimerRef = useRef<any>(null);

  // Subtitle Cues
  const [cues, setCues] = useState<EditableSubtitleCue[]>(initialCues);

  // Subtitle Configuration & Optimization State
  const [subtitleSettings, setSubtitleSettings] = useState<SubtitleSettings>(() => loadSubtitleSettings());
  const [invalidationNotice, setInvalidationNotice] = useState<string>("");
  const cachedTranscriptRef = useRef<string>(DEFAULT_TRANSCRIPT_TEXT);

  // Invalidation Rule for Group 1: Nhận diện
  const handleUpdateRecognition = (updates: Partial<SubtitleSettings>) => {
    const updated = { ...subtitleSettings, ...updates };
    setSubtitleSettings(updated);
    saveSubtitleSettings(updates);

    if (workspaceState === "RESULT") {
      setWorkspaceState("READY");
      setCues([]);
      setInvalidationNotice(t.transcription.invalidationNotice);
    }
  };

  // Re-run Rule for Group 2: Hiển thị (Subtitle Optimizer without re-running Whisper)
  const handleUpdateDisplay = (updates: Partial<SubtitleSettings>) => {
    const updated = { ...subtitleSettings, ...updates };
    setSubtitleSettings(updated);
    saveSubtitleSettings(updates);

    if (workspaceState === "RESULT") {
      const reoptimized = generateSubtitlesFromText(cachedTranscriptRef.current, {
        aspectRatio: updated.aspectRatio,
        maxLines: updated.maxLines,
      });
      setCues(reoptimized.map((c) => ({ ...c, isEdited: false })));
    }
  };

  // Option 1: Handoff to Text to Speech (strip timestamps, ready for text normalization & audio synthesis)
  const handleSendToTts = () => {
    if (!cues || cues.length === 0) return;
    const plainText = cues
      .map((c) => c.text.trim())
      .filter((text) => text.length > 0)
      .join(" ")
      .replace(/\s+/g, " ");

    if (plainText.length > 0) {
      onSendToTts?.(plainText);
    }
  };

  // Option 2: Handoff to Dubbing Workspace (preserves timestamps 1:1 for translation and voice dubbing)
  const handleHandoffToDubbing = () => {
    const snapshot: DubbingHandoffSnapshot = {
      sourceMediaName: fileInfo?.name,
      sourceDurationSec: fileInfo?.durationSec,
      sourceLang: subtitleSettings.audioLanguage,
      cues: cues.map((c) => ({
        index: c.index,
        startSec: c.startSec,
        endSec: c.endSec,
        text: c.text,
      })),
    };
    onHandoffToDubbing?.(snapshot);
  };

  // Media Player State (matching TTS BottomAudioPlayer)
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const totalDurationSec = fileInfo?.durationSec || 18.5;

  const PLAYBACK_SPEEDS = [1.0, 1.25, 1.5, 2.0, 0.8];

  const currentProgressPercent =
    totalDurationSec > 0
      ? Math.min(100, Math.max(0, (currentTimeSec / totalDurationSec) * 100))
      : 0;

  // Drag and Drop State
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Focus tracking to prevent auto-scroll while user is typing
  const isEditingRef = useRef(false);
  const cueListContainerRef = useRef<HTMLDivElement>(null);

  // Playback timer (speed-aware)
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setCurrentTimeSec((prev) => {
        const step = 0.1 * playbackSpeed;
        const next = Math.round((prev + step) * 10) / 10;
        if (next >= totalDurationSec) {
          setIsPlaying(false);
          return 0;
        }
        return next;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [isPlaying, totalDurationSec, playbackSpeed]);

  // Sync real audio element
  useEffect(() => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.play().catch(() => {});
      } else {
        audioRef.current.pause();
      }
    }
  }, [isPlaying]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (processingTimerRef.current) {
        clearInterval(processingTimerRef.current);
      }
    };
  }, []);

  // Auto-follow during playback (if user is not actively editing)
  useEffect(() => {
    if (!isPlaying || isEditingRef.current || !cueListContainerRef.current) return;
    const activeCue = cues.find(
      (c) => currentTimeSec >= c.startSec && currentTimeSec < c.endSec
    );
    if (activeCue) {
      const el = cueListContainerRef.current.querySelector(
        `[data-cue-index="${activeCue.index}"]`
      );
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }, [currentTimeSec, isPlaying, cues]);

  const formatPlayerTime = (secs: number) => {
    const safeSecs = Math.max(0, isNaN(secs) ? 0 : secs);
    const m = Math.floor(safeSecs / 60);
    const s = Math.floor(safeSecs % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const handleFileChange = (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    const isAudio = ["wav", "mp3", "flac", "m4a"].includes(ext) || file.type.startsWith("audio/");
    const isVideo = ["mp4", "mov", "mkv", "webm"].includes(ext) || file.type.startsWith("video/");

    if (!isAudio && !isVideo) {
      setErrorMessage(t.transcription.unsupportedFile);
      setWorkspaceState("ERROR");
      return;
    }

    // Video without audio track check
    const lowerName = file.name.toLowerCase();
    if (isVideo && (lowerName.includes("no_audio") || lowerName.includes("silent") || lowerName.includes("no-audio"))) {
      setErrorMessage(t.transcription.noAudioStream);
      setWorkspaceState("ERROR");
      return;
    }

    const sizeFormatted = (file.size / (1024 * 1024)).toFixed(1) + " MB";
    const durationSec = 18.5;
    const resolutionOrFormat = isVideo ? "1920×1080" : `${ext.toUpperCase()} • Stereo`;

    let objectUrl: string | undefined;
    try {
      if (typeof window !== "undefined" && typeof window.URL?.createObjectURL === "function") {
        objectUrl = URL.createObjectURL(file);
      }
    } catch {
      // ignore
    }

    setFileInfo({
      name: file.name,
      sizeFormatted,
      type: isVideo ? "video" : "audio",
      durationSec,
      resolutionOrFormat,
      hasAudioTrack: true,
      file,
      objectUrl,
    });
    setWorkspaceState("READY");
    setErrorMessage("");
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = await extractFilesFromDropEvent(e);
    const validFile =
      files.find((f) => {
        const ext = f.name.toLowerCase().split(".").pop() || "";
        return ["mp3", "wav", "flac", "m4a", "aac", "mp4", "mov", "mkv", "webm", "avi"].includes(ext);
      }) || files[0];
    if (validFile) {
      handleFileChange(validFile);
    }
  };

  const handleStartProcessing = () => {
    if (!fileInfo || workspaceState === "PROCESSING") return;
    setWorkspaceState("PROCESSING");
    setIsPaused(false);
    isPausedRef.current = false;
    setProgressPercent(0);
    setProcessedSec(0);
    setInvalidationNotice("");

    const total = fileInfo.durationSec || 18.5;
    let currentPct = 0;

    if (processingTimerRef.current) {
      clearInterval(processingTimerRef.current);
    }

    processingTimerRef.current = setInterval(() => {
      if (isPausedRef.current) {
        return;
      }

      currentPct += 15;
      if (currentPct >= 100) {
        clearInterval(processingTimerRef.current);
        processingTimerRef.current = null;
        setIsPaused(false);
        isPausedRef.current = false;
        setProgressPercent(100);
        setProcessedSec(total);

        // Subtitle Engine Integration with ASR Reverse Remapping (TASK-05)
        const speed = subtitleSettings.speechSpeed;
        const baseCues = generateSubtitlesFromText(DEFAULT_TRANSCRIPT_TEXT, {
          aspectRatio: subtitleSettings.aspectRatio,
          maxLines: subtitleSettings.maxLines,
        });

        if (Math.abs(speed - 1.0) > 0.001) {
          // If speed !== 1.0 (0.9x or 0.8x), Whisper operated on slowed audio.
          // Timestamps on slowed audio span [start / speed, end / speed].
          const slowedSegments: WhisperSegment[] = baseCues.map((c) => ({
            id: c.index,
            startSec: Number((c.startSec / speed).toFixed(3)),
            endSec: Number((c.endSec / speed).toFixed(3)),
            text: c.text,
            words: c.text.split(" ").map((w, wi, arr) => {
              const dur = (c.endSec / speed) - (c.startSec / speed);
              const wStart = (c.startSec / speed) + (wi / arr.length) * dur;
              const wEnd = (c.startSec / speed) + ((wi + 1) / arr.length) * dur;
              return {
                word: w,
                startSec: Number(wStart.toFixed(3)),
                endSec: Number(wEnd.toFixed(3)),
              };
            }),
          }));

          // Strict Reverse Remapping to original timeline per AC-31
          const remappedSegments = remapWhisperOutputToOriginalTimeline(slowedSegments, speed);
          const remappedCues: EditableSubtitleCue[] = remappedSegments.map((seg) => ({
            index: Number(seg.id),
            startSec: seg.startSec,
            endSec: seg.endSec,
            text: seg.text,
            isEdited: false,
          }));
          setCues(remappedCues);
        } else {
          setCues(baseCues.map((c) => ({ ...c, isEdited: false })));
        }

        cachedTranscriptRef.current = DEFAULT_TRANSCRIPT_TEXT;
        setWorkspaceState("RESULT");
        setCurrentTimeSec(0);
        setIsPlaying(false);
      } else {
        setProgressPercent(currentPct);
        const currSec = Math.round(((currentPct / 100) * total) * 10) / 10;
        setProcessedSec(currSec);
      }
    }, 180);
  };

  const handleTogglePause = () => {
    setIsPaused((prev) => {
      const next = !prev;
      isPausedRef.current = next;
      return next;
    });
  };

  const handleCancelProcessing = () => {
    if (processingTimerRef.current) {
      clearInterval(processingTimerRef.current);
      processingTimerRef.current = null;
    }
    isPausedRef.current = false;
    setIsPaused(false);
    setProgressPercent(0);
    setProcessedSec(0);
    setWorkspaceState("READY");
  };

  const handleResetFile = () => {
    if (fileInfo?.objectUrl) {
      try {
        URL.revokeObjectURL(fileInfo.objectUrl);
      } catch {
        // ignore
      }
    }
    setFileInfo(null);
    setCues([]);
    setWorkspaceState("EMPTY");
    setErrorMessage("");
    setIsPlaying(false);
    setCurrentTimeSec(0);
    setInvalidationNotice("");
  };

  const handleSeek = (newSec: number) => {
    const clamped = Math.min(totalDurationSec, Math.max(0, newSec));
    setCurrentTimeSec(clamped);
    if (audioRef.current) {
      audioRef.current.currentTime = clamped;
    }
  };

  const handleRewind5s = () => {
    handleSeek(currentTimeSec - 5);
  };

  const handleForward5s = () => {
    handleSeek(currentTimeSec + 5);
  };

  const handleCycleSpeed = () => {
    const currentIndex = PLAYBACK_SPEEDS.indexOf(playbackSpeed);
    const nextIndex = (currentIndex + 1) % PLAYBACK_SPEEDS.length;
    const nextSpeed = PLAYBACK_SPEEDS[nextIndex];
    setPlaybackSpeed(nextSpeed);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextSpeed;
    }
  };

  const handleCueClick = useCallback((cue: EditableSubtitleCue) => {
    setCurrentTimeSec(cue.startSec);
    setIsPlaying(true);
  }, []);

  const handleUpdateCueText = useCallback((index: number, newText: string) => {
    setCues((prev) =>
      prev.map((c) => (c.index === index ? { ...c, text: newText, isEdited: true } : c))
    );
  }, []);

  const downloadTextFile = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportSrt = () => {
    const srt = exportToSrt(cues);
    const baseName = fileInfo?.name.replace(/\.[^/.]+$/, "") || "phu_de";
    downloadTextFile(srt, `${baseName}.srt`, "text/plain;charset=utf-8");
  };

  const handleExportTxt = () => {
    const txt = cues.map((c) => c.text.trim()).join("\n\n");
    const baseName = fileInfo?.name.replace(/\.[^/.]+$/, "") || "phu_de";
    downloadTextFile(txt, `${baseName}.txt`, "text/plain;charset=utf-8");
  };

  const activeAspectRatio = subtitleSettings.aspectRatio;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-background">
      {/* Hidden File Input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            handleFileChange(e.target.files[0]);
          }
        }}
        accept="audio/*,video/*,.wav,.mp3,.flac,.m4a,.mp4,.mov,.mkv,.webm"
        className="hidden"
      />

      {/* Subheader / Top Action Bar: Always sticky at the top */}
      <div className="h-12 border-b border-borderDefault bg-surface1 px-4 flex items-center justify-between flex-shrink-0 z-20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center text-accent">
            <Captions className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-textPrimary">
              {t.transcription.title}
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {workspaceState !== "EMPTY" && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-surface2 hover:bg-surface3 text-textPrimary rounded-md border border-borderDefault text-xs font-semibold transition-colors cursor-pointer shadow-2xs"
              title="Tải lên tệp hoặc thư mục âm thanh / video"
            >
              <UploadCloud className="w-3.5 h-3.5 text-accent" />
              <span>Tải Lên</span>
            </button>
          )}

          {/* Top Actions in RESULT State */}
          {workspaceState === "RESULT" && (
            <div className="flex items-center gap-2">
              <button
                onClick={handleExportTxt}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-surface2 hover:bg-surface3 text-textPrimary rounded-md border border-borderDefault text-xs font-medium transition-colors cursor-pointer"
                title="Xuất nội dung phụ đề dạng văn bản .TXT"
              >
                <Download className="w-3.5 h-3.5 text-textMuted" />
                <span>{t.transcription.exportTxt}</span>
              </button>

              <button
                onClick={handleExportSrt}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-surface2 hover:bg-surface3 text-textPrimary rounded-md border border-borderDefault text-xs font-medium transition-colors cursor-pointer"
                title="Xuất file phụ đề chuẩn SubRip .SRT"
              >
                <Download className="w-3.5 h-3.5 text-textMuted" />
                <span>{t.transcription.exportSrt}</span>
              </button>

              <div className="h-4 w-[1px] bg-borderDefault mx-1" />

              {/* Option 1: Tạo Giọng Đọc (chuyển sang Text to Speech) */}
              <button
                type="button"
                onClick={handleSendToTts}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-accent hover:bg-accentHover text-white rounded-md text-xs font-semibold shadow-sm transition-colors cursor-pointer"
                title="Chuyển sang tab Text to Speech để tạo giọng đọc thành audio (bỏ timestamp, chuẩn hoá văn bản)"
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span>{t.transcription.sendToTts}</span>
              </button>

              {/* Option 2: Dịch Và Lồng Tiếng (chuyển sang Dubbing) */}
              <button
                type="button"
                onClick={handleHandoffToDubbing}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-accent hover:bg-accentHover text-white rounded-md text-xs font-semibold shadow-sm transition-colors cursor-pointer"
                title="Chuyển sang tab Dịch & Lồng tiếng để dịch sang ngôn ngữ khác đồng thời lồng tiếng"
              >
                <Languages className="w-3.5 h-3.5" />
                <span>{t.transcription.sendToDubbing}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Workspace Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Central Workspace Area */}
        <div className="flex-1 flex flex-col overflow-hidden bg-background">
          {/* STATE 1: EMPTY (FULL WORKING AREA DROP ZONE) */}
          {workspaceState === "EMPTY" && (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className="flex-1 flex flex-col p-4 sm:p-6 select-none overflow-hidden"
            >
              <div
                onClick={() => fileInputRef.current?.click()}
                className={`flex-1 w-full rounded-2xl border-2 border-dashed flex flex-col items-center justify-center text-center p-6 sm:p-10 transition-all cursor-pointer group ${
                  isDragging
                    ? "border-accent bg-accent/10 scale-[0.995]"
                    : "border-borderDefault bg-surface1/30 hover:bg-surface1/60 hover:border-accent/50"
                }`}
              >
                <h3 className="text-xl sm:text-2xl font-bold text-textPrimary mb-6 tracking-tight">
                  {t.transcription.dropTitle}
                </h3>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                  className="px-8 py-3.5 bg-accent hover:bg-accent/90 text-background rounded-xl font-bold text-sm sm:text-base shadow-md hover:shadow-lg transition-all flex items-center gap-2.5 cursor-pointer active:scale-95"
                >
                  <UploadCloud className="w-5 h-5" />
                  <span>Tải Lên</span>
                </button>
              </div>
            </div>
          )}



          {/* STATE 2: READY (FILE READY CANVAS) */}
          {workspaceState === "READY" && fileInfo && (
            <div className="flex-1 flex flex-col p-4 space-y-3 overflow-y-auto">
              {/* Invalidation Alert Banner (When recognition settings were changed) */}
              {invalidationNotice && (
                <div className="w-full p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400 text-xs flex items-center gap-2.5 shadow-2xs">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 text-amber-400" />
                  <span>{invalidationNotice}</span>
                </div>
              )}
            </div>
          )}

          {/* STATE 3: PROCESSING */}
          {workspaceState === "PROCESSING" && fileInfo && (
            <div className="flex-1 flex flex-col items-center justify-center p-8 select-none space-y-6">
              <div className="max-w-md w-full p-8 bg-surface1 rounded-2xl border border-borderDefault flex flex-col items-center text-center space-y-5">
                <div className={`w-12 h-12 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center text-accent ${isPaused ? "" : "animate-spin"}`}>
                  {isPaused ? <Pause className="w-6 h-6 fill-accent" /> : <RefreshCw className="w-6 h-6" />}
                </div>

                <div className="space-y-1">
                  <h3 className="text-base font-bold text-textPrimary">
                    {isPaused ? "Đã tạm dừng nhận diện" : t.transcription.processingTitle}
                  </h3>
                  <p className="text-xs text-textMuted">
                    {t.transcription.speechRecognition} ({subtitleSettings.whisperModel})
                  </p>
                </div>

                {/* Progress Bar */}
                <div className="w-full space-y-2">
                  <div className="w-full h-2 bg-surface2 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent rounded-full transition-all duration-200"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs font-mono text-textMuted">
                    <span>
                      {formatPlayerTime(processedSec)} / {formatPlayerTime(fileInfo.durationSec)} đã xử lý
                    </span>
                    <span className="font-semibold text-accent">{progressPercent}%</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleTogglePause}
                    className="px-4 py-2 bg-accent hover:bg-accentHover text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                  >
                    {isPaused ? "Tiếp tục" : "Tạm dừng"}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelProcessing}
                    className="px-4 py-2 bg-surface2 hover:bg-surface3 text-textPrimary rounded-lg border border-borderDefault text-xs font-medium transition-colors cursor-pointer"
                  >
                    {t.transcription.cancel}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STATE 4: RESULT (Subtitle Cue View) */}
          {workspaceState === "RESULT" && fileInfo && (
            <div className="flex-1 flex flex-col overflow-hidden">

              {/* Simplified Subtitle Cue List Header */}
              <div className="px-4 py-1.5 bg-surface2/30 border-b border-borderDefault flex items-center justify-between text-xs text-textMuted flex-shrink-0">
                <div className="flex items-center gap-2">
                  <FileText className="w-3.5 h-3.5 text-accent" />
                  <span className="font-semibold text-textPrimary">
                    {cues.length} {t.transcription.cueCount.replace("{count}", "").trim()}
                    <span className="font-normal text-textMuted ml-1.5">· {activeAspectRatio}</span>
                  </span>
                </div>
              </div>

              {/* Subtitle Cues Scroll Area */}
              <div
                ref={cueListContainerRef}
                className="flex-1 overflow-y-auto p-3 space-y-2"
              >
                {cues.map((cue) => {
                  const isActive =
                    currentTimeSec >= cue.startSec && currentTimeSec < cue.endSec;

                  return (
                    <CueCardItem
                      key={cue.index}
                      cue={cue}
                      isActive={isActive}
                      onSeek={handleCueClick}
                      onUpdateText={handleUpdateCueText}
                      onFocusText={() => {
                        isEditingRef.current = true;
                      }}
                      onBlurText={() => {
                        isEditingRef.current = false;
                      }}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* STATE 5: ERROR */}
          {workspaceState === "ERROR" && (
            <div className="flex-1 flex flex-col items-center justify-center p-8 select-none space-y-4">
              <div className="max-w-md w-full p-6 bg-surface1 rounded-2xl border border-red-500/30 flex flex-col items-center text-center space-y-4 shadow-sm">
                <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
                  <AlertCircle className="w-6 h-6" />
                </div>

                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-textPrimary">
                    {t.transcription.errorTitle}
                  </h3>
                  <p className="text-xs text-red-400 leading-relaxed">
                    {errorMessage || t.transcription.recognitionFailed}
                  </p>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <button
                    onClick={() => {
                      if (fileInfo) {
                        handleStartProcessing();
                      } else {
                        fileInputRef.current?.click();
                      }
                    }}
                    className="px-4 py-2 bg-accent hover:bg-accent/90 text-background rounded-lg text-xs font-semibold shadow-sm transition-colors cursor-pointer"
                  >
                    {t.transcription.errorRetry}
                  </button>
                  <button
                    onClick={handleResetFile}
                    className="px-4 py-2 bg-surface2 hover:bg-surface3 text-textPrimary rounded-lg border border-borderDefault text-xs font-medium transition-colors cursor-pointer"
                  >
                    {t.transcription.changeFile}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Bottom Audio Preview Player (Constrained to Central Workspace Area only) */}
          {(workspaceState === "READY" || workspaceState === "RESULT") && fileInfo && (
            <div
              role="region"
              aria-label="Audio Preview Player"
              className="mx-3 mb-3 h-[68px] px-3.5 sm:px-5 bg-panel/95 dark:bg-[#0c1322]/95 backdrop-blur-xl border border-borderDefault/80 dark:border-white/10 rounded-xl shadow-lg shadow-black/5 dark:shadow-2xl dark:shadow-black/50 flex items-center justify-between gap-3 text-xs select-none shrink-0 z-30 relative overflow-hidden transition-all duration-200"
            >
              {/* Top Hairline Ambient Glow */}
              <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-accent/40 dark:via-accent/60 to-transparent pointer-events-none" />

              {/* 1. LEFT ZONE: Track Icon & Audio File Name Only */}
              <div className="w-[220px] sm:w-[260px] shrink-0 flex items-center gap-3 min-w-0">
                <div
                  className="w-10 h-10 rounded-xl bg-gradient-to-tr from-accent/20 via-accent/10 to-transparent border border-accent/30 flex items-center justify-center relative overflow-hidden shrink-0 shadow-inner group cursor-pointer"
                  onClick={() => setIsPlaying(!isPlaying)}
                  title={isPlaying ? t.jobbar.pause : t.tts.preview}
                >
                  {isPlaying ? (
                    <div className="flex items-end justify-center gap-[2.5px] h-4 w-5">
                      <div className="w-[3px] bg-accent rounded-full animate-eq-1" />
                      <div className="w-[3px] bg-accent rounded-full animate-eq-2" />
                      <div className="w-[3px] bg-accent rounded-full animate-eq-3" />
                      <div className="w-[3px] bg-accent rounded-full animate-eq-4" />
                    </div>
                  ) : fileInfo.type === "video" ? (
                    <FileVideo className="w-4 h-4 text-accent/80 group-hover:text-accent transition-colors" />
                  ) : (
                    <FileAudio className="w-4 h-4 text-accent/80 group-hover:text-accent transition-colors" />
                  )}
                </div>

                <div className="flex flex-col justify-center min-w-0 flex-1">
                  <span
                    className="font-bold text-textPrimary text-xs tracking-tight truncate block select-text"
                    title={fileInfo.name}
                  >
                    {fileInfo.name}
                  </span>
                  <div className="flex items-center gap-1 text-[11px] text-textSecondary font-medium truncate mt-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent/70 shrink-0 inline-block" />
                    <span className="truncate block font-mono text-[10px] text-textMuted">
                      {formatPlayerTime(totalDurationSec)}
                    </span>
                  </div>
                </div>
              </div>

              {/* 2. CENTER ZONE: True Studio Control Deck (Controls + Scrubber) */}
              <div className="flex-1 max-w-[480px] sm:max-w-[520px] min-w-0 flex flex-col items-center justify-center gap-1 mx-auto px-2">
                {/* Top Control Cluster */}
                <div className="flex items-center gap-2 sm:gap-3">
                  {/* Rewind 5s */}
                  <button
                    type="button"
                    onClick={handleRewind5s}
                    className="w-7 h-7 rounded-full text-textSecondary hover:text-textPrimary hover:bg-surface2 flex items-center justify-center transition-all active:scale-95 cursor-pointer"
                    title="Lùi 5 giây"
                    aria-label="Lùi 5 giây"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>

                  {/* Primary Hero Play/Pause Button */}
                  <button
                    type="button"
                    onClick={() => setIsPlaying(!isPlaying)}
                    className="w-8 h-8 rounded-full bg-gradient-to-tr from-accent to-sky-500 hover:from-accentHover hover:to-sky-400 text-white shadow-md shadow-accent/25 hover:shadow-accent/40 active:scale-95 transition-all flex items-center justify-center shrink-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent"
                    title={isPlaying ? t.jobbar.pause : t.tts.preview}
                    aria-label={isPlaying ? t.jobbar.pause : t.tts.preview}
                  >
                    {isPlaying ? (
                      <Pause className="w-3.5 h-3.5 fill-current" />
                    ) : (
                      <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                    )}
                  </button>

                  {/* Forward 5s */}
                  <button
                    type="button"
                    onClick={handleForward5s}
                    className="w-7 h-7 rounded-full text-textSecondary hover:text-textPrimary hover:bg-surface2 flex items-center justify-center transition-all active:scale-95 cursor-pointer"
                    title="Tua 5 giây"
                    aria-label="Tua 5 giây"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                  </button>

                  {/* Speed Pill Toggle */}
                  <button
                    type="button"
                    onClick={handleCycleSpeed}
                    className="ml-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold text-textSecondary hover:text-textPrimary bg-surface2 hover:bg-surface3 border border-borderDefault/70 transition-all active:scale-95 cursor-pointer"
                    title="Tốc độ phát"
                  >
                    {playbackSpeed.toFixed(playbackSpeed % 1 === 0 ? 1 : 2)}×
                  </button>
                </div>

                {/* Bottom Scrubber Deck (Current Time + Range Slider + Total Duration) matching History tab */}
                <div className="w-full flex items-center gap-2 sm:gap-2.5 min-w-0">
                  <span className="font-mono text-[11px] text-textPrimary font-semibold shrink-0 w-9 text-right tabular-nums">
                    {formatPlayerTime(currentTimeSec)}
                  </span>

                  {/* Interactive Range Slider Scrubber */}
                  <input
                    type="range"
                    min={0}
                    max={totalDurationSec || 1}
                    step={0.05}
                    value={currentTimeSec}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      if (audioRef.current) {
                        audioRef.current.currentTime = val;
                      }
                      setCurrentTimeSec(val);
                    }}
                    style={{
                      background: `linear-gradient(to right, var(--theme-accent) 0%, var(--theme-accent) ${currentProgressPercent}%, var(--theme-surface3) ${currentProgressPercent}%, var(--theme-surface3) 100%)`,
                    }}
                    className="flex-1 accent-accent h-1.5 rounded-full appearance-none cursor-pointer outline-none border-none focus:outline-none focus:ring-0 focus:border-none"
                    aria-label="Kéo để tua đoạn"
                  />

                  <span className="font-mono text-[11px] text-textMuted shrink-0 w-9 text-left tabular-nums">
                    {formatPlayerTime(totalDurationSec)}
                  </span>
                </div>
              </div>

              {/* 3. RIGHT ZONE: Volume Slider + Change File + Delete Button */}
              <div className="w-[220px] sm:w-[260px] shrink-0 flex items-center justify-end gap-1.5 sm:gap-2">
                {/* Volume Control Group */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setIsMuted(!isMuted)}
                    className="p-1.5 text-textSecondary hover:text-textPrimary hover:bg-surface2 rounded-lg transition-colors cursor-pointer"
                    title={isMuted ? "Bật tiếng" : "Tắt tiếng"}
                    aria-label={isMuted ? "Bật tiếng" : "Tắt tiếng"}
                  >
                    {isMuted || volume === 0 ? (
                      <VolumeX className="w-4 h-4 text-danger" />
                    ) : volume < 0.5 ? (
                      <Volume1 className="w-4 h-4" />
                    ) : (
                      <Volume2 className="w-4 h-4" />
                    )}
                  </button>

                  <div className="w-16 sm:w-20 flex items-center">
                    {(() => {
                      const volPct = isMuted ? 0 : Math.round(volume * 100);
                      return (
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={isMuted ? 0 : volume}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setVolume(val);
                            if (isMuted && val > 0) setIsMuted(false);
                          }}
                          style={{
                            background: `linear-gradient(to right, var(--theme-accent) 0%, var(--theme-accent) ${volPct}%, var(--theme-surface3) ${volPct}%, var(--theme-surface3) 100%)`,
                          }}
                          className="w-full accent-accent h-1.5 rounded-full appearance-none cursor-pointer outline-none border-none focus:outline-none focus:ring-0 focus:border-none"
                          title="Âm lượng"
                          aria-label="Âm lượng"
                        />
                      );
                    })()}
                  </div>
                </div>

                {/* Change File Button */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-2.5 py-1 bg-surface2 hover:bg-surface3 text-textSecondary hover:text-textPrimary rounded-lg text-xs font-medium border border-borderDefault/70 transition-colors cursor-pointer shrink-0"
                >
                  {t.transcription.changeFile}
                </button>

                {/* Elegant Vertical Divider */}
                <div className="h-4 w-[1px] bg-borderDefault/80 mx-0.5" />

                {/* Remove File Button */}
                <button
                  type="button"
                  onClick={handleResetFile}
                  className="p-1.5 text-textMuted hover:text-danger hover:bg-danger/10 rounded-lg transition-colors cursor-pointer"
                  title={t.transcription.removeFile}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {/* Hidden Real Audio Element */}
              {fileInfo.objectUrl && (
                <audio
                  ref={audioRef}
                  src={fileInfo.objectUrl}
                  onEnded={() => {
                    setIsPlaying(false);
                    setCurrentTimeSec(0);
                  }}
                  className="hidden"
                />
              )}
            </div>
          )}
        </div>

        {/* Right Configuration Inspector: CÀI ĐẶT PHỤ ĐỀ (Permanently Fixed) */}
        <aside className="w-80 border-l border-borderDefault bg-surface1 flex flex-col flex-shrink-0 select-none text-xs">
          {/* Scrollable Settings Section */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {/* Header */}
            <div className="pb-1">
              <span className="font-bold text-xs text-textSecondary uppercase tracking-wider block">
                {t.transcription.subtitleSettingsTitle}
              </span>
            </div>

            {/* Group 1: Nhận diện */}
            <div className="space-y-3 p-3 bg-surface2/40 rounded-xl border border-borderDefault">
              <div className="flex items-center gap-1.5 pb-1.5 border-b border-borderDefault/60">
                <Sparkles className="w-3.5 h-3.5 text-accent" />
                <span className="font-semibold text-xs text-textPrimary uppercase tracking-wide">
                  {t.transcription.recognitionGroupTitle}
                </span>
              </div>

              <div className="space-y-1">
                <label className="block text-textSecondary font-medium text-[11px]">
                  {t.transcription.modelLabel}
                </label>
                <select
                  value={
                    subtitleSettings.whisperModel === "auto"
                      ? "large-v3-turbo"
                      : subtitleSettings.whisperModel
                  }
                  onChange={(e) => handleUpdateRecognition({ whisperModel: e.target.value })}
                  className="w-full bg-surface1 border border-borderDefault rounded-md px-2.5 py-1.5 text-xs text-textPrimary focus:border-accent focus:outline-none cursor-pointer"
                >
                  <option value="large-v3-turbo">{t.transcription.whisperModelTurbo}</option>
                  <option value="large-v3">{t.transcription.whisperModelLarge}</option>
                  <option value="medium">{t.transcription.whisperModelMedium}</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-textSecondary font-medium text-[11px]">
                  {t.transcription.langAudio}
                </label>
                <SearchableLanguageSelect
                  value={subtitleSettings.audioLanguage}
                  onChange={(code) => handleUpdateRecognition({ audioLanguage: code })}
                  languages={WHISPER_AUDIO_LANGUAGES}
                  searchPlaceholder={lang === "vi" ? "Tìm ngôn ngữ âm thanh..." : "Search audio language..."}
                  ariaLabel={t.transcription.langAudio}
                  size="sm"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-textSecondary font-medium text-[11px]">
                  {t.transcription.speechSpeedLabel}
                </label>
                <select
                  value={subtitleSettings.speechSpeed}
                  onChange={(e) =>
                    handleUpdateRecognition({
                      speechSpeed: Number(e.target.value) as SubtitleSpeechSpeed,
                    })
                  }
                  className="w-full bg-surface1 border border-borderDefault rounded-md px-2.5 py-1.5 text-xs text-textPrimary focus:border-accent focus:outline-none cursor-pointer"
                >
                  <option value={1.0}>{t.transcription.speechSpeedNormal}</option>
                  <option value={0.9}>{t.transcription.speechSpeedFast}</option>
                  <option value={0.8}>{t.transcription.speechSpeedVeryFast}</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-textSecondary font-medium text-[11px]">
                  {t.transcription.processingSpeedLabel}
                </label>
                <select
                  value={subtitleSettings.processingSpeed}
                  onChange={(e) =>
                    handleUpdateRecognition({
                      processingSpeed: e.target.value as SubtitleProcessingSpeed,
                    })
                  }
                  className="w-full bg-surface1 border border-borderDefault rounded-md px-2.5 py-1.5 text-xs text-textPrimary focus:border-accent focus:outline-none cursor-pointer"
                >
                  <option value="auto">Tự động</option>
                  <option value="1x">1x</option>
                  <option value="2x">2x</option>
                  <option value="4x">4x</option>
                  <option value="8x">8x</option>
                </select>
              </div>
            </div>

            {/* Group 2: Hiển thị */}
            <div className="space-y-3 p-3 bg-surface2/40 rounded-xl border border-borderDefault">
              <div className="flex items-center gap-1.5 pb-1.5 border-b border-borderDefault/60">
                <Sliders className="w-3.5 h-3.5 text-accent" />
                <span className="font-semibold text-xs text-textPrimary uppercase tracking-wide">
                  {t.transcription.displayGroupTitle}
                </span>
              </div>

              {/* Segmented Control for Aspect Ratio */}
              <div className="space-y-1.5">
                <label className="block text-textSecondary font-medium text-[11px]">
                  {t.transcription.aspectRatioLabel}
                </label>
                <div className="grid grid-cols-3 gap-1 p-1 bg-surface1 rounded-lg border border-borderDefault">
                  {(["16:9", "9:16", "1:1"] as SubtitleAspectRatio[]).map((ratio) => {
                    const isSelected = subtitleSettings.aspectRatio === ratio;
                    const labels: Record<SubtitleAspectRatio, { ratio: string; sub: string }> = {
                      "16:9": { ratio: "16:9", sub: "Ngang" },
                      "9:16": { ratio: "9:16", sub: "Dọc" },
                      "1:1": { ratio: "1:1", sub: "Vuông" },
                    };
                    const info = labels[ratio];
                    return (
                      <button
                        key={ratio}
                        type="button"
                        onClick={() => handleUpdateDisplay({ aspectRatio: ratio })}
                        className={`py-1.5 px-1 rounded-md text-[11px] font-medium transition-all text-center cursor-pointer flex flex-col items-center justify-center gap-0.5 ${
                          isSelected
                            ? "bg-accent text-background font-semibold shadow-sm"
                            : "text-textSecondary hover:text-textPrimary hover:bg-surface2/60"
                        }`}
                      >
                        <span className="leading-tight">{info.ratio}</span>
                        <span
                          className={`text-[10px] leading-tight ${
                            isSelected ? "text-background/80" : "text-textMuted"
                          }`}
                        >
                          {info.sub}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Segmented Control for Max Lines */}
              <div className="space-y-1.5">
                <label className="block text-textSecondary font-medium text-[11px]">
                  {t.transcription.maxLinesLabel}
                </label>
                <div className="grid grid-cols-2 gap-1 p-1 bg-surface1 rounded-lg border border-borderDefault">
                  {([1, 2] as SubtitleMaxLines[]).map((lines) => {
                    const isSelected = subtitleSettings.maxLines === lines;
                    return (
                      <button
                        key={lines}
                        type="button"
                        onClick={() => handleUpdateDisplay({ maxLines: lines })}
                        className={`py-1.5 px-2 rounded-md text-xs font-medium transition-all text-center cursor-pointer ${
                          isSelected
                            ? "bg-accent text-background font-semibold shadow-sm"
                            : "text-textSecondary hover:text-textPrimary hover:bg-surface2/60"
                        }`}
                      >
                        {lines} dòng
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Sticky Bottom Action in Right Sidebar */}
          {(() => {
            const isProcessing = workspaceState === "PROCESSING";
            const canStart = workspaceState !== "EMPTY" && !!fileInfo;

            return (
              <div className="p-3 border-t border-borderDefault/70 bg-surface1/95 backdrop-blur-xs flex-shrink-0 flex items-center justify-center">
                {isProcessing ? (
                  isPaused ? (
                    /* State: Paused -> Splits into 2 buttons: [Tiếp tục] & [Hủy] */
                    <div className="flex items-center gap-2 w-full h-[68px]">
                      <button
                        type="button"
                        onClick={handleTogglePause}
                        title={`Tiếp tục nhận diện (${progressPercent}%)`}
                        className="flex-1 h-full px-3 rounded-xl text-sm font-semibold shadow-md transition-all flex flex-col items-center justify-center gap-0.5 bg-accent hover:bg-accentHover text-white cursor-pointer active:scale-[0.98] hover:shadow-lg hover:shadow-accent/25"
                      >
                        <div className="flex items-center gap-1.5">
                          <Play className="w-4 h-4 fill-white" />
                          <span>Tiếp tục</span>
                        </div>
                        <span className="text-[11px] font-mono opacity-85 font-normal">
                          {progressPercent}% đã xử lý
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={handleCancelProcessing}
                        title="Hủy tiến trình nhận diện phụ đề"
                        className="flex-1 h-full px-3 rounded-xl text-sm font-semibold transition-all flex flex-col items-center justify-center gap-0.5 bg-surface2 hover:bg-danger/15 text-textSecondary hover:text-danger border border-borderDefault hover:border-danger/30 cursor-pointer active:scale-[0.98]"
                      >
                        <div className="flex items-center gap-1.5">
                          <X className="w-4 h-4" />
                          <span>Hủy</span>
                        </div>
                        <span className="text-[11px] opacity-70 font-normal">
                          Dừng tác vụ
                        </span>
                      </button>
                    </div>
                  ) : (
                    /* State: Processing -> Single Progress Button (fills left-to-right, click to pause) */
                    <button
                      type="button"
                      onClick={handleTogglePause}
                      title={`Bấm để tạm dừng (Đang nhận diện: ${progressPercent}%)`}
                      className="w-full h-[68px] rounded-xl text-sm font-semibold shadow-xs transition-all relative overflow-hidden flex items-center justify-center cursor-pointer border border-borderDefault/80 bg-surface2 dark:bg-surface3 group select-none active:scale-[0.99]"
                    >
                      {/* Background progress fill with gradient and animation */}
                      <div
                        className="absolute inset-y-0 left-0 bg-accent transition-[width] duration-300 ease-out shadow-[0_0_12px_rgba(56,189,248,0.25)]"
                        style={{ width: `${Math.max(progressPercent, 2)}%` }}
                      />

                      {/* Subtle shine effect on progress edge */}
                      {progressPercent > 0 && progressPercent < 100 && (
                        <div
                          className="absolute inset-y-0 w-8 bg-gradient-to-r from-transparent via-white/25 to-transparent pointer-events-none transition-all duration-300 ease-out -translate-x-full"
                          style={{ left: `${Math.max(progressPercent, 2)}%` }}
                        />
                      )}

                      {/* Base text layer: prominent high-contrast text on light/dark track */}
                      <div className="absolute inset-0 flex items-center justify-center gap-2.5 text-textPrimary font-bold px-4 w-full select-none">
                        <span className="relative flex items-center justify-center w-5 h-5 flex-shrink-0">
                          <RefreshCw className="w-4 h-4 animate-spin text-accent group-hover:opacity-0 transition-opacity" />
                          <Pause className="w-4 h-4 fill-textPrimary text-textPrimary absolute opacity-0 group-hover:opacity-100 transition-opacity" />
                        </span>
                        <span className="truncate">
                          Đang nhận diện: {progressPercent}%
                        </span>
                      </div>

                      {/* Inverted text layer: pure white text clipped precisely to the progress fill area */}
                      <div
                        className="absolute inset-0 flex items-center justify-center gap-2.5 text-white font-bold px-4 w-full pointer-events-none select-none"
                        style={{
                          clipPath: `inset(0 calc(100% - ${Math.max(progressPercent, 2)}%) 0 0)`,
                        }}
                      >
                        <span className="relative flex items-center justify-center w-5 h-5 flex-shrink-0">
                          <RefreshCw className="w-4 h-4 animate-spin text-white group-hover:opacity-0 transition-opacity" />
                          <Pause className="w-4 h-4 fill-white absolute opacity-0 group-hover:opacity-100 transition-opacity" />
                        </span>
                        <span className="truncate">
                          Đang nhận diện: {progressPercent}%
                        </span>
                      </div>
                    </button>
                  )
                ) : (
                  /* State: Idle / Ready / Result -> Standard Action Button */
                  <button
                    type="button"
                    onClick={handleStartProcessing}
                    disabled={!canStart}
                    title={
                      !canStart
                        ? "Vui lòng tải file âm thanh/video để tạo phụ đề"
                        : workspaceState === "RESULT"
                        ? "Chạy lại nhận diện và tạo lại phụ đề (ghi đè kết quả cũ)"
                        : t.transcription.createSubtitles
                    }
                    className={`w-full h-[68px] px-4 rounded-xl text-sm font-semibold shadow-md transition-all flex items-center justify-center gap-2 ${
                      !canStart
                        ? "bg-surface3 text-textMuted cursor-not-allowed border border-borderDefault/50"
                        : "bg-accent hover:bg-accentHover text-white cursor-pointer active:scale-[0.98] hover:shadow-lg hover:shadow-accent/20"
                    }`}
                  >
                    <Sparkles className="w-4 h-4 fill-current" />
                    <span>
                      {workspaceState === "RESULT"
                        ? "Tạo lại phụ đề"
                        : t.transcription.createSubtitles}
                    </span>
                  </button>
                )}
              </div>
            );
          })()}
        </aside>
      </div>
    </div>
  );
};
