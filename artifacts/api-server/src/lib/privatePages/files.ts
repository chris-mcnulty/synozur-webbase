import { createHash } from "node:crypto";
import mammoth from "mammoth";
import { unzipSync } from "fflate";
import { preparePrivateHtml } from "./html";

export const PRIVATE_FILE_TYPES = {
  html: { limit: 5 * 1024 * 1024, mime: "text/html; charset=utf-8", extension: ".html" },
  audio: { limit: 50 * 1024 * 1024, mime: "audio/mpeg", extension: ".mp3" },
  transcript: { limit: 10 * 1024 * 1024, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extension: ".docx" },
} as const;
export type AssetKind = keyof typeof PRIVATE_FILE_TYPES;
export const fileHash = (body: Buffer) => createHash("sha256").update(body).digest("hex");

export function validatePrivateFile(kind: AssetKind, filename: string, body: Buffer): void {
  const config = PRIVATE_FILE_TYPES[kind];
  if (!body.length || body.length > config.limit) throw new Error(`File exceeds the ${Math.round(config.limit / 1024 / 1024)} MB limit or is empty.`);
  if (filename.length > 240 || /[/\\\x00-\x1f]/.test(filename) || !filename.toLowerCase().endsWith(config.extension)) {
    throw new Error(`Use a valid ${config.extension} filename without paths.`);
  }
  if (kind === "html") {
    const source = new TextDecoder("utf-8", { fatal: true }).decode(body);
    preparePrivateHtml(source);
  } else if (kind === "audio") {
    if (!(body.subarray(0, 3).toString() === "ID3" || (body[0] === 0xff && (body[1]! & 0xe0) === 0xe0))) {
      throw new Error("The audio attachment is not an MP3.");
    }
  } else validateDocx(body);
}

function validateDocx(body: Buffer) {
  if (body[0] !== 0x50 || body[1] !== 0x4b) throw new Error("The narration script is not a DOCX.");
  let expanded = 0;
  // Inspect central-directory sizes before inflating anything; block zip bombs,
  // macro payloads and remote relationships. Never extract to the filesystem.
  const files = unzipSync(body, { filter(file) {
    expanded += file.originalSize;
    if (expanded > 30 * 1024 * 1024 || file.originalSize > 10 * 1024 * 1024) throw new Error("DOCX expands beyond safe limits.");
    if (/vbaProject|(^|\/)\.\.(\/|$)/i.test(file.name)) throw new Error("Unsupported DOCX content.");
    return file.name === "word/document.xml" || file.name.endsWith(".rels") || file.name === "[Content_Types].xml";
  } });
  if (!files["word/document.xml"] || !files["[Content_Types].xml"]) throw new Error("Invalid DOCX document.");
  for (const [name, data] of Object.entries(files)) {
    const xml = Buffer.from(data).toString("utf8");
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Unsupported DOCX entities.");
    if (name.endsWith(".rels") && /TargetMode\s*=\s*["']External["']/i.test(xml)) {
      // Text-only extraction does not resolve hyperlinks or remote targets.
      continue;
    }
  }
}

export async function narrationText(body: Buffer): Promise<string> {
  validateDocx(body);
  const { value } = await mammoth.extractRawText({ buffer: body });
  return value;
}
