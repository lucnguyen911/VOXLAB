import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadScriptFromFile } from "../scriptLoader";

describe("Script Loader File Parser Suite", () => {
  it("loads and parses standard .txt plain text file", async () => {
    const content = "Xin chào các bạn.\nĐây là kịch bản thử nghiệm.";
    const blob = new Blob([content], { type: "text/plain" });
    const file = new File([blob], "kich_ban.txt", { type: "text/plain" });

    const result = await loadScriptFromFile(file);
    assert.equal(result.filename, "kich_ban.txt");
    assert.equal(result.format, "txt");
    assert.equal(result.text, content);
    assert.ok(result.wordCount > 5);
  });

  it("loads and cleans subtitle file extracting only dialogue text", async () => {
    const srtContent = `1
00:00:01,000 --> 00:00:03,500
Xin chào quý vị khán giả.

2
00:00:04,000 --> 00:00:07,200
Chào mừng quay trở lại với chương trình.`;

    const blob = new Blob([srtContent], { type: "text/plain" });
    const file = new File([blob], "subtitle.srt", { type: "text/plain" });

    const result = await loadScriptFromFile(file);
    assert.equal(result.filename, "subtitle.srt");
    assert.equal(result.format, "srt");
    assert.ok(!result.text.includes("00:00:01"));
    assert.ok(!result.text.includes("-->"));
    assert.ok(result.text.includes("Xin chào quý vị khán giả."));
    assert.ok(result.text.includes("Chào mừng quay trở lại với chương trình."));
  });

  it("rejects legacy .doc file with clear helpful error guidance", async () => {
    const blob = new Blob(["dummy binary"], { type: "application/msword" });
    const file = new File([blob], "old_document.doc", { type: "application/msword" });

    await assert.rejects(
      async () => loadScriptFromFile(file),
      /Định dạng .doc \(Word 97-2003\) cũ không được hỗ trợ/
    );
  });

  it("throws clear error on 0-byte file", async () => {
    const blob = new Blob([], { type: "text/plain" });
    const file = new File([blob], "zero_byte.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });

    await assert.rejects(
      async () => loadScriptFromFile(file),
      /hoàn toàn trống \(dung lượng 0 byte\)/
    );
  });

  it("throws error on empty text file", async () => {
    const blob = new Blob(["   \n\n  "], { type: "text/plain" });
    const file = new File([blob], "empty.txt", { type: "text/plain" });

    await assert.rejects(
      async () => loadScriptFromFile(file),
      /không chứa nội dung văn bản hợp lệ/
    );
  });
});
