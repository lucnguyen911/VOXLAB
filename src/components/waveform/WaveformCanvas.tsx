import React, { useEffect, useRef } from "react";
import { WaveformMinMaxPeak } from "../../services/audio/audioDsp";

export interface WaveformCanvasProps {
  peaks: WaveformMinMaxPeak[];
  width: number;
  height: number;
  duration: number;
  selectionStart?: number;
  selectionEnd?: number;
  currentPlaySec?: number;
  isPlaying?: boolean;
  showRuler?: boolean;
  showCenterLine?: boolean;
  darkBackground?: boolean;
  renderHandles?: boolean;
  handleTagStart?: string;
  handleTagEnd?: string;
  onCanvasPointerDown?: (e: React.PointerEvent<HTMLCanvasElement>, pixelX: number) => void;
  onCanvasPointerMove?: (e: React.PointerEvent<HTMLCanvasElement>, pixelX: number) => void;
  onCanvasPointerUp?: (e: React.PointerEvent<HTMLCanvasElement>, pixelX: number) => void;
  cursor?: string;
  className?: string;
}

export const WaveformCanvas: React.FC<WaveformCanvasProps> = ({
  peaks,
  width,
  height,
  duration,
  selectionStart,
  selectionEnd,
  currentPlaySec,
  isPlaying = false,
  showRuler = false,
  showCenterLine = true,
  darkBackground = false,
  renderHandles = false,
  handleTagStart = "▶",
  handleTagEnd = "◀",
  onCanvasPointerDown,
  onCanvasPointerMove,
  onCanvasPointerUp,
  cursor = "default",
  className = "",
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Detect active theme from DOM tree
    const isLight = document.documentElement.classList.contains("light") ||
      document.body.classList.contains("light");

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

    // Scale canvas buffer by DPR for razor-sharp HiDPI lines
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);

    ctx.save();
    ctx.scale(dpr, dpr);

    // Color theme resolution
    const colors = isLight
      ? {
          bg: darkBackground ? "#0E1828" : "#F0F4F8",
          rulerBg: "rgba(240, 244, 248, 0.95)",
          rulerBorder: "rgba(0, 0, 0, 0.08)",
          rulerText: "rgba(74, 85, 104, 0.75)",
          rulerMajorTick: "rgba(74, 85, 104, 0.4)",
          rulerMinorTick: "rgba(74, 85, 104, 0.2)",
          centerLine: "rgba(0, 0, 0, 0.07)",
          peakNormal: darkBackground ? "#38BDF8" : "#0284C7",
          peakDim: "rgba(100, 116, 139, 0.35)",
          dimOverlay: darkBackground ? "rgba(11, 18, 32, 0.65)" : "rgba(245, 247, 250, 0.65)",
          selectionBorder: darkBackground ? "rgba(56, 189, 248, 0.85)" : "rgba(2, 132, 199, 0.85)",
          handleAccent: darkBackground ? "#38BDF8" : "#0284C7",
          handleText: "#FFFFFF",
          playhead: "#DC2626",
        }
      : {
          bg: darkBackground ? "#0B0F17" : "transparent",
          rulerBg: "rgba(15, 23, 42, 0.95)",
          rulerBorder: "rgba(255, 255, 255, 0.08)",
          rulerText: "rgba(148, 163, 184, 0.65)",
          rulerMajorTick: "rgba(148, 163, 184, 0.4)",
          rulerMinorTick: "rgba(148, 163, 184, 0.15)",
          centerLine: "rgba(255, 255, 255, 0.06)",
          peakNormal: "#38BDF8",
          peakDim: "rgba(148, 163, 184, 0.26)",
          dimOverlay: "rgba(11, 15, 23, 0.68)",
          selectionBorder: "rgba(56, 189, 248, 0.85)",
          handleAccent: "#38BDF8",
          handleText: "#0B0F17",
          playhead: "#F43F5E",
        };

    // 1. Canvas Background
    if (darkBackground) {
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, width, height);
    } else {
      ctx.clearRect(0, 0, width, height);
    }

    const rulerHeight = showRuler ? 22 : 0;

    // 2. Time Ruler Bar
    if (showRuler) {
      ctx.fillStyle = colors.rulerBg;
      ctx.fillRect(0, 0, width, rulerHeight);

      ctx.strokeStyle = colors.rulerBorder;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, rulerHeight);
      ctx.lineTo(width, rulerHeight);
      ctx.stroke();

      const secPixel = width / Math.max(0.1, duration);
      ctx.fillStyle = colors.rulerText;
      ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
      ctx.textBaseline = "middle";

      const zoomFactor = width / Math.max(1, canvas.parentElement?.clientWidth || width);
      const stepSec = duration > 60 ? (zoomFactor > 2 ? 2 : 5) : (zoomFactor > 2.5 ? 0.5 : (zoomFactor > 1.5 ? 1 : 2));

      for (let s = 0; s <= duration; s += stepSec) {
        const x = s * secPixel;
        if (x > width) break;

        const isMajor = Math.round(s * 10) % (stepSec * 10) === 0;
        ctx.strokeStyle = isMajor ? colors.rulerMajorTick : colors.rulerMinorTick;
        ctx.beginPath();
        ctx.moveTo(x, rulerHeight - (isMajor ? 8 : 4));
        ctx.lineTo(x, rulerHeight);
        ctx.stroke();

        if (isMajor && x < width - 32) {
          const mins = Math.floor(s / 60);
          const secs = (s % 60).toFixed(s % 1 === 0 ? 0 : 1);
          const label = `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(s % 1 === 0 ? 2 : 4, "0")}`;
          ctx.fillText(label, x + 3, 11);
        }
      }
    }

    // 3. Waveform Metrics
    const waveTop = rulerHeight + 4;
    const waveBottom = height - 4;
    const centerY = waveTop + (waveBottom - waveTop) / 2;
    const waveHalfH = (waveBottom - waveTop) / 2;

    // Center Reference Line
    if (showCenterLine) {
      ctx.strokeStyle = colors.centerLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(width, centerY);
      ctx.stroke();
    }

    const hasSelection = selectionStart !== undefined && selectionEnd !== undefined;
    const startPixel = hasSelection ? (selectionStart! / duration) * width : 0;
    const endPixel = hasSelection ? (selectionEnd! / duration) * width : width;

    // 4. Render High-Density Peaks
    const numPeaks = peaks.length;
    if (numPeaks > 0) {
      const stepX = width / numPeaks;
      const barWidth = Math.max(1, stepX - 0.35);

      const playPixel =
        currentPlaySec !== undefined && currentPlaySec > 0
          ? (currentPlaySec / Math.max(0.1, duration)) * width
          : -1;

      for (let i = 0; i < numPeaks; i++) {
        const x = i * stepX;
        const peak = peaks[i];
        const isSelected = hasSelection ? (x >= startPixel && x <= endPixel) : true;
        const isPlayed = playPixel > 0 && x <= playPixel;

        const top = centerY - Math.max(0.5, peak.max * waveHalfH);
        const bottom = centerY - Math.min(-0.5, peak.min * waveHalfH);

        ctx.strokeStyle = isPlayed
          ? (darkBackground ? "#38bdf8" : "#0284c7")
          : isSelected
          ? colors.peakNormal
          : colors.peakDim;
        ctx.lineWidth = barWidth;
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
      }

      // 5. Dim Outside Regions & Boundary Accents
      if (hasSelection) {
        ctx.fillStyle = colors.dimOverlay;
        if (startPixel > 0) {
          ctx.fillRect(0, rulerHeight, startPixel, height - rulerHeight);
        }
        if (endPixel < width) {
          ctx.fillRect(endPixel, rulerHeight, width - endPixel, height - rulerHeight);
        }

        // Top & bottom selection accent borders
        ctx.strokeStyle = colors.selectionBorder;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(startPixel, rulerHeight);
        ctx.lineTo(endPixel, rulerHeight);
        ctx.moveTo(startPixel, height - 1);
        ctx.lineTo(endPixel, height - 1);
        ctx.stroke();
      }

      // 6. Optional Drag Handles (for Editor)
      if (renderHandles && hasSelection) {
        const startTagX = Math.max(9, Math.min(width - 9, startPixel));
        const endTagX = Math.max(9, Math.min(width - 9, endPixel));

        // START Handle Line
        ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(startPixel, rulerHeight);
        ctx.lineTo(startPixel, height);
        ctx.stroke();

        ctx.strokeStyle = colors.handleAccent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(startPixel, rulerHeight);
        ctx.lineTo(startPixel, height);
        ctx.stroke();

        // Start Top Cap
        ctx.fillStyle = colors.handleAccent;
        ctx.beginPath();
        ctx.roundRect(startTagX - 8, 3, 16, 18, 4);
        ctx.fill();

        ctx.fillStyle = colors.handleText;
        ctx.font = "bold 9px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(handleTagStart, startTagX, 12);

        // Start Bottom Anchor
        ctx.fillStyle = colors.handleAccent;
        ctx.beginPath();
        ctx.roundRect(startTagX - 5, height - 9, 10, 8, 2);
        ctx.fill();

        // END Handle Line
        ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(endPixel, rulerHeight);
        ctx.lineTo(endPixel, height);
        ctx.stroke();

        ctx.strokeStyle = colors.handleAccent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(endPixel, rulerHeight);
        ctx.lineTo(endPixel, height);
        ctx.stroke();

        // End Top Cap
        ctx.fillStyle = colors.handleAccent;
        ctx.beginPath();
        ctx.roundRect(endTagX - 8, 3, 16, 18, 4);
        ctx.fill();

        ctx.fillStyle = colors.handleText;
        ctx.font = "bold 9px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(handleTagEnd, endTagX, 12);

        // End Bottom Anchor
        ctx.fillStyle = colors.handleAccent;
        ctx.beginPath();
        ctx.roundRect(endTagX - 5, height - 9, 10, 8, 2);
        ctx.fill();
      }
    }

    // 7. Playhead Scrubber Line
    if (isPlaying || (currentPlaySec !== undefined && currentPlaySec > 0)) {
      const playPixel = ((currentPlaySec || 0) / duration) * width;
      ctx.strokeStyle = colors.playhead;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playPixel, 0);
      ctx.lineTo(playPixel, height);
      ctx.stroke();

      ctx.fillStyle = colors.playhead;
      ctx.beginPath();
      ctx.arc(playPixel, 6, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }, [
    peaks,
    width,
    height,
    duration,
    selectionStart,
    selectionEnd,
    currentPlaySec,
    isPlaying,
    showRuler,
    showCenterLine,
    darkBackground,
    renderHandles,
    handleTagStart,
    handleTagEnd,
  ]);

  const getPixelX = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return e.clientX - rect.left;
  };

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        cursor,
        display: "block",
      }}
      className={className}
      onPointerDown={(e) => onCanvasPointerDown?.(e, getPixelX(e))}
      onPointerMove={(e) => onCanvasPointerMove?.(e, getPixelX(e))}
      onPointerUp={(e) => onCanvasPointerUp?.(e, getPixelX(e))}
      onPointerCancel={(e) => onCanvasPointerUp?.(e, getPixelX(e))}
    />
  );
};
