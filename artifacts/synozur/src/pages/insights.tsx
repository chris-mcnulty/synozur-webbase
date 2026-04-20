import { Meta } from "@/lib/meta";
import { motion } from "framer-motion";
import { useMemo, useRef, useState } from "react";
import { ArrowRight, Search, Rss } from "lucide-react";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import {
  Turnstile,
  TURNSTILE_SITE_KEY,
  isBotCheckError,
  type TurnstileHandle,
} from "@/components/turnstile";
import { BotCheckCallout } from "@/components/bot-check-callout";
import { useInsightsList, resolveMediaUrl } from "@/lib/insights";
import { useListCmsCategories } from "@workspace/api-client-react";
import type { PublicPost } from "@workspace/api-client-react";

const PAGE_SIZE = 12;
const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

function InsightsSubscribeForm() {
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error" | "bot-check-failed">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "submitting") return;
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      setStatus("error");
      setErrorMessage("Please complete the bot check before subscribing.");
      return;
    }
    setStatus("submitting");
    setErrorMessage(null);
    try {
      await api.submitSubscribe({ email, source: "insights", website: website || null, turnstileToken });
      setStatus("success");
      setEmail("");
    } catch (err) {
      if (isBotCheckError(err)) {
        setStatus("bot-check-failed");
        setErrorMessage(null);
        setTurnstileToken(null);
        turnstileRef.current?.reset();
        return;
      }
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Could not subscribe. Please try again.");
    }
  };

  if (status === "success") {
    return (
      <p className="text-base text-primary" role="status">
        Thanks — we&apos;ll send the next edition of The Feed to your inbox.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} aria-label="Subscribe to The Feed" className="flex flex-col items-center gap-3">
      <div className="flex w-full max-w-md gap-2">
        <label htmlFor="insights-subscribe-email" className="sr-only">Email address</label>
        <Input
          id="insights-subscribe-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          className="flex-1"
        />
        <input
          type="text"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden"
        />
        <Button type="submit" disabled={status === "submitting"} className="h-10 px-6">
          {status === "submitting" ? "Subscribing..." : "Subscribe"}
        </Button>
      </div>
      <Turnstile ref={turnstileRef} onVerify={setTurnstileToken} />
      {status === "bot-check-failed" && <BotCheckCallout className="max-w-md text-left" />}
      {status === "error" && errorMessage && (
        <p className="text-sm text-destructive" role="alert">{errorMessage}</p>
      )}
    </form>
  );
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

function PostCard({ post, index }: { post: PublicPost; index: number }) {
  const hero = resolveMediaUrl(post.heroImageUrl);
  const cat = post.categories[0]?.name;
  return (
    <motion.article
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, delay: Math.min(index, 8) * 0.04 }}
      className="group rounded-2xl border border-border/60 bg-card overflow-hidden hover:border-primary/40 transition-colors"
    >
      <Link href={`/insights/${post.slug}`} className="block">
        <div className="relative aspect-[16/9] overflow-hidden bg-card">
          {hero ? (
            <img
              src={hero}
              alt={post.title}
              loading="lazy"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
          ) : (
            <div className="w-full h-full nebula-gradient opacity-40" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
        </div>
        <div className="p-6">
          <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-muted-foreground mb-3">
            {cat && <span className="text-primary">{cat}</span>}
            {cat && <span className="h-1 w-1 rounded-full bg-muted-foreground/50" />}
            <span>{formatDate(post.publishedAt)}</span>
          </div>
          <h2 className="text-lg font-bold leading-snug mb-3 group-hover:text-primary transition-colors">
            {post.title}
          </h2>
          {post.excerpt && (
            <p className="text-sm text-muted-foreground leading-relaxed mb-5 line-clamp-3">
              {post.excerpt}
            </p>
          )}
          <span className="inline-flex items-center text-sm font-medium text-primary">
            Read <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
          </span>
        </div>
      </Link>
    </motion.article>
  );
}

function FeaturedCard({ post }: { post: PublicPost }) {
  const hero = resolveMediaUrl(post.heroImageUrl);
  const cat = post.categories[0]?.name;
  return (
    <Link
      href={`/insights/${post.slug}`}
      className="group block rounded-3xl border border-border/60 bg-card overflow-hidden hover:border-primary/40 transition-colors mb-12"
    >
      <div className="grid grid-cols-1 lg:grid-cols-2">
        <div className="relative aspect-[16/9] lg:aspect-auto bg-card overflow-hidden">
          {hero ? (
            <img
              src={hero}
              alt={post.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
          ) : (
            <div className="w-full h-full nebula-gradient opacity-40" />
          )}
        </div>
        <div className="p-8 lg:p-12 flex flex-col justify-center">
          <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-muted-foreground mb-4">
            <span className="text-primary">Featured</span>
            {cat && <span className="h-1 w-1 rounded-full bg-muted-foreground/50" />}
            {cat && <span>{cat}</span>}
            <span className="h-1 w-1 rounded-full bg-muted-foreground/50" />
            <span>{formatDate(post.publishedAt)}</span>
          </div>
          <h2 className="text-2xl md:text-3xl font-bold leading-tight mb-4 group-hover:text-primary transition-colors">
            {post.title}
          </h2>
          {post.excerpt && (
            <p className="text-base text-muted-foreground leading-relaxed mb-6 line-clamp-4">
              {post.excerpt}
            </p>
          )}
          <span className="inline-flex items-center text-sm font-medium text-primary">
            Read the full piece <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
          </span>
        </div>
      </div>
    </Link>
  );
}

export default function Insights() {
  const [page, setPage] = useState(1);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const categoriesQ = useListCmsCategories();
  const categories = categoriesQ.data ?? [];

  const params = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      ...(activeCat ? { categorySlug: activeCat } : {}),
    }),
    [page, activeCat],
  );

  const { data, isLoading, isError, refetch } = useInsightsList(params);

  // Client-side title/excerpt search across the loaded page (the public list
  // endpoint doesn't currently support full-text search, so we filter what's
  // returned). When search is active we collapse pagination.
  const filteredItems = useMemo(() => {
    const items = data?.items ?? [];
    if (!search.trim()) return items;
    const q = search.trim().toLowerCase();
    return items.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        (p.excerpt && p.excerpt.toLowerCase().includes(q)) ||
        (p.subtitle && p.subtitle.toLowerCase().includes(q)),
    );
  }, [data, search]);

  const featured = page === 1 && !search && filteredItems.length > 0 ? filteredItems[0] : null;
  const grid = featured ? filteredItems.slice(1) : filteredItems;
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="w-full">
      <Meta
        title="Insights"
        description="The Feed. Original writing on transformation, technology, leadership, and the operating disciplines that let strategy actually ship."
        feedHref={`${BASE_PATH}/api/insights/rss.xml`}
      />

      <section className="relative overflow-hidden bg-[#0B0B1A] py-32">
        <div className="absolute inset-0 nebula-gradient opacity-25" />
        <div className="container relative z-10 mx-auto px-4 max-w-4xl">
          <div className="flex items-center justify-between gap-4 mb-4">
            <p className="text-sm uppercase tracking-widest text-primary">The Feed</p>
            <a
              href={`${BASE_PATH}/api/insights/rss.xml`}
              className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-zinc-300 hover:text-primary transition-colors"
              aria-label="RSS feed"
            >
              <Rss className="h-4 w-4" /> RSS
            </a>
          </div>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-6">Insights</h1>
          <p className="text-xl md:text-2xl text-zinc-300 leading-relaxed max-w-3xl">
            Original writing from our partners on transformation, technology, leadership, and the operating disciplines that let strategy ship.
          </p>
        </div>
      </section>

      <section className="py-16 md:py-24 bg-background">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 mb-10">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => {
                  setActiveCat(null);
                  setPage(1);
                }}
                className={`px-4 py-2 rounded-full text-sm font-medium border transition-colors ${
                  activeCat === null
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40"
                }`}
              >
                All
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setActiveCat(c.slug);
                    setPage(1);
                  }}
                  className={`px-4 py-2 rounded-full text-sm font-medium border transition-colors ${
                    activeCat === c.slug
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40"
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setSearch(searchInput);
                setPage(1);
              }}
              className="relative w-full md:w-72"
              role="search"
            >
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search posts"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onBlur={() => setSearch(searchInput)}
                className="pl-9"
                aria-label="Search posts"
              />
            </form>
          </div>

          {isLoading && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-2xl border border-border/60 bg-card overflow-hidden animate-pulse"
                >
                  <div className="aspect-[16/9] bg-muted/40" />
                  <div className="p-6 space-y-3">
                    <div className="h-3 w-24 bg-muted/40 rounded" />
                    <div className="h-5 w-full bg-muted/40 rounded" />
                    <div className="h-5 w-3/4 bg-muted/40 rounded" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {isError && !isLoading && (
            <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-8 text-center">
              <p className="text-destructive font-medium mb-3">
                We couldn&apos;t load The Feed right now.
              </p>
              <Button onClick={() => refetch()} variant="outline">Try again</Button>
            </div>
          )}

          {!isLoading && !isError && filteredItems.length === 0 && (
            <div className="rounded-2xl border border-border/60 bg-card p-12 text-center">
              <p className="text-lg font-medium mb-2">No posts found.</p>
              <p className="text-muted-foreground">Try a different category or search term.</p>
            </div>
          )}

          {!isLoading && !isError && filteredItems.length > 0 && (
            <>
              {featured && <FeaturedCard post={featured} />}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {grid.map((p, i) => (
                  <PostCard key={p.id} post={p} index={i} />
                ))}
              </div>

              {!search && totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 mt-12">
                  <Button
                    variant="outline"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      <section className="bg-card border-t border-border py-24">
        <div className="container mx-auto px-4 text-center max-w-2xl">
          <h2 className="text-3xl md:text-4xl font-bold mb-6">Subscribe to The Feed</h2>
          <p className="text-lg text-muted-foreground mb-6">
            New essays, models, and Polaris episodes — delivered to your inbox.
          </p>
          <InsightsSubscribeForm />
        </div>
      </section>
    </div>
  );
}
