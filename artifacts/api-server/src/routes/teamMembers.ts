import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { db, teamMembersTable, type TeamMember } from "@workspace/db";
import {
  ListPublicTeamMembersResponse,
  GetPublicTeamMemberParams,
  GetPublicTeamMemberResponse,
  ListAdminTeamMembersResponse,
  ListAdminTeamMembersResponseItem,
  GetAdminTeamMemberResponse,
  GetAdminTeamMemberParams,
  CreateTeamMemberBody,
  UpdateTeamMemberBody,
  UpdateTeamMemberParams,
  DeleteTeamMemberParams,
} from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/requireAdmin";
import { ricosToHtml } from "../lib/ricos";

const router: IRouter = Router();

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/['"\u2018\u2019\u201C\u201D]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function ensureUniqueSlug(base: string, ignoreId?: number): Promise<string> {
  const seed = base || `team-member-${Date.now()}`;
  let candidate = seed;
  let i = 2;
  for (let attempt = 0; attempt < 100; attempt++) {
    const existing = await db
      .select({ id: teamMembersTable.id })
      .from(teamMembersTable)
      .where(eq(teamMembersTable.slug, candidate));
    const conflict = existing.find((e) => e.id !== ignoreId);
    if (!conflict) return candidate;
    candidate = `${seed}-${i++}`;
  }
  return `${seed}-${Date.now()}`;
}

function publicShape(m: TeamMember) {
  return {
    id: m.id,
    name: m.name,
    slug: m.slug,
    jobTitle: m.jobTitle,
    shortDescription: m.shortDescription,
    imageUrl: m.imageUrl,
    linkedinUrl: m.linkedinUrl,
    website: m.website,
    email: m.email,
    active: m.active,
    manualSort: m.manualSort,
    tags: m.tags ?? [],
  };
}

function adminShape(m: TeamMember) {
  return {
    id: m.id,
    name: m.name,
    slug: m.slug,
    jobTitle: m.jobTitle,
    shortDescription: m.shortDescription,
    longDescription: m.longDescription,
    imageUrl: m.imageUrl,
    website: m.website,
    email: m.email,
    phone: m.phone,
    linkedinUrl: m.linkedinUrl,
    active: m.active,
    manualSort: m.manualSort,
    tags: m.tags ?? [],
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

router.get("/team-members", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(teamMembersTable)
    .where(eq(teamMembersTable.active, true))
    .orderBy(asc(teamMembersTable.manualSort), asc(teamMembersTable.name));
  res.json(ListPublicTeamMembersResponse.parse(rows.map(publicShape)));
});

router.get("/team-members/:slug", async (req, res): Promise<void> => {
  const params = GetPublicTeamMemberParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [m] = await db
    .select()
    .from(teamMembersTable)
    .where(eq(teamMembersTable.slug, params.data.slug));
  if (!m || !m.active) {
    res.status(404).json({ error: "Team member not found" });
    return;
  }
  res.json(
    GetPublicTeamMemberResponse.parse({
      id: m.id,
      name: m.name,
      slug: m.slug,
      jobTitle: m.jobTitle,
      shortDescription: m.shortDescription,
      longDescription: ricosToHtml(m.longDescription),
      imageUrl: m.imageUrl,
      linkedinUrl: m.linkedinUrl,
      website: m.website,
      email: m.email,
      active: m.active,
      tags: m.tags ?? [],
    }),
  );
});

router.get("/admin/team-members", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(teamMembersTable)
    .orderBy(asc(teamMembersTable.manualSort), asc(teamMembersTable.name));
  res.json(ListAdminTeamMembersResponse.parse(rows.map(adminShape)));
});

router.get("/admin/team-members/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = GetAdminTeamMemberParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [m] = await db
    .select()
    .from(teamMembersTable)
    .where(eq(teamMembersTable.id, params.data.id));
  if (!m) {
    res.status(404).json({ error: "Team member not found" });
    return;
  }
  res.json(GetAdminTeamMemberResponse.parse(adminShape(m)));
});

router.post("/admin/team-members", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateTeamMemberBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const slugBase = parsed.data.slug?.trim() || slugify(parsed.data.name);
  const slug = await ensureUniqueSlug(slugBase);
  const [m] = await db
    .insert(teamMembersTable)
    .values({
      name: parsed.data.name,
      slug,
      jobTitle: parsed.data.jobTitle ?? "",
      shortDescription: parsed.data.shortDescription ?? null,
      longDescription: parsed.data.longDescription ?? null,
      imageUrl: parsed.data.imageUrl ?? null,
      website: parsed.data.website ?? null,
      email: parsed.data.email ?? null,
      phone: parsed.data.phone ?? null,
      linkedinUrl: parsed.data.linkedinUrl ?? null,
      active: parsed.data.active ?? true,
      manualSort: parsed.data.manualSort ?? "",
      tags: parsed.data.tags ?? [],
    })
    .returning();
  res.status(201).json(ListAdminTeamMembersResponseItem.parse(adminShape(m)));
});

router.patch("/admin/team-members/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateTeamMemberParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateTeamMemberBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const slugBase = parsed.data.slug?.trim() || slugify(parsed.data.name);
  const slug = await ensureUniqueSlug(slugBase, params.data.id);
  const [m] = await db
    .update(teamMembersTable)
    .set({
      name: parsed.data.name,
      slug,
      jobTitle: parsed.data.jobTitle ?? "",
      shortDescription: parsed.data.shortDescription ?? null,
      longDescription: parsed.data.longDescription ?? null,
      imageUrl: parsed.data.imageUrl ?? null,
      website: parsed.data.website ?? null,
      email: parsed.data.email ?? null,
      phone: parsed.data.phone ?? null,
      linkedinUrl: parsed.data.linkedinUrl ?? null,
      active: parsed.data.active ?? true,
      manualSort: parsed.data.manualSort ?? "",
      tags: parsed.data.tags ?? [],
    })
    .where(eq(teamMembersTable.id, params.data.id))
    .returning();
  if (!m) {
    res.status(404).json({ error: "Team member not found" });
    return;
  }
  res.json(ListAdminTeamMembersResponseItem.parse(adminShape(m)));
});

router.delete("/admin/team-members/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = DeleteTeamMemberParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [m] = await db
    .delete(teamMembersTable)
    .where(eq(teamMembersTable.id, params.data.id))
    .returning();
  if (!m) {
    res.status(404).json({ error: "Team member not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
