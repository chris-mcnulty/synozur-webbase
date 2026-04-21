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
