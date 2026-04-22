import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Meta } from "@/lib/meta";
import { useParentPage } from "@/lib/parent-page";
import { CollateralCard, CollateralCardSkeleton } from "@/components/collateral-card";
import { fetchLibrary, type ListResult } from "@/data/collateral";

const PAGE_SIZE = 9;

export default function Items() {
  const [location, navigate] = useLocation();
  const search = typeof window !== "undefined" ? window.location.search : "";
  const params = useMemo(() => new URLSearchParams(search), [search, location]);
  const topic = params.get("topic") ?? "";
  const q = params.get("q") ?? "";
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);

  const [result, setResult] = useState<ListResult | null>(null);
  const [qInput, setQInput] = useState(q);

  useEffect(() => {
    setQInput(q);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    fetchLibrary({ type: ["white_paper"], topic, q, page, pageSize: PAGE_SIZE }).then((res) => {
      if (!cancelled) setResult(res);
    });
    return () => {
      cancelled = true;
    };
  }, [topic, q, page]);

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const next = new URLSearchParams();
    if (topic) next.set("topic", topic);
    if (qInput.trim()) next.set("q", qInput.trim());
    navigate(`/items${next.toString() ? `?${next.toString()}` : ""}`);
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;

  const copy = useParentPage("items", {
    heroEyebrow: "White Papers",
    heroHeadline: "White Papers",
    heroSubhead:
      "Deep dives, frameworks, and practical playbooks from the Synozur team.",
    seoTitle: "White Papers",
    seoDescription:
      "Read Synozur white papers on transformation strategy, technology, AI, experiences, and go-to-market.",
  });

  return (
    <div className="w-full">
      <Meta
        title={copy.seoTitle}
        description={copy.seoDescription}
        path="/items"
        image={copy.ogImage}
      />

      <section className="bg-[#0B0B1A] pt-24 pb-12">
        <div className="container mx-auto px-4 max-w-6xl">
          <p className="text-sm uppercase tracking-[0.25em] text-primary mb-4">{copy.heroEyebrow}</p>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-white mb-4">
            {copy.heroHeadline}
          </h1>
          <p className="text-lg md:text-xl text-zinc-300 max-w-3xl">
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

      <section className="bg-background py-12">
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="mb-8 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-3">
              <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Topic</label>
              <input
                type="text"
                value={topic}
                onChange={(e) => {
                  const next = new URLSearchParams();
                  if (e.target.value) next.set("topic", e.target.value);
                  if (q) next.set("q", q);
                  navigate(`/items${next.toString() ? `?${next.toString()}` : ""}`);
                }}
                placeholder="Filter by topic…"
                className="px-3 py-2 rounded-md border border-border bg-card text-sm w-64"
              />
            </div>
            <form onSubmit={submitSearch} className="flex items-center gap-2">
              <label htmlFor="items-search" className="sr-only">
                Search white papers
              </label>
              <input
                id="items-search"
                type="search"
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                placeholder="Search white papers…"
                className="px-3 py-2 rounded-md border border-border bg-card text-sm w-64"
              />
              <button
                type="submit"
                className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90"
              >
                Search
              </button>
            </form>
          </div>

          {!result ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <CollateralCardSkeleton key={i} />
              ))}
            </div>
          ) : result.items.length === 0 ? (
            <div className="rounded-2xl border border-border/60 bg-card p-12 text-center text-muted-foreground">
              {q
                ? `No white papers match “${q}”${topic ? " with this topic" : ""}.`
                : "No white papers match this topic yet."}
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
                    onClick={() => {
                      const next = new URLSearchParams(search);
                      next.set("page", String(page - 1));
                      navigate(`/items?${next.toString()}`);
                    }}
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
                    onClick={() => {
                      const next = new URLSearchParams(search);
                      next.set("page", String(page + 1));
                      navigate(`/items?${next.toString()}`);
                    }}
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
