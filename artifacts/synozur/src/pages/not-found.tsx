import { useEffect, useMemo, useState } from "react";
import { Meta } from "@/lib/meta";
import { Link } from "wouter";
import { Compass, Search, ArrowRight, Send } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useInsightsList } from "@/lib/insights";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

/**
 * Top-level sections shown as a mini-sitemap on the 404 page. Kept in sync
 * with the public navigation in `components/header.tsx` so a visitor who
 * hits a stale URL has a one-click escape route to every primary surface.
 */
const SITEMAP_SECTIONS: Array<{ label: string; href: string; blurb: string }> = [
  { label: "Services", href: "/services-overview/default", blurb: "Strategy, AI, and Microsoft 365 advisory." },
  { label: "Solutions", href: "/services-overview/default", blurb: "Outcome-driven engagements across pillars." },
  { label: "Insights", href: "/insights", blurb: "The Feed — perspectives and analysis." },
  { label: "Case Studies", href: "/case-studies", blurb: "Client outcomes and proof points." },
  { label: "Library", href: "/library", blurb: "Guides, frameworks, and reference material." },
  { label: "Workshops", href: "/workshops", blurb: "Hands-on sessions to move from idea to action." },
  { label: "About", href: "/about", blurb: "Who we are and how we work." },
  { label: "Contact", href: "/contact", blurb: "Get in touch with the team." },
];

function reportNotFound(): void {
  if (typeof window === "undefined") return;
  const path = window.location.pathname + window.location.search;
  // Skip admin/auth paths — they're handled by their own routers and
  // shouldn't pollute the public 404 log.
  if (
    path === "/admin" ||
    path.startsWith("/admin/") ||
    path.startsWith("/sign-in") ||
    path.startsWith("/sign-up")
  ) {
    return;
  }
  const body = JSON.stringify({
    path,
    referrer: document.referrer || null,
  });
  try {
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon("/api/traffic/not-found", blob)) return;
    }
  } catch {
    // fall through to fetch
  }
  void fetch("/api/traffic/not-found", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
    credentials: "same-origin",
  }).catch(() => {});
}

/**
 * Probe whether `/api/search` is available. The endpoint is being designed
 * under #170; until it ships, the 404 page degrades gracefully by hiding
 * the search input rather than rendering a control that 404s on submit.
 */
function useSearchAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/search?q=__probe__&limit=1", {
      method: "GET",
      credentials: "same-origin",
    })
      .then((res) => {
        if (cancelled) return;
        // Treat any non-404 response as "endpoint exists" — including 400
        // for missing/invalid params, which still indicates the route is
        // mounted.
        if (res.status !== 404) setAvailable(true);
      })
      .catch(() => {
        // network error — leave disabled.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return available;
}

interface SearchResult {
  title?: string;
  url?: string;
  excerpt?: string | null;
  kind?: string | null;
}

function normalizeResults(payload: unknown): SearchResult[] {
  // Be permissive about the eventual #170 response shape — accept either a
  // bare array or `{ items: [...] }`. Each result must at minimum have a
  // title and a url.
  const raw = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { items?: unknown })?.items)
      ? ((payload as { items: unknown[] }).items)
      : [];
  const out: SearchResult[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const obj = r as Record<string, unknown>;
    const title = typeof obj.title === "string" ? obj.title : null;
    const url = typeof obj.url === "string" ? obj.url : null;
    if (!title || !url) continue;
    out.push({
      title,
      url,
      excerpt:
        typeof obj.excerpt === "string"
          ? obj.excerpt
          : typeof obj.snippet === "string"
            ? (obj.snippet as string)
            : null,
      kind: typeof obj.kind === "string" ? obj.kind : null,
    });
  }
  return out;
}

function SearchBox() {
  const available = useSearchAvailable();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "empty">("idle");

  if (!available) return null;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = q.trim();
    if (!trimmed) return;
    setStatus("loading");
    setResults(null);
    try {
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(trimmed)}&limit=8`,
        { method: "GET", credentials: "same-origin" },
      );
      if (!res.ok) {
        setStatus("error");
        return;
      }
      const json = (await res.json()) as unknown;
      const items = normalizeResults(json);
      if (items.length === 0) {
        setStatus("empty");
        setResults([]);
      } else {
        setStatus("idle");
        setResults(items);
      }
    } catch {
      setStatus("error");
    }
  };

  return (
    <div data-testid="not-found-search">
      <form
        role="search"
        onSubmit={onSubmit}
        className="flex w-full gap-2"
      >
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the site…"
            aria-label="Search the site"
            className="pl-9 bg-white/5 border-white/15 text-white placeholder:text-zinc-500"
            data-testid="not-found-search-input"
          />
        </div>
        <Button
          type="submit"
          disabled={status === "loading"}
          data-testid="not-found-search-submit"
        >
          {status === "loading" ? "Searching…" : "Search"}
        </Button>
      </form>
      {status === "error" && (
        <p className="mt-3 text-sm text-zinc-400" data-testid="not-found-search-error">
          Search is temporarily unavailable. Try one of the sections below.
        </p>
      )}
      {status === "empty" && (
        <p className="mt-3 text-sm text-zinc-400" data-testid="not-found-search-empty">
          No matches. Try a broader term or browse the sections below.
        </p>
      )}
      {results && results.length > 0 && (
        <ul
          className="mt-4 space-y-2"
          data-testid="not-found-search-results"
        >
          {results.map((r, i) => {
            const href = r.url!.startsWith("http")
              ? r.url!
              : `${BASE_PATH}${r.url!.startsWith("/") ? "" : "/"}${r.url!}`;
            return (
              <li key={`${r.url}-${i}`}>
                <a
                  href={href}
                  className="block rounded-lg border border-white/10 bg-white/5 p-3 hover:border-white/30 hover:bg-white/10 transition-colors"
                  data-testid="not-found-search-result"
                >
                  <div className="text-sm font-medium text-white">
                    {r.title}
                  </div>
                  {r.excerpt && (
                    <div className="text-xs text-zinc-400 mt-1 line-clamp-2">
                      {r.excerpt}
                    </div>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function PopularInsights() {
  const { data, isLoading } = useInsightsList({ pageSize: 4 });
  const items = useMemo(() => data?.items ?? [], [data]);
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-lg border border-white/10 bg-white/5 h-24 animate-pulse"
          />
        ))}
      </div>
    );
  }
  if (items.length === 0) return null;
  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 gap-4"
      data-testid="not-found-popular-insights"
    >
      {items.map((post) => (
        <Link
          key={post.slug}
          href={`/insights/${post.slug}`}
          className="group rounded-lg border border-white/10 bg-white/5 p-4 text-left hover:border-white/30 hover:bg-white/10 transition-colors"
          data-testid="not-found-popular-insight"
        >
          <div className="text-xs uppercase tracking-widest text-primary mb-2">
            Insight
          </div>
          <div className="text-base font-medium text-white leading-snug line-clamp-2">
            {post.title}
          </div>
          <div className="mt-2 inline-flex items-center text-sm text-zinc-300 group-hover:text-white">
            Read <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </div>
        </Link>
      ))}
    </div>
  );
}

function ReportMissingForm() {
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "sent">("idle");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "submitting") return;
    setStatus("submitting");
    const path =
      typeof window !== "undefined"
        ? window.location.pathname + window.location.search
        : "/";
    try {
      await fetch("/api/traffic/not-found", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          path,
          referrer:
            (typeof document !== "undefined" && document.referrer) || null,
          note: note.trim() || null,
          reported: true,
        }),
      });
    } catch {
      // The endpoint always returns 202; even on error we acknowledge so
      // the visitor isn't left wondering whether the report went through.
    }
    setStatus("sent");
  };

  if (status === "sent") {
    return (
      <p
        className="text-sm text-zinc-300"
        data-testid="not-found-report-confirmation"
      >
        Thanks — our editors have been notified.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" data-testid="not-found-report-form">
      <label htmlFor="not-found-note" className="text-sm text-zinc-400">
        Were you looking for something specific? Let our editors know.
      </label>
      <div className="flex gap-2">
        <Input
          id="not-found-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What were you trying to find? (optional)"
          maxLength={500}
          className="flex-1 bg-white/5 border-white/15 text-white placeholder:text-zinc-500"
          data-testid="not-found-report-input"
        />
        <Button
          type="submit"
          disabled={status === "submitting"}
          data-testid="not-found-report-submit"
        >
          <Send className="mr-1 h-3.5 w-3.5" /> Report
        </Button>
      </div>
    </form>
  );
}

export default function NotFound() {
  useEffect(() => {
    reportNotFound();
  }, []);

  return (
    <div className="relative w-full min-h-[80vh] overflow-hidden bg-[#0B0B1A]">
      <Meta
        title="Lost in the constellation"
        description="The page you were looking for is not on the map."
        pageType="not-found"
      />
      <div className="absolute inset-0 nebula-gradient opacity-25" />
      <div
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "radial-gradient(1px 1px at 20% 30%, white, transparent), radial-gradient(1px 1px at 70% 60%, white, transparent), radial-gradient(1px 1px at 40% 80%, white, transparent), radial-gradient(2px 2px at 85% 20%, white, transparent), radial-gradient(1px 1px at 10% 70%, white, transparent), radial-gradient(1px 1px at 55% 15%, white, transparent)",
          backgroundSize: "100% 100%",
        }}
      />

      <div className="relative z-10 max-w-5xl mx-auto px-4 py-20">
        <div className="text-center mb-12">
          <div className="mx-auto h-16 w-16 rounded-full bg-white/10 border border-white/20 text-white flex items-center justify-center mb-8 backdrop-blur">
            <Compass className="h-7 w-7" />
          </div>
          <p className="text-sm uppercase tracking-widest text-primary mb-4">
            404 — off the map
          </p>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-white mb-4">
            Lost in the constellation.
          </h1>
          <p className="text-lg text-zinc-300 max-w-2xl mx-auto">
            The page you were looking for is not on the chart. Pick a star
            below — or search the rest of the site.
          </p>
        </div>

        <div className="max-w-2xl mx-auto mb-12">
          <SearchBox />
        </div>

        <section className="mb-14" aria-labelledby="not-found-sections">
          <h2
            id="not-found-sections"
            className="text-xs uppercase tracking-widest text-zinc-400 mb-4"
          >
            Top sections
          </h2>
          <ul
            className="grid grid-cols-2 md:grid-cols-4 gap-3"
            data-testid="not-found-sitemap"
          >
            {SITEMAP_SECTIONS.map((s) => (
              <li key={s.label}>
                <Link
                  href={s.href}
                  className="block h-full rounded-lg border border-white/10 bg-white/5 p-3 hover:border-white/30 hover:bg-white/10 transition-colors"
                >
                  <div className="text-sm font-medium text-white">
                    {s.label}
                  </div>
                  <div className="text-xs text-zinc-400 mt-1 line-clamp-2">
                    {s.blurb}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="mb-14" aria-labelledby="not-found-popular">
          <h2
            id="not-found-popular"
            className="text-xs uppercase tracking-widest text-zinc-400 mb-4"
          >
            Latest insights
          </h2>
          <PopularInsights />
        </section>

        <section
          className="rounded-xl border border-white/10 bg-white/5 p-5 max-w-2xl mx-auto"
          aria-labelledby="not-found-report"
        >
          <h2
            id="not-found-report"
            className="text-sm font-medium text-white mb-3"
          >
            Report this missing page
          </h2>
          <ReportMissingForm />
        </section>

        <div className="mt-12 text-center">
          <Link
            href="/"
            className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
          >
            Return home
          </Link>
        </div>
      </div>
    </div>
  );
}
