import { Link } from "wouter";
import { Collateral, TYPE_LABELS } from "@/data/collateral";

interface CollateralCardProps {
  item: Collateral;
  /**
   * Aspect ratio variant. The home carousel uses a tall portrait card; the
   * library/index grids use a more standard ratio.
   */
  variant?: "carousel" | "grid";
}

// For events the `publishedAt` field carries the event start date (set by
// sync-to-collateral). For every other type it's the publication date.
function formatCardDate(item: Collateral): string | null {
  if (!item.publishedAt) return null;
  const d = new Date(item.publishedAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function dateLabel(item: Collateral): string {
  return item.type === "event" ? "Event" : "Published";
}

export function CollateralCard({ item, variant = "grid" }: CollateralCardProps) {
  const aspect =
    variant === "carousel"
      ? "aspect-[4/5] md:aspect-[3/4]"
      : "aspect-[4/5]";
  const formattedDate = formatCardDate(item);

  const inner = (
    <div
      className={`group relative block ${aspect} overflow-hidden rounded-2xl border border-border/60 bg-card`}
    >
      <img
        src={item.heroImage}
        alt={item.title}
        loading="lazy"
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
      <a href={item.url} target="_blank" rel="noopener noreferrer" className="block">
        {inner}
      </a>
    );
  }
  return (
    <Link href={item.url} className="block">
      {inner}
    </Link>
  );
}

export function CollateralCardSkeleton({ variant = "grid" }: { variant?: "carousel" | "grid" }) {
  const aspect =
    variant === "carousel"
      ? "aspect-[4/5] md:aspect-[3/4]"
      : "aspect-[4/5]";
  return (
    <div
      className={`relative ${aspect} overflow-hidden rounded-2xl border border-border/60 bg-card animate-pulse`}
    >
      <div className="absolute inset-0 bg-muted/40" />
    </div>
  );
}
