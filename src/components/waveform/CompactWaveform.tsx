import React, { useRef, useState, useEffect, useMemo } from "react";
import { WaveformMinMaxPeak, extractMinMaxPeaks } from "../../services/audio/audioDsp";
import { WaveformCanvas } from "./WaveformCanvas";

export interface CompactWaveformProps {
  audioBuffer?: AudioBuffer | null;
  audioUrl?: string;
  peaks?: WaveformMinMaxPeak[];
  isPlaying?: boolean;
  currentTime?: number;
  duration?: number;
  height?: number;
  onSeek?: (sec: number) => void;
  className?: string;
}

// Generates fallback authentic speech peaks for cards before buffer is decoded
function generateFallbackSpeechPeaks(count: number): WaveformMinMaxPeak[] {
  const peaks: WaveformMinMaxPeak[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const progress = i / count;
    // Multi-syllable speech envelope with natural phrases and pauses
    const phrase = Math.sin(progress * Math.PI * 3.5);
    const syllable = Math.max(0, Math.sin(progress * Math.PI * 18));
    if (phrase > 0.05) {
      const amp = Math.min(0.9, Math.max(0.1, syllable * phrase * 0.85 + (i % 3 === 0 ? 0.15 : 0)));
      peaks[i] = { min: -amp * 0.9, max: amp };
    } else {
      // Natural silence gap
      peaks[i] = { min: 0, max: 0 };
    }
  }
  return peaks;
}

export const CompactWaveform: React.FC<CompactWaveformProps> = ({
  audioBuffer,
  audioUrl: _audioUrl,
  peaks: providedPeaks,
  isPlaying = false,
  currentTime = 0,
  duration = 18.5,
  height = 28,
  onSeek,
  className = "",
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(200);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      if (el.clientWidth > 0) {
        setContainerWidth(el.clientWidth);
      }
    };
    update();
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const totalDuration = audioBuffer ? audioBuffer.duration : Math.max(0.1, duration);
  const numBuckets = Math.max(30, Math.floor(containerWidth / 2.0));

  const resolvedPeaks = useMemo(() => {
    if (providedPeaks && providedPeaks.length > 0) {
      return providedPeaks;
    }
    if (audioBuffer) {
      return extractMinMaxPeaks(audioBuffer, numBuckets);
    }
    return generateFallbackSpeechPeaks(numBuckets);
  }, [providedPeaks, audioBuffer, numBuckets]);

  const handlePointerDown = (_e: React.PointerEvent<HTMLCanvasElement>, pixelX: number) => {
    if (!onSeek || totalDuration <= 0 || containerWidth <= 0) return;
    const targetSec = Math.max(0, Math.min(totalDuration, (pixelX / containerWidth) * totalDuration));
    onSeek(targetSec);
  };

  return (
    <div
      ref={containerRef}
      className={`relative w-full overflow-hidden select-none flex items-center ${className}`}
      style={{ height: `${height}px` }}
    >
      <WaveformCanvas
        peaks={resolvedPeaks}
        width={containerWidth}
        height={height}
        duration={totalDuration}
        currentPlaySec={isPlaying || currentTime > 0 ? currentTime : undefined}
        isPlaying={isPlaying}
        showRuler={false}
        showCenterLine={true}
        darkBackground={false}
        cursor={onSeek ? "pointer" : "default"}
        onCanvasPointerDown={handlePointerDown}
      />
    </div>
  );
};
