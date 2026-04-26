import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, auditLogTable } from "@workspace/db";
import { requireAuth, requireRole } from "../../middlewares/auth";

const router: IRouter = Router();

router.get(
  "/cms/security/lockouts",
  requireAuth,
  requireRole("admin"),
  async (_req, res) => {
    const rows = await db
      .select({
        id: auditLogTable.id,
        ip: auditLogTable.entityId,
        at: auditLogTable.at,
      })
      .from(auditLogTable)
      .where(eq(auditLogTable.action, "auth.login_rate_limited"))
      .orderBy(desc(auditLogTable.at))
      .limit(200);

    res.json(
      rows.map((r) => ({
        id: r.id,
        ip: r.ip ?? "unknown",
        at: r.at.toISOString(),
      })),
    );
  },
);

export default router;
