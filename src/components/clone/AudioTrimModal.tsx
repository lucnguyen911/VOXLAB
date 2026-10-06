import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  X,
  Play,
  Pause,
  Scissors,
  Check,
  AlertTriangle,
  RotateCcw,
  ZoomIn,
} from "lucide-react";
import {
  sliceAudioBuffer,
  audioBufferToWavBlob,
  formatAudioTimeWithSubseconds,
  getOrCreateAudioContext,
} from "../../services/audio/audioDsp";
import { useI18n } from "../../i18n/context";
import { TrimWaveform } from "../waveform/TrimWaveform";

interface AudioTrimModalProps {
  isOpen: boolean;
  onClose: () => void;
  audioBuffer: AudioBuffer | null;
  objectUrl: string | null;
  initialRange?: { startSec: number; endSec: number };
  onApplyTrim: (
    trimmedBuffer: AudioBuffer,
    trimmedBlob: Blob,
    trimmedUrl: string,
    range: { startSec: number; endSec: number }
  ) => void;
}

const ZOOM_PRESETS = [1, 2, 4, 8];

export const AudioTrimModal: React.FC<AudioTrimModalProps> = ({
  isOpen,
  onClose,
  audioBuffer,
  initialRange,
  onApplyTrim,
}) => {
  const { lang } = useI18n();
  const totalDuration = audioBuffer ? audioBuffer.duration : 20;

  const [startSec, setStartSec] = useState<number>(0);
  const [endSec, setEndSec] = useState<number>(() => Math.min(20, totalDuration));
  const [zoom, setZoom] = useState<number>(1.0);
  const [isPlayingRegion, setIsPlayingRegion] = useState<boolean>(false);
  const [currentPlaySec, setCurrentPlaySec] = useState<number>(0);

  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playbackStartTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number | null>(null);

  // Initialize or reset range when opened
  useEffect(() => {
    if (isOpen && audioBuffer) {
      if (initialRange) {
        setStartSec(Math.max(0, Math.min(initialRange.startSec, audioBuffer.duration - 0.5)));
        setEndSec(Math.min(audioBuffer.duration, Math.max(initialRange.endSec, initialRange.startSec + 0.5)));
      } else {
        const dur = audioBuffer.duration;
        if (dur > 14) {
          setStartSec(1.5);
          setEndSec(Math.min(dur - 1.0, 16.5));
        } else if (dur > 6) {
          setStartSec(0.8);
          setEndSec(dur - 0.8);
        } else {
          setStartSec(0);
          setEndSec(dur);
        }
      }
      setZoom(1.0);
      setIsPlayingRegion(false);
      setCurrentPlaySec(0);
    }
  }, [isOpen, audioBuffer, initialRange]);

  const selectedDuration = Math.max(0.1, endSec - startSec);

  // Stop playback on unmount or close
  const stopPlayback = useCallback(() => {
    if (activeSourceRef.current) {
      try {
        activeSourceRef.current.stop();
        activeSourceRef.current.disconnect();
      } catch (_) {}
      activeSourceRef.current = null;
    }
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setIsPlayingRegion(false);
    setCurrentPlaySec(startSec);
  }, [startSec]);

  useEffect(() => {
    return () => stopPlayback();
  }, [stopPlayback]);

  // Toggle playing only selected region [startSec, endSec]
  const handleTogglePlayRegion = () => {
    if (isPlayingRegion) {
      stopPlayback();
      return;
    }

    if (!audioBuffer) return;

    try {
      stopPlayback();
      const ctx = getOrCreateAudioContext();
      if (ctx.state === "suspended") {
        ctx.resume();
      }

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      const offset = startSec;
      const duration = selectedDuration;

      playbackStartTimeRef.current = ctx.currentTime;
      setCurrentPlaySec(startSec);
      setIsPlayingRegion(true);

      source.onended = () => {
        setIsPlayingRegion(false);
        setCurrentPlaySec(startSec);
        if (animationFrameRef.current !== null) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
      };

      source.start(0, offset, duration);
      activeSourceRef.current = source;

      const tick = () => {
        const elapsed = ctx.currentTime - playbackStartTimeRef.current;
        const current = startSec + elapsed;
        if (current >= endSec) {
          stopPlayback();
        } else {
          setCurrentPlaySec(current);
          animationFrameRef.current = requestAnimationFrame(tick);
        }
      };
      animationFrameRef.current = requestAnimationFrame(tick);
    } catch (e) {
      console.error("Audio playback error:", e);
      setIsPlayingRegion(false);
    }
  };

  const handleApply = () => {
    if (!audioBuffer) return;
    stopPlayback();

    const trimmedBuffer = sliceAudioBuffer(audioBuffer, startSec, endSec);
    const trimmedBlob = audioBufferToWavBlob(trimmedBuffer);
    const trimmedUrl = URL.createObjectURL(trimmedBlob);

    onApplyTrim(trimmedBuffer, trimmedBlob, trimmedUrl, { startSec, endSec });
    onClose();
  };

  const handleResetToOriginal = () => {
    if (!audioBuffer) return;
    setStartSec(0);
    setEndSec(audioBuffer.duration);
  };

  if (!isOpen || !audioBuffer) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-fade-in">
      <div className="bg-surface1 border border-borderDefault rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-borderDefault flex items-center justify-between bg-surface2/40">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center text-accent">
              <Scissors className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-textPrimary">
                {lang === "vi" ? "Tùy chỉnh âm thanh tham chiếu" : "Customize Reference Audio"}
              </h3>
            </div>
          </div>
          <button
            onClick={() => {
              stopPlayback();
              onClose();
            }}
            className="p-1.5 rounded-lg text-textMuted hover:text-textPrimary hover:bg-surface3 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 space-y-4 overflow-y-auto">
          {/* Compact Time Information & Status Toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-surface2/40 rounded-xl border border-borderDefault">
            {/* Direct Time Points */}
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="text-textMuted font-medium">Bắt đầu:</span>
                <span className="font-mono font-semibold text-accent bg-accent/10 px-2 py-0.5 rounded border border-accent/20">
                  {formatAudioTimeWithSubseconds(startSec)}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-textMuted font-medium">Kết thúc:</span>
                <span className="font-mono font-semibold text-accent bg-accent/10 px-2 py-0.5 rounded border border-accent/20">
                  {formatAudioTimeWithSubseconds(endSec)}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-textMuted font-medium">Đã chọn:</span>
                <span className="font-mono font-bold text-textPrimary">
                  {selectedDuration.toFixed(1)}s
                </span>
              </div>
            </div>

            {/* Recommendation Guidance Badge */}
            <div className="flex items-center gap-1.5">
              {selectedDuration >= 10.0 && selectedDuration <= 30.0 ? (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                  <Check className="w-3.5 h-3.5" />
                  <span>{selectedDuration.toFixed(1)}s · Trong khoảng khuyến nghị (10s – 30s)</span>
                </div>
              ) : selectedDuration < 3.0 ? (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/25">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>{selectedDuration.toFixed(1)}s · Quá ngắn (tối thiểu 3.0s)</span>
                </div>
              ) : selectedDuration < 10.0 ? (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/25">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>{selectedDuration.toFixed(1)}s · Hơi ngắn (khuyến nghị 10s – 30s)</span>
                </div>
              ) : (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-500/15 text-slate-300 border border-slate-500/25">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>{selectedDuration.toFixed(1)}s · Khá dài (khuyến nghị 10s – 30s)</span>
                </div>
              )}
            </div>
          </div>

          {/* Reusable High-Density Trim Waveform with Direct Handles & Tooltip */}
          <TrimWaveform
            audioBuffer={audioBuffer}
            startSec={startSec}
            endSec={endSec}
            onRangeChange={(r) => {
              setStartSec(r.startSec);
              setEndSec(r.endSec);
            }}
            currentPlaySec={currentPlaySec}
            isPlaying={isPlayingRegion}
            zoom={zoom}
            onZoomChange={setZoom}
            height={160}
          />

          {/* Waveform Controls Toolbar: Play Selected, Zoom Presets, Select All */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-surface2/30 rounded-xl border border-borderDefault">
            <div className="flex items-center gap-2">
              {/* Play Selected Region */}
              <button
                onClick={handleTogglePlayRegion}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-xs transition-all shadow-xs ${
                  isPlayingRegion
                    ? "bg-rose-500 hover:bg-rose-600 text-white animate-pulse"
                    : "bg-accent hover:bg-accent/90 text-background font-bold"
                }`}
              >
                {isPlayingRegion ? (
                  <>
                    <Pause className="w-3.5 h-3.5 fill-current" />
                    <span>Dừng nghe ({formatAudioTimeWithSubseconds(currentPlaySec)})</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                    <span>Nghe đoạn đã chọn</span>
                  </>
                )}
              </button>

              {/* Reset to Select All */}
              <button
                onClick={handleResetToOriginal}
                className="flex items-center gap-1.5 px-3 py-2 bg-surface2 hover:bg-surface3 border border-borderDefault text-textSecondary hover:text-textPrimary rounded-lg text-xs font-medium transition-colors"
                title="Chọn toàn bộ độ dài ban đầu"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Chọn tất cả ({totalDuration.toFixed(1)}s)</span>
              </button>
            </div>

            {/* Real Zoom Control with Stepped Presets & Slider */}
            <div className="flex items-center gap-2.5 text-xs text-textSecondary bg-surface2/60 px-3 py-1.5 rounded-lg border border-borderDefault">
              <ZoomIn className="w-3.5 h-3.5 text-textMuted" />
              <span className="font-medium text-textMuted">Zoom:</span>

              <div className="flex items-center gap-1">
                {ZOOM_PRESETS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setZoom(p)}
                    className={`px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold transition-colors ${
                      zoom === p
                        ? "bg-accent text-background"
                        : "text-textSecondary hover:text-textPrimary hover:bg-surface3"
                    }`}
                  >
                    {p}x
                  </button>
                ))}
              </div>

              <input
                type="range"
                min="1.0"
                max="8.0"
                step="0.5"
                value={zoom}
                onChange={(e) => setZoom(parseFloat(e.target.value))}
                className="w-20 sm:w-24 accent-accent h-1.5 bg-surface3 rounded-lg cursor-pointer"
              />
              <span className="font-mono font-semibold w-7 text-right text-textPrimary">
                {zoom.toFixed(1)}x
              </span>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 border-t border-borderDefault flex items-center justify-end gap-2.5 bg-surface2/40">
          <button
            onClick={() => {
              stopPlayback();
              onClose();
            }}
            className="px-4 py-2 bg-surface2 hover:bg-surface3 border border-borderDefault text-textSecondary hover:text-textPrimary rounded-lg text-xs font-medium transition-colors"
          >
            Hủy
          </button>
          <button
            onClick={handleApply}
            className="flex items-center gap-1.5 px-5 py-2 bg-accent hover:bg-accent/90 text-background rounded-lg text-xs font-bold shadow-xs transition-colors"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Áp dụng đoạn cắt</span>
          </button>
        </div>
      </div>
    </div>
  );
};
