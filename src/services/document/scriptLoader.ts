import mammoth from "mammoth";

export interface ScriptLoadResult {
  text: string;
  filename: string;
  format: string;
  charCount: number;
  wordCount: number;
}

/**
 * Strips SRT/VTT timestamps and indices to extract plain spoken text if a subtitle file is uploaded.
 */
function extractSubtitleDialogue(rawText: string): string {
  const lines = rawText.split(/\r?\n/);
  const dialogueLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Skip numeric indices (e.g. "1", "42")
    if (/^\d+$/.test(trimmed)) continue;
    // Skip WebVTT header
    if (/^WEBVTT/i.test(trimmed)) continue;
    // Skip timestamp lines (e.g. "00:00:01,000 --> 00:00:04,000")
    if (/\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}\s*-->\s*\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}/.test(trimmed)) {
      continue;
    }
    // Skip NOTE or STYLE blocks in VTT
    if (/^(?:NOTE|STYLE|REGION)/i.test(trimmed)) continue;

    // Strip HTML tags like <b>, <i>, <v Speaker>
    const cleanText = trimmed.replace(/<\/?[^>]+(>|$)/g, "").trim();
    if (cleanText) {
      dialogueLines.push(cleanText);
    }
  }

  return dialogueLines.join("\n");
}

/**
 * Loads and extracts clean script text from various file formats (.docx, .txt, .md, .srt, .vtt).
 */
export async function loadScriptFromFile(file: File): Promise<ScriptLoadResult> {
  const filename = file.name || "script.txt";
  const extension = filename.split(".").pop()?.toLowerCase() || "";

  if (!file || file.size === 0) {
    throw new Error(
      `File "${filename}" hoàn toàn trống (dung lượng 0 byte). Nếu bạn vừa tạo file mới từ menu chuột phải, vui lòng mở file lên, nhập nội dung kịch bản và nhấn Lưu (Ctrl+S) trong Word trước khi tải lên.`
    );
  }

  if (extension === "doc") {
    throw new Error(
      "Định dạng .doc (Word 97-2003) cũ không được hỗ trợ. Vui lòng mở tài liệu và chọn Lưu thành (Save As) dạng .docx hoặc .txt."
    );
  }

  let extractedText = "";

  if (extension === "docx") {
    try {
      const arrayBuffer = await file.arrayBuffer();
      if (!arrayBuffer || arrayBuffer.byteLength === 0) {
        throw new Error(
          `File "${filename}" hoàn toàn trống (dung lượng 0 byte). Vui lòng lưu nội dung vào file trước khi tải lên.`
        );
      }
      const result = await mammoth.extractRawText({ arrayBuffer });
      extractedText = result.value || "";
    } catch (err: any) {
      const rawMsg = err?.message || "";
      let friendlyMsg = rawMsg;
      if (rawMsg.includes("Corrupted zip") || rawMsg.includes("End of data reached")) {
        friendlyMsg = "File Word bị rỗng hoặc không đúng định dạng chuẩn .docx. Hãy mở file trong Microsoft Word và nhấn Lưu (Ctrl+S) rồi thử lại.";
      }
      throw new Error(`Không thể đọc file Word (.docx): ${friendlyMsg}`);
    }
  } else if (extension === "srt" || extension === "vtt") {
    const rawText = await file.text();
    extractedText = extractSubtitleDialogue(rawText);
  } else {
    // Default to plain text (.txt, .md, etc.)
    try {
      extractedText = await file.text();
    } catch (err: any) {
      throw new Error(`Không thể đọc nội dung file văn bản: ${err?.message || "Lỗi đọc file"}`);
    }
  }

  // Normalize Windows/Mac line endings and collapse 3+ blank lines into 2
  const cleaned = extractedText
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!cleaned) {
    throw new Error(`File "${filename}" không chứa nội dung văn bản hợp lệ.`);
  }

  const words = cleaned.split(/\s+/).filter(Boolean);

  return {
    text: cleaned,
    filename,
    format: extension || "txt",
    charCount: cleaned.length,
    wordCount: words.length,
  };
}
