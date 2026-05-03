import { type RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, clientOrganizationsTable } from "@workspace/db";

// Customer-audience gate for the Galaxy portal. Requires:
//   1. an authenticated session (req.authedUser populated by attachUserIfPresent)
//   2. the `customer` role in user.roles
//   3. a linked, active, non-deleted client organization
//
// On failure responds with a 403 + machine-readable `reason` so the SPA can
// render a precise "you're signed in but…" page rather than a generic block.
export const requireCustomerAudience: RequestHandler = async (req, res, next) => {
  if (!req.authedUser) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const user = req.authedUser;
  if (!user.roles.includes("customer")) {
    res.status(403).json({ error: "Forbidden", reason: "not_a_customer" });
    return;
  }
  const userRow = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, user.id),
    columns: { clientOrganizationId: true },
  });
  if (!userRow?.clientOrganizationId) {
    res.status(403).json({ error: "Forbidden", reason: "no_organization" });
    return;
  }
  const org = await db.query.clientOrganizationsTable.findFirst({
    where: eq(clientOrganizationsTable.id, userRow.clientOrganizationId),
  });
  if (!org || org.deletedAt || !org.isActive) {
    res
      .status(403)
      .json({ error: "Forbidden", reason: "organization_inactive" });
    return;
  }
  // Hand the resolved org to downstream handlers so they don't re-fetch.
  (req as typeof req & { portalOrgId?: string }).portalOrgId = org.id;
  next();
};
