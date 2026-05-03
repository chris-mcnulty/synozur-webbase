import { Router, type IRouter, type Request } from "express";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import {
  db,
  usersTable,
  clientOrganizationsTable,
  clientOrganizationUsersTable,
  engagementsTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { requireCustomerAudience } from "../middlewares/requireCustomerAudience";

const router: IRouter = Router();

function portalOrgId(req: Request): string {
  const id = (req as Request & { portalOrgId?: string }).portalOrgId;
  if (!id) throw new Error("portalOrgId missing — middleware order?");
  return id;
}

// GET /api/portal/me — greeting payload: signed-in user, their org, and the
// account-team card (account manager + primary contacts on the join table).
router.get(
  "/portal/me",
  requireAuth,
  requireCustomerAudience,
  async (req, res) => {
    const orgId = portalOrgId(req);
    const user = req.authedUser!;

    const org = await db.query.clientOrganizationsTable.findFirst({
      where: eq(clientOrganizationsTable.id, orgId),
    });
    if (!org) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }

    const accountTeam: Array<{
      id: string;
      displayName: string | null;
      email: string | null;
      avatarUrl: string | null;
      role: "account_manager" | "primary_contact";
    }> = [];

    if (org.accountManagerUserId) {
      const mgr = await db.query.usersTable.findFirst({
        where: eq(usersTable.id, org.accountManagerUserId),
        columns: { id: true, displayName: true, email: true, avatarUrl: true },
      });
      if (mgr) {
        accountTeam.push({
          id: mgr.id,
          displayName: mgr.displayName,
          email: mgr.email,
          avatarUrl: mgr.avatarUrl,
          role: "account_manager",
        });
      }
    }

    const primaries = await db
      .select({
        id: usersTable.id,
        displayName: usersTable.displayName,
        email: usersTable.email,
        avatarUrl: usersTable.avatarUrl,
      })
      .from(clientOrganizationUsersTable)
      .innerJoin(
        usersTable,
        eq(clientOrganizationUsersTable.userId, usersTable.id),
      )
      .where(
        and(
          eq(clientOrganizationUsersTable.clientOrganizationId, orgId),
          eq(clientOrganizationUsersTable.role, "primary_contact"),
          ne(usersTable.id, user.id),
        ),
      )
      .orderBy(asc(usersTable.displayName));
    for (const p of primaries) {
      // Don't double-list a primary contact who is also the account manager.
      if (accountTeam.some((m) => m.id === p.id)) continue;
      accountTeam.push({ ...p, role: "primary_contact" });
    }

    res.json({
      user: {
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        avatarUrl: user.avatarUrl,
      },
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        isActive: org.isActive,
      },
      accountTeam,
    });
  },
);

// GET /api/portal/engagements — non-deleted, non-archived engagements for the
// signed-in user's org, with the account lead's display info attached.
router.get(
  "/portal/engagements",
  requireAuth,
  requireCustomerAudience,
  async (req, res) => {
    const orgId = portalOrgId(req);
    const rows = await db
      .select({
        id: engagementsTable.id,
        title: engagementsTable.title,
        slug: engagementsTable.slug,
        status: engagementsTable.status,
        summary: engagementsTable.summary,
        startedAt: engagementsTable.startedAt,
        createdAt: engagementsTable.createdAt,
        leadId: usersTable.id,
        leadDisplayName: usersTable.displayName,
        leadEmail: usersTable.email,
        leadAvatarUrl: usersTable.avatarUrl,
      })
      .from(engagementsTable)
      .leftJoin(
        usersTable,
        eq(engagementsTable.accountLeadUserId, usersTable.id),
      )
      .where(
        and(
          eq(engagementsTable.clientOrganizationId, orgId),
          isNull(engagementsTable.deletedAt),
          ne(engagementsTable.status, "archived"),
        ),
      )
      .orderBy(asc(engagementsTable.title));

    const items = rows.map((r) => ({
      id: r.id,
      title: r.title,
      slug: r.slug,
      status: r.status,
      summary: r.summary,
      startedAt: r.startedAt ? r.startedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      accountLead: r.leadId
        ? {
            id: r.leadId,
            displayName: r.leadDisplayName,
            email: r.leadEmail,
            avatarUrl: r.leadAvatarUrl,
          }
        : null,
    }));

    res.json({ items });
  },
);

export default router;
