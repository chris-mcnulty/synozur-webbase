import { and, eq } from "drizzle-orm";
import {
  db,
  editorialChunksTable,
  postsTable,
  caseStudiesTable,
  whitePapersTable,
  faqItemsTable,
  faqCategoriesTable,
  polarisEpisodesTable,
  applicationsTable,
  landingPagesTable,
  landingPageBlocks,
  type LandingPageBlock,
  type EditorialSourceKind,
} from "@workspace/db";

// Editorial corpus indexer. Chunks each published artifact and writes the
// rows into `editorial_chunks` for FTS retrieval. Stays simple by design:
// strip HTML tags, split on paragraph boundaries, group into ~chunkSize
// word chunks. This is phase-0 — vector embeddings are deferred (#170).

const CHUNK_WORDS = 500;

function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function chunkText(raw: string, chunkWords = CHUNK_WORDS): string[] {
  const normalized = raw.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];
  // Split on paragraph boundaries first so chunks rarely cross a topic break.
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0);

  const chunks: string[] = [];
  let current: string[] = [];
  let currentWords = 0;
  for (const p of paragraphs) {
    const words = p.split(/\s+/).length;
    if (currentWords + words > chunkWords && current.length > 0) {
      chunks.push(current.join("\n\n"));
      current = [];
      currentWords = 0;
    }
    if (words > chunkWords) {
      // Single oversized paragraph — split by word count.
      const tokens = p.split(/\s+/);
      for (let i = 0; i < tokens.length; i += chunkWords) {
        chunks.push(tokens.slice(i, i + chunkWords).join(" "));
      }
      continue;
    }
    current.push(p);
    currentWords += words;
  }
  if (current.length > 0) chunks.push(current.join("\n\n"));
  return chunks;
}

interface SourceRow {
  kind: EditorialSourceKind;
  id: string;
  title: string;
  url: string;
  text: string;
  updatedAt: Date | null;
}

// Apply the *same* visibility predicates as the public artifact routes —
// any drift here would let unpublished/expired/inactive material leak into
// the public Q&A surface. Mirrors:
//   - posts → routes/insights.ts
//   - case_studies → routes/caseStudies.ts
//   - white_papers → routes/whitePapers.ts
//   - faq → routes/faq.ts
//   - polaris → routes/polaris.ts
function isPublic(row: {
  status?: string | null;
  active?: boolean | null;
  deletedAt?: Date | null;
  publishedAt?: Date | null;
  unpublishedAt?: Date | null;
}, opts: { activeRequired?: boolean; publishedAtRequired?: boolean } = {}): boolean {
  const now = new Date();
  if (row.status !== "published") return false;
  if (row.deletedAt) return false;
  if (opts.activeRequired && row.active === false) return false;
  if (opts.publishedAtRequired) {
    if (!row.publishedAt || row.publishedAt > now) return false;
  } else if (row.publishedAt && row.publishedAt > now) {
    return false;
  }
  if (row.unpublishedAt && row.unpublishedAt <= now) return false;
  return true;
}

async function loadSources(): Promise<SourceRow[]> {
  const out: SourceRow[] = [];

  // Posts (Insights) — see routes/insights.ts
  const posts = await db
    .select({
      id: postsTable.id,
      slug: postsTable.slug,
      title: postsTable.title,
      excerpt: postsTable.excerpt,
      bodyMarkdown: postsTable.bodyMarkdown,
      bodyHtml: postsTable.bodyHtml,
      status: postsTable.status,
      publishedAt: postsTable.publishedAt,
      updatedAt: postsTable.updatedAt,
      deletedAt: postsTable.deletedAt,
    })
    .from(postsTable);
  for (const p of posts) {
    if (!isPublic(p)) continue;
    const text =
      [
        p.excerpt ?? "",
        p.bodyMarkdown ?? stripHtml(p.bodyHtml),
      ]
        .filter(Boolean)
        .join("\n\n") || "";
    if (!text.trim()) continue;
    out.push({
      kind: "post",
      id: p.id,
      title: p.title,
      url: `/insights/${p.slug}`,
      text,
      updatedAt: p.updatedAt,
    });
  }

  // Case studies — see routes/caseStudies.ts (active + publish window)
  const caseStudies = await db.select().from(caseStudiesTable);
  for (const c of caseStudies) {
    if (!isPublic(c, { activeRequired: true })) continue;
    const sections: string[] = [];
    if (c.summary) sections.push(c.summary);
    if (c.headline) sections.push(c.headline);
    if (c.challenge?.body?.length) {
      sections.push(`Challenge: ${c.challenge.body.join(" ")}`);
    }
    for (const a of c.approach ?? []) {
      if (a?.body?.length) sections.push(`${a.heading}: ${a.body.join(" ")}`);
    }
    if (c.outcome?.body?.length) {
      sections.push(`Outcome: ${c.outcome.body.join(" ")}`);
    }
    if (c.metrics?.length) {
      sections.push(
        `Metrics: ${c.metrics.map((m) => `${m.label} — ${m.value}`).join("; ")}`,
      );
    }
    if (c.quoteText) sections.push(`"${c.quoteText}" — ${c.quoteAttribution}`);
    const text = sections.join("\n\n");
    if (!text.trim()) continue;
    out.push({
      kind: "case_study",
      id: c.id,
      title: c.title || c.headline || c.client || c.slug,
      url: `/case-studies/${c.slug}`,
      text,
      updatedAt: c.updatedAt,
    });
  }

  // White papers — see routes/whitePapers.ts (publishedAt is required)
  const whitePapers = await db.select().from(whitePapersTable);
  for (const w of whitePapers) {
    if (!isPublic(w, { activeRequired: true, publishedAtRequired: true })) continue;
    const text = [w.shortDescription, stripHtml(w.bodyHtml)]
      .filter(Boolean)
      .join("\n\n");
    if (!text.trim()) continue;
    out.push({
      kind: "white_paper",
      id: w.id,
      title: w.title,
      url: `/library/${w.slug}`,
      text,
      updatedAt: w.updatedAt,
    });
  }

  // FAQ items — see routes/faq.ts. Both the item AND its category must be
  // publicly visible (active, status=published, within publish window).
  const faqItems = await db
    .select({
      id: faqItemsTable.id,
      slug: faqItemsTable.slug,
      question: faqItemsTable.question,
      answerHtml: faqItemsTable.answerHtml,
      status: faqItemsTable.status,
      active: faqItemsTable.active,
      deletedAt: faqItemsTable.deletedAt,
      publishedAt: faqItemsTable.publishedAt,
      unpublishedAt: faqItemsTable.unpublishedAt,
      categorySlug: faqCategoriesTable.slug,
      categoryStatus: faqCategoriesTable.status,
      categoryActive: faqCategoriesTable.active,
      categoryDeletedAt: faqCategoriesTable.deletedAt,
      categoryPublishedAt: faqCategoriesTable.publishedAt,
      categoryUnpublishedAt: faqCategoriesTable.unpublishedAt,
      updatedAt: faqItemsTable.updatedAt,
    })
    .from(faqItemsTable)
    .leftJoin(
      faqCategoriesTable,
      eq(faqItemsTable.categoryId, faqCategoriesTable.id),
    );
  for (const f of faqItems) {
    if (!isPublic(f, { activeRequired: true })) continue;
    if (
      f.categorySlug &&
      !isPublic(
        {
          status: f.categoryStatus,
          active: f.categoryActive,
          deletedAt: f.categoryDeletedAt,
          publishedAt: f.categoryPublishedAt,
          unpublishedAt: f.categoryUnpublishedAt,
        },
        { activeRequired: true },
      )
    ) {
      continue;
    }
    const text = stripHtml(f.answerHtml);
    if (!text.trim()) continue;
    const anchor = f.categorySlug
      ? `/faq#${f.categorySlug}/${f.slug}`
      : `/faq#${f.slug}`;
    out.push({
      kind: "faq",
      id: f.id,
      title: f.question,
      url: anchor,
      text,
      updatedAt: f.updatedAt,
    });
  }

  // Polaris episodes — see routes/polaris.ts
  const polaris = await db.select().from(polarisEpisodesTable);
  for (const e of polaris) {
    if (!isPublic(e, { activeRequired: true })) continue;
    const text = [e.summary, stripHtml(e.transcriptHtml)]
      .filter(Boolean)
      .join("\n\n");
    if (!text.trim()) continue;
    out.push({
      kind: "polaris",
      id: e.id,
      title: `Polaris ${e.episodeNumber}: ${e.title}`,
      url: `/polaris/${e.slug}`,
      text,
      updatedAt: e.updatedAt,
    });
  }

  // Landing pages — hero/richText/cardGrid/cta/faq blocks extracted as plain
  // text so Ask Synozur can surface resource pages like "AI Training" or
  // "Microsoft Partner Journey" in cited answers. Image blocks are skipped
  // (no indexable text). Uses the same isPublic predicate as the public
  // landing-page route (status=published, active, within publish window).
  const landingPages = await db.select().from(landingPagesTable);
  for (const lp of landingPages) {
    if (!isPublic(lp, { activeRequired: true })) continue;
    const blocks = landingPageBlocks(lp);
    const parts: string[] = [];
    for (const block of blocks as LandingPageBlock[]) {
      if (block.type === "hero") {
        if (block.eyebrow) parts.push(block.eyebrow);
        parts.push(block.title);
        if (block.subtitle) parts.push(block.subtitle);
      } else if (block.type === "richText") {
        if (block.heading) parts.push(block.heading);
        parts.push(stripHtml(block.bodyHtml));
      } else if (block.type === "cardGrid") {
        if (block.heading) parts.push(block.heading);
        if (block.intro) parts.push(block.intro);
        for (const card of block.cards) {
          parts.push(card.title);
          if (card.description) parts.push(card.description);
        }
      } else if (block.type === "cta") {
        parts.push(block.heading);
        if (block.body) parts.push(block.body);
      } else if (block.type === "faq") {
        if (block.heading) parts.push(block.heading);
        for (const item of block.items) {
          parts.push(item.q);
          parts.push(item.a);
        }
      }
      // "image" blocks have no indexable text — skipped intentionally.
    }
    const text = parts
      .map((s) => s.trim())
      .filter(Boolean)
      .join("\n\n");
    if (!text.trim()) continue;
    out.push({
      kind: "landing_page",
      id: lp.id,
      title: lp.title,
      url: `/${lp.slug}`,
      text,
      updatedAt: lp.updatedAt,
    });
  }

  // Applications (Orion, Vega, Nebula, etc.) — see routes/applications.ts.
  // Combines tagline + shortSummary + descriptionParagraphs so Ask Synozur
  // can answer product questions ("What is Orion?", "How does Vega work?")
  // with grounded, cited answers that link to the application page.
  const applications = await db.select().from(applicationsTable);
  for (const a of applications) {
    if (!isPublic(a, { activeRequired: true })) continue;
    const paras = Array.isArray(a.descriptionParagraphs)
      ? (a.descriptionParagraphs as string[])
      : [];
    const text = [a.tagline, a.shortSummary, ...paras]
      .map((s) => s?.trim())
      .filter(Boolean)
      .join("\n\n");
    if (!text.trim()) continue;
    out.push({
      kind: "application",
      id: a.id,
      title: a.title || a.name,
      url: `/applications/${a.slug}`,
      text,
      updatedAt: a.updatedAt,
    });
  }

  return out;
}

export interface ReindexResult {
  sources: number;
  chunks: number;
  removed: number;
}

export async function reindexEditorialCorpus(): Promise<ReindexResult> {
  const sources = await loadSources();
  let chunkCount = 0;

  // Track which (kind, id) pairs are still live so we can prune the rest.
  const liveKeys = new Set<string>();

  for (const src of sources) {
    const chunks = chunkText(src.text);
    if (chunks.length === 0) continue;
    liveKeys.add(`${src.kind}:${src.id}`);
    // Replace existing chunks for this source atomically.
    await db
      .delete(editorialChunksTable)
      .where(
        and(
          eq(editorialChunksTable.sourceKind, src.kind),
          eq(editorialChunksTable.sourceId, src.id),
        ),
      );
    const rows = chunks.map((text, i) => ({
      sourceKind: src.kind,
      sourceId: src.id,
      chunkIndex: i,
      title: src.title,
      url: src.url,
      text,
      sourceUpdatedAt: src.updatedAt,
    }));
    await db.insert(editorialChunksTable).values(rows);
    chunkCount += rows.length;
  }

  // Prune chunks for sources that are no longer published.
  const existing = await db
    .select({
      kind: editorialChunksTable.sourceKind,
      id: editorialChunksTable.sourceId,
    })
    .from(editorialChunksTable);
  const stale = new Set<string>();
  for (const row of existing) {
    const key = `${row.kind}:${row.id}`;
    if (!liveKeys.has(key)) stale.add(key);
  }
  let removed = 0;
  for (const key of stale) {
    const [kind, id] = key.split(":") as [EditorialSourceKind, string];
    const res = await db
      .delete(editorialChunksTable)
      .where(
        and(
          eq(editorialChunksTable.sourceKind, kind),
          eq(editorialChunksTable.sourceId, id),
        ),
      );
    removed += res.rowCount ?? 0;
  }

  return {
    sources: liveKeys.size,
    chunks: chunkCount,
    removed,
  };
}

// Re-index a single artifact (fired from publish/update lifecycle hooks).
export async function reindexEditorialSource(
  kind: EditorialSourceKind,
  id: string,
): Promise<void> {
  const all = await loadSources();
  const match = all.find((s) => s.kind === kind && s.id === id);
  if (!match) {
    // Source no longer published — drop any stale chunks.
    await db
      .delete(editorialChunksTable)
      .where(
        and(
          eq(editorialChunksTable.sourceKind, kind),
          eq(editorialChunksTable.sourceId, id),
        ),
      );
    return;
  }
  const chunks = chunkText(match.text);
  await db
    .delete(editorialChunksTable)
    .where(
      and(
        eq(editorialChunksTable.sourceKind, kind),
        eq(editorialChunksTable.sourceId, id),
      ),
    );
  if (chunks.length === 0) return;
  await db.insert(editorialChunksTable).values(
    chunks.map((text, i) => ({
      sourceKind: match.kind,
      sourceId: match.id,
      chunkIndex: i,
      title: match.title,
      url: match.url,
      text,
      sourceUpdatedAt: match.updatedAt,
    })),
  );
}

