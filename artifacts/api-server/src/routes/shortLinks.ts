import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, asc, desc, eq, gte, ne, sql } from "drizzle-orm";
import {
  db,
  shortLinksTable,
  shortLinkClicksTable,
  type ShortLink,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { audit, buildAuditDiff } from "../lib/audit";
import {
  generateBrandedQrPng,
  invalidateShortLinkCache,
  isValidSlug,
  normalizeSlug,
  publicShortUrl,
} from "../lib/shortLinks";
import { parseCsvAsObjects } from "../lib/csv";

const router: IRouter = Router();

const readGuard = [requireAuth];
const adminGuard = [requireAuth, requireRole("admin", "editor")];

function serialize(row: ShortLink) {
  return {
    id: row.id,
    slug: row.slug,
    targetUrl: row.targetUrl,
    title: row.title,
    notes: row.notes,
    statusCode: row.statusCode,
    active: row.active,
    tags: row.tags ?? [],
    hitCount: row.hitCount,
    lastClickAt: row.lastClickAt ? row.lastClickAt.toISOString() : null,
    rebrandlyId: row.rebrandlyId,
    publicUrl: publicShortUrl(row.slug),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const slugShape = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .transform((v) => normalizeSlug(v))
  .refine((v) => isValidSlug(v), {
    message:
      "Slug must start with a letter or digit and contain only [a-z0-9._-/].",
  });

const targetUrlShape = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .url({ message: "Target must be a fully-qualified http(s) URL" })
  .refine((v) => /^https?:\/\//i.test(v), {
    message: "Target must be http or https",
  });

const statusCodeShape = z
  .union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)])
  .optional();

const CreateBody = z.object({
  slug: slugShape,
  targetUrl: targetUrlShape,
  title: z.string().max(200).nullish(),
  notes: z.string().max(1000).nullish(),
  statusCode: statusCodeShape,
  active: z.boolean().optional(),
  tags: z.array(z.string().max(64)).max(32).optional(),
});
const UpdateBody = CreateBody.partial();

router.get("/cms/short-links", ...readGuard, async (_req, res) => {
  const rows = await db
    .select()
    .from(shortLinksTable)
    .orderBy(desc(shortLinksTable.updatedAt), asc(shortLinksTable.slug));
  res.json({ items: rows.map(serialize) });
});

router.post("/cms/short-links", ...adminGuard, async (req, res) => {
  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const existing = await db.query.shortLinksTable.findFirst({
    where: eq(shortLinksTable.slug, d.slug),
  });
  if (existing) {
    res.status(409).json({ error: "A short link with this slug already exists" });
    return;
  }
  const [row] = await db
    .insert(shortLinksTable)
    .values({
      slug: d.slug,
      targetUrl: d.targetUrl,
      title: d.title ?? null,
      notes: d.notes ?? null,
      statusCode: d.statusCode ?? 302,
      active: d.active ?? true,
      tags: d.tags ?? null,
      createdBy: req.authedUser?.id ?? null,
    })
    .returning();
  invalidateShortLinkCache();
  await audit({
    actorId: req.authedUser!.id,
    action: "short_link.create",
    entity: "short_link",
    entityId: row.id,
  });
  res.status(201).json(serialize(row));
});

router.patch("/cms/short-links/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.shortLinksTable.findFirst({
    where: eq(shortLinksTable.id, id),
  });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = UpdateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const updates: Partial<typeof shortLinksTable.$inferInsert> = {};
  if (d.slug !== undefined) {
    const conflict = await db.query.shortLinksTable.findFirst({
      where: and(
        eq(shortLinksTable.slug, d.slug),
        ne(shortLinksTable.id, id),
      ),
    });
    if (conflict) {
      res
        .status(409)
        .json({ error: "A short link with this slug already exists" });
      return;
    }
    updates.slug = d.slug;
  }
  if (d.targetUrl !== undefined) updates.targetUrl = d.targetUrl;
  if (d.title !== undefined) updates.title = d.title ?? null;
  if (d.notes !== undefined) updates.notes = d.notes ?? null;
  if (d.statusCode !== undefined) updates.statusCode = d.statusCode;
  if (d.active !== undefined) updates.active = d.active;
  if (d.tags !== undefined) updates.tags = d.tags;
  const [row] = await db
    .update(shortLinksTable)
    .set(updates)
    .where(eq(shortLinksTable.id, id))
    .returning();
  invalidateShortLinkCache();
  await audit({
    actorId: req.authedUser!.id,
    action: "short_link.update",
    entity: "short_link",
    entityId: id,
    diff: buildAuditDiff(existing as never, row as never),
  });
  res.json(serialize(row));
});

router.delete("/cms/short-links/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.shortLinksTable.findFirst({
    where: eq(shortLinksTable.id, id),
  });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await db.delete(shortLinksTable).where(eq(shortLinksTable.id, id));
  invalidateShortLinkCache();
  await audit({
    actorId: req.authedUser!.id,
    action: "short_link.delete",
    entity: "short_link",
    entityId: id,
  });
  res.status(204).end();
});

// ---- CSV import (Rebrandly export) ----------------------------------------
//
// Rebrandly's CSV columns vary by export type but reliably include:
//   id, slug (or shortUrl/slashtag), destination (or targetUrl/destinationUrl),
//   title, notes, tags, createdAt
// We accept any of the common header names so the same handler works for
// "Bulk Edit" and "All Links" exports.

const ImportRowSchema = z.object({
  slug: slugShape,
  targetUrl: targetUrlShape,
  title: z.string().max(200).nullish(),
  notes: z.string().max(1000).nullish(),
  tags: z.array(z.string().max(64)).max(32).optional(),
  rebrandlyId: z.string().max(64).nullish(),
});

const ImportBody = z.object({
  csv: z.string().min(1, "CSV body is empty"),
  // Default to "skip" — re-importing the same Rebrandly export should be a
  // no-op for rows already present.
  collisionPolicy: z.enum(["skip", "overwrite"]).default("skip"),
  defaultActive: z.boolean().default(true),
});

interface ImportSummary {
  imported: number;
  updated: number;
  skipped: number;
  errors: { row: number; slug?: string; error: string }[];
}

function pickField(
  row: Record<string, string>,
  ...candidates: string[]
): string | undefined {
  // Match headers case-insensitively and ignore surrounding whitespace.
  // Rebrandly uses camelCase; some users export with title-case.
  const keys = Object.keys(row);
  for (const c of candidates) {
    const want = c.toLowerCase().replace(/[\s_-]/g, "");
    const k = keys.find(
      (k) => k.toLowerCase().replace(/[\s_-]/g, "") === want,
    );
    if (k && row[k]) return row[k];
  }
  return undefined;
}

router.post("/cms/short-links/import", ...adminGuard, async (req, res) => {
  const parsed = ImportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const { csv, collisionPolicy, defaultActive } = parsed.data;
  let rows: Array<Record<string, string>>;
  try {
    rows = parseCsvAsObjects(csv);
  } catch (err) {
    res.status(400).json({ error: "Failed to parse CSV", details: String(err) });
    return;
  }
  const summary: ImportSummary = {
    imported: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rawSlug =
      pickField(row, "slug", "slashtag", "shortUrl", "keyword") ?? "";
    const rawTarget =
      pickField(row, "destination", "targetUrl", "destinationUrl", "longUrl") ??
      "";
    const tagsRaw = pickField(row, "tags", "tag");
    const candidate = {
      slug: rawSlug,
      targetUrl: rawTarget,
      title: pickField(row, "title", "name") ?? null,
      notes: pickField(row, "notes", "description") ?? null,
      tags: tagsRaw
        ? tagsRaw
            .split(/[|,;]/)
            .map((t) => t.trim())
            .filter(Boolean)
        : undefined,
      rebrandlyId: pickField(row, "id", "linkId") ?? null,
    };
    const ok = ImportRowSchema.safeParse(candidate);
    if (!ok.success) {
      summary.errors.push({
        row: i + 2, // +1 for header, +1 for 1-based row index
        slug: rawSlug || undefined,
        error: ok.error.issues.map((iss) => iss.message).join("; "),
      });
      continue;
    }
    const v = ok.data;
    try {
      const existing = await db.query.shortLinksTable.findFirst({
        where: eq(shortLinksTable.slug, v.slug),
      });
      if (existing) {
        if (collisionPolicy === "skip") {
          summary.skipped++;
          continue;
        }
        await db
          .update(shortLinksTable)
          .set({
            targetUrl: v.targetUrl,
            title: v.title ?? null,
            notes: v.notes ?? null,
            tags: v.tags ?? null,
            rebrandlyId: v.rebrandlyId ?? existing.rebrandlyId,
          })
          .where(eq(shortLinksTable.id, existing.id));
        summary.updated++;
      } else {
        await db.insert(shortLinksTable).values({
          slug: v.slug,
          targetUrl: v.targetUrl,
          title: v.title ?? null,
          notes: v.notes ?? null,
          statusCode: 302,
          active: defaultActive,
          tags: v.tags ?? null,
          rebrandlyId: v.rebrandlyId ?? null,
          createdBy: req.authedUser?.id ?? null,
        });
        summary.imported++;
      }
    } catch (err) {
      summary.errors.push({
        row: i + 2,
        slug: v.slug,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  invalidateShortLinkCache();
  await audit({
    actorId: req.authedUser!.id,
    action: "short_link.import",
    entity: "short_link",
    entityId: null,
    diff: { summary, collisionPolicy, totalRows: rows.length },
  });
  res.json({ summary });
});

// ---- QR code --------------------------------------------------------------
//
// Returns a PNG of the branded QR pointing at the canonical short URL. The
// payload is deterministic for a given (slug, size) pair, so we set a long
// `Cache-Control` so reverse proxies and browsers can serve it from cache.

router.get("/cms/short-links/:id/qr.png", ...readGuard, async (req, res) => {
  const id = String(req.params.id);
  const row = await db.query.shortLinksTable.findFirst({
    where: eq(shortLinksTable.id, id),
  });
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const size = Math.max(
    128,
    Math.min(2048, Number.parseInt(String(req.query.size ?? "512"), 10) || 512),
  );
  try {
    const png = await generateBrandedQrPng(publicShortUrl(row.slug), { size });
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    res.send(png);
  } catch (err) {
    res
      .status(500)
      .json({ error: "QR generation failed", details: String(err) });
  }
});

// ---- Stats ----------------------------------------------------------------
//
// Per-link click roll-up. Returns:
//   - daily counts for the last `days` (default 30) for sparkline rendering
//   - top referrers and countries over the same window
//   - unique-session approximation based on distinct ip hashes

router.get("/cms/short-links/:id/stats", ...readGuard, async (req, res) => {
  const id = String(req.params.id);
  const days = Math.max(
    1,
    Math.min(365, Number.parseInt(String(req.query.days ?? "30"), 10) || 30),
  );
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const link = await db.query.shortLinksTable.findFirst({
    where: eq(shortLinksTable.id, id),
  });
  if (!link) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const dailyRows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${shortLinkClicksTable.clickedAt}) at time zone 'utc', 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
    })
    .from(shortLinkClicksTable)
    .where(
      and(
        eq(shortLinkClicksTable.shortLinkId, id),
        gte(shortLinkClicksTable.clickedAt, since),
      ),
    )
    .groupBy(sql`date_trunc('day', ${shortLinkClicksTable.clickedAt})`)
    .orderBy(sql`date_trunc('day', ${shortLinkClicksTable.clickedAt})`);
  const referrerRows = await db
    .select({
      referrer: shortLinkClicksTable.referrer,
      count: sql<number>`count(*)::int`,
    })
    .from(shortLinkClicksTable)
    .where(
      and(
        eq(shortLinkClicksTable.shortLinkId, id),
        gte(shortLinkClicksTable.clickedAt, since),
      ),
    )
    .groupBy(shortLinkClicksTable.referrer)
    .orderBy(sql`count(*) desc`)
    .limit(10);
  const countryRows = await db
    .select({
      country: shortLinkClicksTable.country,
      count: sql<number>`count(*)::int`,
    })
    .from(shortLinkClicksTable)
    .where(
      and(
        eq(shortLinkClicksTable.shortLinkId, id),
        gte(shortLinkClicksTable.clickedAt, since),
      ),
    )
    .groupBy(shortLinkClicksTable.country)
    .orderBy(sql`count(*) desc`)
    .limit(10);
  const uniqueRows = await db
    .select({
      uniques: sql<number>`count(distinct ${shortLinkClicksTable.ipHash})::int`,
    })
    .from(shortLinkClicksTable)
    .where(
      and(
        eq(shortLinkClicksTable.shortLinkId, id),
        gte(shortLinkClicksTable.clickedAt, since),
      ),
    );
  res.json({
    windowDays: days,
    totalClicks: link.hitCount,
    uniqueSessions: uniqueRows[0]?.uniques ?? 0,
    daily: dailyRows,
    topReferrers: referrerRows.map((r: { referrer: string | null; count: number }) => ({
      referrer: r.referrer ?? "(direct)",
      count: r.count,
    })),
    topCountries: countryRows.map((r: { country: string | null; count: number }) => ({
      country: r.country ?? "(unknown)",
      count: r.count,
    })),
  });
});

export default router;
