import React, { useRef, useState } from "react";
import {
  Clock,
  UploadCloud,
  Wand2,
  Languages,
} from "lucide-react";
import { DialogueCharacter } from "../../types/dialogue";
import { normalizeCharacterId } from "../../services/dialogue/parser";
import { ManualPausePopover } from "../popovers/ManualPausePopover";
import { formatPauseToken } from "../../services/pause";
import { extractFilesFromDropEvent } from "../../services/fileDropHelper";

interface DialogueEditorProps {
  value: string;
  onChange: (val: string) => void;
  characters: DialogueCharacter[];
  wordCount: number;
  charCount: number;
  onNormalize?: () => void;
  onOpenPronunciation?: () => void;
  onUseSample?: () => void;
  onUploadFile?: (file: File) => void;
  onConvert?: () => void;
  isConverting?: boolean;
}

export const DialogueEditor: React.FC<DialogueEditorProps> = ({
  value,
  onChange,
  characters,
  wordCount,
  charCount,
  onNormalize,
  onOpenPronunciation,
  onUseSample: _onUseSample,
  onUploadFile,
  onConvert: _onConvert,
  isConverting: _isConverting = false,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isPausePopoverOpen, setIsPausePopoverOpen] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Sync scroll between textarea and syntax highlight backdrop
  const handleScroll = () => {
    if (textareaRef.current && backdropRef.current) {
      backdropRef.current.scrollTop = textareaRef.current.scrollTop;
      backdropRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  };

  // Insert manual pause token at cursor position (IME & Undo/Redo compliant)
  const handleInsertPauseInternal = (durationMs: number) => {
    const token = formatPauseToken(durationMs);
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.focus();
      const success = document.execCommand("insertText", false, ` ${token} `);
      if (!success) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const next = value.slice(0, start) + ` ${token} ` + value.slice(end);
        onChange(next);
      }
    } else {
      onChange(value + ` ${token} `);
    }
    setIsPausePopoverOpen(false);
  };

  // Map character normalized ID to character color theme for instant lookup
  const charColorMap = new Map(characters.map((c) => [c.id, c.colorTheme]));

  // Highlight pause tokens inside dialogue text without breaking line metrics
  const renderDialogueBody = (body: string) => {
    const parts = body.split(/(\[(?:PAUSE|pause)\s+[^\]]+\])/gi);
    return parts.map((part, pIdx) => {
      if (/^\[(?:PAUSE|pause)\s+/i.test(part)) {
        return (
          <span
            key={pIdx}
            className="text-amber-500 dark:text-amber-400 font-sans font-normal"
          >
            {part}
          </span>
        );
      }
      return <span key={pIdx}>{part}</span>;
    });
  };

  // Render stylized lines in the background overlay
  const renderHighlightedContent = () => {
    if (!value) {
      return (
        <span className="text-textMuted/50 select-none pointer-events-none">
          Nhập hoặc thả file kịch bản vào đây...
        </span>
      );
    }

    const lines = value.split("\n");
    return lines.map((line, idx) => {
      // Check if leading pause token exists
      let lineToHighlight = line;
      let leadingPause = "";
      const leadingPauseMatch = line.match(/^(\s*\[(?:PAUSE|pause)\s+[^\]]+\]\s*)/i);
      if (leadingPauseMatch) {
        leadingPause = leadingPauseMatch[1];
        lineToHighlight = line.slice(leadingPause.length);
      }

      // Regex matching speaker tag: [Name]: or Name:
      const match = lineToHighlight.match(/^(\s*(?:\[([^\]]+)\](?:\s*[:：]|\s+)|([^:\n\r\[]+)\s*[:：]))(.*)$/);

      if (match) {
        const fullSpeakerTag = match[1];
        const speakerName = (match[2] || match[3] || "").trim();
        const dialogueBody = match[4];

        if (!/^(?:pause|nghỉ|break)\b/i.test(speakerName)) {
          const charId = normalizeCharacterId(speakerName);
          const theme = charColorMap.get(charId);

          return (
            <div key={idx} className="min-h-[1.5em] whitespace-pre-wrap break-words leading-relaxed">
              {leadingPause && renderDialogueBody(leadingPause)}
              <span
                className={`font-sans font-normal transition-colors ${
                  theme ? theme.textClass : "text-accent"
                }`}
              >
                {fullSpeakerTag}
              </span>
              <span className="text-textPrimary">{renderDialogueBody(dialogueBody)}</span>
            </div>
          );
        }
      }

      return (
        <div key={idx} className="min-h-[1.5em] whitespace-pre-wrap break-words leading-relaxed text-textPrimary">
          {renderDialogueBody(line) || "\u00A0"}
        </div>
      );
    });
  };

  return (
    <div className="flex-1 flex flex-col space-y-3 overflow-hidden min-w-0">
      {/* Hidden File Input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && onUploadFile) onUploadFile(file);
        }}
        accept=".docx,.txt,.md,.srt,text/plain"
        className="hidden"
      />

      {/* Toolbar (matches TTS stage prep layout) */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-surface1 rounded-lg border border-borderDefault text-xs">
        <div className="flex items-center gap-2">
          {/* 0. Tải Lên */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-surface2 hover:bg-surface3 text-textPrimary rounded-md border border-borderDefault transition-colors font-semibold text-xs cursor-pointer shadow-2xs"
            title="Tải lên tệp hoặc thư mục kịch bản thoại (.txt, .docx, .md, .srt)"
          >
            <UploadCloud className="w-3.5 h-3.5 text-accent" />
            <span>Tải Lên</span>
          </button>

          <div className="h-4 w-px bg-borderDefault mx-0.5" />

          {/* 1. Chuẩn hóa văn bản */}
          {onNormalize && (
            <button
              type="button"
              onClick={onNormalize}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-surface2 hover:bg-surface3 text-textPrimary rounded-md border border-borderDefault transition-colors font-medium text-xs cursor-pointer"
              title="Chuẩn hóa ký tự Unicode và khoảng trắng, giữ nguyên số và ký tự kỹ thuật"
            >
              <Wand2 className="w-3.5 h-3.5 text-accent" />
              <span>Chuẩn hóa văn bản</span>
            </button>
          )}

          {/* 3. Phát âm */}
          {onOpenPronunciation && (
            <button
              type="button"
              onClick={onOpenPronunciation}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-surface2 hover:bg-surface3 text-textPrimary rounded-md border border-borderDefault transition-colors font-medium text-xs cursor-pointer"
              title="Quản lý cách đọc tùy chỉnh cho từ viết tắt, tên riêng và ký hiệu"
            >
              <Languages className="w-3.5 h-3.5 text-accent" />
              <span>Phát âm</span>
            </button>
          )}

          {/* 4. Thêm khoảng dừng with ManualPausePopover */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsPausePopoverOpen(!isPausePopoverOpen)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border transition-colors font-medium text-xs cursor-pointer ${
                isPausePopoverOpen
                  ? "bg-accent/15 border-accent text-accent"
                  : "bg-surface2 hover:bg-surface3 text-textPrimary border-borderDefault"
              }`}
              title="Chèn khoảng dừng ngắt nghỉ tại vị trí con trỏ"
            >
              <Clock className="w-3.5 h-3.5 text-accent" />
              <span>Thêm khoảng dừng</span>
            </button>
            <ManualPausePopover
              isOpen={isPausePopoverOpen}
              onClose={() => setIsPausePopoverOpen(false)}
              onInsertPause={handleInsertPauseInternal}
            />
          </div>
        </div>
      </div>

      {/* Editor Box (matches TTS Editor Box with rounded border and card header) */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDraggingOver(true);
        }}
        onDragLeave={() => setIsDraggingOver(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setIsDraggingOver(false);
          const files = await extractFilesFromDropEvent(e);
          const validFile =
            files.find((f) => {
              const ext = f.name.toLowerCase().split(".").pop() || "";
              return ["docx", "txt", "md", "srt", "vtt"].includes(ext);
            }) || files[0];
          if (validFile && onUploadFile) {
            onUploadFile(validFile);
          }
        }}
        onClick={() => textareaRef.current?.focus()}
        className={`flex-1 flex flex-col min-h-[360px] border rounded-lg overflow-hidden bg-surface1 transition-all cursor-text relative ${
          isDraggingOver
            ? "border-accent ring-2 ring-accent/30 bg-accent/5"
            : "border-borderDefault"
        }`}
      >
        {/* Editor Card Header Bar: Detected character chips & metrics */}
        <div className="px-4 py-2 bg-surface2/60 border-b border-borderDefault flex items-center justify-between gap-3 text-xs text-textSecondary select-none min-h-[36px]">
          {/* Detected Characters Live Chips or Syntax Guidance */}
          <div className="flex items-center gap-1.5 flex-wrap min-w-0 mr-2">
            {characters.length > 0 ? (
              <>
                <span className="text-[11px] text-textMuted font-medium shrink-0">
                  Nhân vật nhận diện ({characters.length}):
                </span>
                {characters.map((c) => (
                  <span
                    key={c.id}
                    className={`px-1.5 py-0.5 rounded text-[11px] font-semibold shrink-0 transition-colors ${
                      c.colorTheme?.badgeClass || "bg-accent/15 text-accent border border-accent/30"
                    }`}
                  >
                    [{c.name}] <span className="font-normal opacity-85">{c.segmentCount} câu</span>
                  </span>
                ))}
              </>
            ) : (
              <span className="text-[11px] text-textMuted">
                Kịch bản theo cú pháp: <span className="font-mono text-accent">[Tên]: Lời thoại</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5 font-mono text-xs text-textMuted shrink-0">
            <span className="font-semibold text-textSecondary">
              {characters.length} nhân vật
            </span>
            <span className="text-borderDefault">|</span>
            <span>{wordCount} từ</span>
            <span className="text-borderDefault">·</span>
            <span>{charCount} ký tự</span>
            {wordCount > 0 && (
              <>
                <span className="text-borderDefault">·</span>
                <span className="text-accent font-medium">~{Math.round(wordCount / 3.3)}s ước tính</span>
              </>
            )}
          </div>
        </div>

        {/* Drag Overlay Feedback */}
        {isDraggingOver && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-surface1/90 backdrop-blur-xs pointer-events-none border-2 border-dashed border-accent rounded-lg">
            <UploadCloud className="w-8 h-8 text-accent animate-bounce mb-2" />
            <span className="text-sm font-semibold text-textPrimary">Thả file kịch bản vào đây để nạp</span>
            <span className="text-xs text-textMuted mt-1">Hỗ trợ .docx, .txt, .md, .srt, .vtt</span>
          </div>
        )}

        {/* Synchronized Content Layer & Native Textarea */}
        <div className="flex-1 relative overflow-hidden bg-background cursor-text">
          {/* Background Syntax Highlight Layer (or faint guidance placeholder when empty) */}
          <div
            ref={backdropRef}
            aria-hidden="true"
            className="absolute inset-0 p-4 font-sans text-sm leading-relaxed overflow-hidden pointer-events-none select-none whitespace-pre-wrap break-words border-0 m-0"
            style={{
              fontFamily: "inherit",
              letterSpacing: "normal",
              wordSpacing: "normal",
              tabSize: 2,
            }}
          >
            {renderHighlightedContent()}
          </div>

          {/* Foreground Native Textarea (100% IME-Safe, Zero Cursor Glitches) */}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onScroll={handleScroll}
            placeholder=""
            spellCheck={false}
            className="absolute inset-0 w-full h-full p-4 font-sans text-sm leading-relaxed resize-none outline-none border-0 m-0 bg-transparent text-transparent caret-accent selection:bg-accent/30 selection:text-transparent z-10 break-words whitespace-pre-wrap cursor-text"
            style={{
              fontFamily: "inherit",
              letterSpacing: "normal",
              wordSpacing: "normal",
              tabSize: 2,
            }}
          />
        </div>
      </div>
    </div>
  );
};
