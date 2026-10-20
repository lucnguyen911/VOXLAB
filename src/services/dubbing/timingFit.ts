import { timeStretchAudioBuffer } from "../subtitle/timing";
import { decodeWavBuffer, encode16BitMonoWav } from "./audioNormalizer";
import { isTauriRuntime } from "../ai/tauriBackend";

export const MAX_DUB_SPEEDUP = 1.20;
export const DEFAULT_SAFETY_GAP_SEC = 0.02;

export interface TimingFitResult {
  speedFactor: number;
  rawDurationSec: number;
  availableDurationSec: number;
  fittedDurationSec: number;
  isStretched: boolean;
}

/**
 * Calculates WSOLA timing-fit speed factor according to SPEC.md v2.5.3:
 * - Ceiling speedup: MAX_DUB_SPEEDUP = 1.20 (duration reduction max to 83.33%).
 * - If rawDuration <= availableDuration: speedFactor = 1.0 (no stretch).
 * - If rawDuration > availableDuration: speedFactor = min(rawDuration / availableDuration, 1.20).
 * - fittedDurationSec = rawDuration / speedFactor (never fake-clamped).
 */
export function calculateTimingFit(
  rawDurationSec: number,
  availableDurationSec: number,
  maxSpeedup: number = MAX_DUB_SPEEDUP
): TimingFitResult {
  const safeRaw = Math.max(0, isNaN(rawDurationSec) ? 0 : rawDurationSec);
  const safeAvailable = Math.max(0, isNaN(availableDurationSec) ? 0 : availableDurationSec);
  // Strictly enforce MAX_DUB_SPEEDUP (1.20x) ceiling regardless of caller input
  const effectiveMaxSpeedup = Math.min(
    MAX_DUB_SPEEDUP,
    Math.max(1.0, isNaN(maxSpeedup) ? MAX_DUB_SPEEDUP : maxSpeedup)
  );

  if (safeRaw <= safeAvailable || safeAvailable <= 0) {
    return {
      speedFactor: 1.0,
      rawDurationSec: safeRaw,
      availableDurationSec: safeAvailable,
      fittedDurationSec: safeRaw,
      isStretched: false,
    };
  }

  const desiredFactor = safeRaw / safeAvailable;
  let speedFactor: number;
  let fittedDurationSec: number;

  if (desiredFactor <= effectiveMaxSpeedup) {
    speedFactor = Number(desiredFactor.toFixed(3));
    fittedDurationSec = safeAvailable;
  } else {
    speedFactor = effectiveMaxSpeedup;
    fittedDurationSec = Number((safeRaw / effectiveMaxSpeedup).toFixed(3));
  }

  return {
    speedFactor,
    rawDurationSec: safeRaw,
    availableDurationSec: safeAvailable,
    fittedDurationSec,
    isStretched: speedFactor > 1.001,
  };
}

/**
 * Pure-PCM pitch-preserving WSOLA (Waveform Similarity Overlap-Add) time-stretching.
 * Preserves full sentence ending without dropping tail samples.
 */
export function timeStretchPcmSamples(
  inData: Float32Array,
  sampleRate: number,
  speedFactor: number
): Float32Array {
  const clampedSpeed = Math.min(MAX_DUB_SPEEDUP, Math.max(0.5, speedFactor));
  if (Math.abs(clampedSpeed - 1.0) < 0.001 || inData.length === 0 || sampleRate <= 0) {
    return inData;
  }

  const inLength = inData.length;
  const targetOutLength = Math.max(1, Math.round(inLength / clampedSpeed));
  const outData = new Float32Array(targetOutLength);
  const normWeight = new Float32Array(targetOutLength);

  const winSize = Math.min(Math.max(64, Math.round(sampleRate * 0.035)), Math.max(64, Math.floor(inLength / 2)));
  const hopOut = Math.max(16, Math.round(winSize / 4));
  const hopIn = Math.max(16, Math.round(hopOut * clampedSpeed));
  const maxSearch = Math.max(8, Math.round(winSize / 2));

  const windowTable = new Float32Array(winSize);
  for (let i = 0; i < winSize; i++) {
    windowTable[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / Math.max(1, winSize - 1)));
  }

  let inPos = 0;
  let outPos = 0;

  // First frame
  for (let i = 0; i < winSize && i < inLength && i < targetOutLength; i++) {
    outData[i] = inData[i] * windowTable[i];
    normWeight[i] = windowTable[i];
  }
  inPos += hopIn;
  outPos += hopOut;

  while (outPos < targetOutLength) {
    const remainingOut = targetOutLength - outPos;
    const frameLen = Math.min(winSize, remainingOut);
    if (frameLen <= 0) break;

    const maxValidInPos = Math.max(0, inLength - frameLen);
    const centerInPos = Math.min(maxValidInPos, inPos);

    let bestOffset = 0;
    let maxCorr = -Infinity;

    const searchStart = Math.max(0, centerInPos - maxSearch);
    const searchEnd = Math.min(maxValidInPos, centerInPos + maxSearch);

    for (let cand = searchStart; cand <= searchEnd; cand += 2) {
      let corr = 0;
      for (let k = 0; k < frameLen; k += 4) {
        corr += inData[cand + k] * outData[outPos + k];
      }
      if (corr > maxCorr) {
        maxCorr = corr;
        bestOffset = cand - centerInPos;
      }
    }

    const alignPos = Math.min(maxValidInPos, Math.max(0, centerInPos + bestOffset));

    for (let i = 0; i < frameLen; i++) {
      const w = windowTable[i];
      outData[outPos + i] += inData[alignPos + i] * w;
      normWeight[outPos + i] += w;
    }

    inPos += hopIn;
    outPos += hopOut;
  }

  for (let i = 0; i < targetOutLength; i++) {
    if (normWeight[i] > 0.0001) {
      outData[i] = Math.max(-1, Math.min(1, outData[i] / normWeight[i]));
    }
  }

  return outData;
}

export interface WavStretchVerificationResult {
  wavBuffer: ArrayBuffer;
  samples: Float32Array;
  sampleRate: number;
  rawDurationSec: number;
  fittedDurationSec: number;
  appliedSpeedFactor: number;
  isStretched: boolean;
}

/**
 * Decodes a WAV byte buffer, applies pitch-preserving WSOLA time-stretch (capped at 1.20x),
 * re-encodes to 16-bit PCM WAV, and verifies the exact resulting audio duration.
 */
export function stretchWavBufferWithWsola(
  wavBytes: ArrayBuffer | Uint8Array,
  speedFactor: number
): WavStretchVerificationResult {
  const decoded = decodeWavBuffer(wavBytes);
  const clampedSpeed = Math.min(MAX_DUB_SPEEDUP, Math.max(1.0, speedFactor));

  if (clampedSpeed <= 1.001 || decoded.samples.length === 0) {
    const outBuf = encode16BitMonoWav(decoded.samples, decoded.sampleRate);
    return {
      wavBuffer: outBuf,
      samples: decoded.samples,
      sampleRate: decoded.sampleRate,
      rawDurationSec: decoded.durationSec,
      fittedDurationSec: decoded.durationSec,
      appliedSpeedFactor: 1.0,
      isStretched: false,
    };
  }

  const stretchedSamples = timeStretchPcmSamples(
    decoded.samples,
    decoded.sampleRate,
    clampedSpeed
  );
  const wavBuffer = encode16BitMonoWav(stretchedSamples, decoded.sampleRate);
  const verifiedDecoded = decodeWavBuffer(wavBuffer);

  return {
    wavBuffer,
    samples: stretchedSamples,
    sampleRate: decoded.sampleRate,
    rawDurationSec: decoded.durationSec,
    fittedDurationSec: verifiedDecoded.durationSec,
    appliedSpeedFactor: Number(clampedSpeed.toFixed(3)),
    isStretched: true,
  };
}

export interface WavFileIoAdapter {
  readBytes: (path: string) => Promise<Uint8Array | ArrayBuffer>;
  writeBytes: (path: string, bytes: Uint8Array) => Promise<void>;
}

/**
 * Applies WSOLA pitch-preserving time-stretch directly onto a WAV file on disk
 * and verifies the post-stretch duration from the written WAV container.
 */
export async function applyWsolaTimeStretchToWavFile(
  wavPath: string,
  speedFactor: number,
  fileIo?: WavFileIoAdapter
): Promise<WavStretchVerificationResult | null> {
  if (!wavPath) return null;
  try {
    let bytes: Uint8Array | null = null;
    if (fileIo) {
      const raw = await fileIo.readBytes(wavPath);
      bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    } else if (isTauriRuntime()) {
      const { invoke } = await import("@tauri-apps/api/core");
      const raw = await invoke<ArrayBuffer | Uint8Array | number[]>("fs_read_bytes", {
        path: wavPath,
      });
      bytes =
        raw instanceof ArrayBuffer
          ? new Uint8Array(raw)
          : raw instanceof Uint8Array
          ? raw
          : new Uint8Array(raw);
    }

    if (!bytes || bytes.byteLength < 44) {
      return null;
    }

    const result = stretchWavBufferWithWsola(bytes, speedFactor);
    if (result.isStretched) {
      const outBytes = new Uint8Array(result.wavBuffer);
      if (fileIo) {
        await fileIo.writeBytes(wavPath, outBytes);
      } else if (isTauriRuntime()) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("fs_write_bytes", {
          path: wavPath,
          bytes: Array.from(outBytes),
        });
      }
    }
    return result;
  } catch (err) {
    console.warn("[timingFit] Could not apply WSOLA stretch to WAV file:", err);
    return null;
  }
}

/**
 * Applies pitch-preserving WSOLA time-stretch to an AudioBuffer if speedFactor > 1.001.
 */
export function stretchAudioBufferForDubbing(
  inputBuffer: AudioBuffer,
  speedFactor: number
): AudioBuffer {
  const clamped = Math.min(MAX_DUB_SPEEDUP, Math.max(0.5, speedFactor));
  if (Math.abs(clamped - 1.0) < 0.001) {
    return inputBuffer;
  }
  return timeStretchAudioBuffer(inputBuffer, clamped);
}
