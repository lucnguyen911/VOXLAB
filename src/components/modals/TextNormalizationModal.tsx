import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  X,
  RotateCcw,
} from "lucide-react";
import { useI18n } from "../../i18n/context";
import {
  ALL_NORMALIZER_GROUPS,
  normalizeText,
  getDefaultEnabledGroupIds,
  loadSavedGroupIds,
  saveGroupIds,
  NormalizerGroupId,
} from "../../services/normalizer";
import { getActiveRulesCount } from "../../services/pronunciation";

interface TextNormalizationModalProps {
  isOpen: boolean;
  onClose: () => void;
  originalText: string;
  onApply: (normalizedText: string, changeCount: number) => void;
  language?: string;
  onOpenPronunciationManager?: () => void;
}

export const TextNormalizationModal: React.FC<TextNormalizationModalProps> = ({
  isOpen,
  onClose,
  originalText,
  onApply,
  onOpenPronunciationManager,
}) => {
  const { t } = useI18n();

  // 4 user-facing rule groups state (all default ON)
  const [enabledGroupIds, setEnabledGroupIds] = useState<NormalizerGroupId[]>(() =>
    loadSavedGroupIds()
  );

  // Immutable snapshot of original text captured strictly upon modal opening (Invariant 1)
  const [snapshotText, setSnapshotText] = useState<string>(originalText);

  // Synchronized scrolling refs
  const beforeScrollRef = useRef<HTMLDivElement>(null);
  const afterScrollRef = useRef<HTMLDivElement>(null);
  const isSyncingScrollRef = useRef<boolean>(false);

  // Capture original snapshot and reload saved rules strictly when modal opens
  useEffect(() => {
    if (isOpen) {
      setSnapshotText(originalText);
      setEnabledGroupIds(loadSavedGroupIds());
    }
  }, [isOpen]);

  // Compute live normalization result strictly from snapshotText (never cascades or mutates original)
  const result = useMemo(() => {
    return normalizeText(snapshotText, enabledGroupIds);
  }, [snapshotText, enabledGroupIds]);

  // Handle keyboard shortcut: Escape to close, Ctrl+Enter to apply
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        if (result.hasChanges && snapshotText.trim().length > 0) {
          handleApply();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, result, snapshotText]);

  // Toggle single rule group
  const handleToggleGroup = (groupId: NormalizerGroupId) => {
    setEnabledGroupIds((prev) => {
      const next = prev.includes(groupId)
        ? prev.filter((id) => id !== groupId)
        : [...prev, groupId];
      saveGroupIds(next);
      return next;
    });
  };

  // Reset to safe default rules (all 4 ON)
  const handleRestoreDefault = () => {
    const def = getDefaultEnabledGroupIds();
    setEnabledGroupIds(def);
    saveGroupIds(def);
  };

  // Apply action
  const handleApply = () => {
    if (!result.hasChanges || !snapshotText.trim()) return;
    onApply(result.normalizedText, result.totalChanges);
    onClose();
  };

  // Synchronized scroll handlers
  const handleScrollBefore = useCallback(() => {
    if (isSyncingScrollRef.current) return;
    if (!beforeScrollRef.current || !afterScrollRef.current) return;

    isSyncingScrollRef.current = true;
    const beforeEl = beforeScrollRef.current;
    const afterEl = afterScrollRef.current;
    const maxBefore = beforeEl.scrollHeight - beforeEl.clientHeight;

    if (maxBefore > 0) {
      const ratio = beforeEl.scrollTop / maxBefore;
      afterEl.scrollTop = ratio * (afterEl.scrollHeight - afterEl.clientHeight);
    }
    requestAnimationFrame(() => {
      isSyncingScrollRef.current = false;
    });
  }, []);

  const handleScrollAfter = useCallback(() => {
    if (isSyncingScrollRef.current) return;
    if (!beforeScrollRef.current || !afterScrollRef.current) return;

    isSyncingScrollRef.current = true;
    const beforeEl = beforeScrollRef.current;
    const afterEl = afterScrollRef.current;
    const maxAfter = afterEl.scrollHeight - afterEl.clientHeight;

    if (maxAfter > 0) {
      const ratio = afterEl.scrollTop / maxAfter;
      beforeEl.scrollTop = ratio * (beforeEl.scrollHeight - beforeEl.clientHeight);
    }
    requestAnimationFrame(() => {
      isSyncingScrollRef.current = false;
    });
  }, []);

  if (!isOpen) return null;

  const isEmpty = !snapshotText.trim();
  const delta = result.normalizedChars - result.originalChars;
  const deltaStr = delta > 0 ? `+${delta}` : `${delta}`;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 animate-in fade-in duration-150">
      <div className="bg-surface1 border border-borderDefault rounded-xl w-full max-w-[96vw] xl:max-w-[1440px] h-[92vh] max-h-[92vh] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
        {/* ================================================================= */}
        {/* MODAL TOP HEADER: "Cài đặt" (Trái) + "Ký tự: X -> Y (Z)" (Giữa)    */}
        {/* ================================================================= */}
        <div className="h-11 px-4 border-b border-borderDefault bg-surface1 flex items-center justify-between gap-4 flex-shrink-0">
          {/* Left Title: Cài đặt */}
          <div className="w-64 sm:w-72 lg:w-80 flex-shrink-0 flex items-center">
            <span className="font-bold text-sm text-textPrimary">Cài đặt</span>
          </div>

          {/* Center Metric: Ký tự: 19765 -> 19693 (-72) */}
          <div className="flex-1 flex items-center justify-center min-w-0">
            {!isEmpty && (
              <div className="flex items-center gap-1.5 text-xs sm:text-[13px] select-none">
                <span className="text-textSecondary font-medium">Ký tự:</span>
                <span className="font-semibold text-textPrimary font-mono">
                  {result.originalChars}
                </span>
                <span className="text-textMuted font-mono">{'->'}</span>
                <span className="font-semibold text-textPrimary font-mono">
                  {result.normalizedChars}
                </span>
                <span
                  className={`font-semibold font-mono ${
                    delta < 0
                      ? "text-pink-600 dark:text-pink-400"
                      : delta > 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-textMuted"
                  }`}
                >
                  ({deltaStr})
                </span>
              </div>
            )}
          </div>

          {/* Right Action: Close Button */}
          <div className="flex items-center justify-end flex-shrink-0">
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-md hover:bg-surface2 text-textMuted hover:text-textPrimary flex items-center justify-center transition-colors border border-transparent hover:border-borderDefault outline-none focus-visible:ring-2 focus-visible:ring-accent"
              title={t.normalizerModal.cancel}
              aria-label={t.normalizerModal.cancel}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ================================================================= */}
        {/* MAIN BODY: CATEGORIZED SIDEBAR (LEFT) + 2 PREVIEW COLUMNS (RIGHT) */}
        {/* ================================================================= */}
        <div className="flex-1 flex overflow-hidden min-h-0">
          {/* --------------------------------------------------------------- */}
          {/* REGION A: LEFT SIDEBAR (COLLAPSIBLE CATEGORIES & RULES)         */}
          {/* --------------------------------------------------------------- */}
          <div className="w-64 sm:w-72 lg:w-80 flex-shrink-0 border-r border-borderDefault flex flex-col bg-surface1 overflow-hidden">
            <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2 text-xs">
              {ALL_NORMALIZER_GROUPS.map((group) => {
                const isChecked = enabledGroupIds.includes(group.id);
                const isPronunciation = group.id === "pronunciation";
                const activeCount = isPronunciation ? getActiveRulesCount() : 0;

                return (
                  <div
                    key={group.id}
                    onClick={() => handleToggleGroup(group.id)}
                    className="flex items-start gap-3 p-3 rounded-lg cursor-pointer select-none transition-colors hover:bg-surface2/60 group border border-transparent hover:border-borderDefault/50"
                  >
                    {/* Circular Toggle Indicator */}
                    <div className="mt-0.5 flex-shrink-0">
                      <div
                        className={`w-4 h-4 rounded-full flex items-center justify-center transition-all ${
                          isChecked
                            ? "bg-indigo-600 text-white shadow-xs"
                            : "border-2 border-borderDefault bg-transparent group-hover:border-textMuted"
                        }`}
                      >
                        {isChecked && (
                          <div className="w-1.5 h-1.5 rounded-full bg-white" />
                        )}
                      </div>
                    </div>

                    {/* Rule Content: Short Title + Short Description + Short Example */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1.5">
                        <span
                          className={`text-xs sm:text-[13px] font-semibold leading-tight ${
                            isChecked ? "text-textPrimary" : "text-textSecondary"
                          }`}
                        >
                          {group.name}
                        </span>
                        {isPronunciation && onOpenPronunciationManager && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenPronunciationManager();
                            }}
                            className="text-[11px] font-medium text-accent hover:underline hover:text-accentHover px-1.5 py-0.5 rounded bg-accent/10 transition-colors"
                          >
                            Quản lý
                          </button>
                        )}
                      </div>

                      <div className="text-[11.5px] text-textMuted leading-snug mt-0.5">
                        {group.description}
                      </div>

                      {isPronunciation && (
                        <div className="mt-1 text-[11px] font-medium text-textSecondary flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                          <span>{activeCount} quy tắc đang hoạt động</span>
                        </div>
                      )}

                      {/* Short Example */}
                      {group.example && !isPronunciation && (
                        <div className="mt-1.5 text-[11px] font-mono text-textMuted flex items-center gap-1.5 flex-wrap">
                          <span className="text-textSecondary/70 font-sans text-[10px] font-semibold tracking-wide">
                            Ví dụ:
                          </span>
                          <span className="text-textSecondary dark:text-textMuted bg-surface2/60 px-1.5 py-0.5 rounded border border-borderDefault/50 whitespace-pre text-[10.5px]">
                            {group.example}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* --------------------------------------------------------------- */}
          {/* REGION B: RIGHT PREVIEW (TRƯỚC & SAU TINTED COLUMNS)            */}
          {/* --------------------------------------------------------------- */}
          <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0 bg-surface1">
            <div className="flex-1 grid grid-cols-2 divide-x divide-borderDefault h-full overflow-hidden min-w-0">
              {/* COLUMN 1: TRƯỚC (Sky blue tinted header) */}
              <div className="flex flex-col overflow-hidden h-full min-w-0">
                {/* Header: Trước (19765) */}
                <div className="px-4 py-1.5 border-b border-borderDefault bg-sky-50 dark:bg-sky-950/40 text-sky-900 dark:text-sky-200 flex items-center justify-between flex-shrink-0 text-xs font-semibold">
                  <span>
                    Trước ({result.originalChars})
                  </span>
                </div>

                {/* Readonly Original Text Body with Soft Pink Highlights */}
                <div
                  ref={beforeScrollRef}
                  onScroll={handleScrollBefore}
                  className="flex-1 p-4 overflow-y-auto font-sans text-[13px] sm:text-[14px] leading-[1.75] whitespace-pre-wrap select-text text-textPrimary selection:bg-accent/20"
                >
                  {isEmpty ? (
                    <div className="h-full flex items-center justify-center text-textMuted text-xs italic">
                      Chưa có văn bản để chuẩn hóa.
                    </div>
                  ) : (
                    result.diffBefore.map((tok, idx) => {
                      const isChanged =
                        tok.type === "pure_deleted" ||
                        tok.type === "removed" ||
                        tok.type === "replaced_old";
                      if (isChanged) {
                        const isWhitespace = /^\s+$/.test(tok.text);
                        return (
                          <span
                            key={idx}
                            className={
                              isWhitespace
                                ? "inline-block min-w-[7px] bg-pink-300/80 dark:bg-pink-700/80 border-b-2 border-pink-500 rounded-xs text-pink-950 dark:text-pink-100 font-semibold px-0.5 transition-colors"
                                : "bg-pink-200/90 dark:bg-pink-900/70 text-pink-950 dark:text-pink-100 border-b-2 border-pink-500 dark:border-pink-400 font-semibold px-0.5 rounded-xs transition-colors"
                            }
                            title={
                              isWhitespace
                                ? "Khoảng trắng bị thay đổi"
                                : "Nội dung trước thay đổi"
                            }
                          >
                            {tok.text}
                          </span>
                        );
                      }
                      return <span key={idx}>{tok.text}</span>;
                    })
                  )}
                </div>
              </div>

              {/* COLUMN 2: SAU (Emerald green tinted header) */}
              <div className="flex flex-col overflow-hidden h-full min-w-0">
                {/* Header: Sau (19693) */}
                <div className="px-4 py-1.5 border-b border-borderDefault bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 flex items-center justify-between flex-shrink-0 text-xs font-semibold">
                  <span>
                    Sau ({result.normalizedChars})
                  </span>
                </div>

                {/* Readonly Optimized Body with Soft Light Green Highlights for Added/Inserted Tokens */}
                <div
                  ref={afterScrollRef}
                  onScroll={handleScrollAfter}
                  className="flex-1 p-4 overflow-y-auto font-sans text-[13px] sm:text-[14px] leading-[1.75] whitespace-pre-wrap select-text text-textPrimary selection:bg-accent/20"
                >
                  {isEmpty ? (
                    <div className="h-full flex items-center justify-center text-textMuted text-xs italic">
                      Chưa có văn bản để chuẩn hóa.
                    </div>
                  ) : (
                    result.diffAfter.map((tok, idx) => {
                      const isChanged =
                        tok.type === "pure_added" ||
                        tok.type === "added" ||
                        tok.type === "replaced_new" ||
                        tok.type === "modified";
                      if (isChanged) {
                        const isWhitespace = /^\s+$/.test(tok.text);
                        return (
                          <span
                            key={idx}
                            className={
                              isWhitespace
                                ? "inline-block min-w-[7px] bg-emerald-200/90 dark:bg-emerald-800/80 border-b-2 border-emerald-500 dark:border-emerald-400 rounded-xs text-emerald-950 dark:text-emerald-100 font-semibold px-0.5 transition-colors"
                                : "bg-emerald-100 dark:bg-emerald-900/60 text-emerald-950 dark:text-emerald-100 border-b-2 border-emerald-500 dark:border-emerald-400 font-semibold px-0.5 rounded-xs transition-colors"
                            }
                            title={
                              isWhitespace
                                ? "Khoảng trắng chèn thêm"
                                : tok.oldText
                                ? `Thay thế từ: "${tok.oldText}"`
                                : "Ký tự chèn thêm"
                            }
                          >
                            {tok.text}
                          </span>
                        );
                      }
                      return <span key={idx}>{tok.text}</span>;
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ================================================================= */}
        {/* FOOTER: "Khôi phục mặc định" (Trái) + "Hủy" / "Áp dụng" (Phải)    */}
        {/* ================================================================= */}
        <div className="px-5 py-2.5 border-t border-borderDefault bg-surface1 flex items-center justify-between gap-4 flex-shrink-0 text-xs">
          {/* Left Action: Khôi phục mặc định */}
          <button
            type="button"
            onClick={handleRestoreDefault}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-textSecondary hover:text-textPrimary hover:bg-surface2 rounded-lg border border-borderDefault transition-colors"
            title="Khôi phục các tùy chọn an toàn mặc định"
          >
            <RotateCcw className="w-3.5 h-3.5 text-textMuted" />
            <span>Khôi phục mặc định</span>
          </button>

          {/* Right Actions: Hủy & Áp dụng */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg border border-borderDefault text-textSecondary hover:text-textPrimary hover:bg-surface2 transition-colors font-medium text-xs"
            >
              {t.normalizerModal.cancel}
            </button>

            <button
              type="button"
              onClick={handleApply}
              disabled={!result.hasChanges || isEmpty}
              className={`px-4 py-1.5 rounded-lg font-semibold text-xs shadow-xs transition-all flex items-center gap-1.5 ${
                result.hasChanges && !isEmpty
                  ? "bg-accent hover:bg-accentHover text-white cursor-pointer"
                  : "bg-surface3 text-textMuted cursor-not-allowed opacity-60 border border-borderDefault/60"
              }`}
            >
              {isEmpty ? (
                <span>Chưa có văn bản</span>
              ) : result.hasChanges ? (
                <span>
                  {t.normalizerModal.applyChanges.replace(
                    "{count}",
                    String(result.totalChanges)
                  )}
                </span>
              ) : (
                <span>{t.normalizerModal.applyNoChanges}</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
