import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseSubtitleContent,
  parseTimestampSec,
  stripSubtitleMarkup,
} from "../parser";

describe("SRT / WebVTT Parser & Speaker Normalization Suite (TASK-07)", () => {
  it("parses standard SubRip (.srt) cues with comma timestamps and sequential indices", () => {
    const srtContent = `1
00:00:01,000 --> 00:00:03,500
Xin chào các bạn đã đến với VoxLab.

2
00:00:04,100 --> 00:00:07,850
Hôm nay chúng ta sẽ thử nghiệm mô hình mới.
`;

    const cues = parseSubtitleContent(srtContent);
    assert.equal(cues.length, 2);
    assert.equal(cues[0].index, 1);
    assert.equal(cues[0].startSec, 1.0);
    assert.equal(cues[0].endSec, 3.5);
    assert.equal(cues[0].text, "Xin chào các bạn đã đến với VoxLab.");

    assert.equal(cues[1].index, 2);
    assert.equal(cues[1].startSec, 4.1);
    assert.equal(cues[1].endSec, 7.85);
    assert.equal(cues[1].text, "Hôm nay chúng ta sẽ thử nghiệm mô hình mới.");
  });

  it("parses WebVTT (.vtt) with dot timestamps and optional hour component", () => {
    const vttContent = `WEBVTT
NOTE This is a test comment block
that should be ignored by the parser

01:15.500 --> 01:18.250
Đoạn phụ đề không có trường giờ.

00:02:10.123 --> 00:02:15.456 align:middle line:90%
Đoạn phụ đề có chứa cue settings phía sau.
`;

    const cues = parseSubtitleContent(vttContent);
    assert.equal(cues.length, 2);
    assert.equal(cues[0].startSec, 75.5);
    assert.equal(cues[0].endSec, 78.25);
    assert.equal(cues[0].text, "Đoạn phụ đề không có trường giờ.");

    assert.equal(cues[1].startSec, 130.123);
    assert.equal(cues[1].endSec, 135.456);
    assert.equal(cues[1].text, "Đoạn phụ đề có chứa cue settings phía sau.");
  });

  it("normalizes WebVTT speaker tags <v SpeakerName> into text 'SpeakerName: ...' (AC-29)", () => {
    const vttWithSpeakers = `WEBVTT

00:00:01.000 --> 00:00:04.000
<v Alice>Chào Bob, hôm nay bạn thế nào?</v>

00:00:04.500 --> 00:00:08.000
<v.bold Bob Miller>Mình rất khỏe, cảm ơn bạn!
`;

    const cues = parseSubtitleContent(vttWithSpeakers);
    assert.equal(cues.length, 2);
    assert.equal(cues[0].text, "Alice: Chào Bob, hôm nay bạn thế nào?");
    assert.equal(cues[1].text, "Bob Miller: Mình rất khỏe, cảm ơn bạn!");
  });

  it("strips HTML/formatting tags (<b>, <i>, <font>, <ruby>) and inline timestamps while preserving content", () => {
    const rawMarkup = `<b>Xin chào</b>, đây là <i>VoxLab</i> <font color="#ff0000">AI</font> <00:00:02.100>Audio.`;
    const cleaned = stripSubtitleMarkup(rawMarkup);
    assert.equal(cleaned, "Xin chào, đây là VoxLab AI Audio.");
  });

  it("preserves semantic speaker labels already present in plain text", () => {
    const text = `Speaker 1: Đây là nhãn người nói dạng văn bản.\n[Alice]: Nhãn trong ngoặc vuông.\n- Lời thoại bắt đầu bằng gạch ngang.`;
    const cleaned = stripSubtitleMarkup(text);
    assert.equal(cleaned, text);
  });

  it("handles CRLF windows line endings cleanly", () => {
    const crlfSrt = "1\r\n00:00:01,000 --> 00:00:02,000\r\nDòng 1\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nDòng 2\r\n";
    const cues = parseSubtitleContent(crlfSrt);
    assert.equal(cues.length, 2);
    assert.equal(cues[0].text, "Dòng 1");
    assert.equal(cues[1].text, "Dòng 2");
  });

  it("throws clear error on empty content", () => {
    assert.throws(() => parseSubtitleContent("   "), /rỗng hoặc chỉ chứa khoảng trắng/);
  });

  it("throws clear error when startSec >= endSec", () => {
    const invalidTiming = `1
00:00:05,000 --> 00:00:03,000
Thời gian ngược
`;
    assert.throws(() => parseSubtitleContent(invalidTiming), /phải nhỏ hơn thời điểm kết thúc/);
  });

  it("correctly parses parseTimestampSec helper", () => {
    assert.equal(parseTimestampSec("00:01:23.456"), 83.456);
    assert.equal(parseTimestampSec("00:01:23,456"), 83.456);
    assert.equal(parseTimestampSec("01:23.456"), 83.456);
    assert.throws(() => parseTimestampSec("invalid"), /Định dạng timestamp không hợp lệ/);
  });
});
