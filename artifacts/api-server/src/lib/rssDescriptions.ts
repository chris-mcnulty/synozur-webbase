/**
 * RSS feed description helpers.
 *
 * Exported so they can be unit-tested independently of the HTTP route.
 * Used by routes/insights.ts to build the <description> element for each
 * post in the RSS feed.
 */

// Strip HTML tags and collapse whitespace to produce plain text.
export const htmlToText = (html: string): string =>
  html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<\/li>/gi, " ")
    .replace(/<\/h[1-6]>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Returns true when the string ends with sentence-final punctuation —
// optionally followed by a closing quote or paren — indicating a complete
// thought rather than a fragment.
export const looksComplete = (s: string): boolean =>
  /[.!?]["')\u2019\u201d]?\s*$/.test(s);

// Match the Wix abstract behaviour: use up to ~480 chars (the Wix abstract
// field cap), trimming at the last sentence boundary within that window.
// Beyond 480 chars fall back to a word boundary and append "…" so the cut
// looks intentional.
export const ABSTRACT_MAX = 480;

export const trimToSentence = (text: string, maxLen = ABSTRACT_MAX): string => {
  if (text.length <= maxLen) return text;
  // Find the last sentence boundary before maxLen.
  const window = text.slice(0, maxLen);
  const lastDot = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("! "),
    window.lastIndexOf("? "),
  );
  if (lastDot >= 0) return text.slice(0, lastDot + 1).trim();
  // No sentence boundary — fall back to last word boundary + ellipsis.
  const lastSpace = window.lastIndexOf(" ");
  return text.slice(0, lastSpace > 0 ? lastSpace : maxLen).trim() + "…";
};

// Minimal shape required from a post record.
export interface PostForDescription {
  excerpt?: string | null;
  seoDescription?: string | null;
  bodyHtml?: string | null;
}

// Derive the best plain-text description for a post in priority order:
//   1. excerpt (author-written summary, best) — only if it looks complete
//   2. seoDescription (curated meta copy)
//   3. First paragraph(s) of body plain text (fallback)
//
// Wix-imported excerpts are sometimes exactly 500 chars, ending mid-word.
// We detect those by checking that the text ends with sentence-ending
// punctuation (after optional closing quotes/parens), and fall through to
// the next source when it does not.
export const descriptionFor = (p: PostForDescription): string => {
  const exc = p.excerpt?.trim();
  if (exc && looksComplete(exc)) {
    return trimToSentence(exc);
  }
  const seo = p.seoDescription?.trim();
  if (seo && looksComplete(seo)) {
    const trimmed = trimToSentence(seo);
    return looksComplete(trimmed) ? trimmed : seo;
  }
  if (p.bodyHtml) {
    const text = htmlToText(p.bodyHtml);
    return trimToSentence(text);
  }
  // Last resort: use the excerpt/seoDescription even if incomplete.
  if (exc) return trimToSentence(exc);
  if (seo) return trimToSentence(seo);
  return "";
};
