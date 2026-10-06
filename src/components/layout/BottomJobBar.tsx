import React from "react";
import {
  Pause,
  Play,
  X,
  FolderOpen,
  CheckCircle,
  AlertCircle,
  RotateCcw,
} from "lucide-react";
import { useI18n } from "../../i18n/context";
import { BOTTOM_BAR_HEIGHT } from "../../constants/layout";

export interface BottomJobBarProps {
  theme?: "dark" | "light";
  onToggleTheme?: () => void;
  sidebarCollapsed?: boolean;
  isGenerating: boolean;
  isPaused: boolean;
  onTogglePause: () => void;
  onCancel: () => void;
  onOpenOutput?: () => void;
  onRetry?: () => void;
  currentChunkIndex?: number;
  totalChunks?: number;
  activeModel?: string;
  hasOutput?: boolean;
  hasError?: boolean;
  statusOverride?: "running" | "paused" | "completed" | "error" | "idle";
}

export const BottomJobBar: React.FC<BottomJobBarProps> = ({
  isGenerating,
  isPaused,
  onTogglePause,
  onCancel,
  onOpenOutput,
  onRetry,
  currentChunkIndex = 5,
  totalChunks = 7,
  activeModel: _activeModel = "Omni Voice",
  hasOutput = true,
  hasError = false,
  statusOverride,
}) => {
  const { t } = useI18n();

  // Derive contextual generation status
  const status: "running" | "paused" | "completed" | "error" | "idle" =
    statusOverride ||
    (isGenerating
      ? isPaused
        ? "paused"
        : "running"
      : hasError
      ? "error"
      : totalChunks > 0 && currentChunkIndex >= totalChunks
      ? "completed"
      : "idle");

  const percent =
    totalChunks > 0
      ? Math.min(100, Math.round((currentChunkIndex / totalChunks) * 100))
      : 0;

  return (
    <footer className={`${BOTTOM_BAR_HEIGHT} w-full bg-panel border-t border-borderDefault flex items-center text-xs select-none flex-shrink-0 z-30 whitespace-nowrap overflow-hidden px-4`}>
      {/* Contextual Generation Status & Contextual Actions */}
      <div className="flex-1 h-full flex items-center justify-between min-w-0 overflow-hidden">
        {/* CENTER ZONE */}
        <div className="flex-1 flex items-center justify-center px-2 min-w-0 overflow-hidden">
        {status === "running" && (
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {/* Contextual Status & Chunk count */}
            <span className="text-xs font-medium text-textSecondary whitespace-nowrap flex-shrink-0">
              {t.jobbar.generatingShort || "Đang tạo"}{" "}
              <span className="font-semibold text-textPrimary font-mono">
                {currentChunkIndex}/{totalChunks}
              </span>
            </span>

            {/* Responsive Wide Progress Bar: clamp(120px, 16vw, 260px) */}
            <div className="w-[clamp(120px,16vw,260px)] h-1.5 bg-surface3 rounded-full overflow-hidden flex-shrink-0">
              <div
                className="h-full bg-accent transition-all duration-300 rounded-full"
                style={{ width: `${percent}%` }}
              />
            </div>

            {/* Percentage */}
            <span className="text-xs font-mono text-textPrimary font-semibold flex-shrink-0">
              {percent}%
            </span>

            {/* ETA - priority 1 degradation: hidden on screens < 1100px */}
            <span className="text-xs text-textMuted hidden lg:inline flex-shrink-0">
              · {t.jobbar.remainingShort.replace("{time}", "10s")}
            </span>
          </div>
        )}

        {status === "paused" && (
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {/* Contextual Paused Status */}
            <span className="text-xs font-medium text-warning whitespace-nowrap flex-shrink-0">
              {t.jobbar.pausedStatus || "Đã tạm dừng"} ·{" "}
              <span className="font-semibold font-mono">
                {currentChunkIndex}/{totalChunks}
              </span>
            </span>

            {/* Responsive Wide Static Progress Bar */}
            <div className="w-[clamp(120px,16vw,260px)] h-1.5 bg-surface3 rounded-full overflow-hidden flex-shrink-0">
              <div
                className="h-full bg-warning transition-all duration-300 rounded-full"
                style={{ width: `${percent}%` }}
              />
            </div>

            {/* Percentage */}
            <span className="text-xs font-mono text-warning font-semibold flex-shrink-0">
              {percent}%
            </span>
          </div>
        )}

        {status === "completed" && (
          <div className="flex items-center gap-1.5 text-success font-medium text-xs">
            <CheckCircle className="w-3.5 h-3.5 text-success flex-shrink-0" />
            <span>
              {t.jobbar.completedStatus || "Hoàn tất"} · {totalChunks}/{totalChunks}
            </span>
          </div>
        )}

        {status === "error" && (
          <div className="flex items-center gap-1.5 text-danger font-medium text-xs">
            <AlertCircle className="w-3.5 h-3.5 text-danger flex-shrink-0" />
            <span>
              {t.jobbar.errorStatus || "Lỗi"} · {currentChunkIndex}/{totalChunks}
            </span>
          </div>
        )}

        {status === "idle" && (
          /* Silent & clean in normal idle state */
          <div className="h-4" />
        )}
      </div>

      {/* Subtle Divider (Center / Right) */}
      <div className="h-3 w-[1px] bg-borderDefault/60 mx-2 flex-shrink-0 hidden sm:block" />

      {/* ==================================================================== */}
      {/* 3. RIGHT ZONE: Contextual Actions                                    */}
      {/* ==================================================================== */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {status === "running" && (
          <>
            <button
              type="button"
              onClick={onTogglePause}
              className="h-[26px] flex items-center gap-1.5 px-2.5 bg-surface2 hover:bg-surface3 text-textPrimary border border-borderDefault rounded-md transition-colors text-xs font-medium shadow-2xs"
              title={t.jobbar.pause}
              aria-label={t.jobbar.pause}
            >
              <Pause className="w-3 h-3 text-warning fill-warning" />
              <span className="hidden sm:inline">{t.jobbar.pause}</span>
            </button>

            <button
              type="button"
              onClick={onCancel}
              className="h-[26px] flex items-center gap-1 px-2 text-textMuted hover:text-danger hover:bg-danger/10 border border-transparent hover:border-danger/30 rounded-md transition-colors text-xs font-medium shadow-2xs"
              title={t.jobbar.cancel}
              aria-label={t.jobbar.cancel}
            >
              <X className="w-3 h-3" />
              <span className="hidden sm:inline">{t.jobbar.cancel}</span>
            </button>
          </>
        )}

        {status === "paused" && (
          <>
            <button
              type="button"
              onClick={onTogglePause}
              className="h-[26px] flex items-center gap-1.5 px-2.5 bg-accent/15 hover:bg-accent/25 text-accent border border-accent/40 rounded-md transition-colors text-xs font-medium shadow-2xs"
              title={t.jobbar.resume}
              aria-label={t.jobbar.resume}
            >
              <Play className="w-3 h-3 text-accent fill-accent" />
              <span className="hidden sm:inline">{t.jobbar.resume}</span>
            </button>

            <button
              type="button"
              onClick={onCancel}
              className="h-[26px] flex items-center gap-1 px-2 text-textMuted hover:text-danger hover:bg-danger/10 border border-transparent hover:border-danger/30 rounded-md transition-colors text-xs font-medium shadow-2xs"
              title={t.jobbar.cancel}
              aria-label={t.jobbar.cancel}
            >
              <X className="w-3 h-3" />
              <span className="hidden sm:inline">{t.jobbar.cancel}</span>
            </button>
          </>
        )}

        {status === "error" && (
          <>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="h-[26px] flex items-center gap-1.5 px-2.5 bg-surface2 hover:bg-surface3 text-textPrimary border border-borderDefault rounded-md transition-colors text-xs font-medium shadow-2xs"
                title={t.jobbar.retry}
                aria-label={t.jobbar.retry}
              >
                <RotateCcw className="w-3 h-3 text-accent" />
                <span className="hidden sm:inline">{t.jobbar.retry}</span>
              </button>
            )}

            {hasOutput && onOpenOutput && (
              <button
                type="button"
                onClick={onOpenOutput}
                className="h-[26px] flex items-center gap-1.5 px-2.5 bg-surface2 hover:bg-surface3 text-textPrimary border border-borderDefault rounded-md transition-colors text-xs font-medium shadow-2xs"
                title={t.jobbar.openFolder}
                aria-label={t.jobbar.openFolder}
              >
                <FolderOpen className="w-3 h-3 text-textMuted" />
                <span className="hidden sm:inline">{t.jobbar.openFolder}</span>
              </button>
            )}
          </>
        )}

        {(status === "completed" || status === "idle") && hasOutput && onOpenOutput && (
          <button
            type="button"
            onClick={onOpenOutput}
            className="h-[26px] flex items-center gap-1.5 px-2.5 bg-surface2 hover:bg-surface3 text-textPrimary border border-borderDefault rounded-md transition-colors text-xs font-medium shadow-2xs"
            title={t.jobbar.openFolder}
            aria-label={t.jobbar.openFolder}
          >
            <FolderOpen className="w-3 h-3 text-textMuted" />
            <span className="hidden sm:inline">{t.jobbar.openFolder}</span>
          </button>
        )}
      </div>
    </div>
  </footer>
);
};
