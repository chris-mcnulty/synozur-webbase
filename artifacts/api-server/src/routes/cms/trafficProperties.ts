/**
 * #228 — Traffic property registry + ingestion admin endpoints.
 *
 * Surfaces CRUD for `traffic_properties` (the multi-property registry) and
 * the JSON / CSV import surfaces under `/api/cms/traffic/...`. The public
 * authenticated ingest endpoint (`POST /api/traffic/ingest`) lives in
 * routes/traffic.ts so it sits alongside the live beacon collector.
 */

import { Router, type IRouter } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import {
  db,
  trafficPropertiesTable,
  trafficPropertyImportsTable,
  usersTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../../middlewares/auth";
import { parseCsvAsObjects } from "../../lib/csv";
import {
  ingestPageviewBatch,
  ingestSessionBatch,
  normalizeIngestRow,
  normalizeIngestSessionRow,
  type IngestPageviewRow,
  type IngestSessionRow,
} from "../../lib/trafficIngest";

const BCRYPT_ROUNDS = 12;
const router: IRouter = Router();
// Read access (list properties) is open to editors+ since the dashboard
// filter UI relies on it. Mutating endpoints (create/rotate/deactivate/
// import) are restricted to admins only — API keys are credentials and
// should not be issued by anyone with editor scope (#228 review).
const editorPlus = [requireAuth, requireRole("admin", "editor")];
const adminOnly = [requireAuth, requireRole("admin")];

// ─── helpers ─────────────────────────────────────────────────────────────────

function generateApiKey(): { plaintext: string; prefix: string } {
  // 32 bytes → 43 url-safe base64 chars. Prefix is the first 8 chars and
  // is stored alongside the hash so the admin UI can show "tp_xxx…" without
  // re-fetching the plaintext.
  const raw = randomBytes(32).toString("base64url");
  const plaintext = `tp_${raw}`;
  const prefix = plaintext.slice(0, 8);
  return { plaintext, prefix };
}

const SlugRegex = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

// ─── List ────────────────────────────────────────────────────────────────────

router.get("/cms/traffic/properties", ...editorPlus, async (_req, res) => {
  const rows = await db
    .select({
      id: trafficPropertiesTable.id,
      slug: trafficPropertiesTable.slug,
      name: trafficPropertiesTable.name,
      baseUrl: trafficPropertiesTable.baseUrl,
      apiKeyPrefix: trafficPropertiesTable.apiKeyPrefix,
      hasApiKey: trafficPropertiesTable.apiKeyHash,
      isDefault: trafficPropertiesTable.isDefault,
      isActive: trafficPropertiesTable.isActive,
      notes: trafficPropertiesTable.notes,
      lastIngestedAt: trafficPropertiesTable.lastIngestedAt,
      createdAt: trafficPropertiesTable.createdAt,
      updatedAt: trafficPropertiesTable.updatedAt,
    })
    .from(trafficPropertiesTable)
    .orderBy(desc(trafficPropertiesTable.isDefault), trafficPropertiesTable.slug);

  res.json({
    items: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      baseUrl: r.baseUrl,
      apiKeyPrefix: r.apiKeyPrefix,
      hasApiKey: r.hasApiKey != null,
      isDefault: r.isDefault,
      isActive: r.isActive,
      notes: r.notes,
      lastIngestedAt: r.lastIngestedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  });
});

// ─── Create ──────────────────────────────────────────────────────────────────

const CreateBody = z.object({
  slug: z
    .string()
    .min(3)
    .max(64)
    .regex(SlugRegex, "slug must be lowercase letters, digits, and dashes"),
  name: z.string().min(1).max(200),
  baseUrl: z.string().url().max(2048).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  generateApiKey: z.boolean().optional().default(true),
});

router.post("/cms/traffic/properties", ...adminOnly, async (req, res): Promise<void> => {
  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  if (parsed.data.slug === "all") {
    res.status(400).json({ error: "'all' is a reserved sentinel and cannot be used as a slug" });
    return;
  }

  // Reject duplicate slug.
  const [existing] = await db
    .select({ id: trafficPropertiesTable.id })
    .from(trafficPropertiesTable)
    .where(eq(trafficPropertiesTable.slug, parsed.data.slug))
    .limit(1);
  if (existing) {
    res.status(409).json({ error: "A property with that slug already exists" });
    return;
  }

  let plaintextKey: string | null = null;
  let apiKeyHash: string | null = null;
  let apiKeyPrefix: string | null = null;
  if (parsed.data.generateApiKey) {
    const { plaintext, prefix } = generateApiKey();
    plaintextKey = plaintext;
    apiKeyHash = await bcrypt.hash(plaintext, BCRYPT_ROUNDS);
    apiKeyPrefix = prefix;
  }

  const [inserted] = await db
    .insert(trafficPropertiesTable)
    .values({
      slug: parsed.data.slug,
      name: parsed.data.name,
      baseUrl: parsed.data.baseUrl ?? null,
      notes: parsed.data.notes ?? null,
      apiKeyHash,
      apiKeyPrefix,
      isActive: true,
      isDefault: false,
    })
    .returning();

  // Plaintext key is shown EXACTLY ONCE here.
  res.status(201).json({
    id: inserted!.id,
    slug: inserted!.slug,
    name: inserted!.name,
    baseUrl: inserted!.baseUrl,
    apiKeyPrefix: inserted!.apiKeyPrefix,
    apiKey: plaintextKey,
    isDefault: inserted!.isDefault,
    isActive: inserted!.isActive,
    notes: inserted!.notes,
    createdAt: inserted!.createdAt,
  });
});

// ─── Patch (rename / deactivate / etc) ───────────────────────────────────────

const PatchBody = z.object({
  name: z.string().min(1).max(200).optional(),
  baseUrl: z.string().url().max(2048).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
});

router.patch("/cms/traffic/properties/:id", ...adminOnly, async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const parsed = PatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const [existing] = await db
    .select()
    .from(trafficPropertiesTable)
    .where(eq(trafficPropertiesTable.id, id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Property not found" });
    return;
  }
  // Disallow deactivating the built-in default.
  if (existing.isDefault && parsed.data.isActive === false) {
    res.status(400).json({ error: "Cannot deactivate the built-in default property" });
    return;
  }
  const patch: Partial<typeof trafficPropertiesTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.baseUrl !== undefined) patch.baseUrl = parsed.data.baseUrl;
  if (parsed.data.notes !== undefined) patch.notes = parsed.data.notes;
  if (parsed.data.isActive !== undefined) patch.isActive = parsed.data.isActive;

  const [updated] = await db
    .update(trafficPropertiesTable)
    .set(patch)
    .where(eq(trafficPropertiesTable.id, id))
    .returning();
  res.json({
    id: updated!.id,
    slug: updated!.slug,
    name: updated!.name,
    baseUrl: updated!.baseUrl,
    isDefault: updated!.isDefault,
    isActive: updated!.isActive,
    notes: updated!.notes,
    apiKeyPrefix: updated!.apiKeyPrefix,
    hasApiKey: updated!.apiKeyHash != null,
    updatedAt: updated!.updatedAt,
  });
});

// ─── Rotate API key ──────────────────────────────────────────────────────────

router.post(
  "/cms/traffic/properties/:id/rotate-key",
  ...adminOnly,
  async (req, res): Promise<void> => {
    const id = String(req.params.id);
    const [existing] = await db
      .select()
      .from(trafficPropertiesTable)
      .where(eq(trafficPropertiesTable.id, id))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Property not found" });
      return;
    }
    if (existing.isDefault) {
      // The built-in synozur property uses native collection, not an API key.
      res.status(400).json({ error: "Built-in default property does not use an API key" });
      return;
    }
    const { plaintext, prefix } = generateApiKey();
    const apiKeyHash = await bcrypt.hash(plaintext, BCRYPT_ROUNDS);
    await db
      .update(trafficPropertiesTable)
      .set({ apiKeyHash, apiKeyPrefix: prefix, updatedAt: new Date() })
      .where(eq(trafficPropertiesTable.id, id));
    res.json({ apiKey: plaintext, apiKeyPrefix: prefix });
  },
);

// ─── List recent imports for one property ────────────────────────────────────

router.get(
  "/cms/traffic/properties/:id/imports",
  ...adminOnly,
  async (req, res): Promise<void> => {
    const id = String(req.params.id);
    const rows = await db
      .select({
        id: trafficPropertyImportsTable.id,
        propertyId: trafficPropertyImportsTable.propertyId,
        kind: trafficPropertyImportsTable.kind,
        sourceFile: trafficPropertyImportsTable.sourceFile,
        sourceFileSha256: trafficPropertyImportsTable.sourceFileSha256,
        accepted: trafficPropertyImportsTable.accepted,
        skipped: trafficPropertyImportsTable.skipped,
        duplicates: trafficPropertyImportsTable.duplicates,
        errors: trafficPropertyImportsTable.errors,
        notes: trafficPropertyImportsTable.notes,
        createdAt: trafficPropertyImportsTable.createdAt,
        createdBy: trafficPropertyImportsTable.createdBy,
        createdByEmail: usersTable.email,
        createdByDisplayName: usersTable.displayName,
      })
      .from(trafficPropertyImportsTable)
      .leftJoin(
        usersTable,
        eq(usersTable.id, trafficPropertyImportsTable.createdBy),
      )
      .where(eq(trafficPropertyImportsTable.propertyId, id))
      .orderBy(desc(trafficPropertyImportsTable.createdAt))
      .limit(50);
    res.json({ items: rows });
  },
);

// ─── Import endpoint (JSON or CSV body) ──────────────────────────────────────
//
// One unified endpoint, branched on `kind`:
//   - kind: "json" — body accepts the SAME envelope as POST /api/traffic/ingest:
//                    { rows? | pageviews?, sessions?, events? }. `rows` is a
//                    legacy alias for `pageviews`.
//   - kind: "csv"  — body.csv is a CSV string with a header row. Headers are
//                    matched case-insensitively against the canonical field
//                    names, with synonyms handled in normalizeIngestRow().
// Both paths run through the same normalize → ingest pipeline as the public
// /api/traffic/ingest endpoint, so behaviour is identical.

const ImportJsonBody = z.object({
  propertySlug: z.string().min(1).max(64),
  kind: z.literal("json"),
  // Envelope: at least one of rows/pageviews/sessions/events must be present.
  rows: z.array(z.record(z.unknown())).max(50_000).optional(),
  pageviews: z.array(z.record(z.unknown())).max(50_000).optional(),
  sessions: z.array(z.record(z.unknown())).max(50_000).optional(),
  events: z.array(z.record(z.unknown())).max(50_000).optional(),
  fileName: z.string().max(256).optional(),
});

const ImportCsvBody = z.object({
  propertySlug: z.string().min(1).max(64),
  kind: z.literal("csv"),
  csv: z.string().min(1).max(8 * 1024 * 1024),
  fileName: z.string().max(256).optional(),
});

const ImportBody = z.discriminatedUnion("kind", [ImportJsonBody, ImportCsvBody]);

router.post("/cms/traffic/import", ...adminOnly, async (req, res): Promise<void> => {
  const parsed = ImportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }

  const [property] = await db
    .select()
    .from(trafficPropertiesTable)
    .where(eq(trafficPropertiesTable.slug, parsed.data.propertySlug))
    .limit(1);
  if (!property || !property.isActive) {
    res.status(404).json({ error: "Property not found or inactive" });
    return;
  }
  if (property.isDefault) {
    res.status(400).json({
      error:
        "Cannot import into the built-in synozur property. Create a separate property for legacy / external traffic.",
    });
    return;
  }

  const sourceFile = parsed.data.fileName ?? null;

  let pageviewRaw: Record<string, unknown>[] = [];
  let sessionsRaw: Record<string, unknown>[] = [];
  let sourceSha256: string | null = null;

  if (parsed.data.kind === "json") {
    pageviewRaw = parsed.data.pageviews ?? parsed.data.rows ?? [];
    sessionsRaw = parsed.data.sessions ?? [];
    sourceSha256 = createHash("sha256")
      .update(JSON.stringify({ pageviews: pageviewRaw, sessions: sessionsRaw }))
      .digest("hex");
  } else {
    sourceSha256 = createHash("sha256").update(parsed.data.csv).digest("hex");
    pageviewRaw = parseCsvAsObjects(parsed.data.csv);
  }

  // Normalize sessions first so any session-only rows land before pageviews
  // try to bind to them via legacy_session_key.
  const sessNormalized: IngestSessionRow[] = [];
  let sessNormalizeErrors = 0;
  const errorSamples: Array<{ index: number; reason: string }> = [];
  for (let i = 0; i < sessionsRaw.length; i++) {
    const result = normalizeIngestSessionRow(sessionsRaw[i]!);
    if ("error" in result) {
      sessNormalizeErrors += 1;
      if (errorSamples.length < 10) errorSamples.push({ index: i, reason: `session: ${result.error}` });
      continue;
    }
    sessNormalized.push(result.row);
  }

  const normalized: IngestPageviewRow[] = [];
  let normalizeErrors = 0;
  for (let i = 0; i < pageviewRaw.length; i++) {
    const result = normalizeIngestRow(pageviewRaw[i]!);
    if ("error" in result) {
      normalizeErrors += 1;
      if (errorSamples.length < 10) errorSamples.push({ index: i, reason: result.error });
      continue;
    }
    normalized.push(result.row);
  }

  const [importRow] = await db
    .insert(trafficPropertyImportsTable)
    .values({
      propertyId: property.id,
      kind: parsed.data.kind,
      sourceFile,
      sourceFileSha256: sourceSha256,
      accepted: 0,
      skipped: 0,
      duplicates: 0,
      errors: normalizeErrors + sessNormalizeErrors,
      createdBy: req.authedUser!.id,
    })
    .returning();

  const sessCounters =
    sessNormalized.length > 0
      ? await ingestSessionBatch(parsed.data.propertySlug, sessNormalized)
      : { accepted: 0, duplicates: 0, skipped: 0, errors: 0, errorSamples: [] };
  const counters = await ingestPageviewBatch(parsed.data.propertySlug, normalized, {
    importBatchId: importRow!.id,
  });

  const totalErrors =
    counters.errors + sessCounters.errors + normalizeErrors + sessNormalizeErrors;
  const allErrorSamples = [
    ...errorSamples,
    ...counters.errorSamples,
    ...sessCounters.errorSamples,
  ].slice(0, 10);

  await db
    .update(trafficPropertyImportsTable)
    .set({
      accepted: counters.accepted,
      skipped: counters.skipped,
      duplicates: counters.duplicates,
      errors: totalErrors,
      notes:
        allErrorSamples.length > 0
          ? `errorSamples: ${JSON.stringify(allErrorSamples)}`
          : null,
    })
    .where(eq(trafficPropertyImportsTable.id, importRow!.id));

  res.json({
    importId: importRow!.id,
    accepted: counters.accepted,
    skipped: counters.skipped,
    duplicates: counters.duplicates,
    errors: totalErrors,
    errorSamples: allErrorSamples,
    rowsParsed: pageviewRaw.length,
    sessionsParsed: sessionsRaw.length,
    sessionsAccepted: sessCounters.accepted,
    sessionsUpdated: sessCounters.duplicates,
  });
});

export default router;
