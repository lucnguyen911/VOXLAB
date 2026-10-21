/**
 * Credential Resolver for Batch Workspace (TASK-06 / AC-SET-03)
 *
 * Safely resolves third-party AI provider API keys and endpoints at runtime from Settings storage.
 * Guarantees Zero Credential Leakage:
 * - Credentials are used purely in memory at execution call time.
 * - NEVER persists or serializes raw credentials into effectiveConfigSnapshot or batch_queue_v3.json.
 */

import { loadTranslationSettings } from "../translation/settings";
import { getPrimaryGeminiApiKeySync } from "../translation/geminiKeyStore";

export interface ProviderCredentials {
  apiKey?: string;
  endpoint?: string;
  model?: string;
}

export class CredentialResolver {
  /**
   * Resolves runtime credentials for a translation or AI provider.
   * Checks provider configuration in localStorage with fallback to translation settings.
   */
  static getProviderCredentials(providerId: string): ProviderCredentials {
    if (typeof localStorage === "undefined") {
      return {};
    }

    try {
      const raw = localStorage.getItem("voxlab_provider_configs_v4");
      if (raw) {
        const configs = JSON.parse(raw);
        if (configs && configs[providerId]) {
          const resolvedApiKey =
            providerId === "gemini"
              ? getPrimaryGeminiApiKeySync() || configs[providerId].apiKey || undefined
              : configs[providerId].apiKey || undefined;
          return {
            apiKey: resolvedApiKey,
            endpoint: configs[providerId].endpoint || undefined,
            model: configs[providerId].model || undefined,
          };
        }
      }
    } catch {
      // Fallback
    }

    // Fallback to translation settings
    const translationSettings = loadTranslationSettings();
    if (providerId === "gemini") {
      const geminiKey = getPrimaryGeminiApiKeySync() || translationSettings.geminiApiKey;
      if (geminiKey) {
        return { apiKey: geminiKey };
      }
    }
    if (providerId === "deepseek" && translationSettings.deepseekApiKey) {
      return { apiKey: translationSettings.deepseekApiKey };
    }
    if (providerId === "claude") {
      const claudeKey = typeof localStorage !== "undefined" ? localStorage.getItem("voxlab_claude_api_key") || "" : "";
      if (claudeKey) return { apiKey: claudeKey };
    }
    const customModel = translationSettings.customModels?.find((m) => m.id === providerId);
    if (customModel) {
      return {
        apiKey: customModel.apiKey || undefined,
        endpoint: customModel.endpoint || undefined,
        model: customModel.model || undefined,
      };
    }

    return {};
  }

  /**
   * Retrieves the raw API key for a provider if configured.
   */
  static getApiKey(providerId: string): string | undefined {
    return this.getProviderCredentials(providerId).apiKey;
  }
}
