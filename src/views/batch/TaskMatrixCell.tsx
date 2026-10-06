import React from "react";
import { Ban } from "lucide-react";
import { BatchJob, BatchTaskType } from "../../types/batch";

export interface TaskMatrixCellProps {
  job: BatchJob;
  task: BatchTaskType;
  isCompatible: boolean;
  incompatibilityReason?: string;
  isSelected: boolean;
  disabled?: boolean;
  onToggle: () => void;
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
    <div className="flex items-center justify-center min-h-[36px]">
      <input
        type="checkbox"
        checked={isSelected}
        disabled={disabled}
        onChange={onToggle}
        className="w-4 h-4 rounded border-borderDefault text-accent accent-accent focus:ring-0 focus:outline-none focus-visible:outline-none outline-none ring-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
      />
    </div>
  );
};
