import { Router, type IRouter } from "express";
import { db, boardProfilesTable, boardSettingsTable, teamMembersTable, auditLogTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateBoardProfileBody, UpdateBoardProfileBody, UpdateBoardProfileParams,
  DeleteBoardProfileParams, SetBoardVisibilityBody, ListBoardResponse,
  GetBoardProfileResponse, ListBoardTeamOptionsResponse,
} from "@workspace/api-zod";
import { boardIsPublic, boardRoster, privateBoardHeaders, requireBoardAdmin, requireBoardRead } from "../lib/board";

const router: IRouter = Router();
router.use(["/board", "/admin/board"], privateBoardHeaders);
router.get("/board/status", async (_req, res): Promise<void> => {
  res.json({ public: await boardIsPublic() });
});
router.get("/board", requireBoardRead, async (_req, res): Promise<void> => {
  res.json(ListBoardResponse.parse({ public: await boardIsPublic(), items: await boardRoster() }));
});
router.get("/board/:slug", requireBoardRead, async (req, res): Promise<void> => {
  const person = (await boardRoster()).find(p => p.slug === req.params.slug);
  if (!person) { res.status(404).json({ error: "Not found" }); return; }
  res.json(GetBoardProfileResponse.parse(person));
});
router.use("/admin/board", requireBoardAdmin);
router.get("/admin/board", async (_req, res): Promise<void> => {
  res.json(ListBoardResponse.parse({ public: await boardIsPublic(), items: await boardRoster(true) }));
});
router.get("/admin/board/team-options", async (_req, res): Promise<void> => {
  res.json(ListBoardTeamOptionsResponse.parse(await db.select({
    id: teamMembersTable.id, name: teamMembersTable.name, slug: teamMembersTable.slug,
  }).from(teamMembersTable)));
});
router.put("/admin/board/visibility", async (req, res): Promise<void> => {
  const parsed = SetBoardVisibilityBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  await db.transaction(async tx => {
    const [before] = await tx.select().from(boardSettingsTable).where(eq(boardSettingsTable.id, 1));
    await tx.insert(boardSettingsTable).values({ id: 1, public: parsed.data.public })
      .onConflictDoUpdate({ target: boardSettingsTable.id, set: { public: parsed.data.public } });
    await tx.insert(auditLogTable).values({ actorId: req.authedUser!.id, action: "board.visibility", entity: "board", entityId: "1", diffJson: { before: { public: before?.public ?? false }, after: parsed.data } });
  });
  res.json(parsed.data);
});

for (const method of ["post", "put"] as const) {
  router[method](method === "post" ? "/admin/board" : "/admin/board/:id", async (req, res): Promise<void> => {
    const parsed = (method === "post" ? CreateBoardProfileBody : UpdateBoardProfileBody).safeParse(req.body);
    const params = UpdateBoardProfileParams.safeParse(req.params);
    if (!parsed.success || (method === "put" && !params.success)) {
      res.status(400).json({ error: "Invalid board profile" }); return;
    }
    const d = parsed.data;
    if (d.group === "internal" ? !d.teamMemberId : !!d.teamMemberId || !d.name?.trim() || !d.slug) {
      res.status(400).json({ error: "External advisors need a name and slug; internal members must link a Team profile." }); return;
    }
    for (const value of [d.website, d.linkedinUrl, d.speakerBookingUrl]) {
      if (value && !/^https?:\/\/[^\s]+$/i.test(value)) { res.status(400).json({ error: "Links must use http or https" }); return; }
    }
    if (d.imageUrl && !/^(\/api\/storage\/|\/images\/|https?:\/\/)/i.test(d.imageUrl)) {
      res.status(400).json({ error: "Choose a photo from the media library" }); return;
    }
    if (d.teamMemberId) {
      const [team] = await db.select().from(teamMembersTable).where(eq(teamMembersTable.id, d.teamMemberId));
      if (!team) { res.status(400).json({ error: "Team member does not exist" }); return; }
    }
    if (d.group === "external" && d.slug) {
      const [reserved] = await db.select({ id: teamMembersTable.id }).from(teamMembersTable).where(eq(teamMembersTable.slug, d.slug));
      if (reserved) { res.status(409).json({ error: "This slug belongs to an existing Team profile; link that profile instead." }); return; }
    }
    // Internal memberships store no duplicate identity, biography or portrait.
    const value = {
      group: d.group, teamMemberId: d.group === "internal" ? d.teamMemberId : null,
      active: d.active, sortOrder: d.sortOrder,
      ...Object.fromEntries(["slug", "name", "jobTitle", "shortDescription", "longDescription", "imageUrl", "linkedinUrl", "website", "email", "speakerBookingUrl"]
        .map(key => [key, d.group === "internal" ? null : (d[key as keyof typeof d] ?? null)])),
    };
    try {
      const saved = await db.transaction(async tx => {
        const [before] = method === "put" && params.success ? await tx.select().from(boardProfilesTable).where(eq(boardProfilesTable.id, params.data.id)) : [];
        const [after] = method === "post"
          ? await tx.insert(boardProfilesTable).values(value).returning()
          : await tx.update(boardProfilesTable).set({ ...value, updatedAt: new Date() }).where(eq(boardProfilesTable.id, params.success ? params.data.id : 0)).returning();
        if (after) await tx.insert(auditLogTable).values({ actorId: req.authedUser!.id, action: `board.${method === "post" ? "create" : "update"}`, entity: "board_profile", entityId: String(after.id), diffJson: { before, after } });
        return after;
      });
      if (!saved) { res.status(404).json({ error: "Not found" }); return; }
      const result = (await boardRoster(true)).find(p => p.id === saved.id);
      res.status(method === "post" ? 201 : 200).json(GetBoardProfileResponse.parse(result));
    } catch (error) {
      if ((error as { cause?: { code?: string }; code?: string }).cause?.code === "23505" || (error as { code?: string }).code === "23505") {
        res.status(409).json({ error: "This slug or Team membership already exists" }); return;
      }
      throw error;
    }
  });
}
router.delete("/admin/board/:id", async (req, res): Promise<void> => {
  const parsed = DeleteBoardProfileParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const removed = await db.transaction(async tx => {
    const [before] = await tx.delete(boardProfilesTable).where(eq(boardProfilesTable.id, parsed.data.id)).returning();
    if (before) await tx.insert(auditLogTable).values({ actorId: req.authedUser!.id, action: "board.delete", entity: "board_profile", entityId: String(before.id), diffJson: { before } });
    return before;
  });
  if (!removed) { res.status(404).json({ error: "Not found" }); return; }
  res.sendStatus(204);
});
export default router;
