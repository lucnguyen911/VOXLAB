import React from "react";
import {
  ListPlus,
  Play,
  Pause,
} from "lucide-react";
import { BatchWorkspaceView, BatchQueueStatus } from "../../types/batch";
import { BatchViewTabs } from "./BatchViewTabs";

export interface BatchTopBarProps {
  activeView: BatchWorkspaceView;
  onViewChange: (view: BatchWorkspaceView) => void;
  viewCounts: {
    list: number;
    queued: number;
    completed: number;
    failed: number;
    processing: number;
  };
  queueStatus: BatchQueueStatus;
  totalJobCount: number;
  selectedJobCount: number;
  onStageToQueue: () => void;
  onStartQueue: () => void;
  onPauseQueue: () => void;
  onGlobalConfigClick: () => void;
  onStartFromList?: () => void;
}

/**
 * Top Control Bar for Batch Workspace (AC-21, AC-22, AC-24)
 * Contains:
 * - 4 View Switcher Tabs (Danh sách, Hàng đợi, Hoàn tất, Lỗi)
 * - Dynamic Status Diagnostics (Right side)
 * - Contextual Primary Action Button:
 *   - Tab Danh sách: [Chuyển sang hàng đợi (X)] & [Bắt đầu xử lý (X)]
 *   - Tab Hàng đợi: [Bắt đầu xử lý] / [Tạm dừng]
 *   - Tab Hoàn tất / Lỗi: [Về Hàng đợi]
 */
export const BatchTopBar: React.FC<BatchTopBarProps> = ({
  activeView,
  onViewChange,
  viewCounts,
  queueStatus,
  totalJobCount,
  selectedJobCount,
  onStageToQueue,
  onStartQueue,
  onPauseQueue,
  onGlobalConfigClick: _onGlobalConfigClick,
  onStartFromList,
}) => {
  return (
    <div className="h-12 px-4 border-b border-borderDefault bg-panel flex items-center justify-between flex-shrink-0 z-10 shadow-xs gap-3 select-none">
      {/* Left: 4 View Switcher Tabs */}
      <BatchViewTabs
        activeView={activeView}
        onViewChange={onViewChange}
        viewCounts={viewCounts}
      />

      {/* Right: Dynamic Primary Action Button & Status Diagnostics */}
      <div className="flex items-center gap-3">
        {activeView !== "list" && (
          <div className="text-right hidden sm:block">
            {activeView === "queued" ? (
              <>
                <div className="text-[11px] text-textMuted font-medium">
                  Hàng đợi: <span className="text-textPrimary font-bold">{viewCounts.queued}</span> tệp
                </div>
                <div className="text-[10px] text-accent font-medium">
                  {queueStatus === "running"
                    ? "● Đang chạy tuần tự"
                    : queueStatus === "pausing"
                    ? "⏳ Đang chờ tạm dừng..."
                    : queueStatus === "paused"
                    ? "❚❚ Đã tạm dừng"
                    : queueStatus === "blocked"
                    ? "⚠️ Bị chặn ổ đĩa"
                    : "○ Sẵn sàng"}
                </div>
              </>
            ) : (
              <>
                <div className="text-[11px] text-textMuted font-medium">
                  Tổng dự án: <span className="text-textPrimary font-bold">{totalJobCount}</span> tệp
                </div>
                <div className="text-[10px] text-textMuted">
                  {viewCounts.completed} hoàn tất • {viewCounts.failed} lỗi
                </div>
              </>
            )}
          </div>
        )}

        {/* Primary Action Button per view */}
        {activeView === "list" ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onStageToQueue}
              disabled={selectedJobCount === 0}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all whitespace-nowrap ${
                selectedJobCount === 0
                  ? "bg-surface3 text-textMuted cursor-not-allowed border-borderDefault opacity-60"
                  : "bg-surface2 hover:bg-surface3 text-textPrimary border-borderDefault cursor-pointer active:scale-98"
              }`}
              title="Giải quyết phụ thuộc và chuyển các tệp đã chọn sang Hàng đợi"
            >
              <ListPlus className="w-3.5 h-3.5 text-accent" />
              <span>Chuyển sang hàng đợi ({selectedJobCount})</span>
            </button>
            <button
              type="button"
              onClick={onStartFromList || onStageToQueue}
              disabled={selectedJobCount === 0}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg shadow-sm transition-all whitespace-nowrap ${
                selectedJobCount === 0
                  ? "bg-surface3 text-textMuted cursor-not-allowed border border-borderDefault opacity-60"
                  : "bg-accent hover:bg-accentHover text-slate-950 shadow-accent/20 cursor-pointer active:scale-98"
              }`}
              title="Chuyển các tệp đã chọn vào hàng đợi và bắt đầu xử lý ngay"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Bắt đầu xử lý ({selectedJobCount})</span>
            </button>
          </div>
        ) : activeView === "queued" ? (
          <div className="flex items-center gap-2">
            {queueStatus === "running" ? (
              <button
                type="button"
                onClick={onPauseQueue}
                className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg shadow-sm transition-all whitespace-nowrap bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 cursor-pointer active:scale-98"
                title="Tạm dừng xử lý hàng đợi tại biên an toàn"
              >
                <Pause className="w-3.5 h-3.5" />
                <span>Tạm dừng</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onStartQueue}
                disabled={viewCounts.queued === 0}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg shadow-sm transition-all whitespace-nowrap ${
                  viewCounts.queued === 0
                    ? "bg-surface3 text-textMuted cursor-not-allowed border border-borderDefault opacity-60"
                    : "bg-accent hover:bg-accentHover text-slate-950 shadow-accent/20 cursor-pointer active:scale-98"
                }`}
                title="Bắt đầu chạy các tác vụ trong Hàng đợi"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>{queueStatus === "paused" ? "Tiếp tục xử lý" : "Bắt đầu xử lý"}</span>
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onViewChange("queued")}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-textPrimary bg-surface2 hover:bg-surface3 border border-borderDefault rounded-lg transition-colors cursor-pointer whitespace-nowrap"
          >
            <span>Về Hàng đợi</span>
          </button>
        )}
      </div>
    </div>
  );
};
