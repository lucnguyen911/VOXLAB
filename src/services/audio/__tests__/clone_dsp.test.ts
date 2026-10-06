import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeAudioQuality,
  extractWaveformPeaks,
  extractMinMaxPeaks,
  formatAudioTime,
  formatAudioTimeWithSubseconds,
} from "../audioDsp";

// Helper to create a mock AudioBuffer for headless/Node testing
function createMockAudioBuffer(
  durationSec: number,
  sampleRate: number = 44100,
  numberOfChannels: number = 1,
  fillFn?: (sampleIndex: number, totalSamples: number) => number
): AudioBuffer {
  const length = Math.floor(durationSec * sampleRate);
  const channelData = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    channelData[i] = fillFn ? fillFn(i, length) : Math.sin((i / sampleRate) * 440 * 2 * Math.PI) * 0.5;
  }

  return {
    length,
    duration: durationSec,
    sampleRate,
    numberOfChannels,
    getChannelData: (_ch: number) => channelData,
    copyFromChannel: () => {},
    copyToChannel: () => {},
  } as unknown as AudioBuffer;
}

test("DSP: formatAudioTime formats standard time formats", () => {
  assert.equal(formatAudioTime(0), "00:00");
  assert.equal(formatAudioTime(7), "00:07");
  assert.equal(formatAudioTime(65), "01:05");
  assert.equal(formatAudioTime(125), "02:05");
});

test("DSP: Quality Check detects too short audio (<3s) as poor/error", () => {
  const shortBuffer = createMockAudioBuffer(2.1, 44100, 1);
  const report = analyzeAudioQuality(shortBuffer);

  assert.equal(report.status, "poor");
  const durationMetric = report.details.find((d) => d.id === "duration");
  assert.ok(durationMetric);
  assert.equal(durationMetric.status, "error");
});

test("DSP: Quality Check detects ideal 18s audio without clipping as good", () => {
  const idealBuffer = createMockAudioBuffer(18.5, 44100, 1, (i, _total) => {
    // Clean audio with moderate speech bursts
    return Math.sin(i * 0.05) * 0.6;
  });
  const report = analyzeAudioQuality(idealBuffer);

  assert.equal(report.status, "good");
  assert.equal(report.clippingCount, 0);
  assert.equal(report.numberOfChannels, 1);
  assert.equal(report.sampleRate, 44100);

  const clippingMetric = report.details.find((d) => d.id === "clipping");
  assert.ok(clippingMetric);
  assert.equal(clippingMetric.status, "pass");
});

test("DSP: Quality Check detects severe clipping and marks warning/poor", () => {
  const clippedBuffer = createMockAudioBuffer(12.0, 44100, 1, (_i, _total) => {
    // 100% clipped wave at +1.0 / -1.0
    return 1.0;
  });
  const report = analyzeAudioQuality(clippedBuffer);

  assert.equal(report.status, "poor");
  assert.ok(report.clippingCount > 100);
  const clippingMetric = report.details.find((d) => d.id === "clipping");
  assert.ok(clippingMetric);
  assert.equal(clippingMetric.status, "error");
});

test("DSP: Quality Check detects excessive silence", () => {
  const silentBuffer = createMockAudioBuffer(15.0, 44100, 1, (_i, _total) => {
    // Silence
    return 0.0001;
  });
  const report = analyzeAudioQuality(silentBuffer);

  const silenceMetric = report.details.find((d) => d.id === "silence");
  assert.ok(silenceMetric);
  assert.equal(silenceMetric.status, "warning");
  assert.ok(report.silenceRatio > 0.8);
});

test("DSP: extractWaveformPeaks extracts normalized bars", () => {
  const buffer = createMockAudioBuffer(10.0, 44100, 1);
  const peaks = extractWaveformPeaks(buffer, 50);

  assert.equal(peaks.length, 50);
  for (const p of peaks) {
    assert.ok(p >= 0.12 && p <= 1.0);
  }
});

test("DSP: formatAudioTimeWithSubseconds formats MM:SS.s with subseconds precision", () => {
  assert.equal(formatAudioTimeWithSubseconds(0), "00:00.0");
  assert.equal(formatAudioTimeWithSubseconds(4.2), "00:04.2");
  assert.equal(formatAudioTimeWithSubseconds(22.75), "00:22.7");
  assert.equal(formatAudioTimeWithSubseconds(65.4), "01:05.4");
  assert.equal(formatAudioTimeWithSubseconds(125.9), "02:05.9");
});

test("DSP: extractMinMaxPeaks computes true min/max amplitude without fake clamp", () => {
  // Audio with sine wave amplitude 0.75
  const activeBuffer = createMockAudioBuffer(2.0, 44100, 1, (i, _total) => {
    return Math.sin(i * 0.1) * 0.75;
  });
  const peaks = extractMinMaxPeaks(activeBuffer, 20);

  assert.equal(peaks.length, 20);
  for (const p of peaks) {
    assert.ok(p.min <= 0, `min should be <= 0, got ${p.min}`);
    assert.ok(p.max >= 0, `max should be >= 0, got ${p.max}`);
    assert.ok(p.max <= 0.8, `max should be <= 0.8, got ${p.max}`);
    assert.ok(p.min >= -0.8, `min should be >= -0.8, got ${p.min}`);
  }

  // Pure silence buffer: min and max must be exactly 0 (no fake artificial minimum)
  const silentBuffer = createMockAudioBuffer(1.0, 44100, 1, () => 0);
  const silentPeaks = extractMinMaxPeaks(silentBuffer, 10);
  assert.equal(silentPeaks.length, 10);
  for (const p of silentPeaks) {
    assert.equal(p.min, 0);
    assert.equal(p.max, 0);
  }
});

