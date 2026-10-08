import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Play,
  Pause,
  Volume2,
  Volume1,
  VolumeX,
  X,
  RotateCcw,
  RotateCw,
  Download,
  Activity,
} from "lucide-react";
import { useI18n } from "../../i18n/context";

export interface ActiveAudioTrack {
  id: string;
  chunkIndex?: number;
  voiceName?: string;
  title?: string;
  durationSec: number;
  audioUrl?: string;
  text?: string;
}

export interface BottomAudioPlayerProps {
  track: ActiveAudioTrack;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onClose: () => void;
  onSeek?: (timeSec: number) => void;
  className?: string;
}

// Generate realistic speech envelope peaks deterministically from text and duration
export function generateSpeechPeaks(seedText: string, _duration: number, barCount: number = 84): number[] {
  const peaks: number[] = [];
  let hash = 0;
  for (let i = 0; i < seedText.length; i++) {
    hash = (hash << 5) - hash + seedText.charCodeAt(i);
    hash |= 0;
  }
  hash = Math.abs(hash);

  for (let i = 0; i < barCount; i++) {
    const progress = i / barCount;
    // Speech envelope: natural cadence with syllable bursts and rhythmic pauses
    const envelope = Math.pow(Math.sin(progress * Math.PI), 0.75);
    const pseudoRandom = Math.abs(Math.sin((i + 1) * 12.9898 + (hash % 100) * 78.233)) % 1;
    const harmonic1 = Math.sin(progress * 16 * Math.PI) * 0.28;
    const harmonic2 = Math.cos(progress * 28 * Math.PI) * 0.18;

    let amp = (0.32 + 0.46 * pseudoRandom + harmonic1 + harmonic2) * envelope;
    amp = Math.max(0.20, Math.min(1.0, amp));
    peaks.push(amp);
  }
  return peaks;
}

// Generate realistic speech sample buffer with natural formant harmonics and syllables
function createSyntheticSpeechBuffer(
  ctx: AudioContext,
  duration: number,
  voiceName: string,
  _text?: string
): AudioBuffer {
  const sampleRate = ctx.sampleRate || 44100;
  const totalSamples = Math.floor(duration * sampleRate);
  const buffer = ctx.createBuffer(1, totalSamples, sampleRate);
  const data = buffer.getChannelData(0);

  const lowerName = voiceName.toLowerCase();
  const isFemale =
    lowerName.includes("nữ") ||
    lowerName.includes("female") ||
    lowerName.includes("lan anh") ||
    lowerName.includes("thảo") ||
    lowerName.includes("mai") ||
    lowerName.includes("linh") ||
    lowerName.includes("trinh") ||
    lowerName.includes("trâm") ||
    lowerName.includes("hương") ||
    lowerName.includes("nga") ||
    lowerName.includes("ngọc") ||
    lowerName.includes("chi") ||
    lowerName.includes("yến");

  const baseF0 = isFemale ? 215 : 135;

  const phraseCount = Math.max(1, Math.round(duration / 4.2));
  const phrases: Array<{ start: number; end: number; speed: number }> = [];
  const phraseGap = 0.5;
  const netPhraseDuration = (duration - (phraseCount - 1) * phraseGap) / phraseCount;

  for (let p = 0; p < phraseCount; p++) {
    const pStart = p * (netPhraseDuration + phraseGap) + 0.2;
    const pEnd = Math.min(duration - 0.1, pStart + netPhraseDuration - 0.2);
    if (pEnd > pStart) {
      phrases.push({
        start: pStart,
        end: pEnd,
        speed: 3.8 + (p % 3) * 0.4,
      });
    }
  }

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    let amplitude = 0;

    for (const phrase of phrases) {
      if (t >= phrase.start && t <= phrase.end) {
        const phraseRel = t - phrase.start;
        const syllable = Math.max(0, Math.sin(phraseRel * Math.PI * phrase.speed));
        const syllableAmp = Math.pow(syllable, 1.6);

        const phraseLen = phrase.end - phrase.start;
        const phraseProgress = phraseRel / phraseLen;
        const phraseEnvelope = Math.sin(phraseProgress * Math.PI);

        const f0 = baseF0 + Math.sin(t * 1.8) * 12 + Math.cos(t * 0.6) * 6;
        const vocalTone =
          Math.sin(2 * Math.PI * f0 * t) * 0.40 +
          Math.sin(2 * Math.PI * (f0 * 2) * t) * 0.22 +
          Math.sin(2 * Math.PI * (f0 * 3.5) * t) * 0.10 +
          Math.sin(2 * Math.PI * (f0 * 5) * t) * 0.05;

        const isAttack = (phraseRel * phrase.speed) % 1 < 0.14;
        const noise = isAttack ? (Math.random() * 2 - 1) * 0.12 : 0;

        amplitude = (vocalTone + noise) * syllableAmp * phraseEnvelope * 0.42;
        break;
      }
    }

    data[i] = Math.max(-0.8, Math.min(0.8, amplitude));
  }

  return buffer;
}

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return "00:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

const PLAYBACK_SPEEDS = [1.0, 1.25, 1.5, 2.0, 0.8];

export const BottomAudioPlayer: React.FC<BottomAudioPlayerProps> = ({
  track,
  isPlaying,
  onTogglePlay,
  onClose,
  onSeek,
  className,
}) => {
  const { t } = useI18n();
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const bufferCacheRef = useRef<Map<string, AudioBuffer>>(new Map());
  const synthIntervalRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const playRequestIdRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(isPlaying);
  const lastTrackKeyRef = useRef<string>("");
  const currentTimeRef = useRef<number>(0);
  const volumeRef = useRef<number>(volume);
  const isMutedRef = useRef<boolean>(isMuted);
  const playbackSpeedRef = useRef<number>(playbackSpeed);
  const onTogglePlayRef = useRef(onTogglePlay);
  const onSeekRef = useRef(onSeek);

  const duration = Math.max(0.1, track.durationSec || 4.2);
  const durationRef = useRef(duration);
  const trackKey = `${track.id}_${track.audioUrl || ""}`;

  // Keep refs in sync synchronously on every render
  isPlayingRef.current = isPlaying;
  volumeRef.current = volume;
  isMutedRef.current = isMuted;
  playbackSpeedRef.current = playbackSpeed;
  onTogglePlayRef.current = onTogglePlay;
  onSeekRef.current = onSeek;
  durationRef.current = duration;

  const updateCurrentTime = useCallback((time: number) => {
    currentTimeRef.current = time;
    setCurrentTime(time);
  }, []);

  const stopAudioNode = useCallback(() => {
    playRequestIdRef.current++;
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.onended = null;
        sourceNodeRef.current.stop(0);
        sourceNodeRef.current.disconnect();
      } catch {
        // ignore
      }
      sourceNodeRef.current = null;
    }
    if (gainNodeRef.current && audioContextRef.current) {
      try {
        gainNodeRef.current.gain.setValueAtTime(0, audioContextRef.current.currentTime);
      } catch {
        // ignore
      }
    }
    if (audioContextRef.current && audioContextRef.current.state === "running") {
      audioContextRef.current.suspend().catch(() => {});
    }
  }, []);

  const getAudioBuffer = useCallback(
    async (ctx: AudioContext): Promise<AudioBuffer> => {
      const cacheKey = `${track.id}_${track.audioUrl || ""}`;
      if (bufferCacheRef.current.has(cacheKey)) {
        return bufferCacheRef.current.get(cacheKey)!;
      }

      if (track.audioUrl) {
        try {
          let url = track.audioUrl;
          const isLocalDiskPath =
            url &&
            (url.startsWith("file://") ||
              /^[a-zA-Z]:[/\\]/.test(url) ||
              url.startsWith("\\\\"));

          if (isLocalDiskPath) {
            const { readAudioFileBlobUrl } = await import("../../services/batch/batchRuntime");
            url = await readAudioFileBlobUrl(url);
          }
          const resp = await fetch(url);
          if (resp.ok) {
            const arr = await resp.arrayBuffer();
            const decoded = await ctx.decodeAudioData(arr);
            bufferCacheRef.current.set(cacheKey, decoded);
            return decoded;
          }
        } catch (e) {
          console.warn("Failed to load audio for track:", e);
        }
      }

      const synthetic = createSyntheticSpeechBuffer(
        ctx,
        duration,
        track.voiceName || track.title || "preview",
        track.text
      );
      bufferCacheRef.current.set(cacheKey, synthetic);
      return synthetic;
    },
    [track.id, track.audioUrl, track.voiceName, track.title, track.text, duration]
  );

  const playFromOffset = useCallback(
    async (offsetSec: number) => {
      stopAudioNode();
      const currentReqId = ++playRequestIdRef.current;

      try {
        if (!audioContextRef.current || audioContextRef.current.state === "closed") {
          const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
          if (AudioCtx) {
            audioContextRef.current = new AudioCtx();
          }
        }
        const ctx = audioContextRef.current;
        if (!ctx) return;
        if (ctx.state === "suspended") {
          await ctx.resume();
        }

        // Cancel if user paused or stopped while resuming context
        if (currentReqId !== playRequestIdRef.current || !isPlayingRef.current) {
          if (ctx.state === "running") ctx.suspend().catch(() => {});
          return;
        }

        if (!gainNodeRef.current) {
          const gain = ctx.createGain();
          gain.connect(ctx.destination);
          gainNodeRef.current = gain;
        }

        const buf = await getAudioBuffer(ctx);

        // Cancel if user paused or stopped while decoding audio
        if (currentReqId !== playRequestIdRef.current || !isPlayingRef.current) {
          if (ctx.state === "running") ctx.suspend().catch(() => {});
          return;
        }

        const effectiveVol = isMutedRef.current ? 0 : volumeRef.current * 0.45;
        gainNodeRef.current.gain.setValueAtTime(effectiveVol, ctx.currentTime);

        const source = ctx.createBufferSource();
        source.buffer = buf;
        source.playbackRate.value = playbackSpeedRef.current;
        source.connect(gainNodeRef.current);

        source.onended = () => {
          if (sourceNodeRef.current === source) {
            sourceNodeRef.current = null;
          }
        };

        const currentDuration = durationRef.current;
        const safeOffset = Math.max(0, Math.min(offsetSec, currentDuration - 0.05));
        source.start(0, safeOffset);
        sourceNodeRef.current = source;
      } catch (err) {
        console.warn("Could not start Web Audio playback:", err);
      }
    },
    [stopAudioNode, getAudioBuffer]
  );

  // Sync volume / mute changes into GainNode
  useEffect(() => {
    if (gainNodeRef.current && audioContextRef.current) {
      const effectiveVol = isMuted ? 0 : volume * 0.45;
      gainNodeRef.current.gain.setValueAtTime(effectiveVol, audioContextRef.current.currentTime);
    }
  }, [volume, isMuted]);

  // Sync playback speed into active AudioBufferSourceNode
  useEffect(() => {
    if (sourceNodeRef.current) {
      sourceNodeRef.current.playbackRate.value = playbackSpeed;
    }
    if (isPlayingRef.current) {
      startTimeRef.current = Date.now() - (currentTimeRef.current / playbackSpeed) * 1000;
    }
  }, [playbackSpeed]);

  // Unified deterministic playback & track switching effect
  useEffect(() => {
    const isNewTrack = lastTrackKeyRef.current !== trackKey;
    lastTrackKeyRef.current = trackKey;

    if (isNewTrack) {
      // Whenever track changes (different chunk or regenerated audio):
      // 1. Immediately reset playback position to 0
      updateCurrentTime(0);
      // 2. Stop any existing audio node
      stopAudioNode();
      // 3. Clear interval
      if (synthIntervalRef.current) {
        clearInterval(synthIntervalRef.current);
        synthIntervalRef.current = null;
      }
    }

    if (isPlaying) {
      // If it's a new track, strictly start from 0:00!
      // If it's the same track (resumed from pause), continue from currentTimeRef.current
      let startOffset = isNewTrack ? 0 : currentTimeRef.current;
      if (startOffset >= duration - 0.1) {
        startOffset = 0;
        updateCurrentTime(0);
      }

      playFromOffset(startOffset);
      const currentSpeed = playbackSpeedRef.current || 1.0;
      const startTime = Date.now() - (startOffset / currentSpeed) * 1000;
      startTimeRef.current = startTime;

      if (synthIntervalRef.current) {
        clearInterval(synthIntervalRef.current);
      }

      synthIntervalRef.current = window.setInterval(() => {
        const speed = playbackSpeedRef.current || 1.0;
        const elapsed = ((Date.now() - startTimeRef.current) / 1000) * speed;
        const maxDuration = durationRef.current;
        if (elapsed >= maxDuration) {
          stopAudioNode();
          updateCurrentTime(0);
          if (synthIntervalRef.current) {
            clearInterval(synthIntervalRef.current);
            synthIntervalRef.current = null;
          }
          onTogglePlayRef.current(); // End of audio track
        } else {
          updateCurrentTime(elapsed);
        }
      }, 40);
    } else {
      stopAudioNode();
      if (synthIntervalRef.current) {
        clearInterval(synthIntervalRef.current);
        synthIntervalRef.current = null;
      }
    }

    return () => {
      stopAudioNode();
      if (synthIntervalRef.current) {
        clearInterval(synthIntervalRef.current);
        synthIntervalRef.current = null;
      }
    };
  }, [trackKey, isPlaying, duration, playFromOffset, stopAudioNode, updateCurrentTime]);

  // Direct seek handler for range slider
  const handleSeek = useCallback(
    (targetTime: number) => {
      const clamped = Math.max(0, Math.min(durationRef.current, targetTime));
      updateCurrentTime(clamped);
      onSeekRef.current?.(clamped);
      if (isPlayingRef.current) {
        playFromOffset(clamped);
        startTimeRef.current = Date.now() - (clamped / playbackSpeedRef.current) * 1000;
      }
    },
    [playFromOffset, updateCurrentTime]
  );

  const handleRewind5s = useCallback(() => {
    const target = Math.max(0, currentTimeRef.current - 5);
    updateCurrentTime(target);
    onSeekRef.current?.(target);
    if (isPlayingRef.current) {
      playFromOffset(target);
      startTimeRef.current = Date.now() - (target / playbackSpeedRef.current) * 1000;
    }
  }, [playFromOffset, updateCurrentTime]);

  const handleForward5s = useCallback(() => {
    const target = Math.min(durationRef.current, currentTimeRef.current + 5);
    updateCurrentTime(target);
    onSeekRef.current?.(target);
    if (isPlayingRef.current) {
      playFromOffset(target);
      startTimeRef.current = Date.now() - (target / playbackSpeedRef.current) * 1000;
    }
  }, [playFromOffset, updateCurrentTime]);

  const handleCycleSpeed = () => {
    const currentIndex = PLAYBACK_SPEEDS.indexOf(playbackSpeed);
    const nextIndex = (currentIndex + 1) % PLAYBACK_SPEEDS.length;
    setPlaybackSpeed(PLAYBACK_SPEEDS[nextIndex]);
  };

  const handleDownload = () => {
    try {
      const cacheKey = `${track.id}_${track.audioUrl || ""}`;
      const cachedBuffer = bufferCacheRef.current.get(cacheKey) || bufferCacheRef.current.get(track.id);
      const sampleRate = cachedBuffer ? cachedBuffer.sampleRate : 44100;
      const numChannels = 1;
      const bytesPerSample = 2;
      const blockAlign = numChannels * bytesPerSample;
      const byteRate = sampleRate * blockAlign;
      const channelData = cachedBuffer ? cachedBuffer.getChannelData(0) : null;
      const totalSamples = channelData ? channelData.length : Math.floor(duration * sampleRate);
      const dataSize = totalSamples * bytesPerSample;
      const buffer = new ArrayBuffer(44 + dataSize);
      const view = new DataView(buffer);

      const writeString = (offset: number, str: string) => {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
      };
      writeString(0, "RIFF");
      view.setUint32(4, 36 + dataSize, true);
      writeString(8, "WAVE");
      writeString(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true); // PCM format
      view.setUint16(22, numChannels, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, byteRate, true);
      view.setUint16(32, blockAlign, true);
      view.setUint16(34, 16, true);
      writeString(36, "data");
      view.setUint32(40, dataSize, true);

      if (channelData) {
        let offset = 44;
        for (let i = 0; i < channelData.length; i++) {
          const s = Math.max(-1, Math.min(1, channelData[i]));
          const val = s < 0 ? s * 0x8000 : s * 0x7fff;
          view.setInt16(offset, val, true);
          offset += 2;
        }
      }

      const blob = new Blob([buffer], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `VoxLab_${chunkNumber}_${track.voiceName?.replace(/\s+/g, "_") || "preview"}.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Audio download error:", err);
    }
  };

  const handleClose = () => {
    stopAudioNode();
    updateCurrentTime(0);
    if (synthIntervalRef.current) {
      clearInterval(synthIntervalRef.current);
      synthIntervalRef.current = null;
    }
    onClose();
  };

  const progressPercent = Math.min(100, Math.max(0, (currentTime / duration) * 100));

  const chunkNumber =
    track.chunkIndex !== undefined
      ? track.chunkIndex < 10
        ? `0${track.chunkIndex}`
        : `${track.chunkIndex}`
      : track.id.replace("chunk_", "");

  const displaySpeaker = track.voiceName || "Thảo Trinh (Hà Nội)";

  const isChunk = track.chunkIndex !== undefined || track.id.startsWith("chunk_");
  const trackHeading = track.title
    ? track.title
    : isChunk
    ? `${t.audioPlayer?.chunkPrefix || "Đoạn"} ${chunkNumber}`
    : `Bản thử · ${displaySpeaker}`;

  return (
    <div
      role="region"
      aria-label="Audio Preview Player"
      className={`h-[68px] px-3.5 sm:px-5 bg-panel/95 dark:bg-[#0c1322]/95 backdrop-blur-xl border border-borderDefault/80 dark:border-white/10 rounded-xl shadow-lg shadow-black/5 dark:shadow-2xl dark:shadow-black/50 flex items-center justify-between gap-3 sm:gap-6 text-xs select-none shrink-0 z-30 relative overflow-hidden transition-all duration-200 ${
        className ?? "mx-2.5 sm:mx-3 mb-2.5 sm:mb-3"
      }`}
    >
      {/* Top Hairline Ambient Glow */}
      <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-accent/40 dark:via-accent/60 to-transparent pointer-events-none" />

      {/* ================================================================== */}
      {/* 1. LEFT ZONE: Voice Card Avatar & Dual-Line Track Metadata         */}
      {/* ================================================================== */}
      <div className="w-[220px] sm:w-[260px] shrink-0 flex items-center gap-3 min-w-0">
        {/* Sleek Voice Avatar with Dancing Soundwave Equalizer */}
        <div
          className="w-10 h-10 rounded-xl bg-gradient-to-tr from-accent/20 via-accent/10 to-transparent border border-accent/30 flex items-center justify-center relative overflow-hidden shrink-0 shadow-inner group cursor-pointer"
          onClick={onTogglePlay}
          title={isPlaying ? t.audioPlayer?.pause || "Tạm dừng" : t.audioPlayer?.play || "Phát"}
        >
          {isPlaying ? (
            <div className="flex items-end justify-center gap-[2.5px] h-4 w-5">
              <div className="w-[3px] bg-accent rounded-full animate-eq-1" />
              <div className="w-[3px] bg-accent rounded-full animate-eq-2" />
              <div className="w-[3px] bg-accent rounded-full animate-eq-3" />
              <div className="w-[3px] bg-accent rounded-full animate-eq-4" />
            </div>
          ) : (
            <Activity className="w-4 h-4 text-accent/80 group-hover:text-accent transition-colors" />
          )}
        </div>

        {/* Dual-Row Typography Metadata */}
        <div className="flex flex-col justify-center min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-bold text-textPrimary text-xs tracking-tight truncate block" title={trackHeading}>
              {trackHeading}
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-surface2 text-textMuted border border-borderDefault/60 font-medium shrink-0">
              WAV
            </span>
            <span className="text-[10px] font-mono text-textMuted hidden lg:inline shrink-0">
              {duration.toFixed(1)}s
            </span>
          </div>

          <div className="flex items-center gap-1 text-[11px] text-textSecondary font-medium truncate mt-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-accent/70 shrink-0 inline-block" />
            <span className="truncate block" title={displaySpeaker}>
              {displaySpeaker}
            </span>
          </div>
        </div>
      </div>

      {/* ================================================================== */}
      {/* 2. CENTER ZONE: True Studio Control Deck (Controls + Scrubber)     */}
      {/* ================================================================== */}
      <div className="flex-1 max-w-[480px] sm:max-w-[520px] min-w-0 flex flex-col items-center justify-center gap-1 mx-auto px-2">
        {/* Top Control Cluster */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Rewind 5s */}
          <button
            type="button"
            onClick={handleRewind5s}
            className="w-7 h-7 rounded-full text-textSecondary hover:text-textPrimary hover:bg-surface2 flex items-center justify-center transition-all active:scale-95 cursor-pointer"
            title={t.audioPlayer?.rewind5s || "Lùi 5 giây"}
            aria-label={t.audioPlayer?.rewind5s || "Lùi 5 giây"}
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          {/* Primary Hero Play/Pause Button */}
          <button
            type="button"
            onClick={onTogglePlay}
            className="w-8 h-8 rounded-full bg-gradient-to-tr from-accent to-sky-500 hover:from-accentHover hover:to-sky-400 text-white shadow-md shadow-accent/25 hover:shadow-accent/40 active:scale-95 transition-all flex items-center justify-center shrink-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent"
            title={isPlaying ? t.audioPlayer?.pause || "Tạm dừng" : t.audioPlayer?.play || "Phát"}
            aria-label={isPlaying ? t.audioPlayer?.pause || "Tạm dừng" : t.audioPlayer?.play || "Phát"}
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
            title={t.audioPlayer?.forward5s || "Tua 5 giây"}
            aria-label={t.audioPlayer?.forward5s || "Tua 5 giây"}
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>

          {/* Speed Pill Toggle */}
          <button
            type="button"
            onClick={handleCycleSpeed}
            className="ml-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold text-textSecondary hover:text-textPrimary bg-surface2 hover:bg-surface3 border border-borderDefault/70 transition-all active:scale-95 cursor-pointer"
            title={t.audioPlayer?.speed || "Tốc độ phát"}
          >
            {playbackSpeed.toFixed(playbackSpeed % 1 === 0 ? 1 : 2)}×
          </button>
        </div>

        {/* Bottom Scrubber Deck (Current Time + Range Slider + Total) matching History tab */}
        <div className="w-full flex items-center gap-2 sm:gap-2.5 min-w-0">
          {/* Current Time */}
          <span className="font-mono text-[11px] text-textPrimary font-semibold shrink-0 w-9 text-right tabular-nums">
            {formatTime(currentTime)}
          </span>

          {/* Interactive Range Slider Scrubber */}
          <input
            type="range"
            min={0}
            max={duration || 1}
            step={0.05}
            value={currentTime}
            onChange={(e) => {
              const val = parseFloat(e.target.value) || 0;
              handleSeek(val);
            }}
            style={{
              background: `linear-gradient(to right, var(--theme-accent) 0%, var(--theme-accent) ${progressPercent}%, var(--theme-surface3) ${progressPercent}%, var(--theme-surface3) 100%)`,
            }}
            className="flex-1 accent-accent h-1.5 rounded-full appearance-none cursor-pointer outline-none border-none focus:outline-none focus:ring-0 focus:border-none"
            aria-label={t.audioPlayer?.seekWaveform || "Kéo để tua đoạn"}
          />

          {/* Total Duration */}
          <span className="font-mono text-[11px] text-textMuted shrink-0 w-9 text-left tabular-nums">
            {formatTime(duration)}
          </span>
        </div>
      </div>

      {/* ================================================================== */}
      {/* 3. RIGHT ZONE: Volume Slider + Download WAV + Close Button         */}
      {/* ================================================================== */}
      <div className="w-[220px] sm:w-[260px] shrink-0 flex items-center justify-end gap-1.5 sm:gap-2">
        {/* Volume Control Group */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setIsMuted(!isMuted)}
            className="p-1.5 text-textSecondary hover:text-textPrimary hover:bg-surface2 rounded-lg transition-colors cursor-pointer"
            title={isMuted ? t.audioPlayer?.unmute || "Bật tiếng" : t.audioPlayer?.mute || "Tắt tiếng"}
            aria-label={isMuted ? t.audioPlayer?.unmute || "Bật tiếng" : t.audioPlayer?.mute || "Tắt tiếng"}
          >
            {isMuted || volume === 0 ? (
              <VolumeX className="w-4 h-4 text-danger" />
            ) : volume < 0.5 ? (
              <Volume1 className="w-4 h-4" />
            ) : (
              <Volume2 className="w-4 h-4" />
            )}
          </button>

          {/* Fixed-width Volume Slider */}
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
                  title={t.audioPlayer?.volume || "Âm lượng"}
                  aria-label={t.audioPlayer?.volume || "Âm lượng"}
                />
              );
            })()}
          </div>
        </div>

        {/* Download Audio Button */}
        <button
          type="button"
          onClick={handleDownload}
          className="p-1.5 text-textSecondary hover:text-textPrimary hover:bg-surface2 rounded-lg transition-colors cursor-pointer shrink-0"
          title={t.audioPlayer?.download || "Tải audio đoạn này"}
          aria-label={t.audioPlayer?.download || "Tải audio đoạn này"}
        >
          <Download className="w-4 h-4" />
        </button>

        {/* Elegant Vertical Divider */}
        <div className="h-4 w-[1px] bg-borderDefault/80 mx-0.5 shrink-0" />

        {/* Close & Unload Button */}
        <button
          type="button"
          onClick={handleClose}
          className="p-1.5 text-textMuted hover:text-danger hover:bg-danger/10 rounded-lg transition-colors cursor-pointer shrink-0"
          title={t.audioPlayer?.close || "Đóng trình phát"}
          aria-label={t.audioPlayer?.close || "Đóng trình phát"}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
export default BottomAudioPlayer;
