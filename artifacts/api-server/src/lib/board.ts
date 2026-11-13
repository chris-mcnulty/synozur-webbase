import { db, boardSettingsTable, boardProfilesTable, teamMembersTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import type { RequestHandler, Request } from "express";
import { ricosToHtml } from "./ricos";

/** Intentionally NOT requireAdmin/hasRole: no email fallback or API-key capability substitution. */
export function isBoardAdmin(user: Request["authedUser"]): boolean {
  return !!user && user.authProvider !== "api_key" && user.roles.some(r => r === "admin" || r === "site_admin");
}

export const privateBoardHeaders: RequestHandler = (_req, res, next) => {
  res.set("Cache-Control", "private, no-store, max-age=0");
  res.set("Surrogate-Control", "no-store");
  res.vary("Cookie");
  res.vary("Authorization");
  next();
};

export const requireBoardAdmin: RequestHandler = (req, res, next) => {
  if (!isBoardAdmin(req.authedUser)) {
    res.status(req.authedUser ? 403 : 401).json({ error: "Administrator role required" });
    return;
  }
  next();
};

export async function boardIsPublic(): Promise<boolean> {
  const [settings] = await db.select().from(boardSettingsTable).where(eq(boardSettingsTable.id, 1));
  return settings?.public === true;
}

export const requireBoardRead: RequestHandler = async (req, res, next) => {
  const published = await boardIsPublic();
  if (!published && !isBoardAdmin(req.authedUser)) {
    res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (!published) res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  next();
};

export async function boardRoster(includeInactive = false) {
  const rows = await db.select({ board: boardProfilesTable, team: teamMembersTable })
    .from(boardProfilesTable)
    .leftJoin(teamMembersTable, eq(boardProfilesTable.teamMemberId, teamMembersTable.id))
    .orderBy(asc(boardProfilesTable.sortOrder), asc(boardProfilesTable.id));
  return rows.filter(({ board }) => includeInactive || board.active)
    .map(({ board: b, team: t }) => {
      const p = b.teamMemberId ? t : b;
      if (!p) throw new Error("Missing linked Team profile");
      return {
        id: b.id, group: b.group as "external" | "internal", teamMemberId: b.teamMemberId,
        active: b.active, sortOrder: b.sortOrder, slug: p.slug!, name: p.name!,
        jobTitle: p.jobTitle, shortDescription: p.shortDescription,
        // Team biographies retain the existing legacy Ricos contract. External
        // biographies come from RichTextEditor as HTML, not Ricos/plain text:
        // escaping them here both displays tags and corrupts later edits.
        // RichText and the crawler renderer sanitize HTML at presentation.
        longDescription: b.teamMemberId ? ricosToHtml(p.longDescription) : p.longDescription,
        imageUrl: p.imageUrl,
        linkedinUrl: p.linkedinUrl, website: p.website, email: p.email,
        speakerBookingUrl: p.speakerBookingUrl,
      };
    }).sort((a, b) => Number(a.group === "internal") - Number(b.group === "internal") || a.sortOrder - b.sortOrder || a.id - b.id);
}

/** First middleware after session resolution: covers human, social and crawler HTML. */
export const boardPageGuard: RequestHandler = async (req, res, next) => {
  if (!/^\/board(?:\/|$)/i.test(req.path)) return next();
  privateBoardHeaders(req, res, () => {});
  const setHeader = res.setHeader.bind(res);
  res.setHeader = ((name: string, value: string | number | readonly string[]) =>
    setHeader(name, name.toLowerCase() === "cache-control" ? "private, no-store" : value)) as typeof res.setHeader;
  try {
    const published = await boardIsPublic();
    if (!published) res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    if (!published && !isBoardAdmin(req.authedUser)) {
      res.status(404).type("html").send("<!doctype html><title>Not found</title><h1>Not found</h1>");
      return;
    }
    next();
  } catch (error) {
    req.log.error({ err: error }, "Board visibility check failed");
    res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.status(503).send("Unavailable");
  }
};
