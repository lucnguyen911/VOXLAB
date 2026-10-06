import React, { useState, useEffect, useRef } from "react";
import { Key, Check, AlertCircle, X, Loader2 } from "lucide-react";
import { LicenseService, LicenseSummary } from "../../services/license/licenseService";

interface LicenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (license: LicenseSummary) => void;
  isInitialLaunch?: boolean;
}

export const LicenseModal: React.FC<LicenseModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  isInitialLaunch = false,
}) => {
  const [keyValue, setKeyValue] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setKeyValue("");
      setErrorMessage(null);
      setIsLoading(false);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const raw = (inputRef.current?.value || keyValue || "").trim();
    if (!raw) {
      setErrorMessage("Vui lòng nhập mã License Key vào ô bên dưới.");
      inputRef.current?.focus();
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const summary = await LicenseService.activate(raw);
      // Immediately clear sensitive input so raw key never persists in React state or DOM
      setKeyValue("");
      if (inputRef.current) {
        inputRef.current.value = "";
      }
      setIsLoading(false);

      if (summary.is_valid && summary.can_use_app) {
        onSuccess(summary);
        onClose();
      } else {
        setErrorMessage(summary.error_message || "Mã License Key không hợp lệ.");
        inputRef.current?.focus();
      }
    } catch (err: unknown) {
      setIsLoading(false);
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg || "Đã xảy ra lỗi khi xác thực bản quyền.");
      inputRef.current?.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-surface1 border border-borderDefault rounded-2xl w-full max-w-md shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-4 border-b border-borderDefault flex items-center justify-between bg-surface2/40">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center text-accent shrink-0">
              <Key className="w-4 h-4" />
            </div>
            <h3 className="font-bold text-sm text-textPrimary">
              Key Bản Quyền
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

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-textPrimary block">
              Mã bản quyền
            </label>
            <div className="relative">
              <input
                ref={inputRef}
                type="text"
                value={keyValue}
                onChange={(e) => {
                  setKeyValue(e.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                placeholder="xxx-xxx-xxx-xxx"
                disabled={isLoading}
                className="w-full bg-surface2 border border-borderDefault rounded-xl px-4 py-3 text-sm font-mono text-center tracking-wider text-textPrimary placeholder:text-textMuted/60 focus:border-accent focus:outline-none uppercase disabled:opacity-50"
              />
            </div>
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div className="p-3 rounded-xl bg-danger/10 border border-danger/20 text-danger text-xs flex items-center gap-2 animate-in fade-in duration-100">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Actions */}
          <div className="pt-2 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2 bg-surface2 hover:bg-surface3 text-textSecondary hover:text-textPrimary rounded-xl border border-borderDefault text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
            >
              {isInitialLaunch ? "Để sau" : "Hủy"}
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex items-center gap-1.5 px-5 py-2 bg-accent hover:bg-accent/90 text-white font-medium rounded-xl transition-colors text-xs cursor-pointer shadow-xs disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Đang kiểm tra...</span>
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Kích hoạt</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
