import { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw, Copy, Check } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    copied: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an unhandled error:", error, errorInfo);
    this.setState({ errorInfo });
    try {
      localStorage.setItem(
        "voxlab_last_error",
        JSON.stringify({
          message: error.message,
          stack: error.stack,
          componentStack: errorInfo.componentStack,
          time: new Date().toISOString(),
        })
      );
    } catch {
      // ignore
    }
  }

  private handleReload = () => {
    try {
      localStorage.removeItem("voxlab_tts_stage");
    } catch {
      // ignore
    }
    window.location.reload();
  };

  private handleCopy = () => {
    const { error, errorInfo } = this.state;
    const text = `Error: ${error?.message}\n\nStack:\n${error?.stack}\n\nComponent Stack:\n${errorInfo?.componentStack}`;
    navigator.clipboard.writeText(text);
    this.setState({ copied: true });
    setTimeout(() => this.setState({ copied: false }), 2000);
  };

  public render() {
    if (this.state.hasError) {
      const { error, errorInfo, copied } = this.state;
      return (
        <div className="h-screen w-screen flex flex-col items-center justify-center bg-[#0f172a] text-white p-6 font-sans select-text">
          <div className="max-w-2xl w-full bg-[#1e293b] border border-red-500/30 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-red-400">
              <AlertTriangle className="w-8 h-8 flex-shrink-0 animate-bounce" />
              <div>
                <h1 className="text-lg font-bold text-red-300">Đã xảy ra lỗi giao diện trong VoxLab</h1>
                <p className="text-xs text-slate-400">Hệ thống đã bắt được lỗi này để ngăn màn hình trắng.</p>
              </div>
            </div>

            <div className="bg-[#0b1120] border border-slate-700/60 rounded-xl p-4 space-y-2 overflow-hidden">
              <div className="text-xs font-mono text-red-300 font-semibold break-words">
                {error?.name}: {error?.message}
              </div>
              {error?.stack && (
                <pre className="text-[11px] font-mono text-slate-400 max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed select-text p-1">
                  {error.stack}
                </pre>
              )}
              {errorInfo?.componentStack && (
                <details className="text-[11px] font-mono text-slate-500 pt-2 border-t border-slate-800">
                  <summary className="cursor-pointer hover:text-slate-300">Chi tiết Component Stack</summary>
                  <pre className="mt-2 whitespace-pre-wrap max-h-36 overflow-y-auto text-slate-400">
                    {errorInfo.componentStack}
                  </pre>
                </details>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={this.handleCopy}
                className="flex items-center gap-2 px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-medium text-slate-200 transition-colors cursor-pointer"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                <span>{copied ? "Đã sao chép" : "Sao chép mã lỗi"}</span>
              </button>

              <button
                type="button"
                onClick={this.handleReload}
                className="flex items-center gap-2 px-4 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-lg text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Khôi phục & Tải lại</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
