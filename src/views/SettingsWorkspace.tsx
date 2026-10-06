import React, { useState, useEffect } from "react";
import {
  Globe,
  Layers,
  FolderSync,
  RefreshCw,
  Download,
  Key,
  FolderOpen,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Check,
  Zap,
  X,
  Sliders,
} from "lucide-react";
import { SettingsGroup } from "../types/ui";
import {
  loadTranslationSettings,
  saveTranslationSettings,
} from "../services/translation";
import { LicenseService, LicenseSummary } from "../services/license/licenseService";
import { LicenseModal } from "../components/modals/LicenseModal";

export interface SettingsWorkspaceProps {
  onOpenMigrationModal: (oldPath: string, newPath: string) => void;
  initialGroup?: SettingsGroup;
}

// AI Provider definition for Tab 1
interface ProviderCardItem {
  id: string;
  name: string;
  type: "cloud" | "local" | "proxy";
  typeLabel: "API đám mây" | "Nội bộ" | "Tùy chỉnh";
  defaultModel: string;
  defaultEndpoint?: string;
  requiresApiKey: boolean;
  requiresEndpoint: boolean;
}

interface ProviderConfigValues {
  apiKey: string;
  endpoint: string;
  model: string;
  timeout: number;
  maxTokens: number;
}

const PROVIDER_LIST: ProviderCardItem[] = [
  // 1. Cloud API
  {
    id: "gemini",
    name: "Google Gemini",
    type: "cloud",
    typeLabel: "API đám mây",
    defaultModel: "gemini-1.5-flash",
    requiresApiKey: true,
    requiresEndpoint: false,
  },
  {
    id: "openai",
    name: "OpenAI GPT",
    type: "cloud",
    typeLabel: "API đám mây",
    defaultModel: "gpt-4o-mini",
    requiresApiKey: true,
    requiresEndpoint: false,
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    type: "cloud",
    typeLabel: "API đám mây",
    defaultModel: "deepseek-chat",
    requiresApiKey: true,
    requiresEndpoint: false,
  },
  {
    id: "qwen",
    name: "Alibaba Qwen",
    type: "cloud",
    typeLabel: "API đám mây",
    defaultModel: "qwen-turbo",
    requiresApiKey: true,
    requiresEndpoint: false,
  },
  // 2. Local Services
  {
    id: "ollama",
    name: "Ollama (Local)",
    type: "local",
    typeLabel: "Nội bộ",
    defaultModel: "qwen2.5:7b",
    defaultEndpoint: "http://127.0.0.1:11434/v1",
    requiresApiKey: false,
    requiresEndpoint: true,
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    type: "local",
    typeLabel: "Nội bộ",
    defaultModel: "qwen2.5-7b-instruct",
    defaultEndpoint: "http://127.0.0.1:1234/v1",
    requiresApiKey: false,
    requiresEndpoint: true,
  },
  // 3. Custom Proxy
  {
    id: "custom_proxy",
    name: "API tùy chỉnh",
    type: "proxy",
    typeLabel: "Tùy chỉnh",
    defaultModel: "custom-model",
    defaultEndpoint: "https://api.your-proxy.com/v1",
    requiresApiKey: true,
    requiresEndpoint: true,
  },
];

export const SettingsWorkspace: React.FC<SettingsWorkspaceProps> = ({
  onOpenMigrationModal,
  initialGroup,
}) => {
  // Normalize initial group: map legacy aliases and sub-sections to the 3 main groups
  const resolveGroup = (grp?: SettingsGroup): SettingsGroup => {
    if (grp === "storage" || grp === "hardware" || grp === "about" || grp === "general") return "general";
    if (grp === "translation" || grp === "ai_text" || grp === "providers") return "providers";
    if (grp === "tts" || grp === "models") return "models";
    if (grp && ["general", "providers", "models"].includes(grp)) {
      return grp;
    }
    return "general";
  };

  const [activeGroup, setActiveGroup] = useState<SettingsGroup>(() => resolveGroup(initialGroup));

  useEffect(() => {
    if (initialGroup) {
      setActiveGroup(resolveGroup(initialGroup));
    }
  }, [initialGroup]);

  // Tab 1: Providers state
  const [selectedProviderId, setSelectedProviderId] = useState<string>("gemini");
  const [showApiKey, setShowApiKey] = useState(false);
  const [geminiApiKey, setGeminiApiKey] = useState(() => loadTranslationSettings().geminiApiKey || "");
  const [testConnectionStatus, setTestConnectionStatus] = useState<"idle" | "testing" | "success" | "failed">("idle");

  const [providerConfigs, setProviderConfigs] = useState<Record<string, ProviderConfigValues>>(() => {
    try {
      const saved = localStorage.getItem("voxlab_provider_configs_v4");
      if (saved) return JSON.parse(saved);
    } catch {}
    const initialGeminiKey = loadTranslationSettings().geminiApiKey || "";
    return {
      gemini: { apiKey: initialGeminiKey, endpoint: "", model: "gemini-1.5-flash", timeout: 60, maxTokens: 4096 },
      openai: { apiKey: "", endpoint: "", model: "gpt-4o-mini", timeout: 60, maxTokens: 4096 },
      deepseek: { apiKey: "", endpoint: "", model: "deepseek-chat", timeout: 60, maxTokens: 4096 },
      qwen: { apiKey: "", endpoint: "", model: "qwen-turbo", timeout: 60, maxTokens: 4096 },
      ollama: { apiKey: "", endpoint: "http://127.0.0.1:11434/v1", model: "qwen2.5:7b", timeout: 60, maxTokens: 4096 },
      lmstudio: { apiKey: "", endpoint: "http://127.0.0.1:1234/v1", model: "qwen2.5-7b-instruct", timeout: 60, maxTokens: 4096 },
      custom_proxy: { apiKey: "", endpoint: "https://api.your-proxy.com/v1", model: "custom-model", timeout: 60, maxTokens: 4096 },
    };
  });

  const currentProvider = PROVIDER_LIST.find((p) => p.id === selectedProviderId) || PROVIDER_LIST[0];
  const activeConfig: ProviderConfigValues = providerConfigs[selectedProviderId] || {
    apiKey: selectedProviderId === "gemini" ? geminiApiKey : "",
    endpoint: currentProvider.defaultEndpoint || "",
    model: currentProvider.defaultModel,
    timeout: 60,
    maxTokens: 4096,
  };

  const updateActiveConfig = (field: keyof ProviderConfigValues, val: any) => {
    setTestConnectionStatus("idle");
    setProviderConfigs((prev) => {
      const current = prev[selectedProviderId] || { ...activeConfig };
      const updated = { ...current, [field]: val };
      const next = { ...prev, [selectedProviderId]: updated };
      try {
        localStorage.setItem("voxlab_provider_configs_v4", JSON.stringify(next));
      } catch {}
      return next;
    });

    if (selectedProviderId === "gemini" && field === "apiKey") {
      setGeminiApiKey(val);
      saveTranslationSettings({ geminiApiKey: val });
    }
  };

  // Tab 2: Models state
  const [ttsModelPath, setTtsModelPath] = useState("D:\\AI\\Models\\TTS");
  const [asrModelPath, setAsrModelPath] = useState("D:\\AI\\Models\\ASR");

  // Tab 3: Storage state
  const [appDataRoot, setAppDataRoot] = useState("C:\\Users\\Admin\\AppData\\Local\\VoxLab");
  const [storageStats, setStorageStats] = useState({
    dataRootSize: "1.2 GB",
    cacheSize: "245 MB",
    logsSize: "12.4 MB",
    historyCount: 38,
  });
  const [cleanActionPending, setCleanActionPending] = useState<"cache" | "logs" | "history" | null>(null);
  const [activeCleaningTask, setActiveCleaningTask] = useState<"cache" | "logs" | "history" | null>(null);
  const [storageToast, setStorageToast] = useState<string | null>(null);

  const executeCleanAction = (action: "cache" | "logs" | "history") => {
    setCleanActionPending(null);
    setActiveCleaningTask(action);
    setTimeout(() => {
      setActiveCleaningTask(null);
      if (action === "cache") {
        setStorageStats((prev) => ({ ...prev, cacheSize: "0 MB" }));
        setStorageToast("Đã dọn sạch bộ nhớ tạm an toàn.");
      } else if (action === "logs") {
        setStorageStats((prev) => ({ ...prev, logsSize: "0 MB" }));
        setStorageToast("Đã xóa tệp nhật ký cũ thành công.");
      } else if (action === "history") {
        setStorageStats((prev) => ({ ...prev, historyCount: 0 }));
        setStorageToast("Đã dọn dẹp bản ghi lịch sử thành công.");
      }
      setTimeout(() => setStorageToast(null), 3000);
    }, 700);
  };

  // Hardware state
  const [hardwareInfo, setHardwareInfo] = useState({
    cpu: "Intel Core Ultra 7 270K Plus",
    gpu: "NVIDIA GeForce RTX 5070 Ti",
    ram: "32 GB",
    vram: "16 GB",
    cudaAvailable: true,
  });
  const [aiExecutionDevice, setAiExecutionDevice] = useState<"auto" | "gpu" | "cpu">("auto");
  const [isScanningHardware, setIsScanningHardware] = useState(false);

  const handleRescanHardware = () => {
    setIsScanningHardware(true);
    setTimeout(() => {
      setIsScanningHardware(false);
      setHardwareInfo({
        cpu: "Intel Core Ultra 7 270K Plus",
        gpu: "NVIDIA GeForce RTX 5070 Ti",
        ram: "32 GB",
        vram: "16 GB",
        cudaAvailable: true,
      });
    }, 600);
  };

  // License state & management
  const [licenseInfo, setLicenseInfo] = useState<LicenseSummary | null>(null);
  const [isLicenseModalOpen, setIsLicenseModalOpen] = useState(false);
  const [licenseToast, setLicenseToast] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  useEffect(() => {
    LicenseService.getSummary().then(setLicenseInfo).catch(() => {});
  }, []);

  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);

  const handleLicenseActivated = (newLicense: LicenseSummary) => {
    setLicenseInfo(newLicense);
    setLicenseToast({
      type: "success",
      message: `Kích hoạt bản quyền thành công! Hạn dùng: ${newLicense.expires_at_formatted}`,
    });
    setTimeout(() => setLicenseToast(null), 4000);
  };

  const handleTestConnection = () => {
    setTestConnectionStatus("testing");
    setTimeout(() => {
      if (currentProvider.requiresApiKey && !activeConfig.apiKey.trim()) {
        setTestConnectionStatus("failed");
      } else if (currentProvider.requiresEndpoint && !activeConfig.endpoint.trim()) {
        setTestConnectionStatus("failed");
      } else {
        setTestConnectionStatus("success");
      }
    }, 500);
  };

  // Strictly 3 function groups in final Information Architecture (Order: Chung -> Nhà cung cấp AI -> Mô hình)
  const groups: { id: SettingsGroup; label: string; icon: React.ReactNode }[] = [
    {
      id: "general",
      label: "Chung",
      icon: <Sliders className="w-4 h-4" />,
    },
    {
      id: "providers",
      label: "Nhà cung cấp AI",
      icon: <Globe className="w-4 h-4" />,
    },
    {
      id: "models",
      label: "Mô hình",
      icon: <Layers className="w-4 h-4" />,
    },
  ];

  return (
    <div className="flex-1 flex h-full overflow-hidden bg-background">
      {/* ================================================================== */}
      {/* LEFT NAVIGATION SIDEBAR (Strictly 3 Groups in Exact Order)         */}
      {/* ================================================================== */}
      <aside className="w-56 bg-surface1 border-r border-borderDefault p-3 space-y-1.5 flex-shrink-0 select-none overflow-y-auto">
        <div className="px-3 py-2 text-[10px] font-bold text-textMuted uppercase tracking-wider">
          Cài đặt
        </div>
        {groups.map((g) => {
          const isActive = activeGroup === g.id;
          return (
            <button
              key={g.id}
              onClick={() => setActiveGroup(g.id)}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-left transition-all cursor-pointer ${
                isActive
                  ? "bg-accent/15 text-accent font-semibold border border-accent/40 shadow-xs"
                  : "text-textSecondary hover:bg-surface2 hover:text-textPrimary border border-transparent"
              }`}
            >
              <span className={`shrink-0 ${isActive ? "text-accent" : "text-textMuted"}`}>
                {g.icon}
              </span>
              <span className="text-xs font-medium truncate">{g.label}</span>
            </button>
          );
        })}
      </aside>

      {/* ================================================================== */}
      {/* RIGHT CONTENT WORKSPACE                                            */}
      {/* ================================================================== */}
      <div className="flex-1 overflow-y-auto p-6 text-xs bg-background">
        <div className="max-w-4xl mx-auto space-y-6">

          {/* ---------------------------------------------------------------- */}
          {/* TAB 1: NHÀ CUNG CẤP AI (AI Providers)                            */}
          {/* ---------------------------------------------------------------- */}
          {activeGroup === "providers" && (
            <div className="space-y-5">
              {/* Header */}
              <div className="flex items-center gap-2 pb-2 border-b border-borderDefault/60">
                <Globe className="w-4 h-4 text-accent" />
                <h3 className="font-semibold text-sm text-textPrimary">Nhà cung cấp AI</h3>
              </div>

              {/* Provider Selection Cards */}
              <div className="space-y-2">
                <div className="text-xs font-medium text-textSecondary">Chọn nhà cung cấp</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
                  {PROVIDER_LIST.map((prov) => {
                    const isSelected = selectedProviderId === prov.id;
                    return (
                      <button
                        key={prov.id}
                        type="button"
                        data-provider-id={prov.id}
                        onClick={() => {
                          setSelectedProviderId(prov.id);
                          setTestConnectionStatus("idle");
                        }}
                        className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between gap-2 cursor-pointer select-none ${
                          isSelected
                            ? "bg-accent/10 border-accent shadow-xs ring-2 ring-accent/30 text-textPrimary"
                            : "bg-surface1 hover:bg-surface2/70 border-borderDefault text-textSecondary hover:text-textPrimary"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="font-semibold text-xs text-textPrimary truncate">{prov.name}</span>
                          {isSelected && (
                            <span className="w-4 h-4 rounded-full bg-accent text-white flex items-center justify-center shrink-0">
                              <Check className="w-2.5 h-2.5 stroke-[3]" />
                            </span>
                          )}
                        </div>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded w-fit border ${
                            isSelected
                              ? "bg-accent/15 text-accent border-accent/30 font-medium"
                              : "bg-surface2 text-textMuted border-borderDefault/60"
                          }`}
                        >
                          {prov.typeLabel}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Minimalist Configuration Form */}
              <div className="p-4 sm:p-5 bg-surface1 rounded-xl border border-borderDefault space-y-4">
                <div className="flex items-center justify-between border-b border-borderDefault/70 pb-3">
                  <div className="flex items-center gap-2">
                    <Key className="w-4 h-4 text-accent" />
                    <h4 className="font-semibold text-xs text-textPrimary">Cấu hình: {currentProvider.name}</h4>
                  </div>
                </div>

                <div className="space-y-3.5">
                  {/* Conditional API Key / Endpoint */}
                  {currentProvider.type === "proxy" ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-textPrimary block">Endpoint URL</label>
                        <input
                          type="text"
                          value={activeConfig.endpoint}
                          onChange={(e) => updateActiveConfig("endpoint", e.target.value)}
                          placeholder="https://api.your-proxy.com/v1"
                          className="w-full bg-surface2 border border-borderDefault rounded-lg px-3 py-2 text-xs font-mono text-textPrimary placeholder:text-textMuted/60 focus:border-accent focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-textPrimary block">API Key</label>
                        <div className="relative flex items-center">
                          <input
                            type={showApiKey ? "text" : "password"}
                            value={activeConfig.apiKey}
                            onChange={(e) => updateActiveConfig("apiKey", e.target.value)}
                            placeholder="Bearer token / API Key..."
                            className="w-full bg-surface2 border border-borderDefault rounded-lg px-3 py-2 pr-9 text-xs font-mono text-textPrimary placeholder:text-textMuted/60 focus:border-accent focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => setShowApiKey(!showApiKey)}
                            className="absolute right-2.5 p-1 text-textMuted hover:text-textPrimary cursor-pointer"
                          >
                            {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : currentProvider.requiresApiKey ? (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-textPrimary block">API Key</label>
                      <div className="relative flex items-center">
                        <input
                          type={showApiKey ? "text" : "password"}
                          value={activeConfig.apiKey}
                          onChange={(e) => updateActiveConfig("apiKey", e.target.value)}
                          placeholder={
                            currentProvider.id === "gemini"
                              ? "AIzaSy..."
                              : currentProvider.id === "openai"
                              ? "sk-proj-..."
                              : "Nhập API Key..."
                          }
                          className="w-full bg-surface2 border border-borderDefault rounded-lg px-3 py-2 pr-9 text-xs font-mono text-textPrimary placeholder:text-textMuted/60 focus:border-accent focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setShowApiKey(!showApiKey)}
                          className="absolute right-2.5 p-1 text-textMuted hover:text-textPrimary cursor-pointer"
                        >
                          {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-textPrimary block">Endpoint URL</label>
                      <input
                        type="text"
                        value={activeConfig.endpoint}
                        onChange={(e) => updateActiveConfig("endpoint", e.target.value)}
                        placeholder={currentProvider.defaultEndpoint || "http://127.0.0.1:1234/v1"}
                        className="w-full bg-surface2 border border-borderDefault rounded-lg px-3 py-2 text-xs font-mono text-textPrimary placeholder:text-textMuted/60 focus:border-accent focus:outline-none"
                      />
                    </div>
                  )}

                  {/* Row 2: Model, Timeout, Max Tokens */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-textPrimary block">Tên mô hình</label>
                      <input
                        type="text"
                        value={activeConfig.model}
                        onChange={(e) => updateActiveConfig("model", e.target.value)}
                        placeholder={currentProvider.defaultModel}
                        className="w-full bg-surface2 border border-borderDefault rounded-lg px-3 py-2 text-xs font-mono text-textPrimary placeholder:text-textMuted/60 focus:border-accent focus:outline-none"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-textPrimary block">Thời gian chờ</label>
                      <select
                        value={activeConfig.timeout}
                        onChange={(e) => updateActiveConfig("timeout", Number(e.target.value))}
                        className="w-full bg-surface2 border border-borderDefault rounded-lg px-3 py-2 text-xs text-textPrimary focus:border-accent focus:outline-none"
                      >
                        <option value={15}>15 giây</option>
                        <option value={30}>30 giây</option>
                        <option value={60}>60 giây</option>
                        <option value={120}>120 giây</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-textPrimary block">Giới hạn token</label>
                      <select
                        value={activeConfig.maxTokens}
                        onChange={(e) => updateActiveConfig("maxTokens", Number(e.target.value))}
                        className="w-full bg-surface2 border border-borderDefault rounded-lg px-3 py-2 text-xs font-mono text-textPrimary focus:border-accent focus:outline-none"
                      >
                        <option value={0}>Không giới hạn</option>
                        <option value={1024}>1024 tokens</option>
                        <option value={2048}>2048 tokens</option>
                        <option value={4096}>4096 tokens</option>
                        <option value={8192}>8192 tokens</option>
                      </select>
                    </div>
                  </div>

                  {/* Action Row */}
                  <div className="pt-2 flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-2">
                      {testConnectionStatus === "success" && (
                        <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium px-2.5 py-1 bg-emerald-500/10 rounded-md border border-emerald-500/20">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Hợp lệ</span>
                        </div>
                      )}

                      {testConnectionStatus === "failed" && (
                        <div className="flex items-center gap-1.5 text-xs text-danger font-medium px-2.5 py-1 bg-danger/10 rounded-md border border-danger/20">
                          <AlertCircle className="w-3.5 h-3.5" />
                          <span>
                            {currentProvider.requiresApiKey && !activeConfig.apiKey.trim()
                              ? "Chưa nhập API Key"
                              : currentProvider.requiresEndpoint && !activeConfig.endpoint.trim()
                              ? "Chưa nhập Endpoint"
                              : "Lỗi kết nối"}
                          </span>
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={handleTestConnection}
                      disabled={testConnectionStatus === "testing"}
                      className="flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent/90 text-white rounded-lg font-medium text-xs transition-colors cursor-pointer shadow-xs disabled:opacity-50"
                    >
                      {testConnectionStatus === "testing" ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Zap className="w-3.5 h-3.5" />
                      )}
                      <span>{testConnectionStatus === "testing" ? "Đang kiểm tra..." : "Kiểm tra"}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ---------------------------------------------------------------- */}
          {/* TAB 2: MÔ HÌNH (Models)                                          */}
          {/* ---------------------------------------------------------------- */}
          {activeGroup === "models" && (
            <div className="space-y-6">
              {/* Header */}
              <div className="flex items-center gap-2 pb-2 border-b border-borderDefault/60">
                <Layers className="w-4 h-4 text-accent" />
                <h3 className="font-semibold text-sm text-textPrimary">Quản lý mô hình AI cục bộ</h3>
              </div>

              {/* Path 1: TTS Models */}
              <div className="p-4 bg-surface1 rounded-xl border border-borderDefault space-y-2">
                <label className="font-semibold text-xs text-textPrimary block">
                  Thư mục Mô hình Giọng nói (TTS)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={ttsModelPath}
                    onChange={(e) => setTtsModelPath(e.target.value)}
                    className="flex-1 bg-surface2 border border-borderDefault rounded-lg px-3 py-2 text-xs font-mono text-textPrimary focus:border-accent focus:outline-none"
                  />
                  <button className="px-3.5 py-2 bg-surface2 hover:bg-surface3 rounded-lg border border-borderDefault text-textSecondary hover:text-textPrimary text-xs font-medium transition-colors cursor-pointer">
                    Chọn thư mục...
                  </button>
                  <button className="flex items-center gap-1.5 px-3.5 py-2 bg-surface2 hover:bg-surface3 text-accent rounded-lg border border-accent/40 font-semibold text-xs transition-colors cursor-pointer">
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Quét lại</span>
                  </button>
                </div>
              </div>

              {/* Path 2: Transcription Models */}
              <div className="p-4 bg-surface1 rounded-xl border border-borderDefault space-y-2">
                <label className="font-semibold text-xs text-textPrimary block">
                  Thư mục Mô hình Bóc băng (ASR / Whisper)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={asrModelPath}
                    onChange={(e) => setAsrModelPath(e.target.value)}
                    className="flex-1 bg-surface2 border border-borderDefault rounded-lg px-3 py-2 text-xs font-mono text-textPrimary focus:border-accent focus:outline-none"
                  />
                  <button className="px-3.5 py-2 bg-surface2 hover:bg-surface3 rounded-lg border border-borderDefault text-textSecondary hover:text-textPrimary text-xs font-medium transition-colors cursor-pointer">
                    Chọn thư mục...
                  </button>
                  <button className="flex items-center gap-1.5 px-3.5 py-2 bg-surface2 hover:bg-surface3 text-accent rounded-lg border border-accent/40 font-semibold text-xs transition-colors cursor-pointer">
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Quét lại</span>
                  </button>
                </div>
              </div>

              {/* Models Table */}
              <div className="p-4 bg-surface1 rounded-xl border border-borderDefault space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-xs text-textPrimary block">Danh sách mô hình</span>
                </div>

                <div className="border border-borderDefault rounded-lg overflow-hidden">
                  <table className="w-full text-left font-mono text-xs">
                    <thead className="bg-surface2 text-textMuted border-b border-borderDefault text-[11px]">
                      <tr>
                        <th className="p-2.5">Tên mô hình & Phiên bản</th>
                        <th className="p-2.5">Loại</th>
                        <th className="p-2.5">Dung lượng</th>
                        <th className="p-2.5">Trạng thái</th>
                        <th className="p-2.5 text-right">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-borderDefault">
                      <tr className="hover:bg-surface2/40">
                        <td className="p-2.5 font-sans font-medium text-textPrimary">OmniVoice v1.2</td>
                        <td className="p-2.5 text-textMuted">TTS + Voice Clone</td>
                        <td className="p-2.5 text-textMuted">2.1 GB</td>
                        <td className="p-2.5 text-emerald-600 dark:text-emerald-400 font-semibold">ĐÃ CÀI ĐẶT</td>
                        <td className="p-2.5 text-right">
                          <button className="text-textMuted hover:text-danger text-xs font-sans px-2 py-1 rounded hover:bg-surface3 transition-colors cursor-pointer">
                            Gỡ cài đặt
                          </button>
                        </td>
                      </tr>
                      <tr className="hover:bg-surface2/40">
                        <td className="p-2.5 font-sans font-medium text-textPrimary">Chatterbox Turbo</td>
                        <td className="p-2.5 text-textMuted">TTS Nhanh</td>
                        <td className="p-2.5 text-textMuted">1.4 GB</td>
                        <td className="p-2.5 text-emerald-600 dark:text-emerald-400 font-semibold">ĐÃ CÀI ĐẶT</td>
                        <td className="p-2.5 text-right">
                          <button className="text-textMuted hover:text-danger text-xs font-sans px-2 py-1 rounded hover:bg-surface3 transition-colors cursor-pointer">
                            Gỡ cài đặt
                          </button>
                        </td>
                      </tr>
                      <tr className="hover:bg-surface2/40">
                        <td className="p-2.5 font-sans font-medium text-textPrimary">Qwen3-TTS (1.7B)</td>
                        <td className="p-2.5 text-textMuted">TTS Đa ngữ</td>
                        <td className="p-2.5 text-textMuted">1.8 GB</td>
                        <td className="p-2.5 text-amber-500 font-semibold">CHƯA TẢI</td>
                        <td className="p-2.5 text-right">
                          <button className="inline-flex items-center gap-1 px-2.5 py-1 bg-accent text-white font-semibold rounded hover:bg-accentHover transition-colors text-xs cursor-pointer">
                            <Download className="w-3 h-3" />
                            <span>Tải về</span>
                          </button>
                        </td>
                      </tr>
                      <tr className="hover:bg-surface2/40">
                        <td className="p-2.5 font-sans font-medium text-textPrimary">faster-whisper Large V3</td>
                        <td className="p-2.5 text-textMuted">ASR Chuẩn xác</td>
                        <td className="p-2.5 text-textMuted">3.1 GB</td>
                        <td className="p-2.5 text-amber-500 font-semibold">CHƯA TẢI</td>
                        <td className="p-2.5 text-right">
                          <button className="inline-flex items-center gap-1 px-2.5 py-1 bg-accent text-white font-semibold rounded hover:bg-accentHover transition-colors text-xs cursor-pointer">
                            <Download className="w-3 h-3" />
                            <span>Tải về</span>
                          </button>
                        </td>
                      </tr>
                      <tr className="hover:bg-surface2/40">
                        <td className="p-2.5 font-sans font-medium text-textPrimary">faster-whisper Medium</td>
                        <td className="p-2.5 text-textMuted">ASR Cân bằng</td>
                        <td className="p-2.5 text-textMuted">1.5 GB</td>
                        <td className="p-2.5 text-emerald-600 dark:text-emerald-400 font-semibold">ĐÃ CÀI ĐẶT</td>
                        <td className="p-2.5 text-right">
                          <button className="text-textMuted hover:text-danger text-xs font-sans px-2 py-1 rounded hover:bg-surface3 transition-colors cursor-pointer">
                            Gỡ cài đặt
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ---------------------------------------------------------------- */}
          {/* ---------------------------------------------------------------- */}
          {/* TAB 3: CHUNG (Thẻ Thông tin, Lưu trữ, Phần cứng & AI)             */}
          {/* ---------------------------------------------------------------- */}
          {activeGroup === "general" && (
            <div className="space-y-4">
              {/* Thẻ 1: Thông tin & Bản quyền */}
              <div className="p-5 bg-surface1 rounded-xl border border-borderDefault space-y-4">
                {/* Header: VoxLab - V1.0.0 + [Kiểm tra cập nhật] */}
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-accent to-sky-500 flex items-center justify-center text-white font-bold text-base shadow-md shadow-accent/20 shrink-0">
                      VX
                    </div>
                    <div className="font-bold text-base text-textPrimary tracking-tight">
                      VoxLab - V1.0.0
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => alert("Phiên bản VoxLab hiện tại (V1.0.0) là mới nhất.")}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface2 hover:bg-surface3 text-accent rounded-lg border border-accent/30 text-xs font-medium transition-colors cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Kiểm tra cập nhật</span>
                  </button>
                </div>

                {/* Key bản quyền */}
                <div className="pt-3 border-t border-borderDefault/70 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="font-semibold text-xs text-textPrimary block">
                      Key bản quyền
                    </label>
                    <span className="text-[10px] text-textMuted bg-surface2 px-2 py-0.5 rounded border border-borderDefault font-medium">
                      Tạm vô hiệu hóa (xử lý sau)
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      disabled
                      value={licenseInfo ? licenseInfo.masked_key : "VOX-DEV-UNRESTRICTED"}
                      placeholder="xxx-xxx-xxx-xxx"
                      className="flex-1 bg-surface2/60 border border-borderDefault rounded-lg px-3 py-2 text-xs font-mono text-textMuted cursor-not-allowed select-all"
                    />
                    <button
                      type="button"
                      disabled
                      className="flex items-center gap-1.5 px-3.5 py-2 bg-surface2 text-textMuted border border-borderDefault font-medium rounded-lg text-xs cursor-not-allowed opacity-60"
                      title="Tính năng kích hoạt bản quyền tạm thời được vô hiệu hóa và sẽ xử lý sau khi hoàn thành toàn bộ app"
                    >
                      <Key className="w-3.5 h-3.5" />
                      <span>{licenseInfo ? "Đổi key" : "Nhập key"}</span>
                    </button>
                  </div>

                  {/* Thời hạn đặt ở dưới thanh nhập key */}
                  <div className="flex items-center gap-2 text-xs text-textSecondary pt-0.5">
                    <span>
                      Thời hạn:{" "}
                      <strong className="text-textPrimary font-medium">
                        Tạm hoãn (Không giới hạn tính năng)
                      </strong>
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-medium border bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20">
                      Tạm vô hiệu hóa
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Toast Feedback nếu có */}
              {storageToast && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-medium flex items-center justify-between animate-in fade-in duration-150">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span>{storageToast}</span>
                  </div>
                  <button
                    onClick={() => setStorageToast(null)}
                    className="p-1 hover:bg-emerald-500/20 rounded text-emerald-600 dark:text-emerald-400 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Thẻ 2: Lưu trữ & Dữ liệu (1 Vùng duy nhất) */}
              <div className="p-5 bg-surface1 rounded-xl border border-borderDefault space-y-4">
                {/* Khu vực trên: Thư mục dữ liệu VoxLab */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="font-semibold text-xs text-textPrimary block">
                      Thư mục dữ liệu VoxLab
                    </label>
                    <span className="font-mono text-xs text-accent font-semibold px-2 py-0.5 rounded bg-accent/10 border border-accent/20">
                      {storageStats.dataRootSize}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={appDataRoot}
                      onChange={(e) => setAppDataRoot(e.target.value)}
                      disabled={activeCleaningTask !== null}
                      className="flex-1 bg-surface2 border border-borderDefault rounded-lg px-3 py-2 text-xs font-mono text-textPrimary focus:border-accent focus:outline-none disabled:opacity-60"
                    />
                    <button
                      type="button"
                      onClick={() => onOpenMigrationModal(appDataRoot, "D:\\VoxLabData")}
                      disabled={activeCleaningTask !== null}
                      className="flex items-center gap-1.5 px-3.5 py-2 bg-accent hover:bg-accent/90 text-white font-medium rounded-lg transition-colors text-xs cursor-pointer shadow-xs disabled:opacity-50"
                    >
                      <FolderSync className="w-3.5 h-3.5" />
                      <span>Thay đổi thư mục...</span>
                    </button>
                  </div>
                </div>

                {/* Phân cách & Khu vực dưới: 3 thẻ dọn dẹp (Bộ nhớ tạm, Nhật ký, Lịch sử) */}
                <div className="pt-4 border-t border-borderDefault/70">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {/* Bộ nhớ tạm */}
                    <div className="p-3.5 bg-surface2/60 rounded-xl border border-borderDefault flex flex-col justify-between gap-3">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-xs text-textPrimary">Bộ nhớ tạm</span>
                        <span className="font-mono text-[11px] text-textMuted">{storageStats.cacheSize}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setCleanActionPending("cache")}
                        disabled={activeCleaningTask !== null || storageStats.cacheSize === "0 MB"}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-surface1 hover:bg-danger/15 text-textSecondary hover:text-danger rounded-lg border border-borderDefault hover:border-danger/30 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {activeCleaningTask === "cache" ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span>Đang dọn...</span>
                          </>
                        ) : storageStats.cacheSize === "0 MB" ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-500" />
                            <span>Đã dọn sạch</span>
                          </>
                        ) : (
                          <>
                            <Trash2 className="w-3.5 h-3.5 shrink-0" />
                            <span>Dọn bộ nhớ tạm</span>
                          </>
                        )}
                      </button>
                    </div>

                    {/* Nhật ký */}
                    <div className="p-3.5 bg-surface2/60 rounded-xl border border-borderDefault flex flex-col justify-between gap-3">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-xs text-textPrimary">Nhật ký</span>
                        <span className="font-mono text-[11px] text-textMuted">{storageStats.logsSize}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setStorageToast("Đã mở thư mục nhật ký hệ thống.");
                            setTimeout(() => setStorageToast(null), 2500);
                          }}
                          disabled={activeCleaningTask !== null}
                          className="flex items-center justify-center gap-1.5 px-3 py-2 bg-surface1 hover:bg-surface3 text-textPrimary rounded-lg border border-borderDefault text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
                        >
                          <FolderOpen className="w-3.5 h-3.5 text-textMuted shrink-0" />
                          <span>Mở thư mục</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setCleanActionPending("logs")}
                          disabled={activeCleaningTask !== null || storageStats.logsSize === "0 MB"}
                          className="flex items-center justify-center gap-1.5 px-3 py-2 bg-surface1 hover:bg-danger/15 text-textSecondary hover:text-danger rounded-lg border border-borderDefault hover:border-danger/30 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {activeCleaningTask === "logs" ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              <span>Đang xóa...</span>
                            </>
                          ) : storageStats.logsSize === "0 MB" ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-500" />
                              <span>Đã xóa</span>
                            </>
                          ) : (
                            <>
                              <Trash2 className="w-3.5 h-3.5 shrink-0" />
                              <span>Xóa nhật ký</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Lịch sử */}
                    <div className="p-3.5 bg-surface2/60 rounded-xl border border-borderDefault flex flex-col justify-between gap-3">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-xs text-textPrimary">Lịch sử</span>
                        <span className="font-mono text-[11px] text-textMuted">{storageStats.historyCount} bản ghi</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setCleanActionPending("history")}
                        disabled={activeCleaningTask !== null || storageStats.historyCount === 0}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-surface1 hover:bg-danger/15 text-textSecondary hover:text-danger rounded-lg border border-borderDefault hover:border-danger/30 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {activeCleaningTask === "history" ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span>Đang dọn...</span>
                          </>
                        ) : storageStats.historyCount === 0 ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-500" />
                            <span>Đã dọn</span>
                          </>
                        ) : (
                          <>
                            <Trash2 className="w-3.5 h-3.5 shrink-0" />
                            <span>Dọn lịch sử</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Thẻ 3: Phần Cứng & Hiệu suất xử lý (1 Vùng duy nhất) */}
              <div className="p-5 bg-surface1 rounded-xl border border-borderDefault space-y-4">
                {/* Phần Cứng ở trên */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="font-semibold text-xs text-textPrimary">Phần Cứng</span>
                    <div className="flex items-center gap-2.5">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        CUDA: Khả dụng
                      </span>
                      <button
                        type="button"
                        onClick={handleRescanHardware}
                        disabled={isScanningHardware}
                        className="inline-flex items-center gap-1.5 px-3 py-1 bg-surface2 hover:bg-surface3 text-textPrimary rounded-lg border border-borderDefault text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3 h-3 text-accent ${isScanningHardware ? "animate-spin" : ""}`} />
                        <span>{isScanningHardware ? "Đang quét..." : "Quét lại"}</span>
                      </button>
                    </div>
                  </div>

                  {/* 4 Cards: CPU, GPU, RAM, VRAM */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {/* CPU */}
                    <div className="p-3 bg-surface2/60 rounded-xl border border-borderDefault space-y-1">
                      <span className="text-[10px] font-bold text-textMuted uppercase tracking-wider block">CPU</span>
                      <div className="text-xs font-semibold text-textPrimary truncate" title={hardwareInfo.cpu}>
                        {hardwareInfo.cpu}
                      </div>
                    </div>

                    {/* GPU */}
                    <div className="p-3 bg-surface2/60 rounded-xl border border-borderDefault space-y-1">
                      <span className="text-[10px] font-bold text-textMuted uppercase tracking-wider block">GPU</span>
                      <div className="text-xs font-semibold text-accent truncate" title={hardwareInfo.gpu}>
                        {hardwareInfo.gpu}
                      </div>
                    </div>

                    {/* RAM */}
                    <div className="p-3 bg-surface2/60 rounded-xl border border-borderDefault space-y-1">
                      <span className="text-[10px] font-bold text-textMuted uppercase tracking-wider block">RAM</span>
                      <div className="text-xs font-semibold text-textPrimary">
                        {hardwareInfo.ram}
                      </div>
                    </div>

                    {/* VRAM */}
                    <div className="p-3 bg-surface2/60 rounded-xl border border-borderDefault space-y-1">
                      <span className="text-[10px] font-bold text-textMuted uppercase tracking-wider block">VRAM</span>
                      <div className="text-xs font-semibold text-accent">
                        {hardwareInfo.vram}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Đường kẻ ngang và Phần dưới: Hiệu suất xử lý */}
                <div className="pt-4 border-t border-borderDefault/70 space-y-3">
                  <span className="font-semibold text-xs text-textPrimary block">
                    Hiệu suất xử lý
                  </span>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {/* Tự động */}
                    <label
                      onClick={() => setAiExecutionDevice("auto")}
                      className={`p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                        aiExecutionDevice === "auto"
                          ? "bg-accent/15 border-accent text-accent shadow-xs"
                          : "bg-surface2/60 border-borderDefault text-textSecondary hover:bg-surface2"
                      }`}
                    >
                      <span className="font-semibold text-xs text-textPrimary">Tự động</span>
                      <input
                        type="radio"
                        name="device"
                        checked={aiExecutionDevice === "auto"}
                        onChange={() => setAiExecutionDevice("auto")}
                        className="accent-accent"
                      />
                    </label>

                    {/* GPU */}
                    <label
                      onClick={() => setAiExecutionDevice("gpu")}
                      className={`p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                        aiExecutionDevice === "gpu"
                          ? "bg-accent/15 border-accent text-accent shadow-xs"
                          : "bg-surface2/60 border-borderDefault text-textSecondary hover:bg-surface2"
                      }`}
                    >
                      <span className="font-semibold text-xs text-textPrimary">GPU</span>
                      <input
                        type="radio"
                        name="device"
                        checked={aiExecutionDevice === "gpu"}
                        onChange={() => setAiExecutionDevice("gpu")}
                        className="accent-accent"
                      />
                    </label>

                    {/* CPU */}
                    <label
                      onClick={() => setAiExecutionDevice("cpu")}
                      className={`p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                        aiExecutionDevice === "cpu"
                          ? "bg-accent/15 border-accent text-accent shadow-xs"
                          : "bg-surface2/60 border-borderDefault text-textSecondary hover:bg-surface2"
                      }`}
                    >
                      <span className="font-semibold text-xs text-textPrimary">CPU</span>
                      <input
                        type="radio"
                        name="device"
                        checked={aiExecutionDevice === "cpu"}
                        onChange={() => setAiExecutionDevice("cpu")}
                        className="accent-accent"
                      />
                    </label>
                  </div>

                  {/* Dòng đề xuất hệ thống */}
                  <div className="pt-1 flex items-center justify-between flex-wrap gap-2 text-xs">
                    <div className="flex items-center gap-1.5 text-textSecondary">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                      <span>Khuyến nghị: <strong className="text-textPrimary font-medium">GPU · 16 GB VRAM</strong></span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Hàng Đặt lại cài đặt ở chân trang (không có đường kẻ ngang background) */}
              <div className="pt-2 flex items-center justify-between flex-wrap gap-2">
                <span className="font-medium text-xs text-textPrimary">
                  Đặt lại cài đặt
                </span>
                <button
                  type="button"
                  onClick={() => setIsResetConfirmOpen(true)}
                  className="px-3.5 py-1.5 text-danger hover:bg-danger/10 border border-danger/30 rounded-lg text-xs font-medium transition-colors cursor-pointer"
                >
                  Đặt lại
                </button>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Storage Action Confirmation Modal */}
      {cleanActionPending && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-surface1 border border-borderDefault rounded-xl w-full max-w-md shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-4 border-b border-borderDefault flex items-center justify-between bg-surface2/40">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-danger/15 border border-danger/30 flex items-center justify-center text-danger shrink-0">
                  <Trash2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-textPrimary">
                    {cleanActionPending === "cache" && "Xác nhận dọn dẹp bộ nhớ tạm"}
                    {cleanActionPending === "logs" && "Xác nhận xóa tệp nhật ký"}
                    {cleanActionPending === "history" && "Xác nhận dọn dẹp lịch sử"}
                  </h3>
                  <p className="text-xs text-textMuted">
                    Hành động này sẽ giải phóng dữ liệu theo quy tắc an toàn.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setCleanActionPending(null)}
                className="p-1.5 hover:bg-surface3 text-textMuted hover:text-textPrimary rounded-md transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 text-xs space-y-4">
              {cleanActionPending === "cache" && (
                <div className="space-y-3">
                  <div className="p-3 rounded-lg bg-surface2 border border-borderDefault space-y-1.5">
                    <div className="font-semibold text-textPrimary flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-accent" />
                      <span>Dữ liệu sẽ dọn dẹp:</span>
                    </div>
                    <p className="text-textSecondary leading-relaxed">
                      Giải phóng <span className="font-mono font-semibold text-textPrimary">{storageStats.cacheSize}</span> bộ nhớ đệm audio nghe thử và waveform giải mã tạm thời.
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 space-y-1">
                    <div className="font-semibold flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5" />
                      <span>Bảo toàn an toàn:</span>
                    </div>
                    <p className="text-[11px] leading-relaxed">
                      Không xóa mô hình AI, cấu hình, preset giọng đọc, tệp nguồn hoặc kết quả xuất. Không ảnh hưởng đến các công việc Batch đang xử lý.
                    </p>
                  </div>
                </div>
              )}

              {cleanActionPending === "logs" && (
                <div className="space-y-3">
                  <div className="p-3 rounded-lg bg-surface2 border border-borderDefault space-y-1.5">
                    <div className="font-semibold text-textPrimary flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-accent" />
                      <span>Dữ liệu sẽ dọn dẹp:</span>
                    </div>
                    <p className="text-textSecondary leading-relaxed">
                      Xóa toàn bộ các tệp nhật ký sự kiện và lỗi cũ (<span className="font-mono font-semibold text-textPrimary">{storageStats.logsSize}</span>).
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 space-y-1">
                    <div className="font-semibold flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5" />
                      <span>Bảo toàn an toàn:</span>
                    </div>
                    <p className="text-[11px] leading-relaxed">
                      Giữ nguyên phiên nhật ký hiện tại đang ghi. Nhật ký không lưu trữ API Key, License Key hay dữ liệu nhạy cảm.
                    </p>
                  </div>
                </div>
              )}

              {cleanActionPending === "history" && (
                <div className="space-y-3">
                  <div className="p-3 rounded-lg bg-surface2 border border-borderDefault space-y-1.5">
                    <div className="font-semibold text-textPrimary flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-accent" />
                      <span>Dữ liệu sẽ dọn dẹp:</span>
                    </div>
                    <p className="text-textSecondary leading-relaxed">
                      Xóa danh sách <span className="font-mono font-semibold text-textPrimary">{storageStats.historyCount} bản ghi</span> lịch sử hiển thị trong ứng dụng.
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 space-y-1">
                    <div className="font-semibold flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5" />
                      <span>Bảo toàn an toàn:</span>
                    </div>
                    <p className="text-[11px] leading-relaxed">
                      Tuyệt đối không xóa tệp âm thanh nguồn hoặc kết quả xuất trên ổ đĩa. Bảo toàn hàng đợi, snapshot và metadata cho tác vụ Batch Retry/Regenerate.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-borderDefault bg-surface2/40 flex items-center justify-end gap-2">
              <button
                onClick={() => setCleanActionPending(null)}
                className="px-3.5 py-2 rounded-lg border border-borderDefault bg-surface2 hover:bg-surface3 text-textPrimary font-medium text-xs transition-colors cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                onClick={() => executeCleanAction(cleanActionPending)}
                className="px-4 py-2 rounded-lg bg-danger hover:bg-danger/90 text-white font-medium text-xs transition-colors cursor-pointer shadow-xs"
              >
                {cleanActionPending === "logs" ? "Xác nhận xóa" : "Xác nhận dọn dẹp"}
              </button>
            </div>
          </div>
        </div>
      )}



      {/* Modal: Xác nhận Đặt lại cài đặt */}
      {isResetConfirmOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-surface1 border border-borderDefault rounded-xl w-full max-w-md shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-4 border-b border-borderDefault flex items-center justify-between bg-surface2/40">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-danger/15 border border-danger/30 flex items-center justify-center text-danger shrink-0">
                  <RefreshCw className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-textPrimary">Đặt lại cài đặt</h3>
                  <p className="text-xs text-textMuted">Khôi phục cấu hình mặc định ban đầu</p>
                </div>
              </div>
              <button
                onClick={() => setIsResetConfirmOpen(false)}
                className="p-1.5 hover:bg-surface3 text-textMuted hover:text-textPrimary rounded-md transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 text-xs space-y-3">
              <p className="text-textSecondary leading-relaxed">
                Hành động này sẽ khôi phục các tùy chọn cấu hình ứng dụng (nhà cung cấp AI, thiết bị xử lý, tham số mặc định) về trạng thái ban đầu.
              </p>
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 space-y-1">
                <div className="font-semibold flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" />
                  <span>Bảo toàn an toàn:</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  Tuyệt đối không xóa mô hình AI, không xóa lịch sử, không xóa tệp âm thanh đầu ra và không xóa Voice Library.
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-borderDefault bg-surface2/40 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsResetConfirmOpen(false)}
                className="px-3.5 py-2 rounded-lg border border-borderDefault bg-surface2 hover:bg-surface3 text-textPrimary font-medium text-xs transition-colors cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsResetConfirmOpen(false);
                  setStorageToast("Đã khôi phục các cài đặt về mặc định ban đầu.");
                  setTimeout(() => setStorageToast(null), 3000);
                }}
                className="px-4 py-2 rounded-lg bg-danger hover:bg-danger/90 text-white font-medium text-xs transition-colors cursor-pointer shadow-xs"
              >
                Đặt lại cấu hình
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pop-up Modal Kích hoạt / Đổi Key bản quyền */}
      <LicenseModal
        isOpen={isLicenseModalOpen}
        onClose={() => setIsLicenseModalOpen(false)}
        onSuccess={handleLicenseActivated}
        isInitialLaunch={!licenseInfo}
      />

      {/* Toast Notification at bottom-right of the app */}
      {licenseToast && (
        <div className="fixed bottom-6 right-6 z-50 animate-in fade-in slide-in-from-bottom-5 duration-200">
          <div
            className={`px-4 py-3 rounded-xl shadow-xl border flex items-center gap-3 backdrop-blur-md ${
              licenseToast.type === "success"
                ? "bg-surface1/95 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                : "bg-surface1/95 border-danger/30 text-danger"
            }`}
          >
            {licenseToast.type === "success" ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-danger shrink-0" />
            )}
            <span className="text-xs font-medium text-textPrimary">
              {licenseToast.message}
            </span>
            <button
              onClick={() => setLicenseToast(null)}
              className="p-1 hover:bg-surface2 rounded text-textMuted hover:text-textPrimary transition-colors ml-1 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsWorkspace;
