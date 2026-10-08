import { DialogueSegment, DialogueGlobalSettings } from "../../types/dialogue";
import {
  detectTrailingSilenceMs,
  detectLeadingSilenceMs,
} from "../pause/punctuationPause";

export interface DialogueTimelineEntry {
  segmentId: string;
  index: number;
  characterName: string;
  characterId: string;
  text: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  pauseAfterSec: number;
}

export interface DialogueAssemblyPlan {
  timeline: DialogueTimelineEntry[];
  totalDurationSec: number;
}

export interface TurnPauseRange {
  minSec: number;
  maxSec: number;
}

/**
 * Resolves Turn Pause Min & Max range from global settings, batch snapshot, or legacy config.
 * Precedence:
 * 1. turnPauseMinSec & turnPauseMaxSec (explicit range)
 * 2. Legacy turnPauseSec (fixed gap: min = max = turnPauseSec, including 0)
 * 3. Default fallback: min = 0.40, max = 0.70
 */
export function resolveTurnPauseRange(settings?: {
  turnPauseMinSec?: number;
  turnPauseMaxSec?: number;
  turnPauseSec?: number;
}): TurnPauseRange {
  if (!settings) {
    return { minSec: 0.40, maxSec: 0.70 };
  }

  const hasMin = typeof settings.turnPauseMinSec === "number" && !isNaN(settings.turnPauseMinSec);
  const hasMax = typeof settings.turnPauseMaxSec === "number" && !isNaN(settings.turnPauseMaxSec);
  const hasLegacy =
    typeof settings.turnPauseSec === "number" &&
    !isNaN(settings.turnPauseSec) &&
    settings.turnPauseSec > 0;

  // If caller explicitly provided positive legacy turnPauseSec and min/max are either missing or untouched defaults
  if (hasLegacy && (!hasMin || !hasMax || (settings.turnPauseMinSec === 0.40 && settings.turnPauseMaxSec === 0.70))) {
    const legacy = Math.max(0, Math.min(2.0, settings.turnPauseSec!));
    return { minSec: legacy, maxSec: legacy };
  }

  if (hasMin && hasMax) {
    let min = Math.max(0, Math.min(2.0, settings.turnPauseMinSec!));
    let max = Math.max(0, Math.min(2.0, settings.turnPauseMaxSec!));
    if (min > max) {
      max = min;
    }
    return { minSec: min, maxSec: max };
  }

  // If caller only provided legacy turnPauseSec without min/max
  if (typeof settings.turnPauseSec === "number" && !isNaN(settings.turnPauseSec)) {
    const legacy = Math.max(0, Math.min(2.0, settings.turnPauseSec!));
    return { minSec: legacy, maxSec: legacy };
  }

  if (hasMin) {
    const min = Math.max(0, Math.min(2.0, settings.turnPauseMinSec!));
    return { minSec: min, maxSec: Math.max(min, 0.70) };
  }

  if (hasMax) {
    const max = Math.max(0, Math.min(2.0, settings.turnPauseMaxSec!));
    return { minSec: Math.min(max, 0.40), maxSec: max };
  }

  if (hasLegacy) {
    const legacy = Math.max(0, Math.min(2.0, settings.turnPauseSec!));
    return { minSec: legacy, maxSec: legacy };
  }

  return { minSec: 0.40, maxSec: 0.70 };
}

/**
 * Quick agreement / acknowledgment phrases in Vietnamese and English
 * that typically elicit faster turn transitions.
 */
const QUICK_RESPONSE_PATTERN =
  /^(vâng|dạ|dạ vâng|ừ|ừm|đúng|đúng vậy|chính xác|rõ rồi|đồng ý|không|thôi|được|ok|okay|yes|yeah|sure|right|exactly|no|nope)[.!?,…\s]*$/i;

/**
 * Calculates a natural turn-taking pause between two conversational utterances
 * based on punctuation, sentence length, and conversational context.
 *
 * Guaranteed Invariants:
 * 1. 100% deterministic (NO Math.random()). Same script + config = identical output.
 * 2. minSec <= targetGap <= maxSec.
 * 3. When minSec === maxSec, returns minSec directly.
 */
export function calculateSmartTurnPauseSec(
  prevText: string,
  nextText: string,
  minSec: number,
  maxSec: number
): number {
  if (minSec >= maxSec) {
    return minSec;
  }

  const pText = (prevText || "").trim();
  const nText = (nextText || "").trim();

  // Words count
  const pWords = pText.length > 0 ? pText.split(/\s+/).length : 0;
  const nWords = nText.length > 0 ? nText.split(/\s+/).length : 0;

  let ratio = 0.50; // Neutral default in middle of min–max (0.50–0.60s baseline)

  // Check end punctuation of previous turn
  const hasEllipsis = /\.\.\.|…/u.test(pText.slice(-4));
  const hasQuestion = /[?？]/u.test(pText.slice(-3));
  const hasExclamation = /[!！]/u.test(pText.slice(-3));

  if (hasEllipsis || pWords >= 16) {
    // Trailing thought, pause for reflection
    ratio = 0.90;
  } else if (QUICK_RESPONSE_PATTERN.test(nText) || nWords <= 2) {
    // Quick reply or fast acknowledgement (e.g., "Vâng", "Đúng rồi", "Ok")
    ratio = 0.15;
  } else if (hasQuestion || hasExclamation) {
    // Interrogative or expressive statement, allowing response formulation
    ratio = 0.72;
  } else if (pWords <= 4) {
    // Short crisp transition
    ratio = 0.35;
  } else {
    // Standard turn-taking transition
    ratio = 0.50;
  }

  const target = minSec + ratio * (maxSec - minSec);
  return Number(Math.max(minSec, Math.min(maxSec, target)).toFixed(3));
}

/**
 * Computes exact start and end timestamps for every dialogue segment
 * applying natural turn-taking pauses when switching speakers.
 */
export function calculateDialogueTimeline(
  segments: DialogueSegment[],
  settings: DialogueGlobalSettings
): DialogueAssemblyPlan {
  const timeline: DialogueTimelineEntry[] = [];
  let currentCursorSec = 0;

  const { minSec, maxSec } = resolveTurnPauseRange(settings);

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    // Default estimated duration if audio not yet synthesized (approx 4 words per second)
    const segmentDuration =
      typeof seg.durationSec === "number" && seg.durationSec > 0
        ? seg.durationSec
        : Math.max(1.0, (seg.cleanText.split(/\s+/).length || 1) / 3.8);

    const startSec = currentCursorSec;
    const endSec = startSec + segmentDuration;

    // Determine pause after this segment
    let pauseAfterSec = 0;
    const isLast = i === segments.length - 1;

    if (!isLast) {
      const nextSeg = segments[i + 1];
      if (nextSeg.characterId !== seg.characterId) {
        // Speaker change turn-taking pause with Min-Max
        const targetGap = calculateSmartTurnPauseSec(
          seg.cleanText || seg.rawText || "",
          nextSeg.cleanText || nextSeg.rawText || "",
          minSec,
          maxSec
        );

        // Detect existing natural silence in segments
        let trailingSilenceSec = seg.trailingSilenceSec ?? 0;
        if (trailingSilenceSec === 0 && seg.audioBuffer) {
          try {
            trailingSilenceSec =
              detectTrailingSilenceMs(
                seg.audioBuffer.getChannelData(0),
                seg.audioBuffer.sampleRate
              ) / 1000;
          } catch {
            // fallback
          }
        }

        let leadingSilenceSec = nextSeg.leadingSilenceSec ?? 0;
        if (leadingSilenceSec === 0 && nextSeg.audioBuffer) {
          try {
            leadingSilenceSec =
              detectLeadingSilenceMs(
                nextSeg.audioBuffer.getChannelData(0),
                nextSeg.audioBuffer.sampleRate
              ) / 1000;
          } catch {
            // fallback
          }
        }

        const existingGap = trailingSilenceSec + leadingSilenceSec;
        // Never clip speech: if existingGap >= targetGap, insert 0 additional gap
        pauseAfterSec = Math.max(0, Number((targetGap - existingGap).toFixed(3)));
      } else {
        // Same speaker consecutive turn pause
        pauseAfterSec = Math.max(0, settings.sameSpeakerPauseSec ?? 0);
      }
    }

    timeline.push({
      segmentId: seg.id,
      index: i + 1,
      characterName: seg.characterName,
      characterId: seg.characterId,
      text: seg.cleanText,
      startSec,
      endSec,
      durationSec: segmentDuration,
      pauseAfterSec,
    });

    currentCursorSec = endSec + pauseAfterSec;
  }

  return {
    timeline,
    totalDurationSec: currentCursorSec,
  };
}

/**
 * Synthesizes a valid standard 16-bit PCM WAV File Blob from AudioBuffers
 * or synthetic sample buffers for dialogue export.
 */
export function encodePcmWav(
  channelData: Float32Array,
  sampleRate = 44100,
  volume = 1.0
): Blob {
  const numChannels = 1;
  const bytesPerSample = 2; // 16-bit
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const sampleCount = channelData.length;
  const dataSize = sampleCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // Helper writing ascii
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // RIFF Chunk
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");

  // fmt Subchunk
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // BitsPerSample

  // data Subchunk
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  // Write 16-bit signed PCM samples with master volume scaling & soft clipping
  let offset = 44;
  for (let i = 0; i < sampleCount; i++) {
    let s = channelData[i] * volume;
    // Soft clip limiter
    if (s > 1.0) s = 1.0;
    else if (s < -1.0) s = -1.0;

    const sample16 = s < 0 ? Math.floor(s * 0x8000) : Math.floor(s * 0x7fff);
    view.setInt16(offset, sample16, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * Assembles master audio buffer from segments channel data
 */
export function assembleMasterAudioBuffer(
  segments: DialogueSegment[],
  settings: DialogueGlobalSettings,
  sampleRate = 44100
): { blob: Blob; timeline: DialogueTimelineEntry[]; totalDurationSec: number } {
  const plan = calculateDialogueTimeline(segments, settings);
  const totalSamples = Math.max(1, Math.floor(plan.totalDurationSec * sampleRate));
  const masterSamples = new Float32Array(totalSamples);

  for (let i = 0; i < plan.timeline.length; i++) {
    const entry = plan.timeline[i];
    const seg = segments[i];

    const startSample = Math.floor(entry.startSec * sampleRate);

    if (seg.audioBuffer) {
      const channelData = seg.audioBuffer.getChannelData(0);
      const copyLen = Math.min(channelData.length, totalSamples - startSample);
      for (let s = 0; s < copyLen; s++) {
        masterSamples[startSample + s] = channelData[s];
      }
    }
  }

  const blob = encodePcmWav(masterSamples, sampleRate, settings.masterVolume);

  return {
    blob,
    timeline: plan.timeline,
    totalDurationSec: plan.totalDurationSec,
  };
}
