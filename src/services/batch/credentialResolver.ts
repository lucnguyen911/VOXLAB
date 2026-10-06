/**
 * Credential Resolver for Batch Workspace (TASK-06 / AC-SET-03)
 *
 * Safely resolves third-party AI provider API keys and endpoints at runtime from Settings storage.
 * Guarantees Zero Credential Leakage:
 * - Credentials are used purely in memory at execution call time.
 * - NEVER persists or serializes raw credentials into effectiveConfigSnapshot or batch_queue_v3.json.
 */

import { loadTranslationSettings } from "../translation/settings";

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
          return {
            apiKey: configs[providerId].apiKey || undefined,
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
    if (providerId === "gemini" && translationSettings.geminiApiKey) {
      return { apiKey: translationSettings.geminiApiKey };
    }
    if (providerId === "deepseek" && translationSettings.deepseekApiKey) {
      return { apiKey: translationSettings.deepseekApiKey };
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
