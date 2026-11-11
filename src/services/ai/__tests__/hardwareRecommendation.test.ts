import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateRecommendedAsrModel,
  formatInstalledRamGb,
  HardwareProfile,
} from "../hardwareRecommendation";

describe("Hardware-based ASR Recommendation Suite", () => {
  it("recommends large-v3-turbo for strong GPU with >= 6GB VRAM (e.g. RTX 4060, 5070)", () => {
    const profile: HardwareProfile = {
      cudaAvailable: true,
      gpu: "NVIDIA GeForce RTX 5070 Ti",
      computeCapability: "12.0",
      vramTotalMb: 16275,
      ramTotalMb: 32768,
      cpuCores: 24,
    };
    const res = evaluateRecommendedAsrModel(profile);
    assert.equal(res.recommendedModel, "large-v3-turbo");
    assert.equal(res.tier, "strong");
    assert.match(res.reason, /Large-V3-Turbo/);
  });

  it("recommends medium for mid-range GPU with 3GB-6GB VRAM (e.g. GTX 1060, RTX 3050)", () => {
    const profile: HardwareProfile = {
      cudaAvailable: true,
      gpu: "NVIDIA GeForce RTX 3050 Laptop GPU",
      vramTotalMb: 4096,
      ramTotalMb: 16384,
      cpuCores: 8,
    };
    const res = evaluateRecommendedAsrModel(profile);
    assert.equal(res.recommendedModel, "medium");
    assert.equal(res.tier, "medium");
    assert.match(res.reason, /Medium/);
  });

  it("recommends small for low-end GPU with < 3GB VRAM", () => {
    const profile: HardwareProfile = {
      cudaAvailable: true,
      gpu: "NVIDIA GeForce MX250",
      vramTotalMb: 2048,
      ramTotalMb: 8192,
      cpuCores: 4,
    };
    const res = evaluateRecommendedAsrModel(profile);
    assert.equal(res.recommendedModel, "small");
    assert.equal(res.tier, "weak");
    assert.match(res.reason, /Small/);
  });

  it("recommends medium for CPU-only machine with >= 8 cores and >= 16GB RAM", () => {
    const profile: HardwareProfile = {
      cudaAvailable: false,
      cpu: "AMD Ryzen 7 5800X",
      cpuCores: 16,
      ramTotalMb: 32768,
    };
    const res = evaluateRecommendedAsrModel(profile);
    assert.equal(res.recommendedModel, "medium");
    assert.equal(res.tier, "medium");
  });

  it("recommends small for CPU-only machine with < 8 cores or < 16GB RAM", () => {
    const profile: HardwareProfile = {
      cudaAvailable: false,
      cpu: "Intel Core i5-8250U",
      cpuCores: 4,
      ramTotalMb: 8192,
    };
    const res = evaluateRecommendedAsrModel(profile);
    assert.equal(res.recommendedModel, "small");
    assert.equal(res.tier, "weak");
    assert.match(res.reason, /Small/);
  });

  it("handles boundary values correctly at 6000MB and 3000MB VRAM", () => {
    const boundaryStrong: HardwareProfile = {
      cudaAvailable: true,
      vramTotalMb: 6000,
    };
    assert.equal(evaluateRecommendedAsrModel(boundaryStrong).recommendedModel, "large-v3-turbo");

    const boundaryMedium: HardwareProfile = {
      cudaAvailable: true,
      vramTotalMb: 5999,
    };
    assert.equal(evaluateRecommendedAsrModel(boundaryMedium).recommendedModel, "medium");

    const boundaryLow: HardwareProfile = {
      cudaAvailable: true,
      vramTotalMb: 2999,
    };
    assert.equal(evaluateRecommendedAsrModel(boundaryLow).recommendedModel, "small");
  });

  it("normalizes OS usable RAM (after BIOS/iGPU/NPU Hardware Reserved) to physical installed RAM GB", () => {
    assert.equal(formatInstalledRamGb(32768), 32);
    assert.equal(formatInstalledRamGb(31850), 32); // 31.1 GB usable on 32 GB Intel Core Ultra PC
    assert.equal(formatInstalledRamGb(15900), 16); // 15.5 GB usable on 16 GB PC
    assert.equal(formatInstalledRamGb(7900), 8);   // 7.7 GB usable on 8 GB PC
    assert.equal(formatInstalledRamGb(65536), 64);
  });
});
