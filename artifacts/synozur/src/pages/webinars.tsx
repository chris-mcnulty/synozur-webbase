import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Meta } from "@/lib/meta";
import { CollateralCard, CollateralCardSkeleton } from "@/components/collateral-card";
import { fetchLibrary, type ListResult } from "@/data/collateral";

const PAGE_SIZE = 9;

export default function Webinars() {
  const [location, navigate] = useLocation();
  const search = typeof window !== "undefined" ? window.location.search : "";
  const params = useMemo(() => new URLSearchParams(search), [search, location]);
  const topic = params.get("topic") ?? "";
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);

  const [result, setResult] = useState<ListResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchLibrary({ type: ["webinar"], topic, page, pageSize: PAGE_SIZE }).then((res) => {
      if (!cancelled) setResult(res);
    });
    return () => {
      cancelled = true;
    };
  }, [topic, page]);

  const totalPages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;

  return (
    <div className="w-full">
      <Meta
        title="Webinars"
        description="Watch and revisit Synozur webinars on transformation, AI, the digital workplace, and more."
        path="/webinars"
      />

      <section className="bg-[#0B0B1A] pt-24 pb-12">
        <div className="container mx-auto px-4 max-w-6xl">
          <p className="text-sm uppercase tracking-[0.25em] text-primary mb-4">Webinars</p>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-white mb-4">
            Webinars
          </h1>
          <p className="text-lg md:text-xl text-zinc-300 max-w-3xl">
            Practical conversations with Synozur leaders and partners — recorded for you to watch on your schedule.
          </p>
        </div>
      </section>

      <section className="bg-background py-12">
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="mb-8 flex items-center gap-3">
            <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Topic</label>
            <input
              type="text"
              value={topic}
              onChange={(e) => {
                const next = new URLSearchParams();
                if (e.target.value) next.set("topic", e.target.value);
                navigate(`/webinars${next.toString() ? `?${next.toString()}` : ""}`);
              }}
              placeholder="Filter by topic…"
              className="px-3 py-2 rounded-md border border-border bg-card text-sm w-64"
            />
          </div>

          {!result ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <CollateralCardSkeleton key={i} />
              ))}
            </div>
          ) : result.items.length === 0 ? (
            <div className="rounded-2xl border border-border/60 bg-card p-12 text-center text-muted-foreground">
              No webinars match this topic yet.
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
                      navigate(`/webinars?${next.toString()}`);
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
                      navigate(`/webinars?${next.toString()}`);
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
