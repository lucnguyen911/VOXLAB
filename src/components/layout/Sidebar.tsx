import React from "react";
import {
  FileText,
  Mic,
  AudioWaveform,
  Captions,
  Languages,
  Layers,
  History,
  Settings,
  ChevronLeft,
  ChevronRight,
  MessagesSquare,
} from "lucide-react";
import { WorkspaceId } from "../../types/ui";
import { useI18n } from "../../i18n/context";
import { SIDEBAR_WIDTH } from "../../constants/layout";

interface SidebarProps {
  activeWorkspace: WorkspaceId;
  onSelectWorkspace: (id: WorkspaceId) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  activeModelName?: string;
  theme?: "dark" | "light";
  onToggleTheme?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeWorkspace,
  onSelectWorkspace,
  collapsed,
  onToggleCollapse,
  activeModelName: _activeModelName = "Omni Voice",
}) => {
  const { t } = useI18n();

  const primaryNav: { id: WorkspaceId; label: string; icon: React.ReactNode }[] = [
    {
      id: "tts",
      label: t.nav.tts,
      icon: <FileText className="w-4 h-4" />,
    },
    {
      id: "dialogue",
      label: t.nav.dialogue,
      icon: <MessagesSquare className="w-4 h-4" />,
    },
    {
      id: "clone",
      label: t.nav.clone,
      icon: <Mic className="w-4 h-4" />,
    },
    {
      id: "library",
      label: t.nav.library,
      icon: <AudioWaveform className="w-4 h-4" />,
    },
    {
      id: "transcription",
      label: t.nav.transcription,
      icon: <Captions className="w-4 h-4" />,
    },
    {
      id: "dubbing",
      label: t.nav.dubbing,
      icon: <Languages className="w-4 h-4" />,
    },
    {
      id: "batch",
      label: t.nav.batch,
      icon: <Layers className="w-4 h-4" />,
    },
  ];

  const utilityNav: { id: WorkspaceId; label: string; icon: React.ReactNode }[] = [
    {
      id: "history",
      label: t.nav.history,
      icon: <History className="w-4 h-4" />,
    },
    {
      id: "settings",
      label: t.nav.settings,
      icon: <Settings className="w-4 h-4" />,
    },
  ];

  const renderNavItem = (item: { id: WorkspaceId; label: string; icon: React.ReactNode }) => {
    const active = activeWorkspace === item.id;
    return (
      <button
        key={item.id}
        type="button"
        data-nav-item="true"
        onClick={() => onSelectWorkspace(item.id)}
        title={collapsed ? item.label : undefined}
        className={`group relative w-full flex items-center ${
          collapsed ? "justify-center px-1.5 py-1.5" : "gap-2.5 px-2 py-1.5"
        } rounded-xl text-left transition-all duration-150 cursor-pointer ${
          active
            ? "bg-surface1 text-textPrimary font-semibold ring-1 ring-[#D2BFA4] dark:ring-amber-500/35 shadow-[inset_0_1px_0_#fff,0_2px_6px_-1px_rgba(36,24,12,0.08)] dark:shadow-[inset_0_1px_0_rgba(255,244,224,0.09),0_4px_10px_-2px_rgba(0,0,0,0.45)]"
            : "text-textSecondary hover:bg-surface1/70 dark:hover:bg-surface2/50 hover:text-textPrimary"
        }`}
      >
        {active && !collapsed && (
          <span
            aria-hidden="true"
            className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-gradient-to-b from-amber-400 to-orange-600 shadow-[0_0_8px_rgba(245,158,11,0.55)]"
          />
        )}
        <div
          className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-150 ${
            active
              ? "bg-gradient-to-b from-amber-400 via-amber-500 to-amber-600 text-white shadow-xs shadow-amber-600/30 ring-1 ring-inset ring-white/35"
              : "text-textMuted group-hover:text-textPrimary group-hover:bg-surface2/80"
          }`}
        >
          {item.icon}
        </div>
        {!collapsed && (
          <span className={`text-[13px] truncate ${active ? "font-semibold" : "font-medium"}`}>
            {item.label}
          </span>
        )}
      </button>
    );
  };

  return (
    <aside
      className={`${
        collapsed ? SIDEBAR_WIDTH.collapsed : SIDEBAR_WIDTH.expanded
      } bg-panel border-r border-borderDefault flex flex-col justify-between transition-all duration-200 select-none flex-shrink-0 z-20`}
    >
      <div className="p-2.5 space-y-1 overflow-y-auto">
        {/* Primary Navigation */}
        <nav className="space-y-1">
          {primaryNav.map(renderNavItem)}
        </nav>

        {/* Divider */}
        <div className="h-[1px] bg-gradient-to-r from-transparent via-borderDefault/80 to-transparent my-2.5 mx-1" />

        {/* Utility Navigation */}
        <nav className="space-y-1">
          {utilityNav.map(renderNavItem)}
        </nav>
      </div>

      {/* Flexible Spacer */}
      <div className="flex-1" />

      {/* Tactile Studio Collapse Control */}
      <div className={`p-2.5 mt-auto flex ${collapsed ? "justify-center" : "justify-end"} flex-shrink-0`}>
        <button
          type="button"
          onClick={onToggleCollapse}
          className="w-7 h-7 flex items-center justify-center text-textSecondary hover:text-textPrimary bg-surface2 border border-borderDefault rounded-lg cursor-pointer"
          title={collapsed ? (t.nav.expandSidebar || "Mở rộng thanh bên") : (t.nav.collapseSidebar || "Thu gọn thanh bên")}
          aria-label={collapsed ? (t.nav.expandSidebar || "Mở rộng thanh bên") : (t.nav.collapseSidebar || "Thu gọn thanh bên")}
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronLeft className="w-4 h-4" />
          )}
        </button>
      </div>
    </aside>
  );
};
