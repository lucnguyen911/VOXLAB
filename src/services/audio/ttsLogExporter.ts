import { ChunkItem, EffectiveVoiceSnapshot, PunctuationPauses } from "../../types/ui";
import {
  countChunkQualityIssues,
  getIssueShortLabel,
  isChunkError,
  isChunkWarning,
} from "./qualityValidator";

export interface TtsLogExportOptions {
  projectTitle?: string;
  activeModel?: string;
  activeVoiceId?: string;
  activeVoiceName?: string;
  activeVoiceSnapshot?: EffectiveVoiceSnapshot;
  speed?: number;
  pitch?: number;
  volume?: number;
  punctuationPauses?: PunctuationPauses;
  exportSrt?: boolean;
  exportedAt?: Date;
}

/**
 * Formats seconds into mm:ss.xx display (e.g. 65.4s -> "01:05.40")
 */
function formatTimeSec(seconds?: number): string {
  if (typeof seconds !== "number" || isNaN(seconds)) return "00:00.00";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  const mmStr = String(m).padStart(2, "0");
  const ssStr = s.toFixed(2).padStart(5, "0");
  return `${mmStr}:${ssStr}`;
}

/**
 * Formats a Date object into "YYYY-MM-DD HH:mm:ss"
 */
function formatDateTime(d: Date): string {
  const yyyy = d.getFullYear();
  const MM = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}-${MM}-${dd} ${hh}:${mm}:${ss}`;
}

/**
 * Generates human-readable text log of all warnings, errors, and quality statistics.
 */
export function generateTtsQualityLog(
  chunks: ChunkItem[],
  options?: TtsLogExportOptions
): string {
  const date = options?.exportedAt || new Date();
  const dateStr = formatDateTime(date);
  const title = options?.projectTitle || "Kịch bản TTS";
  const stats = countChunkQualityIssues(chunks);

  const lines: string[] = [];

  // Header Banner
  lines.push("================================================================================");
  lines.push("                       VOXLAB — NHẬT KÝ CẢNH BÁO & LỖI TTS                      ");
  lines.push("================================================================================");
  lines.push(`Thời gian xuất: ${dateStr}`);
  lines.push(`Dự án / Tiêu đề: ${title}`);
  if (options?.activeModel) {
    lines.push(`Mô hình AI: ${options.activeModel}`);
  }
  if (options?.activeVoiceName || options?.activeVoiceId) {
    lines.push(`Giọng đọc: ${options.activeVoiceName || options.activeVoiceId}`);
  }
  if (options?.speed !== undefined || options?.pitch !== undefined || options?.volume !== undefined) {
    const sp = options?.speed !== undefined ? `${options.speed}x` : "1.0x";
    const pi = options?.pitch !== undefined ? `${options.pitch}x` : "1.0x";
    const vo = options?.volume !== undefined ? `${options.volume}x` : "1.0x";
    lines.push(`Thông số âm thanh: Tốc độ: ${sp} | Cao độ: ${pi} | Âm lượng: ${vo}`);
  }
  if (options?.punctuationPauses) {
    const p = options.punctuationPauses;
    lines.push(
      `Khoảng nghỉ dấu câu: Phẩy (,): ${p.comma}s | Chấm (.): ${p.period}s | ?/!: ${p.questionExclamation}s | :/; : ${p.colonSemicolon}s`
    );
  }

  lines.push("");
  lines.push("--------------------------------------------------------------------------------");
  lines.push("THỐNG KÊ TỔNG QUAN");
  lines.push("--------------------------------------------------------------------------------");
  lines.push(`Tổng số đoạn (Chunks): ${chunks.length}`);
  lines.push(`  • Đạt chuẩn (Pass): ${stats.passCount} đoạn`);
  lines.push(`  • Cảnh báo chất lượng (Warning): ${stats.warningCount} đoạn`);
  lines.push(`  • Lỗi nghiêm trọng / Thất bại (Error/Failed): ${stats.errorCount} đoạn`);
  lines.push(`  • Chưa kiểm chứng (Unverified): ${stats.unverifiedCount} đoạn`);

  // Count issues by category
  const issueCounts: Record<string, number> = {};
  let totalIssuesFound = 0;

  for (const chunk of chunks) {
    if (chunk.status === "failed") {
      issueCounts["Lỗi tạo audio (FAILED)"] = (issueCounts["Lỗi tạo audio (FAILED)"] || 0) + 1;
      totalIssuesFound++;
    }
    const issues = chunk.qualityReview?.issues || [];
    for (const iss of issues) {
      const label = `${getIssueShortLabel(iss.code)} (${iss.code})`;
      issueCounts[label] = (issueCounts[label] || 0) + 1;
      totalIssuesFound++;
    }
  }

  if (totalIssuesFound > 0) {
    lines.push("");
    lines.push("Phân loại vấn đề phát hiện:");
    for (const [cat, count] of Object.entries(issueCounts)) {
      lines.push(`  - ${cat}: ${count}`);
    }
  }

  lines.push("");
  lines.push("--------------------------------------------------------------------------------");
  lines.push("DANH SÁCH CHI TIẾT CÁC ĐOẠN CÓ CẢNH BÁO VÀ LỖI");
  lines.push("--------------------------------------------------------------------------------");

  const problematicChunks = chunks.filter(
    (c) => isChunkError(c) || isChunkWarning(c) || c.status === "failed"
  );

  if (problematicChunks.length === 0) {
    lines.push("");
    lines.push("Không phát hiện bất kỳ cảnh báo hoặc lỗi nào sau khi tạo TTS.");
    lines.push(`Toàn bộ ${chunks.length} đoạn âm thanh đều đạt chuẩn chất lượng.`);
  } else {
    const isZeroBased = chunks.some((c) => c.index === 0);
    for (const chunk of problematicChunks) {
      lines.push("");
      const isErr = isChunkError(chunk) || chunk.status === "failed";
      const statusLabel = chunk.status === "failed"
        ? "LỖI TẠO AUDIO (FAILED)"
        : isErr
        ? "LỖI CHẤT LƯỢNG (ERROR)"
        : "CẢNH BÁO CHẤT LƯỢNG (WARNING)";

      const displayIdx = isZeroBased ? chunk.index + 1 : chunk.index;
      lines.push(`[ĐOẠN ${String(displayIdx).padStart(2, "0")}] (ID: ${chunk.id})`);
      lines.push(`Trạng thái: ${statusLabel}`);
      lines.push(`Thời lượng: ${chunk.durationSec ? `${chunk.durationSec.toFixed(2)}s` : "Chưa có"}`);

      const voice = chunk.effectiveVoiceSnapshot;
      if (voice) {
        lines.push(`Giọng đọc: ${voice.voiceName} (Engine: ${voice.engine || voice.provider || "N/A"})`);
      }

      lines.push(`Nội dung kịch bản: "${chunk.text}"`);

      if (chunk.errorMessage) {
        lines.push(`Lỗi runtime hệ thống: ${chunk.errorMessage}`);
      }

      const review = chunk.qualityReview;
      if (review) {
        if (review.asrModelId) {
          lines.push(`Mô hình ASR hậu kiểm: ${review.asrModelId}`);
        }
        if (review.summary) {
          lines.push(`Tóm tắt hậu kiểm: ${review.summary}`);
        }

        const issues = review.issues || [];
        if (issues.length > 0) {
          lines.push("Chi tiết vấn đề phát hiện:");
          issues.forEach((iss, idx) => {
            const sev = iss.severity === "error" ? "LỖI" : "CẢNH BÁO";
            const cat = getIssueShortLabel(iss.code);
            let timeStr = "";
            if (iss.timeRange && iss.timeRange.length >= 2) {
              timeStr = ` [Thời điểm: ${formatTimeSec(iss.timeRange[0])} - ${formatTimeSec(iss.timeRange[1])}]`;
            }
            lines.push(`  ${idx + 1}. [${sev}] [${cat} - ${iss.code}]${timeStr}`);
            lines.push(`     • Mô tả: ${iss.message}`);
            if (iss.words && iss.words.length > 0) {
              lines.push(`     • Từ ngữ liên quan: '${iss.words.join("', '")}'`);
            }
            if (iss.sourceExcerpt || iss.asrRawExcerpt || iss.asrNormalizedExcerpt) {
              lines.push(
                `     • Đối chiếu: Kịch bản="${iss.sourceExcerpt || ""}" | ASR Raw="${iss.asrRawExcerpt || ""}" | ASR Norm="${iss.asrNormalizedExcerpt || ""}"`
              );
            }
            if (iss.tokenSource || iss.asrModelId || iss.evidence) {
              lines.push(
                `     • Bằng chứng: Nguồn=${iss.tokenSource || "primary_asr"} | Model=${iss.asrModelId || review.asrModelId || "large-v3-turbo"}${iss.evidence ? ` | ${iss.evidence}` : ""}`
              );
            }
          });
        }

        if (review.metrics) {
          const m = review.metrics;
          const metricParts: string[] = [];
          if (m.wpm !== undefined) metricParts.push(`Tốc độ: ${m.wpm} WPM`);
          if (m.detectedWordsCount !== undefined && m.sourceWordsCount !== undefined) {
            metricParts.push(`Số từ ASR: ${m.detectedWordsCount}/${m.sourceWordsCount}`);
          }
          if (m.paceVariance !== undefined) metricParts.push(`Độ lệch nhịp: ${m.paceVariance}`);
          if (metricParts.length > 0) {
            lines.push(`Chỉ số âm học: ${metricParts.join(" | ")}`);
          }
        }
      }

      lines.push("--------------------------------------------------------------------------------");
    }
  }

  lines.push("");
  lines.push("================================================================================");
  lines.push("HƯỚNG DẪN XỬ LÝ:");
  lines.push("1. Cảnh báo (Warning): Các đoạn này vẫn xuất được âm thanh bình thường.");
  lines.push("   Người dùng có thể nghe preview trực tiếp trên giao diện để quyết định giữ hay tạo lại.");
  lines.push("2. Lỗi (Error / Failed): Cần kiểm tra lại kết nối mô hình hoặc chỉnh sửa kịch bản");
  lines.push("   và bấm 'Tạo lại' cho các đoạn này trước khi ghép & xuất audio hoàn chỉnh.");
  lines.push("================================================================================");
  lines.push("");

  return lines.join("\n");
}

/**
 * Generates JSON object of quality report for structured export / programmatic inspection.
 */
export function generateTtsQualityJson(
  chunks: ChunkItem[],
  options?: TtsLogExportOptions
): Record<string, any> {
  const date = options?.exportedAt || new Date();
  const stats = countChunkQualityIssues(chunks);

  const problematicChunks = chunks.filter(
    (c) => isChunkError(c) || isChunkWarning(c) || c.status === "failed"
  );

  return {
    generator: "VoxLab TTS Quality Validator",
    version: "2.4.0",
    exportedAt: date.toISOString(),
    projectTitle: options?.projectTitle || "Kịch bản TTS",
    settings: {
      model: options?.activeModel,
      voice: options?.activeVoiceName || options?.activeVoiceId,
      speed: options?.speed,
      pitch: options?.pitch,
      volume: options?.volume,
      pauses: options?.punctuationPauses,
    },
    statistics: {
      totalChunks: chunks.length,
      passCount: stats.passCount,
      warningCount: stats.warningCount,
      errorCount: stats.errorCount,
      unverifiedCount: stats.unverifiedCount,
    },
    problematicChunks: problematicChunks.map((chunk) => ({
      index: chunk.index,
      id: chunk.id,
      status: chunk.status,
      isError: isChunkError(chunk),
      isWarning: isChunkWarning(chunk),
      durationSec: chunk.durationSec,
      text: chunk.text,
      errorMessage: chunk.errorMessage,
      voice: chunk.effectiveVoiceSnapshot,
      qualityReview: chunk.qualityReview,
    })),
  };
}

/**
 * Native file downloader fallback for browser environment.
 */
function downloadTextFileBrowser(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Exports TTS log via Native Save Dialog (Tauri) or Browser Download Fallback.
 */
export async function exportTtsLog(
  chunks: ChunkItem[],
  options?: TtsLogExportOptions
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  try {
    const date = options?.exportedAt || new Date();
    const safeTitle = (options?.projectTitle || "Script")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, 30) || "TTS";

    const yyyymmdd = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
    const hhmmss = `${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}${String(date.getSeconds()).padStart(2, "0")}`;
    const defaultFilename = `VoxLab_TTS_Log_${safeTitle}_${yyyymmdd}_${hhmmss}.txt`;

    // 1. Desktop Tauri Environment
    if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
      try {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const chosenPath = await save({
          defaultPath: defaultFilename,
          filters: [
            { name: "Tệp nhật ký văn bản (*.txt)", extensions: ["txt"] },
            { name: "Tệp nhật ký Markdown (*.md)", extensions: ["md"] },
            { name: "Dữ liệu JSON (*.json)", extensions: ["json"] },
            { name: "Tất cả các tệp (*.*)", extensions: ["*"] },
          ],
        });

        // User cancelled dialog
        if (!chosenPath) {
          return { success: false };
        }

        const isJson = chosenPath.toLowerCase().endsWith(".json");
        const content = isJson
          ? JSON.stringify(generateTtsQualityJson(chunks, options), null, 2)
          : generateTtsQualityLog(chunks, options);

        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("fs_write_text", {
          path: chosenPath,
          content,
        });

        try {
          await invoke("fs_show_in_folder", { path: chosenPath });
        } catch (folderErr) {
          console.warn("Could not reveal file in folder:", folderErr);
        }

        return { success: true, filePath: chosenPath };
      } catch (err: any) {
        console.error("Tauri export log error:", err);
        return { success: false, error: err?.message || String(err) };
      }
    }

    // 2. Web Browser Fallback
    const content = generateTtsQualityLog(chunks, options);
    downloadTextFileBrowser(content, defaultFilename);
    return { success: true, filePath: defaultFilename };
  } catch (err: any) {
    console.error("Export log error:", err);
    return { success: false, error: err?.message || String(err) };
  }
}
