import { timeStretchAudioBuffer } from "../subtitle/timing";

export const MAX_DUB_SPEEDUP = 1.20;

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
 * - fittedDurationSec = rawDuration / speedFactor.
 */
export function calculateTimingFit(
  rawDurationSec: number,
  availableDurationSec: number,
  maxSpeedup: number = MAX_DUB_SPEEDUP
): TimingFitResult {
  const safeRaw = Math.max(0, isNaN(rawDurationSec) ? 0 : rawDurationSec);
  const safeAvailable = Math.max(0, isNaN(availableDurationSec) ? 0 : availableDurationSec);

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

  if (desiredFactor <= maxSpeedup) {
    speedFactor = Number(desiredFactor.toFixed(3));
    fittedDurationSec = safeAvailable;
  } else {
    speedFactor = maxSpeedup;
    fittedDurationSec = Number((safeRaw / maxSpeedup).toFixed(3));
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
 * Applies pitch-preserving WSOLA time-stretch to an AudioBuffer if speedFactor > 1.001.
 */
export function stretchAudioBufferForDubbing(
  inputBuffer: AudioBuffer,
  speedFactor: number
): AudioBuffer {
  if (Math.abs(speedFactor - 1.0) < 0.001) {
    return inputBuffer;
  }
  return timeStretchAudioBuffer(inputBuffer, speedFactor);
}
