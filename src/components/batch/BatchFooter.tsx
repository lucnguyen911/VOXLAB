import React from "react";

export const BATCH_FOOTER_HEIGHT = 39; // AC-43 Invariant: h-[39px] on all 4 Batch views

export interface BatchFooterProps {
  totalCount: number;
  selectedCount?: number;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}

/**
 * Shared BatchFooter Status Bar Component (AC-43)
 * Guarantees identical height (39px), padding, alignment, and structure across all 4 Batch views:
 * - Tab Danh sách (List)
 * - Tab Hàng đợi (Queued)
 * - Tab Hoàn tất (Completed)
 * - Tab Lỗi (Failed)
 */
export const BatchFooter: React.FC<BatchFooterProps> = ({
  totalCount,
  selectedCount,
  actions,
  children,
}) => {
  return (
    <div
      style={{ height: `${BATCH_FOOTER_HEIGHT}px` }}
      className="h-[39px] px-4 bg-surface2/60 border-t border-borderDefault flex items-center justify-between text-xs text-textSecondary flex-shrink-0 select-none"
    >
      <div className="flex items-center gap-3">
        <span>
          Tổng: <strong className="text-textPrimary font-semibold">{totalCount}</strong> tệp
        </span>
        {selectedCount !== undefined && selectedCount > 0 && (
          <span className="text-accent font-medium">
            • Đã chọn: <strong>{selectedCount}</strong> tệp
          </span>
        )}
        {children}
      </div>

      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
};
