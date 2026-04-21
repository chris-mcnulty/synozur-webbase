import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { db, eventsTable, assetsTable, type Event, type Asset } from "@workspace/db";
import {
  ListPublicEventsResponse,
  ListPublicEventsResponseItem,
  ListAdminEventsResponse,
  ListAdminEventsResponseItem,
  GetAdminEventResponse,
  CreateEventBody,
  UpdateEventBody,
  GetAdminEventParams,
  UpdateEventParams,
  DeleteEventParams,
} from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/requireAdmin";
import {
  upsertCollateralFromEvent,
  softDeleteCollateralForEvent,
} from "../lib/syncCollateral";

const router: IRouter = Router();

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function ensureUniqueSlug(base: string, ignoreId?: number): Promise<string> {
  const seed = base || `event-${Date.now()}`;
  let candidate = seed;
  let i = 2;
  for (let attempt = 0; attempt < 100; attempt++) {
    const existing = await db
      .select({ id: eventsTable.id })
      .from(eventsTable)
      .where(eq(eventsTable.slug, candidate));
    const conflict = existing.find((e) => e.id !== ignoreId);
    if (!conflict) return candidate;
    candidate = `${seed}-${i++}`;
  }
  return `${seed}-${Date.now()}`;
}

function imageUrlFor(asset: Asset | undefined | null): string | null {
  if (!asset) return null;
  return `/api/storage${asset.storageKey}`;
}

async function loadEventWithImage(
  event: Event,
): Promise<{ event: Event; imageUrl: string | null }> {
  if (!event.imageAssetId) return { event, imageUrl: null };
  const [asset] = await db
    .select()
    .from(assetsTable)
    .where(eq(assetsTable.id, event.imageAssetId));
  return { event, imageUrl: imageUrlFor(asset) };
}

function publicShape(event: Event, imageUrl: string | null) {
  return {
    id: event.id,
    title: event.title,
    slug: event.slug,
    startDate: event.startDate,
    location: event.location,
    description: event.description,
    registrationUrl: event.registrationUrl,
    registrationStatus: event.registrationStatus,
    eventType: event.eventType,
    status: event.status,
    imageUrl,
  };
}

function adminShape(event: Event, imageUrl: string | null) {
  return {
    id: event.id,
    title: event.title,
    slug: event.slug,
    startDate: event.startDate,
    location: event.location,
    description: event.description,
    registrationUrl: event.registrationUrl,
    registrationStatus: event.registrationStatus,
    eventType: event.eventType,
    status: event.status,
    imageAssetId: event.imageAssetId,
    imageUrl,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

router.get("/events", async (_req, res): Promise<void> => {
  const rows = await db.select().from(eventsTable).orderBy(asc(eventsTable.startDate));
  const enriched = await Promise.all(rows.map((e) => loadEventWithImage(e)));
  res.json(
    ListPublicEventsResponse.parse(enriched.map(({ event, imageUrl }) => publicShape(event, imageUrl))),
  );
});

router.get("/events/:slug", async (req, res): Promise<void> => {
  const slug = String(req.params.slug);
  const [event] = await db
    .select()
    .from(eventsTable)
    .where(eq(eventsTable.slug, slug));
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  const { imageUrl } = await loadEventWithImage(event);
  res.json(publicShape(event, imageUrl));
});

router.get("/admin/events", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db.select().from(eventsTable).orderBy(asc(eventsTable.startDate));
  const enriched = await Promise.all(rows.map((e) => loadEventWithImage(e)));
  res.json(
    ListAdminEventsResponse.parse(enriched.map(({ event, imageUrl }) => adminShape(event, imageUrl))),
  );
});

router.get("/admin/events/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = GetAdminEventParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, params.data.id));
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  const { imageUrl } = await loadEventWithImage(event);
  res.json(GetAdminEventResponse.parse(adminShape(event, imageUrl)));
});

router.post("/admin/events", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateEventBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const slugBase = parsed.data.slug?.trim() || slugify(parsed.data.title);
  const slug = await ensureUniqueSlug(slugBase);
  const [event] = await db
    .insert(eventsTable)
    .values({
      title: parsed.data.title,
      slug,
      startDate: parsed.data.startDate,
      location: parsed.data.location ?? null,
      description: parsed.data.description ?? null,
      registrationUrl: parsed.data.registrationUrl ?? null,
      registrationStatus: parsed.data.registrationStatus ?? "UNKNOWN_REGISTRATION_STATUS",
      eventType: parsed.data.eventType ?? "RSVP",
      status: parsed.data.status ?? "UPCOMING",
      imageAssetId: parsed.data.imageAssetId ?? null,
    })
    .returning();
  const { imageUrl } = await loadEventWithImage(event);
  try {
    await upsertCollateralFromEvent(event, imageUrl);
  } catch (error) {
    console.error("Failed to sync collateral after event create", {
      eventId: event.id,
      error,
    });
  }
  res.status(201).json(ListAdminEventsResponseItem.parse(adminShape(event, imageUrl)));
});

router.patch("/admin/events/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateEventParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateEventBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const slugBase = parsed.data.slug?.trim() || slugify(parsed.data.title);
  const slug = await ensureUniqueSlug(slugBase, params.data.id);
  const [event] = await db
    .update(eventsTable)
    .set({
      title: parsed.data.title,
      slug,
      startDate: parsed.data.startDate,
      location: parsed.data.location ?? null,
      description: parsed.data.description ?? null,
      registrationUrl: parsed.data.registrationUrl ?? null,
      registrationStatus: parsed.data.registrationStatus ?? "UNKNOWN_REGISTRATION_STATUS",
      eventType: parsed.data.eventType ?? "RSVP",
      status: parsed.data.status ?? "UPCOMING",
      imageAssetId: parsed.data.imageAssetId ?? null,
    })
    .where(eq(eventsTable.id, params.data.id))
    .returning();
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  const { imageUrl } = await loadEventWithImage(event);
  try {
    await upsertCollateralFromEvent(event, imageUrl);
  } catch (error) {
    console.error("Failed to sync collateral after event update", {
      eventId: event.id,
      error,
    });
  }
  res.json(ListAdminEventsResponseItem.parse(adminShape(event, imageUrl)));
});

router.delete("/admin/events/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = DeleteEventParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [event] = await db
    .delete(eventsTable)
    .where(eq(eventsTable.id, params.data.id))
    .returning();
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  try {
    await softDeleteCollateralForEvent(event.id);
  } catch (error) {
    console.error("Failed to soft-delete collateral after event delete", {
      eventId: event.id,
      error,
    });
  }
  res.sendStatus(204);
});

router.post(
  "/admin/events/:id/sync-to-collateral",
  requireAdmin,
  async (req, res): Promise<void> => {
    const params = GetAdminEventParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [event] = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.id, params.data.id));
    if (!event) {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    const { imageUrl } = await loadEventWithImage(event);
    await upsertCollateralFromEvent(event, imageUrl);
    res.json({ ok: true });
  },
);

function parseSeedCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else { field += c; }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ",") { cur.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        cur.push(field); rows.push(cur); cur = []; field = "";
      } else { field += c; }
    }
  }
  if (field.length > 0 || cur.length > 0) { cur.push(field); rows.push(cur); }
  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

function slugifyLocal(text: string): string {
  return text.toLowerCase()
    .replace(/['"'\u2018\u2019\u201C\u201D]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

router.post("/admin/seed-events", requireAdmin, async (_req, res): Promise<void> => {
  try {
    const csvPath = resolve(process.cwd(), "../../attached_assets/events_1776704614264.csv");
    const raw = readFileSync(csvPath, "utf8").replace(/^\uFEFF/, "");
    const rows = parseSeedCsv(raw);
    const [header, ...data] = rows;
    const idx = (name: string) => header.indexOf(name);
    const titleIdx = idx("title");
    const startIdx = idx("start date");
    const locIdx = idx("location");
    const regIdx = idx("registration");
    const typeIdx = idx("type");
    const statusIdx = idx("status");

    let inserted = 0;
    let skipped = 0;
    const usedSlugs = new Set<string>();
    for (const row of data) {
      const title = row[titleIdx]?.trim();
      const start = row[startIdx]?.trim();
      if (!title || !start) continue;
      let slug = slugifyLocal(title);
      let candidate = slug;
      let n = 2;
      while (usedSlugs.has(candidate)) candidate = `${slug}-${n++}`;
      slug = candidate;
      usedSlugs.add(slug);
      const existing = await db.select({ id: eventsTable.id }).from(eventsTable).where(eq(eventsTable.slug, slug));
      if (existing.length > 0) { skipped++; continue; }
      await db.insert(eventsTable).values({
        title,
        slug,
        startDate: new Date(start),
        location: row[locIdx]?.trim() || null,
        registrationStatus: row[regIdx]?.trim() || "UNKNOWN_REGISTRATION_STATUS",
        eventType: row[typeIdx]?.trim() || "RSVP",
        status: row[statusIdx]?.trim() || "UPCOMING",
      });
      inserted++;
    }
    res.json({ ok: true, inserted, skipped });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
});

export default router;
