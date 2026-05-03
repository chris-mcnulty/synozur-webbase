/**
 * Resolve the publish status of a public artifact URL.
 *
 * #162 / launch-readiness L13. The detail API loaders return HTTP 410 when
 * an artifact is archived or past its `unpublishedAt`, but the canonical
 * URL lives on the SPA server (`artifacts/synozur/server.mjs`), which
 * historically served `index.html` with a 200 for every unmatched route.
 * That meant Google still saw 200 OK at the canonical URL for unpublished
 * content and never dropped it from the index.
 *
 * This helper lets the SPA server (or any other edge layer) ask the API a
 * cheap per-path question — "should this URL be 410, 404, or 200?" — and
 * propagate the verdict in the HTTP status while still serving the SPA
 * shell so the in-app router can render a friendly Gone page.
 *
 * Treats `deletedAt` as 404 (admin signal, may have been deleted in error)
 * and `status='archived'` / past `unpublishedAt` as 410, mirroring
 * `goneResponse.ts`. Unknown / non-artifact paths resolve to "ok" — the
 * caller (SPA server) decides what to do with non-detail URLs.
 */

import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  postsTable,
  servicesTable,
  solutionsTable,
  caseStudiesTable,
  applicationsTable,
  modelsTable,
  workshopsTable,
  whitePapersTable,
  polarisEpisodesTable,
  eventsTable,
} from "@workspace/db";
import { isGone } from "./goneResponse";

export type RouteStatus = "ok" | "not_found" | "gone";

/**
 * Sections that map 1:1 to a DB-backed artifact detail page. Anything not
 * in this set is treated as a static / non-artifact route and short-circuits
 * to "ok" — the SPA server will serve `index.html` with HTTP 200 as before.
 */
const ARTIFACT_SECTIONS = new Set([
  "insights",
  "services",
  "solutions",
  "case-studies",
  "applications",
  "models",
  "workshops",
  "white-papers",
  "polaris",
  "events",
]);

export function isArtifactPath(pathname: string): boolean {
  const clean = pathname.replace(/\/+$/, "") || "/";
  const parts = clean.replace(/^\//, "").split("/");
  if (parts.length < 2) return false;
  if (!parts[1]) return false;
  return ARTIFACT_SECTIONS.has(parts[0] ?? "");
}

/**
 * Look up the (section, slug) pair and report whether the URL should
 * render normally, 404, or 410.
 *
 * Returns "ok" for any path that isn't a known artifact detail route — the
 * caller stays in charge of static-route routing.
 */
export async function resolveRouteStatus(pathname: string): Promise<RouteStatus> {
  const clean = pathname.replace(/\/+$/, "") || "/";
  const parts = clean.replace(/^\//, "").split("/");
  const section = parts[0] ?? "";
  const slug = parts[1] ?? "";
  if (!slug || !ARTIFACT_SECTIONS.has(section)) return "ok";

  try {
    switch (section) {
      case "insights": {
        // Posts have `status` but no `unpublishedAt`; isGone() handles the
        // missing column gracefully.
        const [row] = await db
          .select({ status: postsTable.status, deletedAt: postsTable.deletedAt })
          .from(postsTable)
          .where(eq(postsTable.slug, slug))
          .limit(1);
        if (!row || row.deletedAt) return row ? "not_found" : "not_found";
        return isGone(row) ? "gone" : "ok";
      }
      case "services": {
        const [row] = await db
          .select({
            status: servicesTable.status,
            unpublishedAt: servicesTable.unpublishedAt,
            deletedAt: servicesTable.deletedAt,
          })
          .from(servicesTable)
          .where(eq(servicesTable.slug, slug))
          .limit(1);
        if (!row || row.deletedAt) return "not_found";
        return isGone(row) ? "gone" : "ok";
      }
      case "solutions": {
        const [row] = await db
          .select({
            status: solutionsTable.status,
            unpublishedAt: solutionsTable.unpublishedAt,
            deletedAt: solutionsTable.deletedAt,
          })
          .from(solutionsTable)
          .where(eq(solutionsTable.slug, slug))
          .limit(1);
        if (!row || row.deletedAt) return "not_found";
        return isGone(row) ? "gone" : "ok";
      }
      case "case-studies": {
        const [row] = await db
          .select({
            status: caseStudiesTable.status,
            unpublishedAt: caseStudiesTable.unpublishedAt,
            deletedAt: caseStudiesTable.deletedAt,
          })
          .from(caseStudiesTable)
          .where(eq(caseStudiesTable.slug, slug))
          .limit(1);
        if (!row || row.deletedAt) return "not_found";
        return isGone(row) ? "gone" : "ok";
      }
      case "applications": {
        const [row] = await db
          .select({
            status: applicationsTable.status,
            unpublishedAt: applicationsTable.unpublishedAt,
            deletedAt: applicationsTable.deletedAt,
          })
          .from(applicationsTable)
          .where(eq(applicationsTable.slug, slug))
          .limit(1);
        if (!row || row.deletedAt) return "not_found";
        return isGone(row) ? "gone" : "ok";
      }
      case "models": {
        const [row] = await db
          .select({
            status: modelsTable.status,
            unpublishedAt: modelsTable.unpublishedAt,
            deletedAt: modelsTable.deletedAt,
          })
          .from(modelsTable)
          .where(eq(modelsTable.slug, slug))
          .limit(1);
        if (!row || row.deletedAt) return "not_found";
        return isGone(row) ? "gone" : "ok";
      }
      case "white-papers": {
        const [row] = await db
          .select({
            status: whitePapersTable.status,
            unpublishedAt: whitePapersTable.unpublishedAt,
            deletedAt: whitePapersTable.deletedAt,
          })
          .from(whitePapersTable)
          .where(eq(whitePapersTable.slug, slug))
          .limit(1);
        if (!row || row.deletedAt) return "not_found";
        return isGone(row) ? "gone" : "ok";
      }
      case "workshops": {
        // Workshops have no status enum — `active=false` is the only
        // unpublish signal and maps to 410.
        const [row] = await db
          .select({
            active: workshopsTable.active,
            deletedAt: workshopsTable.deletedAt,
          })
          .from(workshopsTable)
          .where(eq(workshopsTable.slug, slug))
          .limit(1);
        if (!row || row.deletedAt) return "not_found";
        return row.active ? "ok" : "gone";
      }
      case "polaris": {
        const [row] = await db
          .select({
            status: polarisEpisodesTable.status,
            unpublishedAt: polarisEpisodesTable.unpublishedAt,
            deletedAt: polarisEpisodesTable.deletedAt,
          })
          .from(polarisEpisodesTable)
          .where(
            and(eq(polarisEpisodesTable.slug, slug), isNull(polarisEpisodesTable.deletedAt)),
          )
          .limit(1);
        if (!row) return "not_found";
        return isGone(row) ? "gone" : "ok";
      }
      case "events": {
        // Events use a free-form text status. Editors can set it to
        // "ARCHIVED" / "archived" to take a past event off the public
        // index — that's the unpublish signal we honour with 410.
        const [row] = await db
          .select({ status: eventsTable.status })
          .from(eventsTable)
          .where(eq(eventsTable.slug, slug))
          .limit(1);
        if (!row) return "not_found";
        const s = (row.status ?? "").toLowerCase();
        return s === "archived" ? "gone" : "ok";
      }
    }
  } catch {
    // DB error — never tell the SPA the URL is gone on a transient failure.
    return "ok";
  }
  return "ok";
}
