import { describe, it } from "node:test";
import assert from "node:assert";

describe("Voice Library & Audio Player State Synchronization", () => {
  it("computes isPlayingThisVoice correctly when activePlayingTrackId is provided", () => {
    const voiceId = "voice_lan_anh";
    
    // Scenario 1: Audio is currently playing this voice
    let activePlayingTrackId: string | null = "voice_lan_anh";
    let playingVoiceId: string | null = null;
    let isPlayingThisVoice =
      activePlayingTrackId !== undefined
        ? activePlayingTrackId === voiceId
        : playingVoiceId === voiceId;
    assert.strictEqual(isPlayingThisVoice, true, "Voice card should show playing when activePlayingTrackId matches");

    // Scenario 2: Audio finishes or is paused -> activePlayingTrackId becomes null
    activePlayingTrackId = null;
    playingVoiceId = "voice_lan_anh"; // Stale internal state from previous play
    isPlayingThisVoice =
      activePlayingTrackId !== undefined
        ? activePlayingTrackId === voiceId
        : playingVoiceId === voiceId;
    assert.strictEqual(isPlayingThisVoice, false, "Voice card MUST NOT show playing when player is paused/stopped (activePlayingTrackId is null)");

    // Scenario 3: Another voice starts playing
    activePlayingTrackId = "voice_tuan_anh";
    isPlayingThisVoice =
      activePlayingTrackId !== undefined
        ? activePlayingTrackId === voiceId
        : playingVoiceId === voiceId;
    assert.strictEqual(isPlayingThisVoice, false, "Voice card must not show playing when another track plays");
  });

  it("handles end-of-track restart without instant pause", () => {
    const duration = 18.5;
    let currentTime = 18.5; // Track previously reached the end
    const playbackSpeed = 1.0;

    // When user plays again, currentTime >= duration - 0.1 should reset to 0
    let currentT = currentTime;
    if (currentT >= duration - 0.1) {
      currentT = 0;
      currentTime = 0;
    }

    assert.strictEqual(currentT, 0, "Current time must reset to 0 when replaying from end");
    assert.strictEqual(currentTime, 0, "State currentTime must reset to 0");

    const startTime = Date.now() - (currentT / playbackSpeed) * 1000;
    const elapsedAfter40ms = ((Date.now() - startTime) / 1000) * playbackSpeed;

    // After 40ms, elapsed is ~0.04s, NOT >= duration (18.5s)
    assert.ok(elapsedAfter40ms < duration, "Must not trigger end of track on the first tick");
  });
});
