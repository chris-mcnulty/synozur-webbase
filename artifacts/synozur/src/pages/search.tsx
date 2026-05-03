import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Search as SearchIcon, ArrowRight, Loader2 } from "lucide-react";
import { Meta } from "@/lib/meta";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  fetchSearch,
  reportSearchClick,
  KIND_LABELS,
  SEARCH_KINDS,
  type SearchKind,
  type SearchResult,
  type SearchResponse,
} from "@/lib/search-api";

// #170 — Public `/search` page. Query input is synced to `?q=` so the
// browser's back/forward and copy-paste-the-URL behavior both work, plus
// the SSR-friendly `<title>` reflects the current term. The page is
// `noindex,nofollow` (via Meta) so an internal-search URL never makes it
// into Google's index — that's the same posture other "search results"
// surfaces use across the web.

const PAGE_SIZE = 10;

function getQueryFromLocation(): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return params.get("q") ?? "";
}

function getKindFromLocation(): SearchKind | "all" {
  if (typeof window === "undefined") return "all";
  const params = new URLSearchParams(window.location.search);
  const k = params.get("kind");
  if (k && (SEARCH_KINDS as readonly string[]).includes(k)) return k as SearchKind;
  return "all";
}

export default function SearchPage() {
  const [, navigate] = useLocation();
  // Initialized once from `window.location.search` and then kept in sync
  // via the URL effect below — no `useSearch()` hook needed.
  const [query, setQuery] = useState<string>(getQueryFromLocation);
  const [activeKind, setActiveKind] = useState<SearchKind | "all">(getKindFromLocation);
  const [inputValue, setInputValue] = useState<string>(query);

  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchId, setSearchId] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Pick up history-driven `?q=` changes (back/forward) and reflect them
  // into local state so the input + results re-sync without a full reload.
  useEffect(() => {
    function syncFromUrl() {
      setQuery(getQueryFromLocation());
      setActiveKind(getKindFromLocation());
      setInputValue(getQueryFromLocation());
    }
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

  // Re-run search whenever query or kind change. Cancels any in-flight
  // fetch so a fast typist doesn't end up with stale results racing in.
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setNextCursor(null);
      setSearchId(null);
      setError(null);
      setLoading(false);
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    fetchSearch({ q: query, kind: activeKind, limit: PAGE_SIZE, signal: ctrl.signal })
      .then((res: SearchResponse) => {
        if (ctrl.signal.aborted) return;
        setResults(res.items);
        setNextCursor(res.nextCursor);
        setSearchId(res.searchId);
      })
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name === "AbortError") return;
        setError("Something went wrong running that search. Try again.");
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [query, activeKind]);

  // Keep the URL in sync with the active query / kind so deep links work.
  // We push history when the *query* itself changes (so back/forward walks
  // through prior searches) but only replace history when the user just
  // flips a kind tab — otherwise hammering the kind tabs would pollute
  // history with intermediate states.
  const lastQueryRef = useRef<string>(query);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (activeKind !== "all") params.set("kind", activeKind);
    const next = params.toString() ? `/search?${params.toString()}` : "/search";
    if (window.location.pathname + window.location.search === next) return;
    const queryChanged = lastQueryRef.current !== query;
    lastQueryRef.current = query;
    if (queryChanged) {
      // wouter listens on popstate, so a manual pushState keeps the
      // browser history correct without a full route re-render.
      window.history.pushState(null, "", next);
    } else {
      window.history.replaceState(null, "", next);
    }
  }, [query, activeKind]);

  // Recompute "Insights only / Case studies only / …" tab counts off the
  // current page so the user can see at a glance which kinds matched. Not
  // a substitute for backend-side facet counts — those would require a
  // second query — but cheap and accurate for the current page.
  const kindCounts = useMemo(() => {
    const counts: Partial<Record<SearchKind, number>> = {};
    for (const r of results) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
    return counts;
  }, [results]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setQuery(inputValue.trim());
  }

  const loadMore = useCallback(async (): Promise<void> => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetchSearch({
        q: query,
        kind: activeKind,
        limit: PAGE_SIZE,
        cursor: nextCursor,
      });
      setResults((prev) => [...prev, ...res.items]);
      setNextCursor(res.nextCursor);
    } catch {
      setError("Couldn't load more results.");
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, query, activeKind]);

  // Infinite scroll: observe a sentinel below the result list and call
  // `loadMore` whenever it scrolls into view. `rootMargin` of 200px
  // prefetches the next page slightly before the user hits the bottom so
  // there's no perceptible pause.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    if (!nextCursor) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { rootMargin: "200px 0px" },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [nextCursor, loadMore]);

  function onResultClick(result: SearchResult, indexInPage: number): void {
    if (searchId) {
      void reportSearchClick({
        searchId,
        clickedKind: result.kind,
        clickedRank: indexInPage,
        clickedSlug: result.slug,
      });
    }
    navigate(result.url);
  }

  const trimmedQuery = query.trim();
  const showEmpty = !loading && trimmedQuery.length > 0 && results.length === 0;

  return (
    <>
      <Meta
        title={trimmedQuery ? `Search results for "${trimmedQuery}" — Synozur` : "Search — Synozur"}
        description={
          trimmedQuery
            ? `Search results for "${trimmedQuery}" across Synozur insights, case studies, services, and solutions.`
            : "Search across Synozur insights, case studies, services, and solutions."
        }
        noindex
      />
      <div className="container mx-auto max-w-4xl px-4 py-12 lg:py-16" data-testid="search-page">
        <div className="mb-8">
          <h1 className="text-3xl lg:text-4xl font-semibold tracking-tight mb-2">Search</h1>
          <p className="text-muted-foreground">
            Find insights, case studies, services, solutions, and more from across Synozur.
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="flex items-center gap-2 mb-6"
          role="search"
          aria-label="Site search"
        >
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              type="search"
              autoFocus
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Search the Synozur library…"
              className="pl-9 h-11"
              aria-label="Search query"
              data-testid="search-input"
            />
          </div>
          <Button type="submit" size="lg" data-testid="search-submit">
            Search
          </Button>
        </form>

        {trimmedQuery && (
          <div className="flex flex-wrap gap-2 mb-6 border-b border-border/50 pb-4">
            <KindTab
              label="All"
              active={activeKind === "all"}
              onClick={() => setActiveKind("all")}
            />
            {SEARCH_KINDS.map((k) => (
              <KindTab
                key={k}
                label={KIND_LABELS[k]}
                count={kindCounts[k]}
                active={activeKind === k}
                onClick={() => setActiveKind(k)}
              />
            ))}
          </div>
        )}

        {loading && results.length === 0 && (
          <div className="flex items-center justify-center py-12 text-muted-foreground" data-testid="search-loading">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Searching…
          </div>
        )}

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {showEmpty && (
          <EmptyState query={trimmedQuery} onClear={() => { setInputValue(""); setQuery(""); }} />
        )}

        {results.length > 0 && (
          <>
            <ul className="divide-y divide-border/60" data-testid="search-results">
              {results.map((r, i) => (
                <li key={`${r.kind}-${r.id}`} className="py-4">
                  <button
                    type="button"
                    onClick={() => onResultClick(r, i)}
                    className="block w-full text-left group"
                    data-testid={`search-result-${i}`}
                  >
                    <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                      {KIND_LABELS[r.kind]}
                    </div>
                    <div className="text-lg font-medium group-hover:text-primary transition-colors">
                      {r.title}
                    </div>
                    {r.excerptHtml && (
                      <p
                        className="text-sm text-muted-foreground mt-1 [&_mark]:bg-primary/20 [&_mark]:text-foreground [&_mark]:rounded-sm [&_mark]:px-0.5"
                        // The markup is server-generated by `ts_headline`,
                        // which only emits the `<mark>` wrappers we asked
                        // for — safe to render as HTML for the highlight.
                        dangerouslySetInnerHTML={{ __html: r.excerptHtml }}
                      />
                    )}
                  </button>
                </li>
              ))}
            </ul>
            {/* Infinite-scroll sentinel: when this element scrolls into
                view (≥200px from bottom), the IntersectionObserver above
                kicks off the next page. The visible spinner gives users
                visual confirmation that more is loading. */}
            {nextCursor && (
              <div
                ref={sentinelRef}
                className="flex justify-center py-6 text-sm text-muted-foreground"
                aria-live="polite"
                data-testid="search-load-more-sentinel"
              >
                {loadingMore ? (
                  <span className="inline-flex items-center">
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Loading more…
                  </span>
                ) : (
                  <span className="opacity-60">Scroll for more results</span>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

function KindTab({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "px-3 py-1.5 text-sm rounded-full transition-colors " +
        (active
          ? "bg-primary text-primary-foreground"
          : "bg-muted/50 text-foreground hover:bg-muted")
      }
      aria-pressed={active}
      data-testid={`search-tab-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      {label}
      {typeof count === "number" && count > 0 && (
        <span className="ml-1.5 text-xs opacity-70">{count}</span>
      )}
    </button>
  );
}

function EmptyState({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-8 text-center" data-testid="search-empty">
      <h2 className="text-lg font-medium mb-1">No results for "{query}"</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Try a different phrase, or talk to a human — we'd love to hear what you're looking for.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="outline" onClick={onClear}>Clear search</Button>
        <Button asChild>
          <a href="/contact">Talk to a human <ArrowRight className="h-4 w-4 ml-1" /></a>
        </Button>
      </div>
    </div>
  );
}
