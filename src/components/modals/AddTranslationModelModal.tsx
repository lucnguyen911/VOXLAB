import React, { useState } from "react";
import { X, Sparkles, Server, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { translationManager } from "../../services/translation";
import { CustomTranslationModel } from "../../services/translation/types";

interface AddTranslationModelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newModel: CustomTranslationModel) => void;
}

export const AddTranslationModelModal: React.FC<AddTranslationModelModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [modelType, setModelType] = useState<"lmstudio" | "openai_compatible">("lmstudio");
  const [name, setName] = useState("LM Studio Local");
  const [endpoint, setEndpoint] = useState("http://localhost:1234/v1");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("qwen2.5-7b-instruct");

  // Connection testing state
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
    discoveredModels?: string[];
  } | null>(null);

  if (!isOpen) return null;

  const handleTypeChange = (newType: "lmstudio" | "openai_compatible") => {
    setModelType(newType);
    setTestResult(null);
    if (newType === "lmstudio") {
      setName("LM Studio Local");
      setEndpoint("http://localhost:1234/v1");
      setModel("qwen2.5-7b-instruct");
      setApiKey("");
    } else {
      setName("OpenAI Compatible Server");
      setEndpoint("http://localhost:8000/v1");
      setModel("gpt-3.5-turbo");
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const cleanEndpoint = endpoint.replace(/\/+$/, "");
      const res = await fetch(`${cleanEndpoint}/models`, {
        method: "GET",
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      });

      if (!res.ok) {
        setTestResult({
          ok: false,
          message: `Không thể kết nối tới model dịch (${res.status} ${res.statusText})`,
        });
        return;
      }

      const data = await res.json();
      const discovered: string[] = [];
      if (Array.isArray(data?.data)) {
        for (const m of data.data) {
          if (m?.id) discovered.push(m.id);
        }
      }

      if (discovered.length > 0 && !discovered.includes(model)) {
        setModel(discovered[0]);
      }

      setTestResult({
        ok: true,
        message: `Kết nối thành công! Tìm thấy ${discovered.length} model khả dụng.`,
        discoveredModels: discovered,
      });
    } catch (err: any) {
      setTestResult({
        ok: false,
        message: `Không thể kết nối tới model dịch tại ${endpoint}. Vui lòng kiểm tra server.`,
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    if (!name.trim() || !endpoint.trim() || !model.trim()) return;

    const saved = translationManager.addCustomModel({
      name: name.trim(),
      type: modelType,
      endpoint: endpoint.trim(),
      apiKey: apiKey.trim() || undefined,
      model: model.trim(),
    });

    onSuccess(saved);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-surface1 border border-borderDefault rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4 select-none">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-borderDefault">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-accent/15 text-accent flex items-center justify-center">
              <Server className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-textPrimary">Thêm model dịch</h3>
              <p className="text-[11px] text-textMuted">
                Kết nối máy chủ cục bộ hoặc API chuẩn OpenAI
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-textMuted hover:text-textPrimary rounded-md hover:bg-surface2 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Fields */}
        <div className="space-y-3 text-xs">
          {/* Loại */}
          <div className="space-y-1">
            <label className="font-semibold text-textSecondary block">Loại</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleTypeChange("lmstudio")}
                className={`py-2 px-3 rounded-lg border text-center font-medium transition-colors cursor-pointer ${
                  modelType === "lmstudio"
                    ? "bg-accent/15 border-accent text-accent font-semibold"
                    : "bg-surface2 border-borderDefault text-textSecondary hover:text-textPrimary"
                }`}
              >
                LM Studio (Local)
              </button>
              <button
                type="button"
                onClick={() => handleTypeChange("openai_compatible")}
                className={`py-2 px-3 rounded-lg border text-center font-medium transition-colors cursor-pointer ${
                  modelType === "openai_compatible"
                    ? "bg-accent/15 border-accent text-accent font-semibold"
                    : "bg-surface2 border-borderDefault text-textSecondary hover:text-textPrimary"
                }`}
              >
                OpenAI-compatible
              </button>
            </div>
          </div>

          {/* Tên hiển thị */}
          <div className="space-y-1">
            <label className="font-semibold text-textSecondary block">Tên hiển thị</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ví dụ: LM Studio Qwen 7B"
              className="w-full bg-surface2 border border-borderDefault rounded-lg px-3 py-2 text-xs text-textPrimary focus:border-accent focus:outline-none"
            />
          </div>

          {/* Endpoint */}
          <div className="space-y-1">
            <label className="font-semibold text-textSecondary block">Endpoint</label>
            <input
              type="text"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="http://localhost:1234/v1"
              className="w-full bg-surface2 border border-borderDefault rounded-lg px-3 py-2 text-xs font-mono text-textPrimary focus:border-accent focus:outline-none"
            />
          </div>

          {/* API Key */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="font-semibold text-textSecondary">API Key</label>
              <span className="text-[10px] text-textMuted">(Tùy chọn)</span>
            </div>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={modelType === "lmstudio" ? "Không bắt buộc đối với LM Studio" : "Bearer sk-..."}
              className="w-full bg-surface2 border border-borderDefault rounded-lg px-3 py-2 text-xs font-mono text-textPrimary focus:border-accent focus:outline-none"
            />
          </div>

          {/* Model */}
          <div className="space-y-1">
            <label className="font-semibold text-textSecondary block">Model</label>
            {testResult?.discoveredModels && testResult.discoveredModels.length > 0 ? (
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full bg-surface2 border border-borderDefault rounded-lg px-3 py-2 text-xs text-textPrimary focus:border-accent focus:outline-none cursor-pointer"
              >
                {testResult.discoveredModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Ví dụ: qwen2.5-7b-instruct hoặc gpt-3.5-turbo"
                className="w-full bg-surface2 border border-borderDefault rounded-lg px-3 py-2 text-xs text-textPrimary focus:border-accent focus:outline-none"
              />
            )}
          </div>

          {/* Connection Test Result */}
          {testResult && (
            <div
              className={`p-2.5 rounded-lg border flex items-start gap-2 text-xs ${
                testResult.ok
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                  : "bg-rose-500/10 border-rose-500/30 text-rose-400"
              }`}
            >
              {testResult.ok ? (
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              )}
              <span className="leading-tight">{testResult.message}</span>
            </div>
          )}

          {/* Action: Kiểm tra kết nối */}
          <div>
            <button
              type="button"
              disabled={testing || !endpoint.trim()}
              onClick={handleTestConnection}
              className="w-full flex items-center justify-center gap-1.5 py-2 px-3 bg-surface2 hover:bg-surface3 border border-borderDefault rounded-lg text-textPrimary font-semibold transition-colors cursor-pointer disabled:opacity-50"
            >
              {testing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                  <span>Đang kiểm tra kết nối...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 text-accent" />
                  <span>Kiểm tra kết nối</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Modal Actions */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-borderDefault">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-surface2 hover:bg-surface3 text-textSecondary hover:text-textPrimary rounded-lg text-xs font-semibold transition-colors cursor-pointer"
          >
            Hủy
          </button>
          <button
            type="button"
            disabled={!name.trim() || !endpoint.trim() || !model.trim()}
            onClick={handleSave}
            className="px-4 py-2 bg-accent hover:bg-accent/90 text-background rounded-lg text-xs font-bold shadow-sm transition-colors cursor-pointer disabled:opacity-50"
          >
            Lưu
          </button>
        </div>
      </div>
    </div>
  );
};
