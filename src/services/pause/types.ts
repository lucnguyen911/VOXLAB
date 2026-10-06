export interface ManualPauseToken {
  raw: string;
  durationMs: number;
}

export const PAUSE_TOKEN_REGEX = /\[(?:PAUSE|pause)\s+(\d+(?:\.\d+)?)\s*(ms|s)?\]/gi;

/**
 * Formats a millisecond duration into the standard semantic token: [PAUSE {ms}ms]
 */
export function formatPauseToken(durationMs: number): string {
  const roundedMs = Math.round(durationMs);
  return `[PAUSE ${roundedMs}ms]`;
}

/**
 * Parses duration in milliseconds from a pause token string or text containing a pause token.
 * Returns null if no valid pause token is found.
 */
export function parsePauseDurationMs(text: string): number | null {
  const regex = /\[(?:PAUSE|pause)\s+(\d+(?:\.\d+)?)\s*(ms|s)?\]/i;
  const match = regex.exec(text);
  if (!match) return null;

  const val = parseFloat(match[1]);
  if (isNaN(val) || val <= 0) return null;

  const unit = (match[2] || "ms").toLowerCase();
  if (unit === "s") {
    return Math.round(val * 1000);
  }
  return Math.round(val);
}

/**
 * Validates custom pause duration in seconds.
 * Allowed range: 0.1s to 10.0s.
 */
export function validatePauseDuration(seconds: number): {
  valid: boolean;
  error?: string;
} {
  if (typeof seconds !== "number" || isNaN(seconds)) {
    return { valid: false, error: "Khoảng dừng không hợp lệ (NaN)." };
  }
  if (seconds < 0.1) {
    return { valid: false, error: "Khoảng dừng tối thiểu là 0.1 giây." };
  }
  if (seconds > 10.0) {
    return { valid: false, error: "Khoảng dừng tối đa là 10.0 giây." };
  }
  return { valid: true };
}

/**
 * Strips manual pause tokens (e.g. [PAUSE 500ms]) from text, returning clean plain text.
 */
export function stripPauseTokens(text: string): string {
  if (!text) return "";
  return text
    .replace(/\[(?:PAUSE|pause|nghỉ|break)\s*[^\]]*\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}


