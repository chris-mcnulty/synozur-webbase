import { Image as ImageIcon } from "lucide-react";

// Shared display helpers for the collateral admin list and the carousel
// manager (#118/#120). Extracted from collateral-list.tsx so both pages
// render hero thumbs and type labels the same way.

export const COLLATERAL_TYPE_TABS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "white_paper", label: "White Paper" },
  { value: "webinar", label: "Webinar" },
  { value: "case_study", label: "Case Study" },
  { value: "podcast", label: "Podcast" },
  { value: "model", label: "Model" },
  { value: "training", label: "Workshop" },
  { value: "event", label: "Event" },
  { value: "insight", label: "Insight" },
  { value: "video", label: "Video" },
  { value: "ebook", label: "eBook" },
];

export const COLLATERAL_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  COLLATERAL_TYPE_TABS.filter((t) => t.value !== "all").map((t) => [t.value, t.label]),
);

// Append or override `w=128` for a 2x-dense 64px tile; URL-hosted images
// that ignore the query still work unchanged.
export function heroThumbUrl(url: string | null | undefined): string | null {
  const s = (url ?? "").trim();
  if (!s) return null;

  const hashIndex = s.indexOf("#");
  const withoutHash = hashIndex >= 0 ? s.slice(0, hashIndex) : s;
  const hash = hashIndex >= 0 ? s.slice(hashIndex) : "";

  const queryIndex = withoutHash.indexOf("?");
  const base = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const query = queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : "";

  const params = new URLSearchParams(query);
  params.set("w", "128");

  const nextQuery = params.toString();
  return nextQuery ? `${base}?${nextQuery}${hash}` : `${base}${hash}`;
}

// Maps a sourceId (e.g. "white_paper:<uuid>") to the dedicated editor URL for
// that content type. Returns null when the prefix isn't recognised so callers
// can fall back to the generic collateral edit form.
//
// IMPORTANT: keep this list in sync with editorPathForSyncedType() in
// artifacts/api-server/src/routes/collateral.ts.
export function editorPathForSource(sourceId: string | null | undefined): string | null {
  if (!sourceId) return null;
  const [prefix, id] = sourceId.split(":");
  if (!id) return null;
  switch (prefix) {
    case "white_paper":
      return `/library/white-papers/${id}/edit`;
    case "case_study":
      return `/products/case-studies/${id}/edit`;
    case "model":
      return `/products/models/${id}/edit`;
    case "video":
      return `/library/videos/${id}/edit`;
    case "post":
      return `/insights/posts/${id}/edit`;
    case "polaris_episode":
      return `/library/polaris-episodes/${id}/edit`;
    case "event":
      return `/people/events/${id}`;
    default:
      return null;
  }
}

export function HeroThumb({
  url,
  title,
  size = "sm",
}: {
  url: string | null | undefined;
  title: string;
  size?: "sm" | "lg";
}) {
  const thumb = heroThumbUrl(url);
  const dims =
    size === "lg"
      ? "h-32 w-full"
      : "h-16 w-16";
  if (!thumb) {
    return (
      <div
        className={`flex items-center justify-center rounded border border-border bg-muted text-muted-foreground shrink-0 ${dims}`}
        aria-label="No hero image"
      >
        <ImageIcon className={size === "lg" ? "h-6 w-6" : "h-4 w-4"} />
      </div>
    );
  }
  return (
    <img
      src={thumb}
      alt={title ? `${title} hero` : "Hero image"}
      loading="lazy"
      decoding="async"
      className={`rounded border border-border object-cover shrink-0 bg-muted ${dims}`}
    />
  );
}
