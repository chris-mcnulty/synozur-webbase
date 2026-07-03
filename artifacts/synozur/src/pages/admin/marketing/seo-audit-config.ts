/**
 * Pure-logic constants for the SEO audit admin screen.
 *
 * Extracted into a standalone .ts module (no JSX, no @/ aliases) so they can
 * be imported directly in Node tests without a Vite build.
 *
 * Compile-time safety:
 *  - KIND_LABEL is typed as Record<SeoArtifactKind, string> — TypeScript errors
 *    if any kind is missing a label.
 *  - editorHref is a switch over SeoArtifactKind with no default — TypeScript
 *    errors on a new union member that falls through (missing return on string
 *    return type).
 *  - SEO_ARTIFACT_KINDS is the canonical ordered list; tests iterate it to pin
 *    runtime invariants (non-empty label, non-empty link, og_image_missing not
 *    in FILLABLE_KEYS).
 *
 * When a new ArtifactKind is added to api-server/src/lib/seoAudit.ts, you must
 * also add it here (and to SeoArtifactKind in src/lib/api.ts).
 */

export type SeoArtifactKind =
  | "insight"
  | "service"
  | "solution"
  | "application"
  | "case-study"
  | "model"
  | "workshop"
  | "polaris"
  | "event"
  | "collateral";

/**
 * Canonical ordered list. Iterate this instead of Object.keys(KIND_LABEL) so
 * the display order is explicit and stable across environments.
 */
export const SEO_ARTIFACT_KINDS: readonly SeoArtifactKind[] = [
  "insight",
  "service",
  "solution",
  "application",
  "case-study",
  "model",
  "workshop",
  "polaris",
  "event",
  "collateral",
];

/**
 * Human-readable label for each kind, shown in the audit UI section headers
 * and stat cards. Record<> forces exhaustive coverage at compile time.
 */
export const KIND_LABEL: Record<SeoArtifactKind, string> = {
  insight: "Insights",
  service: "Services",
  solution: "Solutions",
  application: "Applications",
  "case-study": "Case studies",
  model: "Models",
  workshop: "Workshops",
  polaris: "Polaris",
  event: "Events",
  collateral: "Collateral",
};

/**
 * CMS editor deep-link for each kind. The switch covers every SeoArtifactKind
 * member; adding a new member without a case is a TS compile error because the
 * function can no longer guarantee a string return.
 *
 * Applications and case studies don't have dedicated /:id/edit routes today,
 * so those link to the list view. All others deep-link to the item editor.
 */
export function editorHref(kind: SeoArtifactKind, id: string): string {
  switch (kind) {
    case "insight":
      return `/insights/posts/${id}/edit`;
    case "service":
      return `/products/services/${id}/edit`;
    case "solution":
      return `/products/solutions/${id}/edit`;
    case "model":
      return `/products/models/${id}/edit`;
    case "application":
      return `/products/applications`;
    case "case-study":
      return `/products/case-studies`;
    case "workshop":
      return `/library/workshops/${id}/edit`;
    case "polaris":
      return `/library/polaris-episodes/${id}/edit`;
    case "event":
      return `/people/events/${id}`;
    case "collateral":
      return `/library/collateral/${id}/edit`;
  }
}

/**
 * Keys the backend autofill endpoint will actually patch.
 * og_image_missing is intentionally absent — it is a pure warning (the dynamic
 * OG card is valid), not something applyAutofill can write to any column.
 */
export const FILLABLE_KEYS = new Set([
  "seoTitle",
  "seoDescription",
  "seoDescriptionShort",
  "seoDescriptionLong",
  "ogImage",
]);

/** Human-readable label for each missing-field key returned by the audit. */
export function formatMissingLabel(field: string): string {
  const map: Record<string, string> = {
    seoTitle: "SEO title",
    seoDescription: "SEO description",
    ogImage: "OG image",
    seoDescriptionShort: "Desc too short",
    seoDescriptionLong: "Desc too long",
    seoTitleLong: "Title too long",
    og_image_missing: "No share image",
  };
  return map[field] ?? field;
}

export interface SeoAuditFinding {
  kind: SeoArtifactKind;
  id: string;
  slug: string;
  title: string;
  path: string;
  missing: string[];
  suggested: {
    seoTitle?: string;
    seoDescription?: string;
    ogImage?: string;
  };
}

/**
 * Group a flat findings array into per-kind buckets. Typed as
 * Record<SeoArtifactKind, …> so a missing key is a compile error.
 */
export function groupFindings(
  findings: SeoAuditFinding[],
): Record<SeoArtifactKind, SeoAuditFinding[]> {
  const empty: Record<SeoArtifactKind, SeoAuditFinding[]> = {
    insight: [],
    service: [],
    solution: [],
    application: [],
    "case-study": [],
    model: [],
    workshop: [],
    polaris: [],
    event: [],
    collateral: [],
  };
  for (const f of findings) empty[f.kind].push(f);
  return empty;
}
