import { Link, useLocation } from "wouter";
import { Menu, X, Search, LayoutDashboard, LogOut, Loader2 } from "lucide-react";
import { useState, useRef, useEffect, useCallback, FormEvent } from "react";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { SynozurAppSwitcher } from "@/components/synozur-app-switcher";
import { useAuth, type AuthedUser } from "@/context/auth";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { LOGO_COLOR_URL } from "@workspace/synozur-nav";

interface SearchResult {
  kind: string;
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  url: string;
}
interface SearchResponse {
  items: SearchResult[];
  searchId: string | null;
}

async function fetchSearch(q: string, signal: AbortSignal): Promise<SearchResponse> {
  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=8`, { signal });
  if (!res.ok) return { items: [], searchId: null };
  return res.json() as Promise<SearchResponse>;
}

function reportSearchClick(searchId: string, clickedSlug: string, clickedKind: string, clickedRank: number) {
  void fetch("/api/search/click", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ searchId, clickedSlug, clickedKind, clickedRank }),
  }).catch(() => undefined);
}

// ── Main-site navigation (mirrors synozur SiteHeaderB) ──────────────────────────
// These link OUT of the portal to the main Synozur app, so they use plain <a>
// tags with root-absolute hrefs that bypass Galaxy's wouter base.
const PRIMARY_NAV = [
  { name: "Home", href: "/" },
  { name: "The Sprint", href: "/sprint" },
  { name: "Proof", href: "/proof" },
  { name: "Fit", href: "/fit" },
];

const BOOK_HREF = "/book";

// Top-level portal navigation. The middle four entries are the lifecycle
// transformation stages (mirrored by `LIFECYCLE_STAGES` in `components/
// lifecycle.tsx`); `Home` and `Resources` book-end them as non-stage entries.
//
// `aliases` lists the per-app deep-link prefixes that should still light up
// the corresponding tab when a user lands via a saved deep link (e.g. someone
// who bookmarked `/projects` should see `Deliver` highlighted). Per-app
// surfaces are still reachable, just no longer top-level entries.
interface PortalNavEntry {
  href: string;
  label: string;
  aliases?: string[];
}

const PORTAL_NAV: PortalNavEntry[] = [
  { href: "/", label: "Home" },
  {
    href: "/assess",
    label: "Assess",
    aliases: ["/assessments", "/learning", "/benchmarks"],
  },
  {
    href: "/define",
    label: "Define",
    aliases: ["/reports", "/workspaces"],
  },
  {
    href: "/deliver",
    label: "Deliver",
    aliases: ["/projects"],
  },
  { href: "/outcomes", label: "Outcomes" },
  {
    href: "/resources",
    label: "Resources",
    aliases: ["/documents", "/invoices", "/apps"],
  },
];

function isPortalNavActive(entry: PortalNavEntry, location: string): boolean {
  if (entry.href === "/") return location === "/";
  if (location === entry.href || location.startsWith(`${entry.href}/`)) return true;
  return (entry.aliases ?? []).some(
    (a) => location === a || location.startsWith(`${a}/`),
  );
}

function UserButton({ user, signOut }: { user: AuthedUser; signOut: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) {
      document.addEventListener("mousedown", handleClick);
      document.addEventListener("keydown", handleEsc);
    }
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [open]);

  const initial = ((user.displayName || user.email || "U")[0] ?? "U").toUpperCase();
  const shortName = user.displayName?.split(" ")[0] ?? user.email?.split("@")[0] ?? "Account";

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="Account menu"
        data-testid="button-user-menu"
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-foreground/10 transition-colors text-sm"
      >
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt={shortName} className="h-7 w-7 rounded-full object-cover flex-shrink-0" />
        ) : (
          <span className="h-7 w-7 rounded-full bg-primary flex items-center justify-center text-xs font-bold text-primary-foreground flex-shrink-0">
            {initial}
          </span>
        )}
        <span className="hidden sm:block font-medium truncate max-w-[100px] text-foreground/80">{shortName}</span>
      </button>

      {open && (
        <div role="menu" className="absolute right-0 top-full mt-2 w-56 bg-popover border border-border rounded-lg shadow-lg z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            {user.displayName && <div className="font-medium text-sm truncate">{user.displayName}</div>}
            {user.email && <div className="text-xs text-muted-foreground truncate">{user.email}</div>}
          </div>
          {user.roles.length > 0 && (
            <a href="/admin" role="menuitem" onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-muted transition-colors">
              <LayoutDashboard className="h-4 w-4 text-muted-foreground" />
              Admin dashboard
            </a>
          )}
          <button role="menuitem" onClick={() => { setOpen(false); void signOut(); }}
            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-muted transition-colors text-left">
            <LogOut className="h-4 w-4 text-muted-foreground" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function PortalSiteHeader({ hidePortalNav = false }: { hidePortalNav?: boolean } = {}) {
  const { user, signOut } = useAuth();
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchId, setSearchId] = useState<string | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchAbortRef = useRef<AbortController | null>(null);
  const [mobileSearchQuery, setMobileSearchQuery] = useState("");

  // ── Cmd-K / "/" keyboard shortcut ──────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMeta = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      const isSlash =
        e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey &&
        !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement) &&
        !(e.target as HTMLElement | null)?.isContentEditable;
      if (isMeta || isSlash) {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => { setMobileMenuOpen(false); }, [location]);

  // ── Debounced live search ───────────────────────────────────────
  useEffect(() => {
    if (!searchOpen) return;
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearchId(null);
      setSearchLoading(false);
      return;
    }
    const handle = window.setTimeout(() => {
      searchAbortRef.current?.abort();
      const ctrl = new AbortController();
      searchAbortRef.current = ctrl;
      setSearchLoading(true);
      fetchSearch(q, ctrl.signal)
        .then((res) => {
          if (ctrl.signal.aborted) return;
          setSearchResults(res.items);
          setSearchId(res.searchId);
        })
        .catch((err: unknown) => {
          if ((err as { name?: string })?.name === "AbortError") return;
          setSearchResults([]);
        })
        .finally(() => { if (!ctrl.signal.aborted) setSearchLoading(false); });
    }, 150);
    return () => window.clearTimeout(handle);
  }, [searchQuery, searchOpen]);

  useEffect(() => {
    if (!searchOpen) {
      setSearchQuery("");
      setSearchResults([]);
      setSearchId(null);
      searchAbortRef.current?.abort();
    }
  }, [searchOpen]);

  function selectResult(result: SearchResult, idx: number) {
    if (searchId) reportSearchClick(searchId, result.slug, result.kind, idx);
    setSearchOpen(false);
    window.location.assign(result.url);
  }

  function goToFullSearch() {
    const q = searchQuery.trim();
    setSearchOpen(false);
    window.location.assign(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
  }

  function handleMobileSearch(e: FormEvent) {
    e.preventDefault();
    const q = mobileSearchQuery.trim();
    setMobileMenuOpen(false);
    setMobileSearchQuery("");
    window.location.assign(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
  }

  const closeMobile = useCallback(() => setMobileMenuOpen(false), []);

  return (
    <div className="sticky top-0 z-50 w-full">
      {/* ── Main bar (mirrors synozur SiteHeaderB, solid variant) ── */}
      <header className="w-full border-b border-border/50 bg-background/90 backdrop-blur-md supports-[backdrop-filter]:bg-background/80 shadow-sm">
        <div className="container mx-auto px-4 md:px-6 h-16 flex items-center gap-3">

          {/* Left: App switcher + color logo (logo → main site) */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <SynozurAppSwitcher currentApp="galaxy" />
            <a href="/" className="flex items-center transition-opacity hover:opacity-80" aria-label="The Synozur Alliance — main site">
              <img
                src={LOGO_COLOR_URL}
                alt="The Synozur Alliance"
                width={154}
                height={42}
                className="h-8 w-auto max-w-full"
              />
            </a>
          </div>

          {/* Center: Primary nav (desktop) */}
          <nav className="hidden lg:flex items-center gap-1 flex-1 justify-center">
            {PRIMARY_NAV.map((link) => (
              <a
                key={link.name}
                href={link.href}
                className="px-4 py-2 rounded-md text-sm font-semibold transition-colors text-foreground/75 hover:text-foreground hover:bg-foreground/10"
              >
                {link.name}
              </a>
            ))}
            <a
              href={BOOK_HREF}
              className="ml-2 h-9 px-5 inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground text-sm font-semibold transition-colors hover:bg-primary/90 shadow-[0_0_16px_rgba(129,15,251,0.35)]"
            >
              Book
            </a>
          </nav>

          {/* Right: chrome controls */}
          <div className="ml-auto lg:ml-0 flex items-center gap-1.5">
            <button
              type="button"
              aria-label="Open search (⌘K)"
              onClick={() => setSearchOpen(true)}
              data-testid="header-search-button"
              className="hidden lg:inline-flex h-9 items-center gap-2 rounded-md border border-border bg-foreground/5 px-3 text-sm text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-colors"
            >
              <Search className="h-4 w-4" />
              <span className="hidden xl:inline">Search…</span>
              <kbd className="hidden xl:inline-flex h-5 select-none items-center gap-0.5 rounded border border-border bg-foreground/5 px-1.5 font-mono text-[10px] text-muted-foreground">
                <span className="text-xs">⌘</span>K
              </kbd>
            </button>

            <ThemeToggle />
            {user ? <UserButton user={user} signOut={signOut} /> : null}

            {/* Mobile hamburger */}
            <button
              type="button"
              className="lg:hidden p-2 text-foreground/70 hover:text-foreground transition-colors flex-shrink-0"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>

        {/* Mobile nav drawer */}
        {mobileMenuOpen && (
          <div className="lg:hidden absolute top-full left-0 w-full h-[calc(100vh-4rem)] bg-background border-t border-border overflow-y-auto z-40">
            <div className="p-6 flex flex-col gap-5">
              <form onSubmit={handleMobileSearch} className="flex items-center gap-2">
                <input
                  type="search"
                  value={mobileSearchQuery}
                  onChange={(e) => setMobileSearchQuery(e.target.value)}
                  placeholder="Search synozur.com…"
                  aria-label="Search the site"
                  className="h-10 flex-1 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button type="submit" aria-label="Submit search"
                  className="h-10 w-10 inline-flex items-center justify-center rounded-md bg-muted text-foreground hover:bg-muted/80 transition-colors">
                  <Search className="h-4 w-4" />
                </button>
              </form>

              {/* Primary (main site) */}
              <div className="flex flex-col gap-1">
                {PRIMARY_NAV.map((link) => (
                  <a
                    key={link.name}
                    href={link.href}
                    className="block px-3 py-2.5 rounded-md text-sm font-semibold text-foreground/80 hover:text-foreground hover:bg-muted transition-colors"
                  >
                    {link.name}
                  </a>
                ))}
                <a
                  href={BOOK_HREF}
                  className="block px-3 py-2.5 rounded-md text-sm font-semibold text-center bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  Book the Sprint
                </a>
              </div>

              {/* Galaxy Portal section */}
              {!hidePortalNav && (
                <div className="flex flex-col gap-1 pt-3 border-t border-border/50">
                  <p className="px-3 pb-1 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                    Galaxy Portal
                  </p>
                  {PORTAL_NAV.map((n) => {
                    const active = isPortalNavActive(n, location);
                    return (
                      <Link key={n.href} href={n.href}
                        className={`block px-3 py-2 rounded-md text-sm transition-colors ${active ? "text-[#E60CB3] font-semibold bg-muted" : "text-foreground/70 hover:text-foreground hover:bg-muted"}`}
                        onClick={closeMobile}>
                        {n.label}
                      </Link>
                    );
                  })}
                </div>
              )}

              {user && (
                <div className="pt-4 mt-1 border-t border-border">
                  <button
                    onClick={() => { setMobileMenuOpen(false); void signOut(); }}
                    className="flex w-full items-center gap-2 text-sm text-muted-foreground hover:text-foreground py-2"
                    data-testid="button-sign-out"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign out ({user.email ?? user.displayName})
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </header>

      {/* ── Galaxy portal secondary nav bar ── */}
      {!hidePortalNav && <div className="w-full border-b border-border bg-background/95 backdrop-blur">
        <div className="container mx-auto px-4 md:px-6 h-10 flex items-center gap-1">
          <span className="text-xs text-muted-foreground font-medium mr-3 hidden sm:inline">Galaxy Portal</span>
          <div className="flex items-center gap-1">
            {PORTAL_NAV.map((n) => {
              const active = isPortalNavActive(n, location);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  data-testid={`nav-${n.label.toLowerCase()}`}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                >
                  {n.label}
                </Link>
              );
            })}
          </div>
          {user?.email && (
            <span className="ml-auto text-xs text-muted-foreground hidden sm:inline truncate max-w-[200px]">
              {user.email}
            </span>
          )}
        </div>
      </div>}

      {/* ── Cmd-K command palette ── */}
      <CommandDialog open={searchOpen} onOpenChange={setSearchOpen}>
        <CommandInput
          placeholder="Search Synozur — insights, services, case studies…"
          value={searchQuery}
          onValueChange={setSearchQuery}
          data-testid="command-search-input"
        />
        <CommandList>
          {searchLoading && (
            <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Searching…
            </div>
          )}
          {!searchLoading && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
            <CommandEmpty>No matches. Press Enter to open full search.</CommandEmpty>
          )}
          {!searchLoading && searchQuery.trim().length < 2 && (
            <div className="py-6 text-center text-xs text-muted-foreground">
              Type at least 2 characters to search.
            </div>
          )}
          {!searchLoading && searchResults.length > 0 && (
            <CommandGroup heading="Results">
              {searchResults.map((result, idx) => (
                <CommandItem
                  key={`${result.kind}-${result.id}`}
                  value={`${result.title} ${result.slug} ${result.kind}`}
                  onSelect={() => selectResult(result, idx)}
                  data-testid={`command-result-${idx}`}
                >
                  <div className="flex flex-col min-w-0">
                    <span className="truncate">{result.title}</span>
                    {result.excerpt && (
                      <span className="text-xs text-muted-foreground truncate">{result.excerpt}</span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {searchQuery.trim().length >= 2 && (
            <CommandGroup heading="More">
              <CommandItem
                value="__open-full-search__"
                onSelect={goToFullSearch}
                data-testid="command-open-full-search"
              >
                <Search className="h-4 w-4 mr-2" />
                See all results for &ldquo;{searchQuery.trim()}&rdquo;
              </CommandItem>
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </div>
  );
}
