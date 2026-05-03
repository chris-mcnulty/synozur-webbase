import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  portalArtifactsTable,
  PORTAL_SOURCE_APPS,
  type PortalSourceApp,
  type PortalArtifact,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { requireCustomerAudience } from "../middlewares/requireCustomerAudience";
import { audit } from "../lib/audit";

// Galaxy per-application cockpit (#226). Public consumer endpoints behind
// `requireCustomerAudience` — the same gate used by /portal/me and
// /portal/engagements. All endpoints scope reads to the signed-in user's
// linked client organization.

const router: IRouter = Router();

function portalOrgId(req: Request): string {
  const id = (req as Request & { portalOrgId?: string }).portalOrgId;
  if (!id) throw new Error("portalOrgId missing — middleware order?");
  return id;
}

// Card metadata mirrors `artifacts/synozur/src/data/applications.ts` so the
// portal's six cards visually align with the marketing-site cards. Hard-coded
// here (rather than read from the DB applications table) because the portal
// only ever surfaces the six cockpit-eligible apps; community packages like
// the Holidays SPFx web part are deliberately omitted.
type AppCardSeed = {
  sourceApp: PortalSourceApp;
  name: string;
  tagline: string;
  logo: string;
};

const APP_CARDS: AppCardSeed[] = [
  {
    sourceApp: "constellation",
    name: "Constellation",
    tagline: "Navigate your projects like the stars.",
    logo: "/images/applications/constellation-logo.jpg",
  },
  {
    sourceApp: "vega",
    name: "Vega",
    tagline: "Put strategy to work, every day.",
    logo: "/images/applications/vega-logo.png",
  },
  {
    sourceApp: "nebula",
    name: "Nebula",
    tagline: "The birthplace of new starlight.",
    logo: "/images/applications/nebula-logo.jpg",
  },
  {
    sourceApp: "orion",
    name: "Orion",
    tagline: "Chart your course with confidence.",
    logo: "/images/applications/orion-logo.jpg",
  },
  {
    sourceApp: "orbit",
    name: "Orbit",
    tagline: "Market intelligence that never sleeps.",
    logo: "/images/applications/orbit-logo.jpg",
  },
  {
    sourceApp: "zenith",
    name: "Zenith",
    tagline: "Enterprise governance for Microsoft 365.",
    logo: "/images/applications/zenith-logo.jpg",
  },
];

function visibleArtifactWhere(orgId: string) {
  return and(
    eq(portalArtifactsTable.clientOrganizationId, orgId),
    isNull(portalArtifactsTable.deletedAt),
    isNull(portalArtifactsTable.archivedAt),
  );
}

function serialize(a: PortalArtifact, includePayload: boolean) {
  const base = {
    id: a.id,
    sourceApp: a.sourceApp,
    artifactKind: a.artifactKind,
    title: a.title,
    summary: a.summary,
    externalUrl: a.externalUrl,
    thumbnail: a.thumbnail,
    publishedAt: a.publishedAt ? a.publishedAt.toISOString() : null,
    createdAt: a.createdAt.toISOString(),
  };
  return includePayload ? { ...base, payload: a.payload ?? null } : base;
}

// GET /api/portal/apps
router.get(
  "/portal/apps",
  requireAuth,
  requireCustomerAudience,
  async (req, res) => {
    const orgId = portalOrgId(req);
    const counts = await db
      .select({
        sourceApp: portalArtifactsTable.sourceApp,
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(portalArtifactsTable)
      .where(visibleArtifactWhere(orgId))
      .groupBy(portalArtifactsTable.sourceApp);
    const byApp = new Map<PortalSourceApp, number>();
    for (const row of counts) {
      byApp.set(row.sourceApp, Number(row.count));
    }
    const items = APP_CARDS.map((card) => ({
      ...card,
      artifactCount: byApp.get(card.sourceApp) ?? 0,
    }));
    res.json({ items });
  },
);

// GET /api/portal/apps/:sourceApp
const SourceAppParam = z.enum(
  PORTAL_SOURCE_APPS as readonly [PortalSourceApp, ...PortalSourceApp[]],
);

router.get(
  "/portal/apps/:sourceApp",
  requireAuth,
  requireCustomerAudience,
  async (req, res) => {
    const parsed = SourceAppParam.safeParse(req.params.sourceApp);
    if (!parsed.success) {
      res.status(400).json({ error: "Unknown sourceApp" });
      return;
    }
    const orgId = portalOrgId(req);
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));

    const where = and(
      visibleArtifactWhere(orgId),
      eq(portalArtifactsTable.sourceApp, parsed.data),
    );

    const [{ total }] = await db
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(portalArtifactsTable)
      .where(where);

    const rows = await db
      .select()
      .from(portalArtifactsTable)
      .where(where)
      .orderBy(
        sql`${portalArtifactsTable.publishedAt} desc nulls last`,
        desc(portalArtifactsTable.createdAt),
      )
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    res.json({
      items: rows.map((r) => serialize(r, false)),
      total: Number(total ?? 0),
    });
  },
);

// GET /api/portal/artifacts/:id — full payload + records a view event.
router.get(
  "/portal/artifacts/:id",
  requireAuth,
  requireCustomerAudience,
  async (req, res) => {
    const id = String(req.params.id ?? "");
    const orgId = portalOrgId(req);
    const row = await db.query.portalArtifactsTable.findFirst({
      where: and(
        eq(portalArtifactsTable.id, id),
        eq(portalArtifactsTable.clientOrganizationId, orgId),
        isNull(portalArtifactsTable.deletedAt),
        isNull(portalArtifactsTable.archivedAt),
      ),
    });
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    // Telemetry: record a `portal.artifact_view` audit event so account
    // teams can see which clients are engaging with which app outputs.
    void audit({
      actorId: req.authedUser!.id,
      action: "portal.artifact_view",
      entity: "portal_artifact",
      entityId: row.id,
      diff: {
        clientOrganizationId: orgId,
        sourceApp: row.sourceApp,
        artifactKind: row.artifactKind,
      },
    });
    res.json(serialize(row, true));
  },
);

export default router;
