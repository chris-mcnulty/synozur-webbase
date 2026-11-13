import mammoth from "mammoth";
import { unzipSync } from "fflate";
import { marked } from "marked";

export const MAX_WORDS = 10_000;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const STANDARD_SAMPLE = "Welcome to Synozur. Every meaningful change begins with a clear understanding of where we are and what we want to achieve. This sample demonstrates the voice, pace, and expression you can expect when listening to your chapter.";

export function wordCount(text: string): number {
  return text.trim().split(/\s+/u).filter(Boolean).length;
}

function htmlText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, "")
    .replace(/<\/(?:p|h[1-6]|li|tr|blockquote)>|<br\s*\/?>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function markdownNarration(input: string): { text: string; notes: string; warnings: string[] } {
  const notes: string[] = [];
  const warnings: string[] = [];
  // Only explicit Markdown footnote definitions are removed. Ambiguous prose is retained.
  const body = input.replace(/^\[\^([^\]]+)\]:[ \t]*(.*)(?:\n(?: {4}|\t).*)*/gm, (match, _id: string) => {
    notes.push(match.replace(/^\[\^[^\]]+\]:\s*/, "").replace(/\n(?: {4}|\t)/g, "\n"));
    return "";
  }).replace(/\[\^[^\]]+\]/g, "");
  if (/\|.+\|/.test(body)) warnings.push("Tables were converted to text. Check reading order before generating.");
  if (/footnote|endnote/i.test(body)) warnings.push("Possible notes remain in the text. Review them before generating.");
  return {
    text: htmlText(marked.parse(body.replace(/!\[[^\]]*\]\([^)]*\)/g, ""), { async: false }) as string),
    notes: notes.map(n => htmlText(marked.parse(n, { async: false }) as string)).join("\n\n"),
    warnings,
  };
}

export async function extractChapter(bytes: Buffer, filename: string) {
  if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) throw new Error("Choose a non-empty file no larger than 10 MB.");
  const extension = filename.toLowerCase().split(".").pop();
  if (!["txt", "md", "markdown", "docx"].includes(extension ?? "")) {
    throw new Error("Supported files are .txt, .md, and Word .docx. Legacy .doc files must be saved as .docx first.");
  }
  if (extension === "docx") {
    let expanded = 0;
    let entries = 0;
    // Inspect declared uncompressed sizes before mammoth can inflate the document.
    const zip = unzipSync(bytes, {
      filter(entry) {
        expanded += entry.originalSize;
        entries++;
        if (expanded > 30 * 1024 * 1024 || entries > 2000) throw new Error("This Word document expands beyond the safe processing limit.");
        return entry.name === "[Content_Types].xml";
      },
    });
    if (!zip["[Content_Types].xml"]) throw new Error("The file is not a valid Word .docx document.");
    const result = await mammoth.convertToHtml({ buffer: bytes });
    const notes: string[] = [];
    const html = result.value.replace(/<li\b[^>]*id="(?:footnote|endnote)-[^"]*"[^>]*>([\s\S]*?)<\/li>/gi, (_, body: string) => {
      notes.push(htmlText(body.replace(/<a\b[^>]*href="#(?:footnote|endnote)-ref-[^"]*"[^>]*>[\s\S]*?<\/a>/gi, "")));
      return "";
    });
    const warnings = result.messages.map(() => "Some Word formatting could not be preserved. Review the extracted text.");
    if (/<table\b/i.test(html)) warnings.push("This document contains tables. Review their spoken reading order.");
    if (/<img\b/i.test(html)) warnings.push("Images are not narrated. Add any essential descriptions yourself.");
    const text = htmlText(html);
    return { text, notes: notes.join("\n\n"), warnings: [...new Set(warnings)], wordCount: wordCount(text) };
  }
  const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  if (raw.includes("\0")) throw new Error("The document must contain UTF-8 text, not binary data.");
  const result = extension === "txt"
    ? { text: raw.trim(), notes: "", warnings: ["Plain-text footnotes cannot be reliably identified. Review the text and move any notes into the Chapter notes field."] }
    : markdownNarration(raw);
  return { ...result, wordCount: wordCount(result.text) };
}

export function splitNarration(text: string, maxCharacters = 3000): string[] {
  const chunks: string[] = [];
  let current = "";
  const sentences = text.match(/[^.!?\n]+(?:[.!?]+(?:["')\]]+)?|\n+|$)/gu) ?? [text];
  // Splitting oversized sentences on whitespace also bounds SSML byte size.
  for (const sentence of sentences) {
    for (const word of sentence.trim().split(/\s+/u).filter(Boolean)) {
      if (word.length > maxCharacters) throw new Error("A word or URL is too long to narrate. Shorten it before generating.");
      if (current.length + word.length + 1 > maxCharacters) {
        chunks.push(current.trim());
        current = "";
      }
      current += `${word} `;
    }
    if (current) current = `${current.trim()}\n`;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
