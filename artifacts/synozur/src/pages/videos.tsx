import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { PlayCircle } from "lucide-react";
import { Meta } from "@/lib/meta";
import { useParentPage } from "@/lib/parent-page";
import {
  api,
  VIDEO_CATEGORIES,
  type VideoCategory,
  type VideoDto,
  type VideoListResult,
} from "@/lib/api";

const PAGE_SIZE = 12;

const CATEGORY_LABELS: Record<VideoCategory, string> = {
  interview: "Interview",
  webinar: "Webinar",
  demo: "Demo",
  talk: "Talk",
  clip: "Clip",
  other: "Video",
};

function VideoCard({ item }: { item: VideoDto }) {
  const thumbnail = item.thumbnailUrl || item.heroImage;
  return (
    <Link href={`/videos/${item.slug}`}>
      <a
        className="group block rounded-2xl overflow-hidden border border-border/60 bg-card hover:border-primary/40 transition-colors"
        data-testid={`card-video-${item.slug}`}
      >
        <div className="aspect-video relative overflow-hidden bg-muted">
          {thumbnail ? (
            <img
              src={thumbnail}
              alt={item.heroImageAlt || item.title}
              className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground">
              <PlayCircle className="h-12 w-12" />
            </div>
          )}
          <div className="absolute top-3 left-3 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur text-white text-[10px] tracking-[0.2em] uppercase font-semibold">
            {CATEGORY_LABELS[item.category]}
          </div>
          {item.videoUrl && (
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
              <PlayCircle className="h-14 w-14 text-white" />
            </div>
          )}
        </div>
        <div className="p-5">
          <h3 className="font-semibold text-lg leading-snug mb-2 group-hover:text-primary transition-colors line-clamp-2">
            {item.title}
          </h3>
          {item.shortDescription && (
            <p className="text-sm text-muted-foreground line-clamp-3">{item.shortDescription}</p>
          )}
          {item.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-4">
              {item.tags.slice(0, 3).map((t) => (
                <span
                  key={t}
                  className="px-2 py-0.5 rounded-full text-[10px] uppercase tracking-[0.15em] bg-muted border border-border text-muted-foreground"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      </a>
    </Link>
  );
}

function VideoCardSkeleton() {
  return (
    <div className="rounded-2xl overflow-hidden border border-border/60 bg-card">
      <div className="aspect-video bg-muted animate-pulse" />
      <div className="p-5 space-y-3">
        <div className="h-5 bg-muted rounded animate-pulse" />
        <div className="h-4 bg-muted rounded w-4/5 animate-pulse" />
        <div className="h-4 bg-muted rounded w-3/5 animate-pulse" />
      </div>
    </div>
  );
}

export default function Videos() {
  const [location, navigate] = useLocation();
  const search = typeof window !== "undefined" ? window.location.search : "";
  const params = useMemo(() => new URLSearchParams(search), [search, location]);
  const categoryParam = params.get("category") ?? "";
  const category = (VIDEO_CATEGORIES as readonly string[]).includes(categoryParam)
    ? (categoryParam as VideoCategory)
    : undefined;
  const q = params.get("q") ?? "";
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);

  const [result, setResult] = useState<VideoListResult | null>(null);
  const [qInput, setQInput] = useState(q);

  useEffect(() => {
    setQInput(q);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    api
      .listVideos({ category, q: q || undefined, page, pageSize: PAGE_SIZE })
      .then((res) => {
        if (!cancelled) setResult(res);
      })
      .catch(() => {
        if (!cancelled) setResult({ total: 0, page, pageSize: PAGE_SIZE, items: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [category, q, page]);

  function setCategory(next: VideoCategory | "") {
    const n = new URLSearchParams();
    if (next) n.set("category", next);
    if (q) n.set("q", q);
    navigate(`/videos${n.toString() ? `?${n.toString()}` : ""}`);
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const n = new URLSearchParams();
    if (category) n.set("category", category);
    if (qInput.trim()) n.set("q", qInput.trim());
    navigate(`/videos${n.toString() ? `?${n.toString()}` : ""}`);
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;

  const copy = useParentPage("videos", {
    heroEyebrow: "Videos",
    heroHeadline: "Videos",
    heroSubhead:
      "Conversations, interviews, and recorded webinars from Synozur — watch on your schedule.",
    seoTitle: "Videos",
    seoDescription:
      "Watch interviews, webinars, and conversations from Synozur leaders and partners.",
  });

  return (
    <div className="w-full">
      <Meta
        title={copy.seoTitle}
        description={copy.seoDescription}
        path="/videos"
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
          <div className="mb-8 flex flex-col md:flex-row md:items-center gap-4 justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setCategory("")}
                className={
                  "px-3 py-1.5 rounded-full text-sm border transition-colors " +
                  (!category
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:text-foreground")
                }
                data-testid="filter-video-all"
              >
                All
              </button>
              {VIDEO_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={
                    "px-3 py-1.5 rounded-full text-sm border transition-colors " +
                    (category === c
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-muted-foreground hover:text-foreground")
                  }
                  data-testid={`filter-video-${c}`}
                >
                  {CATEGORY_LABELS[c]}
                </button>
              ))}
            </div>
            <form onSubmit={submitSearch} className="flex items-center gap-2">
              <label htmlFor="videos-search" className="sr-only">
                Search videos
              </label>
              <input
                id="videos-search"
                type="search"
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                placeholder="Search videos…"
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
                <VideoCardSkeleton key={i} />
              ))}
            </div>
          ) : result.items.length === 0 ? (
            <div className="rounded-2xl border border-border/60 bg-card p-12 text-center text-muted-foreground">
              {q
                ? `No videos match “${q}”${category ? ` in ${CATEGORY_LABELS[category]}` : ""}.`
                : "No videos yet."}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {result.items.map((item) => (
                  <VideoCard key={item.id} item={item} />
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
                      navigate(`/videos?${next.toString()}`);
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
                      navigate(`/videos?${next.toString()}`);
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
