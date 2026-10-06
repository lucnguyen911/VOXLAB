import React from "react";
import { BatchWorkspaceView } from "../../types/batch";

export interface BatchViewTabsProps {
  activeView: BatchWorkspaceView;
  onViewChange: (view: BatchWorkspaceView) => void;
  viewCounts: {
    list: number;
    queued: number;
    completed: number;
    failed: number;
    processing: number;
  };
}

/**
 * 4 Unified Batch Views Tabs Component (AC-21, AC-22, AC-24)
 * Renders:
 * - Danh sách (list)
 * - Hàng đợi (queued)
 * - Hoàn tất (completed)
 * - Lỗi (failed)
 * with real-time count badges and running dot indicator.
 */
export const BatchViewTabs: React.FC<BatchViewTabsProps> = ({
  activeView,
  onViewChange,
  viewCounts,
}) => {
  return (
    <div className="inline-flex bg-surface2/80 rounded-lg p-0.5 border border-borderDefault/80 text-xs flex-shrink-0 gap-0.5 select-none">
      {/* 1. Tab Danh sách */}
      <button
        type="button"
        onClick={() => onViewChange("list")}
        className={`px-3 py-1 rounded-md font-medium transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
          activeView === "list"
            ? "bg-surface1 text-textPrimary font-bold shadow-2xs"
            : "text-textMuted hover:text-textPrimary"
        }`}
      >
        <span>Danh sách</span>
        <span
          className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
            activeView === "list"
              ? "bg-accent/20 text-accent font-bold"
              : "bg-surface3 text-textMuted"
          }`}
        >
          {viewCounts.list}
        </span>
      </button>

      {/* 2. Tab Hàng đợi */}
      <button
        type="button"
        onClick={() => onViewChange("queued")}
        className={`px-3 py-1 rounded-md font-medium transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
          activeView === "queued"
            ? "bg-surface1 text-textPrimary font-bold shadow-2xs"
            : "text-textMuted hover:text-textPrimary"
        }`}
      >
        <span>Hàng đợi</span>
        {viewCounts.processing > 0 && (
          <span
            className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse"
            title="Đang có tệp đang chạy"
          />
        )}
        <span
          className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
            activeView === "queued"
              ? "bg-accent/20 text-accent font-bold"
              : "bg-surface3 text-textMuted"
          }`}
        >
          {viewCounts.queued}
        </span>
      </button>

      {/* 3. Tab Hoàn tất */}
      <button
        type="button"
        onClick={() => onViewChange("completed")}
        className={`px-3 py-1 rounded-md font-medium transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
          activeView === "completed"
            ? "bg-surface1 text-textPrimary font-bold shadow-2xs"
            : "text-textMuted hover:text-textPrimary"
        }`}
      >
        <span>Hoàn tất</span>
        <span
          className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
            activeView === "completed"
              ? "bg-success/20 text-success font-bold"
              : "bg-surface3 text-textMuted"
          }`}
        >
          {viewCounts.completed}
        </span>
      </button>

      {/* 4. Tab Lỗi */}
      <button
        type="button"
        onClick={() => onViewChange("failed")}
        className={`px-3 py-1 rounded-md font-medium transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
          activeView === "failed"
            ? "bg-surface1 text-danger font-bold shadow-2xs"
            : "text-textMuted hover:text-danger"
        }`}
      >
        <span>Lỗi</span>
        <span
          className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
            viewCounts.failed > 0
              ? "bg-danger/20 text-danger font-bold"
              : "bg-surface3 text-textMuted"
          }`}
        >
          {viewCounts.failed}
        </span>
      </button>
    </div>
  );
};
