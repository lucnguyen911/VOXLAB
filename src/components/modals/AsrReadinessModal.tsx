import React, { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle, Download, ArrowRight, X, ShieldAlert, Loader2 } from "lucide-react";
import type { AsrReadinessResult } from "../../services/ai/asrReadiness";
import {
  cancelAiModelInstall,
  installAiModel,
  normalizeWhisperModelId,
  onModelInstallProgress,
  type ModelInstallProgressEvent,
} from "../../services/ai/aiRuntimeSettings";

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
}) => {
  const [isInstalling, setIsInstalling] = useState(false);
  const [progress, setProgress] = useState<ModelInstallProgressEvent | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  const canonicalId = readiness ? normalizeWhisperModelId(readiness.selectedModel) : "large-v3-turbo";
  const targetModelFullId = `faster-whisper-${canonicalId}`;

  useEffect(() => {
    if (!isOpen) {
      setInstallError(null);
      return;
    }
    let unlisten: (() => void) | null = null;
    onModelInstallProgress((ev) => {
      if (ev.modelId === targetModelFullId && ev.status === "installing") {
        setIsInstalling(true);
        setProgress(ev);
      }
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => {
      if (unlisten) unlisten();
    };
  }, [isOpen, targetModelFullId]);

  if (!isOpen || !readiness) return null;

  const installedModels = readiness.installedModels || [];
  const hasInstalledModels = installedModels.length > 0;
  const pct = isInstalling ? Math.max(1, Math.min(100, Math.round(progress?.pct ?? 1))) : 0;

  const handleInstallSelected = async () => {
    if (isInstalling) return;
    setInstallError(null);
    setIsInstalling(true);
    setProgress({
      modelId: targetModelFullId,
      status: "installing",
      stage: "preparing",
      pct: 1,
      message: `Đang khởi tạo cài đặt ${readiness.selectedModelDisplayName}...`,
    });
    try {
      await installAiModel(targetModelFullId);
      setIsInstalling(false);
      setProgress(null);
      onSwitchModelAndProceed(canonicalId);
    } catch (err: any) {
      const code = err?.code || "";
      const msg = err?.message || String(err || "Không thể tải mô hình.");
      setIsInstalling(false);
      setProgress(null);
      if (code !== "CANCELLED" && !msg.includes("CANCELLED") && !msg.includes("Đã hủy")) {
        setInstallError(msg);
      }
    }
  };

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

            {/* Option 2: Direct In-App Download & Install */}
            <div className="p-3.5 rounded-xl border border-borderDefault bg-surface2/30 hover:bg-surface2/60 transition-all space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-textPrimary">
                      Tải & Cài đặt tự động {readiness.selectedModelDisplayName}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded-md border border-cyan-500/20">
                      <Download className="w-3 h-3" />
                      Tự động
                    </span>
                  </div>
                  <p className="text-xs text-textMuted mt-1">
                    Tự động thiết lập môi trường AI và tải {readiness.selectedModelDisplayName} về máy, sau đó tiếp tục tạo âm thanh ngay lập tức.
                  </p>
                </div>
                {isInstalling ? (
                  <button
                    type="button"
                    onClick={() => cancelAiModelInstall(targetModelFullId)}
                    className="shrink-0 px-3.5 py-2 bg-danger/10 hover:bg-danger/20 text-danger border border-danger/25 rounded-lg text-xs font-semibold transition-all cursor-pointer"
                  >
                    Hủy tải
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleInstallSelected}
                    className="shrink-0 px-3.5 py-2 bg-accent hover:bg-accentHover text-white rounded-lg text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Tải & Cài đặt</span>
                  </button>
                )}
              </div>

              {isInstalling && (
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="inline-flex items-center gap-1.5 text-textSecondary truncate">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-accent shrink-0" />
                      <span className="truncate">{progress?.message || "Đang tải mô hình..."}</span>
                    </span>
                    <span className="font-mono font-semibold text-accent shrink-0">{pct}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-surface3 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-300 rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )}

              {installError && (
                <div className="p-2.5 rounded-lg bg-danger/10 border border-danger/25 text-danger text-xs">
                  {installError}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-borderDefault bg-surface2/20 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={isInstalling}
            className="px-4 py-1.5 text-xs font-medium text-textMuted hover:text-textPrimary hover:bg-surface3 rounded-lg transition-colors disabled:opacity-50"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
