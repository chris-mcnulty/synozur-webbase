/**
 * Local, development-only intake. Never seeds or publishes production content.
 * Arguments are filenames/metadata only; no credentials or customer bytes are
 * printed. Uses exact organization-name matching, never a first-org fallback.
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import { uploadPrivateAsset } from "../lib/privatePages/service";
import { fileHash, type AssetKind } from "../lib/privatePages/files";

const { values } = parseArgs({ options: {
  "org-name": { type: "string" }, title: { type: "string" }, slug: { type: "string" },
  html: { type: "string" }, audio: { type: "string" }, transcript: { type: "string" },
  apply: { type: "boolean", default: false },
} });

async function main() {
  if (process.env.NODE_ENV === "production" || !values.apply) throw new Error("Development intake requires --apply; production import is not supported by this script.");
  if (!values["org-name"] || !values.title || !values.slug || !values.html ||
      !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(values.slug)) throw new Error("Provide --org-name, --title, --slug and --html.");
  const orgs = await pool.query("SELECT id FROM client_organizations WHERE lower(trim(name))=lower(trim($1)) AND is_active AND deleted_at IS NULL", [values["org-name"]]);
  const orgId = orgs.rowCount === 1 ? orgs.rows[0].id : null;
  let result = await pool.query("SELECT * FROM private_customer_pages WHERE organization_id IS NOT DISTINCT FROM $1::uuid AND slug=$2", [orgId, values.slug]);
  if (result.rowCount && result.rows[0].status !== "draft") throw new Error("Existing page is not a draft. Use the administration workflow to replace it.");
  if (!result.rowCount) result = await pool.query(`
    INSERT INTO private_customer_pages(organization_id,title,slug) VALUES($1,$2,$3) RETURNING *
  `, [orgId, values.title, values.slug]);
  const page = result.rows[0];
  for (const kind of ["html", "audio", "transcript"] as AssetKind[]) {
    const filename = values[kind];
    if (!filename) continue;
    const body = await readFile(filename);
    const existing = await pool.query("SELECT sha256 FROM private_customer_assets WHERE page_id=$1 AND revision=$2 AND kind=$3 AND state='ready'", [page.id, page.revision, kind]);
    if (existing.rows[0]?.sha256 === fileHash(body)) continue;
    page.revision = await uploadPrivateAsset({
      orgId, pageId: page.id, revision: page.revision, kind, filename: basename(filename), body, actorId: null,
    });
  }
  logger.info({ pageId: page.id, organizationId: orgId, status: "draft", unassigned: !orgId }, "Private customer intake completed; staff review required");
}
main().catch(() => {
  logger.error("Private intake failed. Existing content remains draft; inspect the private administration view before retrying.");
  process.exitCode = 1;
}).finally(() => pool.end());
