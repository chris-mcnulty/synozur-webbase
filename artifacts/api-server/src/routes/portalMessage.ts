import { Router, type RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { db, portalMessageTable } from "@workspace/db";
import { GetAdminPortalMessageResponse, GetPortalCeoMessageResponse, SaveAdminPortalMessageBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { requireCustomerAudience } from "../middlewares/requireCustomerAudience";
import { audit } from "../lib/audit";

const router = Router();
const requireAdmin: RequestHandler = (req, res, next) => {
  const user = req.authedUser;
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (user.authProvider === "shared_org" || user.authProvider === "api_key" ||
      !user.roles.some(role => role === "admin" || role === "site_admin")) {
    res.status(403).json({ error: "Administrator access required" }); return;
  }
  next();
};
const empty = { message: "", signature: "", quarterLabel: "", visible: false };
async function read() {
  const [row] = await db.select().from(portalMessageTable).where(eq(portalMessageTable.id, 1));
  return GetAdminPortalMessageResponse.parse(row ?? empty);
}
router.use(["/admin/portal-message", "/portal/ceo-message"], (_req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  next();
});
router.get("/admin/portal-message", requireAdmin, async (_req, res) => {
  res.json(await read());
});
router.put("/admin/portal-message", requireAdmin, async (req, res): Promise<void> => {
  const parsed = SaveAdminPortalMessageBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Check the message and field lengths." }); return; }
  const input = {
    ...parsed.data, message: parsed.data.message.trim(),
    signature: parsed.data.signature.trim(), quarterLabel: parsed.data.quarterLabel.trim(),
  };
  if (input.visible && !input.message) {
    res.status(400).json({ error: "Enter a message before showing it in Galaxy." }); return;
  }
  await db.insert(portalMessageTable).values({ id: 1, ...input })
    .onConflictDoUpdate({ target: portalMessageTable.id, set: { ...input, updatedAt: new Date() } });
  await audit({ actorId: req.authedUser!.id, action: "portal_message.update", entity: "portal_message", entityId: "1" });
  res.json(GetAdminPortalMessageResponse.parse(input));
});
router.get("/portal/ceo-message", requireAuth, requireCustomerAudience, async (_req, res) => {
  const data = await read();
  res.json(GetPortalCeoMessageResponse.parse({ item: data.visible && data.message ? data : null }));
});
export default router;
