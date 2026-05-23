import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Meta } from "@/lib/meta";
import { useParentPage } from "@/lib/parent-page";
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
  const q = params.get("q") ?? "";
  return { types, pillars, page, featured, q };
}

function buildQuery(
  types: CollateralType[],
  pillars: Pillar[],
  page: number,
  featured: boolean,
  q: string,
) {
  const params = new URLSearchParams();
  if (types.length) params.set("type", types.join(","));
  if (pillars.length) params.set("pillar", pillars.join(","));
  if (page > 1) params.set("page", String(page));
  if (featured) params.set("featured", "true");
  if (q.trim()) params.set("q", q.trim());
  const s = params.toString();
  return s ? `?${s}` : "";
}

export default function Library() {
  const [location, navigate] = useLocation();
  const search = typeof window !== "undefined" ? window.location.search : "";
  const { types, pillars, page, featured, q } = useMemo(
    () => parseQuery(search),
    [search, location],
  );

  const [result, setResult] = useState<ListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [qInput, setQInput] = useState(q);

  useEffect(() => {
    setQInput(q);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchLibrary({ type: types, pillar: pillars, page, pageSize: PAGE_SIZE, featured, q })
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
  }, [types, pillars, page, featured, q]);

  function update(
    nextTypes: CollateralType[],
    nextPillars: Pillar[],
    nextPage = 1,
    nextQ: string = q,
  ) {
    navigate(`/library${buildQuery(nextTypes, nextPillars, nextPage, featured, nextQ)}`);
  }

  function toggleType(t: CollateralType) {
    const next = types.includes(t) ? types.filter((x) => x !== t) : [...types, t];
    update(next, pillars, 1);
  }
  function togglePillar(p: Pillar) {
    const next = pillars.includes(p) ? pillars.filter((x) => x !== p) : [...pillars, p];
    update(types, next, 1);
  }
  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    update(types, pillars, 1, qInput);
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;

  const copy = useParentPage("library", {
    heroEyebrow: "Library",
    heroHeadline: "The Synozur Library",
    heroSubhead:
      "Every white paper, webinar, case study, podcast, model, and workshop in one place — filter by type or by transformation pillar.",
    seoTitle: "Library",
    seoDescription:
      "Browse the full Synozur collateral library — white papers, webinars, case studies, podcasts, models, workshops, and more.",
  });

  return (
    <div className="w-full">
      <Meta
        title={copy.seoTitle}
        description={copy.seoDescription}
        path="/library"
        image={copy.ogImage}
      />

      <section className="relative overflow-hidden bg-[#0B0B1A] py-24 md:py-32">
        <div aria-hidden="true" className="absolute inset-0 nebula-gradient opacity-25" />
        <div className="container relative z-10 mx-auto px-4 max-w-4xl">
          <p className="text-sm uppercase tracking-widest text-primary mb-4">{copy.heroEyebrow}</p>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-6">
            {copy.heroHeadline}
          </h1>
          <p className="text-xl md:text-2xl text-zinc-300 leading-relaxed max-w-3xl">
            {copy.heroSubhead}
          </p>
          {copy.introHtml && (
            <div
              className="prose prose-invert max-w-3xl mt-6 text-zinc-300"
              dangerouslySetInnerHTML={{ __html: copy.introHtml }}
            />
          )}
        </div>
      </section>

      <section className="bg-background py-8 md:py-12">
        <div className="container mx-auto px-4 max-w-7xl">
          {/* Search */}
          <form onSubmit={submitSearch} className="mb-8">
            <label htmlFor="library-search" className="sr-only">
              Search the library
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                id="library-search"
                type="search"
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                placeholder="Search titles, descriptions, and tags…"
                className="flex-1 px-4 py-2 rounded-md border border-border bg-card text-sm"
              />
              <button
                type="submit"
                className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90"
              >
                Search
              </button>
              {q && (
                <button
                  type="button"
                  onClick={() => {
                    setQInput("");
                    update(types, pillars, 1, "");
                  }}
                  className="px-4 py-2 rounded-md border border-border text-sm hover:bg-muted"
                >
                  Clear
                </button>
              )}
            </div>
          </form>

          {/* Filters */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-10">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3">Type</p>
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden">
                {getTypeFacets().map((t) => {
                  const active = types.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleType(t)}
                      className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
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
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden">
                {getPillarFacets().map((p) => {
                  const active = pillars.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => togglePillar(p)}
                      className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
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

          {(types.length > 0 || pillars.length > 0 || featured || q) && (
            <button
              type="button"
              onClick={() => {
                setQInput("");
                navigate("/library");
              }}
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
              {q
                ? `No items match “${q}”${
                    types.length || pillars.length ? " with the selected filters" : ""
                  }.`
                : "No items match these filters."}
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
