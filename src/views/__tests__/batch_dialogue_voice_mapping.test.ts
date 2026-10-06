import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MockBatchJob,
  BatchGlobalDefaults,
  DEFAULT_GLOBAL_SETTINGS,
  isJobCustomConfigured,
  hasCustomDialogueVoiceMapping,
  resolveEffectiveCharacterVoice,
  getJobWorkingConfig,
  computeJobConfigDiff,
} from "../BatchWorkspacePrototype";
import { parseDialogueScript, normalizeCharacterId } from "../../services/dialogue/parser";
import { MOCK_VOICES } from "../../mock/data";

describe("Gate D: Batch Dialogue Voice Mapping & 3-Tier Precedence Suite", () => {
  const MOCK_GLOBAL_DEFAULTS: BatchGlobalDefaults = {
    ...DEFAULT_GLOBAL_SETTINGS,
    dialogue: {
      ...DEFAULT_GLOBAL_SETTINGS.dialogue,
      model: "Omni Voice",
      defaultVoice: "Minh Quang (Hà Nội)",
    },
  };

  const SAMPLE_SCRIPT = `[Nam]: Xin chào tất cả các bạn.
[Lan]: Chào anh Nam, hôm nay chúng ta bàn về tính năng mới.
[Người dẫn chuyện]: Đây là kịch bản thử nghiệm nhiều người nói.
[Nam]: Rất chính xác.`;

  // -------------------------------------------------------------
  // TEST 1: isJobCustomConfigured reflects granular overrides
  // -------------------------------------------------------------
  it("TEST 1: isJobCustomConfigured detects character voice mappings and per-file overrides", () => {
    const jobDefault: MockBatchJob = {
      id: "job-default",
      fileName: "script_01.txt",
      filePath: "D:/Batch/script_01.txt",
      fileSize: "12 KB",
      fileKind: "text",
      stage: "staging",
      queueOrder: 0,
      selectedTasks: ["dialogue"],
      executionSequence: ["dialogue"],
      stepResults: {},
      status: "waiting",
      progressPct: 0,
      hasCustomConfig: false,
      configOverrides: {},
    };

    assert.equal(isJobCustomConfigured(jobDefault), false, "Default job must report not custom configured");

    const jobWithCharVoice: MockBatchJob = {
      ...jobDefault,
      configOverrides: {
        dialogue: {
          characterVoices: {
            nam: "Minh Quang (Hà Nội)",
          },
        },
      },
    };

    assert.equal(isJobCustomConfigured(jobWithCharVoice), true, "Job with characterVoices must report custom configured");

    const jobWithFileDefaultVoice: MockBatchJob = {
      ...jobDefault,
      configOverrides: {
        dialogue: {
          defaultVoice: "Thảo Trinh (Hà Nội)",
        },
      },
    };

    assert.equal(isJobCustomConfigured(jobWithFileDefaultVoice), true, "Job with custom defaultVoice must report custom configured");
  });

  // -------------------------------------------------------------
  // TEST 2: 3-Tier Voice Precedence Rule
  // Giọng riêng nhân vật > Giọng tùy chỉnh của file > Giọng mặc định Cấu hình chung
  // -------------------------------------------------------------
  it("TEST 2: 3-Tier Precedence: Character Voice > File Custom Default > Global Defaults", () => {
    const job: MockBatchJob = {
      id: "job-precedence",
      fileName: "dialogue_test.txt",
      filePath: "D:/Batch/dialogue_test.txt",
      fileSize: "15 KB",
      fileKind: "text",
      stage: "staging",
      queueOrder: 0,
      selectedTasks: ["dialogue"],
      executionSequence: ["dialogue"],
      stepResults: {},
      status: "waiting",
      progressPct: 0,
      configOverrides: {
        dialogue: {
          defaultVoice: "Thảo Trinh (Hà Nội)", // Tier 2
          characterVoices: {
            nam: "Minh Quang (Hà Nội)",        // Tier 1
          },
        },
      },
    };

    // Tier 1: Nam has explicit character voice assignment
    const namVoice = resolveEffectiveCharacterVoice(
      "nam",
      job,
      MOCK_GLOBAL_DEFAULTS,
      "Omni Voice",
      MOCK_VOICES
    );
    assert.equal(namVoice.source, "character", "Nam voice source must be 'character'");
    assert.equal(namVoice.voiceName, "Minh Quang (Hà Nội)", "Nam must use Tier 1 character voice");

    // Tier 2: Lan does NOT have character voice, but file has custom defaultVoice
    const lanVoice = resolveEffectiveCharacterVoice(
      "lan",
      job,
      MOCK_GLOBAL_DEFAULTS,
      "Omni Voice",
      MOCK_VOICES
    );
    assert.equal(lanVoice.source, "file_custom", "Lan voice source must be 'file_custom'");
    assert.equal(lanVoice.voiceName, "Thảo Trinh (Hà Nội)", "Lan must use Tier 2 file default voice");

    // Tier 3: If file has NO custom defaultVoice, fallback to Global Defaults
    const jobNoOverrides: MockBatchJob = {
      ...job,
      configOverrides: {},
    };
    const narratorVoice = resolveEffectiveCharacterVoice(
      "nguoi-dan-chuyen",
      jobNoOverrides,
      MOCK_GLOBAL_DEFAULTS,
      "Omni Voice",
      MOCK_VOICES
    );
    assert.equal(narratorVoice.source, "global_default", "Narrator voice source must be 'global_default'");
    assert.equal(narratorVoice.voiceName, "Minh Quang (Hà Nội)", "Narrator must use Tier 3 global default voice");
  });

  // -------------------------------------------------------------
  // TEST 3: Script Voice Isolation (Per-File Scope)
  // Each script maintains its own isolated voice mapping table
  // -------------------------------------------------------------
  it("TEST 3: Character voice mappings are strictly isolated per file", () => {
    const jobA: MockBatchJob = {
      id: "job-A",
      fileName: "scene_01.txt",
      filePath: "D:/Batch/scene_01.txt",
      fileSize: "10 KB",
      fileKind: "text",
      stage: "staging",
      queueOrder: 1,
      selectedTasks: ["dialogue"],
      executionSequence: ["dialogue"],
      stepResults: {},
      status: "waiting",
      progressPct: 0,
      configOverrides: {
        dialogue: {
          characterVoices: {
            nam: "Minh Quang (Hà Nội)",
          },
        },
      },
    };

    const jobB: MockBatchJob = {
      id: "job-B",
      fileName: "scene_02.txt",
      filePath: "D:/Batch/scene_02.txt",
      fileSize: "14 KB",
      fileKind: "text",
      stage: "staging",
      queueOrder: 2,
      selectedTasks: ["dialogue"],
      executionSequence: ["dialogue"],
      stepResults: {},
      status: "waiting",
      progressPct: 0,
      configOverrides: {
        dialogue: {
          characterVoices: {
            nam: "Mai Chi (Sài Gòn)", // Distinct assignment for same character name in Job B
          },
        },
      },
    };

    const voiceJobA = resolveEffectiveCharacterVoice("nam", jobA, MOCK_GLOBAL_DEFAULTS);
    const voiceJobB = resolveEffectiveCharacterVoice("nam", jobB, MOCK_GLOBAL_DEFAULTS);

    assert.equal(voiceJobA.voiceName, "Minh Quang (Hà Nội)");
    assert.equal(voiceJobB.voiceName, "Mai Chi (Sài Gòn)");
    assert.notEqual(voiceJobA.voiceName, voiceJobB.voiceName, "Different files must have isolated voice assignments");
  });

  // -------------------------------------------------------------
  // TEST 4: Batch Global Config Apply Invariants
  // Applying defaults to selected files does NOT delete/overwrite characterVoices
  // -------------------------------------------------------------
  it("TEST 4: Batch applying global defaults preserves characterVoices and obeys Setting != Execution", () => {
    const jobWithMapping: MockBatchJob = {
      id: "job-preserve",
      fileName: "play.txt",
      filePath: "D:/Batch/play.txt",
      fileSize: "20 KB",
      fileKind: "text",
      stage: "staging",
      queueOrder: 0,
      selectedTasks: ["dialogue"], // only dialogue is enabled
      executionSequence: ["dialogue"],
      stepResults: {},
      status: "waiting",
      progressPct: 0,
      configOverrides: {
        dialogue: {
          defaultVoice: "Cũ",
          characterVoices: {
            nam: "Minh Quang (Hà Nội)",
            lan: "Thảo Trinh (Hà Nội)",
          },
        },
      },
    };

    // Simulate handleApplyDefaultsToSelected logic
    const prevCharVoices = (jobWithMapping.configOverrides as Record<string, any>)?.dialogue?.characterVoices || {};
    const newGlobalDefaultVoice = "Mai Chi (Sài Gòn)";
    const updatedGlobalDefaults: BatchGlobalDefaults = {
      ...MOCK_GLOBAL_DEFAULTS,
      dialogue: {
        ...MOCK_GLOBAL_DEFAULTS.dialogue,
        defaultVoice: newGlobalDefaultVoice,
      },
    };

    const appliedOverrides = {
      outputPath: updatedGlobalDefaults.outputPath,
      saveInSourceFolder: updatedGlobalDefaults.saveInSourceFolder,
      collisionPolicy: updatedGlobalDefaults.collisionPolicy,
      outputAudioFormat: updatedGlobalDefaults.outputAudioFormat,
      outputSubtitleFormat: updatedGlobalDefaults.outputSubtitleFormat,
      ...(jobWithMapping.selectedTasks.includes("dialogue") ? {
        dialogue: {
          ...updatedGlobalDefaults.dialogue,
          ...(Object.keys(prevCharVoices).length > 0 ? { characterVoices: { ...prevCharVoices } } : {}),
        },
      } : {}),
    };

    // Check that characterVoices were preserved
    assert.deepEqual(appliedOverrides.dialogue?.characterVoices, {
      nam: "Minh Quang (Hà Nội)",
      lan: "Thảo Trinh (Hà Nội)",
    }, "Character voices must NOT be wiped when batch defaults are applied");

    // Check that new global defaultVoice was applied to dialogue
    assert.equal(appliedOverrides.dialogue?.defaultVoice, newGlobalDefaultVoice);

    // Check Setting != Execution: tts, transcription, translation, dubbing were NOT activated
    assert.equal((appliedOverrides as any).tts, undefined, "TTS must not be auto-enabled");
    assert.equal((appliedOverrides as any).dubbing, undefined, "Dubbing must not be auto-enabled");
  });

  // -------------------------------------------------------------
  // TEST 5: Script Parser & Sync Mechanism
  // Re-parsing script preserves existing characters and defaults new characters
  // -------------------------------------------------------------
  it("TEST 5: Script sync detects characters, preserves existing assignments, and assigns default to new ones", () => {
    // Initial script parse
    const initialParsed = parseDialogueScript(SAMPLE_SCRIPT);
    assert.equal(initialParsed.characters.length, 3, "Sample script must yield 3 characters: Nam, Lan, Người dẫn chuyện");

    const activeCharIds = new Set(initialParsed.characters.map((c) => c.id));
    assert.ok(activeCharIds.has("nam"));
    assert.ok(activeCharIds.has("lan"));
    assert.ok(activeCharIds.has(normalizeCharacterId("Người dẫn chuyện")));

    // Previous voice assignments including an obsolete character "vy"
    const prevVoices: Record<string, string> = {
      nam: "Minh Quang (Hà Nội)",
      lan: "Thảo Trinh (Hà Nội)",
      vy: "Mai Chi (Sài Gòn)", // No longer in script
    };

    // Simulate handleSyncDialogueScript pruning
    const cleanedVoices: Record<string, string> = {};
    for (const [cId, vName] of Object.entries(prevVoices)) {
      if (activeCharIds.has(cId)) {
        cleanedVoices[cId] = vName;
      }
    }

    assert.equal(cleanedVoices.nam, "Minh Quang (Hà Nội)", "Nam assignment preserved");
    assert.equal(cleanedVoices.lan, "Thảo Trinh (Hà Nội)", "Lan assignment preserved");
    assert.equal(cleanedVoices.vy, undefined, "Obsolete character 'vy' pruned");

    // New character "nguoi-dan-chuyen" has no voice in cleanedVoices, must resolve to default
    const testJob: MockBatchJob = {
      id: "job-sync",
      fileName: "script.txt",
      filePath: "D:/Batch/script.txt",
      fileSize: "10 KB",
      fileKind: "text",
      stage: "staging",
      queueOrder: 0,
      selectedTasks: ["dialogue"],
      executionSequence: ["dialogue"],
      stepResults: {},
      status: "waiting",
      progressPct: 0,
      configOverrides: {
        dialogue: {
          characterVoices: cleanedVoices,
        },
      },
    };

    const resolvedNarrator = resolveEffectiveCharacterVoice(normalizeCharacterId("Người dẫn chuyện"), testJob, MOCK_GLOBAL_DEFAULTS);
    assert.equal(resolvedNarrator.source, "global_default", "New character falls back to default voice");
    assert.equal(resolvedNarrator.voiceName, MOCK_GLOBAL_DEFAULTS.dialogue.defaultVoice);
  });

  // -------------------------------------------------------------
  // TEST 6: Model Voice Compatibility & Warning Flagging
  // Incompatible assigned voice triggers warning
  // -------------------------------------------------------------
  it("TEST 6: Incompatible voice assignments trigger warning flag with explanatory message", () => {
    const job: MockBatchJob = {
      id: "job-compat",
      fileName: "compat.txt",
      filePath: "D:/Batch/compat.txt",
      fileSize: "5 KB",
      fileKind: "text",
      stage: "staging",
      queueOrder: 0,
      selectedTasks: ["dialogue"],
      executionSequence: ["dialogue"],
      stepResults: {},
      status: "waiting",
      progressPct: 0,
      configOverrides: {
        dialogue: {
          characterVoices: {
            nam: "NonExistentVoiceName",
          },
        },
      },
    };

    const result = resolveEffectiveCharacterVoice("nam", job, MOCK_GLOBAL_DEFAULTS, "Omni Voice", MOCK_VOICES);
    assert.equal(result.isCompatible, false, "Unknown voice must be flagged incompatible");
    assert.ok(result.warning && result.warning.includes("không tìm thấy trong Voice Library"), "Warning must explain voice not found");
  });

  // -------------------------------------------------------------
  // TEST 7: Execution Lock & Snapshot Freezing
  // Dialogue characterVoices are frozen in effectiveConfigSnapshot when job transitions to processing
  // -------------------------------------------------------------
  it("TEST 7: Working character voices are frozen into effectiveConfigSnapshot upon queue start", () => {
    const waitingJob: MockBatchJob = {
      id: "job-freeze",
      fileName: "podcast.txt",
      filePath: "D:/Batch/podcast.txt",
      fileSize: "8 KB",
      fileKind: "text",
      stage: "queued",
      queueOrder: 1,
      selectedTasks: ["dialogue"],
      executionSequence: ["dialogue"],
      stepResults: {},
      status: "waiting",
      progressPct: 0,
      configOverrides: {
        dialogue: {
          model: "Omni Voice",
          defaultVoice: "Minh Quang (Hà Nội)",
          characterVoices: {
            nam: "Minh Quang (Hà Nội)",
            lan: "Thảo Trinh (Hà Nội)",
          },
        },
      },
    };

    // Simulate queue loop transition (waiting -> processing)
    const working = getJobWorkingConfig(waitingJob);
    const processingJob: MockBatchJob = {
      ...waitingJob,
      status: "processing",
      progressPct: 10,
      effectiveConfigSnapshot: {
        ...(waitingJob.effectiveConfigSnapshot || {}),
        ...working,
        ...(working.dialogue ? {
          dialogue: {
            ...working.dialogue,
            ...(working.dialogue.characterVoices ? { characterVoices: { ...working.dialogue.characterVoices } } : {}),
          },
        } : {}),
      },
    };

    assert.deepEqual(
      processingJob.effectiveConfigSnapshot?.dialogue?.characterVoices,
      {
        nam: "Minh Quang (Hà Nội)",
        lan: "Thảo Trinh (Hà Nội)",
      },
      "Frozen snapshot must accurately store characterVoices"
    );

    // Modifying configOverrides now detects a diff against the frozen snapshot
    const mutatedJob: MockBatchJob = {
      ...processingJob,
      configOverrides: {
        ...processingJob.configOverrides,
        dialogue: {
          ...processingJob.configOverrides?.dialogue,
          characterVoices: {
            nam: "Mai Chi (Sài Gòn)", // changed while processing
          },
        },
      },
    };

    const diff = computeJobConfigDiff(mutatedJob);
    assert.equal(diff.isConfigChanged, true, "Diff engine must detect character voice deviation from frozen snapshot");
    assert.equal(diff.aiConfigChanged, true, "Voice mapping change must invalidate AI step");
  });

  // -------------------------------------------------------------
  // TEST 8: hasCustomDialogueVoiceMapping detects valid mappings
  // -------------------------------------------------------------
  it("TEST 8: hasCustomDialogueVoiceMapping determines gear color state accurately", () => {
    const baseJob: MockBatchJob = {
      id: "job-gear-test",
      fileName: "podcast.txt",
      filePath: "D:/KichBan/podcast.txt",
      fileSize: "15 KB",
      fileKind: "text",
      hasDialogueStructure: true,
      stage: "staging",
      queueOrder: 0,
      selectedTasks: ["dialogue"],
      executionSequence: ["dialogue"],
      stepResults: {},
      status: "waiting",
      progressPct: 0,
      hasCustomConfig: false,
      configOverrides: {},
    };

    // No configOverrides -> gray gear
    assert.equal(hasCustomDialogueVoiceMapping(baseJob), false, "Job without dialogue overrides must return false (gray gear)");

    // Empty characterVoices -> gray gear
    const emptyJob: MockBatchJob = {
      ...baseJob,
      configOverrides: {
        dialogue: {
          characterVoices: {},
        },
      },
    };
    assert.equal(hasCustomDialogueVoiceMapping(emptyJob), false, "Job with empty characterVoices must return false (gray gear)");

    // Only empty strings -> gray gear
    const whitespaceJob: MockBatchJob = {
      ...baseJob,
      configOverrides: {
        dialogue: {
          characterVoices: {
            nam: "   ",
          },
        },
      },
    };
    assert.equal(hasCustomDialogueVoiceMapping(whitespaceJob), false, "Job with whitespace-only voices must return false (gray gear)");

    // Valid assignment -> purple gear
    const customJob: MockBatchJob = {
      ...baseJob,
      configOverrides: {
        dialogue: {
          characterVoices: {
            nam: "Minh Quang (Hà Nội)",
          },
        },
      },
    };
    assert.equal(hasCustomDialogueVoiceMapping(customJob), true, "Job with valid assigned voice must return true (purple gear)");
  });

  // -------------------------------------------------------------
  // TEST 9: Priority rule: Character voice > Global Dialogue Default
  // -------------------------------------------------------------
  it("TEST 9: Priority rule ensures unassigned characters fall back to global default while assigned characters keep custom voice", () => {
    const job: MockBatchJob = {
      id: "job-precedence-verify",
      fileName: "story.txt",
      filePath: "D:/KichBan/story.txt",
      fileSize: "20 KB",
      fileKind: "text",
      hasDialogueStructure: true,
      stage: "staging",
      queueOrder: 0,
      selectedTasks: ["dialogue"],
      executionSequence: ["dialogue"],
      stepResults: {},
      status: "waiting",
      progressPct: 0,
      hasCustomConfig: true,
      configOverrides: {
        dialogue: {
          characterVoices: {
            nam: "Tuấn Anh (Huế)", // Custom assigned voice
            // lan is NOT assigned -> must use global default
          },
        },
      },
    };

    const parsed = parseDialogueScript(SAMPLE_SCRIPT);
    const nam = parsed.characters.find((c) => c.id === "nam")!;
    const lan = parsed.characters.find((c) => c.id === "lan")!;

    const namVoice = resolveEffectiveCharacterVoice(
      nam.id,
      job,
      MOCK_GLOBAL_DEFAULTS,
      "Omni Voice",
      MOCK_VOICES
    );
    assert.equal(namVoice.source, "character");
    assert.equal(namVoice.voiceName, "Tuấn Anh (Huế)", "Assigned character must resolve to its specific custom voice");

    const lanVoice = resolveEffectiveCharacterVoice(
      lan.id,
      job,
      MOCK_GLOBAL_DEFAULTS,
      "Omni Voice",
      MOCK_VOICES
    );
    assert.equal(lanVoice.source, "global_default");
    assert.equal(lanVoice.voiceName, "Minh Quang (Hà Nội)", "Unassigned character must fall back to global dialogue default voice");
  });

  // -------------------------------------------------------------
  // TEST 10: Revert to defaults removes custom mapping and turns gear gray
  // -------------------------------------------------------------
  it("TEST 10: Reverting custom dialogue voices clears mapping and reverts gear state to default", () => {
    const jobWithVoices: MockBatchJob = {
      id: "job-revert",
      fileName: "talk.txt",
      filePath: "D:/KichBan/talk.txt",
      fileSize: "10 KB",
      fileKind: "text",
      hasDialogueStructure: true,
      stage: "staging",
      queueOrder: 0,
      selectedTasks: ["dialogue"],
      executionSequence: ["dialogue"],
      stepResults: {},
      status: "waiting",
      progressPct: 0,
      hasCustomConfig: true,
      configOverrides: {
        dialogue: {
          characterVoices: {
            nam: "Mai Phương (Sài Gòn)",
            lan: "Thảo Trinh (Hà Nội)",
          },
        },
      },
    };

    assert.equal(hasCustomDialogueVoiceMapping(jobWithVoices), true, "Initially purple gear");

    // Simulate handleResetDialogueCustomVoices
    const currentDialogue = (jobWithVoices.configOverrides?.dialogue || {}) as Record<string, any>;
    const { characterVoices: _removed, ...restDialogue } = currentDialogue;
    const hasRemainingDialogue = Object.keys(restDialogue).length > 0;

    const revertedJob: MockBatchJob = {
      ...jobWithVoices,
      configOverrides: {
        ...jobWithVoices.configOverrides,
        dialogue: hasRemainingDialogue ? restDialogue : undefined,
      },
    };
    revertedJob.hasCustomConfig = isJobCustomConfigured(revertedJob);

    assert.equal(hasCustomDialogueVoiceMapping(revertedJob), false, "After reset, gear must turn gray");
    assert.equal(revertedJob.configOverrides?.dialogue?.characterVoices, undefined, "characterVoices must be undefined");
  });
});
