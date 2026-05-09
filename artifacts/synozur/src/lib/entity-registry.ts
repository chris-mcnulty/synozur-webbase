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
//    (services + solutions today; #60 / #66),
//  - which fields the inline edit modal can actually patch
//    (varies — most CMS routes accept partial PATCH, but
//    `team_members` and `events` validate a full body and
//    several entities store images as URL strings rather than
//    media-id FKs, so the wedge needs to hide widgets that
//    would silently no-op).
//
// Per-kind PATCH-URL routing lives in `components/edit-wedge.tsx`
// because it depends on runtime concerns (BASE_PATH, fetch).
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
  /**
   * Whether the wedge's inline metadata form can save to this kind via
   * a partial PATCH. False for kinds whose update routes validate a
   * full body (team_members, events) — for those we still surface the
   * wedge but the modal contains only an "Open full editor" link, not
   * a form, so the user gets the navigation shortcut without a save
   * that would 400.
   */
  inlinePatch: boolean;
  /**
   * Whether the entity stores hero/og images as media-id FKs (true) or
   * as URL strings / non-existent fields (false). When false the wedge
   * hides the image pickers — sending `heroImageId` / `ogImageId` to
   * those routes is silently ignored by the server, which would
   * mislead editors into thinking the image was saved.
   */
  imageIdPatch: boolean;
  /**
   * Status values the wedge offers in its dropdown. `null` hides the
   * status field entirely (kinds without a status enum, or whose
   * visibility is gated by `active` / `publishedAt` instead).
   */
  statusEnum: readonly string[] | null;
  /**
   * Per-kind subtitle-equivalent column. Different entities call their
   * one-line teaser different things — `subtitle` (posts, white_papers,
   * collateral), `summary` (case_studies, polaris_episodes),
   * `shortDescription` (videos, workshops, models), `tagline`
   * (applications). The wedge sends the field under this server key
   * and labels the input accordingly. `null` hides the field entirely
   * for kinds whose update body has no equivalent.
   */
  subtitleKey: string | null;
  subtitleLabel?: string;
}

const ARTIFACT_STATUS = ["draft", "scheduled", "published", "archived"] as const;
const COLLATERAL_LIFECYCLE_STATUS = ["draft", "published", "archived"] as const;
const JOB_STATUS = ["draft", "published", "closed"] as const;

const REG: readonly EntityRegistration[] = [
  {
    kind: "post",
    label: "Post",
    publicPathPattern: "/insights/:slug",
    adminEditPath: (id) => `/admin/insights/posts/${id}/edit`,
    capabilities: ["content.author", "content.publish"],
    supportsPreviewToken: false,
    inlinePatch: true,
    imageIdPatch: true,
    statusEnum: ARTIFACT_STATUS,
    subtitleKey: "subtitle",
    subtitleLabel: "Subtitle",
  },
  {
    kind: "service",
    label: "Service",
    publicPathPattern: "/services/:slug",
    adminEditPath: (id) => `/admin/products/services/${id}/edit`,
    capabilities: ["content.author", "content.publish"],
    supportsPreviewToken: true,
    inlinePatch: true,
    // services have only `iconId`, no hero/og image columns
    imageIdPatch: false,
    statusEnum: ARTIFACT_STATUS,
    // services have no subtitle-shaped column on the public schema
    subtitleKey: null,
  },
  {
    kind: "solution",
    label: "Solution",
    publicPathPattern: "/solutions/:slug",
    adminEditPath: (id) => `/admin/products/solutions/${id}/edit`,
    capabilities: ["content.author", "content.publish"],
    supportsPreviewToken: true,
    inlinePatch: true,
    imageIdPatch: false,
    statusEnum: ARTIFACT_STATUS,
    subtitleKey: null,
  },
  {
    kind: "case-study",
    label: "Case study",
    publicPathPattern: "/case-studies/:slug",
    adminEditPath: (id) => `/admin/products/case-studies/${id}/edit`,
    capabilities: ["content.author", "content.publish"],
    supportsPreviewToken: false,
    inlinePatch: true,
    // heroImage is a text URL on case_studies
    imageIdPatch: false,
    statusEnum: ARTIFACT_STATUS,
    subtitleKey: "summary",
    subtitleLabel: "Summary",
  },
  {
    kind: "application",
    label: "Application",
    publicPathPattern: "/applications/:slug",
    adminEditPath: (id) => `/admin/products/applications/${id}/edit`,
    capabilities: ["content.author", "content.publish"],
    supportsPreviewToken: false,
    inlinePatch: true,
    imageIdPatch: false,
    statusEnum: ARTIFACT_STATUS,
    subtitleKey: "tagline",
    subtitleLabel: "Tagline",
  },
  {
    kind: "model",
    label: "Model",
    publicPathPattern: "/models/:slug",
    adminEditPath: (id) => `/admin/products/models/${id}/edit`,
    capabilities: ["content.author", "content.publish"],
    supportsPreviewToken: false,
    inlinePatch: true,
    imageIdPatch: false,
    statusEnum: ARTIFACT_STATUS,
    subtitleKey: "shortDescription",
    subtitleLabel: "Short description",
  },
  {
    kind: "white-paper",
    label: "White paper",
    publicPathPattern: "/white-papers/:slug",
    // Dedicated SPA editor at /admin/library/white-papers/:id/edit
    // — `/admin/library/collateral/:id/edit` edits the auto-synced
    // collateral row, which is the wrong screen for a hand-edited
    // white-paper source.
    adminEditPath: (id) => `/admin/library/white-papers/${id}/edit`,
    capabilities: ["content.author", "content.publish"],
    supportsPreviewToken: false,
    inlinePatch: true,
    // white_papers stores heroImage / ogImage as text URLs
    imageIdPatch: false,
    statusEnum: COLLATERAL_LIFECYCLE_STATUS,
    subtitleKey: "subtitle",
    subtitleLabel: "Subtitle",
  },
  {
    kind: "video",
    label: "Video",
    publicPathPattern: "/videos/:slug",
    adminEditPath: (id) => `/admin/library/videos/${id}/edit`,
    capabilities: ["content.author", "content.publish"],
    supportsPreviewToken: false,
    inlinePatch: true,
    imageIdPatch: false,
    statusEnum: COLLATERAL_LIFECYCLE_STATUS,
    subtitleKey: "shortDescription",
    subtitleLabel: "Short description",
  },
  {
    kind: "workshop",
    label: "Workshop",
    publicPathPattern: "/workshops/:slug",
    adminEditPath: (id) => `/admin/library/workshops/${id}/edit`,
    capabilities: ["content.author", "content.publish"],
    supportsPreviewToken: false,
    inlinePatch: true,
    imageIdPatch: false,
    // workshops have an `active` boolean instead of a status enum
    statusEnum: null,
    subtitleKey: "shortDescription",
    subtitleLabel: "Short description",
  },
  {
    kind: "webinar",
    label: "Webinar",
    publicPathPattern: "/webinars/:slug",
    adminEditPath: (id) => `/admin/library/collateral/${id}/edit`,
    capabilities: ["content.author", "content.publish"],
    supportsPreviewToken: false,
    inlinePatch: true,
    imageIdPatch: false,
    // collateral rows use `publishedAt` rather than a status enum
    statusEnum: null,
    subtitleKey: "subtitle",
    subtitleLabel: "Subtitle",
  },
  {
    kind: "library-item",
    label: "Library item",
    publicPathPattern: "/library/:slug",
    adminEditPath: (id) => `/admin/library/collateral/${id}/edit`,
    capabilities: ["content.author", "content.publish"],
    supportsPreviewToken: false,
    inlinePatch: true,
    imageIdPatch: false,
    statusEnum: null,
    subtitleKey: "subtitle",
    subtitleLabel: "Subtitle",
  },
  {
    kind: "polaris-episode",
    label: "Polaris episode",
    publicPathPattern: "/polaris/:slug",
    adminEditPath: (id) => `/admin/library/polaris-episodes/${id}/edit`,
    capabilities: ["content.author", "content.publish"],
    supportsPreviewToken: false,
    inlinePatch: true,
    imageIdPatch: false,
    statusEnum: ARTIFACT_STATUS,
    subtitleKey: "summary",
    subtitleLabel: "Summary",
  },
  {
    kind: "team-member",
    label: "Team member",
    publicPathPattern: "/team/:slug",
    adminEditPath: (id) => `/admin/people/team-members/${id}`,
    capabilities: ["site.manage"],
    supportsPreviewToken: false,
    // /api/admin/team-members/:id validates a full body (`name` is
    // required), so a diff-only PATCH from the wedge would 400. The
    // wedge still appears as a navigation shortcut to the full editor.
    inlinePatch: false,
    imageIdPatch: false,
    statusEnum: null,
    subtitleKey: null,
  },
  {
    kind: "event",
    label: "Event",
    publicPathPattern: "/events/:slug",
    adminEditPath: (id) => `/admin/people/events/${id}`,
    capabilities: ["site.manage"],
    supportsPreviewToken: false,
    // Same story as team-member — the events PATCH route requires
    // title + startDate.
    inlinePatch: false,
    imageIdPatch: false,
    statusEnum: null,
    subtitleKey: null,
  },
  {
    kind: "job",
    label: "Job",
    publicPathPattern: "/careers/jobs/:slug",
    adminEditPath: (id) => `/admin/careers/jobs/${id}/edit`,
    capabilities: ["careers.jobs.write"],
    supportsPreviewToken: false,
    inlinePatch: true,
    imageIdPatch: false,
    statusEnum: JOB_STATUS,
    // job descriptions are long-form, not subtitle-shaped — hide
    subtitleKey: null,
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
