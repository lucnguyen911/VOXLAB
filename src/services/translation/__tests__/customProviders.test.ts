import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  loadTranslationSettings,
  saveTranslationSettings,
  TranslationManager,
  CustomTranslationModel,
  resolveOpenAiBaseUrl,
} from "../index";
import { OpenAiTtsProvider } from "../../providers/openaiProvider";

describe("Custom Translation Providers & Runtime Settings Sync Suite", () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    (globalThis as any).localStorage = {
      getItem: (k: string) => mockStorage[k] || null,
      setItem: (k: string, v: string) => {
        mockStorage[k] = String(v);
      },
      removeItem: (k: string) => {
        delete mockStorage[k];
      },
    };
  });

  it("allows adding unlimited custom AI providers to translation settings", () => {
    const customList: CustomTranslationModel[] = [
      {
        id: "custom_openrouter",
        name: "OpenRouter Llama 3.3",
        type: "openai_compatible",
        endpoint: "https://openrouter.ai/api/v1",
        apiKey: "sk-or-test1",
        model: "meta-llama/llama-3.3-70b-instruct",
        timeout: 45,
        maxTokens: 8192,
        createdAt: 1001,
      },
      {
        id: "custom_groq",
        name: "Groq Fast",
        type: "openai_compatible",
        endpoint: "https://api.groq.com/openai/v1",
        apiKey: "gsk-test2",
        model: "llama-3.3-70b-versatile",
        createdAt: 1002,
      },
      {
        id: "custom_vllm",
        name: "Local vLLM Server",
        type: "openai_compatible",
        endpoint: "http://192.168.1.100:8000/v1",
        model: "Qwen/Qwen2.5-72B-Instruct",
        createdAt: 1003,
      },
    ];

    saveTranslationSettings({ customModels: customList });

    const loaded = loadTranslationSettings();
    assert.equal(loaded.customModels.length, 3);
    assert.equal(loaded.customModels[0].name, "OpenRouter Llama 3.3");
    assert.equal(loaded.customModels[1].endpoint, "https://api.groq.com/openai/v1");
    assert.equal(loaded.customModels[2].model, "Qwen/Qwen2.5-72B-Instruct");
  });

  it("exposes custom providers dynamically via TranslationManager.listProviders()", () => {
    const customList: CustomTranslationModel[] = [
      {
        id: "custom_openrouter",
        name: "OpenRouter Llama 3.3",
        type: "openai_compatible",
        endpoint: "https://openrouter.ai/api/v1",
        apiKey: "sk-or-test1",
        model: "meta-llama/llama-3.3-70b-instruct",
        timeout: 90,
        maxTokens: 16384,
        createdAt: 1001,
      },
    ];

    saveTranslationSettings({ customModels: customList });

    const manager = TranslationManager.getInstance();
    const providers = manager.listProviders();

    const openRouter = providers.find((p) => p.id === "custom_openrouter");
    assert.ok(openRouter, "Custom provider should be in provider list");
    assert.equal(openRouter.displayName, "OpenRouter Llama 3.3");
    assert.equal(openRouter.endpoint, "https://openrouter.ai/api/v1");
    assert.equal(openRouter.timeout, 90);
    assert.equal(openRouter.maxTokens, 16384);
  });

  it("normalizes OpenAI-compatible base URLs with resolveOpenAiBaseUrl", () => {
    assert.equal(
      resolveOpenAiBaseUrl("http://127.0.0.1:1234", "http://localhost:1234/v1"),
      "http://127.0.0.1:1234/v1"
    );
    assert.equal(
      resolveOpenAiBaseUrl("http://127.0.0.1:1234/", "http://localhost:1234/v1"),
      "http://127.0.0.1:1234/v1"
    );
    assert.equal(
      resolveOpenAiBaseUrl("http://127.0.0.1:1234/v1/", "http://localhost:1234/v1"),
      "http://127.0.0.1:1234/v1"
    );
    assert.equal(
      resolveOpenAiBaseUrl("https://dashscope-intl.aliyuncs.com/compatible-mode/v1", "http://localhost:1234/v1"),
      "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
    );
  });

  it("synchronizes all built-in providers with voxlab_provider_configs_v4 from Settings", () => {
    mockStorage["voxlab_provider_configs_v4"] = JSON.stringify({
      gemini: {
        apiKey: "AIza-gemini-test-key",
        model: "gemini-2.5-pro",
        timeout: 45,
        maxTokens: 8192,
      },
      openai: {
        apiKey: "sk-openai-test-key",
        endpoint: "https://api.openai.com/v1",
        model: "gpt-4o",
        timeout: 50,
        maxTokens: 4096,
      },
      deepseek: {
        apiKey: "sk-deepseek-test-key",
        endpoint: "https://api.deepseek.com",
        model: "deepseek-reasoner",
        timeout: 60,
        maxTokens: 4096,
      },
      qwen: {
        apiKey: "sk-qwen-test-key",
        endpoint: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        model: "qwen-max",
        timeout: 40,
        maxTokens: 4096,
      },
      ollama: {
        endpoint: "http://127.0.0.1:11434",
        model: "qwen2.5:14b",
        timeout: 120,
        maxTokens: 8192,
      },
      lmstudio: {
        apiKey: "lm-studio",
        endpoint: "http://127.0.0.1:1234",
        model: "gemma-4-12b-qat",
        timeout: 60,
        maxTokens: 8192,
      },
    });

    const manager = TranslationManager.getInstance();
    const gemini = manager.getProvider("gemini") as any;
    const openai = manager.getProvider("openai") as any;
    const deepseek = manager.getProvider("deepseek") as any;
    const qwen = manager.getProvider("qwen") as any;
    const ollama = manager.getProvider("ollama") as any;
    const lmstudio = manager.getProvider("lmstudio") as any;

    assert.equal(gemini.apiKey, "AIza-gemini-test-key");
    assert.equal(gemini.model, "gemini-2.5-pro");
    assert.equal(gemini.timeout, 45);
    assert.equal(gemini.maxTokens, 8192);

    assert.equal(openai.apiKey, "sk-openai-test-key");
    assert.equal(openai.model, "gpt-4o");

    assert.equal(deepseek.apiKey, "sk-deepseek-test-key");
    assert.equal(deepseek.model, "deepseek-reasoner");

    assert.equal(qwen.apiKey, "sk-qwen-test-key");
    assert.equal(qwen.model, "qwen-max");

    assert.equal(ollama.endpoint, "http://127.0.0.1:11434");
    assert.equal(ollama.model, "qwen2.5:14b");

    assert.equal(lmstudio.endpoint, "http://127.0.0.1:1234");
    assert.equal(lmstudio.model, "gemma-4-12b-qat");
    assert.equal(lmstudio.maxTokens, 8192);
  });

  it("wires OpenAiTtsProvider to voxlab_provider_configs_v4.openai.apiKey", async () => {
    const tts = new OpenAiTtsProvider();
    let voices = await tts.listVoices();
    assert.equal(voices[0].availability, "not_configured");

    mockStorage["voxlab_provider_configs_v4"] = JSON.stringify({
      openai: { apiKey: "sk-proj-openai-tts-test" },
    });

    voices = await tts.listVoices();
    assert.equal(voices[0].availability, "available");
  });

  it("deletes a custom provider and updates provider list", () => {
    const customList: CustomTranslationModel[] = [
      {
        id: "custom_temp",
        name: "Temp Provider",
        type: "openai_compatible",
        endpoint: "http://localhost:8000/v1",
        model: "temp-model",
        createdAt: 1001,
      },
    ];

    saveTranslationSettings({ customModels: customList });
    const manager = TranslationManager.getInstance();

    manager.deleteCustomModel("custom_temp");

    const loaded = loadTranslationSettings();
    assert.equal(loaded.customModels.length, 0);

    const providers = manager.listProviders();
    assert.equal(providers.some((p) => p.id === "custom_temp"), false);
  });
});

