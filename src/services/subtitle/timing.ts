import { WhisperSegment, WhisperWord, SpeechUnit } from "./types";
import { getOrCreateAudioContext } from "../audio/audioDsp";

/**
 * Formula: original_time = processed_time * speed_factor
 * Example: speed_factor = 0.8, processed 50s -> original 40s.
 */
export function remapTimestampToOriginal(
  processedSec: number,
  speedFactor: number
): number {
  if (Math.abs(speedFactor - 1.0) < 0.0001) {
    return processedSec;
  }
  return Number((processedSec * speedFactor).toFixed(3));
}

/**
 * Remaps all Whisper segment and word timestamps from the slowed timeline back to the original audio timeline.
 * Must be executed BEFORE speech units and subtitle cues are constructed.
 */
export function remapWhisperOutputToOriginalTimeline(
  segments: WhisperSegment[],
  speedFactor: number
): WhisperSegment[] {
  if (Math.abs(speedFactor - 1.0) < 0.0001) {
    return segments;
  }

  return segments.map((seg) => {
    const remappedStart = remapTimestampToOriginal(seg.startSec, speedFactor);
    const remappedEnd = remapTimestampToOriginal(seg.endSec, speedFactor);

    let remappedWords: WhisperWord[] | undefined = undefined;
    if (seg.words && seg.words.length > 0) {
      remappedWords = seg.words.map((w) => ({
        ...w,
        startSec: remapTimestampToOriginal(w.startSec, speedFactor),
        endSec: remapTimestampToOriginal(w.endSec, speedFactor),
      }));
    }

    return {
      ...seg,
      startSec: remappedStart,
      endSec: remappedEnd,
      words: remappedWords,
    };
  });
}

/**
 * Remaps SpeechUnits back to original audio timeline if they were generated on slowed audio.
 */
export function remapSpeechUnitsToOriginalTimeline(
  units: SpeechUnit[],
  speedFactor: number
): SpeechUnit[] {
  if (Math.abs(speedFactor - 1.0) < 0.0001) {
    return units;
  }

  return units.map((u) => {
    const startSec = remapTimestampToOriginal(u.startSec, speedFactor);
    const endSec = remapTimestampToOriginal(u.endSec, speedFactor);
    return {
      ...u,
      startSec,
      endSec,
      durationSec: Math.max(0.1, Number((endSec - startSec).toFixed(3))),
      pauseAfterSec: u.pauseAfterSec
        ? remapTimestampToOriginal(u.pauseAfterSec, speedFactor)
        : undefined,
    };
  });
}

/**
 * High-quality Pitch-Preserving Audio Time-Stretching using WSOLA
 * (Waveform Similarity Overlap-Add).
 *
 * Slower playback (0.8x / 0.9x) extends audio duration without lowering pitch or distorting speech.
 * Zero external dependencies, pure Web Audio PCM math.
 *
 * @param inputBuffer Decoded AudioBuffer
 * @param speedFactor Speed factor (e.g. 1.0, 0.9, 0.8). Target duration = duration / speedFactor.
 */
export function timeStretchAudioBuffer(
  inputBuffer: AudioBuffer,
  speedFactor: number
): AudioBuffer {
  // If 1.0x, return original immediately
  if (Math.abs(speedFactor - 1.0) < 0.001) {
    return inputBuffer;
  }

  const ctx = getOrCreateAudioContext();
  const sampleRate = inputBuffer.sampleRate;
  const numChannels = inputBuffer.numberOfChannels;
  const inLength = inputBuffer.length;

  // Output duration is stretched: stretchRatio = 1 / speedFactor
  const stretchRatio = 1 / speedFactor;
  const targetOutLength = Math.round(inLength * stretchRatio);

  const outBuffer = ctx.createBuffer(numChannels, targetOutLength, sampleRate);

  // WSOLA parameters optimized for 16kHz - 48kHz speech
  const winSize = Math.round(sampleRate * 0.035); // 35ms frame window
  const hopOut = Math.round(winSize / 4); // Synthesis step (overlap 75%)
  const hopIn = Math.round(hopOut * speedFactor); // Analysis step
  const maxSearch = Math.round(winSize / 2); // Search range for similarity alignment

  // Precompute Hann window
  const windowTable = new Float32Array(winSize);
  for (let i = 0; i < winSize; i++) {
    windowTable[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (winSize - 1)));
  }

  for (let ch = 0; ch < numChannels; ch++) {
    const inData = inputBuffer.getChannelData(ch);
    const outData = outBuffer.getChannelData(ch);
    const normWeight = new Float32Array(targetOutLength);

    let inPos = 0;
    let outPos = 0;

    // First frame copy
    for (let i = 0; i < winSize && i < inLength; i++) {
      outData[i] = inData[i] * windowTable[i];
      normWeight[i] = windowTable[i];
    }
    inPos += hopIn;
    outPos += hopOut;

    while (outPos + winSize < targetOutLength && inPos + winSize + maxSearch < inLength) {
      // Find best alignment offset around inPos using normalized cross-correlation
      let bestOffset = 0;
      let maxCorr = -Infinity;

      const searchStart = Math.max(0, inPos - maxSearch);
      const searchEnd = Math.min(inLength - winSize, inPos + maxSearch);

      // Correlation reference: tail of already synthesized signal
      for (let cand = searchStart; cand <= searchEnd; cand += 2) {
        let corr = 0;
        // Fast correlation over sample subset
        for (let k = 0; k < winSize; k += 4) {
          corr += inData[cand + k] * outData[outPos + k];
        }
        if (corr > maxCorr) {
          maxCorr = corr;
          bestOffset = cand - inPos;
        }
      }

      const alignPos = inPos + bestOffset;

      // Overlap-add windowed frame
      for (let i = 0; i < winSize; i++) {
        const sample = inData[alignPos + i] * windowTable[i];
        outData[outPos + i] += sample;
        normWeight[outPos + i] += windowTable[i];
      }

      inPos += hopIn;
      outPos += hopOut;
    }

    // Normalize output amplitude by overlapping window weight
    for (let i = 0; i < targetOutLength; i++) {
      if (normWeight[i] > 0.001) {
        outData[i] = outData[i] / normWeight[i];
      }
    }
  }

  return outBuffer;
}
