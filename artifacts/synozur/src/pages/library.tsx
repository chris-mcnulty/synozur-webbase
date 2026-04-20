import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Meta } from "@/lib/meta";
import { CollateralCard, CollateralCardSkeleton } from "@/components/collateral-card";
import {
  fetchLibrary,
  getPillarFacets,
  getTypeFacets,
  PILLAR_LABELS,
  TYPE_LABELS,
  type CollateralType,
  type ListResult,
  type Pillar,
} from "@/data/collateral";

const PAGE_SIZE = 12;

function parseQuery(search: string) {
  const params = new URLSearchParams(search);
  const types = (params.get("type") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as CollateralType[];
  const pillars = (params.get("pillar") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as Pillar[];
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);
  const featured = params.get("featured") === "true";
  return { types, pillars, page, featured };
}

function buildQuery(types: CollateralType[], pillars: Pillar[], page: number, featured: boolean) {
  const params = new URLSearchParams();
  if (types.length) params.set("type", types.join(","));
  if (pillars.length) params.set("pillar", pillars.join(","));
  if (page > 1) params.set("page", String(page));
  if (featured) params.set("featured", "true");
  const s = params.toString();
  return s ? `?${s}` : "";
}

export default function Library() {
  const [location, navigate] = useLocation();
  const search = typeof window !== "undefined" ? window.location.search : "";
  const { types, pillars, page, featured } = useMemo(() => parseQuery(search), [search, location]);

  const [result, setResult] = useState<ListResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchLibrary({ type: types, pillar: pillars, page, pageSize: PAGE_SIZE, featured })
      .then((res) => {
        if (!cancelled) {
          setResult(res);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [types, pillars, page, featured]);

  function update(nextTypes: CollateralType[], nextPillars: Pillar[], nextPage = 1) {
    navigate(`/library${buildQuery(nextTypes, nextPillars, nextPage, featured)}`);
  }

  function toggleType(t: CollateralType) {
    const next = types.includes(t) ? types.filter((x) => x !== t) : [...types, t];
    update(next, pillars, 1);
  }
  function togglePillar(p: Pillar) {
    const next = pillars.includes(p) ? pillars.filter((x) => x !== p) : [...pillars, p];
    update(types, next, 1);
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;

  return (
    <div className="w-full">
      <Meta
        title="Library"
        description="Browse the full Synozur collateral library — white papers, webinars, case studies, podcasts, models, workshops, and more."
        path="/library"
      />

      <section className="bg-[#0B0B1A] pt-24 pb-12">
        <div className="container mx-auto px-4 max-w-6xl">
          <p className="text-sm uppercase tracking-[0.25em] text-primary mb-4">Library</p>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-white mb-4">
            The Synozur Library
          </h1>
          <p className="text-lg md:text-xl text-zinc-300 max-w-3xl">
            Every white paper, webinar, case study, podcast, model, and workshop in one place — filter by type or by transformation pillar.
          </p>
        </div>
      </section>

      <section className="bg-background py-12">
        <div className="container mx-auto px-4 max-w-6xl">
          {/* Filters */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-10">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3">Type</p>
              <div className="flex flex-wrap gap-2">
                {getTypeFacets().map((t) => {
                  const active = types.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleType(t)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                        active
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-card text-foreground border-border hover:bg-muted"
                      }`}
                    >
                      {TYPE_LABELS[t]}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3">Pillar</p>
              <div className="flex flex-wrap gap-2">
                {getPillarFacets().map((p) => {
                  const active = pillars.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => togglePillar(p)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                        active
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-card text-foreground border-border hover:bg-muted"
                      }`}
                    >
                      {PILLAR_LABELS[p]}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {(types.length > 0 || pillars.length > 0 || featured) && (
            <button
              type="button"
              onClick={() => navigate("/library")}
              className="text-sm text-primary hover:text-primary/80 mb-6"
            >
              Clear filters
            </button>
          )}

          {/* Grid */}
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <CollateralCardSkeleton key={i} />
              ))}
            </div>
          ) : !result || result.items.length === 0 ? (
            <div className="rounded-2xl border border-border/60 bg-card p-12 text-center text-muted-foreground">
              No items match these filters.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {result.items.map((item) => (
                  <CollateralCard key={item.id} item={item} />
                ))}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 mt-10">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => update(types, pillars, page - 1)}
                    className="px-4 py-2 rounded-md border border-border text-sm disabled:opacity-40 hover:bg-muted"
                  >
                    Previous
                  </button>
                  <span className="text-sm text-muted-foreground">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => update(types, pillars, page + 1)}
                    className="px-4 py-2 rounded-md border border-border text-sm disabled:opacity-40 hover:bg-muted"
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
