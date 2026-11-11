import React, { useEffect, useState } from "react";
import { Download, RefreshCw, ShieldCheck, Sparkles, X, AlertCircle } from "lucide-react";
import {
  cancelAppUpdateDownload,
  downloadAndInstallUpdate,
  onAppUpdateProgress,
  type AppUpdateProgressEvent,
  type UpdateCheckResult,
} from "../../services/updater/updaterService";

interface AppUpdateModalProps {
  isOpen: boolean;
  updateInfo: UpdateCheckResult | null;
  onClose: () => void;
}

export const AppUpdateModal: React.FC<AppUpdateModalProps> = ({
  isOpen,
  updateInfo,
  onClose,
}) => {
  const [isUpdating, setIsUpdating] = useState(false);
  const [progress, setProgress] = useState<AppUpdateProgressEvent | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setIsUpdating(false);
      setProgress(null);
      setErrorMsg(null);
      return;
    }
    let unlisten: (() => void) | null = null;
    onAppUpdateProgress((ev) => {
      setProgress(ev);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => {
      if (unlisten) unlisten();
    };
  }, [isOpen]);

  if (!isOpen || !updateInfo || !updateInfo.updateAvailable) return null;

  const isForced = Boolean(updateInfo.isForced);
  const sizeLabel =
    updateInfo.fileSize && updateInfo.fileSize > 0
      ? `${(updateInfo.fileSize / (1024 * 1024)).toFixed(1)} MB`
      : null;

  const handleStartUpdate = async () => {
    if (isUpdating) return;
    setErrorMsg(null);
    setIsUpdating(true);
    setProgress({
      stage: "downloading",
      pct: 1,
      downloadedMb: 0,
      totalMb: updateInfo.fileSize ? Number((updateInfo.fileSize / (1024 * 1024)).toFixed(1)) : 0,
      speedMbps: 0,
      message: `Đang khởi tạo tải VoxLab v${updateInfo.latestVersion}...`,
    });

    try {
      await downloadAndInstallUpdate();
    } catch (err: any) {
      const msg = err?.message || String(err || "Không thể tải bản cập nhật.");
      setIsUpdating(false);
      setProgress(null);
      if (!msg.includes("CANCELLED") && !msg.includes("Đã hủy")) {
        setErrorMsg(msg);
      }
    }
  };

  const handleCancelDownload = async () => {
    await cancelAppUpdateDownload();
  };

  const pct = isUpdating ? Math.max(1, Math.min(100, Math.round(progress?.pct ?? 1))) : 0;

  return (
    <div className="fixed inset-0 z-[70] bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150 select-none">
      <div className="bg-surface1 border border-borderDefault rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-borderDefault bg-surface2/50 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src="/app-icon.png?v=2"
              alt="VoxLab"
              className="w-10 h-10 rounded-xl shadow-md shadow-accent/25 object-cover shrink-0 select-none"
              draggable={false}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-bold text-textPrimary">
                  Cập nhật VoxLab v{updateInfo.latestVersion}
                </h3>
                {isForced ? (
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide bg-amber-500/15 text-amber-500 border border-amber-500/30">
                    Bắt buộc
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-500/15 text-emerald-500 border border-emerald-500/30">
                    <Sparkles className="w-2.5 h-2.5" />
                    <span>Phiên bản mới</span>
                  </span>
                )}
              </div>
              <p className="text-[11px] text-textMuted font-mono mt-0.5">
                Hiện tại: v{updateInfo.currentVersion} → Mới nhất: v{updateInfo.latestVersion}
                {sizeLabel ? ` • ${sizeLabel}` : ""}
              </p>
            </div>
          </div>

          {!isForced && !isUpdating && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-textMuted hover:text-textPrimary hover:bg-surface3 transition-colors cursor-pointer"
              aria-label="Đóng"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[68vh] overflow-y-auto text-xs">
          {isForced && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-textSecondary leading-relaxed">
              Đây là bản cập nhật quan trọng bắt buộc để đồng bộ bảo mật và hiệu năng hệ thống. Vui lòng cập nhật để tiếp tục sử dụng VoxLab.
            </div>
          )}

          {updateInfo.changelog && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-textMuted uppercase tracking-wider">
                Nội dung nâng cấp
              </div>
              <div className="p-3.5 rounded-xl bg-surface2/60 border border-borderDefault text-textPrimary leading-relaxed whitespace-pre-line">
                {updateInfo.changelog}
              </div>
            </div>
          )}

          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-surface2/40 border border-borderDefault/70 text-[11px] text-textSecondary leading-relaxed">
            <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
            <span>
              Toàn bộ <strong className="text-textPrimary">Key bản quyền, các mô hình AI đã tải, thư viện thực thi và giọng đọc nhân bản</strong> của bạn được giữ nguyên 100% sau khi nâng cấp.
            </span>
          </div>

          {isUpdating && (
            <div className="p-3.5 rounded-xl bg-surface2 border border-borderDefault space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-textPrimary font-medium min-w-0">
                  <RefreshCw className="w-3.5 h-3.5 text-accent animate-spin shrink-0" />
                  <span className="truncate">{progress?.message || "Đang tải gói cập nhật..."}</span>
                </div>
                <span className="font-mono font-bold text-accent shrink-0">{pct}%</span>
              </div>

              <div className="w-full h-2 bg-surface3 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>

              {(progress?.speedMbps || progress?.totalMb) ? (
                <div className="flex items-center justify-between text-[11px] font-mono text-textMuted pt-0.5">
                  <span>
                    {progress.totalMb > 0
                      ? `${progress.downloadedMb.toFixed(1)} / ${progress.totalMb.toFixed(1)} MB`
                      : `${progress.downloadedMb.toFixed(1)} MB`}
                  </span>
                  {progress.speedMbps > 0 && (
                    <span className="text-accent font-semibold">
                      {progress.speedMbps.toFixed(1)} MB/s
                    </span>
                  )}
                </div>
              ) : null}
            </div>
          )}

          {errorMsg && (
            <div className="p-3 rounded-xl bg-danger/10 border border-danger/25 text-danger flex items-start gap-2 leading-relaxed">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-borderDefault bg-surface2/40 flex items-center justify-end gap-2.5">
          {isUpdating ? (
            !isForced && (
              <button
                type="button"
                onClick={handleCancelDownload}
                className="px-4 py-2 rounded-xl bg-danger/10 hover:bg-danger/20 text-danger border border-danger/25 text-xs font-semibold transition-colors cursor-pointer"
              >
                Hủy tải
              </button>
            )
          ) : (
            <>
              {!isForced && (
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl bg-surface2 hover:bg-surface3 text-textSecondary hover:text-textPrimary border border-borderDefault text-xs font-medium transition-colors cursor-pointer"
                >
                  Để sau
                </button>
              )}
              <button
                type="button"
                onClick={handleStartUpdate}
                className="px-4 py-2 rounded-xl bg-accent hover:bg-accentHover text-white text-xs font-semibold shadow-sm flex items-center gap-1.5 transition-all cursor-pointer active:scale-[0.98]"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{errorMsg ? "Tải lại & Cập nhật" : "Cập nhật ngay"}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
