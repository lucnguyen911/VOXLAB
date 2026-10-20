import {
  SpeechUnit,
  SubtitleCue,
  SubtitleProfile,
} from "./types";
import {
  cleanWord,
  FORBIDDEN_ENDINGS,
  getDisplayWidth,
  getWordCount,
  isCompoundWordSplit,
  STRONG_PUNCTUATION,
  WEAKER_PUNCTUATION,
  WEAKEST_PUNCTUATION,
} from "./candidates";

export interface OptimizeOptions {
  profile: SubtitleProfile;
  maxMergeWindow?: number;
}

/**
 * Bridges micro-gaps (< 350ms) between consecutive cues to eliminate visual flicker,
 * matching the Python sidecar optimizer (`subtitle_optimizer.py`).
 */
export function bridgeSubtitleMicroGaps(cues: SubtitleCue[], maxBridgeSec = 0.35): SubtitleCue[] {
  if (!cues || cues.length <= 1) return cues;
  const result = cues.map((c) => ({ ...c }));
  for (let i = 0; i < result.length - 1; i++) {
    const gap = result[i + 1].startSec - result[i].endSec;
    if (gap > 0 && gap < maxBridgeSec) {
      result[i].endSec = result[i + 1].startSec;
    } else if (gap < 0) {
      result[i].endSec = Math.max(result[i].startSec + 0.05, result[i + 1].startSec);
    }
  }
  return result;
}

/**
 * Calculates a penalty score for a candidate subtitle cue according to profile and readability criteria.
 * Lower score = higher quality cue.
 */
function scoreCandidateCue(
  units: SpeechUnit[],
  startIdx: number,
  endIdx: number, // exclusive
  profile: SubtitleProfile,
  passLevel: number // 1: strict, 2: relaxed, 3: overflow, 4: fallback
): { cost: number; text: string; startSec: number; endSec: number } {
  const slice = units.slice(startIdx, endIdx);
  const text = slice.map((u) => u.text.trim()).filter(Boolean).join(" ");
  const startSec = slice[0].startSec;
  const endSec = slice[slice.length - 1].endSec;
  const duration = Math.max(0.1, endSec - startSec);

  const width = getDisplayWidth(text);
  const words = getWordCount(text);
  const cps = width / duration;

  let cost = 0;

  // Pass 1: Strict bounds
  // Pass 2: Relaxed to maxLineCapacity / maxWords / maxDuration
  // Pass 3: Controlled overflow
  const rawMaxCapacity = profile.maxWidth * profile.maxLines;
  const maxLineCapacity =
    profile.maxLines >= 2
      ? profile.formatId === "9:16"
        ? Math.min(48, rawMaxCapacity)
        : profile.formatId === "1:1"
        ? Math.min(54, rawMaxCapacity)
        : Math.min(60, rawMaxCapacity)
      : rawMaxCapacity;
  const targetLineCapacity = Math.min(maxLineCapacity, profile.targetWidth * profile.maxLines);

  const allowedWidth =
    passLevel === 1
      ? targetLineCapacity
      : passLevel === 2
      ? maxLineCapacity
      : passLevel === 3
      ? maxLineCapacity + 14 // controlled overflow
      : 9999;

  const allowedWords =
    passLevel === 1
      ? profile.targetWords
      : passLevel === 2
      ? profile.maxWords
      : passLevel === 3
      ? profile.maxWords + 6
      : 9999;

  const allowedDuration =
    passLevel === 1
      ? profile.targetDuration
      : passLevel === 2
      ? profile.maxDuration
      : passLevel === 3
      ? profile.maxDuration + 2.5
      : 9999;

  // Base overhead cost per cue: discourages excessive rapid flashing of tiny cues
  cost += 20.0;

  // Check hard constraints for the current pass
  if (width > allowedWidth) {
    cost += (width - allowedWidth) * 35;
  }
  if (words > allowedWords) {
    cost += (words - allowedWords) * 30;
  }
  if (duration > allowedDuration) {
    cost += (duration - allowedDuration) * 25;
  }

  // Soft penalties against target metrics
  if (width > targetLineCapacity) {
    cost += (width - targetLineCapacity) * 1.5;
  }
  if (words > profile.targetWords) {
    cost += (words - profile.targetWords) * 2.0;
  } else if (words < profile.targetWords) {
    // Underlength penalty: discourages leaving tiny 1-2 word singleton cues when merge is possible
    cost += (profile.targetWords - words) * 3.0;
    if (words === 1) {
      cost += 45.0;
    }
  }

  if (duration < profile.minDuration) {
    cost += (profile.minDuration - duration) * 15.0;
  } else if (duration < profile.targetDuration) {
    cost += (profile.targetDuration - duration) * 4.0;
  }
  if (duration > profile.targetDuration) {
    cost += (duration - profile.targetDuration) * 2.5;
  }
  if (cps > profile.targetCps) {
    cost += (cps - profile.targetCps) * 3.0;
  }

  // Punctuation bonuses & syntactic boundary checks
  const trimmed = text.trim();
  const lastChar = trimmed[trimmed.length - 1];
  if (STRONG_PUNCTUATION.includes(lastChar)) {
    cost -= 8.0; // Strong sentence end preferred
  } else if (WEAKER_PUNCTUATION.includes(lastChar)) {
    cost -= 4.0; // Semicolon/colon
  } else if (WEAKEST_PUNCTUATION.includes(lastChar)) {
    // If this is a short <= 4 word introductory phrase in 2-line mode, discourage splitting into a 1-line cue
    cost += profile.maxLines >= 2 && words <= 4 ? 10.0 : 1.0;
  } else {
    cost += 15.0; // Break mid-clause heavy penalty
    const tokens = trimmed.split(/\s+/);
    const lastToken = tokens[tokens.length - 1] || "";
    const lastClean = cleanWord(lastToken);
    if (FORBIDDEN_ENDINGS.has(lastClean)) {
      cost += 160.0; // Never end a cue on a determiner, preposition, auxiliary, or conjunction
    }
    if (endIdx < units.length) {
      const nextFirstToken = units[endIdx].text.trim().split(/\s+/)[0] || "";
      if (isCompoundWordSplit(lastToken, nextFirstToken)) {
        cost += 300.0; // Never split a compound phrase or entity designator across cues
      }
    }
  }

  return { cost, text, startSec, endSec };
}

/**
 * Executes a single pass of Dynamic Programming optimization.
 * Returns null if no valid partition satisfies constraints at this pass level.
 */
function runDpPass(
  units: SpeechUnit[],
  profile: SubtitleProfile,
  passLevel: number,
  maxWindow = 6
): SubtitleCue[] | null {
  const n = units.length;
  if (n === 0) return [];

  const dp: number[] = new Array(n + 1).fill(Infinity);
  const parent: number[] = new Array(n + 1).fill(-1);
  const bestCueData: { text: string; startSec: number; endSec: number }[] = new Array(n + 1);
  const rawMaxCueCap = profile.maxWidth * profile.maxLines;
  const maxCueCapacity =
    profile.maxLines >= 2
      ? profile.formatId === "9:16"
        ? Math.min(48, rawMaxCueCap)
        : profile.formatId === "1:1"
        ? Math.min(54, rawMaxCueCap)
        : Math.min(60, rawMaxCueCap)
      : rawMaxCueCap;

  dp[0] = 0;

  for (let k = 1; k <= n; k++) {
    const minJ = Math.max(0, k - maxWindow);
    for (let j = minJ; j < k; j++) {
      if (dp[j] === Infinity) continue;

      const evalResult = scoreCandidateCue(units, j, k, profile, passLevel);

      // Check if merge is rejected due to excessive overflow at this pass level
      const maxAllowedWidth =
        passLevel === 1
          ? maxCueCapacity
          : passLevel === 2
          ? maxCueCapacity
          : passLevel === 3
          ? maxCueCapacity + 16
          : Infinity;

      if (getDisplayWidth(evalResult.text) > maxAllowedWidth && k - j > 1) {
        continue;
      }

      const totalCost = dp[j] + evalResult.cost;
      if (totalCost < dp[k]) {
        dp[k] = totalCost;
        parent[k] = j;
        bestCueData[k] = {
          text: evalResult.text,
          startSec: evalResult.startSec,
          endSec: evalResult.endSec,
        };
      }
    }
  }

  if (dp[n] === Infinity) {
    return null;
  }

  // Reconstruct optimal cues from parent pointers
  const cues: SubtitleCue[] = [];
  let curr = n;
  while (curr > 0) {
    const prev = parent[curr];
    const data = bestCueData[curr];
    cues.unshift({
      index: 0, // Assigned sequentially later
      text: data.text,
      startSec: data.startSec,
      endSec: data.endSec,
    });
    curr = prev;
  }

  // Number cues sequentially starting at 1
  return cues.map((cue, idx) => ({
    ...cue,
    index: idx + 1,
  }));
}

/**
 * Optimizes SpeechUnits into balanced, aspect-ratio-adapted SubtitleCues
 * using a 4-pass graceful fallback mechanism.
 *
 * Guaranteed to preserve 100% of tokens in order, with zero dropped content.
 */
export function optimizeSubtitles(
  speechUnits: SpeechUnit[],
  profile: SubtitleProfile
): SubtitleCue[] {
  if (!speechUnits || speechUnits.length === 0) {
    return [];
  }

  // Pass 1: Strict optimal segmentation
  const pass1 = runDpPass(speechUnits, profile, 1);
  if (pass1) return bridgeSubtitleMicroGaps(pass1);

  // Pass 2: Relaxed preferences (allows up to maxWidth / maxWords)
  const pass2 = runDpPass(speechUnits, profile, 2);
  if (pass2) return bridgeSubtitleMicroGaps(pass2);

  // Pass 3: Controlled overflow (e.g. for long URLs or long words)
  const pass3 = runDpPass(speechUnits, profile, 3);
  if (pass3) return bridgeSubtitleMicroGaps(pass3);

  // Pass 4: Fallback to 1:1 mapping (keep each speech unit intact without breaking tokens)
  return bridgeSubtitleMicroGaps(
    speechUnits.map((unit, idx) => ({
      index: idx + 1,
      text: unit.text.trim(),
      startSec: unit.startSec,
      endSec: unit.endSec,
    }))
  );
}
