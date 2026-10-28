import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { Meta } from "@/lib/meta";
import { useParentPage } from "@/lib/parent-page";
import { api, type VideoDto, type VideoListResult } from "@/lib/api";
import { buildMediaSrcSet, resolveMediaUrl } from "@/lib/insights";

const PAGE_SIZE = 9;
const CARD_HERO_WIDTHS = [480, 640, 960, 1280] as const;

function formatVideoDate(item: VideoDto): string | null {
  const value = item.publishedAt || item.recordedAt;
  if (!value) return null;
  const parts = value.slice(0, 10).split("-");
  if (parts.length !== 3) return null;
  const [year, month, day] = parts.map(Number);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function WebinarVideoCard({ item }: { item: VideoDto }) {
  const image = item.thumbnailUrl || item.heroImage;
  const heroSrc = resolveMediaUrl(image, { width: 960 }) ?? image;
  const heroSrcSet = buildMediaSrcSet(image, CARD_HERO_WIDTHS);
  const formattedDate = formatVideoDate(item);

  return (
    <Link href={`/videos/${item.slug}`} className="block">
      <div className="group relative aspect-[4/3] overflow-hidden rounded-2xl border border-border/60 bg-card sm:aspect-[4/5]">
        <img
          src={heroSrc}
          srcSet={heroSrcSet ?? undefined}
          sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
          alt={item.heroImageAlt || item.title}
          width={960}
          height={1200}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-black/10" />
        <div className="absolute inset-x-0 bottom-0 z-10 p-4 sm:p-6 md:p-8">
          <div className="mb-2 flex items-center gap-2 sm:mb-4">
            <span className="inline-block rounded-full border border-white/25 bg-white/10 px-3 py-1 text-[11px] font-semibold tracking-[0.2em] text-white backdrop-blur-md">
              WEBINAR
            </span>
            {formattedDate && (
              <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-white/80">
                {formattedDate}
              </span>
            )}
          </div>
          <h3 className="text-xl font-bold leading-tight text-white md:text-2xl">{item.title}</h3>
        </div>
      </div>
    </Link>
  );
}

function WebinarVideoCardSkeleton() {
  return (
    <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-border/60 bg-card sm:aspect-[4/5]">
      <div className="absolute inset-0 animate-pulse bg-muted/40" />
    </div>
  );
}

export default function Webinars() {
  const [location, navigate] = useLocation();
  const search = typeof window !== "undefined" ? window.location.search : "";
  const params = useMemo(() => new URLSearchParams(search), [search, location]);
  const topic = params.get("topic") ?? "";
  const q = params.get("q") ?? "";
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);

  const [result, setResult] = useState<VideoListResult | null>(null);
  const [qInput, setQInput] = useState(q);

  useEffect(() => {
    setQInput(q);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    api
      .listVideos({
        category: "webinar",
        tag: topic.trim() || undefined,
        q: q.trim() || undefined,
        page,
        pageSize: PAGE_SIZE,
      })
      .then((res) => {
        if (!cancelled) setResult(res);
      })
      .catch(() => {
        if (!cancelled) setResult({ total: 0, page, pageSize: PAGE_SIZE, items: [] });
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
    navigate(`/webinars${next.toString() ? `?${next.toString()}` : ""}`);
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;

  const copy = useParentPage("webinars", {
    heroEyebrow: "Webinars",
    heroHeadline: "Webinars",
    heroSubhead:
      "Practical conversations with Synozur leaders and partners — recorded for you to watch on your schedule.",
    seoTitle: "Webinars",
    seoDescription:
      "Watch and revisit Synozur webinars on transformation, AI, the digital workplace, and more.",
  });

  return (
    <div className="w-full">
      <Meta
        title={copy.seoTitle}
        description={copy.seoDescription}
        path="/webinars"
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
          <div className="mb-8 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- Visual label for the adjacent topic input. */}
              <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Topic</label>
              <input
                type="text"
                value={topic}
                onChange={(e) => {
                  const next = new URLSearchParams();
                  if (e.target.value) next.set("topic", e.target.value);
                  if (q) next.set("q", q);
                  navigate(`/webinars${next.toString() ? `?${next.toString()}` : ""}`);
                }}
                placeholder="Filter by topic…"
                className="px-3 py-2 rounded-md border border-border bg-card text-sm w-64"
              />
            </div>
            <form onSubmit={submitSearch} className="flex items-center gap-2">
              <label htmlFor="webinars-search" className="sr-only">
                Search webinars
              </label>
              <input
                id="webinars-search"
                type="search"
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                placeholder="Search webinars…"
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
                  <WebinarVideoCardSkeleton key={i} />
              ))}
            </div>
          ) : result.items.length === 0 ? (
            <div className="rounded-2xl border border-border/60 bg-card p-12 text-center text-muted-foreground">
              {q
                ? `No webinars match “${q}”${topic ? " with this topic" : ""}.`
                : "No webinars match this topic yet."}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {result.items.map((item) => (
                  <WebinarVideoCard key={item.id} item={item} />
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
