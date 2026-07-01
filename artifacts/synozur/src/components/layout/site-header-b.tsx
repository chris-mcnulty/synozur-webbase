import { useEffect, useState, useRef, FormEvent } from "react";
import { Link, useLocation } from "wouter";
import {
  Menu, X, Search, Globe, LogOut, LayoutDashboard,
} from "lucide-react";
import { LOGO_COLOR_URL } from "@workspace/synozur-nav";
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
import {
  fetchSearch,
  reportSearchClick,
  KIND_LABELS,
  SEARCH_KINDS,
  type SearchKind,
  type SearchResult,
} from "@/lib/search-api";

// ── Navigation ────────────────────────────────────────────────────────────────

const PRIMARY_NAV = [
  { name: "Home",       href: "/" },
  { name: "The Sprint", href: "/sprint" },
  { name: "Proof",      href: "/proof"  },
  { name: "Fit",        href: "/fit"    },
];

const SECONDARY_NAV = [
  { name: "About",    href: "/about"                   },
  { name: "Method",   href: "/services-overview/default"},
  { name: "Insights", href: "/insights"                 },
  { name: "Events",   href: "/events"                  },
];

const BOOK_HREF = "/book";
const DIALOG_RESULT_LIMIT = 15;

// ── UserButton ────────────────────────────────────────────────────────────────

function UserButton({ user, signOut }: { user: AuthedUser; signOut: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) {
      document.addEventListener("mousedown", onDown);
      document.addEventListener("keydown", onEsc);
    }
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const initial = ((user.displayName || user.email || "U")[0] ?? "U").toUpperCase();
  const shortName = user.displayName?.split(" ")[0] ?? user.email?.split("@")[0] ?? "Account";
  const hasRole = user.roles.length > 0;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="Account menu"
        data-testid="button-user-menu"
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/10 transition-colors text-sm"
      >
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt={shortName} className="h-7 w-7 rounded-full object-cover flex-shrink-0" />
        ) : (
          <span className="h-7 w-7 rounded-full bg-primary flex items-center justify-center text-xs font-bold text-primary-foreground flex-shrink-0">
            {initial}
          </span>
        )}
        <span className="hidden sm:block font-medium truncate max-w-[100px] text-white/80">{shortName}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-56 bg-popover border border-border rounded-lg shadow-lg z-50 overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-border">
            {user.displayName && <div className="font-medium text-sm truncate">{user.displayName}</div>}
            {user.email && <div className="text-xs text-muted-foreground truncate">{user.email}</div>}
          </div>
          {hasRole && (
            <Link href="/admin" onClick={() => setOpen(false)} role="menuitem"
              className="flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-muted transition-colors">
              <LayoutDashboard className="h-4 w-4 text-muted-foreground" />
              Admin dashboard
            </Link>
          )}
          <a href="/galaxy/" role="menuitem" onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-muted transition-colors">
            <Globe className="h-4 w-4 text-muted-foreground" />
            Galaxy portal
          </a>
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

// ── SiteHeaderB ───────────────────────────────────────────────────────────────

export function SiteHeaderB() {
  const [location, navigate] = useLocation();
  const { isSignedIn, user, signOut } = useAuth();
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // ── Search state (mirrors main header) ──────────────────────────────────────
  const [searchOpen, setSearchOpen]       = useState(false);
  const [searchQuery, setSearchQuery]     = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchTotal, setSearchTotal]     = useState<number | null>(null);
  const [searchId, setSearchId]           = useState<string | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchAbortRef = useRef<AbortController | null>(null);
  const [isMacPlatform, setIsMacPlatform] = useState(false);

  useEffect(() => {
    const platform =
      (navigator as Navigator & { userAgentData?: { platform?: string } })
        .userAgentData?.platform ?? navigator.platform ?? "";
    setIsMacPlatform(/Mac|iPhone|iPad|iPod/i.test(platform));
  }, []);

  useEffect(() => {
    const handler = () => setIsScrolled(window.scrollY > 20);
    handler();
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  useEffect(() => { setMobileMenuOpen(false); }, [location]);

  // ⌘K / Ctrl-K / "/" search shortcut
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMeta = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      const isSlash =
        e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement) &&
        !(e.target as HTMLElement | null)?.isContentEditable;
      if (isMeta || isSlash) { e.preventDefault(); setSearchOpen(v => !v); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Debounced search-as-you-type
  useEffect(() => {
    if (!searchOpen) return;
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]); setSearchTotal(null); setSearchId(null); setSearchLoading(false);
      return;
    }
    const handle = window.setTimeout(() => {
      searchAbortRef.current?.abort();
      const ctrl = new AbortController();
      searchAbortRef.current = ctrl;
      setSearchLoading(true);
      fetchSearch({ q, limit: DIALOG_RESULT_LIMIT, signal: ctrl.signal })
        .then(res => {
          if (ctrl.signal.aborted) return;
          setSearchResults(res.items); setSearchTotal(res.totalCount); setSearchId(res.searchId);
        })
        .catch((err: unknown) => {
          if ((err as { name?: string })?.name === "AbortError") return;
          setSearchResults([]); setSearchTotal(null);
        })
        .finally(() => { if (!ctrl.signal.aborted) setSearchLoading(false); });
    }, 150);
    return () => window.clearTimeout(handle);
  }, [searchQuery, searchOpen]);

  useEffect(() => {
    if (!searchOpen) {
      setSearchQuery(""); setSearchResults([]); setSearchTotal(null); setSearchId(null);
      searchAbortRef.current?.abort();
    }
  }, [searchOpen]);

  function selectResult(result: SearchResult, idx: number) {
    if (searchId) {
      void reportSearchClick({ searchId, clickedKind: result.kind, clickedRank: idx, clickedSlug: result.slug });
    }
    setSearchOpen(false);
    navigate(result.url);
  }

  function goToFullSearch() {
    const q = searchQuery.trim();
    setSearchOpen(false);
    navigate(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
  }

  function handleMobileSearchSubmit(e: FormEvent) {
    e.preventDefault();
    const q = searchQuery.trim();
    setMobileMenuOpen(false);
    setSearchQuery("");
    navigate(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
  }

  const groupedResults = (() => {
    const groups: Record<SearchKind, Array<{ result: SearchResult; index: number }>> = {
      post: [], case_study: [], white_paper: [], service: [], solution: [],
      faq: [], polaris_episode: [], application: [], model: [],
    };
    searchResults.forEach((r, i) => { groups[r.kind].push({ result: r, index: i }); });
    return groups;
  })();

  const isActive = (href: string) => location === href || location.startsWith(href + "/");
  const shortcutMod = isMacPlatform ? "⌘" : "Ctrl";
  const shortcutAria = isMacPlatform ? "Command+K" : "Control+K";

  return (
    <>
      {/* ── Main bar ───────────────────────────────────────────────────────── */}
      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 border-b ${
          isScrolled
            ? "bg-background/90 backdrop-blur-md border-border/50 shadow-md"
            : "bg-transparent border-transparent"
        }`}
      >
        <div className="container mx-auto px-4 md:px-6 h-16 flex items-center gap-3">

          {/* ── Left: App Switcher + Color Logo ─────────────────────────── */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <SynozurAppSwitcher currentApp="synozur" forceDark />
            <Link href="/" className="flex items-center transition-opacity hover:opacity-80">
              <img
                src={LOGO_COLOR_URL}
                alt="The Synozur Alliance"
                width={154}
                height={42}
                className="h-8 w-auto max-w-full"
              />
            </Link>
          </div>

          {/* ── Center: Primary nav (desktop) ────────────────────────────── */}
          <nav className="hidden lg:flex items-center gap-1 flex-1 justify-center">
            {PRIMARY_NAV.map(link => (
              <Link
                key={link.name}
                href={link.href}
                className={`px-4 py-2 rounded-md text-sm font-semibold transition-colors ${
                  isActive(link.href)
                    ? "text-primary bg-primary/10"
                    : "text-foreground/75 hover:text-foreground hover:bg-white/8"
                }`}
              >
                {link.name}
              </Link>
            ))}

            <Link
              href={BOOK_HREF}
              className={`ml-2 h-9 px-5 inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground text-sm font-semibold transition-colors hover:bg-primary/90 shadow-[0_0_16px_rgba(129,15,251,0.35)] ${
                isActive(BOOK_HREF) ? "ring-2 ring-primary/40 ring-offset-2 ring-offset-background" : ""
              }`}
            >
              Book
            </Link>
          </nav>

          {/* ── Right: chrome controls ───────────────────────────────────── */}
          <div className="ml-auto lg:ml-0 flex items-center gap-1.5">
            {/* Search */}
            <button
              type="button"
              aria-label={`Open search (${shortcutAria})`}
              onClick={() => setSearchOpen(true)}
              data-testid="header-search-button"
              className="hidden lg:inline-flex h-9 items-center gap-2 rounded-md border border-white/20 bg-white/5 px-3 text-sm text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            >
              <Search className="h-4 w-4" />
              <span className="hidden xl:inline">Search…</span>
              <kbd className="hidden xl:inline-flex h-5 select-none items-center gap-0.5 rounded border border-white/15 bg-white/5 px-1.5 font-mono text-[10px] text-white/40">
                {shortcutMod}K
              </kbd>
            </button>

            {/* Theme toggle */}
            <ThemeToggle />

            {/* Galaxy Portal (signed-in only) */}
            {isSignedIn && (
              <a
                href="/galaxy/"
                className="hidden lg:inline-flex items-center gap-1.5 h-9 rounded-md border border-primary/40 bg-primary/10 px-3 text-sm font-medium text-primary hover:bg-primary/20 transition-colors"
              >
                <Globe className="h-3.5 w-3.5" />
                Galaxy
              </a>
            )}

            {/* User / Sign in */}
            {isSignedIn && user ? (
              <UserButton user={user} signOut={signOut} />
            ) : (
              <Link
                href="/sign-in"
                className="hidden lg:inline-flex h-9 items-center justify-center rounded-md border border-white/20 bg-white/5 px-4 text-sm font-medium text-white/80 hover:text-white hover:bg-white/10 transition-colors"
              >
                Sign in
              </Link>
            )}

            {/* Mobile hamburger */}
            <button
              type="button"
              aria-label={mobileMenuOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={mobileMenuOpen}
              onClick={() => setMobileMenuOpen(v => !v)}
              className="lg:hidden p-2 text-white/70 hover:text-white transition-colors"
            >
              {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>

        {/* ── Secondary nav sub-bar (desktop, fades on scroll) ─────────────── */}
        <div
          className={`hidden lg:block border-t transition-all duration-300 ${
            isScrolled
              ? "border-transparent opacity-0 pointer-events-none h-0 overflow-hidden"
              : "border-white/8 opacity-100"
          }`}
        >
          <div className="container mx-auto px-4 md:px-6 h-9 flex items-center justify-center gap-8">
            {SECONDARY_NAV.map(link => (
              <Link
                key={link.name}
                href={link.href}
                className={`text-xs font-medium tracking-wide transition-colors ${
                  isActive(link.href)
                    ? "text-white/90"
                    : "text-white/40 hover:text-white/70"
                }`}
              >
                {link.name}
              </Link>
            ))}
          </div>
        </div>

        {/* ── Mobile nav drawer ────────────────────────────────────────────── */}
        {mobileMenuOpen && (
          <nav
            id="mobile-nav-b"
            className="lg:hidden border-t border-border/50 bg-background/95 backdrop-blur-md"
          >
            <div className="container mx-auto px-4 py-4 space-y-1">
              {/* Mobile search */}
              <form onSubmit={handleMobileSearchSubmit} className="mb-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <input
                    type="search"
                    placeholder="Search…"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full h-10 pl-9 pr-4 rounded-md border border-border bg-muted/50 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </form>

              {/* Primary */}
              {PRIMARY_NAV.map(link => (
                <Link
                  key={link.name}
                  href={link.href}
                  className={`block px-3 py-2.5 rounded-md text-sm font-semibold transition-colors ${
                    isActive(link.href) ? "text-primary bg-primary/10" : "text-foreground/80 hover:text-foreground hover:bg-muted"
                  }`}
                >
                  {link.name}
                </Link>
              ))}

              <Link
                href={BOOK_HREF}
                className="block px-3 py-2.5 rounded-md text-sm font-semibold text-center bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Book the Sprint
              </Link>

              {/* Secondary */}
              <div className="pt-3 mt-3 border-t border-border/50 space-y-1">
                <p className="px-3 pb-1 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                  More
                </p>
                {SECONDARY_NAV.map(link => (
                  <Link
                    key={link.name}
                    href={link.href}
                    className="block px-3 py-2 rounded-md text-sm text-foreground/55 hover:text-foreground/90 hover:bg-muted transition-colors"
                  >
                    {link.name}
                  </Link>
                ))}
              </div>

              {/* Auth */}
              {!isSignedIn && (
                <div className="pt-3 border-t border-border/50">
                  <Link
                    href="/sign-in"
                    className="block px-3 py-2.5 text-sm text-center rounded-md border border-border text-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
                  >
                    Sign in
                  </Link>
                </div>
              )}
            </div>
          </nav>
        )}
      </header>

      {/* ── Cmd-K Search Dialog ──────────────────────────────────────────────── */}
      <CommandDialog open={searchOpen} onOpenChange={setSearchOpen}>
        <CommandInput
          placeholder="Search insights, services, events…"
          value={searchQuery}
          onValueChange={setSearchQuery}
        />
        <CommandList>
          {searchLoading && (
            <div className="py-6 text-center text-sm text-muted-foreground">Searching…</div>
          )}
          {!searchLoading && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
            <CommandEmpty>No results for &ldquo;{searchQuery}&rdquo;</CommandEmpty>
          )}
          {!searchLoading && searchQuery.trim().length < 2 && (
            <CommandEmpty>Start typing to search…</CommandEmpty>
          )}
          {SEARCH_KINDS.filter(kind => groupedResults[kind].length > 0).map(kind => (
            <CommandGroup key={kind} heading={KIND_LABELS[kind]}>
              {groupedResults[kind].map(({ result, index }) => (
                <CommandItem
                  key={result.slug}
                  value={`${result.kind}-${result.slug}`}
                  onSelect={() => selectResult(result, index)}
                >
                  <span className="truncate">{result.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
          {searchTotal !== null && searchTotal > DIALOG_RESULT_LIMIT && (
            <CommandGroup>
              <CommandItem onSelect={goToFullSearch}>
                <Search className="h-4 w-4 mr-2 text-muted-foreground" />
                See all {searchTotal} results for &ldquo;{searchQuery}&rdquo;
              </CommandItem>
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
