/**
 * Memory Preflight Guardrail for Master Audio Assembly
 * Protects WebView2 from Out-Of-Memory (OOM) silent crashes during long-form audio synthesis.
 * Adheres strictly to SPEC.md v2.5.3 Section 16.3 and PLAN.md TASK-17.
 */

export const BYTES_PER_SECOND_CANONICAL = 44100 * 2; // 88,200 bytes/sec (44.1kHz 16-bit Mono)
export const DURATION_WARNING_THRESHOLD_SEC = 3600;  // 60 minutes
export const DURATION_REJECT_THRESHOLD_SEC = 7200;   // 120 minutes (Provisional safety ceiling)
export const MAX_ALLOWED_BYTES = 635 * 1024 * 1024;  // ~635 MB

export interface MemoryPreflightResult {
  allowed: boolean;
  warningLevel: "none" | "warning_large" | "reject_oom";
  estimatedBytes: number;
  estimatedMb: number;
  message?: string;
}

/**
 * Validates estimated memory footprint before allocating massive ArrayBuffer.
 * - > 60m: displays advisory warning, permits export.
 * - > 120m or > 635MB: unconditionally rejects allocation with actionable message.
 */
export function preflightMemoryCheck(totalDurationSec: number): MemoryPreflightResult {
  const safeDuration = Math.max(0, isNaN(totalDurationSec) ? 0 : totalDurationSec);
  const estimatedBytes = Math.floor(safeDuration * BYTES_PER_SECOND_CANONICAL);
  const estimatedMb = Number((estimatedBytes / (1024 * 1024)).toFixed(1));

  if (safeDuration > DURATION_REJECT_THRESHOLD_SEC || estimatedBytes > MAX_ALLOWED_BYTES) {
    return {
      allowed: false,
      warningLevel: "reject_oom",
      estimatedBytes,
      estimatedMb,
      message:
        "Dự án vượt quá giới hạn thời lượng 120 phút cho một lần xuất âm thanh. Vui lòng chia nhỏ dự án để đảm bảo an toàn bộ nhớ và hiệu năng hệ thống.",
    };
  }

  if (safeDuration > DURATION_WARNING_THRESHOLD_SEC) {
    return {
      allowed: true,
      warningLevel: "warning_large",
      estimatedBytes,
      estimatedMb,
      message:
        "Dự án dài (> 60 phút) sẽ tiêu tốn khoảng 1.0GB - 2.0GB RAM trong lúc ghép nối âm thanh. Hãy đảm bảo máy tính còn đủ bộ nhớ trống.",
    };
  }

  return {
    allowed: true,
    warningLevel: "none",
    estimatedBytes,
    estimatedMb,
  };
}
