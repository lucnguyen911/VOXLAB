import React, { useState, useEffect, useMemo } from "react";
import {
  X,
  Plus,
  Search,
  Edit2,
  Trash2,
  Globe,
  FolderKanban,
  Check,
  AlertCircle,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import {
  PronunciationRule,
  PronunciationScope,
  loadGlobalRules,
  saveGlobalRules,
  loadProjectRules,
  saveProjectRules,
} from "../../services/pronunciation";

interface PronunciationManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId?: string;
  onRulesUpdated?: () => void;
}

export const PronunciationManagerModal: React.FC<PronunciationManagerModalProps> = ({
  isOpen,
  onClose,
  projectId = "current",
  onRulesUpdated,
}) => {
  const [activeTab, setActiveTab] = useState<PronunciationScope>("global");
  const [globalRules, setGlobalRules] = useState<PronunciationRule[]>([]);
  const [projectRules, setProjectRules] = useState<PronunciationRule[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  // Add / Edit Form State
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [formSource, setFormSource] = useState("");
  const [formSpoken, setFormSpoken] = useState("");
  const [formCaseSensitive, setFormCaseSensitive] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Reload rules when modal opens
  useEffect(() => {
    if (isOpen) {
      setGlobalRules(loadGlobalRules());
      setProjectRules(loadProjectRules(projectId));
      setIsFormOpen(false);
      setEditingRuleId(null);
      setFormError(null);
    }
  }, [isOpen, projectId]);

  // Keyboard shortcut Esc to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const currentRules = activeTab === "global" ? globalRules : projectRules;

  const filteredRules = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return currentRules;
    return currentRules.filter(
      (r) =>
        r.sourceText.toLowerCase().includes(q) ||
        r.spokenText.toLowerCase().includes(q)
    );
  }, [currentRules, searchQuery]);

  const handleOpenAddForm = () => {
    setEditingRuleId(null);
    setFormSource("");
    setFormSpoken("");
    setFormCaseSensitive(false);
    setFormError(null);
    setIsFormOpen(true);
  };

  const handleOpenEditForm = (rule: PronunciationRule) => {
    setEditingRuleId(rule.id);
    setFormSource(rule.sourceText);
    setFormSpoken(rule.spokenText);
    setFormCaseSensitive(rule.caseSensitive);
    setFormError(null);
    setIsFormOpen(true);
  };

  const handleCancelForm = () => {
    setIsFormOpen(false);
    setEditingRuleId(null);
    setFormError(null);
  };

  const handleSaveForm = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanSource = formSource.trim();
    const cleanSpoken = formSpoken.trim();

    if (!cleanSource) {
      setFormError("Vui lòng nhập từ hoặc cụm từ gốc.");
      return;
    }
    if (!cleanSpoken) {
      setFormError("Vui lòng nhập cách đọc thay thế.");
      return;
    }

    const now = new Date().toISOString();

    if (editingRuleId) {
      // Update existing
      if (activeTab === "global") {
        const next = globalRules.map((r) =>
          r.id === editingRuleId
            ? {
                ...r,
                sourceText: cleanSource,
                spokenText: cleanSpoken,
                caseSensitive: formCaseSensitive,
                updatedAt: now,
              }
            : r
        );
        setGlobalRules(next);
        saveGlobalRules(next);
      } else {
        const next = projectRules.map((r) =>
          r.id === editingRuleId
            ? {
                ...r,
                sourceText: cleanSource,
                spokenText: cleanSpoken,
                caseSensitive: formCaseSensitive,
                updatedAt: now,
              }
            : r
        );
        setProjectRules(next);
        saveProjectRules(next, projectId);
      }
    } else {
      // Create new
      const newRule: PronunciationRule = {
        id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        sourceText: cleanSource,
        spokenText: cleanSpoken,
        enabled: true,
        caseSensitive: formCaseSensitive,
        scope: activeTab,
        createdAt: now,
        updatedAt: now,
      };

      if (activeTab === "global") {
        const next = [newRule, ...globalRules];
        setGlobalRules(next);
        saveGlobalRules(next);
      } else {
        const next = [newRule, ...projectRules];
        setProjectRules(next);
        saveProjectRules(next, projectId);
      }
    }

    setIsFormOpen(false);
    setEditingRuleId(null);
    setFormError(null);
    onRulesUpdated?.();
  };

  const handleToggleRule = (id: string) => {
    if (activeTab === "global") {
      const next = globalRules.map((r) =>
        r.id === id ? { ...r, enabled: !r.enabled, updatedAt: new Date().toISOString() } : r
      );
      setGlobalRules(next);
      saveGlobalRules(next);
    } else {
      const next = projectRules.map((r) =>
        r.id === id ? { ...r, enabled: !r.enabled, updatedAt: new Date().toISOString() } : r
      );
      setProjectRules(next);
      saveProjectRules(next, projectId);
    }
    onRulesUpdated?.();
  };

  const handleDeleteRule = (id: string) => {
    if (activeTab === "global") {
      const next = globalRules.filter((r) => r.id !== id);
      setGlobalRules(next);
      saveGlobalRules(next);
    } else {
      const next = projectRules.filter((r) => r.id !== id);
      setProjectRules(next);
      saveProjectRules(next, projectId);
    }
    onRulesUpdated?.();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150 select-none">
      <div className="bg-surface1 border border-borderDefault rounded-xl w-full max-w-2xl max-h-[85vh] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-borderDefault flex items-center justify-between bg-surface2/40 flex-shrink-0">
          <div>
            <h3 className="font-bold text-sm text-textPrimary">Quản lý phát âm</h3>
            <p className="text-xs text-textMuted mt-0.5">
              Tùy chỉnh cách đọc cho từ viết tắt, tên riêng hoặc ký hiệu
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-surface3 text-textMuted hover:text-textPrimary rounded-md transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab switcher: [ Chung ] [ Dự án hiện tại ] */}
        <div className="px-5 pt-3 pb-2 border-b border-borderDefault flex items-center justify-between bg-surface1 flex-shrink-0 gap-2">
          <div className="inline-flex bg-surface2 rounded-lg p-0.5 border border-borderDefault/60 text-xs">
            <button
              onClick={() => {
                setActiveTab("global");
                setIsFormOpen(false);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-all ${
                activeTab === "global"
                  ? "bg-surface1 text-textPrimary font-semibold shadow-2xs"
                  : "text-textSecondary hover:text-textPrimary"
              }`}
            >
              <Globe className="w-3.5 h-3.5 text-accent" />
              <span>Chung ({globalRules.length})</span>
            </button>
            <button
              onClick={() => {
                setActiveTab("project");
                setIsFormOpen(false);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-all ${
                activeTab === "project"
                  ? "bg-surface1 text-textPrimary font-semibold shadow-2xs"
                  : "text-textSecondary hover:text-textPrimary"
              }`}
            >
              <FolderKanban className="w-3.5 h-3.5 text-amber-500" />
              <span>Dự án hiện tại ({projectRules.length})</span>
            </button>
          </div>

          {!isFormOpen && (
            <button
              onClick={handleOpenAddForm}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accentHover text-white rounded-md text-xs font-medium transition-colors shadow-2xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Thêm quy tắc</span>
            </button>
          )}
        </div>

        {/* Search Bar */}
        {!isFormOpen && (
          <div className="px-5 py-2.5 bg-surface1 border-b border-borderDefault flex items-center gap-2 flex-shrink-0">
            <Search className="w-3.5 h-3.5 text-textMuted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm kiếm từ gốc hoặc cách đọc..."
              className="flex-1 bg-transparent text-xs text-textPrimary focus:outline-none placeholder:text-textMuted"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="text-textMuted hover:text-textPrimary text-xs"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Main Content: Form or List */}
        <div className="flex-1 overflow-y-auto p-5">
          {isFormOpen ? (
            /* Add / Edit Form */
            <form onSubmit={handleSaveForm} className="space-y-4 bg-surface2/40 p-4 rounded-xl border border-borderDefault">
              <div className="text-xs font-semibold text-textPrimary">
                {editingRuleId ? "Chỉnh sửa quy tắc phát âm" : "Thêm quy tắc phát âm mới"}
              </div>

              {formError && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-danger/10 border border-danger/30 text-danger text-xs">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="space-y-3 text-xs">
                <div>
                  <label className="block text-textSecondary font-medium mb-1">
                    Từ hoặc cụm từ gốc (Source Text):
                  </label>
                  <input
                    type="text"
                    value={formSource}
                    onChange={(e) => setFormSource(e.target.value)}
                    placeholder="Ví dụ: UBND, #5, AI"
                    className="w-full px-3 py-2 bg-surface1 border border-borderDefault rounded-lg text-textPrimary focus:outline-none focus:border-accent text-xs font-mono"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-textSecondary font-medium mb-1">
                    Cách đọc thay thế (Spoken Text):
                  </label>
                  <input
                    type="text"
                    value={formSpoken}
                    onChange={(e) => setFormSpoken(e.target.value)}
                    placeholder="Ví dụ: Ủy ban nhân dân, Number five, A I"
                    className="w-full px-3 py-2 bg-surface1 border border-borderDefault rounded-lg text-textPrimary focus:outline-none focus:border-accent text-xs"
                  />
                </div>

                <div className="flex items-center gap-2 pt-1 cursor-pointer" onClick={() => setFormCaseSensitive(!formCaseSensitive)}>
                  <input
                    type="checkbox"
                    checked={formCaseSensitive}
                    onChange={(e) => setFormCaseSensitive(e.target.checked)}
                    className="w-4 h-4 rounded text-accent focus:ring-accent border-borderDefault cursor-pointer"
                  />
                  <span className="text-textSecondary text-xs">
                    Phân biệt chữ hoa / chữ thường (Case Sensitive)
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-borderDefault">
                <button
                  type="button"
                  onClick={handleCancelForm}
                  className="px-3 py-1.5 rounded-lg bg-surface2 hover:bg-surface3 text-textSecondary text-xs font-medium transition-colors"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent hover:bg-accentHover text-white text-xs font-semibold shadow-xs transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{editingRuleId ? "Lưu thay đổi" : "Tạo quy tắc"}</span>
                </button>
              </div>
            </form>
          ) : (
            /* Rules List */
            <div className="space-y-2">
              {filteredRules.length === 0 ? (
                <div className="text-center py-10 text-textMuted text-xs space-y-2">
                  <p>
                    {searchQuery
                      ? "Không tìm thấy quy tắc nào khớp với từ khóa tìm kiếm."
                      : activeTab === "global"
                      ? "Chưa có quy tắc phát âm chung nào."
                      : "Chưa có quy tắc phát âm nào cho dự án hiện tại."}
                  </p>
                  <button
                    onClick={handleOpenAddForm}
                    className="inline-flex items-center gap-1 text-accent hover:underline font-medium text-xs mt-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Thêm quy tắc đầu tiên</span>
                  </button>
                </div>
              ) : (
                filteredRules.map((rule) => (
                  <div
                    key={rule.id}
                    className={`flex items-center justify-between p-3 rounded-lg border transition-all text-xs ${
                      rule.enabled
                        ? "bg-surface2/30 border-borderDefault hover:bg-surface2/60"
                        : "bg-surface1 border-borderDefault/50 opacity-60"
                    }`}
                  >
                    {/* Left: Source -> Spoken */}
                    <div className="flex-1 min-w-0 pr-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold text-textPrimary bg-surface3/60 px-1.5 py-0.5 rounded text-[11.5px]">
                          {rule.sourceText}
                        </span>
                        <span className="text-textMuted text-xs">→</span>
                        <span className="font-medium text-accent">
                          {rule.spokenText}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-[10.5px] text-textMuted">
                        {rule.caseSensitive ? (
                          <span className="text-amber-500 font-medium">Phân biệt hoa/thường</span>
                        ) : (
                          <span>Không phân biệt hoa/thường</span>
                        )}
                        <span>·</span>
                        <span>{rule.scope === "global" ? "Chung" : "Dự án"}</span>
                      </div>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => handleToggleRule(rule.id)}
                        className="p-1 text-textSecondary hover:text-textPrimary transition-colors"
                        title={rule.enabled ? "Đang bật (Click để tắt)" : "Đang tắt (Click để bật)"}
                      >
                        {rule.enabled ? (
                          <ToggleRight className="w-5 h-5 text-accent" />
                        ) : (
                          <ToggleLeft className="w-5 h-5 text-textMuted" />
                        )}
                      </button>

                      <button
                        onClick={() => handleOpenEditForm(rule)}
                        className="p-1 hover:bg-surface3 text-textMuted hover:text-textPrimary rounded transition-colors"
                        title="Chỉnh sửa"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => handleDeleteRule(rule.id)}
                        className="p-1 hover:bg-danger/15 text-textMuted hover:text-danger rounded transition-colors"
                        title="Xóa quy tắc"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-borderDefault bg-surface2/20 flex items-center justify-between text-xs text-textMuted flex-shrink-0">
          <span>{filteredRules.length} quy tắc được hiển thị</span>
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 bg-surface2 hover:bg-surface3 text-textPrimary rounded-md font-medium transition-colors"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
