import React, { useState, useEffect, useRef } from "react";
import { Key, Check, AlertCircle, X, Loader2, LogOut, ShieldCheck } from "lucide-react";
import { LicenseService, LicenseSummary } from "../../services/license/licenseService";

interface LicenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (license: LicenseSummary) => void;
  isInitialLaunch?: boolean;
  mandatory?: boolean;
  initialErrorMessage?: string | null;
}

export const LicenseModal: React.FC<LicenseModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  isInitialLaunch = false,
  mandatory = false,
  initialErrorMessage = null,
}) => {
  const [keyValue, setKeyValue] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(initialErrorMessage);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setKeyValue("");
      setErrorMessage(initialErrorMessage);
      setSuccessMessage(null);
      setIsLoading(false);
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [isOpen, initialErrorMessage]);

  if (!isOpen) return null;

  const handleExitOrClose = async () => {
    if (isLoading) return;
    if (mandatory) {
      await LicenseService.exitApplication();
      return;
    }
    onClose();
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const raw = (inputRef.current?.value || keyValue || "").trim();
    if (!raw) {
      setErrorMessage("Vui lòng nhập License Key kích hoạt phần mềm.");
      inputRef.current?.focus();
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const summary =
        mandatory || isInitialLaunch
          ? await LicenseService.activate(raw)
          : await LicenseService.changeKey(raw);

      // Immediately clear sensitive input so raw key never persists in React state or DOM
      setKeyValue("");
      if (inputRef.current) {
        inputRef.current.value = "";
      }

      if (summary.is_valid && summary.can_use_app) {
        setSuccessMessage("Kích hoạt bản quyền thành công!");
        setTimeout(() => {
          setIsLoading(false);
          onSuccess(summary);
          if (!mandatory) {
            onClose();
          }
        }, 450);
      } else {
        setIsLoading(false);
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
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${
        mandatory ? "bg-bgCanvas" : "bg-black/75 backdrop-blur-xs"
      }`}
    >
      <div className="bg-surface1 border border-borderDefault rounded-2xl w-full max-w-md shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-4 border-b border-borderDefault flex items-center justify-between bg-surface2/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center text-accent shrink-0">
              {mandatory ? <ShieldCheck className="w-5 h-5" /> : <Key className="w-4 h-4" />}
            </div>
            <div>
              <h3 className="font-extrabold text-sm tracking-wide text-textPrimary">
                {mandatory ? "VOXLAB PREMIUM" : "Đổi Key Bản Quyền"}
              </h3>
              <p className="text-[11px] text-textMuted">
                Hệ thống bảo mật bản quyền • Security v3
              </p>
            </div>
          </div>
          {!mandatory && (
            <button
              type="button"
              onClick={handleExitOrClose}
              disabled={isLoading}
              className="p-1.5 hover:bg-surface3 text-textMuted hover:text-textPrimary rounded-lg transition-colors cursor-pointer disabled:opacity-50"
              aria-label="Đóng"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="voxlab-license-key-input"
              className="text-xs font-semibold text-textSecondary block"
            >
              Vui lòng nhập License Key kích hoạt phần mềm:
            </label>
            <div className="relative">
              <input
                id="voxlab-license-key-input"
                ref={inputRef}
                type="text"
                value={keyValue}
                onChange={(e) => {
                  setKeyValue(e.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                placeholder="VOXLAB-XXXX-XXXX-XXXX-XXXX"
                disabled={isLoading}
                autoComplete="off"
                spellCheck={false}
                className="w-full bg-surface2 border border-borderDefault rounded-xl px-4 py-3 text-sm font-mono text-center tracking-wider text-textPrimary placeholder:text-textMuted/60 focus:border-accent focus:outline-none uppercase disabled:opacity-50"
              />
            </div>
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div className="p-3 rounded-xl bg-danger/10 border border-danger/20 text-danger text-xs flex items-start gap-2 animate-in fade-in duration-100">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{errorMessage}</span>
            </div>
          )}

          {/* Success Message */}
          {successMessage && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs flex items-center gap-2 animate-in fade-in duration-100">
              <Check className="w-4 h-4 shrink-0" />
              <span className="font-medium">{successMessage}</span>
            </div>
          )}

          {/* Actions */}
          <div className="pt-2 flex items-center justify-between gap-2.5">
            <button
              type="button"
              onClick={handleExitOrClose}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-surface2 hover:bg-surface3 text-textSecondary hover:text-textPrimary rounded-xl border border-borderDefault text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
            >
              {mandatory ? (
                <>
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Thoát</span>
                </>
              ) : (
                <span>Hủy</span>
              )}
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl transition-colors text-xs cursor-pointer shadow-xs disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Đang kiểm tra kết nối & bản quyền...</span>
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Kích hoạt ngay</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
