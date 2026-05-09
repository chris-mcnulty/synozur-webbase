// Entity registry — single source of truth for the
// admin-edit ⇄ public-detail relationship that powers the
// PreviewButton (admin → live page) and the EditWedge
// (live page → in-place edit modal).
//
// Each entry binds an entity kind to:
//  - the public URL pattern it lives at (regex for discovery
//    + builder for navigation),
//  - the admin URL where the full editor lives,
//  - the capability(ies) that gate edit affordances,
//  - whether the entity supports admin-minted preview tokens
//    (services + solutions today; #60 / #66).
//
// Modal-rendering and update-mutation wiring is deliberately
// not in this file — those need per-entity React hooks and
// live in `components/edit-wedge/modals/*`.
import type { Capability } from "@/lib/capabilities";

export type EntityKind =
  | "post"
  | "service"
  | "solution"
  | "case-study"
  | "application"
  | "model"
  | "white-paper"
  | "video"
  | "workshop"
  | "webinar"
  | "library-item"
  | "polaris-episode"
  | "team-member"
  | "event"
  | "job";

export interface EntityRegistration {
  kind: EntityKind;
  /** Human-readable label, e.g. "Service". Used in button text and modal headers. */
  label: string;
  /** Public URL pattern with a `:slug` capture, e.g. `/services/:slug`. */
  publicPathPattern: string;
  /** Admin edit URL. `:id` is replaced with the entity id. */
  adminEditPath: (id: string | number) => string;
  /** Capabilities that grant edit affordances. Any of these is sufficient. */
  capabilities: readonly Capability[];
  /**
   * Backend supports admin-minted preview tokens for unpublished items.
   * When true, PreviewButton mints a 24h signed token and uses
   * `previewPath` from the response. When false, PreviewButton just
   * opens the public URL — drafts will 404.
   */
  supportsPreviewToken: boolean;
}

const REG: readonly EntityRegistration[] = [
  {
    kind: "post",
    label: "Post",
    publicPathPattern: "/insights/:slug",
    adminEditPath: (id) => `/admin/insights/posts/${id}/edit`,
    capabilities: ["content.author", "content.publish"],
    supportsPreviewToken: false,
  },
  {
    kind: "service",
    label: "Service",
    publicPathPattern: "/services/:slug",
    adminEditPath: (id) => `/admin/products/services/${id}/edit`,
    capabilities: ["content.author", "content.publish"],
    supportsPreviewToken: true,
  },
  {
    kind: "solution",
    label: "Solution",
    publicPathPattern: "/solutions/:slug",
    adminEditPath: (id) => `/admin/products/solutions/${id}/edit`,
    capabilities: ["content.author", "content.publish"],
    supportsPreviewToken: true,
  },
  {
    kind: "case-study",
    label: "Case study",
    publicPathPattern: "/case-studies/:slug",
    adminEditPath: (id) => `/admin/products/case-studies/${id}/edit`,
    capabilities: ["content.author", "content.publish"],
    supportsPreviewToken: false,
  },
  {
    kind: "application",
    label: "Application",
    publicPathPattern: "/applications/:slug",
    adminEditPath: (id) => `/admin/products/applications/${id}/edit`,
    capabilities: ["content.author", "content.publish"],
    supportsPreviewToken: false,
  },
  {
    kind: "model",
    label: "Model",
    publicPathPattern: "/models/:slug",
    adminEditPath: (id) => `/admin/products/models/${id}/edit`,
    capabilities: ["content.author", "content.publish"],
    supportsPreviewToken: false,
  },
  {
    kind: "white-paper",
    label: "White paper",
    publicPathPattern: "/white-papers/:slug",
    adminEditPath: (id) => `/admin/library/collateral/${id}/edit`,
    capabilities: ["content.author", "content.publish"],
    supportsPreviewToken: false,
  },
  {
    kind: "video",
    label: "Video",
    publicPathPattern: "/videos/:slug",
    adminEditPath: (id) => `/admin/library/collateral/${id}/edit`,
    capabilities: ["content.author", "content.publish"],
    supportsPreviewToken: false,
  },
  {
    kind: "workshop",
    label: "Workshop",
    publicPathPattern: "/workshops/:slug",
    adminEditPath: (id) => `/admin/library/collateral/${id}/edit`,
    capabilities: ["content.author", "content.publish"],
    supportsPreviewToken: false,
  },
  {
    kind: "webinar",
    label: "Webinar",
    publicPathPattern: "/webinars/:slug",
    adminEditPath: (id) => `/admin/library/collateral/${id}/edit`,
    capabilities: ["content.author", "content.publish"],
    supportsPreviewToken: false,
  },
  {
    kind: "library-item",
    label: "Library item",
    publicPathPattern: "/library/:slug",
    adminEditPath: (id) => `/admin/library/collateral/${id}/edit`,
    capabilities: ["content.author", "content.publish"],
    supportsPreviewToken: false,
  },
  {
    kind: "polaris-episode",
    label: "Polaris episode",
    publicPathPattern: "/polaris/:slug",
    adminEditPath: (id) => `/admin/library/polaris-episodes/${id}/edit`,
    capabilities: ["content.author", "content.publish"],
    supportsPreviewToken: false,
  },
  {
    kind: "team-member",
    label: "Team member",
    publicPathPattern: "/team/:slug",
    adminEditPath: (id) => `/admin/people/team-members/${id}`,
    capabilities: ["site.manage"],
    supportsPreviewToken: false,
  },
  {
    kind: "event",
    label: "Event",
    publicPathPattern: "/events/:slug",
    adminEditPath: (id) => `/admin/people/events/${id}`,
    capabilities: ["site.manage"],
    supportsPreviewToken: false,
  },
  {
    kind: "job",
    label: "Job",
    publicPathPattern: "/careers/jobs/:slug",
    adminEditPath: (id) => `/admin/careers/jobs/${id}/edit`,
    capabilities: ["careers.jobs.write"],
    supportsPreviewToken: false,
  },
];

const REG_BY_KIND = new Map<EntityKind, EntityRegistration>(
  REG.map((r) => [r.kind, r]),
);

/** Look up the registration for an entity kind. */
export function getEntityRegistration(kind: EntityKind): EntityRegistration {
  const r = REG_BY_KIND.get(kind);
  if (!r) throw new Error(`Unknown entity kind: ${kind}`);
  return r;
}

/** Build the public URL for an entity. */
export function publicPathFor(kind: EntityKind, slug: string): string {
  return getEntityRegistration(kind).publicPathPattern.replace(":slug", slug);
}

/** Build the admin edit URL for an entity. */
export function adminEditPathFor(kind: EntityKind, id: string | number): string {
  return getEntityRegistration(kind).adminEditPath(id);
}

/**
 * Match the current pathname against registered public URL patterns.
 * Returns the matching entity kind + extracted slug, or null when the
 * route doesn't correspond to an editable entity.
 *
 * The patterns are anchored (full-match on a single path segment) so
 * `/services/foo` matches but `/services/foo/extras` does not.
 */
export function entityFromPath(
  pathname: string,
): { kind: EntityKind; slug: string } | null {
  const trimmed = pathname.replace(/\/$/, "");
  for (const reg of REG) {
    const re = new RegExp(
      "^" + reg.publicPathPattern.replace(":slug", "([^/]+)") + "$",
    );
    const m = trimmed.match(re);
    if (m) return { kind: reg.kind, slug: decodeURIComponent(m[1]) };
  }
  return null;
}

/** All registrations — useful for tests and admin tooling. */
export function allEntityRegistrations(): readonly EntityRegistration[] {
  return REG;
}
