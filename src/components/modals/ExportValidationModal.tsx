import React from "react";
import { AlertTriangle, RefreshCw, X } from "lucide-react";
import { ChunkItem } from "../../types/ui";

interface ExportValidationModalProps {
  isOpen: boolean;
  onClose: () => void;
  invalidChunks: ChunkItem[];
  onRegenerateInvalid: () => void;
  onForceExport?: () => void;
}

export const ExportValidationModal: React.FC<ExportValidationModalProps> = ({
  isOpen,
  onClose,
  invalidChunks,
  onRegenerateInvalid,
  onForceExport,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 select-none">
      <div className="bg-surface1 border border-borderDefault rounded-xl w-full max-w-lg shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-4 border-b border-borderDefault flex items-center justify-between bg-surface2/40">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-950/60 border border-amber-800/80 flex items-center justify-center text-amber-400">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-textPrimary">
                Chưa thể ghép & xuất audio hoàn chỉnh
              </h3>
              <p className="text-xs text-textMuted">
                Phát hiện một số đoạn chưa có audio khớp với văn bản mới nhất.
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

        {/* Content */}
        <div className="p-5 space-y-4 text-xs">
          <p className="text-textSecondary leading-relaxed">
            Để đảm bảo file audio đầu ra chính xác 100% so với kịch bản, các đoạn đã chỉnh sửa hoặc bị lỗi cần được tạo lại trước khi ghép file:
          </p>

          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {invalidChunks.map((chunk) => {
              let badgeText = "Chưa sẵn sàng";
              let badgeStyle = "bg-rose-950 text-rose-300 border border-rose-800";

              if ((chunk as any).isSkipped || (chunk.status as string) === "skipped") {
                badgeText = "Đoạn đã bị bỏ qua (chưa có audio)";
                badgeStyle = "bg-amber-950 text-amber-300 border border-amber-800";
              } else if (chunk.status === "modified") {
                badgeText = "Đã sửa nội dung, chưa tạo lại";
                badgeStyle = "bg-amber-950 text-amber-300 border border-amber-800";
              } else if (chunk.status === "failed") {
                badgeText = "Tạo audio thất bại";
                badgeStyle = "bg-rose-950 text-rose-300 border border-rose-800";
              } else if (chunk.status === "pending") {
                badgeText = "Chưa có audio";
                badgeStyle = "bg-surface3 text-textSecondary border border-borderDefault";
              }

              return (
                <div
                  key={chunk.id}
                  className="p-3 bg-surface2 rounded-lg border border-borderDefault flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono font-bold text-accent px-1.5 py-0.5 rounded bg-surface3 text-[11px]">
                      {String(chunk.index).padStart(2, "0")}
                    </span>
                    <span className="text-textPrimary truncate font-medium text-xs">
                      {chunk.text}
                    </span>
                  </div>

                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded whitespace-nowrap ${badgeStyle}`}
                  >
                    {badgeText}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="p-3 bg-surface2/60 border border-borderDefault rounded-lg text-[11px] text-textMuted">
            💡 Bấm nút <strong>Tạo lại các đoạn cần xử lý</strong> bên dưới để hệ thống tự động sinh lại audio cho đúng các đoạn này.
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-borderDefault bg-surface2/40 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-3 py-2 text-xs text-textSecondary hover:text-textPrimary rounded-md transition-colors border border-borderDefault font-medium"
          >
            Đóng
          </button>

          <div className="flex items-center gap-2">
            {onForceExport && (
              <button
                onClick={onForceExport}
                className="px-3 py-2 text-xs text-textMuted hover:text-textSecondary rounded-md transition-colors"
                title="Bỏ qua các đoạn lỗi và chỉ xuất các đoạn đã sẵn sàng"
              >
                Vẫn xuất các đoạn đã có
              </button>
            )}

            <button
              onClick={onRegenerateInvalid}
              className="flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-accent text-background hover:bg-accent/90 rounded-md transition-colors shadow-sm"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Tạo lại {invalidChunks.length} đoạn cần xử lý</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
