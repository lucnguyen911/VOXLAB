import React, { useEffect, useState } from "react";
import { ChevronDown, Sun, Moon } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useI18n } from "../../i18n/context";
import { SupportedLang } from "../../i18n/translations";

export interface TopBarProps {
  currentWorkspace?: string;
  onOpenSettings?: () => void;
  lang?: string;
  onToggleLang?: () => void;
  theme?: "dark" | "light";
  onToggleTheme?: () => void;
  isOnlineActive?: boolean;
  minimal?: boolean;
}

const isTauriRuntime = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const TopBar: React.FC<TopBarProps> = ({
  theme = "dark",
  onToggleTheme,
  minimal = false,
}) => {
  const { lang, setLang, t, languages } = useI18n();
  const currentLangOption = languages.find((l) => l.code === lang) || languages[0];
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const appWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    let disposed = false;

    appWindow
      .isMaximized()
      .then((val) => {
        if (!disposed) setIsMaximized(val);
      })
      .catch(() => {});

    appWindow
      .onResized(async () => {
        try {
          const val = await appWindow.isMaximized();
          if (!disposed) setIsMaximized(val);
        } catch {
          // ignore
        }
      })
      .then((fn) => {
        if (disposed) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(() => {});

    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, []);

  const handleMinimize = () => {
    if (!isTauriRuntime()) return;
    getCurrentWindow().minimize().catch(() => {});
  };

  const handleToggleMaximize = () => {
    if (!isTauriRuntime()) return;
    const appWindow = getCurrentWindow();
    appWindow
      .toggleMaximize()
      .then(() => appWindow.isMaximized())
      .then((val) => setIsMaximized(val))
      .catch(() => {});
  };

  const handleClose = () => {
    if (!isTauriRuntime()) return;
    getCurrentWindow().close().catch(() => {});
  };

  return (
    <header
      data-tauri-drag-region
      className="h-[46px] bg-gradient-to-b from-surface1/95 to-panel dark:from-[#1B1510] dark:to-panel border-b border-borderDefault shadow-[0_1px_2px_rgba(28,19,10,0.04)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.4)] flex items-center justify-between pl-4 pr-0 select-none z-30 flex-shrink-0"
    >
      {/* Brand */}
      <div data-tauri-drag-region className="flex items-center gap-2.5 h-full">
        <img
          src="/app-icon.png?v=2"
          alt="VoxLab"
          className="w-7 h-7 rounded-lg ring-1 ring-amber-500/35 dark:ring-amber-400/30 shadow-sm shadow-amber-600/20 object-cover select-none pointer-events-none"
        />
        <span
          className={`font-extrabold tracking-[0.09em] text-[15px] font-mono bg-clip-text text-transparent pointer-events-none ${
            theme === "light"
              ? "bg-gradient-to-r from-amber-950 via-amber-700 to-orange-600"
              : "bg-gradient-to-r from-amber-100 via-amber-300 to-orange-400"
          }`}
        >
          VOXLAB
        </span>
      </div>

      {/* Draggable Titlebar Area (Window drag region) */}
      <div data-tauri-drag-region className="flex-1 h-full cursor-default" />

      {/* Right Controls: Language Selector + Theme Toggle + Native-Style Studio Window Controls */}
      <div className="flex items-center h-full">
        {!minimal && (
          <div className="flex items-center gap-2 pr-2.5">
            {/* Language dropdown button (Tactile Satin Capsule) */}
            <div
              className="relative flex items-center gap-1.5 px-3 h-[31px] rounded-lg bg-gradient-to-b from-white via-[#FCF9F4] to-[#F1E9DD] dark:from-[#31271F] dark:via-[#251D17] dark:to-[#1D1712] border border-[#C9B79E] dark:border-[#4F3E30] hover:border-[#B69A76] dark:hover:border-[#6B533E] shadow-[inset_0_1px_0_#fff,0_1px_2px_rgba(28,19,10,0.08)] dark:shadow-[inset_0_1px_0_rgba(255,244,224,0.10),0_1px_2px_rgba(0,0,0,0.5)] transition-all cursor-pointer text-xs font-medium text-textPrimary group"
              title={t.topbar.langTitle}
            >
              <span className="text-xs font-medium truncate">
                {currentLangOption.label}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-textMuted group-hover:text-accent transition-colors pointer-events-none" />

              {/* Native select overlay */}
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value as SupportedLang)}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                title={t.topbar.langTitle}
                aria-label={t.topbar.langTitle}
              >
                {languages.map((l) => (
                  <option
                    key={l.code}
                    value={l.code}
                    className="bg-surface1 text-textPrimary"
                  >
                    {l.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Theme toggle button */}
            <button
              type="button"
              onClick={onToggleTheme}
              className="w-[31px] h-[31px] rounded-lg bg-surface2 border border-borderDefault text-textSecondary hover:text-textPrimary flex items-center justify-center cursor-pointer"
              title={t.topbar.themeTitle}
              aria-label={t.topbar.themeTitle}
            >
              {theme === "light" ? (
                <Sun className="w-4 h-4 text-amber-600" />
              ) : (
                <Moon className="w-4 h-4 text-accent" />
              )}
            </button>

            <div className="h-4 w-px bg-borderDefault/80 ml-0.5" />
          </div>
        )}

        {/* Windows 11 / Studio Caption Buttons (Minimize, Maximize/Restore, Close) */}
        <div className="flex items-stretch h-full">
          <button
            type="button"
            onClick={handleMinimize}
            className="w-[46px] h-full flex items-center justify-center text-textSecondary hover:bg-surface2 hover:text-textPrimary active:bg-surface3 transition-colors"
            title={lang === "vi" ? "Thu nhỏ" : "Minimize"}
            aria-label="Minimize"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M0 5h10" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>

          <button
            type="button"
            onClick={handleToggleMaximize}
            className="w-[46px] h-full flex items-center justify-center text-textSecondary hover:bg-surface2 hover:text-textPrimary active:bg-surface3 transition-colors"
            title={
              isMaximized
                ? lang === "vi"
                  ? "Khôi phục kích thước"
                  : "Restore"
                : lang === "vi"
                  ? "Phóng to"
                  : "Maximize"
            }
            aria-label={isMaximized ? "Restore" : "Maximize"}
          >
            {isMaximized ? (
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path
                  d="M2.5 2.5V1.3a.5.5 0 0 1 .5-.5h5.7a.5.5 0 0 1 .5.5V7a.5.5 0 0 1-.5.5H7.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.15"
                />
                <rect
                  x="0.75"
                  y="2.5"
                  width="6.75"
                  height="6.75"
                  rx="0.6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.15"
                />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <rect
                  x="0.75"
                  y="0.75"
                  width="8.5"
                  height="8.5"
                  rx="0.8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
              </svg>
            )}
          </button>

          <button
            type="button"
            onClick={handleClose}
            className="w-[46px] h-full flex items-center justify-center text-textSecondary hover:bg-[#E81123] hover:text-white active:bg-[#C50F1F] transition-colors"
            title={lang === "vi" ? "Đóng" : "Close"}
            aria-label="Close"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path
                d="M1 1l8 8M9 1L1 9"
                stroke="currentColor"
                strokeWidth="1.25"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
};
