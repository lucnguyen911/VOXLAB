/**
 * Credential Resolver for Batch Workspace (TASK-06 / AC-SET-03)
 *
 * Safely resolves third-party AI provider API keys and endpoints at runtime from Settings storage.
 * Guarantees Zero Credential Leakage:
 * - Credentials are used purely in memory at execution call time.
 * - NEVER persists or serializes raw credentials into effectiveConfigSnapshot or batch_queue_v3.json.
 */

import { loadTranslationSettings } from "../translation/settings";
import {
  ensureGeminiKeyStoreInitialized,
  flushPendingGeminiKeyWrites,
  getPrimaryGeminiApiKeySync,
} from "../translation/geminiKeyStore";

export interface ProviderCredentials {
  apiKey?: string;
  endpoint?: string;
  model?: string;
}

export class CredentialResolver {
  /**
   * Asynchronously ensures encrypted vaults (such as the Gemini key vault) are initialized
   * before resolving runtime credentials.
   */
  static async getProviderCredentialsAsync(providerId: string): Promise<ProviderCredentials> {
    if (providerId === "gemini") {
      await flushPendingGeminiKeyWrites();
      await ensureGeminiKeyStoreInitialized();
    }
    return this.getProviderCredentials(providerId);
  }

  /**
   * Resolves runtime credentials for a translation or AI provider.
   * Checks encrypted key store (for Gemini) and provider configuration in localStorage
   * with fallback to translation settings.
   */
  static getProviderCredentials(providerId: string): ProviderCredentials {
    if (providerId === "gemini") {
      const vaultKey = getPrimaryGeminiApiKeySync();
      let model: string | undefined;
      let endpoint: string | undefined;
      let fallbackKey: string | undefined;

      if (typeof localStorage !== "undefined") {
        try {
          const raw = localStorage.getItem("voxlab_provider_configs_v4");
          if (raw) {
            const configs = JSON.parse(raw);
            if (configs && configs.gemini) {
              model = configs.gemini.model || undefined;
              endpoint = configs.gemini.endpoint || undefined;
              fallbackKey = configs.gemini.apiKey || undefined;
            }
          }
        } catch {
          // ignore
        }
      }

      const translationSettings = loadTranslationSettings();
      const resolvedApiKey = vaultKey || fallbackKey || translationSettings.geminiApiKey || undefined;
      return {
        apiKey: resolvedApiKey,
        endpoint,
        model,
      };
    }

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
    if (providerId === "deepseek" && translationSettings.deepseekApiKey) {
      return { apiKey: translationSettings.deepseekApiKey };
    }
    if (providerId === "claude") {
      const claudeKey =
        typeof localStorage !== "undefined"
          ? localStorage.getItem("voxlab_claude_api_key") || ""
          : "";
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

  /**
   * Asynchronously retrieves the raw API key after ensuring the encrypted vault is initialized.
   */
  static async getApiKeyAsync(providerId: string): Promise<string | undefined> {
    const creds = await this.getProviderCredentialsAsync(providerId);
    return creds.apiKey;
  }
}
