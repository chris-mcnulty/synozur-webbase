import { type RequestHandler } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db, usersTable, clientOrganizationsTable } from "@workspace/db";

// Customer-audience gate for the Galaxy portal. Requires:
//   1. an authenticated session (req.authedUser populated by attachUserIfPresent)
//   2. the `customer` role in user.roles  — OR —  an admin/site_admin role
//   3. a linked, active, non-deleted client organization
//
// Admin bypass: `admin` and `site_admin` users skip the customer-role check so
// they can preview and troubleshoot the portal. If their account has no linked
// clientOrganizationId we fall back to the first active org in the DB. This
// means admins always land inside real portal content rather than a gate error.
//
// On failure responds with a 403 + machine-readable `reason` so the SPA can
// render a precise "you're signed in but…" page rather than a generic block.
export const requireCustomerAudience: RequestHandler = async (req, res, next) => {
  if (!req.authedUser) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const user = req.authedUser;

  const isAdmin = user.roles.some(
    (r) => r === "admin" || r === "site_admin",
  );

  if (!isAdmin && !user.roles.includes("customer")) {
    res.status(403).json({ error: "Forbidden", reason: "not_a_customer" });
    return;
  }

  const userRow = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, user.id),
    columns: { clientOrganizationId: true },
  });

  let orgId = userRow?.clientOrganizationId ?? null;

  // Admins with no personal org linked get the first active org for preview.
  if (!orgId && isAdmin) {
    const firstOrg = await db.query.clientOrganizationsTable.findFirst({
      where: and(
        eq(clientOrganizationsTable.isActive, true),
        isNull(clientOrganizationsTable.deletedAt),
      ),
      columns: { id: true },
    });
    orgId = firstOrg?.id ?? null;
  }

  if (!orgId) {
    res.status(403).json({ error: "Forbidden", reason: "no_organization" });
    return;
  }

  const org = await db.query.clientOrganizationsTable.findFirst({
    where: eq(clientOrganizationsTable.id, orgId),
  });
  if (!org || org.deletedAt || !org.isActive) {
    res
      .status(403)
      .json({ error: "Forbidden", reason: "organization_inactive" });
    return;
  }

  (req as typeof req & { portalOrgId?: string }).portalOrgId = org.id;
  next();
};
