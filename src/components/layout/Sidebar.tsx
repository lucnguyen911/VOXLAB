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

  return (
    <aside
      className={`${
        collapsed ? SIDEBAR_WIDTH.collapsed : SIDEBAR_WIDTH.expanded
      } bg-panel border-r border-borderDefault flex flex-col justify-between transition-all duration-200 select-none flex-shrink-0 z-20`}
    >
      <div className="p-2 space-y-1 overflow-y-auto">
        {/* Primary Navigation */}
        <nav className="space-y-1">
          {primaryNav.map((item) => {
            const active = activeWorkspace === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectWorkspace(item.id)}
                title={collapsed ? item.label : undefined}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all ${
                  active
                    ? "bg-surface2 text-textPrimary font-semibold shadow-2xs border-l-2 border-l-accent"
                    : "text-textSecondary hover:bg-surface2/60 hover:text-textPrimary border-l-2 border-l-transparent"
                }`}
              >
                <div className={`${active ? "text-accent" : "text-textMuted"} flex-shrink-0`}>
                  {item.icon}
                </div>
                {!collapsed && (
                  <span className="text-[13px] truncate font-medium">{item.label}</span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Divider */}
        <div className="h-[1px] bg-borderDefault/60 my-2 mx-1" />

        {/* Utility Navigation */}
        <nav className="space-y-1">
          {utilityNav.map((item) => {
            const active = activeWorkspace === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectWorkspace(item.id)}
                title={collapsed ? item.label : undefined}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all ${
                  active
                    ? "bg-surface2 text-textPrimary font-semibold shadow-2xs border-l-2 border-l-accent"
                    : "text-textSecondary hover:bg-surface2/60 hover:text-textPrimary border-l-2 border-l-transparent"
                }`}
              >
                <div className={`${active ? "text-accent" : "text-textMuted"} flex-shrink-0`}>
                  {item.icon}
                </div>
                {!collapsed && <span className="text-[13px] truncate font-medium">{item.label}</span>}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Flexible Spacer */}
      <div className="flex-1" />

      {/* Icon-only Collapse Control (Ghost style, no separate footer row, anchored near bottom) */}
      <div className={`p-2 mt-auto flex ${collapsed ? "justify-center" : "justify-end"} flex-shrink-0`}>
        <button
          type="button"
          onClick={onToggleCollapse}
          className="w-7 h-7 flex items-center justify-center text-textMuted hover:text-textPrimary hover:bg-surface2 rounded-md transition-colors shadow-none outline-none focus-visible:ring-1 focus-visible:ring-accent"
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
