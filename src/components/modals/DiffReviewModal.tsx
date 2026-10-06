import React from "react";
import { AlertTriangle, Check, X, RotateCcw, Sparkles } from "lucide-react";

interface DiffReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  originalText: string;
  proposedText: string;
  onAccept: () => void;
  onReject: () => void;
  onRestoreOriginal: () => void;
  hasLexicalViolation?: boolean;
}

export const DiffReviewModal: React.FC<DiffReviewModalProps> = ({
  isOpen,
  onClose,
  originalText,
  proposedText,
  onAccept,
  onReject,
  onRestoreOriginal,
  hasLexicalViolation = true,
}) => {
  if (!isOpen) return null;

  // Simple tokenized diff computation for visualization
  // Computes word/punctuation tokens and detects additions / removals
  const renderTokenDiff = () => {
    // Check for differences in words
    const origWords = originalText.split(/(\s+|[.,!?:;—]+)/);
    const propWords = proposedText.split(/(\s+|[.,!?:;—]+)/);

    return {
      before: (
        <div className="p-4 text-textPrimary leading-relaxed font-sans text-sm select-text whitespace-pre-wrap">
          {origWords.map((token, idx) => {
            const isRemoved = !propWords.includes(token) && token.trim() !== "";
            if (isRemoved) {
              return (
                <span
                  key={idx}
                  className="bg-rose-950/60 text-rose-300 line-through px-1 py-0.5 rounded border border-rose-800/60 mx-0.5"
                  title="Từ này đã bị xóa hoặc thay thế"
                >
                  {token}
                </span>
              );
            }
            return <span key={idx}>{token}</span>;
          })}
        </div>
      ),
      after: (
        <div className="p-4 text-textPrimary leading-relaxed font-sans text-sm select-text whitespace-pre-wrap">
          {propWords.map((token, idx) => {
            const isAdded = !origWords.includes(token) && token.trim() !== "";
            const isPunctuation = /^[.,!?:;—]+$/.test(token.trim());

            if (isAdded) {
              return (
                <span
                  key={idx}
                  className={`px-1 py-0.5 rounded mx-0.5 font-medium ${
                    isPunctuation
                      ? "bg-accent/20 text-accent border border-accent/50 font-bold"
                      : "bg-emerald-950/70 text-emerald-300 border border-emerald-800/60"
                  }`}
                  title={isPunctuation ? "Dấu câu mới được thêm" : "Từ ngữ mới được sửa đổi"}
                >
                  {token}
                </span>
              );
            }
            return <span key={idx}>{token}</span>;
          })}
        </div>
      ),
    };
  };

  const diffViews = renderTokenDiff();

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-surface1 border border-borderDefault rounded-xl w-full max-w-4xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 max-h-[85vh]">
        {/* Header */}
        <div className="p-4 border-b border-borderDefault flex items-center justify-between bg-surface2/40">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center text-accent">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-textPrimary">
                Kiểm tra thay đổi đề xuất bởi AI
              </h3>
              <p className="text-xs text-textMuted">
                So sánh chi tiết dấu câu và từ ngữ trước khi cập nhật vào kịch bản.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-surface3 text-textMuted hover:text-textPrimary rounded-md transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Lexical Guardrail Alert Banner */}
        {hasLexicalViolation && (
          <div className="px-4 py-3 bg-amber-950/50 border-b border-amber-800/60 flex items-center gap-3 text-xs text-amber-300">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <div className="flex-1 leading-normal">
              <span className="font-bold">Cảnh báo thay đổi từ ngữ: </span>
              <span>
                AI đã thay đổi một số từ ngữ thay vì chỉ thêm dấu câu. Vui lòng kiểm tra kỹ các đoạn đánh dấu màu xanh trước khi áp dụng.
              </span>
            </div>
          </div>
        )}

        {/* Side-by-Side Comparison with True Diff Highlights */}
        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          {/* Before */}
          <div className="flex flex-col border border-borderDefault rounded-lg overflow-hidden bg-surface2/30">
            <div className="px-3.5 py-2.5 bg-surface2 border-b border-borderDefault font-semibold text-textSecondary flex items-center justify-between">
              <span>Văn bản hiện tại (Gốc)</span>
              <span className="text-[11px] text-textMuted font-mono">Trước thay đổi</span>
            </div>
            {diffViews.before}
          </div>

          {/* After */}
          <div className="flex flex-col border border-borderDefault rounded-lg overflow-hidden bg-surface2/30">
            <div className="px-3.5 py-2.5 bg-accent/10 border-b border-accent/20 font-semibold text-accent flex items-center justify-between">
              <span>Bản đề xuất bởi AI</span>
              <span className="text-[11px] text-accent/80 font-mono">Đã thêm dấu câu & sửa từ</span>
            </div>
            {diffViews.after}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-3 border-t border-borderDefault bg-surface2/40 flex items-center justify-between">
          <button
            onClick={onRestoreOriginal}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-textMuted hover:text-textPrimary hover:bg-surface2 rounded-md transition-colors border border-transparent hover:border-borderDefault"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Khôi phục bản gốc</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onReject}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs text-textSecondary hover:text-textPrimary hover:bg-surface3 rounded-md transition-colors border border-borderDefault font-medium"
            >
              <X className="w-3.5 h-3.5" />
              <span>Từ chối</span>
            </button>
            <button
              onClick={onAccept}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-accent text-background hover:bg-accent/90 rounded-md transition-colors shadow-sm"
            >
              <Check className="w-4 h-4" />
              <span>Chấp nhận & Áp dụng</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
