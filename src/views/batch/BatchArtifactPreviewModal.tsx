import React, { useState, useRef, useEffect } from "react";
import {
  X,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Music,
  FileCode,
} from "lucide-react";
import { parseSubtitle } from "../../services/subtitle/parser";
import { SubtitleCue } from "../../services/subtitle/types";

export interface BatchArtifactPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  artifactPath: string;
  artifactContent?: string; // Subtitle text content or audio base64/URL
  fileName: string;
}

export const BatchArtifactPreviewModal: React.FC<BatchArtifactPreviewModalProps> = ({
  isOpen,
  onClose,
  artifactPath,
  artifactContent = "",
  fileName,
}) => {
  if (!isOpen) return null;

  const isAudio = artifactPath.endsWith(".wav") || artifactPath.endsWith(".mp3");
  const isSubtitle = artifactPath.endsWith(".srt") || artifactPath.endsWith(".vtt");

  // Audio Player State
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1.0);
  const [isMuted, setIsMuted] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Subtitle cues
  const [cues, setCues] = useState<SubtitleCue[]>([]);

  useEffect(() => {
    if (isSubtitle && artifactContent) {
      try {
        const parsed = parseSubtitle(artifactContent);
        setCues(parsed);
      } catch {
        setCues([]);
      }
    }
  }, [isSubtitle, artifactContent]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  };

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainder = Math.floor(secs % 60);
    return `${mins}:${remainder.toString().padStart(2, "0")}`;
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-[640px] bg-panel rounded-2xl border border-borderDefault shadow-2xl flex flex-col overflow-hidden select-none">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-borderDefault bg-surface1 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            {isAudio ? (
              <Music className="w-4 h-4 text-accent" />
            ) : (
              <FileCode className="w-4 h-4 text-amber-400" />
            )}
            <h3 className="text-xs font-bold text-textPrimary truncate max-w-[420px]">
              {fileName}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-textMuted hover:text-textPrimary rounded-lg hover:bg-surface2 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 flex-1 overflow-y-auto">
          {isAudio && (
            <div className="space-y-4">
              <audio
                ref={audioRef}
                src={artifactContent || artifactPath}
                onTimeUpdate={() => {
                  if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
                }}
                onLoadedMetadata={() => {
                  if (audioRef.current) setDuration(audioRef.current.duration);
                }}
                onEnded={() => setIsPlaying(false)}
              />

              <div className="flex items-center justify-center py-6">
                <button
                  type="button"
                  onClick={togglePlay}
                  className="w-14 h-14 rounded-full bg-accent hover:bg-accentHover text-slate-950 flex items-center justify-center shadow-lg transition-transform active:scale-95 cursor-pointer"
                >
                  {isPlaying ? (
                    <Pause className="w-6 h-6 fill-current" />
                  ) : (
                    <Play className="w-6 h-6 fill-current ml-0.5" />
                  )}
                </button>
              </div>

              {/* Progress Slider */}
              <div className="space-y-1">
                <input
                  type="range"
                  min="0"
                  max={duration || 100}
                  value={currentTime}
                  onChange={(e) => {
                    const t = parseFloat(e.target.value);
                    setCurrentTime(t);
                    if (audioRef.current) audioRef.current.currentTime = t;
                  }}
                  className="w-full accent-accent h-1.5 bg-surface3 rounded-full cursor-pointer"
                />
                <div className="flex items-center justify-between text-[11px] font-mono text-textMuted">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>

              {/* Volume */}
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    const next = !isMuted;
                    setIsMuted(next);
                    if (audioRef.current) audioRef.current.muted = next;
                  }}
                  className="p-1 rounded text-textMuted hover:text-textPrimary cursor-pointer"
                >
                  {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={isMuted ? 0 : volume}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    setVolume(v);
                    setIsMuted(false);
                    if (audioRef.current) {
                      audioRef.current.volume = v;
                      audioRef.current.muted = false;
                    }
                  }}
                  className="w-24 accent-accent h-1 bg-surface3 rounded-full cursor-pointer"
                />
              </div>
            </div>
          )}

          {isSubtitle && (
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {cues.length === 0 ? (
                <div className="text-center py-8 text-textMuted text-xs font-mono">
                  {artifactContent || "Không có nội dung phụ đề hiển thị."}
                </div>
              ) : (
                cues.map((cue, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 rounded-lg border border-borderDefault bg-surface2/40 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between text-[10px] font-mono text-accent">
                      <span>#{idx + 1}</span>
                      <span>
                        {formatTime(cue.startSec)} ➔ {formatTime(cue.endSec)}
                      </span>
                    </div>
                    <div className="text-textPrimary leading-relaxed">{cue.text}</div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
