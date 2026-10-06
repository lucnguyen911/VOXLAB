import React from "react";
import { Volume2, Minus, Square, X, ChevronDown, Sun, Moon } from "lucide-react";
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
}

export const TopBar: React.FC<TopBarProps> = ({
  theme = "dark",
  onToggleTheme,
}) => {
  const { lang, setLang, t, languages } = useI18n();
  const currentLangOption = languages.find((l) => l.code === lang) || languages[0];

  return (
    <header className="h-[42px] bg-panel border-b border-borderDefault flex items-center justify-between px-3.5 select-none z-30 flex-shrink-0">
      {/* Brand */}
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-md bg-accent/10 border border-accent/30 flex items-center justify-center text-accent">
          <Volume2 className="w-3.5 h-3.5" />
        </div>
        <span className="font-bold tracking-tight text-textPrimary text-sm font-mono">
          VOXLAB
        </span>
      </div>

      {/* Draggable Titlebar Area (Window drag region) */}
      <div data-tauri-drag-region className="flex-1 h-full cursor-default" />

      {/* Right Controls: Language Selector + Theme Toggle + Window Controls */}
      <div className="flex items-center gap-2">
        {/* Language dropdown button */}
        <div
          className="relative flex items-center gap-1.5 px-2.5 h-[30px] rounded-md bg-surface2/60 hover:bg-surface2 border border-borderDefault hover:border-textMuted/40 transition-colors cursor-pointer text-xs font-medium text-textPrimary group shadow-2xs"
          title={t.topbar.langTitle}
        >
          <span className="text-xs font-medium truncate">
            {currentLangOption.label}
          </span>
          <ChevronDown className="w-3.5 h-3.5 text-textMuted group-hover:text-textPrimary transition-colors pointer-events-none" />

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
          className="w-[30px] h-[30px] rounded-md bg-surface2/60 hover:bg-surface2 border border-borderDefault hover:border-textMuted/40 text-textSecondary hover:text-textPrimary transition-colors flex items-center justify-center shadow-2xs"
          title={t.topbar.themeTitle}
          aria-label={t.topbar.themeTitle}
        >
          {theme === "light" ? (
            <Sun className="w-4 h-4 text-amber-500" />
          ) : (
            <Moon className="w-4 h-4 text-accent" />
          )}
        </button>

        {/* Divider before Window Controls */}
        <div className="h-4 w-[1px] bg-borderDefault mx-1" />

        {/* Window Controls */}
        <div className="flex items-center gap-1">
          <button
            className="p-1.5 text-textMuted hover:text-textPrimary hover:bg-surface2 rounded transition-colors"
            title="Thu nhỏ"
            aria-label="Thu nhỏ"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            className="p-1.5 text-textMuted hover:text-textPrimary hover:bg-surface2 rounded transition-colors"
            title="Phóng to"
            aria-label="Phóng to"
          >
            <Square className="w-3 h-3" />
          </button>
          <button
            className="p-1.5 text-textMuted hover:text-danger hover:bg-danger/10 rounded transition-colors"
            title="Đóng"
            aria-label="Đóng"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
};
