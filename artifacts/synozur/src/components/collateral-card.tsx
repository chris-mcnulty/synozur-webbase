import { Link } from "wouter";
import { Collateral, TYPE_LABELS } from "@/data/collateral";
import { resolveMediaUrl, buildMediaSrcSet } from "@/lib/insights";

// Cards display at most ~half the viewport on the home carousel and ~1/3
// on grid layouts. The widest realistic CSS render is ≈640px (carousel md+),
// so a 1280px upper bound covers retina without serving more than needed.
const CARD_HERO_WIDTHS = [480, 640, 960, 1280] as const;
const CARD_HERO_SIZES_GRID =
  "(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw";
const CARD_HERO_SIZES_CAROUSEL =
  "(min-width: 768px) 40vw, 90vw";

interface CollateralCardProps {
  item: Collateral;
  /**
   * Aspect ratio variant. The home carousel uses a tall portrait card; the
   * library/index grids use a more standard ratio.
   */
  variant?: "carousel" | "grid";
  /**
   * Native `loading` attribute for the hero image. Defaults to "lazy".
   * Pass "eager" when the card is guaranteed above the fold (e.g. hero carousel).
   */
  imageLoading?: "lazy" | "eager";
  /** Optional click handler — used by the carousel to fire conversion events. */
  onClick?: () => void;
}

// For events the `publishedAt` field carries the event start date (set by
// sync-to-collateral). For every other type it's the publication date.
//
// The API serialises `publishedAt` as a date-only string (YYYY-MM-DD).
// Passing that directly to `new Date()` treats it as UTC midnight, which
// rolls back a day for users in negative UTC-offset timezones. Parse into
// local-date parts instead so the displayed date always matches the
// calendar date the editor entered.
function formatCardDate(item: Collateral): string | null {
  if (!item.publishedAt) return null;
  const parts = item.publishedAt.split("-");
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map(Number);
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function dateLabel(item: Collateral): string {
  return item.type === "event" ? "Event" : "Published";
}

export function CollateralCard({ item, variant = "grid", imageLoading = "lazy", onClick }: CollateralCardProps) {
  // On md+ screens the carousel sits beside the hero headline inside a
  // min-h-[90vh] section. A pure 3/4 portrait aspect makes the card taller
  // than the viewport, pushing the title/badge overlay below the fold. Cap
  // the height so the bottom text overlay always stays visible.
  const aspect =
    variant === "carousel"
      ? "aspect-[4/5] md:aspect-auto md:h-[min(70vh,640px)]"
      : "aspect-[4/5]";
  const formattedDate = formatCardDate(item);

  const heroSrc =
    resolveMediaUrl(item.heroImage, { width: 960 }) ?? item.heroImage;
  const heroSrcSet = buildMediaSrcSet(item.heroImage, CARD_HERO_WIDTHS);
  const heroSizes = heroSrcSet
    ? variant === "carousel"
      ? CARD_HERO_SIZES_CAROUSEL
      : CARD_HERO_SIZES_GRID
    : undefined;

  const inner = (
    <div
      className={`group relative block ${aspect} overflow-hidden rounded-2xl border border-border/60 bg-card`}
    >
      <img
        src={heroSrc}
        srcSet={heroSrcSet ?? undefined}
        sizes={heroSizes}
        alt={item.title}
        // Explicit intrinsic dimensions (4/5 ratio) so the browser can
        // reserve layout space before the image loads — keeps the card off
        // the `unsized-images` Lighthouse best-practices audit and improves
        // CLS while the srcset variant is being chosen.
        width={960}
        height={1200}
        loading={imageLoading}
        decoding="async"
        fetchPriority={imageLoading === "eager" ? "high" : "auto"}
        className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-black/10 z-10" />
      <div className="absolute inset-x-0 bottom-0 z-20 p-6 md:p-8">
        <div className="flex items-center gap-2 mb-4">
          <span className="inline-block py-1 px-3 rounded-full bg-white/10 border border-white/25 text-white text-[11px] tracking-[0.2em] font-semibold backdrop-blur-md">
            {TYPE_LABELS[item.type]}
          </span>
          {formattedDate && (
            <span
              className="text-[11px] tracking-[0.15em] text-white/80 uppercase font-semibold"
              data-testid="collateral-card-date"
            >
              <span className="sr-only">{dateLabel(item)}: </span>
              {formattedDate}
            </span>
          )}
        </div>
        <h3
          className={`font-bold text-white leading-tight ${
            variant === "carousel" ? "text-2xl md:text-3xl" : "text-xl md:text-2xl"
          }`}
        >
          {item.title}
        </h3>
      </div>
    </div>
  );

  if (item.external) {
    return (
      <a href={item.url} target="_blank" rel="noopener noreferrer" className="block" onClick={onClick}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={item.url} className="block" onClick={onClick}>
      {inner}
    </Link>
  );
}

export function CollateralCardSkeleton({ variant = "grid" }: { variant?: "carousel" | "grid" }) {
  const aspect =
    variant === "carousel"
      ? "aspect-[4/5] md:aspect-auto md:h-[min(70vh,640px)]"
      : "aspect-[4/5]";
  return (
    <div
      className={`relative ${aspect} overflow-hidden rounded-2xl border border-border/60 bg-card animate-pulse`}
    >
      <div className="absolute inset-0 bg-muted/40" />
    </div>
  );
}
