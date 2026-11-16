import type { Request, RequestHandler } from "express";
import { pool } from "@workspace/db";
import { z } from "zod";
import { GetPrivateCustomerPageResponse } from "@workspace/api-zod";

export const uuid = z.string().uuid();
export function isPrivatePageAdmin(req: Request): boolean {
  const user = req.authedUser;
  return !!user && user.authProvider !== "shared_org" && user.authProvider !== "api_key" &&
    user.roles.some(role => role === "admin" || role === "site_admin");
}
export const requirePrivateStaff: RequestHandler = (req, res, next) => {
  if (!req.authedUser) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (req.authedUser.authProvider === "shared_org" || req.authedUser.authProvider === "api_key" ||
      !req.authedUser.effectiveCapabilities.includes("client_orgs.manage")) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  next();
};

export async function activeOrg(id: string) {
  if (!uuid.safeParse(id).success) return null;
  const r = await pool.query("SELECT id, name FROM client_organizations WHERE id=$1 AND is_active AND deleted_at IS NULL", [id]);
  return r.rows[0] ?? null;
}

export async function memberOrg(req: Request): Promise<string | null> {
  if (!req.authedUser) return null;
  // The current mapping is authoritative. Membership revocation clears it
  // in the existing client-org workflow; no role or staff fallback is used.
  const result = await pool.query(`
    SELECT u.client_organization_id AS id FROM users u
    JOIN client_organizations o ON o.id=u.client_organization_id
    WHERE u.id=$1 AND o.is_active AND o.deleted_at IS NULL
  `, [req.authedUser.id]);
  return result.rows[0]?.id ?? null;
}

export async function authorizedPage(req: Request, id: string) {
  if (!req.authedUser || !uuid.safeParse(id).success) return null;
  const previewOrg = req.query.previewOrg;
  let orgId: string | null = null;
  const preview = previewOrg !== undefined;
  // A direct page ID is an explicit target: administrators need no customer
  // membership or special preview URL. Other staff retain scoped previews.
  if (!preview && isPrivatePageAdmin(req)) {
    const result = await pool.query(`
      SELECT p.* FROM private_customer_pages p
      JOIN client_organizations o ON o.id=p.organization_id
      WHERE p.id=$1 AND o.is_active AND o.deleted_at IS NULL
    `, [id]);
    return result.rows[0] ?? null;
  }
  if (preview) {
    if (typeof previewOrg !== "string" || !uuid.safeParse(previewOrg).success ||
        req.authedUser.authProvider === "shared_org" || req.authedUser.authProvider === "api_key" ||
        !req.authedUser.effectiveCapabilities.includes("client_orgs.manage")) return null;
    orgId = previewOrg;
  } else orgId = await memberOrg(req);
  if (!orgId || !(await activeOrg(orgId))) return null;
  const result = await pool.query(`
    SELECT * FROM private_customer_pages WHERE id=$1 AND organization_id=$2
      AND ($3::boolean OR status='published')
  `, [id, orgId, preview]);
  return result.rows[0] ?? null;
}

export async function pageResponse(page: Record<string, any>) {
  const assets = await pool.query(`
    SELECT id,kind,filename,content_type AS "contentType",size_bytes::float8 AS "sizeBytes",state
    FROM private_customer_assets WHERE page_id=$1 AND revision=$2 AND state='ready'
  `, [page.id, page.revision]);
  return GetPrivateCustomerPageResponse.parse({
    id: page.id, organizationId: page.organization_id, title: page.title, slug: page.slug,
    status: page.status, revision: page.revision, reviewedRevision: page.reviewed_revision,
    assets: assets.rows,
  });
}
