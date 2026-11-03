import React from "react";
import { Ban, Settings } from "lucide-react";
import { BatchJob, BatchTaskType } from "../../types/batch";

export interface TaskMatrixCellProps {
  job: BatchJob;
  task: BatchTaskType;
  isCompatible: boolean;
  incompatibilityReason?: string;
  isSelected: boolean;
  disabled?: boolean;
  onToggle: () => void;
  onConfigureTask?: () => void;
  hasTaskCustomConfig?: boolean;
}

/**
 * Task Matrix Cell Component (AC-02, AC-04, AC-06)
 * Renders either:
 * - Active checkbox when task is compatible with file kind
 * - Blocked icon (Ban) with explanatory tooltip when incompatible
 */
export const TaskMatrixCell: React.FC<TaskMatrixCellProps> = ({
  job: _job,
  task: _task,
  isCompatible,
  incompatibilityReason,
  isSelected,
  disabled = false,
  onToggle,
  onConfigureTask,
  hasTaskCustomConfig = false,
}) => {
  if (!isCompatible) {
    return (
      <div
        className="flex items-center justify-center min-h-[36px] text-textMuted/40 cursor-not-allowed"
        title={incompatibilityReason || "Tác vụ không tương thích với định dạng tệp này."}
      >
        <Ban className="w-4 h-4 opacity-40 hover:opacity-70 transition-opacity" />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center gap-1.5 min-h-[36px]">
      <input
        type="checkbox"
        checked={isSelected}
        disabled={disabled}
        onChange={onToggle}
        className="w-4 h-4 rounded border-borderDefault text-accent accent-accent focus:ring-0 focus:outline-none focus-visible:outline-none outline-none ring-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
      />
      {onConfigureTask && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onConfigureTask();
          }}
          className={`p-1 rounded-md transition-colors cursor-pointer ${
            hasTaskCustomConfig
              ? "text-accent bg-accent/15 hover:bg-accent/25 border border-accent/30"
              : "text-textMuted hover:text-accent hover:bg-surface2"
          }`}
          title="Chọn giọng cho từng nhân vật trong đoạn hội thoại"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};
