import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { speFileStorage } from "../storage/spe/fileStorage";
import { fileHash, PRIVATE_FILE_TYPES, validatePrivateFile, type AssetKind } from "./files";

export class PrivatePageError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function uploadPrivateAsset(args: {
  orgId: string | null; pageId: string; revision: number; kind: AssetKind;
  filename: string; body: Buffer; actorId: string | null;
}) {
  validatePrivateFile(args.kind, args.filename, args.body);
  const client = await pool.connect();
  const assetId = randomUUID();
  let revision = args.revision + 1;
  try {
    await client.query("BEGIN");
    const result = await client.query(`
      SELECT * FROM private_customer_pages WHERE id=$1 AND organization_id IS NOT DISTINCT FROM $2::uuid FOR UPDATE
    `, [args.pageId, args.orgId]);
    const page = result.rows[0];
    if (!page) throw new PrivatePageError(404, "Not found");
    if (page.revision !== args.revision) throw new PrivatePageError(409, "Page changed. Refresh before uploading.");
    const pending = await client.query("SELECT 1 FROM private_customer_assets WHERE page_id=$1 AND revision=$2 AND state='uploading'", [args.pageId, page.revision]);
    if (pending.rowCount) throw new PrivatePageError(409, "Another upload is still in progress.");
    revision = page.revision + 1;
    // Make replacement privacy effective before the provider upload starts.
    await client.query(`
      UPDATE private_customer_pages SET revision=$2,status='draft',reviewed_revision=NULL,
        reviewed_at=NULL,reviewed_by=NULL,published_at=NULL,published_by=NULL,updated_at=now()
      WHERE id=$1
    `, [args.pageId, revision]);
    await client.query(`
      INSERT INTO private_customer_assets(page_id,revision,kind,state,container_id,item_id,filename,content_type,size_bytes,sha256,created_by)
      SELECT page_id,$2,kind,state,container_id,item_id,filename,content_type,size_bytes,sha256,$4
      FROM private_customer_assets WHERE page_id=$1 AND revision=$3 AND kind<>$5
    `, [args.pageId, revision, page.revision, args.actorId, args.kind]);
    await client.query(`
      INSERT INTO private_customer_assets(id,page_id,revision,kind,state,filename,content_type,created_by)
      VALUES($1,$2,$3,$4,'uploading',$5,$6,$7)
    `, [assetId, args.pageId, revision, args.kind, args.filename, PRIVATE_FILE_TYPES[args.kind].mime, args.actorId]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally { client.release(); }
  try {
    const stored = await speFileStorage.storeFile({
      body: args.body, filename: `${args.kind}${PRIVATE_FILE_TYPES[args.kind].extension}`,
      contentType: PRIVATE_FILE_TYPES[args.kind].mime, documentType: "private-page",
      ownerId: assetId, uploadedByUserId: args.actorId ?? undefined,
    });
    // Keep the provider reference even if completion fails, so orphan cleanup
    // can never remove a successfully registered private asset.
    await pool.query(`
      UPDATE private_customer_assets SET state='ready',container_id=$2,item_id=$3,size_bytes=$4,sha256=$5,updated_at=now()
      WHERE id=$1
    `, [assetId, stored.containerId, stored.itemId, args.body.length, fileHash(args.body)]);
  } catch {
    await pool.query("UPDATE private_customer_assets SET state='failed',updated_at=now() WHERE id=$1", [assetId]);
    throw new PrivatePageError(503, "Private upload failed. The page remains a draft; retry the attachment.");
  }
  return revision;
}

export async function readPrivateAsset(pageId: string, revision: number, kind: AssetKind) {
  const result = await pool.query(`
    SELECT * FROM private_customer_assets WHERE page_id=$1 AND revision=$2 AND kind=$3 AND state='ready'
  `, [pageId, revision, kind]);
  const asset = result.rows[0];
  if (!asset) throw new PrivatePageError(404, "Not found");
  const response = await speFileStorage.getFile(asset.item_id, asset.container_id);
  if (!response.ok || !response.body) throw new PrivatePageError(503, "Private attachment unavailable.");
  const chunks: Buffer[] = [];
  let length = 0;
  const reader = response.body.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > PRIVATE_FILE_TYPES[kind].limit || length > Number(asset.size_bytes)) {
      await reader.cancel();
      throw new PrivatePageError(503, "Private attachment unavailable.");
    }
    chunks.push(Buffer.from(value));
  }
  const body = Buffer.concat(chunks);
  if (length !== Number(asset.size_bytes) || fileHash(body) !== asset.sha256) {
    throw new PrivatePageError(503, "Private attachment unavailable.");
  }
  return { asset, body };
}
