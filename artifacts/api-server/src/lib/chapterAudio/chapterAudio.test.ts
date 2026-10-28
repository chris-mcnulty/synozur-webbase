import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { extractChapter, markdownNarration, splitNarration, wordCount, MAX_WORDS } from "./text";
import { canUseChapterAudio } from "./access";

test("only approved human editorial roles can use chapter audio", () => {
  for (const role of ["admin", "site_admin", "editor", "content_author"]) {
    assert.equal(canUseChapterAudio({ authProvider: "entra", roles: [role] }), true);
    assert.equal(canUseChapterAudio({ authProvider: null, roles: [role] }), true);
  }
  for (const role of ["author", "contributor", "registered", "customer", "client", "internal", "hr"]) {
    assert.equal(canUseChapterAudio({ authProvider: "entra", roles: [role] }), false);
  }
  assert.equal(canUseChapterAudio({ authProvider: "api_key", roles: ["admin"] }), false);
  assert.equal(canUseChapterAudio(undefined), false);
});

test("Markdown retains chapter wording while separating explicit footnotes", () => {
  const result = markdownNarration("# Chapter One\n\nRead the [white paper](https://example.com).[^1]\n\n[^1]: This is a note.\n    More note text.");
  assert.equal(result.text, "Chapter One\n\nRead the white paper.");
  assert.equal(result.notes, "This is a note.\nMore note text.");
  assert.ok(!result.text.includes("https"));
  assert.equal(wordCount(result.text), 6);
});

test("text extraction does not guess at plain-text footnotes", async () => {
  const result = await extractChapter(Buffer.from("A chapter.\n\n1. A potentially important note."), "chapter.txt");
  assert.ok(result.text.includes("potentially important note"));
  assert.equal(result.notes, "");
  assert.ok(result.warnings.length);
});

test("rejects legacy Word, binary text and oversized uploads", async () => {
  await assert.rejects(extractChapter(Buffer.from("legacy"), "chapter.doc"), /Legacy/);
  await assert.rejects(extractChapter(Buffer.from([0, 1, 2]), "chapter.txt"), /binary/);
  await assert.rejects(extractChapter(Buffer.alloc(10 * 1024 * 1024 + 1), "chapter.docx"), /10 MB/);
  await assert.rejects(extractChapter(Buffer.from("not a zip"), "chapter.docx"));
});

test("Word extraction separates real footnotes from chapter text", async () => {
  const bytes = Buffer.from(zipSync({
    "[Content_Types].xml": strToU8(`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`),
    "_rels/.rels": strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`),
    "word/document.xml": strToU8(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Faithful chapter text.</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p></w:body></w:document>`),
    "word/_rels/document.xml.rels": strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/></Relationships>`),
    "word/footnotes.xml": strToU8(`<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="1"><w:p><w:r><w:t>Useful chapter note.</w:t></w:r></w:p></w:footnote></w:footnotes>`),
  }));
  const result = await extractChapter(bytes, "chapter.docx");
  assert.equal(result.text, "Faithful chapter text.");
  assert.equal(result.notes, "Useful chapter note.");
});

test("a 10,000-word chapter splits into bounded sections without losing words", () => {
  const source = Array.from({ length: MAX_WORDS }, (_, i) => `word${i}`).join(" ");
  const sections = splitNarration(source);
  assert.ok(sections.length > 10);
  assert.ok(sections.every(s => s.length <= 3000));
  assert.equal(sections.join(" ").replace(/\s+/g, " "), source);
  assert.throws(() => splitNarration("a".repeat(3001)), /too long/);
});

test("Word zip expansion is bounded before document parsing", async () => {
  const bytes = Buffer.from(zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "oversized.xml": new Uint8Array(31 * 1024 * 1024),
  }));
  await assert.rejects(extractChapter(bytes, "chapter.docx"), /safe processing limit/);
});
