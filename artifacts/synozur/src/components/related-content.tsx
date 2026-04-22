import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  fetchLibrary,
  TYPE_LABELS,
  type Collateral,
  type CollateralType,
} from "@/data/collateral";
import { CollateralCard, CollateralCardSkeleton } from "@/components/collateral-card";

const TYPE_DISPLAY_ORDER: CollateralType[] = [
  "insight",
  "case_study",
  "white_paper",
  "webinar",
  "podcast",
  "model",
  "training",
  "event",
];

const INITIAL_VISIBLE = 9;
const PAGE_SIZE = 50;

export interface RelatedContentProps {
  serviceId?: string | null;
  solutionId?: string | null;
  /** Title shown in the section heading. */
  title: string;
  /** Eyebrow copy. Defaults to "Related content". */
  eyebrow?: string;
  /**
   * If the primary scope returns nothing, try this fallback scope before
   * giving up. Used on solution pages to roll up to the parent service so a
   * brand-new solution with no direct collateral still shows something.
   */
  fallback?: { serviceId?: string | null; solutionId?: string | null };
}

function dedupeByType(items: Collateral[]): CollateralType[] {
  const present = new Set<CollateralType>();
  for (const item of items) present.add(item.type);
  return TYPE_DISPLAY_ORDER.filter((t) => present.has(t));
}

export function RelatedContent({
  serviceId,
  solutionId,
  title,
  eyebrow = "Related content",
  fallback,
}: RelatedContentProps) {
  const scopeKey = serviceId
    ? `service:${serviceId}`
    : solutionId
      ? `solution:${solutionId}`
      : null;

  const q = useQuery({
    queryKey: ["related-content", scopeKey, fallback?.serviceId ?? null, fallback?.solutionId ?? null],
    queryFn: async () => {
      if (!scopeKey) return { items: [] as Collateral[] };
      const primary = await fetchLibrary({
        serviceId: serviceId ?? undefined,
        solutionId: solutionId ?? undefined,
        pageSize: PAGE_SIZE,
      });
      if (primary.items.length > 0 || !fallback) return { items: primary.items };
      const fallbackResult = await fetchLibrary({
        serviceId: fallback.serviceId ?? undefined,
        solutionId: fallback.solutionId ?? undefined,
        pageSize: PAGE_SIZE,
      });
      return { items: fallbackResult.items };
    },
    enabled: Boolean(scopeKey),
  });

  const items = q.data?.items ?? [];
  const availableTypes = useMemo(() => dedupeByType(items), [items]);

  const [activeType, setActiveType] = useState<CollateralType | null>(null);
  const [expanded, setExpanded] = useState(false);

  const filtered = useMemo(
    () => (activeType ? items.filter((i) => i.type === activeType) : items),
    [items, activeType],
  );
  const visible = expanded ? filtered : filtered.slice(0, INITIAL_VISIBLE);
  const hasMore = filtered.length > INITIAL_VISIBLE;

  if (!scopeKey) return null;
  if (!q.isLoading && items.length === 0) return null;

  return (
    <section className="py-24 bg-background border-t border-border">
      <div className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-8">
          <div>
            <p className="text-sm uppercase tracking-widest text-primary mb-3">{eyebrow}</p>
            <h2 className="text-3xl md:text-4xl font-bold">Related to {title}</h2>
          </div>
        </div>

        {availableTypes.length > 1 &&
          (() => {
            const typeCounts = items.reduce(
              (counts, item) => {
                counts[item.type] = (counts[item.type] ?? 0) + 1;
                return counts;
              },
              {} as Partial<Record<CollateralType, number>>,
            );

            return (
              <div className="flex flex-wrap gap-2 mb-10">
                <button
                  type="button"
                  onClick={() => {
                    setActiveType(null);
                    setExpanded(false);
                  }}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                    activeType === null
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card text-foreground border-border hover:bg-muted"
                  }`}
                >
                  All ({items.length})
                </button>
                {availableTypes.map((t) => {
                  const count = typeCounts[t] ?? 0;
                  const active = activeType === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        setActiveType(t);
                        setExpanded(false);
                      }}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                        active
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-card text-foreground border-border hover:bg-muted"
                      }`}
                    >
                      {TYPE_LABELS[t]} ({count})
                    </button>
                  );
                })}
              </div>
            );
          })()}

        {q.isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[0, 1, 2].map((i) => (
              <CollateralCardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {visible.map((item, i) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: Math.min(i, 6) * 0.05 }}
                >
                  <CollateralCard item={item} />
                </motion.div>
              ))}
            </div>

            {hasMore && (
              <div className="mt-10 flex justify-center">
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="inline-flex h-10 items-center justify-center rounded-md border border-border px-6 text-sm font-semibold text-foreground hover:bg-muted/50"
                >
                  {expanded ? "Show less" : `Show all ${filtered.length}`}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
