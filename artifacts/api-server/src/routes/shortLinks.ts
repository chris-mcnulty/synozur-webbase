import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, asc, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import {
  db,
  shortLinksTable,
  shortLinkClicksTable,
  siteSettingsTable,
  type ShortLink,
} from "@workspace/db";
import { requireAuth, requireCapability } from "../middlewares/auth";
import { audit, buildAuditDiff } from "../lib/audit";
import {
  generateBrandedQrPng,
  getRebrandlyApiKey,
  getShortLinkSettings,
  invalidateShortLinkCache,
  invalidateShortLinkSettingsCache,
  isValidSlug,
  normalizeSlug,
} from "../lib/shortLinks";
import { parseCsvAsObjects } from "../lib/csv";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Capability-based gating (preferred over role checks since #111). The
// admin sidebar entry uses `site.manage`, so reads and writes are gated on
// the same capability — capability remappings via the role/capability
// admin survive without code changes here.
const readGuard = [requireAuth, requireCapability("site.manage")];
const adminGuard = [requireAuth, requireCapability("site.manage")];

function serialize(row: ShortLink, publicBase: string) {
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
    ogTitle: row.ogTitle,
    ogDescription: row.ogDescription,
    ogImageUrl: row.ogImageUrl,
    publicUrl: `${publicBase}/${row.slug}`,
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
      "Slug must start with a letter or digit and contain only [a-z0-9._-]. Slashes aren't supported.",
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

// `ogImageUrl` may be a fully-qualified URL or a site-relative path
// beginning with `/`. We don't enforce `.url()` so admins can reference
// an asset under `/api/storage/...` without retyping the origin.
const ogImageShape = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => /^https?:\/\//i.test(v) || v.startsWith("/"), {
    message: "OG image must be a full URL or a site-relative path",
  });

const CreateBody = z.object({
  slug: slugShape,
  targetUrl: targetUrlShape,
  title: z.string().max(200).nullish(),
  notes: z.string().max(1000).nullish(),
  statusCode: statusCodeShape,
  active: z.boolean().optional(),
  tags: z.array(z.string().max(64)).max(32).optional(),
  ogTitle: z.string().max(200).nullish(),
  ogDescription: z.string().max(500).nullish(),
  ogImageUrl: ogImageShape.nullish(),
});
const UpdateBody = CreateBody.partial();

router.get("/cms/short-links", ...readGuard, async (_req, res) => {
  const [rows, settings] = await Promise.all([
    db
      .select()
      .from(shortLinksTable)
      .orderBy(desc(shortLinksTable.updatedAt), asc(shortLinksTable.slug)),
    getShortLinkSettings(),
  ]);
  res.json({ items: rows.map((r: ShortLink) => serialize(r, settings.publicBase)) });
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
      ogTitle: d.ogTitle ?? null,
      ogDescription: d.ogDescription ?? null,
      ogImageUrl: d.ogImageUrl ?? null,
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
  const settings = await getShortLinkSettings();
  res.status(201).json(serialize(row, settings.publicBase));
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
  if (d.ogTitle !== undefined) updates.ogTitle = d.ogTitle ?? null;
  if (d.ogDescription !== undefined)
    updates.ogDescription = d.ogDescription ?? null;
  if (d.ogImageUrl !== undefined) updates.ogImageUrl = d.ogImageUrl ?? null;
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
  const settings = await getShortLinkSettings();
  res.json(serialize(row, settings.publicBase));
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

// ---- Short-link service settings ------------------------------------------
//
// Four columns on `site_settings` configure the service:
//   - `shortLinkPublicBase` — canonical https origin embedded in QR codes
//   - `shortLinkAdditionalHosts` — extra hostnames the middleware accepts
//   - `shortLinkFallbackUrl` — suggestion shown on the 404 page
//   - `shortLinkRebrandlyApiKey` — used by the Rebrandly import handler
// Stored on `site_settings` rather than in env vars so admins can flip
// them without a deploy. The Rebrandly key is treated as a secret — the
// GET response masks it to `••••<last4>` and the PUT shape only updates
// it when the request explicitly carries `rebrandlyApiKey` (omitting the
// key on a settings save leaves the existing value alone).

const SETTINGS_ROW_ID = 1;

// `.url()` accepts any well-formed URL scheme (mailto:, ftp://, etc.).
// QR codes and unfurls only behave correctly when the public base is
// https, and the fallback should be a real http(s) destination, so both
// shapes layer a protocol refinement on top of the URL parse. Builder
// keeps the per-field max length composable.
function urlWithSchemes(maxLen: number, schemes: ReadonlyArray<"http:" | "https:">) {
  return z
    .string()
    .trim()
    .max(maxLen)
    .url()
    .refine(
      (v) => {
        try {
          return schemes.includes(new URL(v).protocol as "http:" | "https:");
        } catch {
          return false;
        }
      },
      { message: `Must be a ${schemes.map((s) => s.replace(":", "")).join(" or ")} URL` },
    );
}

const SettingsBody = z.object({
  // Full https URL or null to revert to the hard-coded default.
  publicBase: urlWithSchemes(512, ["https:"]).nullish(),
  // Bare hostnames; we strip whitespace + lowercase before storing.
  additionalHosts: z
    .array(z.string().trim().min(1).max(253))
    .max(16)
    .optional(),
  // Where to send users from the 404 page; null hides the suggestion.
  fallbackUrl: urlWithSchemes(2048, ["http:", "https:"]).nullish(),
  // Rebrandly API key. Omitted/undefined ⇒ leave existing value alone
  // (so accidentally re-saving the form doesn't clobber the secret).
  // Empty string ⇒ explicit clear. Otherwise stored verbatim.
  rebrandlyApiKey: z.string().max(256).optional(),
});

router.get("/cms/short-links/settings", ...readGuard, async (_req, res) => {
  const settings = await getShortLinkSettings();
  res.json(settings);
});

router.put("/cms/short-links/settings", ...adminGuard, async (req, res) => {
  const parsed = SettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const cleanedHosts = (d.additionalHosts ?? []).map((h) => h.toLowerCase());
  // Resolve the Rebrandly key delta:
  //   undefined ⇒ key field absent from request, leave existing alone
  //   ""        ⇒ explicit clear
  //   "<value>" ⇒ store verbatim
  const keyDelta: { value: string | null } | null =
    d.rebrandlyApiKey === undefined
      ? null
      : { value: d.rebrandlyApiKey === "" ? null : d.rebrandlyApiKey };
  // Upsert against the singleton settings row. Mirrors the pattern in
  // `routes/siteSettings.ts` — site_settings is keyed on id=1.
  const [existing] = await db
    .select()
    .from(siteSettingsTable)
    .where(eq(siteSettingsTable.id, SETTINGS_ROW_ID));
  if (!existing) {
    await db.insert(siteSettingsTable).values({
      id: SETTINGS_ROW_ID,
      requireCookieConsent: false,
      shortLinkPublicBase: d.publicBase ?? null,
      shortLinkAdditionalHosts: cleanedHosts.length ? cleanedHosts : null,
      shortLinkFallbackUrl: d.fallbackUrl ?? null,
      shortLinkRebrandlyApiKey: keyDelta?.value ?? null,
    });
  } else {
    const updates: Partial<typeof siteSettingsTable.$inferInsert> = {
      shortLinkPublicBase: d.publicBase ?? null,
      shortLinkAdditionalHosts: cleanedHosts.length ? cleanedHosts : null,
      shortLinkFallbackUrl: d.fallbackUrl ?? null,
    };
    if (keyDelta) updates.shortLinkRebrandlyApiKey = keyDelta.value;
    await db
      .update(siteSettingsTable)
      .set(updates)
      .where(eq(siteSettingsTable.id, SETTINGS_ROW_ID));
  }
  invalidateShortLinkSettingsCache();
  await audit({
    actorId: req.authedUser!.id,
    action: "short_link.settings.update",
    entity: "site_settings",
    entityId: String(SETTINGS_ROW_ID),
    // Audit logs the *fact* that the key changed, never the value itself.
    diff: {
      publicBase: d.publicBase,
      additionalHosts: cleanedHosts,
      fallbackUrl: d.fallbackUrl,
      rebrandlyApiKeyChanged: keyDelta !== null,
    },
  });
  res.json(await getShortLinkSettings());
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
  // Rebrandly importer carries lifetime click count + last-click timestamp
  // forward so historical totals don't reset at cutover. CSV path leaves
  // both undefined and the upsert step skips them.
  hitCount: z.number().int().min(0).optional(),
  lastClickAt: z.date().optional(),
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

type ValidatedImportRow = z.infer<typeof ImportRowSchema> & {
  // 1-based source line for error messages — CSV row number for the CSV
  // importer, sequential index (1..N) for the Rebrandly importer.
  sourceRow: number;
};

interface ApplyImportOpts {
  collisionPolicy: "skip" | "overwrite";
  defaultActive: boolean;
  createdBy: string | null;
}

// Shared phase-2 upsert step used by both the CSV importer and the
// Rebrandly API importer.
//
// Pre-loads every existing row whose slug appears in the validated batch
// so the per-row write loop is O(1) DB calls per row instead of an extra
// SELECT each time.
//
// Semantics are best-effort: rows that fail (e.g. unique-constraint
// violations from a race, transient DB errors) are recorded in
// `summary.errors` and the loop keeps going. Successful rows still
// commit, which matches what an editor expects from a bulk import — a
// single bad row in a 200-row import shouldn't roll back the other 199.
// We do NOT wrap this in a `db.transaction()` because the per-row
// try/catch would swallow errors inside the transaction and "rolls back
// on partial failure" would be a lie. If we ever need true atomicity,
// drop the per-row catch and let the first failure abort.
async function applyImportRows(
  validated: ValidatedImportRow[],
  opts: ApplyImportOpts,
  summary: ImportSummary,
): Promise<void> {
  // Dedupe within the batch so a CSV/Rebrandly source that lists the
  // same slug twice doesn't try to INSERT the second occurrence and hit
  // a unique-constraint error. Last-write-wins matches what an editor
  // intuitively expects from "fixed up the spreadsheet, re-uploaded."
  // We keep the original sourceRow on the row that survives so error
  // messages still cite a real line; collapsed duplicates are silently
  // discarded.
  const dedupedBySlug = new Map<string, ValidatedImportRow>();
  for (const v of validated) dedupedBySlug.set(v.slug, v);
  const deduped = [...dedupedBySlug.values()];

  const slugs = deduped.map((v) => v.slug);
  const existingRows: ShortLink[] = slugs.length
    ? await db
        .select()
        .from(shortLinksTable)
        .where(inArray(shortLinksTable.slug, slugs))
    : [];
  const existingBySlug = new Map<string, ShortLink>(
    existingRows.map((r) => [r.slug, r]),
  );

  for (const v of deduped) {
    try {
      const existing = existingBySlug.get(v.slug);
      if (existing) {
        if (opts.collisionPolicy === "skip") {
          summary.skipped++;
          continue;
        }
        const updates: Partial<typeof shortLinksTable.$inferInsert> = {
          targetUrl: v.targetUrl,
          title: v.title ?? null,
          notes: v.notes ?? null,
          tags: v.tags ?? null,
          rebrandlyId: v.rebrandlyId ?? existing.rebrandlyId,
        };
        // Carry-over fields: only set when the source actually provided
        // them, so re-importing a CSV after a Rebrandly pull doesn't
        // zero out the historical hitCount.
        if (v.hitCount !== undefined) updates.hitCount = v.hitCount;
        if (v.lastClickAt !== undefined) updates.lastClickAt = v.lastClickAt;
        await db
          .update(shortLinksTable)
          .set(updates)
          .where(eq(shortLinksTable.id, existing.id));
        summary.updated++;
      } else {
        const [inserted] = await db
          .insert(shortLinksTable)
          .values({
            slug: v.slug,
            targetUrl: v.targetUrl,
            title: v.title ?? null,
            notes: v.notes ?? null,
            statusCode: 302,
            active: opts.defaultActive,
            tags: v.tags ?? null,
            rebrandlyId: v.rebrandlyId ?? null,
            hitCount: v.hitCount ?? 0,
            lastClickAt: v.lastClickAt ?? null,
            createdBy: opts.createdBy,
          })
          .returning();
        // Belt-and-suspenders for the dedupe step above: if a future
        // change ever drops the upfront dedupe, recording the freshly
        // inserted row here keeps a same-batch second occurrence on the
        // update path instead of a duplicate insert.
        if (inserted) existingBySlug.set(inserted.slug, inserted);
        summary.imported++;
      }
    } catch (err) {
      summary.errors.push({
        row: v.sourceRow,
        slug: v.slug,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
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

  // Phase 1: validate every CSV row up front so we can collect all errors
  // in one pass and avoid issuing N round-trips to the DB just to
  // discover invalid input. The validated rows carry their original CSV
  // index so error messages still cite the right line.
  const validated: ValidatedImportRow[] = [];
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
    validated.push({ ...ok.data, sourceRow: i + 2 });
  }

  await applyImportRows(
    validated,
    {
      collisionPolicy,
      defaultActive,
      createdBy: req.authedUser?.id ?? null,
    },
    summary,
  );
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

// ---- Rebrandly API import -------------------------------------------------
//
// Pulls every link from the configured Rebrandly account and upserts it
// through the same validation + upsert pipeline the CSV importer uses.
// The API key lives in `site_settings.short_link_rebrandly_api_key`
// (admin-managed via `/cms/short-links/settings`); we never accept a key
// in the import request body so it can't end up in audit logs or
// browser dev tools.
//
// Pagination: Rebrandly's `/v1/links` returns up to 25 entries and uses
// cursor pagination — pass `last=<id of last item>` for the next page.
// We cap total fetched at MAX_LINKS to bound runtime; large accounts can
// be imported in chunks via `domainId` filter.

const RebrandlyImportBody = z.object({
  collisionPolicy: z.enum(["skip", "overwrite"]).default("skip"),
  defaultActive: z.boolean().default(true),
  // Optional: scope the pull to one Rebrandly domain (e.g. branded host).
  domainId: z.string().max(64).optional(),
});

// Subset of the Rebrandly link payload we read. Rebrandly returns more
// fields (creator, integrated, sponsored, …) but none of them map onto
// our schema, so we ignore them. `clicks` and `lastClickAt` flow into
// `hitCount` / `lastClickAt` so historical totals carry over — per-day
// breakdowns still start fresh in our `short_link_clicks` table.
interface RebrandlyLink {
  id?: string;
  slashtag?: string;
  destination?: string;
  title?: string | null;
  description?: string | null;
  clicks?: number;
  lastClickAt?: string | null;
}

// Exported for unit tests so the mapping can be exercised without a
// running DB or live Rebrandly account. Returns either a candidate row
// suitable for `ImportRowSchema.safeParse` or a synthetic error row that
// describes why the link was unmappable (e.g. missing slug/destination).
export function mapRebrandlyLink(
  link: RebrandlyLink,
): { ok: true; candidate: Record<string, unknown> } | { ok: false; error: string } {
  if (!link.slashtag || !link.destination) {
    return {
      ok: false,
      error: "Rebrandly link missing slashtag or destination",
    };
  }
  const candidate: Record<string, unknown> = {
    slug: link.slashtag,
    targetUrl: link.destination,
    title: link.title ?? null,
    notes: link.description ?? null,
    rebrandlyId: link.id ?? null,
  };
  if (typeof link.clicks === "number" && Number.isFinite(link.clicks)) {
    candidate.hitCount = Math.max(0, Math.floor(link.clicks));
  }
  if (link.lastClickAt) {
    const parsed = new Date(link.lastClickAt);
    if (!Number.isNaN(parsed.getTime())) candidate.lastClickAt = parsed;
  }
  return { ok: true, candidate };
}

const REBRANDLY_PAGE_SIZE = 25;
const REBRANDLY_MAX_LINKS = 25_000;

router.post(
  "/cms/short-links/import-rebrandly",
  ...adminGuard,
  async (req, res) => {
    const parsed = RebrandlyImportBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    const { collisionPolicy, defaultActive, domainId } = parsed.data;
    const apiKey = await getRebrandlyApiKey();
    if (!apiKey) {
      res.status(400).json({
        error:
          "Rebrandly API key isn't configured. Set it in Site Settings → Short links first.",
      });
      return;
    }

    const summary: ImportSummary = {
      imported: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };
    const validated: ValidatedImportRow[] = [];
    let nextCursor: string | undefined;
    let totalFetched = 0;
    let sourceIdx = 0;

    try {
      // Cursor-paginated fetch. Rebrandly returns an empty array when the
      // cursor passes the last link, which is our signal to stop.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const url = new URL("https://api.rebrandly.com/v1/links");
        url.searchParams.set("limit", String(REBRANDLY_PAGE_SIZE));
        url.searchParams.set("orderBy", "createdAt");
        url.searchParams.set("orderDir", "asc");
        if (domainId) url.searchParams.set("domain.id", domainId);
        if (nextCursor) url.searchParams.set("last", nextCursor);

        const resp = await fetch(url, {
          method: "GET",
          headers: {
            apikey: apiKey,
            Accept: "application/json",
          },
        });
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(
            `Rebrandly API returned ${resp.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
          );
        }
        const page = (await resp.json()) as RebrandlyLink[];
        if (!Array.isArray(page) || page.length === 0) break;

        for (const link of page) {
          sourceIdx++;
          const mapped = mapRebrandlyLink(link);
          if (!mapped.ok) {
            summary.errors.push({
              row: sourceIdx,
              slug: link.slashtag,
              error: mapped.error,
            });
            continue;
          }
          const ok = ImportRowSchema.safeParse(mapped.candidate);
          if (!ok.success) {
            summary.errors.push({
              row: sourceIdx,
              slug: link.slashtag,
              error: ok.error.issues.map((iss) => iss.message).join("; "),
            });
            continue;
          }
          validated.push({ ...ok.data, sourceRow: sourceIdx });
        }

        totalFetched += page.length;
        if (page.length < REBRANDLY_PAGE_SIZE) break;
        if (totalFetched >= REBRANDLY_MAX_LINKS) {
          summary.errors.push({
            row: totalFetched,
            error: `Reached the import cap of ${REBRANDLY_MAX_LINKS} links. Re-run with a domainId filter to scope the pull.`,
          });
          break;
        }
        const last = page[page.length - 1];
        if (!last.id) break; // can't paginate without a cursor token
        nextCursor = last.id;
      }
    } catch (err) {
      logger.error({ err }, "short-links: Rebrandly import failed mid-stream");
      // Apply whatever we successfully validated so the editor doesn't
      // lose the work, then surface the failure in the summary.
      summary.errors.push({
        row: sourceIdx,
        error: `Rebrandly fetch aborted: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    await applyImportRows(
      validated,
      {
        collisionPolicy,
        defaultActive,
        createdBy: req.authedUser?.id ?? null,
      },
      summary,
    );
    invalidateShortLinkCache();
    await audit({
      actorId: req.authedUser!.id,
      action: "short_link.import.rebrandly",
      entity: "short_link",
      entityId: null,
      diff: {
        summary,
        collisionPolicy,
        totalFetched,
        domainId: domainId ?? null,
      },
    });
    res.json({ summary, totalFetched });
  },
);

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
    const settings = await getShortLinkSettings();
    const png = await generateBrandedQrPng(`${settings.publicBase}/${row.slug}`, {
      size,
    });
    res.setHeader("Content-Type", "image/png");
    // Short TTL + must-revalidate (no `immutable`) because the QR payload
    // depends on `settings.publicBase`, which admins can flip from the
    // settings card. 5 min absorbs hot-path repeats (e.g. embedding the
    // QR in multiple admin views) without making a base-URL change wait
    // hours to propagate to printed collateral previews.
    res.setHeader("Cache-Control", "public, max-age=300, must-revalidate");
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
  // UTC-normalized day truncation. The same expression is used for SELECT,
  // GROUP BY, and ORDER BY so the buckets line up regardless of the DB
  // session timezone. Truncating after `at time zone 'utc'` shifts the
  // timestamp into UTC first, then keeps day boundaries aligned with the
  // calendar the dashboard reads (`YYYY-MM-DD` in UTC).
  const dayUtc = sql`date_trunc('day', ${shortLinkClicksTable.clickedAt} at time zone 'utc')`;
  const dailyRows = await db
    .select({
      day: sql<string>`to_char(${dayUtc}, 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
    })
    .from(shortLinkClicksTable)
    .where(
      and(
        eq(shortLinkClicksTable.shortLinkId, id),
        gte(shortLinkClicksTable.clickedAt, since),
      ),
    )
    .groupBy(dayUtc)
    .orderBy(dayUtc);
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

// HTML-fetching helpers for the OG preview endpoint. We deliberately do
// not pull in a parser dependency for this — a handful of regexes against
// `<head>` covers the OG / Twitter / fallback tags we care about, and it
// keeps the api-server bundle lean.
const OG_FETCH_TIMEOUT_MS = 6000;
const OG_FETCH_MAX_BYTES = 512 * 1024; // 512KB head should be plenty
const OG_FETCH_USER_AGENT =
  "SynozurShortLinks/1.0 (+https://aka.synozur.com)";

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127(?:\.\d+){3}$/,
  /^0(?:\.\d+){3}$/,
  /^10(?:\.\d+){3}$/,
  /^192\.168(?:\.\d+){2}$/,
  /^172\.(1[6-9]|2\d|3[0-1])(?:\.\d+){2}$/,
  /^169\.254(?:\.\d+){2}$/,
  /^::1$/,
  /^fc00:/i,
  /^fd[0-9a-f]{2}:/i,
  /^fe80:/i,
];

function isProbablyPrivateHost(hostname: string): boolean {
  // Strip IPv6 brackets if any.
  const h = hostname.replace(/^\[/, "").replace(/\]$/, "");
  return PRIVATE_HOST_PATTERNS.some((p) => p.test(h));
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCharCode(code) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      const code = parseInt(n, 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : "";
    });
}

function pickMetaContent(html: string, names: string[]): string | null {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Match either order: `property="x" ... content="y"` or
    // `content="y" ... property="x"`.
    const patterns = [
      new RegExp(
        `<meta\\b[^>]*?\\b(?:property|name)\\s*=\\s*["']${escaped}["'][^>]*?\\bcontent\\s*=\\s*["']([^"']*)["']`,
        "i",
      ),
      new RegExp(
        `<meta\\b[^>]*?\\bcontent\\s*=\\s*["']([^"']*)["'][^>]*?\\b(?:property|name)\\s*=\\s*["']${escaped}["']`,
        "i",
      ),
    ];
    for (const p of patterns) {
      const m = html.match(p);
      if (m && m[1]) {
        const v = decodeHtmlEntities(m[1]).trim();
        if (v) return v;
      }
    }
  }
  return null;
}

function pickTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]{0,500}?)<\/title>/i);
  if (!m) return null;
  const v = decodeHtmlEntities(m[1]).replace(/\s+/g, " ").trim();
  return v || null;
}

function resolveImageUrl(
  imageRef: string | null,
  baseUrl: URL,
): string | null {
  if (!imageRef) return null;
  try {
    return new URL(imageRef, baseUrl).toString();
  } catch {
    return null;
  }
}

const PreviewBody = z.object({
  url: targetUrlShape,
});

router.post(
  "/cms/short-links/preview-target",
  ...adminGuard,
  async (req, res) => {
    const parsed = PreviewBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    const { url } = parsed.data;

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      res.status(400).json({ error: "Could not parse URL" });
      return;
    }
    if (isProbablyPrivateHost(parsedUrl.hostname)) {
      res.status(400).json({
        error:
          "Refusing to fetch private / loopback hosts. Use a public URL.",
      });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      OG_FETCH_TIMEOUT_MS,
    );
    let resp: Response;
    try {
      resp = await fetch(parsedUrl, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent": OG_FETCH_USER_AGENT,
          // Some sites gate OG metadata behind an Accept that includes
          // text/html. A few CDNs return JSON to bot-y user agents
          // otherwise.
          Accept: "text/html,application/xhtml+xml",
        },
      });
    } catch (err) {
      clearTimeout(timer);
      const aborted =
        err instanceof Error && err.name === "AbortError";
      logger.warn(
        { err, url: parsedUrl.toString() },
        "short-links: OG preview fetch failed",
      );
      res.status(502).json({
        error: aborted
          ? "Target URL didn't respond in time."
          : "Could not reach the target URL.",
      });
      return;
    }
    clearTimeout(timer);

    if (!resp.ok) {
      res.status(502).json({
        error: `Target returned HTTP ${resp.status}.`,
      });
      return;
    }
    const ct = resp.headers.get("content-type") ?? "";
    if (!/(text\/html|application\/xhtml\+xml)/i.test(ct)) {
      res.status(415).json({
        error: `Target is ${ct || "non-HTML"}; nothing to preview.`,
      });
      return;
    }

    // Stream-and-cap so a giant target page doesn't blow up the server.
    let html = "";
    if (resp.body) {
      const reader = resp.body.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: false });
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        html += decoder.decode(value, { stream: true });
        if (total >= OG_FETCH_MAX_BYTES) {
          try {
            await reader.cancel();
          } catch {
            // ignore
          }
          break;
        }
      }
      html += decoder.decode();
    } else {
      html = await resp.text();
    }

    // Use the URL we actually landed on (after redirects) as the base for
    // resolving relative og:image paths.
    const finalUrl = (() => {
      try {
        return new URL(resp.url || parsedUrl.toString());
      } catch {
        return parsedUrl;
      }
    })();

    // Limit our regex search to the first chunk of the document — OG
    // metadata always lives in <head>, and scanning a 256KB body for
    // every meta tag can be slow.
    const headSlice = html.slice(0, 64 * 1024);

    const ogTitle =
      pickMetaContent(headSlice, [
        "og:title",
        "twitter:title",
      ]);
    const ogDescription = pickMetaContent(headSlice, [
      "og:description",
      "twitter:description",
      "description",
    ]);
    const ogImage = pickMetaContent(headSlice, [
      "og:image:secure_url",
      "og:image",
      "twitter:image",
      "twitter:image:src",
    ]);
    const docTitle = pickTitle(headSlice);

    res.json({
      finalUrl: finalUrl.toString(),
      title: ogTitle || docTitle,
      description: ogDescription,
      imageUrl: resolveImageUrl(ogImage, finalUrl),
      // Hint the UI which fields actually came from OG vs the document
      // title fallback, so we can label them honestly.
      sources: {
        title: ogTitle ? "og" : docTitle ? "title" : null,
        description: ogDescription ? "og" : null,
        imageUrl: ogImage ? "og" : null,
      },
    });
  },
);

export default router;
