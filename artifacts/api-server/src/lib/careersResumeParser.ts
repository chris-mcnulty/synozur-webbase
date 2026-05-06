import { logger } from "./logger";

interface ParsedResume {
  fullName?: string;
  email?: string;
  phone?: string;
  linkedinUrl?: string;
  education?: string;
  experience?: string;
}

export async function extractTextFromBuffer(
  buf: Buffer,
  mime: string,
  originalName?: string | null,
): Promise<string> {
  const ext = (originalName ?? "").toLowerCase().split(".").pop() ?? "";
  const isDocx =
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === "docx";
  const isDoc = mime === "application/msword" || ext === "doc";
  const isPdf = mime === "application/pdf" || ext === "pdf";

  if (isDocx || isDoc) {
    try {
      const mammoth = (await import("mammoth")).default;
      const result = await mammoth.extractRawText({ buffer: buf });
      return result.value;
    } catch (err) {
      logger.warn({ err }, "careers-resume-parser: mammoth extraction failed, falling back to utf-8");
      return buf.toString("utf-8");
    }
  }

  if (isPdf) {
    try {
      const pdfParse = (await import("pdf-parse")).default;
      const result = await pdfParse(buf);
      return result.text;
    } catch (err) {
      logger.warn({ err }, "careers-resume-parser: pdf-parse failed, falling back to utf-8");
      return buf.toString("utf-8");
    }
  }

  return buf.toString("utf-8");
}

export async function parseResumeText(text: string): Promise<ParsedResume> {
  const cleaned = text
    .replace(/[^\x20-\x7E\n\r\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 15000);

  if (
    !process.env["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"] ||
    !process.env["AI_INTEGRATIONS_ANTHROPIC_API_KEY"]
  ) {
    logger.info("careers-resume-parser: no AI proxy configured, returning empty parse");
    return {};
  }

  try {
    const { anthropic } = await import("@workspace/integrations-anthropic-ai");

    const prompt = `Parse this resume and extract structured information. Return ONLY valid JSON with these fields (use null for missing):
- fullName: candidate's full name
- email: email address
- phone: phone number
- linkedinUrl: LinkedIn URL if present
- education: plain text, each degree on a new line (e.g. "MBA, Boston College, 2015\\nFocused on Finance")
- experience: plain text, each role on a new line (e.g. "CTO, Synozur, 2024-Present\\nLed technical vision")

Resume text:
${cleaned}`;

    const resp = await anthropic.messages.create({
      model: "claude-3-5-haiku-latest",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = resp.content[0]?.type === "text" ? resp.content[0].text : "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return {};
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;

    return {
      fullName: typeof parsed.fullName === "string" ? parsed.fullName : undefined,
      email: typeof parsed.email === "string" ? parsed.email : undefined,
      phone: typeof parsed.phone === "string" ? parsed.phone : undefined,
      linkedinUrl: typeof parsed.linkedinUrl === "string" ? parsed.linkedinUrl : undefined,
      education: typeof parsed.education === "string" ? parsed.education : undefined,
      experience: typeof parsed.experience === "string" ? parsed.experience : undefined,
    };
  } catch (err) {
    logger.warn({ err }, "careers-resume-parser: AI parse failed");
    return {};
  }
}
