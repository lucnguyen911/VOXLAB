/**
 * Audio DSP & Quality Analysis Engine for Voice Cloning
 * 
 * Provides real Web Audio decoding, PCM buffer slicing, WAV blob encoding,
 * peak extraction, and strict, non-synthetic audio quality checking.
 * Zero external dependencies.
 */

export interface QualityMetricDetail {
  id: "duration" | "clipping" | "silence" | "channels" | "sampleRate";
  label: string;
  status: "pass" | "warning" | "error";
  value: string;
  description: string;
}

export interface AudioQualityReport {
  status: "good" | "warning" | "poor";
  statusText: string;
  durationSec: number;
  sampleRate: number;
  numberOfChannels: number;
  clippingCount: number;
  clippingRatio: number;
  silenceRatio: number;
  details: QualityMetricDetail[];
}

/**
 * Creates an AudioContext safely in browser / Tauri environments
 */
export function getOrCreateAudioContext(): AudioContext {
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) {
    throw new Error("Web Audio API không được hỗ trợ trên môi trường này");
  }
  return new AudioCtx();
}

/**
 * Decodes an uploaded audio File/Blob into a decoded PCM AudioBuffer
 */
export async function decodeAudioFile(
  file: File | Blob
): Promise<{ buffer: AudioBuffer; objectUrl: string }> {
  const arrayBuffer = await file.arrayBuffer();
  const ctx = getOrCreateAudioContext();
  const buffer = await ctx.decodeAudioData(arrayBuffer);
  const objectUrl = URL.createObjectURL(file);
  return { buffer, objectUrl };
}

/**
 * Analyzes decoded audio buffer for true voice cloning suitability.
 * NO fake or synthetic scores.
 */
export function analyzeAudioQuality(buffer: AudioBuffer): AudioQualityReport {
  const durationSec = buffer.duration;
  const sampleRate = buffer.sampleRate;
  const numberOfChannels = buffer.numberOfChannels;
  const totalSamples = buffer.length;

  const details: QualityMetricDetail[] = [];

  // 1. Duration Analysis (Recommended: 10s - 30s)
  let durationStatus: "pass" | "warning" | "error" = "pass";
  let durationDesc = "Thời lượng lý tưởng cho Zero-Shot Voice Cloning (10s – 30s)";

  if (durationSec < 3.0) {
    durationStatus = "error";
    durationDesc = "Mẫu quá ngắn (tối thiểu 3.0 giây). Mô hình không đủ dữ liệu trích xuất timbre.";
  } else if (durationSec < 10.0) {
    durationStatus = "warning";
    durationDesc = "Hơi ngắn (khuyến nghị từ 10s – 30s để chất lượng clone tốt nhất).";
  } else if (durationSec > 60.0) {
    durationStatus = "warning";
    durationDesc = "Khá dài (> 60s). Nên dùng công cụ Cắt âm thanh để chọn đoạn sạch 10s – 30s.";
  }

  details.push({
    id: "duration",
    label: "Thời lượng",
    status: durationStatus,
    value: `${durationSec.toFixed(1)}s`,
    description: durationDesc,
  });

  // 2. Real Clipping Detection on primary channel
  const channelData = buffer.getChannelData(0);
  let clippingCount = 0;
  const clipThreshold = 0.995;

  for (let i = 0; i < totalSamples; i++) {
    if (Math.abs(channelData[i]) >= clipThreshold) {
      clippingCount++;
    }
  }

  const clippingRatio = totalSamples > 0 ? clippingCount / totalSamples : 0;
  let clippingStatus: "pass" | "warning" | "error" = "pass";
  let clippingDesc = "Không phát hiện hiện tượng vỡ âm (clipping)";

  if (clippingRatio > 0.005) {
    clippingStatus = "error";
    clippingDesc = `Phát hiện vỡ âm nặng (${(clippingRatio * 100).toFixed(2)}% mẫu vượt ngưỡng). Âm thanh có thể bị rè.`;
  } else if (clippingCount > 20) {
    clippingStatus = "warning";
    clippingDesc = `Phát hiện ${clippingCount} vị trí biên độ chạm trần. Nên kiểm tra âm lượng đầu vào.`;
  }

  details.push({
    id: "clipping",
    label: "Hiện tượng vỡ âm",
    status: clippingStatus,
    value: clippingCount === 0 ? "0 mẫu chạm trần" : `${clippingCount} mẫu (${(clippingRatio * 100).toFixed(2)}%)`,
    description: clippingDesc,
  });

  // 3. Real Silence Ratio Analysis using RMS energy per frame
  const frameSize = 2048;
  const totalFrames = Math.floor(totalSamples / frameSize);
  let silentFrames = 0;
  const silenceRmsThreshold = 0.006; // Approx -44.4 dB

  for (let f = 0; f < totalFrames; f++) {
    let sumSq = 0;
    const offset = f * frameSize;
    for (let i = 0; i < frameSize; i++) {
      const val = channelData[offset + i];
      sumSq += val * val;
    }
    const rms = Math.sqrt(sumSq / frameSize);
    if (rms < silenceRmsThreshold) {
      silentFrames++;
    }
  }

  const silenceRatio = totalFrames > 0 ? silentFrames / totalFrames : 0;
  let silenceStatus: "pass" | "warning" | "error" = "pass";
  let silenceDesc = "Mật độ lời thoại dày dặn, ít khoảng chết";

  if (silenceRatio > 0.45) {
    silenceStatus = "warning";
    silenceDesc = `Khoảng lặng chiếm ${Math.round(silenceRatio * 100)}% thời lượng. Nên cắt bớt đoạn im lặng.`;
  }

  details.push({
    id: "silence",
    label: "Tỷ lệ khoảng lặng",
    status: silenceStatus,
    value: `${Math.round(silenceRatio * 100)}%`,
    description: silenceDesc,
  });

  // 4. Channels check
  details.push({
    id: "channels",
    label: "Kênh âm thanh",
    status: "pass",
    value: numberOfChannels === 1 ? "Mono" : "Stereo (2 kênh)",
    description: numberOfChannels === 1 
      ? "Kênh Mono tiêu chuẩn, tối ưu cho xử lý giọng nói AI"
      : "Stereo (sẽ được trích xuất kênh chính khi nạp mô hình)",
  });

  // 5. Sample Rate check
  let srStatus: "pass" | "warning" | "error" = "pass";
  if (sampleRate < 22050) {
    srStatus = "warning";
  }

  details.push({
    id: "sampleRate",
    label: "Tần số lấy mẫu",
    status: srStatus,
    value: `${(sampleRate / 1000).toFixed(1)} kHz`,
    description: srStatus === "pass" 
      ? "Tần số lấy mẫu đạt chuẩn chất lượng cao"
      : "Tần số lấy mẫu thấp, âm thanh có thể thiếu chi tiết tần số cao",
  });

  // Aggregate Overall Status
  let status: "good" | "warning" | "poor" = "good";
  let statusText = "Chất lượng mẫu: Tốt";

  if (durationStatus === "error" || clippingStatus === "error") {
    status = "poor";
    statusText = "Chất lượng mẫu: Chưa đạt";
  } else if (durationStatus === "warning" || clippingStatus === "warning" || silenceStatus === "warning" || srStatus === "warning") {
    status = "warning";
    statusText = "Chất lượng mẫu: Cần kiểm tra";
  }

  return {
    status,
    statusText,
    durationSec,
    sampleRate,
    numberOfChannels,
    clippingCount,
    clippingRatio,
    silenceRatio,
    details,
  };
}

/**
 * Extracts normalized peak bars for waveform rendering
 */
export function extractWaveformPeaks(
  buffer: AudioBuffer,
  numPeaks: number = 60
): number[] {
  const channelData = buffer.getChannelData(0);
  const totalSamples = channelData.length;
  if (totalSamples === 0) return Array(numPeaks).fill(0.2);

  const bucketSize = Math.floor(totalSamples / numPeaks);
  const peaks: number[] = [];

  for (let b = 0; b < numPeaks; b++) {
    const start = b * bucketSize;
    const end = Math.min(totalSamples, start + bucketSize);
    let max = 0;
    for (let i = start; i < end; i++) {
      const abs = Math.abs(channelData[i]);
      if (abs > max) max = abs;
    }
    // Normalize and clamp between 0.1 and 1.0 for aesthetic UI rendering
    const clamped = Math.max(0.12, Math.min(1.0, max * 1.15));
    peaks.push(clamped);
  }

  return peaks;
}

export interface WaveformMinMaxPeak {
  min: number;
  max: number;
}

// Memory-safe WeakMap cache for downsampled peaks per AudioBuffer and bucket count
const peaksCache = new WeakMap<AudioBuffer, Map<number, WaveformMinMaxPeak[]>>();

// Cache for decoded AudioBuffers by source URL or ID to avoid decoding multiple times
const audioBufferCache = new Map<string, AudioBuffer>();

/**
 * Computes true PCM min/max amplitude peaks for high-density waveform rendering.
 * Uses WeakMap cache to eliminate redundant computation across component re-renders.
 * Does not artificially clamp silence to a decorative threshold.
 */
export function extractMinMaxPeaks(
  buffer: AudioBuffer,
  numBuckets: number
): WaveformMinMaxPeak[] {
  if (!buffer || numBuckets <= 0) return [];

  let bucketMap = peaksCache.get(buffer);
  if (!bucketMap) {
    bucketMap = new Map<number, WaveformMinMaxPeak[]>();
    peaksCache.set(buffer, bucketMap);
  }

  const cached = bucketMap.get(numBuckets);
  if (cached) return cached;

  const channelData = buffer.getChannelData(0);
  const totalSamples = channelData.length;
  if (totalSamples === 0) return [];

  const bucketSize = totalSamples / numBuckets;
  const peaks: WaveformMinMaxPeak[] = new Array(numBuckets);

  for (let b = 0; b < numBuckets; b++) {
    const start = Math.floor(b * bucketSize);
    const end = Math.min(totalSamples, Math.floor((b + 1) * bucketSize));
    let min = 0;
    let max = 0;
    for (let i = start; i < end; i++) {
      const val = channelData[i];
      if (val < min) min = val;
      if (val > max) max = val;
    }
    peaks[b] = { min, max };
  }

  bucketMap.set(numBuckets, peaks);
  return peaks;
}

/**
 * Retrieves a cached AudioBuffer or registers an existing one
 */
export function cacheAudioBuffer(key: string, buffer: AudioBuffer): void {
  audioBufferCache.set(key, buffer);
}

/**
 * Gets a cached AudioBuffer if available
 */
export function getCachedAudioBuffer(key: string): AudioBuffer | undefined {
  return audioBufferCache.get(key);
}


/**
 * Slices a time region [startSec, endSec] from an AudioBuffer non-destructively
 */
export function sliceAudioBuffer(
  buffer: AudioBuffer,
  startSec: number,
  endSec: number
): AudioBuffer {
  const ctx = getOrCreateAudioContext();
  const safeStart = Math.max(0, Math.min(startSec, buffer.duration));
  const safeEnd = Math.max(safeStart + 0.1, Math.min(endSec, buffer.duration));

  const startOffset = Math.floor(safeStart * buffer.sampleRate);
  const endOffset = Math.floor(safeEnd * buffer.sampleRate);
  const frameLength = Math.max(1, endOffset - startOffset);

  const sliced = ctx.createBuffer(
    buffer.numberOfChannels,
    frameLength,
    buffer.sampleRate
  );

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dest = sliced.getChannelData(ch);
    for (let i = 0; i < frameLength; i++) {
      dest[i] = src[startOffset + i] || 0;
    }
  }

  return sliced;
}

/**
 * Encodes an AudioBuffer into an uncompressed 16-bit PCM WAV Blob
 * Zero external libraries needed.
 */
export function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const outBuffer = new ArrayBuffer(length);
  const view = new DataView(outBuffer);
  const channels: Float32Array[] = [];
  let offset = 0;
  let pos = 0;

  function setUint16(data: number) {
    view.setUint16(pos, data, true);
    pos += 2;
  }

  function setUint32(data: number) {
    view.setUint32(pos, data, true);
    pos += 4;
  }

  // RIFF identifier
  setUint32(0x46464952); // "RIFF"
  setUint32(length - 8); // file length - 8
  setUint32(0x45564157); // "WAVE"

  // Format chunk identifier
  setUint32(0x20746d66); // "fmt " chunk
  setUint32(16); // format size (16 for PCM)
  setUint16(1); // linear PCM
  setUint16(numOfChan);
  setUint32(buffer.sampleRate);
  setUint32(buffer.sampleRate * 2 * numOfChan); // byte rate
  setUint16(numOfChan * 2); // block align
  setUint16(16); // 16 bits per sample

  // Data chunk identifier
  setUint32(0x61746164); // "data" chunk
  setUint32(length - pos - 4); // chunk length

  // Interleave and write 16-bit PCM samples
  for (let i = 0; i < buffer.numberOfChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  while (offset < buffer.length) {
    for (let i = 0; i < numOfChan; i++) {
      let sample = Math.max(-1, Math.min(1, channels[i][offset]));
      // Convert float sample [-1.0, 1.0] to signed 16-bit integer
      sample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(pos, sample, true);
      pos += 2;
    }
    offset++;
  }

  return new Blob([outBuffer], { type: "audio/wav" });
}

/**
 * Format seconds to MM:SS or SS.S display
 */
export function formatAudioTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return "00:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

/**
 * Format seconds to MM:SS.s display with tenths of a second (e.g. 00:04.2)
 */
export function formatAudioTimeWithSubseconds(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return "00:00.0";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const tenths = Math.floor((seconds % 1) * 10);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${tenths}`;
}

