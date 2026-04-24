export const ASSET_CATEGORIES = [
  "people",
  "north-star",
  "abstract",
  "event",
  "location",
  "product-screenshot",
] as const;

export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export const ASSET_CATEGORY_LABELS: Record<AssetCategory, string> = {
  people: "People",
  "north-star": "North Star",
  abstract: "Abstract",
  event: "Event",
  location: "Location",
  "product-screenshot": "Product Screenshot",
};

export function isAssetCategory(value: unknown): value is AssetCategory {
  return (
    typeof value === "string" &&
    (ASSET_CATEGORIES as readonly string[]).includes(value)
  );
}

// Canonical public URL for a piece of collateral, derived from its type and
// slug. Single source of truth for the type→URL mapping. Used by:
//  - sync helpers in api-server (upsertCollateralFromX) to set collateral.url
//  - admin save handler to derive url server-side, ignoring client input
//    so legacy patterns like /items/<slug> can never be re-introduced
//
// To add a new content type: add a branch here, register the public route in
// artifacts/synozur/src/App.tsx, and follow the recipe in docs/content-types.md.
export function canonicalUrlForCollateral(
  type: string,
  slug: string,
): string {
  switch (type) {
    case "white_paper":
    case "ebook":
      return `/white-papers/${slug}`;
    case "case_study":
      return `/case-studies/${slug}`;
    case "webinar":
      return `/webinars/${slug}`;
    case "model":
      return `/models/${slug}`;
    case "training":
      return `/workshops/${slug}`;
    case "event":
      return `/events/${slug}`;
    case "video":
      return `/videos/${slug}`;
    case "insight":
      return `/insights/${slug}`;
    case "podcast":
      return `/polaris`;
    default:
      return `/library/${slug}`;
  }
}

// Collateral types whose content lives in a dedicated source-of-truth table
// (white_papers, case_studies, models, etc.) and is synced into collateral
// via the upsertCollateralFromX() helpers in api-server/src/lib/syncCollateral.
//
// Direct creation of these types in the generic collateral admin is blocked
// to prevent orphan rows. Edits route to the source editor.
//
// Types NOT in this list (webinar, training) live only in collateral and
// remain freely editable there.
export const SYNCED_COLLATERAL_TYPES = [
  "white_paper",
  "ebook",
  "case_study",
  "model",
  "video",
  "event",
  "insight",
  "podcast",
] as const;

export type SyncedCollateralType = (typeof SYNCED_COLLATERAL_TYPES)[number];

export function isSyncedCollateralType(type: string): type is SyncedCollateralType {
  return (SYNCED_COLLATERAL_TYPES as readonly string[]).includes(type);
}
