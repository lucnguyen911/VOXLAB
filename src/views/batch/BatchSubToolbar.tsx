import React from "react";
import { UploadCloud, SlidersHorizontal, Search, X, RotateCcw } from "lucide-react";

export interface BatchSubToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onUploadClick: () => void;
  onGlobalConfigClick: () => void;
  autoRetryEnabled?: boolean;
  onToggleAutoRetry?: (enabled: boolean) => void;
  maxAutoRetries?: number;
}

/**
 * Sub-Toolbar for Tab Danh sách (Staging Area) (AC-21, AC-22)
 * Strictly visible ONLY in Tab Danh sách; omitted from all other views.
 */
export const BatchSubToolbar: React.FC<BatchSubToolbarProps> = ({
  searchQuery,
  onSearchChange,
  onUploadClick,
  onGlobalConfigClick,
  autoRetryEnabled = false,
  onToggleAutoRetry,
  maxAutoRetries = 5,
}) => {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 p-2 bg-surface1 rounded-lg border border-borderDefault text-xs flex-shrink-0 shadow-2xs select-none">
      {/* Left: Upload, Bulk Config, and Auto-Retry Toggle */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={onUploadClick}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-textPrimary bg-surface2 hover:bg-surface3 border border-borderDefault rounded-md transition-colors shadow-2xs cursor-pointer"
          title="Tải lên tệp hoặc thư mục"
        >
          <UploadCloud className="w-3.5 h-3.5 text-accent" />
          <span>Tải Lên</span>
        </button>

        <div className="h-4 w-px bg-borderDefault mx-1" />

        <button
          type="button"
          onClick={onGlobalConfigClick}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-textPrimary hover:text-accent bg-surface2 hover:bg-surface3 border border-borderDefault rounded-md transition-colors shadow-2xs cursor-pointer"
          title="Cấu hình mặc định cho toàn bộ mẻ chạy"
        >
          <SlidersHorizontal className="w-3.5 h-3.5 text-textMuted" />
          <span>Cấu hình hàng loạt</span>
        </button>

        {onToggleAutoRetry && (
          <>
            <div className="h-4 w-px bg-borderDefault mx-1" />

            <button
              type="button"
              role="switch"
              aria-checked={autoRetryEnabled}
              onClick={() => onToggleAutoRetry(!autoRetryEnabled)}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors shadow-2xs cursor-pointer ${
                autoRetryEnabled
                  ? "bg-accent/10 border-accent/35 text-accent"
                  : "bg-surface2 hover:bg-surface3 border-borderDefault text-textSecondary"
              }`}
              title={`Tự động tạo lại và hậu kiểm tối đa ${maxAutoRetries} lần đối với các đoạn bị lỗi/cảnh báo. Nếu sau ${maxAutoRetries} lần vẫn còn cảnh báo, hệ thống sẽ bỏ qua và vẫn xuất file kèm cảnh báo.`}
            >
              <RotateCcw
                className={`w-3.5 h-3.5 ${
                  autoRetryEnabled ? "text-accent" : "text-textMuted"
                }`}
              />
              <span>Tự động tạo lại đoạn lỗi ({maxAutoRetries} lần)</span>
              <span
                className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
                  autoRetryEnabled ? "bg-accent" : "bg-surface3 border border-borderDefault"
                }`}
              >
                <span
                  className={`inline-block h-3 w-3 transform rounded-full bg-white shadow-2xs transition-transform ${
                    autoRetryEnabled ? "translate-x-3.5" : "translate-x-0.5"
                  }`}
                />
              </span>
            </button>
          </>
        )}
      </div>

      {/* Right: Search Box */}
      <div className="relative w-64">
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-textMuted pointer-events-none" />
        <input
          type="text"
          placeholder="Tìm kiếm tệp..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-8 pr-7 py-1 text-xs bg-surface2 text-textPrimary border border-borderDefault rounded-md focus:outline-none focus:border-accent placeholder:text-textMuted/60 transition-colors"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => onSearchChange("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-textMuted hover:text-textPrimary cursor-pointer"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
};
