import express, { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { z } from "zod";
import { CreatePrivateCustomerPageBody, UpdatePrivateCustomerPageBody } from "@workspace/api-zod";
import { audit } from "../lib/audit";
import { activeOrg, authorizedPage, memberOrg, pageResponse, requirePrivateStaff, uuid } from "../lib/privatePages/access";
import { confidentialHeaders, privateWriteGuard } from "../lib/privatePages/sharedAccess";
import { preparePrivateHtml } from "../lib/privatePages/html";
import { narrationText, PRIVATE_FILE_TYPES, type AssetKind } from "../lib/privatePages/files";
import { parsePrivateAudioRange } from "../lib/privatePages/policy";
import { PrivatePageError, readPrivateAsset, uploadPrivateAsset } from "../lib/privatePages/service";

const router: IRouter = Router();
const metadata = CreatePrivateCustomerPageBody.extend({ title: z.string().trim().min(1).max(200) }).strict();
const update = UpdatePrivateCustomerPageBody.strict();
const kindSchema = z.enum(["html", "audio", "transcript"]);
const admin = "/admin/private-pages/:orgId/pages";
router.use("/private-pages", confidentialHeaders);
router.use("/admin/private-pages", confidentialHeaders);
router.get("/private-pages", async (req, res): Promise<void> => {
  if (!req.authedUser) { res.status(401).json({ error: "Unauthorized" }); return; }
  const orgId = await memberOrg(req);
  if (!orgId) { res.status(403).json({ error: "Forbidden" }); return; }
  const result = await pool.query("SELECT * FROM private_customer_pages WHERE organization_id=$1 AND status='published' ORDER BY title", [orgId]);
  res.json({ items: await Promise.all(result.rows.map(pageResponse)) });
});
router.get("/private-pages/:id", async (req, res): Promise<void> => {
  if (!req.authedUser) { res.status(401).json({ error: "Unauthorized" }); return; }
  const page = await authorizedPage(req, String(req.params.id));
  if (!page) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await pageResponse(page));
});

router.get("/private-pages/:id/html", async (req, res): Promise<void> => {
  if (!req.authedUser) { res.status(401).json({ error: "Unauthorized" }); return; }
  const page = await authorizedPage(req, String(req.params.id));
  if (!page) { res.status(404).json({ error: "Not found" }); return; }
  try {
    const { body } = await readPrivateAsset(page.id, page.revision, "html");
    const prepared = preparePrivateHtml(body.toString("utf8"));
    res.set("Content-Security-Policy", `${prepared.csp}; sandbox allow-scripts; frame-ancestors 'self'`)
      .type("html").send(prepared.html);
  } catch (error) { res.status(error instanceof PrivatePageError ? error.status : 503).json({ error: "Private page unavailable." }); }
});
router.get("/private-pages/:id/script", async (req, res): Promise<void> => {
  if (!req.authedUser) { res.status(401).json({ error: "Unauthorized" }); return; }
  const page = await authorizedPage(req, String(req.params.id));
  if (!page) { res.status(404).json({ error: "Not found" }); return; }
  try {
    const { body } = await readPrivateAsset(page.id, page.revision, "transcript");
    res.json({ text: await narrationText(body) });
  } catch (error) { res.status(error instanceof PrivatePageError ? error.status : 503).json({ error: "Narration script unavailable." }); }
});
router.get("/private-pages/:id/assets/:kind", async (req, res): Promise<void> => {
  if (!req.authedUser) { res.status(401).json({ error: "Unauthorized" }); return; }
  const page = await authorizedPage(req, String(req.params.id));
  const kind = kindSchema.safeParse(req.params.kind);
  // Never expose original unsandboxed HTML as a file download.
  if (!page || !kind.success || kind.data === "html") { res.status(404).json({ error: "Not found" }); return; }
  try {
    const { body, asset } = await readPrivateAsset(page.id, page.revision, kind.data);
    res.type(PRIVATE_FILE_TYPES[kind.data].mime);
    res.set("Content-Disposition", `${kind.data === "audio" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(asset.filename)}`);
    if (kind.data === "audio") {
      res.set("Accept-Ranges", "bytes");
      const range = parsePrivateAudioRange(req.get("range"), body.length);
      if (range.kind === "unsatisfiable") { res.set("Content-Range", `bytes */${body.length}`).status(416).end(); return; }
      if (range.kind === "range") {
        res.set("Content-Range", `bytes ${range.start}-${range.end}/${body.length}`)
          .set("Content-Length", String(range.length)).status(206).send(body.subarray(range.start, range.end + 1)); return;
      }
    }
    res.set("Content-Length", String(body.length)).send(body);
  } catch (error) { res.status(error instanceof PrivatePageError ? error.status : 503).json({ error: "Private attachment unavailable." }); }
});

router.get(admin, requirePrivateStaff, async (req, res): Promise<void> => {
  const orgId = String(req.params.orgId);
  if (!(await activeOrg(orgId))) { res.status(404).json({ error: "Not found" }); return; }
  const result = await pool.query("SELECT * FROM private_customer_pages WHERE organization_id=$1 OR organization_id IS NULL ORDER BY created_at DESC", [orgId]);
  res.json({ items: await Promise.all(result.rows.map(pageResponse)) });
});
router.post(admin, requirePrivateStaff, privateWriteGuard, async (req, res): Promise<void> => {
  const parsed = metadata.safeParse(req.body), orgId = String(req.params.orgId);
  if (!parsed.success) { res.status(400).json({ error: "A title and lowercase hyphenated slug are required." }); return; }
  if (!(await activeOrg(orgId))) { res.status(404).json({ error: "Not found" }); return; }
  try {
    const result = await pool.query(`
      INSERT INTO private_customer_pages(organization_id,title,slug,created_by) VALUES($1,$2,$3,$4) RETURNING *
    `, [orgId, parsed.data.title, parsed.data.slug, req.authedUser!.id]);
    await audit({ actorId: req.authedUser!.id, action: "private_page.create", entity: "private_page", entityId: result.rows[0].id });
    res.status(201).json(await pageResponse(result.rows[0]));
  } catch { res.status(409).json({ error: "Unable to create page. Use a unique slug." }); }
});
router.patch(`${admin}/:id`, requirePrivateStaff, privateWriteGuard, async (req, res): Promise<void> => {
  const orgId = String(req.params.orgId), id = String(req.params.id), parsed = update.safeParse(req.body);
  if (!parsed.success || !uuid.safeParse(id).success) { res.status(400).json({ error: "Invalid update." }); return; }
  if (!(await activeOrg(orgId))) { res.status(404).json({ error: "Not found" }); return; }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("SELECT * FROM private_customer_pages WHERE id=$1 AND (organization_id=$2 OR organization_id IS NULL) FOR UPDATE", [id, orgId]);
    const page = result.rows[0], data = parsed.data;
    if (!page) throw new PrivatePageError(404, "Not found");
    if (data.revision !== page.revision) throw new PrivatePageError(409, "Page changed. Refresh and review again.");
    if (!page.organization_id && data.action !== "assign") throw new PrivatePageError(409, "Explicitly assign this intake draft to the selected organization first.");
    // Metadata and publication cannot be combined into a single surprise publish.
    if (data.action && (data.title !== undefined || data.slug !== undefined)) throw new PrivatePageError(400, "Save metadata separately before reviewing or publishing.");
    if (data.action === "assign") {
      if (page.organization_id) throw new PrivatePageError(409, "Page already assigned.");
      await client.query("UPDATE private_customer_pages SET organization_id=$2,updated_at=now() WHERE id=$1", [id, orgId]);
    } else if (data.action === "review" || data.action === "publish") {
      const assets = await client.query("SELECT kind,state FROM private_customer_assets WHERE page_id=$1 AND revision=$2", [id, page.revision]);
      if (!assets.rows.some(a => a.kind === "html" && a.state === "ready") || assets.rows.some(a => a.state !== "ready")) {
        throw new PrivatePageError(409, "Complete or replace all attachments before review.");
      }
      const { body } = await readPrivateAsset(id, page.revision, "html");
      if (preparePrivateHtml(body.toString("utf8")).requiresAudio && !assets.rows.some(a => a.kind === "audio")) {
        throw new PrivatePageError(409, "This HTML references audio. Attach the MP3 before review.");
      }
      if (data.action === "review") {
        await client.query("UPDATE private_customer_pages SET reviewed_revision=revision,reviewed_at=now(),reviewed_by=$2,updated_at=now() WHERE id=$1", [id, req.authedUser!.id]);
      } else {
        if (page.reviewed_revision !== page.revision) throw new PrivatePageError(409, "Review this revision before publishing.");
        await client.query("UPDATE private_customer_pages SET status='published',published_at=now(),published_by=$2,updated_at=now() WHERE id=$1", [id, req.authedUser!.id]);
      }
    } else {
      const metadataChanged = data.title !== undefined || data.slug !== undefined;
      if (metadataChanged) {
        const pending = await client.query("SELECT 1 FROM private_customer_assets WHERE page_id=$1 AND revision=$2 AND state='uploading'", [id, page.revision]);
        if (pending.rowCount) throw new PrivatePageError(409, "Wait for the upload to finish before editing metadata.");
        await client.query(`
          INSERT INTO private_customer_assets(page_id,revision,kind,state,container_id,item_id,filename,content_type,size_bytes,sha256,created_by)
          SELECT page_id,$2,kind,state,container_id,item_id,filename,content_type,size_bytes,sha256,$4
          FROM private_customer_assets WHERE page_id=$1 AND revision=$3
        `, [id, page.revision + 1, page.revision, req.authedUser!.id]);
      }
      await client.query(`
        UPDATE private_customer_pages SET title=COALESCE($2,title),slug=COALESCE($3,slug),
          status=$4,reviewed_revision=NULL,reviewed_at=NULL,reviewed_by=NULL,published_at=NULL,published_by=NULL,updated_at=now()
          ,revision=$5
        WHERE id=$1
      `, [id, data.title ?? null, data.slug ?? null, data.action === "archive" ? "archived" : "draft", metadataChanged ? page.revision + 1 : page.revision]);
    }
    await client.query("COMMIT");
    await audit({ actorId: req.authedUser!.id, action: `private_page.${data.action ?? "update"}`, entity: "private_page", entityId: id });
    const fresh = await pool.query("SELECT * FROM private_customer_pages WHERE id=$1", [id]);
    res.json(await pageResponse(fresh.rows[0]));
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(error instanceof PrivatePageError ? error.status : 409)
      .json({ error: error instanceof PrivatePageError ? error.message : "Unable to update page." });
  } finally { client.release(); }
});
router.put(`${admin}/:id/assets/:kind`, requirePrivateStaff, privateWriteGuard,
  express.raw({ type: "application/octet-stream", limit: "50mb" }),
  async (req, res): Promise<void> => {
    const orgId = String(req.params.orgId), pageId = String(req.params.id);
    const kind = kindSchema.safeParse(req.params.kind);
    const revision = Number(req.get("x-page-revision"));
    if (!kind.success || !uuid.safeParse(pageId).success || !Number.isSafeInteger(revision) || revision < 1 || !Buffer.isBuffer(req.body)) {
      res.status(400).json({ error: "Invalid upload." }); return;
    }
    if (!(await activeOrg(orgId))) { res.status(404).json({ error: "Not found" }); return; }
    try {
      const filename = decodeURIComponent(req.get("x-filename") ?? "");
      await uploadPrivateAsset({ orgId, pageId, revision, kind: kind.data as AssetKind, filename, body: req.body, actorId: req.authedUser!.id });
      await audit({ actorId: req.authedUser!.id, action: "private_page.upload", entity: "private_page", entityId: pageId });
      const fresh = await pool.query("SELECT * FROM private_customer_pages WHERE id=$1", [pageId]);
      res.json(await pageResponse(fresh.rows[0]));
    } catch (error) {
      res.status(error instanceof PrivatePageError ? error.status : 400).json({ error: error instanceof Error ? error.message : "Upload failed." });
    }
  });
export default router;
