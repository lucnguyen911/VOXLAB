/**
 * Hardware Evaluation and ASR Model Recommendation Service.
 * Evaluates real GPU/VRAM, CPU, and RAM metrics returned from sidecar system.info.
 *
 * Rules:
 * - Strong machine (CUDA GPU with VRAM >= 6GB): Recommend 'large-v3-turbo'.
 * - Medium machine (CUDA GPU with VRAM 3-6GB, or CPU >= 8 cores and RAM >= 16GB): Recommend 'medium'.
 * - Weak machine (GPU < 3GB VRAM, or CPU-only with < 8 cores or < 16GB RAM): Recommend 'small'.
 * - Preserves manual selections; only determines the dynamic 'Khuyên dùng' recommendation.
 */

export type WhisperModelId = "large-v3-turbo" | "large-v3" | "medium" | "small";

export interface HardwareProfile {
  cudaAvailable: boolean;
  gpu?: string;
  computeCapability?: string;
  vramTotalMb?: number;
  vramFreeMb?: number;
  ramTotalMb?: number;
  ramFreeMb?: number;
  cpu?: string;
  cpuCores?: number;
  isEstimated?: boolean;
}

export interface RecommendationResult {
  recommendedModel: WhisperModelId;
  reason: string;
  tier: "strong" | "medium" | "weak";
}

const STANDARD_RAM_TIERS_GB = [4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256] as const;

/**
 * Normalizes reported RAM in MB into physical installed RAM in GB.
 * Even when OS APIs report usable RAM (after ~0.4–1.4 GB BIOS/iGPU/NPU Hardware Reserved),
 * snaps cleanly to the matching physical DDR tier (e.g. 31.1 GB usable -> 32 GB).
 */
export function formatInstalledRamGb(ramTotalMb: number): number {
  if (!Number.isFinite(ramTotalMb) || ramTotalMb <= 0) {
    return 0;
  }
  const rawGb = ramTotalMb / 1024;
  for (const tier of STANDARD_RAM_TIERS_GB) {
    const maxReservedGb = tier >= 16 ? 1.5 : 1.0;
    if (rawGb >= tier - maxReservedGb && rawGb <= tier + 0.25) {
      return tier;
    }
  }
  return Math.max(1, Math.round(rawGb));
}

/**
 * Evaluates hardware profile and determines recommended ASR model.
 * Deterministic and purely functional for robust unit testing.
 */
export function evaluateRecommendedAsrModel(profile: HardwareProfile): RecommendationResult {
  // 1. CUDA GPU evaluation
  if (profile.cudaAvailable && typeof profile.vramTotalMb === "number" && profile.vramTotalMb > 0) {
    // Strong GPU: >= 6GB VRAM (6000 MB)
    if (profile.vramTotalMb >= 6000) {
      const vramGb = Math.round(profile.vramTotalMb / 1024);
      return {
        recommendedModel: "large-v3-turbo",
        reason: `GPU ${profile.gpu || "NVIDIA CUDA"} (${vramGb} GB VRAM) có đủ tài nguyên chạy Large-V3-Turbo tốc độ cao.`,
        tier: "strong",
      };
    }

    // Medium GPU: 3GB <= VRAM < 6GB
    if (profile.vramTotalMb >= 3000) {
      const vramGb = Math.round(profile.vramTotalMb / 1024);
      return {
        recommendedModel: "medium",
        reason: `GPU ${profile.gpu || "NVIDIA CUDA"} (${vramGb} GB VRAM) tối ưu với Medium để tránh tràn VRAM khi chạy cùng TTS.`,
        tier: "medium",
      };
    }

    // Low VRAM GPU: < 3GB
    const vramGb = Math.round(profile.vramTotalMb / 1024);
    return {
      recommendedModel: "small",
      reason: `GPU có VRAM giới hạn (${vramGb} GB), khuyên dùng Small để đảm bảo hoạt động ổn định.`,
      tier: "weak",
    };
  }

  // 2. CPU-only evaluation
  const cores = profile.cpuCores || 4;
  const ramMb = profile.ramTotalMb || 8192;
  const ramGb = formatInstalledRamGb(ramMb);

  // Good multi-core CPU with >= 16GB RAM
  if (cores >= 8 && ramMb >= 15000) {
    return {
      recommendedModel: "medium",
      reason: `Máy chạy CPU ${profile.cpu || `${cores} cores`} (${ramGb} GB RAM), phù hợp với Medium trên CPU.`,
      tier: "medium",
    };
  }

  // Resource-constrained CPU machine
  return {
    recommendedModel: "small",
    reason: `Máy chạy CPU hoặc cấu hình hạn chế (${cores} cores, ${ramGb} GB RAM), khuyên dùng Small để tiết kiệm tài nguyên.`,
    tier: "weak",
  };
}

let cachedHardwareProfile: HardwareProfile | null = null;

/**
 * Queries the real hardware profile via sidecar system.info.
 * Caches the profile in memory.
 */
export async function queryHardwareProfile(forceRefresh = false): Promise<HardwareProfile> {
  if (cachedHardwareProfile && !forceRefresh) {
    return cachedHardwareProfile;
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const info = await invoke<any>("ai_request", {
      runtime: "core",
      method: "system.info",
      params: {},
    });

    if (info && typeof info === "object") {
      cachedHardwareProfile = {
        cudaAvailable: Boolean(info.cudaAvailable),
        gpu: typeof info.gpu === "string" ? info.gpu : undefined,
        computeCapability: typeof info.computeCapability === "string" ? info.computeCapability : undefined,
        vramTotalMb: typeof info.vramTotalMb === "number" ? info.vramTotalMb : undefined,
        vramFreeMb: typeof info.vramFreeMb === "number" ? info.vramFreeMb : undefined,
        ramTotalMb: typeof info.ramTotalMb === "number" ? info.ramTotalMb : undefined,
        ramFreeMb: typeof info.ramFreeMb === "number" ? info.ramFreeMb : undefined,
        cpu: typeof info.cpu === "string" ? info.cpu : undefined,
        cpuCores: typeof info.cpuCores === "number" ? info.cpuCores : undefined,
        isEstimated: false,
      };
      return cachedHardwareProfile;
    }
  } catch (e) {
    console.warn("[HardwareRecommendation] Could not query system.info from sidecar:", e);
  }

  // Safe fallback when sidecar is offline or in web mock
  const fallback: HardwareProfile = {
    cudaAvailable: true,
    vramTotalMb: 8192,
    cpuCores: 8,
    ramTotalMb: 16384,
    isEstimated: true,
  };
  return fallback;
}

export function getCachedHardwareProfile(): HardwareProfile | null {
  return cachedHardwareProfile;
}

export function setCachedHardwareProfile(profile: HardwareProfile | null): void {
  cachedHardwareProfile = profile;
}
