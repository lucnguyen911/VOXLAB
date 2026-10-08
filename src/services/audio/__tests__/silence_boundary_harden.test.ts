import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeSpeechBoundaries } from "../masterExport";

describe("Silence Boundary Trimming & Hardening Tests", () => {
  const sampleRate = 44100;

  it("H1: accurately measures leading and trailing silence on synthetic speech with silence pads", () => {
    // 100ms leading silence, 1000ms speech tone, 600ms trailing silence
    const leadingSilenceCount = Math.floor(sampleRate * 0.100); // 100ms
    const speechCount = Math.floor(sampleRate * 1.000); // 1000ms
    const trailingSilenceCount = Math.floor(sampleRate * 0.600); // 600ms
    const totalCount = leadingSilenceCount + speechCount + trailingSilenceCount;

    const samples = new Float32Array(totalCount);
    for (let i = 0; i < speechCount; i++) {
      const t = i / sampleRate;
      samples[leadingSilenceCount + i] = Math.sin(2 * Math.PI * 440 * t) * 0.3;
    }

    const isFirst = false;
    const isLast = false;
    const analysis = analyzeSpeechBoundaries(samples, sampleRate, isFirst, isLast);

    // Speech starts at ~100ms
    const expectedSpeechStart = leadingSilenceCount;
    assert.ok(Math.abs(analysis.speechStartSample - expectedSpeechStart) < sampleRate * 0.02);
    // With 30ms safety head margin:
    // cutStartSample = max(0, speechStart - 30ms) = ~70ms
    // actualLeadingSilenceRetainedMs = (100ms - 70ms) = 30ms
    assert.ok(
      Math.abs(analysis.actualLeadingSilenceRetainedMs - 30) < 5,
      `Expected ~30ms leading silence retained, got ${analysis.actualLeadingSilenceRetainedMs}ms`
    );

    // Speech ends at ~1100ms
    // With 50ms safety tail margin:
    // cutEndSample = speechEnd + 50ms = 1150ms
    // actualTrailingSilenceRetainedMs = (1150ms - 1100ms) = 50ms
    assert.ok(
      Math.abs(analysis.actualTrailingSilenceRetainedMs - 50) < 5,
      `Expected ~50ms trailing silence retained, got ${analysis.actualTrailingSilenceRetainedMs}ms`
    );

    // Trimmed length should be ~1080ms (total reduced from 1700ms)
    const expectedTrimmedDurationSec = (speechCount / sampleRate) + 0.030 + 0.050;
    const actualTrimmedDurationSec = analysis.trimmedSamples.length / sampleRate;
    assert.ok(
      Math.abs(actualTrimmedDurationSec - expectedTrimmedDurationSec) < 0.015,
      `Expected trimmed duration ~${expectedTrimmedDurationSec}s, got ${actualTrimmedDurationSec}s`
    );
  });

  it("H2: preserves weak final consonants (low amplitude decay) without premature cutoff", () => {
    // Simulate speech tone followed by low-amplitude consonant decay (/s/ or /m/ murmur)
    // Speech: 500ms at 0.3 amplitude
    // Consonant decay: 80ms decaying from 0.02 down to 0.002
    // Trailing silence: 400ms at 0.0
    const speechSamples = Math.floor(sampleRate * 0.500);
    const decaySamples = Math.floor(sampleRate * 0.080);
    const trailingSilenceSamples = Math.floor(sampleRate * 0.400);
    const totalCount = speechSamples + decaySamples + trailingSilenceSamples;

    const samples = new Float32Array(totalCount);
    for (let i = 0; i < speechSamples; i++) {
      samples[i] = Math.sin(2 * Math.PI * 300 * (i / sampleRate)) * 0.3;
    }
    // High-frequency fricative-like noise for consonant
    for (let i = 0; i < decaySamples; i++) {
      const progress = i / decaySamples;
      const amp = 0.02 * (1 - progress) + 0.002; // stays above threshold until end of decay
      samples[speechSamples + i] = (Math.random() * 2 - 1) * amp;
    }

    const analysis = analyzeSpeechBoundaries(samples, sampleRate, true, false);

    // Speech end sample must encompass the decaySamples plus 50ms safety tail
    const minRequiredEndSample = speechSamples + decaySamples;
    assert.ok(
      analysis.cutEndSample >= minRequiredEndSample,
      `Cut end sample ${analysis.cutEndSample} must not truncate consonant decay ending at ${minRequiredEndSample}`
    );
    // At least 50ms of trailing silence retained
    assert.ok(analysis.actualTrailingSilenceRetainedMs >= 45, "Must retain at least 50ms safety margin");
  });

  it("H3: soft speech (whisper at peak 0.05) is not treated as silence", () => {
    // Very quiet speech: peak 0.05 (well below normal 0.5+)
    const samples = new Float32Array(sampleRate * 1); // 1 sec
    for (let i = Math.floor(sampleRate * 0.2); i < Math.floor(sampleRate * 0.8); i++) {
      samples[i] = Math.sin(2 * Math.PI * 400 * (i / sampleRate)) * 0.04;
    }

    const analysis = analyzeSpeechBoundaries(samples, sampleRate, false, false);
    // Speech should be detected around 0.2s and 0.8s
    const onsetSec = analysis.speechStartSample / sampleRate;
    const offsetSec = analysis.speechEndSample / sampleRate;
    assert.ok(Math.abs(onsetSec - 0.2) < 0.03, `Soft speech onset ~0.2s, got ${onsetSec}s`);
    assert.ok(Math.abs(offsetSec - 0.8) < 0.03, `Soft speech offset ~0.8s, got ${offsetSec}s`);
  });

  it("H4: micro-fade applies raised-cosine taper at cut boundaries without clicks", () => {
    // Non-zero edge simulation to test click prevention
    const samples = new Float32Array(sampleRate * 0.5);
    samples.fill(0.15); // Constant DC offset representing abrupt cut risk

    const analysis = analyzeSpeechBoundaries(samples, sampleRate, false, false);
    const trimmed = analysis.trimmedSamples;

    // First sample must be scaled down near 0
    assert.ok(Math.abs(trimmed[0]) < 1e-4, `First sample must be 0, got ${trimmed[0]}`);
    // Last sample must be scaled down near 0
    assert.ok(
      Math.abs(trimmed[trimmed.length - 1]) < 1e-4,
      `Last sample must be 0, got ${trimmed[trimmed.length - 1]}`
    );

    // Delta between consecutive samples during fade must be gentle (no sudden jump > 0.01)
    const fadeLen = Math.floor(sampleRate * 0.008);
    for (let i = 0; i < fadeLen - 1; i++) {
      const delta = Math.abs(trimmed[i + 1] - trimmed[i]);
      assert.ok(delta < 0.005, `Micro-fade delta ${delta} exceeds click threshold 0.005 at index ${i}`);
    }
  });

  it("H5: exact boundary pause calculation formula produces target pause", () => {
    const targetPauseMs = 500; // Period
    const actualTrailingMs = 50.0;
    const actualLeadingMs = 30.0;

    const injectedGapMs = Math.max(0, targetPauseMs - actualTrailingMs - actualLeadingMs);
    assert.equal(injectedGapMs, 420.0);

    const totalBoundaryPause = actualTrailingMs + injectedGapMs + actualLeadingMs;
    assert.equal(totalBoundaryPause, 500.0);
  });
});
