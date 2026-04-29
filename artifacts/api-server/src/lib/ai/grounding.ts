import { and, asc, desc, eq } from "drizzle-orm";
import {
  db,
  groundingDocumentsTable,
  type GroundingCategory,
} from "@workspace/db";

// Standalone helpers for the AI grounding subsystem (Vega pattern).
//
// `buildSystemPrompt` composes the active grounding documents into a single
// markdown string suitable for use as the `system` parameter on a Claude API
// call. There is no LLM call here — that wiring lives in the Replit-side LLM
// connector, which imports this module to compose its system prompt.
//
// `pdfTextToMarkdown` is the lightweight cleanup applied to raw text extracted
// from PDFs (which lose semantic structure on generation). DOCX uploads use
// mammoth's native markdown converter instead and don't need this helper.

const CATEGORY_LABELS: Record<GroundingCategory, string> = {
  methodology: "Methodology & Framework",
  best_practices: "Best Practices",
  terminology: "Key Terminology",
  examples: "Examples & Templates",
  about_synozur: "About Synozur",
  brand_voice: "Brand Voice",
  audience_personas: "Audience Personas",
  concierge_persona: "Concierge Persona",
};

export interface BuildSystemPromptOptions {
  // Filter by audience class / sector / application tag. A doc with no
  // scope_tags matches everything; a doc with tags matches only when at
  // least one of its tags is in this set.
  scopeTags?: readonly string[];
  // When true, excludes docs marked concierge_eligible=false. Used by the
  // future Astra concierge surface so editors can keep an internal-history
  // doc on the public Q&A side without it shaping the sales chat.
  conciergeOnly?: boolean;
}

export async function buildSystemPrompt(
  options: BuildSystemPromptOptions = {},
): Promise<string> {
  const conditions = [eq(groundingDocumentsTable.isActive, true)];
  if (options.conciergeOnly) {
    conditions.push(eq(groundingDocumentsTable.conciergeEligible, true));
  }
  const rows = await db
    .select()
    .from(groundingDocumentsTable)
    .where(and(...conditions))
    .orderBy(
      desc(groundingDocumentsTable.priority),
      asc(groundingDocumentsTable.category),
      asc(groundingDocumentsTable.title),
    );

  const scope = options.scopeTags ?? [];
  const filtered = rows.filter((d) => {
    const tags = (d.scopeTags ?? []) as string[];
    if (tags.length === 0) return true;
    if (scope.length === 0) return false;
    return tags.some((t) => scope.includes(t));
  });

  if (filtered.length === 0) {
    return "";
  }

  const sections = filtered.map((d) => {
    const label = CATEGORY_LABELS[d.category as GroundingCategory] ?? d.category;
    return `### ${label}: ${d.title}\n${d.content}`;
  });
  return sections.join("\n\n");
}

// PDFs lose structure on generation, so this is intentionally light: collapse
// runs of intra-paragraph whitespace, treat blank lines as paragraph breaks,
// trim. Editors can post-edit in the form.
export function pdfTextToMarkdown(raw: string): string {
  const normalized = raw.replace(/\r\n?/g, "\n");
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0);
  return paragraphs.join("\n\n");
}
