import React, { useRef, useState, useEffect, useMemo } from "react";
import {
  extractMinMaxPeaks,
  formatAudioTimeWithSubseconds,
} from "../../services/audio/audioDsp";
import { WaveformCanvas } from "./WaveformCanvas";

export interface TrimWaveformProps {
  audioBuffer: AudioBuffer | null;
  startSec: number;
  endSec: number;
  onRangeChange: (range: { startSec: number; endSec: number }) => void;
  currentPlaySec: number;
  isPlaying: boolean;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  height?: number;
  className?: string;
}

export const TrimWaveform: React.FC<TrimWaveformProps> = ({
  audioBuffer,
  startSec,
  endSec,
  onRangeChange,
  currentPlaySec,
  isPlaying,
  zoom = 1.0,
  height = 160,
  className = "",
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(750);
  const [cursor, setCursor] = useState<string>("default");

  // Dragging state
  const [dragMode, setDragMode] = useState<"start" | "end" | "region" | null>(null);
  const [dragTooltip, setDragTooltip] = useState<{ time: string; x: number } | null>(null);

  const dragStartXRef = useRef<number>(0);
  const dragStartRangeRef = useRef<{ startSec: number; endSec: number }>({ startSec: 0, endSec: 0 });
  const startSecRef = useRef(startSec);
  const endSecRef = useRef(endSec);
  startSecRef.current = startSec;
  endSecRef.current = endSec;

  // Track parent container width for responsive scaling
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

  const totalDuration = audioBuffer ? audioBuffer.duration : 20;

  // Real Zoom: scales canvas width to enable true sub-second detail & horizontal scrolling
  const canvasWidth = Math.max(containerWidth, Math.floor(containerWidth * zoom));

  // High-density peak buckets (~1 bucket every 1.75 CSS pixels)
  const numBuckets = Math.max(100, Math.floor(canvasWidth / 1.75));

  // Real PCM min/max amplitude peaks (with WeakMap caching)
  const peaks = useMemo(() => {
    if (!audioBuffer) return [];
    return extractMinMaxPeaks(audioBuffer, numBuckets);
  }, [audioBuffer, numBuckets]);

  // Pointer Down: hit detection for handles & region
  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>, pixelX: number) => {
    if (!audioBuffer) return;

    const startPixel = (startSecRef.current / totalDuration) * canvasWidth;
    const endPixel = (endSecRef.current / totalDuration) * canvasWidth;
    const HIT_RADIUS = 16;

    if (Math.abs(pixelX - startPixel) <= HIT_RADIUS) {
      setDragMode("start");
      setDragTooltip({
        time: formatAudioTimeWithSubseconds(startSecRef.current),
        x: startPixel,
      });
      try {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } catch (_) {}
    } else if (Math.abs(pixelX - endPixel) <= HIT_RADIUS) {
      setDragMode("end");
      setDragTooltip({
        time: formatAudioTimeWithSubseconds(endSecRef.current),
        x: endPixel,
      });
      try {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } catch (_) {}
    } else if (pixelX > startPixel && pixelX < endPixel) {
      setDragMode("region");
      dragStartXRef.current = pixelX;
      dragStartRangeRef.current = { startSec: startSecRef.current, endSec: endSecRef.current };
      try {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } catch (_) {}
    } else {
      // Clicked outside selection: snap nearest handle
      const clickSec = Math.max(0, Math.min(totalDuration, (pixelX / canvasWidth) * totalDuration));
      if (clickSec < startSecRef.current) {
        const newStart = Math.max(0, clickSec);
        onRangeChange({ startSec: newStart, endSec: endSecRef.current });
        setDragMode("start");
        setDragTooltip({
          time: formatAudioTimeWithSubseconds(newStart),
          x: (newStart / totalDuration) * canvasWidth,
        });
        try {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        } catch (_) {}
      } else if (clickSec > endSecRef.current) {
        const newEnd = Math.min(totalDuration, clickSec);
        onRangeChange({ startSec: startSecRef.current, endSec: newEnd });
        setDragMode("end");
        setDragTooltip({
          time: formatAudioTimeWithSubseconds(newEnd),
          x: (newEnd / totalDuration) * canvasWidth,
        });
        try {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        } catch (_) {}
      }
    }
  };

  // Pointer Move: handle drag & update cursor/tooltip
  const handleCanvasPointerMove = (_e: React.PointerEvent<HTMLCanvasElement>, pixelX: number) => {
    const startPixel = (startSecRef.current / totalDuration) * canvasWidth;
    const endPixel = (endSecRef.current / totalDuration) * canvasWidth;
    const HIT_RADIUS = 16;

    if (!dragMode) {
      if (Math.abs(pixelX - startPixel) <= HIT_RADIUS || Math.abs(pixelX - endPixel) <= HIT_RADIUS) {
        setCursor("ew-resize");
      } else if (pixelX > startPixel && pixelX < endPixel) {
        setCursor("grab");
      } else {
        setCursor("crosshair");
      }
      return;
    }

    if (dragMode === "start") {
      const newStart = Math.max(0, Math.min((pixelX / canvasWidth) * totalDuration, endSecRef.current - 0.2));
      onRangeChange({ startSec: newStart, endSec: endSecRef.current });
      setDragTooltip({
        time: formatAudioTimeWithSubseconds(newStart),
        x: (newStart / totalDuration) * canvasWidth,
      });
    } else if (dragMode === "end") {
      const newEnd = Math.min(totalDuration, Math.max((pixelX / canvasWidth) * totalDuration, startSecRef.current + 0.2));
      onRangeChange({ startSec: startSecRef.current, endSec: newEnd });
      setDragTooltip({
        time: formatAudioTimeWithSubseconds(newEnd),
        x: (newEnd / totalDuration) * canvasWidth,
      });
    } else if (dragMode === "region") {
      const deltaPixel = pixelX - dragStartXRef.current;
      const deltaSec = (deltaPixel / canvasWidth) * totalDuration;
      const orig = dragStartRangeRef.current;
      const dur = orig.endSec - orig.startSec;

      let targetStart = orig.startSec + deltaSec;
      let targetEnd = orig.endSec + deltaSec;

      if (targetStart < 0) {
        targetStart = 0;
        targetEnd = dur;
      } else if (targetEnd > totalDuration) {
        targetEnd = totalDuration;
        targetStart = totalDuration - dur;
      }

      onRangeChange({ startSec: targetStart, endSec: targetEnd });
      setDragTooltip({
        time: `${formatAudioTimeWithSubseconds(targetStart)} – ${formatAudioTimeWithSubseconds(targetEnd)}`,
        x: ((targetStart + targetEnd) / 2 / totalDuration) * canvasWidth,
      });
      setCursor("grabbing");
    }
  };

  const handleCanvasPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragMode) {
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch (_) {}
      setDragMode(null);
      setDragTooltip(null);
      setCursor("default");
    }
  };

  return (
    <div
      ref={containerRef}
      className={`relative w-full rounded-xl border border-borderDefault/90 overflow-x-auto overflow-y-hidden bg-[#0b0f17] shadow-inner select-none custom-scrollbar ${className}`}
      style={{ minHeight: `${height}px` }}
    >
      <WaveformCanvas
        peaks={peaks}
        width={canvasWidth}
        height={height}
        duration={totalDuration}
        selectionStart={startSec}
        selectionEnd={endSec}
        currentPlaySec={currentPlaySec}
        isPlaying={isPlaying}
        showRuler={true}
        showCenterLine={true}
        darkBackground={true}
        renderHandles={true}
        handleTagStart="▶"
        handleTagEnd="◀"
        cursor={cursor}
        onCanvasPointerDown={handleCanvasPointerDown}
        onCanvasPointerMove={handleCanvasPointerMove}
        onCanvasPointerUp={handleCanvasPointerUp}
      />

      {/* Floating Drag Tooltip */}
      {dragTooltip && (
        <div
          className="absolute top-7 pointer-events-none z-30 transform -translate-x-1/2 bg-surface1/95 backdrop-blur-xs text-textPrimary px-2 py-0.5 rounded-md border border-accent/40 shadow-lg text-[10px] font-mono font-bold animate-fade-in"
          style={{ left: `${dragTooltip.x}px` }}
        >
          {dragTooltip.time}
        </div>
      )}
    </div>
  );
};
