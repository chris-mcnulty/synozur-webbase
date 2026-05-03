/**
 * Pure helpers for classifying SPA URLs as artifact detail routes.
 *
 * Extracted from server.mjs so the logic can be unit-tested without
 * starting the production HTTP listener. Both files MUST import the
 * same module — keep this file dependency-free so it stays cheap to
 * load in tests and at boot.
 *
 * The set MUST stay in sync with `ARTIFACT_SECTIONS` in
 * `artifacts/api-server/src/lib/routeStatus.ts`.
 */

export const ARTIFACT_SECTIONS = new Set([
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

/**
 * Returns true iff `pathname` looks like a canonical `/<section>/<slug>`
 * artifact detail URL. Excludes:
 *  - root and single-segment paths
 *  - file-like second segments (e.g. `/polaris/rss.xml`, `/insights/feed.json`)
 *    — these are static or alias routes, not DB-backed slugs.
 *  - sections not in `ARTIFACT_SECTIONS`
 */
export function isArtifactPath(pathname) {
  const clean = pathname.replace(/\/+$/, "") || "/";
  const parts = clean.replace(/^\//, "").split("/");
  if (parts.length < 2) return false;
  const section = parts[0] ?? "";
  const second = parts[1] ?? "";
  if (!second) return false;
  // Skip file-like second segments: artifact slugs are kebab-case and never
  // contain a dot. Anything with an extension is an alias / asset / feed
  // (e.g. `/polaris/rss.xml`) and must be served as a static or proxied
  // route, not classified as an artifact slug.
  if (second.includes(".")) return false;
  return ARTIFACT_SECTIONS.has(section);
}
