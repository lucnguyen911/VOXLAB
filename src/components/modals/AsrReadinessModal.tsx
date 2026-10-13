import React from "react";
import { AlertTriangle, CheckCircle, Download, ArrowRight, X, ShieldAlert } from "lucide-react";
import type { AsrReadinessResult } from "../../services/ai/asrReadiness";

interface AsrReadinessModalProps {
  isOpen: boolean;
  onClose: () => void;
  readiness: AsrReadinessResult | null;
  onSwitchModelAndProceed: (modelId: string) => void;
  onNavigateToTranscription: () => void;
}

export const AsrReadinessModal: React.FC<AsrReadinessModalProps> = ({
  isOpen,
  onClose,
  readiness,
  onSwitchModelAndProceed,
  onNavigateToTranscription,
}) => {
  if (!isOpen || !readiness) return null;

  const installedModels = readiness.installedModels || [];
  const hasInstalledModels = installedModels.length > 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150 select-none">
      <div className="bg-surface1 border border-borderDefault rounded-xl w-full max-w-xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-4 border-b border-borderDefault flex items-center justify-between bg-surface2/40">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-500 shrink-0">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-textPrimary">
                Chưa sẵn sàng bộ kiểm tra chất lượng giọng đọc (ASR)
              </h3>
              <p className="text-xs text-textMuted mt-0.5">
                Cần mô hình ASR hợp lệ để hậu kiểm nuốt từ, vấp từ và tính chuẩn xác
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

        {/* Content Body */}
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Warning Banner */}
          <div className="p-3.5 rounded-lg bg-amber-500/10 border border-amber-500/25 flex items-start gap-3 text-xs leading-relaxed text-textSecondary">
            <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-textPrimary mb-1">
                Mô hình đang chọn:{" "}
                <span className="text-amber-400 font-bold">{readiness.selectedModelDisplayName}</span>
              </p>
              <p>{readiness.reason || "Mô hình chưa được cài đặt hoặc thiếu file trọng số model.bin."}</p>
              <p className="mt-1 text-textMuted">
                Quy tắc VoxLab: Hệ thống <strong className="text-textSecondary">không tự ý âm thầm hạ cấp</strong> mô hình khi chưa có sự đồng ý của bạn. Vui lòng chọn phương án giải quyết dưới đây để đảm bảo mọi đoạn âm thanh tạo ra đều được hậu kiểm tự động.
              </p>
            </div>
          </div>

          {/* Action Options */}
          <div className="space-y-2.5">
            <p className="text-xs font-semibold text-textMuted uppercase tracking-wider">
              Phương án đề xuất
            </p>

            {/* Option 1: Switch to already installed model */}
            {hasInstalledModels ? (
              installedModels.map((m) => (
                <div
                  key={m.id}
                  className="p-3.5 rounded-xl border border-accent/35 bg-accent/[0.04] hover:bg-accent/[0.08] transition-all flex items-center justify-between gap-3 group"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-textPrimary group-hover:text-accent transition-colors">
                        Chuyển sang {m.displayName} (Đã có sẵn)
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20">
                        <CheckCircle className="w-3 h-3" />
                        Sẵn sàng
                      </span>
                    </div>
                    <p className="text-xs text-textMuted mt-1">
                      Đồng bộ mô hình ASR toàn ứng dụng sang {m.displayName} và bắt đầu tạo âm thanh kèm hậu kiểm tự động ngay lập tức.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onSwitchModelAndProceed(m.id)}
                    className="shrink-0 px-3.5 py-2 bg-accent hover:bg-accentHover text-white rounded-lg text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all"
                  >
                    <span>Chọn & Tiếp tục</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            ) : (
              <div className="p-3 rounded-lg border border-borderDefault bg-surface2/40 text-xs text-textMuted">
                Chưa có mô hình ASR nào được cài đặt trong thư mục models.
              </div>
            )}

            {/* Option 2: Navigate to Transcription tab to download selected model */}
            <div className="p-3.5 rounded-xl border border-borderDefault bg-surface2/30 hover:bg-surface2/60 transition-all flex items-center justify-between gap-3 group">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-textPrimary group-hover:text-textPrimary transition-colors">
                    Tải mô hình tại tab Phụ đề
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded-md border border-cyan-500/20">
                    <Download className="w-3 h-3" />
                    Tải về máy
                  </span>
                </div>
                <p className="text-xs text-textMuted mt-1">
                  Đến tab Phụ đề để tải mô hình {readiness.selectedModelDisplayName} đầy đủ trước khi thực hiện tác vụ tạo giọng đọc.
                </p>
              </div>
              <button
                type="button"
                onClick={onNavigateToTranscription}
                className="shrink-0 px-3.5 py-2 bg-surface3 hover:bg-surface2 text-textPrimary border border-borderDefault hover:border-textMuted/40 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5"
              >
                <span>Đến tab Phụ đề</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-borderDefault bg-surface2/20 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium text-textMuted hover:text-textPrimary hover:bg-surface3 rounded-lg transition-colors"
          >
            Hủy bỏ
          </button>
        </div>
      </div>
    </div>
  );
};
