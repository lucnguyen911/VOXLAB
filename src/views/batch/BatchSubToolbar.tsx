import React from "react";
import { UploadCloud, SlidersHorizontal, Search, X } from "lucide-react";

export interface BatchSubToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onUploadClick: () => void;
  onGlobalConfigClick: () => void;
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
}) => {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 p-2 bg-surface1 rounded-lg border border-borderDefault text-xs flex-shrink-0 shadow-2xs select-none">
      {/* Left: Upload and Bulk Config buttons */}
      <div className="flex items-center gap-2">
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
