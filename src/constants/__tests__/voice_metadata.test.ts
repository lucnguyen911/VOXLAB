import test from "node:test";
import assert from "node:assert/strict";
import {
  GENDER_OPTIONS,
  STYLE_OPTIONS,
  AGE_OPTIONS,
  ACCENTS_BY_LANGUAGE,
  normalizeAccent,
  normalizeStyle,
  normalizeAge,
  getGenderLabel,
  getAccentLabel,
  getStyleLabel,
  getAgeLabel,
  getVoiceSecondaryTags,
  extractStructuredMetadataFromTags,
  migrateLegacyVoice,
} from "../voiceFilters";
import { VoiceProfile } from "../../types/ui";

test("Taxonomy: Options and label helpers are fully localized", () => {
  assert.equal(GENDER_OPTIONS.length, 2);
  assert.equal(getGenderLabel("female", "vi"), "Nữ");
  assert.equal(getGenderLabel("female", "en"), "Female");
  assert.equal(getGenderLabel("male", "vi"), "Nam");
  assert.equal(getGenderLabel("male", "en"), "Male");

  assert.equal(AGE_OPTIONS.length, 3);
  assert.equal(getAgeLabel("young", "vi"), "Trẻ");
  assert.equal(getAgeLabel("young", "en"), "Young");
  assert.equal(getAgeLabel("middle_aged", "vi"), "Trung niên");

  assert.ok(Array.isArray(ACCENTS_BY_LANGUAGE.vi));
  assert.equal(getAccentLabel("vi-north", "vi"), "Miền Bắc");
  assert.equal(getAccentLabel("vi-north", "en"), "Northern");
  assert.equal(getAccentLabel("en-us", "vi"), "Mỹ");

  assert.equal(getStyleLabel("expressive", "vi"), "Truyền cảm");
  assert.equal(getStyleLabel("expressive", "en"), "Expressive");

  const gentle = STYLE_OPTIONS.find((s) => s.id === "gentle");
  assert.ok(gentle, "gentle option must exist in STYLE_OPTIONS");
  assert.equal(gentle.labels.vi, "Nhẹ nhàng");
  assert.equal(gentle.labels.en, "Gentle");
  assert.equal(gentle.labels.ja, "優しい");
  assert.equal(gentle.labels.zh, "温柔");
});

test("Normalization: normalizeStyle accurately maps canonical and synonym styles", () => {
  assert.equal(normalizeStyle("gentle"), "gentle");
  assert.equal(normalizeStyle("Nhẹ nhàng"), "gentle");
  assert.equal(normalizeStyle("dịu dàng"), "gentle");
  assert.equal(normalizeStyle("Truyền cảm"), "expressive");
  assert.equal(normalizeStyle("Thuyết minh"), "narration");
  assert.equal(normalizeStyle("Tự nhiên"), "natural");
  assert.equal(normalizeStyle("unknown_xyz"), "");
});

test("Normalization: normalizeAccent correctly maps regional accents", () => {
  assert.equal(normalizeAccent("Miền Bắc"), "vi-north");
  assert.equal(normalizeAccent("Miền Trung"), "vi-central");
  assert.equal(normalizeAccent("Miền Nam"), "vi-south");
  assert.equal(normalizeAccent("US"), "en-us");
  assert.equal(normalizeAccent("Anh"), "en-gb");
});

test("Normalization: normalizeAge correctly maps age groups", () => {
  assert.equal(normalizeAge("Trẻ"), "young");
  assert.equal(normalizeAge("young"), "young");
  assert.equal(normalizeAge("Trung niên"), "middle_aged");
  assert.equal(normalizeAge("middle aged"), "middle_aged");
  assert.equal(normalizeAge("Lớn tuổi"), "senior");
  assert.equal(normalizeAge("cao tuổi"), "senior");
});

test("Metadata Extraction: extractStructuredMetadataFromTags separates canonical fields from custom tags", () => {
  const legacyTags = ["Nữ", "Miền Bắc", "Truyền cảm", "Nhẹ nhàng", "Trẻ", "CustomTag123"];
  const extracted = extractStructuredMetadataFromTags(legacyTags);

  assert.equal(extracted.gender, "female");
  assert.equal(extracted.accent, "vi-north");
  assert.deepEqual(extracted.styles, ["expressive", "gentle"]);
  assert.equal(extracted.style, "expressive");
  assert.equal(extracted.ageGroup, "young");
  assert.deepEqual(extracted.unmappedTags, ["CustomTag123"]);
});

test("Migration: migrateLegacyVoice upgrades legacy voice with canonical taxonomy while preserving custom tags", () => {
  const legacyVoice: VoiceProfile = {
    id: "legacy_01",
    name: "Giọng Mẫu",
    source: "local",
    origin: "clone",
    tags: ["Nam", "Miền Nam", "Kể chuyện", "Audiobook-VIP"],
    supportedLanguages: ["vi"],
    modelCompatibility: ["OmniVoice"],
  };

  const migrated = migrateLegacyVoice(legacyVoice);

  assert.equal(migrated.gender, "male");
  assert.equal(migrated.accent, "vi-south");
  assert.deepEqual(migrated.styles, ["storytelling"]);
  assert.equal(migrated.style, "storytelling");
  assert.deepEqual(migrated.tags, ["Audiobook-VIP"], "Custom tags must be preserved");
});

test("Localization: getVoiceSecondaryTags dynamically updates labels when language switches", () => {
  const voice: VoiceProfile = {
    id: "test_voice",
    name: "Thảo Vy",
    source: "local",
    origin: "clone",
    gender: "female",
    accent: "vi-north",
    styles: ["gentle", "expressive"],
    style: "gentle",
    ageGroup: "young",
    country: "VN",
    tags: ["Dự Án A"],
    supportedLanguages: ["vi"],
    modelCompatibility: ["OmniVoice"],
  };

  const viTags = getVoiceSecondaryTags(voice, "vi");
  assert.ok(viTags.includes("Nữ"));
  assert.ok(viTags.includes("Miền Bắc"));
  assert.ok(viTags.includes("Nhẹ nhàng"));
  assert.ok(viTags.includes("Truyền cảm"));
  assert.ok(viTags.includes("Trẻ"));
  assert.ok(viTags.includes("Dự Án A"));

  const enTags = getVoiceSecondaryTags(voice, "en");
  assert.ok(enTags.includes("Female"));
  assert.ok(enTags.includes("Northern"));
  assert.ok(enTags.includes("Gentle"));
  assert.ok(enTags.includes("Expressive"));
  assert.ok(enTags.includes("Young"));
  assert.ok(enTags.includes("Dự Án A"));
});

test("Multi-style Filtering: Filter matches voice having either gentle or expressive style", () => {
  const voice: VoiceProfile = {
    id: "test_multi",
    name: "Thảo Vy",
    source: "local",
    origin: "clone",
    gender: "female",
    accent: "vi-north",
    styles: ["gentle", "expressive"],
    style: "gentle",
    ageGroup: "young",
    tags: [],
    supportedLanguages: ["vi"],
    modelCompatibility: ["OmniVoice"],
  };

  // Helper mimicking the exact filtering logic in VoiceLibraryWorkspace & VoiceSelectionModal
  const matchesCategory = (v: VoiceProfile, selectedCategory: string) => {
    if (selectedCategory === "all") return true;
    const normSelected = normalizeStyle(selectedCategory);
    if (Array.isArray(v.styles) && v.styles.length > 0) {
      return v.styles.some((s) => normalizeStyle(s) === normSelected);
    }
    return normalizeStyle(v.style || v.category) === normSelected;
  };

  assert.equal(matchesCategory(voice, "gentle"), true);
  assert.equal(matchesCategory(voice, "Nhẹ nhàng"), true);
  assert.equal(matchesCategory(voice, "expressive"), true);
  assert.equal(matchesCategory(voice, "Truyền cảm"), true);
  assert.equal(matchesCategory(voice, "news"), false);
  assert.equal(matchesCategory(voice, "Thời sự"), false);
});
