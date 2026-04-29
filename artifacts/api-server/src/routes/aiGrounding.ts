import express, { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { asc, desc, eq } from "drizzle-orm";
import {
  db,
  groundingDocumentsTable,
  GROUNDING_CATEGORIES,
  type GroundingDocument,
} from "@workspace/db";
import { requireAuth, requireCapability } from "../middlewares/auth";
import { audit, buildAuditDiff } from "../lib/audit";
import { pdfTextToMarkdown } from "../lib/ai/grounding";

// The router is mounted at `/api` in app.ts, so route paths here are
// relative to that prefix (e.g. "/ai/grounding-documents" → /api/ai/...).

const router: IRouter = Router();

const manageGuard = [requireAuth, requireCapability("ai.grounding.manage")];

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const TitleSchema = z.string().trim().min(1).max(200);
const DescriptionSchema = z.string().max(2000).nullish();
const CategorySchema = z.enum(GROUNDING_CATEGORIES);
const ContentSchema = z.string().min(1);
// Cap scope tags so editors can't accidentally drop a 10K-element array.
const ScopeTagsSchema = z
  .array(z.string().trim().min(1).max(100))
  .max(50)
  .nullish();

const CreateBody = z.object({
  title: TitleSchema,
  description: DescriptionSchema,
  category: CategorySchema,
  content: ContentSchema,
  scopeTags: ScopeTagsSchema,
  priority: z.number().int().optional(),
  isActive: z.boolean().optional(),
  conciergeEligible: z.boolean().optional(),
});
const PatchBody = CreateBody.partial();

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

function serialize(d: GroundingDocument) {
  return {
    id: d.id,
    title: d.title,
    description: d.description,
    category: d.category,
    content: d.content,
    scopeTags: d.scopeTags ?? [],
    priority: d.priority,
    isActive: d.isActive,
    conciergeEligible: d.conciergeEligible,
    createdBy: d.createdBy,
    updatedBy: d.updatedBy,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

router.get("/ai/grounding-documents", ...manageGuard, async (_req, res) => {
  const rows = await db
    .select()
    .from(groundingDocumentsTable)
    .orderBy(
      desc(groundingDocumentsTable.priority),
      asc(groundingDocumentsTable.category),
      asc(groundingDocumentsTable.title),
    );
  res.json({ items: rows.map(serialize) });
});

router.get(
  "/ai/grounding-documents/:id",
  ...manageGuard,
  async (req, res) => {
    const id = String(req.params.id);
    const row = await db.query.groundingDocumentsTable.findFirst({
      where: eq(groundingDocumentsTable.id, id),
    });
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(serialize(row));
  },
);

router.post(
  "/ai/grounding-documents",
  ...manageGuard,
  async (req, res) => {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    const d = parsed.data;
    const actorId = req.authedUser!.id;
    const [row] = await db
      .insert(groundingDocumentsTable)
      .values({
        title: d.title,
        description: d.description ?? null,
        category: d.category,
        content: d.content,
        scopeTags: d.scopeTags ?? null,
        priority: d.priority ?? 0,
        isActive: d.isActive ?? true,
        conciergeEligible: d.conciergeEligible ?? true,
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning();
    await audit({
      actorId,
      action: "grounding_document.create",
      entity: "grounding_document",
      entityId: row.id,
    });
    res.status(201).json(serialize(row));
  },
);

router.patch(
  "/ai/grounding-documents/:id",
  ...manageGuard,
  async (req, res) => {
    const id = String(req.params.id);
    const existing = await db.query.groundingDocumentsTable.findFirst({
      where: eq(groundingDocumentsTable.id, id),
    });
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    const d = parsed.data;
    const actorId = req.authedUser!.id;
    const updates: Record<string, unknown> = {
      updatedAt: new Date(),
      updatedBy: actorId,
    };
    if (d.title !== undefined) updates.title = d.title;
    if (d.description !== undefined) updates.description = d.description ?? null;
    if (d.category !== undefined) updates.category = d.category;
    if (d.content !== undefined) updates.content = d.content;
    if (d.scopeTags !== undefined) updates.scopeTags = d.scopeTags ?? null;
    if (d.priority !== undefined) updates.priority = d.priority;
    if (d.isActive !== undefined) updates.isActive = d.isActive;
    if (d.conciergeEligible !== undefined)
      updates.conciergeEligible = d.conciergeEligible;
    const [updated] = await db
      .update(groundingDocumentsTable)
      .set(updates)
      .where(eq(groundingDocumentsTable.id, id))
      .returning();
    const diff = buildAuditDiff(
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
    );
    await audit({
      actorId,
      action: "grounding_document.update",
      entity: "grounding_document",
      entityId: id,
      diff,
    });
    res.json(serialize(updated));
  },
);

router.delete(
  "/ai/grounding-documents/:id",
  ...manageGuard,
  async (req, res) => {
    const id = String(req.params.id);
    const existing = await db.query.groundingDocumentsTable.findFirst({
      where: eq(groundingDocumentsTable.id, id),
    });
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await db
      .delete(groundingDocumentsTable)
      .where(eq(groundingDocumentsTable.id, id));
    await audit({
      actorId: req.authedUser!.id,
      action: "grounding_document.delete",
      entity: "grounding_document",
      entityId: id,
    });
    res.status(204).end();
  },
);

// ---------------------------------------------------------------------------
// File parsing — admin-only ingestion helpers. PDF and DOCX are parsed on the
// server (so the browser doesn't bundle pdf-parse / mammoth) and returned as
// markdown so editors paste structured text into the form rather than a
// flattened blob.
// ---------------------------------------------------------------------------

const PARSE_LIMIT = "20mb";

router.post(
  "/ai/parse-pdf",
  ...manageGuard,
  express.raw({ type: "*/*", limit: PARSE_LIMIT }),
  async (req: Request, res: Response) => {
    const body = req.body as Buffer | undefined;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({ error: "Empty body" });
      return;
    }
    try {
      // Dynamic import keeps the dep out of the cold-start path for everything
      // that doesn't upload PDFs.
      const pdfParse = (await import("pdf-parse")).default;
      const result = await pdfParse(body);
      const markdown = pdfTextToMarkdown(result.text ?? "");
      res.json({ markdown });
    } catch (err) {
      req.log?.warn({ err }, "PDF parse failed");
      res.status(422).json({ error: "Could not parse PDF" });
    }
  },
);

router.post(
  "/ai/parse-docx",
  ...manageGuard,
  express.raw({ type: "*/*", limit: PARSE_LIMIT }),
  async (req: Request, res: Response) => {
    const body = req.body as Buffer | undefined;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({ error: "Empty body" });
      return;
    }
    try {
      // mammoth exports `convertToMarkdown` at runtime but the published types
      // (v1.8.x) only declare `convertToHtml` / `extractRawText`. Cast through
      // a narrow interface so we get the markdown path without `any` leaking
      // into the rest of the file.
      const mammothMod = await import("mammoth");
      const mammoth = mammothMod as unknown as {
        convertToMarkdown: (input: {
          buffer: Buffer;
        }) => Promise<{ value: string }>;
      };
      const result = await mammoth.convertToMarkdown({ buffer: body });
      res.json({ markdown: result.value ?? "" });
    } catch (err) {
      req.log?.warn({ err }, "DOCX parse failed");
      res.status(422).json({ error: "Could not parse DOCX" });
    }
  },
);

export default router;
