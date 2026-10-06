import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  X,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  FolderOpen,
  FileAudio,
  Captions,
  Copy,
  Check,
  Search,
  AlertTriangle,
  Info,
} from "lucide-react";
import {
  UnifiedHistoryItem,
  HistoryArtifactItem,
  HistorySubtitleCue,
} from "../../types/history";

export interface ResultPreviewDrawerProps {
  isOpen: boolean;
  job: UnifiedHistoryItem;
  initialArtifactId?: string;
  onClose: () => void;
  onOpenFile?: (filePath: string) => void;
  onOpenFolder?: (folderPath: string) => void;
}

// Helper to parse SRT/VTT timestamp string to seconds
export function parseTimestampToSeconds(ts: string): { startSec: number; endSec: number } | null {
  if (!ts) return null;
  const parts = ts.split(/-->|→/);
  if (parts.length < 2) return null;

  const parsePart = (p: string) => {
    const clean = p.trim().replace(",", ".");
    const segs = clean.split(":");
    if (segs.length === 3) {
      return parseFloat(segs[0]) * 3600 + parseFloat(segs[1]) * 60 + parseFloat(segs[2]);
    }
    if (segs.length === 2) {
      return parseFloat(segs[0]) * 60 + parseFloat(segs[1]);
    }
    return parseFloat(clean) || 0;
  };

  const start = parsePart(parts[0]);
  const end = parsePart(parts[1]);
  return { startSec: Math.max(0, start), endSec: Math.max(start, end) };
}

// Format seconds to mm:ss
export function formatSeconds(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export const ResultPreviewDrawer: React.FC<ResultPreviewDrawerProps> = ({
  isOpen,
  job,
  initialArtifactId,
  onClose,
  onOpenFile: _onOpenFile,
  onOpenFolder,
}) => {
  // 1. Unified Selected Artifact State
  const [selectedArtifactId, setSelectedArtifactId] = useState<string>("");

  // 2. Audio Playback State
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSec, setPlaybackSec] = useState<number>(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [volume, setVolume] = useState<number>(80);

  // 3. Audio "Bật Phụ Đề" State
  const [listenWithSubtitles, setListenWithSubtitles] = useState<boolean>(false);
  const [attachedSubtitleId, setAttachedSubtitleId] = useState<string>("");

  // 4. Subtitle Viewer Search & Copy State
  const [subSearchQuery, setSubSearchQuery] = useState<string>("");
  const [copiedDialogue, setCopiedDialogue] = useState<boolean>(false);

  // Cue list scroll container ref for auto-scrolling
  const cueContainerRef = useRef<HTMLDivElement>(null);

  // Initialize selected artifact on open or change
  useEffect(() => {
    if (!isOpen || !job.artifacts || job.artifacts.length === 0) return;
    if (initialArtifactId && job.artifacts.some((a) => a.id === initialArtifactId)) {
      setSelectedArtifactId(initialArtifactId);
    } else {
      // Default to first audio if exists, else first artifact
      const firstAudio = job.artifacts.find((a) => a.type === "audio");
      setSelectedArtifactId(firstAudio ? firstAudio.id : job.artifacts[0].id);
    }

    // Default attached subtitle for "Nghe kèm phụ đề"
    const translatedSub = job.artifacts.find((a) => a.task === "translation");
    const sourceSub = job.artifacts.find((a) => a.task === "transcription");
    const defaultSub = translatedSub || sourceSub;
    if (defaultSub) {
      setAttachedSubtitleId(defaultSub.id);
    }

    // Reset playback
    setIsPlaying(false);
    setPlaybackSec(0);
    setSubSearchQuery("");
  }, [isOpen, job, initialArtifactId]);

  // Active selected artifact
  const currentArtifact = useMemo(() => {
    return job.artifacts.find((a) => a.id === selectedArtifactId) || job.artifacts[0] || null;
  }, [job.artifacts, selectedArtifactId]);

  // Audio Playback simulation ticker with speed support
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (isPlaying && currentArtifact && currentArtifact.type === "audio") {
      const maxSec = currentArtifact.audioDurationSec || 180;
      const intervalMs = Math.round(1000 / playbackSpeed);

      timer = setInterval(() => {
        setPlaybackSec((prev) => {
          if (prev >= maxSec) {
            setIsPlaying(false);
            return 0;
          }
          return prev + 1;
        });
      }, intervalMs);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isPlaying, currentArtifact, playbackSpeed]);

  // Switch artifact tab handler
  const handleSelectArtifact = (artId: string) => {
    if (artId === selectedArtifactId) return;
    setIsPlaying(false);
    setPlaybackSec(0);
    setSubSearchQuery("");
    setSelectedArtifactId(artId);
  };

  // Seek audio back/forward 5s
  const handleSeekDelta = (deltaSec: number) => {
    if (!currentArtifact) return;
    const maxSec = currentArtifact.audioDurationSec || 180;
    setPlaybackSec((prev) => Math.max(0, Math.min(maxSec, prev + deltaSec)));
  };

  // Subtitle attached to audio when "Nghe kèm phụ đề" is checked
  const activeAttachedSubtitle = useMemo(() => {
    if (!listenWithSubtitles) return null;
    return job.artifacts.find((a) => a.id === attachedSubtitleId && a.type === "subtitle") || null;
  }, [listenWithSubtitles, job.artifacts, attachedSubtitleId]);

  // Timeline reliability evaluation
  const isTimelineSyncReliable = useMemo(() => {
    if (!currentArtifact || currentArtifact.type !== "audio" || !activeAttachedSubtitle) {
      return false;
    }
    // If warning mentions timeline disparity, sync is marked unverified/unreliable
    if (job.statusWarning && job.statusWarning.toLowerCase().includes("timeline")) {
      return false;
    }
    if (!activeAttachedSubtitle.cues || activeAttachedSubtitle.cues.length === 0) {
      return false;
    }
    // Check if cues have timestamps within reasonable range of audio
    const lastCue = activeAttachedSubtitle.cues[activeAttachedSubtitle.cues.length - 1];
    const parsed = parseTimestampToSeconds(lastCue.time);
    if (!parsed) return false;

    const audioDur = currentArtifact.audioDurationSec || 180;
    // Allow up to 10% or 5s variance
    if (parsed.startSec > audioDur + 5) {
      return false;
    }
    return true;
  }, [currentArtifact, activeAttachedSubtitle, job.statusWarning]);

  // Cues for currently viewed subtitle (either main view or attached subtitle)
  const displayCues: HistorySubtitleCue[] = useMemo(() => {
    if (currentArtifact?.type === "subtitle") {
      return currentArtifact.cues || [];
    }
    if (currentArtifact?.type === "audio" && listenWithSubtitles && activeAttachedSubtitle) {
      return activeAttachedSubtitle.cues || [];
    }
    return [];
  }, [currentArtifact, listenWithSubtitles, activeAttachedSubtitle]);

  // Filtered cues based on subSearchQuery
  const filteredCues = useMemo(() => {
    if (!subSearchQuery.trim()) return displayCues;
    const q = subSearchQuery.toLowerCase();
    return displayCues.filter((c) => c.text.toLowerCase().includes(q));
  }, [displayCues, subSearchQuery]);

  // Current active cue index based on playbackSec
  const currentCueIndex = useMemo(() => {
    if (!isPlaying && playbackSec === 0) return -1;
    if (!isTimelineSyncReliable) return -1;

    for (let i = 0; i < displayCues.length; i++) {
      const cue = displayCues[i];
      const parsed = cue.startSec !== undefined && cue.endSec !== undefined
        ? { startSec: cue.startSec, endSec: cue.endSec }
        : parseTimestampToSeconds(cue.time);
      if (parsed && playbackSec >= parsed.startSec && playbackSec <= parsed.endSec) {
        return cue.index;
      }
    }
    return -1;
  }, [displayCues, playbackSec, isPlaying, isTimelineSyncReliable]);

  // Auto-scroll active cue into view
  useEffect(() => {
    if (currentCueIndex !== -1 && cueContainerRef.current) {
      const activeEl = cueContainerRef.current.querySelector(`[data-cue-idx="${currentCueIndex}"]`);
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }, [currentCueIndex]);

  // Copy full dialogue text
  const handleCopyAllDialogue = () => {
    const allText = displayCues.map((c) => c.text).join("\n");
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(allText);
      setCopiedDialogue(true);
      setTimeout(() => setCopiedDialogue(false), 2000);
    }
  };

  // Format subtitle labels for switchers (e.g. "Phụ đề gốc", "Bản dịch tiếng Việt")
  const formatSubtitleLabel = (sub: HistoryArtifactItem): string => {
    if (sub.task === "transcription") {
      return "Phụ đề gốc";
    }
    if (sub.task === "translation") {
      const match = sub.label?.match(/tiếng\s+[\p{L}]+/iu);
      if (match) {
        return `Bản dịch ${match[0]}`;
      }
      return "Bản dịch tiếng Việt";
    }
    return sub.label || sub.fileName;
  };

  // Short display label for segmented pills (Section 1: "Lồng tiếng | Phụ đề gốc | Bản dịch")
  const getShortTabLabel = (art: HistoryArtifactItem) => {
    switch (art.task) {
      case "dubbing":
        return "Lồng tiếng";
      case "dialogue":
        return "Hội thoại";
      case "tts":
        return "TTS";
      case "translation":
        return "Bản dịch";
      case "transcription":
        return "Phụ đề gốc";
      default:
        return art.label || art.fileName;
    }
  };

  if (!isOpen || !currentArtifact) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="w-full max-w-[500px] bg-surface1 border-l border-borderDefault flex flex-col h-full shadow-2xl animate-in slide-in-from-right duration-200">
        {/* 1. HEADER: Title + Close */}
        <div className="p-4 border-b border-borderDefault flex items-center justify-between bg-surface1 flex-shrink-0">
          <h3 className="text-sm font-bold text-textPrimary">Kết quả</h3>

          <button
            onClick={onClose}
            className="p-1.5 text-textMuted hover:text-textPrimary rounded-lg hover:bg-surface2 transition-colors cursor-pointer flex-shrink-0"
            title="Đóng"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 2. UNIFIED RESULT SELECTOR: Single Segmented Tabs/Pills */}
        <div className="p-3 border-b border-borderDefault bg-surface1/80 flex-shrink-0">
          <div className="flex items-center gap-1 p-1 bg-surface2/60 rounded-xl border border-borderDefault">
            {job.artifacts.map((art) => {
              const isSelected = art.id === selectedArtifactId;
              return (
                <button
                  key={art.id}
                  onClick={() => handleSelectArtifact(art.id)}
                  title={art.fileName}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-medium transition-all cursor-pointer truncate ${
                    isSelected
                      ? "bg-accent/15 border border-accent/40 text-accent font-semibold shadow-2xs"
                      : "text-textMuted hover:text-textPrimary hover:bg-surface3 border border-transparent"
                  }`}
                >
                  {art.type === "audio" ? (
                    <FileAudio className={`w-3.5 h-3.5 flex-shrink-0 ${isSelected ? "text-accent" : "text-emerald-400"}`} />
                  ) : (
                    <Captions className={`w-3.5 h-3.5 flex-shrink-0 ${isSelected ? "text-accent" : "text-amber-400"}`} />
                  )}
                  <span className="truncate">{getShortTabLabel(art)}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 3. MAIN SCROLLABLE CONTENT BODY */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Missing Disk File Alert */}
          {!currentArtifact.existsOnDisk && (
            <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-200 text-xs space-y-1.5">
              <div className="flex items-center gap-1.5 font-bold text-amber-900 dark:text-amber-300">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <span>Tệp không còn trên đĩa hoặc không thể truy cập</span>
              </div>
              <p className="text-[11px] text-amber-800 dark:text-amber-200 leading-relaxed font-mono break-all">
                {currentArtifact.filePath}
              </p>
              <p className="text-[11px] text-amber-700 dark:text-textMuted">
                Tệp có thể đã bị xóa hoặc di chuyển khỏi thư mục xuất. Các thao tác phát và mở tệp tạm thời bị khóa.
              </p>
            </div>
          )}

          {/* ======================================================== */}
          {/* CASE A: AUDIO PLAYER VIEW (when selected artifact is audio) */}
          {/* ======================================================== */}
          {currentArtifact.type === "audio" && (
            <div className="space-y-3.5">
              {/* Audio Player Card */}
              <div className="p-4 bg-surface2/60 rounded-2xl border border-borderDefault space-y-3.5">
                {/* Time Display Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-textPrimary">
                    <FileAudio className="w-4 h-4 text-emerald-400" />
                    <span>Trình phát Âm thanh</span>
                  </div>
                  <span className="text-[11px] text-textMuted font-mono">
                    {formatSeconds(playbackSec)} / {formatSeconds(currentArtifact.audioDurationSec || 180)}
                  </span>
                </div>

                {/* Scrubber Progress Slider */}
                {(() => {
                  const maxSec = currentArtifact.audioDurationSec || 180;
                  const progressPct = maxSec > 0 ? Math.min(100, Math.max(0, (playbackSec / maxSec) * 100)) : 0;
                  return (
                    <input
                      type="range"
                      min="0"
                      max={maxSec}
                      value={playbackSec}
                      disabled={!currentArtifact.existsOnDisk}
                      onChange={(e) => setPlaybackSec(parseInt(e.target.value) || 0)}
                      style={{
                        background: `linear-gradient(to right, var(--theme-accent) 0%, var(--theme-accent) ${progressPct}%, var(--theme-surface3) ${progressPct}%, var(--theme-surface3) 100%)`,
                      }}
                      className="w-full accent-accent h-1.5 rounded-full appearance-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed outline-none border-none focus:outline-none focus:ring-0 focus:border-none"
                    />
                  );
                })()}

                {/* Primary Controls Row: Play/Pause, -5s, +5s, Volume */}
                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-2">
                    {/* Play/Pause */}
                    <button
                      onClick={() => setIsPlaying(!isPlaying)}
                      disabled={!currentArtifact.existsOnDisk}
                      className="w-9 h-9 rounded-full bg-accent text-slate-950 flex items-center justify-center hover:bg-accentHover transition-colors shadow-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      title={isPlaying ? "Tạm dừng" : "Phát audio"}
                    >
                      {isPlaying ? (
                        <Pause className="w-4 h-4 fill-current" />
                      ) : (
                        <Play className="w-4 h-4 fill-current ml-0.5" />
                      )}
                    </button>

                    {/* -5s Rewind */}
                    <button
                      onClick={() => handleSeekDelta(-5)}
                      disabled={!currentArtifact.existsOnDisk}
                      className="flex items-center gap-1 px-2 py-1 text-textMuted hover:text-textPrimary rounded-lg hover:bg-surface3 transition-colors text-[11px] font-mono cursor-pointer disabled:opacity-40"
                      title="Tua lùi 5 giây"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>-5s</span>
                    </button>

                    {/* +5s Forward */}
                    <button
                      onClick={() => handleSeekDelta(5)}
                      disabled={!currentArtifact.existsOnDisk}
                      className="flex items-center gap-1 px-2 py-1 text-textMuted hover:text-textPrimary rounded-lg hover:bg-surface3 transition-colors text-[11px] font-mono cursor-pointer disabled:opacity-40"
                      title="Tua tới 5 giây"
                    >
                      <span>+5s</span>
                      <RotateCw className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Volume Slider */}
                  <div className="flex items-center gap-2 w-28">
                    <button
                      onClick={() => setVolume(volume === 0 ? 80 : 0)}
                      className="text-textMuted hover:text-textPrimary cursor-pointer"
                      title={volume === 0 ? "Bật âm thanh" : "Tắt tiếng"}
                    >
                      {volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                    </button>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={volume}
                      onChange={(e) => setVolume(parseInt(e.target.value) || 0)}
                      style={{
                        background: `linear-gradient(to right, var(--theme-accent) 0%, var(--theme-accent) ${volume}%, var(--theme-surface3) ${volume}%, var(--theme-surface3) 100%)`,
                      }}
                      className="w-full accent-accent h-1.5 rounded-full appearance-none cursor-pointer outline-none border-none focus:outline-none focus:ring-0 focus:border-none"
                    />
                  </div>
                </div>

                {/* Secondary Controls: Playback Speed Switcher (Preview Only) */}
                <div className="pt-2 border-t border-borderDefault/60 flex items-center justify-between text-xs">
                  <span className="text-textMuted text-[11px]">Tốc độ phát:</span>
                  <div className="flex items-center gap-1 bg-surface1 p-0.5 rounded-lg border border-borderDefault font-mono text-[11px]">
                    {[1.0, 1.25, 1.5, 2.0].map((spd) => (
                      <button
                        key={spd}
                        onClick={() => setPlaybackSpeed(spd)}
                        className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                          playbackSpeed === spd
                            ? "bg-accent/20 text-accent font-bold"
                            : "text-textMuted hover:text-textPrimary"
                        }`}
                      >
                        {spd.toFixed(spd === 1 ? 1 : 2).replace(/\.00$/, ".0")}x
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Checkbox: [ ] Bật Phụ Đề */}
              {job.artifacts.some((a) => a.type === "subtitle") && (
                <div className="p-3.5 bg-surface2/40 rounded-2xl border border-borderDefault space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs font-semibold text-textPrimary cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={listenWithSubtitles}
                        onChange={(e) => setListenWithSubtitles(e.target.checked)}
                        className="rounded border-borderDefault text-accent focus:ring-accent accent-accent w-4 h-4 cursor-pointer"
                      />
                      <span>Bật Phụ Đề</span>
                    </label>
                  </div>

                  {/* Attached Subtitles List when checked */}
                  {listenWithSubtitles && (
                    <div className="space-y-2.5 pt-1 border-t border-borderDefault/50">
                      {/* Subtitle Selector if multiple subtitles exist */}
                      {job.artifacts.filter((a) => a.type === "subtitle").length > 1 && (
                        <div className="flex items-center gap-1 bg-surface1 p-0.5 rounded-xl border border-borderDefault text-xs">
                          {job.artifacts
                            .filter((a) => a.type === "subtitle")
                            .map((sub) => (
                              <button
                                key={sub.id}
                                onClick={() => setAttachedSubtitleId(sub.id)}
                                className={`flex-1 py-1 px-2 rounded-lg text-center font-medium transition-colors cursor-pointer truncate text-[11px] ${
                                  attachedSubtitleId === sub.id
                                    ? "bg-accent/15 text-accent font-bold shadow-2xs"
                                    : "text-textMuted hover:text-textPrimary"
                                }`}
                              >
                                {formatSubtitleLabel(sub)}
                              </button>
                            ))}
                        </div>
                      )}

                      {/* Timeline Reliability Callout if not verified */}
                      {!isTimelineSyncReliable && (
                        <div className="p-2.5 rounded-xl bg-surface1 border border-borderDefault text-textMuted text-[11px] flex items-start gap-2">
                          <Info className="w-3.5 h-3.5 text-accent flex-shrink-0 mt-0.5" />
                          <span>
                            Timeline phụ đề này có thể chưa đồng bộ tuyệt đối với audio lồng tiếng. Hiển thị ở chế độ đọc tham khảo.
                          </span>
                        </div>
                      )}

                      {/* Synced Cue List */}
                      <div
                        ref={cueContainerRef}
                        className="space-y-1.5 max-h-56 overflow-y-auto pr-1 text-xs font-mono"
                      >
                        {displayCues.map((cue) => {
                          const isHighlighted = cue.index === currentCueIndex;
                          const parsed = cue.startSec !== undefined
                            ? { startSec: cue.startSec }
                            : parseTimestampToSeconds(cue.time);

                          return (
                            <div
                              key={cue.index}
                              data-cue-idx={cue.index}
                              onClick={() => {
                                if (isTimelineSyncReliable && parsed) {
                                  setPlaybackSec(parsed.startSec);
                                }
                              }}
                              className={`p-2 rounded-xl border transition-all text-xs ${
                                isHighlighted
                                  ? "bg-accent/15 border-accent text-accent shadow-2xs font-semibold"
                                  : "bg-surface1/80 border-borderDefault/70 text-textSecondary hover:border-accent/40"
                              } ${isTimelineSyncReliable ? "cursor-pointer" : "cursor-default"}`}
                              title={
                                isTimelineSyncReliable
                                  ? `Nhấn để tua đến ${cue.time}`
                                  : undefined
                              }
                            >
                              <div className="flex items-center justify-between text-[10px] text-textMuted mb-0.5">
                                <span className={isHighlighted ? "text-accent font-bold" : ""}>
                                  {cue.index}.
                                </span>
                                <span>{cue.time}</span>
                              </div>
                              <p className={`text-xs leading-relaxed font-sans ${isHighlighted ? "text-accent font-medium" : "text-textPrimary"}`}>
                                {cue.text}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ======================================================== */}
          {/* CASE B: SUBTITLE VIEWER (when selected artifact is subtitle) */}
          {/* ======================================================== */}
          {currentArtifact.type === "subtitle" && (
            <div className="p-4 bg-surface2/50 rounded-2xl border border-borderDefault space-y-3.5">
              {/* Search & Copy Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-textPrimary">
                  <Captions className="w-4 h-4 text-amber-400" />
                  <span>Danh sách câu thoại ({displayCues.length} câu)</span>
                </div>

                {/* [Sao chép toàn bộ lời thoại] button */}
                <button
                  onClick={handleCopyAllDialogue}
                  disabled={displayCues.length === 0}
                  className="flex items-center gap-1 px-2.5 py-1 bg-surface1 hover:bg-surface3 text-textSecondary hover:text-accent border border-borderDefault rounded-lg text-[11px] font-medium transition-colors cursor-pointer self-start sm:self-auto"
                  title="Chỉ sao chép văn bản lời thoại, không kèm số thứ tự và mốc thời gian"
                >
                  {copiedDialogue ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Đã sao chép!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Sao chép toàn bộ lời thoại</span>
                    </>
                  )}
                </button>
              </div>

              {/* Search Keyword in Subtitle */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-textMuted" />
                <input
                  type="text"
                  value={subSearchQuery}
                  onChange={(e) => setSubSearchQuery(e.target.value)}
                  placeholder="Tìm từ khóa trong phụ đề..."
                  className="w-full pl-8.5 pr-8 py-1.5 text-xs bg-surface1 border border-borderDefault rounded-xl text-textPrimary placeholder:text-textMuted focus:outline-none focus:border-accent transition-colors font-sans"
                />
                {subSearchQuery && (
                  <button
                    onClick={() => setSubSearchQuery("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-textMuted hover:text-textPrimary"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {subSearchQuery && (
                <div className="text-[11px] text-textMuted font-mono">
                  Tìm thấy <span className="text-accent font-bold">{filteredCues.length}</span> / {displayCues.length} câu phù hợp
                </div>
              )}

              {/* Subtitle Cue List Container */}
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {filteredCues.length > 0 ? (
                  filteredCues.map((cue) => (
                    <div
                      key={cue.index}
                      className="p-3 rounded-xl bg-surface1 border border-borderDefault text-xs space-y-1 hover:border-accent/40 transition-colors"
                    >
                      <div className="flex items-center justify-between text-[10px] text-textMuted font-mono">
                        <span className="px-1.5 py-0.2 rounded bg-surface3 text-accent font-bold">
                          {cue.index}.
                        </span>
                        <span>{cue.time}</span>
                      </div>
                      <p className="text-textPrimary text-xs leading-relaxed font-sans">
                        {cue.text}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8 text-textMuted text-xs">
                    {subSearchQuery
                      ? "Không tìm thấy câu phụ đề nào chứa từ khóa trên."
                      : "Không có câu phụ đề nào trong tệp này."}
                  </div>
                )}
              </div>
            </div>
          )}

        </div>

        {/* 5. FIXED FOOTER: [Mở thư mục] [Đóng] */}
        <div className="p-3.5 border-t border-borderDefault flex items-center justify-between bg-surface1 flex-shrink-0">
          {/* [Mở thư mục] */}
          <button
            onClick={() => {
              if (onOpenFolder) {
                onOpenFolder(job.outputDirectory);
              } else {
                alert(`Đang mở thư mục chứa kết quả:\n${job.outputDirectory}`);
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-surface2 hover:bg-surface3 text-textSecondary hover:text-textPrimary border border-borderDefault rounded-xl text-xs transition-colors cursor-pointer"
            title="Mở thư mục trên máy tính"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span>Mở thư mục</span>
          </button>

          {/* [Đóng] */}
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-surface2 hover:bg-surface3 text-textPrimary rounded-xl text-xs font-semibold transition-colors cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
