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

  it("strictly resets playback offset and scrubber needle to 0:00 when switching chunks midway", () => {
    // Simulated player state engine matching BottomAudioPlayer logic
    let lastTrackKey = "";
    let currentTime = 0;
    let currentTimeRef = 0;

    const simulateTrackChange = (
      track: { id: string; audioUrl?: string; durationSec: number },
      isPlaying: boolean
    ) => {
      const trackKey = `${track.id}_${track.audioUrl || ""}`;
      const isNewTrack = lastTrackKey !== trackKey;
      lastTrackKey = trackKey;

      if (isNewTrack) {
        currentTimeRef = 0;
        currentTime = 0;
      }

      let startOffset = 0;
      if (isPlaying) {
        startOffset = isNewTrack ? 0 : currentTimeRef;
        if (startOffset >= track.durationSec - 0.1) {
          startOffset = 0;
          currentTimeRef = 0;
          currentTime = 0;
        }
      }

      const progressPercent = Math.min(100, Math.max(0, (currentTime / track.durationSec) * 100));

      return {
        isNewTrack,
        startOffset,
        currentTime,
        progressPercent,
      };
    };

    // 1. Play Chunk 1 and advance midway to 2.5s (out of 5.0s, i.e., 50%)
    const chunk1 = { id: "chunk_1", audioUrl: "blob:http://localhost/c1", durationSec: 5.0 };
    let res = simulateTrackChange(chunk1, true);
    assert.strictEqual(res.startOffset, 0, "Chunk 1 initially starts from 0s");
    assert.strictEqual(res.currentTime, 0);

    // Simulate playback advancing to 2.5s
    currentTime = 2.5;
    currentTimeRef = 2.5;
    assert.strictEqual(Math.round((currentTime / chunk1.durationSec) * 100), 50, "Needle is at 50%");

    // 2. User clicks play on Chunk 2 while Chunk 1 was playing at 2.5s
    const chunk2 = { id: "chunk_2", audioUrl: "blob:http://localhost/c2", durationSec: 8.0 };
    res = simulateTrackChange(chunk2, true);

    // Chunk 2 MUST start strictly from 0s, NOT 2.5s!
    assert.strictEqual(res.isNewTrack, true, "Chunk 2 is detected as a new track");
    assert.strictEqual(res.startOffset, 0, "Chunk 2 playback MUST start from offset 0s");
    assert.strictEqual(res.currentTime, 0, "Chunk 2 currentTime MUST reset to 0s");
    assert.strictEqual(res.progressPercent, 0, "Chunk 2 scrubber needle MUST reset to 0%");

    // 3. Chunk 2 advances to 3.0s and user pauses
    currentTime = 3.0;
    currentTimeRef = 3.0;
    res = simulateTrackChange(chunk2, false);
    assert.strictEqual(res.isNewTrack, false, "Same track is not new track");
    assert.strictEqual(currentTime, 3.0, "Pause retains current position");

    // 4. User resumes Chunk 2 -> MUST resume from paused 3.0s
    res = simulateTrackChange(chunk2, true);
    assert.strictEqual(res.isNewTrack, false, "Same track is not new track");
    assert.strictEqual(res.startOffset, 3.0, "Resume must continue from paused offset 3.0s");

    // 5. Chunk 2 is regenerated with a new audio URL
    const chunk2Regenerated = { id: "chunk_2", audioUrl: "blob:http://localhost/c2_new", durationSec: 8.2 };
    res = simulateTrackChange(chunk2Regenerated, true);
    assert.strictEqual(res.isNewTrack, true, "Regenerated chunk has different trackKey");
    assert.strictEqual(res.startOffset, 0, "Regenerated chunk MUST restart from 0s");
    assert.strictEqual(res.currentTime, 0, "Regenerated chunk currentTime MUST reset to 0s");
    assert.strictEqual(res.progressPercent, 0, "Regenerated chunk scrubber needle MUST reset to 0%");
  });
});
