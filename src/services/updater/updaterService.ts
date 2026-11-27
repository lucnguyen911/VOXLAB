export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  isForced: boolean;
  downloadUrl?: string | null;
  changelog?: string | null;
  sha256?: string | null;
  fileSize?: number | null;
  publishedAt?: string | null;
}

export interface AppUpdateProgressEvent {
  stage: "downloading" | "verifying" | "launching" | "error";
  pct: number;
  downloadedMb: number;
  totalMb: number;
  speedMbps: number;
  message: string;
}

export const OPEN_APP_UPDATE_MODAL_EVENT = "voxlab_open_app_update_modal";

export function triggerAppUpdateModal(info: UpdateCheckResult): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<UpdateCheckResult>(OPEN_APP_UPDATE_MODAL_EVENT, { detail: info }));
  }
}

export async function checkAppUpdate(): Promise<UpdateCheckResult> {
  if (typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__) {
    return {
      currentVersion: "1.0.7",
      latestVersion: "1.0.7",
      updateAvailable: false,
      isForced: false,
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<UpdateCheckResult>("check_app_update");
}

export async function downloadAndInstallUpdate(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke<void>("download_and_install_update");
}

export async function cancelAppUpdateDownload(): Promise<boolean> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<boolean>("cancel_app_update_download");
  } catch {
    return false;
  }
}

export async function onAppUpdateProgress(
  handler: (event: AppUpdateProgressEvent) => void
): Promise<() => void> {
  if (typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__) {
    return () => {};
  }
  const { listen } = await import("@tauri-apps/api/event");
  return await listen<AppUpdateProgressEvent>("app://update-progress", (ev) => {
    if (ev && ev.payload) {
      handler(ev.payload);
    }
  });
}
