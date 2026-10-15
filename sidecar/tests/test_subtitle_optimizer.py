"""Unit and acceptance tests for VoxLab YouTube Cinematic Subtitle Optimizer (Phase B)."""
from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from voxlab_sidecar.subtitle_optimizer import (
    build_protected_boundary_map,
    build_word_sequence,
    display_width,
    get_profile,
    optimize_subtitles_v2,
    recover_orthography_from_script,
    validate_final_cues,
)


def _make_segment(text: str, start_sec: float = 0.0, word_dur: float = 0.32) -> dict:
    tokens = text.split()
    words = []
    for idx, tok in enumerate(tokens):
        w_start = round(start_sec + idx * word_dur, 3)
        w_end = round(w_start + word_dur - 0.02, 3)
        words.append({"word": tok, "startSec": w_start, "endSec": w_end, "probability": 0.99})
    return {
        "id": 1,
        "startSec": start_sec,
        "endSec": round(start_sec + len(tokens) * word_dur, 3),
        "text": text,
        "words": words,
    }


class SubtitleOptimizerTest(unittest.TestCase):
    def test_mandatory_sentence_1_over_55_diesel_truck(self):
        sentence = "If you are over 55, you remember when a diesel truck meant America was working."
        report = {}
        cues = optimize_subtitles_v2(
            [_make_segment(sentence)],
            video_format="16:9",
            max_lines=2,
            debug_validation_report=report,
        )
        self.assertTrue(report["export_allowed"])
        self.assertEqual(len(cues), 2)
        self.assertEqual(cues[0]["text"], "If you are over 55,")
        self.assertEqual(cues[1]["text"], "you remember when a diesel truck\nmeant America was working.")

    def test_mandatory_sentence_2_tesla_semi_82000_pounds(self):
        sentence = (
            "Tesla's Semi pulls 82,000 pounds, about 37 tons, "
            "with a motor roughly the size of one single piston from a 15-liter diesel engine."
        )
        report = {}
        cues = optimize_subtitles_v2(
            [_make_segment(sentence)],
            video_format="16:9",
            max_lines=2,
            debug_validation_report=report,
        )
        self.assertTrue(report["export_allowed"])
        self.assertGreaterEqual(len(cues), 2)
        joined_cues = [" ".join(c["text"].splitlines()) for c in cues]
        self.assertTrue(any("82,000 pounds," in c["text"] for c in cues))
        self.assertTrue(any("37 tons," in c["text"] for c in cues))
        self.assertTrue(any("15-liter diesel engine." in c["text"] for c in cues))
        for c in cues:
            lines = c["text"].splitlines()
            self.assertLessEqual(len(lines), 2)
            self.assertTrue(all(display_width(line) <= 32 for line in lines))
        self.assertEqual(" ".join(joined_cues), sentence)

    def test_mandatory_sentence_3_kwh_per_mile_protected_spans(self):
        sentence = "That is less than 2 kilowatt hours per mile, or more precisely 1.55 kWh per mile."
        report = {}
        cues = optimize_subtitles_v2(
            [_make_segment(sentence)],
            video_format="16:9",
            max_lines=2,
            debug_validation_report=report,
        )
        self.assertTrue(report["export_allowed"])
        self.assertEqual(len(cues), 2)
        self.assertIn("2 kilowatt hours per mile,", cues[0]["text"].splitlines())
        self.assertIn("1.55 kWh per mile.", cues[1]["text"].splitlines())

    def test_mandatory_sentence_4_clause_conjunction_and(self):
        sentence = (
            "It is coming for the money, and when freight costs change, "
            "the price of everything you buy changes with it."
        )
        report = {}
        cues = optimize_subtitles_v2(
            [_make_segment(sentence)],
            video_format="16:9",
            max_lines=2,
            debug_validation_report=report,
        )
        self.assertTrue(report["export_allowed"])
        self.assertEqual(len(cues), 2)
        self.assertEqual(cues[0]["text"], "It is coming for the money,\nand when freight costs change,")
        self.assertEqual(cues[1]["text"], "the price of everything\nyou buy changes with it.")

    def test_mandatory_sentence_5_coordinate_noun_list_intact(self):
        sentence = "One architecture across cars, trucks, and robots."
        report = {}
        cues = optimize_subtitles_v2(
            [_make_segment(sentence)],
            video_format="16:9",
            max_lines=2,
            debug_validation_report=report,
        )
        self.assertTrue(report["export_allowed"])
        self.assertEqual(len(cues), 1)
        self.assertIn("cars, trucks, and robots.", cues[0]["text"])
        self.assertEqual(cues[0]["text"], "One architecture\nacross cars, trucks, and robots.")

    def test_mandatory_sentence_6_proper_noun_pair_pepsico_and_sysco(self):
        sentence = "PepsiCo and Sysco have already logged millions of miles."
        report = {}
        cues = optimize_subtitles_v2(
            [_make_segment(sentence)],
            video_format="16:9",
            max_lines=2,
            debug_validation_report=report,
        )
        self.assertTrue(report["export_allowed"])
        self.assertTrue(any("PepsiCo and Sysco" in line for c in cues for line in c["text"].splitlines()))

    def test_mandatory_sentence_7_short_punch_line(self):
        sentence = "Shut it down."
        report = {}
        cues = optimize_subtitles_v2(
            [_make_segment(sentence)],
            video_format="16:9",
            max_lines=2,
            debug_validation_report=report,
        )
        self.assertTrue(report["export_allowed"])
        self.assertEqual(len(cues), 1)
        self.assertEqual(cues[0]["text"], "Shut it down.")

    def test_script_orthography_recovery_restores_brands_and_compact_units(self):
        asr_seg = _make_segment(
            "Pepsico and Sysco logged 1.55 kilowatt hours per mile for two hundred and ninety thousand dollars."
        )
        script = "PepsiCo and Sysco logged 1.55 kWh per mile for $290,000."
        words = build_word_sequence([asr_seg])
        recovered = recover_orthography_from_script(words, script, language="en")
        recovered_text = " ".join(w["text"] for w in recovered)
        self.assertIn("PepsiCo", recovered_text)
        self.assertIn("Sysco", recovered_text)
        self.assertIn("1.55 kWh per mile", recovered_text)
        self.assertIn("$290,000.", recovered_text)

    def test_profiles_and_anti_chunk_copy_invariant(self):
        p16 = get_profile("16:9", 2)
        p11 = get_profile("1:1", 2)
        p916 = get_profile("9:16", 2)
        self.assertEqual(p16.max_width, 32)
        self.assertEqual(p11.max_width, 29)
        self.assertEqual(p916.max_width, 26)

        seg = _make_segment("This is a test sentence with several words.")
        words = build_word_sequence([seg])
        cue_protected, _ = build_protected_boundary_map(words)
        cues = [{
            "index": 1,
            "start": 0.0,
            "end": 2.5,
            "text": "This is a test sentence\nwith several words.",
            "words": words,
        }]
        report = validate_final_cues(
            cues=cues,
            source_words=words,
            profile=p16,
            protected=cue_protected,
            audio_duration=1200.0,
            chunk_count=85,
        )
        self.assertFalse(report["export_allowed"])
        self.assertTrue(any(err["code"] == "CHUNK_COPY_DETECTED" for err in report["fatal_errors"]))

    def test_protected_product_and_policy_designators_never_split(self):
        cases = [
            (
                "When the grid goes down, your Powerwall 3 can automatically discharge to power your home.",
                "Powerwall 3",
            ),
            (
                "A battery like the Powerwall 3 is ultimately just a storage tank; it cannot lower your bills alone.",
                "Powerwall 3",
            ),
            (
                "In California, the introduction of a policy called NEM 3.0 dramatically slashed the credit value.",
                "NEM 3.0",
            ),
            (
                "Can the Tesla Powerwall 3 actually end your electric bills forever?",
                "Tesla Powerwall 3",
            ),
            (
                "Homeowners driving a Tesla Model 3 can charge directly from solar.",
                "Tesla Model 3",
            ),
        ]
        for sentence, entity in cases:
            with self.subTest(entity=entity):
                report = {}
                cues = optimize_subtitles_v2(
                    [_make_segment(sentence)],
                    video_format="16:9",
                    max_lines=2,
                    debug_validation_report=report,
                )
                self.assertTrue(report["export_allowed"])
                # Entity must appear intact on a single line of a single cue
                all_lines = [line for c in cues for line in c["text"].splitlines()]
                self.assertTrue(
                    any(entity in line for line in all_lines),
                    f"Expected '{entity}' intact on a single line, got lines: {all_lines}",
                )

    def test_protected_numbers_units_and_currencies_intact(self):
        sentence = (
            "The truck uses 1.55 kilowatt hours per mile, weighs 8,300 pounds empty, "
            "and costs $290,000 upfront."
        )
        # Simulate BPE split on "$290" + ",000" and "8" + ",300"
        seg = _make_segment(sentence)
        report = {}
        cues = optimize_subtitles_v2(
            [seg],
            video_format="16:9",
            max_lines=2,
            debug_validation_report=report,
        )
        self.assertTrue(report["export_allowed"])
        all_lines = [line for c in cues for line in c["text"].splitlines()]
        self.assertTrue(any("1.55 kilowatt hours" in line for line in all_lines))
        self.assertTrue(any("8,300 pounds" in line for line in all_lines))
        self.assertTrue(any("$290,000" in line for line in all_lines))

    def test_coordinate_noun_phrase_vs_clause_conjunction_en_and_vi(self):
        # 1. "I bought vegetables and eggs." -> must NOT split cue at "and"
        cues_np_en = optimize_subtitles_v2([_make_segment("I bought vegetables and eggs.")])
        self.assertEqual(len(cues_np_en), 1)
        self.assertIn("vegetables and eggs.", cues_np_en[0]["text"])

        # 2. "I went shopping and then I went home." -> CAN split at "and" when long enough
        long_clause_en = (
            "I went shopping at the local market this morning and then I went home to cook dinner."
        )
        cues_cl_en = optimize_subtitles_v2([_make_segment(long_clause_en)])
        self.assertGreaterEqual(len(cues_cl_en), 2)
        self.assertTrue(any(c["text"].startswith("and then") for c in cues_cl_en))

        # 3. "Tôi mua rau và trứng." -> must NOT split cue at "và"
        cues_np_vi = optimize_subtitles_v2([_make_segment("Tôi mua rau và trứng.")], language="vi")
        self.assertEqual(len(cues_np_vi), 1)
        self.assertIn("rau và trứng.", cues_np_vi[0]["text"])

        # 4. "Tôi đi chợ và sau đó tôi đi về." -> CAN split at "và" when clauses are long
        long_clause_vi = (
            "Tôi đi chợ mua thực phẩm vào buổi sáng và sau đó tôi đi về nhà nấu bữa tối."
        )
        cues_cl_vi = optimize_subtitles_v2([_make_segment(long_clause_vi)], language="vi")
        self.assertGreaterEqual(len(cues_cl_vi), 2)
        self.assertTrue(any(c["text"].startswith("và sau đó") for c in cues_cl_vi))

    def test_semantic_line_balancing_cue_4_and_subordinate_that_it_depends(self):
        # Cue 4: "For millions of Americans and Europeans," -> "For millions of Americans\nand Europeans,"
        cues_4 = optimize_subtitles_v2(
            [_make_segment("For millions of Americans and Europeans,")],
            video_format="16:9",
            max_lines=2,
        )
        self.assertEqual(len(cues_4), 1)
        self.assertEqual(cues_4[0]["text"], "For millions of Americans\nand Europeans,")

        # Cue 423-424: "The honest answer is that it depends entirely on who you are and where you live."
        cues_dep = optimize_subtitles_v2(
            [_make_segment("The honest answer is that it depends entirely on who you are and where you live.")],
            video_format="16:9",
            max_lines=2,
        )
        self.assertTrue(any("that it depends" in c["text"] for c in cues_dep))

    def test_asr_hallucination_verification_requires_acoustic_silence(self):
        import tempfile
        import wave

        seg1 = {
            "id": 1,
            "startSec": 27.34,
            "endSec": 29.00,
            "text": "a quiet rebellion is happening.",
            "words": [
                {"word": "a", "startSec": 27.34, "endSec": 27.50, "probability": 0.99},
                {"word": "quiet", "startSec": 27.50, "endSec": 27.88, "probability": 0.99},
                {"word": "rebellion", "startSec": 27.88, "endSec": 28.36, "probability": 0.99},
                {"word": "is", "startSec": 28.36, "endSec": 28.52, "probability": 0.99},
                {"word": "happening.", "startSec": 28.52, "endSec": 29.00, "probability": 0.99},
            ],
        }
        seg2 = {
            "id": 2,
            "startSec": 29.00,
            "endSec": 31.20,
            "text": "It's happening. Homeowners are seeing changes.",
            "words": [
                {"word": "It's", "startSec": 29.00, "endSec": 29.06, "probability": 0.41},
                {"word": "happening.", "startSec": 29.06, "endSec": 29.06, "probability": 0.0034},
                {"word": "Homeowners", "startSec": 29.36, "endSec": 29.96, "probability": 0.98},
                {"word": "are", "startSec": 29.96, "endSec": 30.20, "probability": 0.99},
                {"word": "seeing", "startSec": 30.20, "endSec": 30.60, "probability": 0.99},
                {"word": "changes.", "startSec": 30.60, "endSec": 31.20, "probability": 0.99},
            ],
        }

        # Case A: Without WAV file -> must NOT delete "It's happening.", must flag as kept_unverified
        report_no_wav = {}
        cues_no_wav = optimize_subtitles_v2(
            [seg1, seg2],
            wav_path=None,
            debug_validation_report=report_no_wav,
        )
        records_no_wav = report_no_wav["checks"]["asr_hallucinations"]["records"]
        self.assertEqual(len(records_no_wav), 1)
        self.assertFalse(records_no_wav[0]["verified_silent_hallucination"])
        self.assertEqual(records_no_wav[0]["action"], "kept_unverified")
        self.assertTrue(any("It's happening." in c["text"] for c in cues_no_wav))

        # Case B: With silent WAV file -> verified silent hallucination is removed
        with tempfile.TemporaryDirectory() as tmpdir:
            silent_wav = os.path.join(tmpdir, "silent.wav")
            sr = 16000
            with wave.open(silent_wav, "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(sr)
                wf.writeframes(b"\x00\x00" * (sr * 32))

            report_wav = {}
            cues_wav = optimize_subtitles_v2(
                [seg1, seg2],
                wav_path=silent_wav,
                debug_validation_report=report_wav,
            )
            records_wav = report_wav["checks"]["asr_hallucinations"]["records"]
            self.assertEqual(len(records_wav), 1)
            self.assertTrue(records_wav[0]["verified_silent_hallucination"])
            self.assertEqual(records_wav[0]["action"], "removed")
            self.assertFalse(any("It's happening." in c["text"] for c in cues_wav))

    def test_generate_srt_from_master_audio_auto_language_and_speech_speed_remapping(self):
        import tempfile
        import wave
        from unittest.mock import patch, MagicMock
        from voxlab_sidecar.subtitle_optimizer import generate_srt_from_master_audio
        from voxlab_sidecar.asr_engine import AsrLifecycleManager
        from voxlab_sidecar import audio_ops

        class _MockWord:
            def __init__(self, word, start, end, probability=0.99):
                self.word = word
                self.start = start
                self.end = end
                self.probability = probability

        class _MockSegment:
            def __init__(self, seg_id, start, end, text, words):
                self.id = seg_id
                self.start = start
                self.end = end
                self.text = text
                self.words = words

        class _MockInfo:
            duration = 12.5
            language = "en"

        captured_kwargs = {}

        class _MockWhisperModel:
            def transcribe(self, audio_path, **kwargs):
                captured_kwargs["audio_path"] = audio_path
                captured_kwargs.update(kwargs)
                # Simulated timestamps on 0.8x slowed audio: 10.0s -> 12.5s (which maps to 8.0s -> 10.0s original)
                seg = _MockSegment(
                    1,
                    10.0,
                    12.5,
                    "Welcome back to the channel.",
                    [
                        _MockWord("Welcome", 10.0, 10.5),
                        _MockWord("back", 10.5, 11.0),
                        _MockWord("to", 11.0, 11.4),
                        _MockWord("the", 11.4, 11.8),
                        _MockWord("channel.", 11.8, 12.5),
                    ],
                )
                return [seg], _MockInfo()

        mock_mgr = MagicMock()
        mock_mgr.get_or_load.return_value = _MockWhisperModel()
        mock_mgr.current_model_id = "large-v3-turbo"

        with tempfile.TemporaryDirectory() as tmpdir:
            wav_path = os.path.join(tmpdir, "sample.wav")
            sr = 16000
            with wave.open(wav_path, "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(sr)
                wf.writeframes(b"\x00\x00" * (sr * 10))

            # Verify audio_ops.probe returns accurate metadata
            probe_res = audio_ops.probe({"audioPath": wav_path})
            self.assertAlmostEqual(probe_res["durationSec"], 10.0, places=1)
            self.assertTrue(probe_res["hasAudioTrack"])

            with patch.object(
                AsrLifecycleManager,
                "get_instance",
                return_value=mock_mgr,
            ):
                res = generate_srt_from_master_audio(
                    audio_path=wav_path,
                    models_dir=tmpdir,
                    model_id="large-v3-turbo",
                    language="auto",
                    aspect_ratio="16:9",
                    max_lines=2,
                    speech_speed=0.8,
                )

            # Must pass language=None (never "auto") to faster-whisper
            self.assertIsNone(captured_kwargs.get("language"))
            self.assertEqual(res["language"], "en")
            self.assertEqual(len(res["cues"]), 1)
            # 10.0 * 0.8 = 8.0s, 12.5 * 0.8 = 10.0s (cue includes 40ms cinematic lead-in -> 7.96s)
            self.assertAlmostEqual(res["cues"][0]["startSec"], 7.96, places=2)
            self.assertAlmostEqual(res["cues"][0]["endSec"], 10.0, places=2)
            self.assertEqual(res["cues"][0]["text"], "Welcome back to the channel.")

    def test_modified_coordinate_noun_phrases_soaring_rates_and_failing_grids(self):
        # Tầng 3 — Yêu cầu A: [Mod1 + Noun1] and [Mod2 + Noun2] must keep each [Mod + Noun] intact
        sentence = "For millions of Americans and Europeans, this winter is a nightmare of soaring rates and failing grids."
        report = {}
        cues = optimize_subtitles_v2(
            [_make_segment(sentence)],
            video_format="16:9",
            max_lines=2,
            debug_validation_report=report,
        )
        self.assertTrue(report["export_allowed"])
        self.assertEqual(cues[0]["text"], "For millions of Americans\nand Europeans,")
        for c in cues:
            # Must NEVER split "soaring / rates" across lines
            self.assertNotIn("soaring\nrates", c["text"])
            self.assertNotIn("of soaring\n", c["text"])
        all_lines = [line for c in cues for line in c["text"].splitlines()]
        self.assertTrue(any("of soaring rates" in line for line in all_lines))
        self.assertTrue(any("and failing grids." in line for line in all_lines))

    def test_section_headers_isolated_from_following_sentences(self):
        # Tầng 3 — Yêu cầu B: Standalone chapter/section headers must NOT merge with following sentence
        header_cases = [
            (
                "The Trojan Horse On the surface, the pitch for a home battery sounds like pure common sense.",
                "The Trojan Horse",
                "On the surface,",
            ),
            (
                "The $10,000 Money Equation Now let's look at the financial argument.",
                "The $10,000 Money Equation",
                "Now let's look",
            ),
            (
                "The Hidden Catch Before we get to the biggest secret of all, we need to talk about hardware.",
                "The Hidden Catch",
                "Before we get",
            ),
        ]
        for text, expected_header, next_prefix in header_cases:
            cues = optimize_subtitles_v2(
                [_make_segment(text)],
                video_format="16:9",
                max_lines=2,
            )
            self.assertGreaterEqual(len(cues), 2, f"Expected header isolation for: {text}")
            flat_cue_0 = " ".join(cues[0]["text"].splitlines())
            self.assertEqual(flat_cue_0, expected_header)
            flat_cue_1 = " ".join(cues[1]["text"].splitlines())
            self.assertTrue(
                flat_cue_1.startswith(next_prefix),
                f"Expected cue 1 to start with '{next_prefix}', got '{flat_cue_1}'",
            )

    def test_compound_noun_modifier_wraps_and_phrasal_verbs_preserved(self):
        # Tầng 3 — Yêu cầu C:
        # 1. "to Europe's freezing energy squeeze," -> "to Europe's freezing\nenergy squeeze,"
        cues_squeeze = optimize_subtitles_v2(
            [_make_segment("From California's utility shocks, to Europe's freezing energy squeeze,")],
            video_format="16:9",
            max_lines=2,
        )
        self.assertEqual(len(cues_squeeze), 2)
        self.assertEqual(cues_squeeze[1]["text"], "to Europe's freezing\nenergy squeeze,")

        # 2. "But what if you could fight back?" -> must NOT leave "back?" alone on line 2
        cues_fight = optimize_subtitles_v2(
            [_make_segment("But what if you could fight back?")],
            video_format="16:9",
            max_lines=2,
        )
        self.assertEqual(len(cues_fight), 1)
        self.assertEqual(cues_fight[0]["text"], "But what if you\ncould fight back?")

    def test_negation_words_not_split_from_complement(self):
        # Tầng 3 — Yêu cầu D: Do not split immediately after negation ("is not", "does not", "should not")
        cues_neg = optimize_subtitles_v2(
            [_make_segment("Notice that the utility is not paying you cash for your energy.")],
            video_format="16:9",
            max_lines=2,
        )
        for c in cues_neg:
            for line in c["text"].splitlines():
                self.assertFalse(
                    line.endswith(" is not") or line.endswith(" does not") or line.endswith(" should not"),
                    f"Line should not end with bare negation: '{line}' in cue:\n{c['text']}",
                )

    def test_optimus_16_srt_phrase_boundaries_and_orthography_recovery(self):
        # 1. Pre-comma spillover & phrasal verb ("tore down"):
        # "you do not need to rely on marketing promises, you just need to look at what Tesla physically tore down inside its California factory."
        seg1 = _make_segment(
            "you do not need to rely on marketing promises, you just need to look at what Tesla physically tore down inside its California factory."
        )
        cues1 = optimize_subtitles_v2([seg1], video_format="16:9", max_lines=2)
        flat1 = [c["text"].replace("\n", " ") for c in cues1]
        self.assertTrue(
            any(t.endswith("marketing promises,") for t in flat1),
            f"Expected cue break at 'marketing promises,' without 1-word spillover: {flat1}",
        )
        self.assertTrue(
            any("tore down" in t for t in flat1),
            f"Expected phrasal verb 'tore down' to stay intact in the same cue: {flat1}",
        )

        # 2. Letter designators ("Option A", "Model S"), unit modifier with head noun ("2.3 kilowatt hour battery"),
        # and adjective modifier ("three-dimensional electronic skin"):
        seg2 = _make_segment(
            "Look at Option A with a 2.3 kilowatt hour battery and three-dimensional electronic skin and water resistant sealing,"
        )
        cues2 = optimize_subtitles_v2([seg2], video_format="16:9", max_lines=2)
        flat2 = [c["text"].replace("\n", " ") for c in cues2]
        self.assertTrue(any("Option A" in t for t in flat2), f"'Option A' split across cues: {flat2}")
        self.assertTrue(any("hour battery" in t for t in flat2), f"'hour battery' split across cues: {flat2}")
        self.assertTrue(any("electronic skin" in t for t in flat2), f"'electronic skin' split across cues: {flat2}")

        # 3. Phonetic/orthographic recovery ("optimists" -> "Optimus", "A I computing" -> "AI computing", "24-7." -> "24/7.")
        # and no 1-word orphan cue for "24/7." at sentence end:
        seg3 = _make_segment(
            "Elon Musk's emphasized the possibility of operating optimists with A I computing around the clock, 24-7."
        )
        script3 = "Elon Musk emphasized the possibility of operating Optimus with AI computing around the clock, 24/7."
        cues3 = optimize_subtitles_v2([seg3], video_format="16:9", max_lines=2, script_text=script3)
        joined3 = " ".join(c["text"].replace("\n", " ") for c in cues3)
        self.assertIn("Elon Musk emphasized", joined3)
        self.assertIn("Optimus", joined3)
        self.assertIn("AI computing", joined3)
        self.assertIn("24/7.", joined3)
        self.assertTrue(
            all(len(c["text"].split()) > 1 for c in cues3),
            f"Expected no 1-word orphan cue at sentence end: {[c['text'] for c in cues3]}",
        )


if __name__ == "__main__":
    unittest.main()

