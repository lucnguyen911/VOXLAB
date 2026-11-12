import React, { useState, useEffect } from "react";
import {
  Globe,
  Layers,
  RefreshCw,
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
  Plus,
  Download,
  Loader2,
} from "lucide-react";
import { SettingsGroup } from "../types/ui";
import {
  loadTranslationSettings,
  saveTranslationSettings,
  ClaudeTranslateProvider,
  DeepSeekTranslateProvider,
  LmStudioTranslateProvider,
  OllamaTranslateProvider,
  CustomTranslationModel,
  resolveOpenAiBaseUrl,
  loadGeminiKeyEntriesFromVault,
  saveGeminiKeyEntries,
  scheduleDebouncedGeminiKeySave,
  flushPendingGeminiKeyWrites,
  getGeminiKeyEntriesSync,
  getGeminiVaultStatus,
  getGeminiVaultError,
  geminiKeyPool,
  MAX_GEMINI_TOTAL_KEYS,
  type GeminiKeyEntry,
  type GeminiKeyHealthStatus,
} from "../services/translation";
import { appHttpRequest } from "../services/http/nativeClient";
import { LicenseService, LicenseSummary } from "../services/license/licenseService";
import { LicenseModal } from "../components/modals/LicenseModal";
import {
  scanAiModels,
  loadAiRuntimeSettings,
  saveAiRuntimeSettings,
  getAiHardwareInfo,
  installAiModel,
  cancelAiModelInstall,
  onModelInstallProgress,
  normalizeWhisperModelId,
  type ModelStatus,
  type ModelInstallProgressEvent,
} from "../services/ai/aiRuntimeSettings";
import { applyAsrModelSwitch } from "../services/ai/asrReadiness";
import { loadSubtitleSettings } from "../services/subtitle/profiles";
import { showPathInFolder, reloadAiRuntimeSettings } from "../services/batch/batchRuntime";
import { formatInstalledRamGb } from "../services/ai/hardwareRecommendation";
import { AdvancedTtsSettingsPanel } from "../components/settings/AdvancedTtsSettingsPanel";
import { checkAppUpdate, triggerAppUpdateModal } from "../services/updater/updaterService";

export interface SettingsWorkspaceProps {
  onOpenMigrationModal?: (oldPath: string, newPath: string) => void;
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
  isCustom?: boolean;
}

interface CustomProviderItem {
  id: string;
  name: string;
  endpoint: string;
  apiKey: string;
  model: string;
  timeout: number;
  maxTokens: number;
}

interface ProviderConfigValues {
  name?: string;
  apiKey: string;
  endpoint: string;
  model: string;
  timeout: number;
  maxTokens: number;
}

const BUILTIN_PROVIDERS: ProviderCardItem[] = [
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
    defaultEndpoint: "https://api.openai.com/v1",
    requiresApiKey: true,
    requiresEndpoint: false,
  },
  {
    id: "claude",
    name: "Anthropic Claude",
    type: "cloud",
    typeLabel: "API đám mây",
    defaultModel: "claude-3-5-haiku-20241022",
    defaultEndpoint: "https://api.anthropic.com/v1",
    requiresApiKey: true,
    requiresEndpoint: false,
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    type: "cloud",
    typeLabel: "API đám mây",
    defaultModel: "deepseek-chat",
    defaultEndpoint: "https://api.deepseek.com/v1",
    requiresApiKey: true,
    requiresEndpoint: false,
  },
  {
    id: "qwen",
    name: "Alibaba Qwen",
    type: "cloud",
    typeLabel: "API đám mây",
    defaultModel: "qwen-turbo",
    defaultEndpoint: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    requiresApiKey: true,
    requiresEndpoint: false,
  },
  // 2. Local Services
  {
    id: "ollama",
    name: "Ollama",
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
];

export const SettingsWorkspace: React.FC<SettingsWorkspaceProps> = ({
  onOpenMigrationModal: _onOpenMigrationModal,
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
  const [connectionMessage, setConnectionMessage] = useState<string>("");

  // Gemini Multi-Key Pool state (Google Gemini ONLY)
  const [geminiKeySlots, setGeminiKeySlots] = useState<GeminiKeyEntry[]>(() => getGeminiKeyEntriesSync());
  const [visibleGeminiKeyIds, setVisibleGeminiKeyIds] = useState<Record<string, boolean>>({});
  const [geminiKeyStatuses, setGeminiKeyStatuses] = useState<
    Record<string, { status: GeminiKeyHealthStatus; message?: string }>
  >({});
  const [geminiDuplicateSlotIds, setGeminiDuplicateSlotIds] = useState<string[]>([]);
  const [geminiSaveError, setGeminiSaveError] = useState<string | null>(() => getGeminiVaultError());
  const [geminiSaveState, setGeminiSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    let mounted = true;
    loadGeminiKeyEntriesFromVault()
      .then((entries) => {
        if (!mounted) return;
        const vaultErr = getGeminiVaultError();
        if (vaultErr) {
          setGeminiSaveError(vaultErr);
          setGeminiSaveState("error");
        }
        setGeminiKeySlots(entries);
        const primary = entries.find((e) => e.role === "primary")?.apiKey || "";
        setGeminiApiKey(primary);
        setProviderConfigs((prev) => ({
          ...prev,
          gemini: {
            ...(prev.gemini || {
              apiKey: "",
              endpoint: "",
              model: "gemini-1.5-flash",
              timeout: 60,
              maxTokens: 4096,
            }),
            apiKey: primary,
          },
        }));
      })
      .catch((err: any) => {
        if (!mounted) return;
        setGeminiSaveError(err?.message || getGeminiVaultError() || "Không thể đọc kho khóa mã hóa.");
        setGeminiSaveState("error");
      });
    return () => {
      mounted = false;
      // Flush any debounced Gemini key edits when leaving Settings
      void flushPendingGeminiKeyWrites().then(() => {
        geminiKeyPool.syncBucketsWithStore();
      }).catch(() => {});
    };
  }, []);

  const persistProviderConfigsSafely = (nextConfigs: Record<string, ProviderConfigValues>) => {
    try {
      const sanitized: Record<string, ProviderConfigValues> = { ...nextConfigs };
      if (sanitized.gemini) {
        // Never store raw Gemini API keys in localStorage
        sanitized.gemini = {
          ...sanitized.gemini,
          apiKey: "",
        };
      }
      localStorage.setItem("voxlab_provider_configs_v4", JSON.stringify(sanitized));
    } catch {}
  };

  const computeDuplicateSlotIds = (slots: GeminiKeyEntry[]): string[] => {
    const seen = new Set<string>();
    const dupIds: string[] = [];
    for (const slot of slots) {
      const trimmed = (slot.apiKey || "").trim();
      if (!trimmed) continue;
      if (seen.has(trimmed)) {
        dupIds.push(slot.id);
      } else {
        seen.add(trimmed);
      }
    }
    return dupIds;
  };

  const syncAndSaveGeminiSlots = async (
    nextSlots: GeminiKeyEntry[],
    options?: { immediate?: boolean }
  ) => {
    const reindexed: GeminiKeyEntry[] = [];
    const primarySlot = nextSlots.find((s) => s.role === "primary") ||
      nextSlots[0] || {
        id: "gemini_key_primary",
        label: "API Key chính",
        apiKey: "",
        role: "primary" as const,
      };
    reindexed.push({
      ...primarySlot,
      id: primarySlot.id && primarySlot.role === "primary" ? primarySlot.id : "gemini_key_primary",
      label: "API Key chính",
      role: "primary",
    });

    let secIdx = 1;
    for (const slot of nextSlots) {
      if (slot === primarySlot || slot.role === "primary") continue;
      reindexed.push({
        ...slot,
        id: slot.id || `gemini_key_secondary_${secIdx}`,
        label: `API Key phụ ${secIdx}`,
        role: "secondary",
      });
      secIdx++;
    }

    const dupIds = computeDuplicateSlotIds(reindexed);
    setGeminiDuplicateSlotIds(dupIds);
    setGeminiKeySlots(reindexed);

    const primaryKeyVal = reindexed[0].apiKey.trim();
    setGeminiApiKey(primaryKeyVal);
    setProviderConfigs((prev) => {
      const current = prev.gemini || {
        apiKey: "",
        endpoint: "",
        model: "gemini-1.5-flash",
        timeout: 60,
        maxTokens: 4096,
      };
      const next = {
        ...prev,
        gemini: {
          ...current,
          apiKey: primaryKeyVal,
        },
      };
      persistProviderConfigsSafely(next);
      return next;
    });

    if (getGeminiVaultStatus() === "error") {
      const errMsg = getGeminiVaultError() || "Kho khóa Gemini đang ở trạng thái lỗi đọc. Không tự động ghi đè.";
      setGeminiSaveError(errMsg);
      setGeminiSaveState("error");
      return;
    }

    // Exclude duplicate keys before saving to vault
    const nonDuplicateSlots = reindexed.filter((s) => !dupIds.includes(s.id));
    setGeminiSaveState("saving");
    setGeminiSaveError(null);

    try {
      if (options?.immediate) {
        await saveGeminiKeyEntries(nonDuplicateSlots);
      } else {
        await scheduleDebouncedGeminiKeySave(nonDuplicateSlots, 400);
      }
      setGeminiSaveError(null);
      setGeminiSaveState("saved");
      geminiKeyPool.syncBucketsWithStore();
    } catch (err: any) {
      setGeminiSaveError(err?.message || "Không thể lưu khóa mã hóa. Dữ liệu đã lưu trước đó vẫn được giữ nguyên.");
      setGeminiSaveState("error");
    }
  };

  const handleChangeGeminiSlotValue = (slotId: string, newValue: string) => {
    setTestConnectionStatus("idle");
    setConnectionMessage("");
    // Reset edited key status to untested immediately without auto-testing
    setGeminiKeyStatuses((prev) => ({
      ...prev,
      [slotId]: { status: "untested" },
    }));

    const nextSlots = geminiKeySlots.map((slot) =>
      slot.id === slotId ? { ...slot, apiKey: newValue } : slot
    );
    void syncAndSaveGeminiSlots(nextSlots, { immediate: false });
  };

  const handleBlurGeminiSlot = () => {
    void flushPendingGeminiKeyWrites()
      .then(() => {
        geminiKeyPool.syncBucketsWithStore();
      })
      .catch((err: any) => {
        setGeminiSaveError(err?.message || "Không thể lưu khóa mã hóa.");
        setGeminiSaveState("error");
      });
  };

  const handleAddGeminiSecondaryKey = () => {
    if (geminiKeySlots.length >= MAX_GEMINI_TOTAL_KEYS) return;
    const secondaryCount = geminiKeySlots.filter((s) => s.role === "secondary").length;
    const newId = `gemini_key_secondary_${Date.now()}_${secondaryCount + 1}`;
    const nextSlots: GeminiKeyEntry[] = [
      ...geminiKeySlots,
      {
        id: newId,
        label: `API Key phụ ${secondaryCount + 1}`,
        apiKey: "",
        role: "secondary",
      },
    ];
    setGeminiKeyStatuses((prev) => ({
      ...prev,
      [newId]: { status: "untested" },
    }));
    void syncAndSaveGeminiSlots(nextSlots, { immediate: true });
  };

  const handleRemoveGeminiSecondaryKey = (slotId: string) => {
    // Strictly prevent accidental removal of primary key
    const target = geminiKeySlots.find((s) => s.id === slotId);
    if (!target || target.role === "primary") return;

    const nextSlots = geminiKeySlots.filter((s) => s.id !== slotId);
    setGeminiKeyStatuses((prev) => {
      const copy = { ...prev };
      delete copy[slotId];
      return copy;
    });
    setVisibleGeminiKeyIds((prev) => {
      const copy = { ...prev };
      delete copy[slotId];
      return copy;
    });
    void syncAndSaveGeminiSlots(nextSlots, { immediate: true });
  };

  const toggleGeminiSlotVisibility = (slotId: string) => {
    setVisibleGeminiKeyIds((prev) => ({
      ...prev,
      [slotId]: !prev[slotId],
    }));
  };

  // Load custom providers from translation settings & local storage
  const [customProviders, setCustomProviders] = useState<CustomProviderItem[]>(() => {
    try {
      const transSettings = loadTranslationSettings();
      const savedConfig = localStorage.getItem("voxlab_provider_configs_v4");
      const parsedConfig = savedConfig ? JSON.parse(savedConfig) : {};

      if (transSettings.customModels && transSettings.customModels.length > 0) {
        return transSettings.customModels.map((m) => ({
          id: m.id,
          name: m.name || "API tùy chỉnh",
          endpoint: m.endpoint || "https://api.openai.com/v1",
          apiKey: m.apiKey || parsedConfig[m.id]?.apiKey || "",
          model: m.model || "gpt-4o-mini",
          timeout: parsedConfig[m.id]?.timeout || 60,
          maxTokens: parsedConfig[m.id]?.maxTokens || 4096,
        }));
      }

      // Check legacy custom_proxy in voxlab_provider_configs_v4
      if (parsedConfig.custom_proxy && (parsedConfig.custom_proxy.apiKey || parsedConfig.custom_proxy.endpoint)) {
        return [
          {
            id: "custom_proxy",
            name: "API tùy chỉnh",
            endpoint: parsedConfig.custom_proxy.endpoint || "https://api.your-proxy.com/v1",
            apiKey: parsedConfig.custom_proxy.apiKey || "",
            model: parsedConfig.custom_proxy.model || "custom-model",
            timeout: parsedConfig.custom_proxy.timeout || 60,
            maxTokens: parsedConfig.custom_proxy.maxTokens || 4096,
          },
        ];
      }
    } catch {}
    return [];
  });

  const [providerConfigs, setProviderConfigs] = useState<Record<string, ProviderConfigValues>>(() => {
    let parsed: Record<string, ProviderConfigValues> = {};
    try {
      const saved = localStorage.getItem("voxlab_provider_configs_v4");
      if (saved) parsed = JSON.parse(saved);
    } catch {}
    const trans = loadTranslationSettings();
    const initialGeminiKey = trans.geminiApiKey || "";
    const initialDeepseekKey = trans.deepseekApiKey || "";

    const result: Record<string, ProviderConfigValues> = {
      gemini: {
        apiKey: parsed.gemini?.apiKey ?? initialGeminiKey,
        endpoint: parsed.gemini?.endpoint ?? "",
        model: parsed.gemini?.model ?? "gemini-1.5-flash",
        timeout: parsed.gemini?.timeout ?? 60,
        maxTokens: parsed.gemini?.maxTokens ?? 4096,
      },
      openai: {
        apiKey: parsed.openai?.apiKey ?? "",
        endpoint: parsed.openai?.endpoint ?? "https://api.openai.com/v1",
        model: parsed.openai?.model ?? "gpt-4o-mini",
        timeout: parsed.openai?.timeout ?? 60,
        maxTokens: parsed.openai?.maxTokens ?? 4096,
      },
      claude: {
        apiKey: parsed.claude?.apiKey ?? "",
        endpoint: parsed.claude?.endpoint ?? "https://api.anthropic.com/v1",
        model: parsed.claude?.model ?? "claude-3-5-haiku-20241022",
        timeout: parsed.claude?.timeout ?? 60,
        maxTokens: parsed.claude?.maxTokens ?? 4096,
      },
      deepseek: {
        apiKey: parsed.deepseek?.apiKey ?? initialDeepseekKey,
        endpoint: parsed.deepseek?.endpoint ?? "https://api.deepseek.com/v1",
        model: parsed.deepseek?.model ?? "deepseek-chat",
        timeout: parsed.deepseek?.timeout ?? 60,
        maxTokens: parsed.deepseek?.maxTokens ?? 4096,
      },
      qwen: {
        apiKey: parsed.qwen?.apiKey ?? "",
        endpoint: parsed.qwen?.endpoint ?? "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        model: parsed.qwen?.model ?? "qwen-turbo",
        timeout: parsed.qwen?.timeout ?? 60,
        maxTokens: parsed.qwen?.maxTokens ?? 4096,
      },
      ollama: {
        apiKey: parsed.ollama?.apiKey ?? "",
        endpoint: parsed.ollama?.endpoint ?? "http://127.0.0.1:11434/v1",
        model: parsed.ollama?.model ?? "qwen2.5:7b",
        timeout: parsed.ollama?.timeout ?? 60,
        maxTokens: parsed.ollama?.maxTokens ?? 4096,
      },
      lmstudio: {
        apiKey: parsed.lmstudio?.apiKey ?? "",
        endpoint: parsed.lmstudio?.endpoint ?? "http://127.0.0.1:1234/v1",
        model: parsed.lmstudio?.model ?? "qwen2.5-7b-instruct",
        timeout: parsed.lmstudio?.timeout ?? 60,
        maxTokens: parsed.lmstudio?.maxTokens ?? 4096,
      },
    };

    if (trans.customModels && trans.customModels.length > 0) {
      for (const m of trans.customModels) {
        result[m.id] = {
          name: m.name,
          apiKey: m.apiKey || parsed[m.id]?.apiKey || "",
          endpoint: m.endpoint || "https://api.openai.com/v1",
          model: m.model || "gpt-4o-mini",
          timeout: parsed[m.id]?.timeout || 60,
          maxTokens: parsed[m.id]?.maxTokens || 4096,
        };
      }
    }

    return result;
  });

  const customCards: ProviderCardItem[] = customProviders.map((c) => ({
    id: c.id,
    name: c.name || "API tùy chỉnh",
    type: "proxy",
    typeLabel: "Tùy chỉnh",
    defaultModel: c.model || "gpt-4o-mini",
    defaultEndpoint: c.endpoint || "https://api.openai.com/v1",
    requiresApiKey: true,
    requiresEndpoint: true,
    isCustom: true,
  }));

  const displayedProviders: ProviderCardItem[] = [...BUILTIN_PROVIDERS, ...customCards];

  const currentProvider = displayedProviders.find((p) => p.id === selectedProviderId) || displayedProviders[0];
  const activeConfig: ProviderConfigValues = providerConfigs[selectedProviderId] || {
    name: currentProvider.name,
    apiKey: selectedProviderId === "gemini" ? geminiApiKey : "",
    endpoint: currentProvider.defaultEndpoint || "",
    model: currentProvider.defaultModel,
    timeout: 60,
    maxTokens: 4096,
  };

  const handleAddCustomProvider = () => {
    const newId = `custom_${Date.now()}`;
    const defaultName = `API tùy chỉnh ${customProviders.length + 1}`;
    const newCustom: CustomProviderItem = {
      id: newId,
      name: defaultName,
      endpoint: "https://api.openai.com/v1",
      apiKey: "",
      model: "gpt-4o-mini",
      timeout: 60,
      maxTokens: 4096,
    };

    const nextCustomList = [...customProviders, newCustom];
    setCustomProviders(nextCustomList);

    // Sync with translation settings for Dubbing & Batch
    const translationCustomModels: CustomTranslationModel[] = nextCustomList.map((c) => ({
      id: c.id,
      name: c.name,
      type: "openai_compatible",
      endpoint: c.endpoint,
      apiKey: c.apiKey || undefined,
      model: c.model,
      timeout: c.timeout,
      maxTokens: c.maxTokens,
      createdAt: Date.now(),
    }));
    saveTranslationSettings({ customModels: translationCustomModels });

    // Update providerConfigs and localStorage
    setProviderConfigs((prev) => {
      const next = {
        ...prev,
        [newId]: {
          name: newCustom.name,
          apiKey: newCustom.apiKey,
          endpoint: newCustom.endpoint,
          model: newCustom.model,
          timeout: newCustom.timeout,
          maxTokens: newCustom.maxTokens,
        },
      };
      try {
        localStorage.setItem("voxlab_provider_configs_v4", JSON.stringify(next));
      } catch {}
      return next;
    });

    // Select the new custom provider to edit inline immediately
    setSelectedProviderId(newId);
    setTestConnectionStatus("idle");
    setConnectionMessage("");
  };

  const handleDeleteCustomProvider = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const nextCustomList = customProviders.filter((c) => c.id !== id);
    setCustomProviders(nextCustomList);

    const translationCustomModels: CustomTranslationModel[] = nextCustomList.map((c) => ({
      id: c.id,
      name: c.name,
      type: "openai_compatible",
      endpoint: c.endpoint,
      apiKey: c.apiKey || undefined,
      model: c.model,
      timeout: c.timeout,
      maxTokens: c.maxTokens,
      createdAt: Date.now(),
    }));
    saveTranslationSettings({ customModels: translationCustomModels });

    setProviderConfigs((prev) => {
      const next = { ...prev };
      delete next[id];
      try {
        localStorage.setItem("voxlab_provider_configs_v4", JSON.stringify(next));
      } catch {}
      return next;
    });

    if (selectedProviderId === id) {
      setSelectedProviderId("gemini");
      setTestConnectionStatus("idle");
      setConnectionMessage("");
    }
  };

  const updateActiveConfig = (field: keyof ProviderConfigValues, val: any) => {
    setTestConnectionStatus("idle");
    setConnectionMessage("");

    setProviderConfigs((prev) => {
      const current = prev[selectedProviderId] || { ...activeConfig };
      const updated = { ...current, [field]: val };
      const next = { ...prev, [selectedProviderId]: updated };
      persistProviderConfigsSafely(next);
      return next;
    });

    if (selectedProviderId === "gemini" && field === "apiKey") {
      const primaryId = geminiKeySlots.find((s) => s.role === "primary")?.id || "gemini_key_primary";
      handleChangeGeminiSlotValue(primaryId, String(val || ""));
      return;
    }
    if (selectedProviderId === "deepseek" && field === "apiKey") {
      saveTranslationSettings({ deepseekApiKey: val });
    }
    if (selectedProviderId === "openai" && field === "apiKey") {
      try {
        localStorage.setItem("voxlab_openai_api_key", val);
      } catch {}
    }
    if (selectedProviderId === "claude" && field === "apiKey") {
      try {
        localStorage.setItem("voxlab_claude_api_key", val);
      } catch {}
    }

    // Sync custom provider fields
    if (selectedProviderId.startsWith("custom_") || selectedProviderId === "custom_proxy") {
      setCustomProviders((prev) => {
        const nextCustom = prev.map((c) => {
          if (c.id === selectedProviderId) {
            return {
              ...c,
              [field]: val,
            };
          }
          return c;
        });

        const translationCustomModels: CustomTranslationModel[] = nextCustom.map((c) => ({
          id: c.id,
          name: c.name,
          type: "openai_compatible",
          endpoint: c.endpoint,
          apiKey: c.apiKey || undefined,
          model: c.model,
          timeout: c.timeout,
          maxTokens: c.maxTokens,
          createdAt: Date.now(),
        }));
        saveTranslationSettings({ customModels: translationCustomModels });

        return nextCustom;
      });
    }
  };

  // Tab 2: Real Models state
  const [modelsDir, setModelsDir] = useState<string>("");
  const [modelsList, setModelsList] = useState<ModelStatus[]>([]);
  const [isScanningModels, setIsScanningModels] = useState<boolean>(false);
  const [installingModelId, setInstallingModelId] = useState<string | null>(null);
  const [installProgress, setInstallProgress] = useState<ModelInstallProgressEvent | null>(null);
  const [modelInstallNotice, setModelInstallNotice] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);

  const handleScanModels = async (dirOverride?: string): Promise<ModelStatus[]> => {
    setIsScanningModels(true);
    try {
      const targetDir = dirOverride ?? modelsDir;
      const models = await scanAiModels(targetDir);
      setModelsList(models);
      return models;
    } catch (e) {
      console.error("Scan models error:", e);
      return [];
    } finally {
      setIsScanningModels(false);
    }
  };

  const handleInstallModel = async (model: ModelStatus) => {
    if (installingModelId) return;
    setModelInstallNotice(null);
    setInstallingModelId(model.id);
    setInstallProgress({
      modelId: model.id,
      status: "installing",
      stage: "preparing",
      pct: 1,
      message: `Đang khởi tạo cài đặt ${model.displayName}...`,
    });
    try {
      await installAiModel(model.id, modelsDir || undefined);
      const refreshedModels = await handleScanModels();
      if (model.kind === "asr" || model.engine === "faster-whisper") {
        const currentCanonical = normalizeWhisperModelId(loadSubtitleSettings().whisperModel);
        const currentInstalled = refreshedModels.some(
          (m) =>
            (m.kind === "asr" || m.engine === "faster-whisper") &&
            normalizeWhisperModelId(m.id) === currentCanonical &&
            m.installed
        );
        if (!currentInstalled) {
          await applyAsrModelSwitch(normalizeWhisperModelId(model.id));
        }
      }
      await fetchRealStorageStats();
      await fetchRealHardwareInfo();
      setModelInstallNotice({
        type: "success",
        message: `Đã tải và cài đặt sẵn sàng mô hình ${model.displayName.replace(/\s*\(faster-whisper\)/i, "")}.`,
      });
    } catch (err: any) {
      const code = err?.code || "";
      const rawMsg = err?.message || String(err || "Không thể cài đặt mô hình.");
      if (code === "CANCELLED" || rawMsg.includes("CANCELLED") || rawMsg.includes("Đã hủy")) {
        setModelInstallNotice({
          type: "info",
          message: `Đã dừng cài đặt ${model.displayName.replace(/\s*\(faster-whisper\)/i, "")}.`,
        });
      } else {
        setModelInstallNotice({
          type: "error",
          message: rawMsg,
        });
      }
      await handleScanModels();
    } finally {
      setInstallingModelId(null);
      setInstallProgress(null);
    }
  };

  const handleCancelInstallModel = async (modelId: string) => {
    await cancelAiModelInstall(modelId);
  };

  const handlePickModelsDir = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Chọn thư mục chứa mô hình AI",
      });
      if (typeof selected === "string" && selected.trim()) {
        setModelsDir(selected);
        const s = await loadAiRuntimeSettings();
        s.modelsDir = selected;
        s.customModelsDir = true;
        await saveAiRuntimeSettings(s);
        await reloadAiRuntimeSettings();
        await handleScanModels(selected);
      }
    } catch (err) {
      console.error("Failed to pick models directory:", err);
    }
  };

  // Tab 3: Storage state (real AppData & Scratch metrics)
  const [appDataRoot, setAppDataRoot] = useState("");
  const [storageStats, setStorageStats] = useState({
    dataRootSize: "0 MB",
    cacheSize: "0 MB",
    scratchBytes: 0,
  });
  const [cleanActionPending, setCleanActionPending] = useState<"cache" | null>(null);
  const [activeCleaningTask, setActiveCleaningTask] = useState<"cache" | null>(null);
  const [storageToast, setStorageToast] = useState<string | null>(null);

  const formatBytesReadable = (bytes: number): string => {
    if (!bytes || bytes <= 0) return "0 MB";
    if (bytes < 1024 * 1024) {
      const kb = Math.max(1, Math.round(bytes / 1024));
      return `${kb} KB`;
    }
    const mb = bytes / (1024 * 1024);
    if (mb < 1024) {
      return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
    }
    return `${(mb / 1024).toFixed(2)} GB`;
  };

  const fetchRealStorageStats = async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const stats = await invoke<{
        appDataPath: string;
        appDataBytes: number;
        scratchPath: string;
        scratchBytes: number;
      }>("fs_storage_stats");
      if (stats) {
        setAppDataRoot(stats.scratchPath || stats.appDataPath);
        setStorageStats({
          dataRootSize: formatBytesReadable(stats.appDataBytes),
          cacheSize: formatBytesReadable(stats.scratchBytes),
          scratchBytes: stats.scratchBytes,
        });
      }
    } catch {
      // Fallback in non-Tauri test/dev preview
    }
  };

  const executeCleanAction = async (action: "cache") => {
    setCleanActionPending(null);
    setActiveCleaningTask(action);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const freedBytes = await invoke<number>("fs_clear_scratch");
      await fetchRealStorageStats();
      setStorageToast(
        freedBytes > 0
          ? `Đã dọn sạch ${formatBytesReadable(freedBytes)} bộ nhớ tạm an toàn.`
          : "Bộ nhớ tạm đã sạch hoàn toàn."
      );
    } catch {
      setStorageStats((prev) => ({ ...prev, cacheSize: "0 MB", scratchBytes: 0 }));
      setStorageToast("Đã dọn sạch bộ nhớ tạm an toàn.");
    } finally {
      setActiveCleaningTask(null);
      setTimeout(() => setStorageToast(null), 3000);
    }
  };

  const handleResetAllDefaultSettings = async () => {
    setIsResetConfirmOpen(false);
    try {
      await handleDeviceChange("auto");
      const keysToReset = [
        "voxlab_tts_settings_v1",
        "voxlab_tts_advanced_settings_v1",
        "voxlab_dialogue_settings",
        "voxlab_dubbing_voice_settings",
        "voxlab_dubbing_pauses_v1",
        "voxlab_dubbing_mode",
        "voxlab_subtitle_settings_v2",
        "voxlab_batch_global_defaults_v2",
      ];
      for (const k of keysToReset) {
        localStorage.removeItem(k);
      }
      window.dispatchEvent(new CustomEvent("voxlab_tts_advanced_settings_changed"));
    } catch (e) {
      console.error("Failed to reset default settings:", e);
    }
    setStorageToast("Đã khôi phục các tùy chọn cấu hình về mặc định chuẩn.");
    setTimeout(() => setStorageToast(null), 3000);
  };

  // Hardware state
  const [hardwareInfo, setHardwareInfo] = useState({
    cpu: "Đang kiểm tra...",
    gpu: "Đang kiểm tra...",
    ram: "—",
    vram: "—",
    cudaAvailable: false,
  });
  const [aiExecutionDevice, setAiExecutionDevice] = useState<"auto" | "gpu" | "cpu">("auto");
  const [isScanningHardware, setIsScanningHardware] = useState(false);

  const handleDeviceChange = async (dev: "auto" | "gpu" | "cpu") => {
    setAiExecutionDevice(dev);
    try {
      const s = await loadAiRuntimeSettings();
      s.device = dev === "gpu" ? "cuda" : dev;
      await saveAiRuntimeSettings(s);
      await reloadAiRuntimeSettings();
    } catch (e) {
      console.error("Failed to update AI device setting:", e);
    }
  };

  const fetchRealHardwareInfo = async () => {
    setIsScanningHardware(true);
    try {
      const hwAccel = await getAiHardwareInfo();
      const { invoke } = await import("@tauri-apps/api/core");
      const info = await invoke<any>("ai_request", {
        runtime: "core",
        method: "system.info",
        params: {},
      }).catch(() => null);

      setHardwareInfo((prev) => {
        const hasCuda = Boolean(info?.cudaAvailable || hwAccel.hasNvidiaGpu);
        const gpuLabel = info?.gpu
          ? String(info.gpu)
          : hwAccel.gpuName
          ? hwAccel.gpuName
          : hasCuda
          ? "NVIDIA CUDA GPU"
          : "Không phát hiện GPU rời";
        return {
          ...prev,
          cpu: info?.cpu ? String(info.cpu) : prev.cpu,
          gpu: gpuLabel,
          ram: info?.ramTotalMb ? `${formatInstalledRamGb(info.ramTotalMb)} GB` : prev.ram,
          cudaAvailable: hasCuda,
          vram: info?.vramTotalMb
            ? `${Math.round(info.vramTotalMb / 1024)} GB`
            : hasCuda
            ? "Sẵn sàng (CUDA)"
            : "N/A",
        };
      });
    } catch (e) {
      console.warn("Could not query hardware info:", e);
    } finally {
      setIsScanningHardware(false);
    }
  };

  const handleRescanHardware = () => {
    fetchRealHardwareInfo();
  };

  // License state & management
  const [licenseInfo, setLicenseInfo] = useState<LicenseSummary | null>(null);
  const [isLicenseModalOpen, setIsLicenseModalOpen] = useState(false);
  const [isVerifyingLicense, setIsVerifyingLicense] = useState(false);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [currentAppVersion, setCurrentAppVersion] = useState("1.0.5");
  const [licenseToast, setLicenseToast] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const handleCheckForUpdates = async () => {
    if (isCheckingUpdate) return;
    setIsCheckingUpdate(true);
    try {
      const res = await checkAppUpdate();
      if (res.currentVersion) {
        setCurrentAppVersion(res.currentVersion);
      }
      if (res.updateAvailable) {
        triggerAppUpdateModal(res);
      } else {
        setLicenseToast({
          type: "success",
          message: `Phiên bản VoxLab hiện tại (V${res.currentVersion || currentAppVersion}) là bản mới nhất.`,
        });
        setTimeout(() => setLicenseToast(null), 3500);
      }
    } catch (err: any) {
      setLicenseToast({
        type: "error",
        message: err?.message || String(err || "Không thể kết nối máy chủ cập nhật."),
      });
      setTimeout(() => setLicenseToast(null), 4000);
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  useEffect(() => {
    let unlistenInstall: (() => void) | null = null;
    onModelInstallProgress((ev) => {
      if (ev.status === "installing") {
        setInstallingModelId(ev.modelId);
        setInstallProgress(ev);
      }
    })
      .then((fn) => {
        unlistenInstall = fn;
      })
      .catch(() => {});

    LicenseService.getSummary().then(setLicenseInfo).catch(() => {});
    if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
      import("@tauri-apps/api/app")
        .then(({ getVersion }) => getVersion())
        .then((v) => {
          if (v) setCurrentAppVersion(v);
        })
        .catch(() => {});
    }
    fetchRealHardwareInfo();
    fetchRealStorageStats();
    loadAiRuntimeSettings().then(async (settings) => {
      setModelsDir(settings.modelsDir);
      setAiExecutionDevice(settings.device === "cuda" ? "gpu" : settings.device);
      const models = await scanAiModels(settings.modelsDir);
      setModelsList(models);
    }).catch(console.error);

    return () => {
      if (unlistenInstall) unlistenInstall();
    };
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

  const handleReverifyLicense = async () => {
    if (isVerifyingLicense) return;
    setIsVerifyingLicense(true);
    try {
      const updated = await LicenseService.verify();
      setLicenseInfo(updated);
      setLicenseToast({
        type: updated.is_valid ? "success" : "error",
        message: updated.is_valid
          ? updated.status === "OFFLINE_GRACE"
            ? updated.error_message || "Đang hoạt động ngoại tuyến (Ân hạn 3 ngày)."
            : `Bản quyền hợp lệ • Hạn dùng: ${updated.expires_at_formatted}`
          : updated.error_message || "Bản quyền không hợp lệ.",
      });
      setTimeout(() => setLicenseToast(null), 4000);
    } finally {
      setIsVerifyingLicense(false);
    }
  };

  const handleTestConnection = async () => {
    setTestConnectionStatus("testing");
    setConnectionMessage("");

    try {
      if (selectedProviderId === "gemini") {
        await flushPendingGeminiKeyWrites();
        const nonDuplicateSlots = geminiKeySlots.filter(
          (s) => s.apiKey.trim().length > 0 && !geminiDuplicateSlotIds.includes(s.id)
        );
        if (nonDuplicateSlots.length === 0) {
          throw new Error("Chưa nhập Google Gemini API Key.");
        }
        const summary = await geminiKeyPool.testAllConfiguredKeys({
          entries: nonDuplicateSlots,
          modelName: activeConfig.model.trim() || "gemini-1.5-flash",
          timeoutSec: Math.max(5, Math.min(30, activeConfig.timeout || 20)),
        });

        const nextStatuses: Record<string, { status: GeminiKeyHealthStatus; message?: string }> = {};
        for (const item of summary.results) {
          nextStatuses[item.id] = {
            status: item.status,
            message: item.message,
          };
        }
        // Any empty or duplicate slot stays untested
        for (const slot of geminiKeySlots) {
          if (!nextStatuses[slot.id]) {
            nextStatuses[slot.id] = { status: "untested" };
          }
        }
        setGeminiKeyStatuses(nextStatuses);

        if (summary.validCount > 0) {
          setTestConnectionStatus("success");
          setConnectionMessage(summary.summaryText);
        } else {
          setTestConnectionStatus("failed");
          setConnectionMessage(summary.summaryText);
        }
      } else if (selectedProviderId === "claude") {
        if (!activeConfig.apiKey.trim()) {
          throw new Error("Chưa nhập Anthropic Claude API Key.");
        }
        const provider = new ClaudeTranslateProvider(
          activeConfig.apiKey.trim(),
          activeConfig.model.trim() || undefined,
          activeConfig.endpoint.trim() || undefined,
          activeConfig.timeout,
          activeConfig.maxTokens
        );
        const res = await provider.testConnection();
        if (!res.ok) throw new Error(res.message || "Lỗi kết nối Anthropic Claude API");
        setTestConnectionStatus("success");
        setConnectionMessage(res.message || "Kết nối Anthropic Claude API thành công!");
      } else if (selectedProviderId === "deepseek") {
        if (!activeConfig.apiKey.trim()) {
          throw new Error("Chưa nhập DeepSeek API Key.");
        }
        const provider = new DeepSeekTranslateProvider(
          activeConfig.apiKey.trim(),
          activeConfig.model.trim() || undefined,
          activeConfig.endpoint.trim() || undefined,
          activeConfig.timeout,
          activeConfig.maxTokens
        );
        const res = await provider.testConnection();
        if (!res.ok) throw new Error(res.message || "Lỗi kết nối DeepSeek API");
        setTestConnectionStatus("success");
        setConnectionMessage(res.message || "Kết nối DeepSeek API thành công!");
      } else if (selectedProviderId === "ollama") {
        const endpoint = activeConfig.endpoint.trim() || "http://127.0.0.1:11434/v1";
        const provider = new OllamaTranslateProvider(
          endpoint,
          activeConfig.model.trim() || undefined,
          activeConfig.apiKey.trim() || undefined,
          "ollama",
          "Ollama",
          activeConfig.timeout,
          activeConfig.maxTokens
        );
        const res = await provider.testConnection();
        if (!res.ok) throw new Error(res.message || "Không thể kết nối tới Ollama");
        setTestConnectionStatus("success");
        setConnectionMessage(res.message || "Kết nối Ollama thành công!");
      } else if (selectedProviderId === "lmstudio") {
        const endpoint = activeConfig.endpoint.trim() || "http://127.0.0.1:1234/v1";
        const provider = new LmStudioTranslateProvider(
          endpoint,
          activeConfig.model.trim() || undefined,
          activeConfig.apiKey.trim() || undefined,
          "lmstudio",
          "LM Studio",
          activeConfig.timeout,
          activeConfig.maxTokens,
          "lmstudio"
        );
        const res = await provider.testConnection();
        if (!res.ok) throw new Error(res.message || "Không thể kết nối tới LM Studio");
        setTestConnectionStatus("success");
        setConnectionMessage(res.message || "Kết nối LM Studio thành công!");
      } else if (selectedProviderId === "openai") {
        if (!activeConfig.apiKey.trim()) throw new Error("Chưa nhập OpenAI API Key.");
        const cleanEndpoint = resolveOpenAiBaseUrl(activeConfig.endpoint, "https://api.openai.com/v1");
        const timeoutSec = Math.max(5, activeConfig.timeout || 60);
        const res = await appHttpRequest(`${cleanEndpoint}/models`, {
          method: "GET",
          headers: { Authorization: `Bearer ${activeConfig.apiKey.trim()}` },
          timeoutSec,
        });
        if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${res.statusText}`);
        setTestConnectionStatus("success");
        setConnectionMessage("Kết nối OpenAI API thành công!");
      } else if (selectedProviderId === "qwen") {
        if (!activeConfig.apiKey.trim()) throw new Error("Chưa nhập DashScope/Qwen API Key.");
        const cleanEndpoint = resolveOpenAiBaseUrl(activeConfig.endpoint, "https://dashscope-intl.aliyuncs.com/compatible-mode/v1");
        const timeoutSec = Math.max(5, activeConfig.timeout || 60);
        const res = await appHttpRequest(`${cleanEndpoint}/models`, {
          method: "GET",
          headers: { Authorization: `Bearer ${activeConfig.apiKey.trim()}` },
          timeoutSec,
        });
        if (!res.ok) throw new Error(`Alibaba Qwen HTTP ${res.status}: ${res.statusText}`);
        setTestConnectionStatus("success");
        setConnectionMessage("Kết nối Alibaba Qwen API thành công!");
      } else {
        // Custom Provider (OpenAI Compatible)
        if (!activeConfig.endpoint.trim()) throw new Error("Chưa nhập Endpoint URL.");
        const cleanEndpoint = resolveOpenAiBaseUrl(activeConfig.endpoint, activeConfig.endpoint.trim());
        const headers: Record<string, string> = {};
        if (activeConfig.apiKey.trim()) {
          headers["Authorization"] = `Bearer ${activeConfig.apiKey.trim()}`;
        }
        const timeoutSec = Math.max(5, activeConfig.timeout || 60);
        const res = await appHttpRequest(`${cleanEndpoint}/models`, { method: "GET", headers, timeoutSec });
        if (!res.ok) {
          throw new Error(`Máy chủ trả về HTTP ${res.status}: ${res.statusText}`);
        }
        const data = res.data;
        const count = Array.isArray(data?.data) ? data.data.length : undefined;
        setTestConnectionStatus("success");
        setConnectionMessage(count !== undefined ? `Kết nối thành công! Tìm thấy ${count} mô hình.` : "Kết nối thành công!");
      }
    } catch (err: any) {
      setTestConnectionStatus("failed");
      setConnectionMessage(err?.message || "Kiểm tra kết nối thất bại.");
    }
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
      <aside className="w-56 bg-panel border-r border-borderDefault p-3 space-y-1.5 flex-shrink-0 select-none overflow-y-auto">
        <div className="px-3 py-2 text-[10px] font-bold text-textMuted uppercase tracking-wider">
          Cài đặt
        </div>
        {groups.map((g) => {
          const isActive = activeGroup === g.id;
          return (
            <button
              key={g.id}
              type="button"
              data-nav-item="true"
              onClick={() => setActiveGroup(g.id)}
              className={`group relative w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left transition-all duration-150 cursor-pointer ${
                isActive
                  ? "bg-surface1 text-textPrimary font-semibold ring-1 ring-[#D2BFA4] dark:ring-amber-500/35 shadow-[inset_0_1px_0_#fff,0_2px_6px_-1px_rgba(36,24,12,0.08)] dark:shadow-[inset_0_1px_0_rgba(255,244,224,0.09),0_4px_10px_-2px_rgba(0,0,0,0.45)]"
                  : "text-textSecondary hover:bg-surface1/70 dark:hover:bg-surface2/50 hover:text-textPrimary"
              }`}
            >
              <span
                className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all duration-150 ${
                  isActive
                    ? "bg-gradient-to-b from-amber-400 via-amber-500 to-amber-600 text-white shadow-xs shadow-amber-600/30 ring-1 ring-inset ring-white/35"
                    : "text-textMuted group-hover:text-textPrimary group-hover:bg-surface2/80"
                }`}
              >
                {g.icon}
              </span>
              <span className={`text-xs truncate ${isActive ? "font-semibold" : "font-medium"}`}>
                {g.label}
              </span>
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
                  {displayedProviders.map((prov) => {
                    const isSelected = selectedProviderId === prov.id;
                    const displayName = prov.isCustom
                      ? providerConfigs[prov.id]?.name || prov.name
                      : prov.name;

                    return (
                      <div
                        key={prov.id}
                        data-provider-id={prov.id}
                        onClick={() => {
                          setSelectedProviderId(prov.id);
                          setTestConnectionStatus("idle");
                          setConnectionMessage("");
                        }}
                        className={`group relative p-3 rounded-xl border text-left transition-all flex flex-col justify-between gap-2 cursor-pointer select-none ${
                          isSelected
                            ? "bg-gradient-to-b from-amber-50/90 to-amber-100/60 dark:from-amber-500/18 dark:to-amber-600/10 border-accent shadow-xs ring-1 ring-accent/30 text-textPrimary"
                            : "bg-surface1 hover:bg-surface2/70 border-borderDefault text-textSecondary hover:text-textPrimary"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="font-semibold text-xs text-textPrimary truncate" title={displayName}>
                            {displayName}
                          </span>
                          <div className="flex items-center gap-1">
                            {prov.isCustom && (
                              <button
                                type="button"
                                title="Xóa nhà cung cấp này"
                                onClick={(e) => handleDeleteCustomProvider(prov.id, e)}
                                className="opacity-0 group-hover:opacity-100 hover:text-danger p-0.5 rounded transition-all text-textMuted cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {isSelected && (
                              <span className="w-4 h-4 rounded-full bg-accent text-white flex items-center justify-center shrink-0">
                                <Check className="w-2.5 h-2.5 stroke-[3]" />
                              </span>
                            )}
                          </div>
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
                      </div>
                    );
                  })}

                  {/* Button + Thêm API tùy chỉnh */}
                  <button
                    type="button"
                    onClick={handleAddCustomProvider}
                    className="p-3 rounded-xl border border-dashed border-accent/40 hover:border-accent bg-accent/5 hover:bg-accent/10 text-accent transition-all flex flex-col justify-between items-start gap-2 cursor-pointer select-none min-h-[72px]"
                  >
                    <div className="flex items-center gap-1.5 font-semibold text-xs text-accent">
                      <Plus className="w-4 h-4" />
                      <span>Thêm API tùy chỉnh</span>
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded w-fit border bg-surface2 text-textMuted border-borderDefault/60">
                      Không giới hạn
                    </span>
                  </button>
                </div>
              </div>

              {/* Minimalist Configuration Form */}
              <div className="p-4 sm:p-5 bg-surface1 rounded-xl border border-borderDefault space-y-4">
                <div className="flex items-center justify-between border-b border-borderDefault/70 pb-3">
                  <div className="flex items-center gap-2">
                    <Key className="w-4 h-4 text-accent" />
                    <h4 className="font-semibold text-xs text-textPrimary">
                      Cấu hình: {currentProvider.isCustom ? (activeConfig.name || currentProvider.name) : currentProvider.name}
                    </h4>
                  </div>
                  {currentProvider.isCustom && (
                    <button
                      type="button"
                      onClick={() => handleDeleteCustomProvider(currentProvider.id)}
                      className="flex items-center gap-1.5 px-2.5 py-1 text-danger hover:text-danger/90 hover:bg-danger/10 border border-danger/20 rounded-lg text-xs font-medium transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Xóa API này</span>
                    </button>
                  )}
                </div>

                <div className="space-y-3.5">
                  {/* Name field for custom provider */}
                  {currentProvider.isCustom && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-textPrimary block">
                        Tên nhà cung cấp / hiển thị
                      </label>
                      <input
                        type="text"
                        value={activeConfig.name || ""}
                        onChange={(e) => updateActiveConfig("name", e.target.value)}
                        placeholder="Ví dụ: OpenRouter, Groq, Together AI, vLLM Server..."
                        className="w-full bg-surface2 border border-borderDefault rounded-lg px-3 py-2 text-xs text-textPrimary placeholder:text-textMuted/60 focus:border-accent focus:outline-none"
                      />
                    </div>
                  )}

                  {/* Conditional API Key / Endpoint */}
                  {currentProvider.type === "proxy" ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-textPrimary block">Endpoint URL</label>
                        <input
                          type="text"
                          value={activeConfig.endpoint}
                          onChange={(e) => updateActiveConfig("endpoint", e.target.value)}
                          placeholder="https://api.openai.com/v1"
                          className="w-full bg-surface2 border border-borderDefault rounded-lg px-3 py-2 text-xs font-mono text-textPrimary placeholder:text-textMuted/60 focus:border-accent focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-textPrimary block">API Key (Tùy chọn)</label>
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
                  ) : currentProvider.id === "gemini" ? (
                    <div className="space-y-3" data-testid="gemini-key-pool-section">
                      {geminiKeySlots.map((slot, idx) => {
                        const isPrimary = slot.role === "primary" || idx === 0;
                        const labelText = isPrimary ? "API Key chính" : `API Key phụ ${idx}`;
                        const isVisible = Boolean(visibleGeminiKeyIds[slot.id]);
                        const isDuplicate = geminiDuplicateSlotIds.includes(slot.id);
                        const hasKeyText = slot.apiKey.trim().length > 0;
                        const slotStatusObj = geminiKeyStatuses[slot.id] || { status: "untested" as GeminiKeyHealthStatus };
                        const slotStatus = hasKeyText ? slotStatusObj.status : "untested";

                        return (
                          <div key={slot.id} className="space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <label className="text-xs font-medium text-textPrimary block">
                                {labelText}
                              </label>
                              {hasKeyText && !isDuplicate && (
                                <span
                                  title={slotStatusObj.message || ""}
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border ${
                                    slotStatus === "valid"
                                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                                      : slotStatus === "invalid"
                                      ? "bg-danger/10 text-danger border-danger/20"
                                      : slotStatus === "rate_limited" || slotStatus === "quota_exhausted"
                                      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                                      : "bg-surface2 text-textMuted border-borderDefault"
                                  }`}
                                >
                                  {slotStatus === "valid" && "Hợp lệ"}
                                  {slotStatus === "invalid" && "Không hợp lệ"}
                                  {(slotStatus === "rate_limited" || slotStatus === "quota_exhausted") &&
                                    "Đang bị giới hạn hoặc tạm thời không khả dụng"}
                                  {(slotStatus === "untested" || slotStatus === "testing") && "Chưa kiểm tra"}
                                </span>
                              )}
                              {isDuplicate && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                                  Khóa trùng lặp (không đưa vào danh sách hoạt động)
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-2">
                              <div className="relative flex-1 flex items-center">
                                <input
                                  type={isVisible ? "text" : "password"}
                                  value={slot.apiKey}
                                  onChange={(e) => handleChangeGeminiSlotValue(slot.id, e.target.value)}
                                  onBlur={handleBlurGeminiSlot}
                                  placeholder="AIzaSy..."
                                  className={`w-full bg-surface2 border rounded-lg px-3 py-2 pr-9 text-xs font-mono text-textPrimary placeholder:text-textMuted/60 focus:outline-none ${
                                    isDuplicate
                                      ? "border-amber-500/60 focus:border-amber-500"
                                      : "border-borderDefault focus:border-accent"
                                  }`}
                                />
                                <button
                                  type="button"
                                  title={isVisible ? "Ẩn khóa" : "Hiện khóa"}
                                  onClick={() => toggleGeminiSlotVisibility(slot.id)}
                                  className="absolute right-2.5 p-1 text-textMuted hover:text-textPrimary cursor-pointer"
                                >
                                  {isVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                </button>
                              </div>

                              {!isPrimary && (
                                <button
                                  type="button"
                                  title={`Xóa ${labelText}`}
                                  onClick={() => handleRemoveGeminiSecondaryKey(slot.id)}
                                  className="p-2 rounded-lg bg-surface2 hover:bg-danger/10 text-textMuted hover:text-danger border border-borderDefault hover:border-danger/30 transition-colors cursor-pointer shrink-0"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {geminiSaveError && (
                        <div className="text-[11px] text-danger bg-danger/10 border border-danger/20 rounded-md px-2.5 py-1.5">
                          {geminiSaveError}
                        </div>
                      )}

                      <div className="pt-0.5 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={handleAddGeminiSecondaryKey}
                          disabled={geminiKeySlots.length >= MAX_GEMINI_TOTAL_KEYS}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface2 hover:bg-surface3 border border-borderDefault text-xs font-medium text-accent hover:text-accent/90 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Thêm API Key</span>
                        </button>
                        <div className="flex items-center gap-3">
                          {geminiSaveState === "saving" && (
                            <span className="text-[11px] text-amber-500 font-medium">
                              Đang lưu...
                            </span>
                          )}
                          {geminiSaveState === "saved" && !geminiSaveError && (
                            <span className="text-[11px] text-success font-medium">
                              Đã lưu
                            </span>
                          )}
                          <span className="text-[11px] text-textMuted">
                            Đang hoạt động:{" "}
                            {
                              geminiKeySlots.filter(
                                (s) => s.apiKey.trim().length > 0 && !geminiDuplicateSlotIds.includes(s.id)
                              ).length
                            }{" "}
                            khóa
                          </span>
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
                            currentProvider.id === "openai"
                              ? "sk-proj-..."
                              : currentProvider.id === "claude"
                              ? "sk-ant-..."
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
                        <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium px-2.5 py-1 bg-emerald-500/10 rounded-md border border-emerald-500/20 max-w-md truncate">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{connectionMessage || "Hợp lệ"}</span>
                        </div>
                      )}

                      {testConnectionStatus === "failed" && (
                        <div className="flex items-center gap-1.5 text-xs text-danger font-medium px-2.5 py-1 bg-danger/10 rounded-md border border-danger/20 max-w-md truncate">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{connectionMessage || "Lỗi kết nối"}</span>
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
                      <span>{testConnectionStatus === "testing" ? "Đang kiểm tra..." : "Kiểm tra kết nối"}</span>
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
            <div className="space-y-4">
              {/* Thẻ 1: Thư mục mô hình AI */}
              <div className="p-5 bg-surface1 rounded-xl border border-borderDefault space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <label className="font-semibold text-xs text-textPrimary block">
                    Thư mục mô hình AI
                  </label>
                  <span className="font-mono text-xs text-accent font-semibold px-2 py-0.5 rounded bg-accent/10 border border-accent/20">
                    {(() => {
                      const totalMb = modelsList.reduce(
                        (sum, m) => sum + (m.installed && m.sizeOnDiskMb > 0 ? m.sizeOnDiskMb : 0),
                        0
                      );
                      return totalMb > 0 ? `${(totalMb / 1024).toFixed(2)} GB` : "0 MB";
                    })()}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                  <input
                    type="text"
                    readOnly
                    value={modelsDir}
                    placeholder="Đang tải đường dẫn..."
                    className="flex-1 min-w-[200px] bg-surface2/80 border border-borderDefault rounded-lg px-3 py-2 text-xs font-mono text-textPrimary select-none focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handlePickModelsDir}
                    className="px-3.5 py-2 bg-surface2 hover:bg-surface3 rounded-lg border border-borderDefault text-textSecondary hover:text-textPrimary text-xs font-medium transition-colors cursor-pointer shrink-0"
                  >
                    Chọn thư mục...
                  </button>
                  {modelsDir && (
                    <button
                      type="button"
                      onClick={() => showPathInFolder(modelsDir)}
                      title="Mở thư mục mô hình trên máy"
                      className="inline-flex items-center gap-1.5 px-3 py-2 bg-surface2 hover:bg-surface3 text-textSecondary hover:text-textPrimary rounded-lg border border-borderDefault text-xs font-medium transition-colors cursor-pointer shrink-0"
                    >
                      <FolderOpen className="w-3.5 h-3.5 text-accent shrink-0" />
                      <span>Mở thư mục</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Thẻ 2: Danh sách mô hình */}
              <div className="p-5 bg-surface1 rounded-xl border border-borderDefault space-y-3.5">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="font-semibold text-xs text-textPrimary">
                    Danh sách mô hình AI ({modelsList.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => handleScanModels()}
                    disabled={isScanningModels || Boolean(installingModelId)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-surface2 hover:bg-surface3 text-textSecondary hover:text-textPrimary rounded-lg border border-borderDefault text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${isScanningModels ? "animate-spin text-accent" : ""}`} />
                    <span>{isScanningModels ? "Đang quét..." : "Quét lại"}</span>
                  </button>
                </div>

                {modelInstallNotice && (
                  <div
                    className={`px-3.5 py-2.5 rounded-lg border text-xs flex items-start justify-between gap-2 ${
                      modelInstallNotice.type === "success"
                        ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-600 dark:text-emerald-400"
                        : modelInstallNotice.type === "error"
                        ? "bg-danger/10 border-danger/25 text-danger"
                        : "bg-surface2 border-borderDefault text-textSecondary"
                    }`}
                  >
                    <span className="leading-relaxed">{modelInstallNotice.message}</span>
                    <button
                      type="button"
                      onClick={() => setModelInstallNotice(null)}
                      className="p-0.5 hover:opacity-80 shrink-0 cursor-pointer"
                      aria-label="Đóng thông báo"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                <div className="border border-borderDefault rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-surface2 text-textMuted border-b border-borderDefault text-[11px]">
                      <tr>
                        <th className="p-2.5 font-medium">Tên mô hình</th>
                        <th className="p-2.5 font-medium">Loại</th>
                        <th className="p-2.5 font-medium">Dung lượng</th>
                        <th className="p-2.5 font-medium text-right">Trạng thái & Cài đặt</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-borderDefault">
                      {modelsList.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="p-4 text-center text-textMuted text-xs">
                            {isScanningModels ? "Đang quét mô hình..." : "Chưa tìm thấy danh sách mô hình."}
                          </td>
                        </tr>
                      ) : (
                        modelsList.map((m) => {
                          const isThisInstalling = installingModelId === m.id;
                          const isOtherInstalling = Boolean(installingModelId && installingModelId !== m.id);
                          const pct = isThisInstalling
                            ? Math.max(1, Math.min(100, Math.round(installProgress?.pct ?? 1)))
                            : 0;

                          return (
                            <React.Fragment key={m.id}>
                              <tr className="hover:bg-surface2/40">
                                <td className="p-2.5 font-medium text-textPrimary">
                                  <span>{m.displayName.replace(/\s*\(faster-whisper\)/i, "")}</span>
                                </td>
                                <td className="p-2.5 text-textMuted">
                                  {m.kind === "tts" ? "TTS / Voice Clone" : "Bóc băng & Hậu kiểm (ASR)"}
                                </td>
                                <td className="p-2.5 font-mono text-textMuted whitespace-nowrap">
                                  {m.sizeOnDiskMb > 0
                                    ? `${(m.sizeOnDiskMb / 1024).toFixed(2)} GB`
                                    : m.approxSizeMb >= 1000
                                    ? `~${(m.approxSizeMb / 1024).toFixed(1)} GB`
                                    : `~${m.approxSizeMb} MB`}
                                </td>
                                <td className="p-2.5 text-right whitespace-nowrap">
                                  {isThisInstalling ? (
                                    <div className="inline-flex items-center justify-end gap-2">
                                      <span className="inline-flex items-center justify-end gap-1.5 text-accent font-semibold font-mono">
                                        <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                                        <span>{pct}%</span>
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => handleCancelInstallModel(m.id)}
                                        className="px-2 py-1 rounded-md bg-danger/10 hover:bg-danger/20 text-danger border border-danger/25 text-[11px] font-medium transition-colors cursor-pointer"
                                      >
                                        Hủy
                                      </button>
                                    </div>
                                  ) : m.installed ? (
                                    <span className="inline-flex items-center justify-end gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
                                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                      <span>Đã cài đặt</span>
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => handleInstallModel(m)}
                                      disabled={isOtherInstalling}
                                      title={`Tải mô hình ${m.displayName}`}
                                      className="inline-flex items-center justify-end gap-1.5 px-2.5 py-1.5 rounded-lg bg-accent/15 hover:bg-accent text-accent hover:text-white border border-accent/30 text-xs font-semibold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                      <Download className="w-3.5 h-3.5 shrink-0" />
                                      <span>Tải mô hình</span>
                                    </button>
                                  )}
                                </td>
                              </tr>
                              {isThisInstalling && (
                                <tr className="bg-surface2/30">
                                  <td colSpan={4} className="px-3 py-2">
                                    <div className="space-y-1.5">
                                      <div className="flex items-center justify-between gap-2 text-[11px]">
                                        <span className="text-textSecondary truncate">
                                          {installProgress?.message || "Đang xử lý cài đặt..."}
                                        </span>
                                        <div className="inline-flex items-center gap-2 shrink-0">
                                          {installProgress?.speedMbps != null && installProgress.speedMbps > 0.05 && (
                                            <span className="px-1.5 py-0.5 rounded bg-accent/15 border border-accent/25 font-mono text-[10px] font-semibold text-accent">
                                              {installProgress.speedMbps.toFixed(1)} MB/s
                                            </span>
                                          )}
                                          <span className="font-mono text-accent font-semibold">
                                            {pct}%
                                          </span>
                                        </div>
                                      </div>
                                      <div className="w-full h-1.5 bg-surface3 rounded-full overflow-hidden">
                                        <div
                                          className="h-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-300 rounded-full"
                                          style={{ width: `${pct}%` }}
                                        />
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Thẻ 3: Thông số nâng cao TTS */}
              <AdvancedTtsSettingsPanel />
            </div>
          )}

          {/* ---------------------------------------------------------------- */}
          {/* TAB 3: CHUNG (Thẻ Thông tin, Lưu trữ, Phần cứng & AI)             */}
          {/* ---------------------------------------------------------------- */}
          {activeGroup === "general" && (
            <div className="space-y-4">
              {/* Thẻ 1: Thông tin & Bản quyền */}
              <div className="p-5 bg-surface1 rounded-xl border border-borderDefault space-y-3.5">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <img
                      src="/app-icon.png?v=2"
                      alt="VoxLab"
                      className="w-10 h-10 rounded-xl shadow-md shadow-accent/25 object-cover shrink-0 select-none"
                    />
                    <div className="font-bold text-base text-textPrimary tracking-tight">
                      VoxLab - V{currentAppVersion}
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={isCheckingUpdate}
                    onClick={() => void handleCheckForUpdates()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface2 hover:bg-surface3 text-accent rounded-lg border border-accent/30 text-xs font-medium transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isCheckingUpdate ? "animate-spin" : ""}`} />
                    <span>{isCheckingUpdate ? "Đang kiểm tra..." : "Kiểm tra cập nhật"}</span>
                  </button>
                </div>

                {/* Key bản quyền */}
                <div className="pt-3 border-t border-borderDefault/70 space-y-2">
                  <label className="font-semibold text-xs text-textPrimary block">
                    Key bản quyền
                  </label>

                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={licenseInfo ? licenseInfo.masked_key : "Chưa kích hoạt"}
                      placeholder="VOXLAB-****-****-XXXX"
                      className={`flex-1 bg-surface2/80 border rounded-lg px-3 py-2 text-xs font-mono text-textPrimary select-none focus:outline-none ${
                        licenseInfo && !licenseInfo.is_valid
                          ? "border-danger/60"
                          : "border-borderDefault"
                      }`}
                    />
                    <button
                      type="button"
                      onClick={handleReverifyLicense}
                      disabled={isVerifyingLicense}
                      title="Kiểm tra lại trạng thái bản quyền trực tuyến"
                      className="inline-flex items-center gap-1.5 px-3 py-2 bg-surface2 hover:bg-surface3 text-textSecondary hover:text-textPrimary border border-borderDefault font-medium rounded-lg text-xs transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${isVerifyingLicense ? "animate-spin text-accent" : ""}`}
                      />
                      <span>Kiểm tra</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsLicenseModalOpen(true)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-accent hover:bg-accent/90 text-white font-medium rounded-lg text-xs transition-colors cursor-pointer shadow-xs"
                    >
                      <Key className="w-3.5 h-3.5" />
                      <span>{licenseInfo?.is_valid ? "Đổi key" : "Nhập key"}</span>
                    </button>
                  </div>

                  {licenseInfo && !licenseInfo.is_valid ? (
                    <div className="flex items-center gap-1.5 text-xs text-danger pt-0.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        {licenseInfo.error_message || "Key bản quyền không hợp lệ hoặc chưa được kích hoạt."}
                      </span>
                    </div>
                  ) : (
                    <div className="text-xs text-textSecondary pt-0.5">
                      Thời hạn:{" "}
                      <strong className="text-textPrimary font-medium">
                        {licenseInfo?.expires_at_formatted || "N/A"}
                      </strong>
                    </div>
                  )}
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

              {/* Thẻ 2: Thư mục Cache */}
              <div className="p-5 bg-surface1 rounded-xl border border-borderDefault space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <label className="font-semibold text-xs text-textPrimary block">
                    Cache
                  </label>
                  <span className="font-mono text-xs text-accent font-semibold px-2 py-0.5 rounded bg-accent/10 border border-accent/20">
                    {storageStats.cacheSize}
                  </span>
                </div>

                <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                  <input
                    type="text"
                    readOnly
                    value={appDataRoot || "Đang tải đường dẫn..."}
                    className="flex-1 min-w-[200px] bg-surface2/80 border border-borderDefault rounded-lg px-3 py-2 text-xs font-mono text-textPrimary select-none focus:outline-none"
                  />
                  {appDataRoot && (
                    <button
                      type="button"
                      onClick={() => showPathInFolder(appDataRoot)}
                      title="Mở thư mục dữ liệu trên máy"
                      className="inline-flex items-center gap-1.5 px-3 py-2 bg-surface2 hover:bg-surface3 text-textSecondary hover:text-textPrimary rounded-lg border border-borderDefault text-xs font-medium transition-colors cursor-pointer shrink-0"
                    >
                      <FolderOpen className="w-3.5 h-3.5 text-accent shrink-0" />
                      <span>Mở thư mục</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setCleanActionPending("cache")}
                    disabled={activeCleaningTask !== null || storageStats.scratchBytes === 0}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-surface2 hover:bg-danger/15 text-textSecondary hover:text-danger rounded-lg border border-borderDefault hover:border-danger/30 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                  >
                    {activeCleaningTask === "cache" ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Đang dọn...</span>
                      </>
                    ) : storageStats.scratchBytes === 0 ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                        <span>Bộ nhớ tạm trống</span>
                      </>
                    ) : (
                      <>
                        <Trash2 className="w-3.5 h-3.5 shrink-0" />
                        <span>Dọn bộ nhớ tạm</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Thẻ 3: Phần Cứng & Hiệu suất xử lý */}
              <div className="p-5 bg-surface1 rounded-xl border border-borderDefault space-y-4">
                {/* Phần Cứng ở trên */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="font-semibold text-xs text-textPrimary">Phần Cứng</span>
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border ${
                          hardwareInfo.cudaAvailable
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                            : "bg-surface2 text-textSecondary border-borderDefault"
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            hardwareInfo.cudaAvailable ? "bg-emerald-500 animate-pulse" : "bg-textMuted"
                          }`}
                        />
                        {hardwareInfo.cudaAvailable ? "CUDA: Khả dụng" : "CUDA: Không khả dụng"}
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
                    <div className="p-3.5 bg-gradient-to-b from-surface2/50 to-surface2/90 dark:from-surface2/70 dark:to-surface2/40 rounded-xl border border-borderDefault shadow-[inset_0_1px_0_#fff] dark:shadow-[inset_0_1px_0_rgba(255,244,224,0.06)] space-y-1">
                      <span className="text-[10px] font-bold text-textMuted uppercase tracking-wider block">CPU</span>
                      <div className="text-xs font-semibold text-textPrimary truncate" title={hardwareInfo.cpu}>
                        {hardwareInfo.cpu}
                      </div>
                    </div>

                    {/* GPU */}
                    <div className="p-3.5 bg-gradient-to-b from-surface2/50 to-surface2/90 dark:from-surface2/70 dark:to-surface2/40 rounded-xl border border-borderDefault shadow-[inset_0_1px_0_#fff] dark:shadow-[inset_0_1px_0_rgba(255,244,224,0.06)] space-y-1">
                      <span className="text-[10px] font-bold text-textMuted uppercase tracking-wider block">GPU</span>
                      <div className="text-xs font-semibold text-textPrimary truncate" title={hardwareInfo.gpu}>
                        {hardwareInfo.gpu}
                      </div>
                    </div>

                    {/* RAM */}
                    <div className="p-3.5 bg-gradient-to-b from-surface2/50 to-surface2/90 dark:from-surface2/70 dark:to-surface2/40 rounded-xl border border-borderDefault shadow-[inset_0_1px_0_#fff] dark:shadow-[inset_0_1px_0_rgba(255,244,224,0.06)] space-y-1">
                      <span className="text-[10px] font-bold text-textMuted uppercase tracking-wider block">RAM</span>
                      <div className="text-xs font-semibold text-textPrimary">
                        {hardwareInfo.ram}
                      </div>
                    </div>

                    {/* VRAM */}
                    <div className="p-3.5 bg-gradient-to-b from-surface2/50 to-surface2/90 dark:from-surface2/70 dark:to-surface2/40 rounded-xl border border-borderDefault shadow-[inset_0_1px_0_#fff] dark:shadow-[inset_0_1px_0_rgba(255,244,224,0.06)] space-y-1">
                      <span className="text-[10px] font-bold text-textMuted uppercase tracking-wider block">VRAM</span>
                      <div className="text-xs font-semibold text-textPrimary">
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
                      onClick={() => handleDeviceChange("auto")}
                      className={`p-3.5 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                        aiExecutionDevice === "auto"
                          ? "bg-gradient-to-b from-amber-50/90 to-amber-100/60 dark:from-amber-500/18 dark:to-amber-600/10 border-accent text-accent ring-1 ring-accent/25 shadow-xs"
                          : "bg-surface1 hover:bg-surface2/70 border-borderDefault text-textSecondary shadow-2xs"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-xs text-textPrimary">Tự động</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-accent/15 border border-accent/25 text-accent font-semibold">
                          Khuyên dùng
                        </span>
                      </div>
                      <input
                        type="radio"
                        name="device"
                        checked={aiExecutionDevice === "auto"}
                        onChange={() => handleDeviceChange("auto")}
                        className="accent-accent"
                      />
                    </label>

                    {/* GPU */}
                    <label
                      onClick={() => handleDeviceChange("gpu")}
                      className={`p-3.5 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                        aiExecutionDevice === "gpu"
                          ? "bg-gradient-to-b from-amber-50/90 to-amber-100/60 dark:from-amber-500/18 dark:to-amber-600/10 border-accent text-accent ring-1 ring-accent/25 shadow-xs"
                          : "bg-surface1 hover:bg-surface2/70 border-borderDefault text-textSecondary shadow-2xs"
                      }`}
                    >
                      <span className="font-semibold text-xs text-textPrimary">GPU (CUDA)</span>
                      <input
                        type="radio"
                        name="device"
                        checked={aiExecutionDevice === "gpu"}
                        onChange={() => handleDeviceChange("gpu")}
                        className="accent-accent"
                      />
                    </label>

                    {/* CPU */}
                    <label
                      onClick={() => handleDeviceChange("cpu")}
                      className={`p-3.5 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                        aiExecutionDevice === "cpu"
                          ? "bg-gradient-to-b from-amber-50/90 to-amber-100/60 dark:from-amber-500/18 dark:to-amber-600/10 border-accent text-accent ring-1 ring-accent/25 shadow-xs"
                          : "bg-surface1 hover:bg-surface2/70 border-borderDefault text-textSecondary shadow-2xs"
                      }`}
                    >
                      <span className="font-semibold text-xs text-textPrimary">CPU</span>
                      <input
                        type="radio"
                        name="device"
                        checked={aiExecutionDevice === "cpu"}
                        onChange={() => handleDeviceChange("cpu")}
                        className="accent-accent"
                      />
                    </label>
                  </div>
                </div>
              </div>

              {/* Nút Đặt lại mặc định ở chân trang */}
              <div className="pt-1 flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => setIsResetConfirmOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-danger hover:bg-danger/10 border border-danger/30 rounded-lg text-xs font-medium transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Đặt lại mặc định</span>
                </button>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Storage Action Confirmation Modal */}
      {cleanActionPending === "cache" && (
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
                    Xác nhận dọn dẹp bộ nhớ tạm
                  </h3>
                  <p className="text-xs text-textMuted">
                    Giải phóng các tệp âm thanh tạm (scratch) sinh ra trong quá trình xử lý.
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
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-surface2 border border-borderDefault space-y-1.5">
                  <div className="font-semibold text-textPrimary flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 text-accent" />
                    <span>Dữ liệu sẽ dọn dẹp:</span>
                  </div>
                  <p className="text-textSecondary leading-relaxed">
                    Giải phóng <span className="font-mono font-semibold text-textPrimary">{storageStats.cacheSize}</span> bộ nhớ đệm audio tạm thời trong thư mục <code className="font-mono">scratch</code>.
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 space-y-1">
                  <div className="font-semibold flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5" />
                    <span>Bảo toàn an toàn:</span>
                  </div>
                  <p className="text-[11px] leading-relaxed">
                    Không xóa mô hình AI, cấu hình, giọng nhân bản, tệp nguồn hoặc kết quả đã xuất.
                  </p>
                </div>
              </div>
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
                onClick={() => void executeCleanAction("cache")}
                className="px-4 py-2 rounded-lg bg-danger hover:bg-danger/90 text-white font-medium text-xs transition-colors cursor-pointer shadow-xs"
              >
                Xác nhận dọn dẹp
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
                  <h3 className="font-bold text-sm text-textPrimary">Đặt lại cài đặt mặc định</h3>
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
                Hành động này sẽ khôi phục thiết bị xử lý AI (về Tự động) cùng các thông số Tốc độ, Cao độ, Âm lượng, Ngắt nghỉ và Tham số nâng cao của các tab về trạng thái chuẩn ban đầu.
              </p>
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 space-y-1">
                <div className="font-semibold flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" />
                  <span>Bảo toàn an toàn:</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  Giữ nguyên Key bản quyền, API Key dịch thuật, các mô hình AI đã tải, giọng nhân bản (Voice Clone) và lịch sử xuất file.
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
                onClick={() => void handleResetAllDefaultSettings()}
                className="px-4 py-2 rounded-lg bg-danger hover:bg-danger/90 text-white font-medium text-xs transition-colors cursor-pointer shadow-xs"
              >
                Đặt lại mặc định
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
        isInitialLaunch={!licenseInfo?.is_valid}
        mandatory={false}
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
