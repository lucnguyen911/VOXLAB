/**
 * Types & Data Contracts for Multi-Speaker Dialogue Workspace
 * VoxLab v1.0.0
 */

export interface CharacterColorTheme {
  id: string;
  name: string;
  badgeClass: string;
  borderClass: string;
  textClass: string;
  bgClass: string;
  rawHex: string;
}

export const CHARACTER_COLOR_PALETTE: CharacterColorTheme[] = [
  {
    id: "purple",
    name: "Tím",
    badgeClass: "bg-purple-500/15 text-purple-400 border border-purple-500/30",
    borderClass: "border-purple-500/40",
    textClass: "text-purple-400",
    bgClass: "bg-purple-500/10",
    rawHex: "#a855f7",
  },
  {
    id: "sky",
    name: "Xanh dương",
    badgeClass: "bg-sky-500/15 text-sky-400 border border-sky-500/30",
    borderClass: "border-sky-500/40",
    textClass: "text-sky-400",
    bgClass: "bg-sky-500/10",
    rawHex: "#38bdf8",
  },
  {
    id: "emerald",
    name: "Xanh lục",
    badgeClass: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
    borderClass: "border-emerald-500/40",
    textClass: "text-emerald-400",
    bgClass: "bg-emerald-500/10",
    rawHex: "#34d399",
  },
  {
    id: "amber",
    name: "Cam hổ phách",
    badgeClass: "bg-amber-500/15 text-amber-400 border border-amber-500/30",
    borderClass: "border-amber-500/40",
    textClass: "text-amber-400",
    bgClass: "bg-amber-500/10",
    rawHex: "#fbbf24",
  },
  {
    id: "rose",
    name: "Hồng đào",
    badgeClass: "bg-rose-500/15 text-rose-400 border border-rose-500/30",
    borderClass: "border-rose-500/40",
    textClass: "text-rose-400",
    bgClass: "bg-rose-500/10",
    rawHex: "#fb7185",
  },
  {
    id: "indigo",
    name: "Xanh chàm",
    badgeClass: "bg-indigo-500/15 text-indigo-400 border border-indigo-500/30",
    borderClass: "border-indigo-500/40",
    textClass: "text-indigo-400",
    bgClass: "bg-indigo-500/10",
    rawHex: "#818cf8",
  },
  {
    id: "teal",
    name: "Xanh ngọc",
    badgeClass: "bg-teal-500/15 text-teal-400 border border-teal-500/30",
    borderClass: "border-teal-500/40",
    textClass: "text-teal-400",
    bgClass: "bg-teal-500/10",
    rawHex: "#2dd4bf",
  },
  {
    id: "orange",
    name: "Cam đỏ",
    badgeClass: "bg-orange-500/15 text-orange-400 border border-orange-500/30",
    borderClass: "border-orange-500/40",
    textClass: "text-orange-400",
    bgClass: "bg-orange-500/10",
    rawHex: "#fb923c",
  },
];

export interface DialogueCharacter {
  id: string;               // Normalized key (e.g. "nam", "vy", "lan")
  name: string;             // Display name (e.g. "Nam", "Vy", "Lan")
  colorTheme: CharacterColorTheme;
  segmentCount: number;     // Number of dialogue turns detected in text
  voiceId?: string;         // Assigned VoiceProfile id from VoxLab
  speed: number;            // Playback speed override (default: 1.0)
  pitch: number;            // Pitch override (default: 1.0)
  volume: number;           // Volume override (default: 1.0)
}

export interface DialogueSegment {
  id: string;
  index: number;
  characterName: string;
  characterId: string;
  rawText: string;
  cleanText: string;        // Text stripped of character label and inline tags
  pauseAfterSec: number;    // Inter-speaker pause duration
  status: "pending" | "generating" | "ready" | "failed" | "modified";
  voiceId?: string;
  audioBuffer?: AudioBuffer;
  audioBlobUrl?: string;
  durationSec?: number;
  errorMessage?: string;
}

import { PunctuationPauses } from "./ui";

export interface DialogueGlobalSettings {
  model: string;            // TTS model (default: "Omni Voice")
  masterVolume: number;     // Overall volume multiplier (0.0 to 2.0, default: 1.0)
  exportSrt: boolean;       // Whether to export SRT alongside audio (default: true)
  turnPauseSec: number;     // Turn-taking pause between different speakers (default: 0.3s)
  sameSpeakerPauseSec: number; // Pause between consecutive turns of same speaker (default: 0.2s)
  pauses: PunctuationPauses; // Punctuation pauses (comma, period, questionExclamation, colonSemicolon)
  concurrency: number;      // Processing speed (1 to 4)
}

export const DEFAULT_DIALOGUE_SETTINGS: DialogueGlobalSettings = {
  model: "Omni Voice",
  masterVolume: 1.0,
  exportSrt: true,
  turnPauseSec: 0,
  sameSpeakerPauseSec: 0,
  pauses: {
    comma: 0.5,
    period: 0.5,
    questionExclamation: 1.0,
    colonSemicolon: 0.6,
  },
  concurrency: 1,
};
