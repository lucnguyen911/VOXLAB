import React, { useState, useEffect } from "react";
import { FolderSync, CheckCircle2, FolderOpen, X } from "lucide-react";

interface MigrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  oldPath: string;
  newPath: string;
  onSuccess?: (newPath: string) => void;
}

export const MigrationModal: React.FC<MigrationModalProps> = ({
  isOpen,
  onClose,
  oldPath = "C:\\Users\\Admin\\AppData\\Local\\VoxLab",
  newPath = "D:\\VoxLabData",
  onSuccess,
}) => {
  const [step, setStep] = useState<"confirm" | "migrating" | "success">("confirm");
  const [targetPath, setTargetPath] = useState(newPath);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (isOpen) {
      setStep("confirm");
      setTargetPath(newPath);
      setProgress(0);
    }
  }, [isOpen, newPath]);

  if (!isOpen) return null;

  const handleStartMigration = () => {
    setStep("migrating");
    setProgress(20);
    setTimeout(() => setProgress(55), 500);
    setTimeout(() => setProgress(85), 1000);
    setTimeout(() => {
      setProgress(100);
      setStep("success");
      if (onSuccess) {
        onSuccess(targetPath);
      }
    }, 1500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-surface1 border border-borderDefault rounded-2xl w-full max-w-md shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-4 border-b border-borderDefault flex items-center justify-between bg-surface2/40">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center text-accent shrink-0">
              <FolderSync className="w-4 h-4" />
            </div>
            <h3 className="font-bold text-sm text-textPrimary">
              Thay Đổi Thư Mục Dữ Liệu
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-surface3 text-textMuted hover:text-textPrimary rounded-lg transition-colors cursor-pointer"
            aria-label="Đóng"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 text-xs space-y-4">
          {step === "confirm" && (
            <div className="space-y-4">
              {/* Thư mục hiện tại */}
              <div className="space-y-1.5">
                <label className="font-semibold text-xs text-textSecondary block">
                  Thư mục hiện tại
                </label>
                <input
                  type="text"
                  readOnly
                  value={oldPath}
                  className="w-full bg-surface2 border border-borderDefault rounded-xl px-3.5 py-2.5 text-xs font-mono text-textMuted focus:outline-none cursor-default"
                />
              </div>

              {/* Thư mục mới */}
              <div className="space-y-1.5">
                <label className="font-semibold text-xs text-textPrimary block">
                  Thư mục mới
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={targetPath}
                    onChange={(e) => setTargetPath(e.target.value)}
                    placeholder="Nhập hoặc chọn đường dẫn..."
                    className="flex-1 bg-surface2 border border-borderDefault rounded-xl px-3.5 py-2.5 text-xs font-mono text-textPrimary placeholder:text-textMuted focus:border-accent focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setTargetPath("D:\\VoxLabData")}
                    className="flex items-center gap-1.5 px-3.5 py-2.5 bg-surface2 hover:bg-surface3 text-textPrimary rounded-xl border border-borderDefault text-xs font-medium transition-colors cursor-pointer shrink-0"
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-accent" />
                    <span>Duyệt...</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {step === "migrating" && (
            <div className="py-6 space-y-4 text-center">
              <div className="w-12 h-12 mx-auto rounded-full bg-accent/15 border border-accent/40 flex items-center justify-center text-accent animate-spin">
                <FolderSync className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h4 className="font-bold text-sm text-textPrimary">Đang di chuyển dữ liệu...</h4>
                <p className="text-xs text-textMuted font-mono">
                  {progress < 50
                    ? "Đang sao chép cơ sở dữ liệu..."
                    : progress < 90
                    ? "Đang kiểm tra tính toàn vẹn..."
                    : "Đang kích hoạt đường dẫn mới..."}
                </p>
              </div>
              <div className="w-full bg-surface3 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-accent h-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {step === "success" && (
            <div className="py-6 space-y-3 text-center">
              <div className="w-12 h-12 mx-auto rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-500">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h4 className="font-bold text-sm text-textPrimary">
                Chuyển thư mục dữ liệu thành công!
              </h4>
              <p className="text-xs text-textSecondary max-w-sm mx-auto font-mono">
                {targetPath}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3.5 border-t border-borderDefault bg-surface2/40 flex items-center justify-end gap-2.5">
          {step === "confirm" ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs text-textSecondary hover:text-textPrimary bg-surface2 hover:bg-surface3 rounded-xl transition-colors border border-borderDefault font-medium cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleStartMigration}
                className="px-5 py-2 text-xs font-semibold bg-accent text-white hover:bg-accent/90 rounded-xl transition-colors shadow-xs cursor-pointer"
              >
                Xác nhận
              </button>
            </>
          ) : step === "success" ? (
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 text-xs font-semibold bg-emerald-500 text-white hover:bg-emerald-600 rounded-xl transition-colors cursor-pointer"
            >
              Hoàn tất
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default MigrationModal;
