import { useEffect, useState, useRef, FormEvent } from "react";
import { Link, useLocation } from "wouter";
import {
  Menu, X, Search, LogOut, LayoutDashboard, ChevronDown,
  Newspaper, CalendarDays, Mic, MonitorPlay, Wrench, Boxes, FileText, Library,
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

const MAIN_NAV = [
  { name: "Home",       href: "/" },
  { name: "The Sprint", href: "/sprint" },
  { name: "Proof",      href: "/proof"  },
  { name: "Fit",        href: "/fit"    },
  { name: "Method",     href: "/services-overview/default" },
  { name: "About",      href: "/about"  },
];

const RESOURCES_HUB = [
  { icon: Newspaper,    label: "Insights Blog",    desc: "Our blog — articles & analysis", href: "/insights"  },
  { icon: CalendarDays, label: "Events",           desc: "Upcoming & past",           href: "/events"    },
  { icon: Mic,          label: "Polaris Podcast",  desc: "Episodes & shownotes",      href: "/polaris"   },
  { icon: MonitorPlay,  label: "Webinars",         desc: "On-demand sessions",        href: "/webinars"  },
  { icon: Wrench,       label: "Workshops",        desc: "Hands-on programs",         href: "/workshops" },
  { icon: Boxes,        label: "Models",           desc: "Frameworks & tools",        href: "/models"    },
  { icon: FileText,     label: "Case Studies",     desc: "Client outcomes",           href: "/case-studies" },
  { icon: Library,      label: "Browse Library",   desc: "Everything, filterable",    href: "/library"   },
];

const BOOK_HREF = "/book";
const RESOURCES_HUB_HREF = "/resources";
const DIALOG_RESULT_LIMIT = 15;

// Most pages render a dark PageHero (bg-[#0B0B1A]) at the very top regardless of
// theme, so the transparent header uses WHITE text there and the hero supplies
// its own top padding to clear the fixed header. A handful of utility pages
// (auth, search, item/careers detail) instead start with a light bg-background
// surface and no hero padding — over those, the unscrolled header must use
// theme-foreground text (legible in light mode) and the Layout must reserve top
// space so the fixed header doesn't overlap their content.
export const LIGHT_TOP_PREFIXES = [
  "/sign-in", "/sign-up", "/verify-email", "/pending-approval",
  "/forgot-password", "/reset-password", "/search",
  "/items/", "/careers/applied", "/careers/general-application", "/careers/jobs",
];

export function isLightTopRoute(pathname: string): boolean {
  return LIGHT_TOP_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

// ── UserButton ────────────────────────────────────────────────────────────────

function UserButton({ user, signOut, onDark }: { user: AuthedUser; signOut: () => Promise<void>; onDark: boolean }) {
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
        className={`flex items-center gap-2 rounded-lg px-2 py-1 transition-colors text-sm ${onDark ? "hover:bg-white/10" : "hover:bg-foreground/10"}`}
      >
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt={shortName} className="h-6 w-6 rounded-full object-cover flex-shrink-0" />
        ) : (
          <span className="h-6 w-6 rounded-full bg-primary flex items-center justify-center text-[10px] font-bold text-primary-foreground flex-shrink-0">
            {initial}
          </span>
        )}
        <span className={`hidden sm:block font-medium truncate max-w-[80px] text-xs ${onDark ? "text-white/80" : "text-foreground/80"}`}>{shortName}</span>
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

// ── ResourcesDropdown ─────────────────────────────────────────────────────────

function ResourcesDropdown({ overDark, isActive }: { overDark: boolean; isActive: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, []);

  const navIdle = "text-white/75 hover:text-white hover:bg-white/10";
  const navScrolled = "text-foreground/75 hover:text-foreground hover:bg-foreground/10";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-1 px-4 py-2 rounded-md text-sm font-semibold transition-colors ${
          isActive
            ? "text-primary bg-primary/10"
            : overDark ? navIdle : navScrolled
        }`}
      >
        Resources
        <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className={`absolute left-1/2 -translate-x-1/2 top-full mt-2 w-[600px] rounded-xl border shadow-2xl z-50 p-4 grid grid-cols-2 gap-1 ${
          overDark ? "bg-[#14142a] border-white/10" : "bg-popover border-border"
        }`}>
          {RESOURCES_HUB.map(({ icon: Icon, label, desc, href }) => (
            <Link
              key={label}
              href={href}
              onClick={() => setOpen(false)}
              className={`flex items-start gap-3 rounded-lg p-2.5 transition-colors ${
                overDark ? "hover:bg-white/5" : "hover:bg-muted"
              }`}
            >
              <Icon className="h-4 w-4 mt-0.5 text-primary flex-shrink-0" />
              <span>
                <span className={`block text-sm font-medium ${overDark ? "text-white/90" : "text-foreground"}`}>{label}</span>
                <span className={`block text-xs ${overDark ? "text-white/40" : "text-muted-foreground"}`}>{desc}</span>
              </span>
            </Link>
          ))}
          <Link
            href={RESOURCES_HUB_HREF}
            onClick={() => setOpen(false)}
            className={`col-span-2 mt-1 pt-2.5 border-t text-center text-xs font-semibold transition-colors ${
              overDark ? "border-white/10 text-primary hover:text-primary/80" : "border-border text-primary hover:text-primary/80"
            }`}
          >
            Visit the Resources hub →
          </Link>
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
  const [mobileResourcesOpen, setMobileResourcesOpen] = useState(false);

  // ── Search state ─────────────────────────────────────────────────────────────
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
  const isResourcesActive = RESOURCES_HUB.some(r => isActive(r.href)) || isActive(RESOURCES_HUB_HREF);
  const shortcutMod = isMacPlatform ? "⌘" : "Ctrl";

  // Utility pages start on a light surface; over those, use foreground tokens.
  const topOnDark = !isLightTopRoute(location);
  // White (over-dark) treatment applies only at the top of a dark-hero page.
  const overDark = topOnDark && !isScrolled;

  const utilityText = overDark
    ? "text-white/60 hover:text-white"
    : "text-foreground/60 hover:text-foreground";
  const controlIdle =
    "border-white/20 bg-white/5 text-white/80 hover:text-white hover:bg-white/10";
  const controlScrolled =
    "border-border bg-foreground/5 text-muted-foreground hover:text-foreground hover:bg-foreground/10";

  return (
    <>
      {/* ── Utility strip (collapses on scroll) ─────────────────────────────── */}
      <div
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          isScrolled
            ? "opacity-0 pointer-events-none h-0 overflow-hidden"
            : topOnDark ? "border-b border-white/10" : "border-b border-border"
        }`}
        aria-hidden={isScrolled}
      >
        <div className={`${topOnDark ? "bg-transparent" : "bg-background/80 backdrop-blur-sm"}`}>
          <div className="container mx-auto px-4 md:px-6 h-8 flex items-center justify-end gap-4">
            {/* Search */}
            <button
              type="button"
              aria-label={`Open search (${isMacPlatform ? "⌘K" : "Ctrl+K"})`}
              onClick={() => setSearchOpen(true)}
              data-testid="header-search-button"
              className={`hidden lg:inline-flex items-center gap-1.5 text-xs transition-colors ${utilityText}`}
            >
              <Search className="h-3.5 w-3.5" />
              Search
              <kbd className={`inline-flex h-4 items-center rounded border px-1 font-mono text-[9px] ${
                overDark ? "border-white/15 text-white/40" : "border-border text-muted-foreground"
              }`}>
                {shortcutMod}K
              </kbd>
            </button>

            {/* Theme toggle */}
            <ThemeToggle />

            {/* Sign in / user */}
            {isSignedIn && user ? (
              <UserButton user={user} signOut={signOut} onDark={overDark} />
            ) : (
              <Link
                href="/sign-in"
                className={`hidden lg:inline-flex items-center text-xs font-medium transition-colors ${utilityText}`}
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* ── Main bar ───────────────────────────────────────────────────────── */}
      <header
        className={`fixed left-0 right-0 z-50 transition-all duration-300 border-b ${
          isScrolled
            ? "top-0 bg-background/90 backdrop-blur-md border-border/50 shadow-md"
            : "top-8 bg-transparent border-transparent"
        }`}
      >
        <div className="container mx-auto px-4 md:px-6 h-16 flex items-center gap-3">

          {/* ── Left: App Switcher + Color Logo ─────────────────────────── */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <SynozurAppSwitcher currentApp="synozur" forceDark />
            <Link href="/" className="flex items-center transition-opacity hover:opacity-80">
              {location === "/" ? (
                <img
                  src="/icon-192.png"
                  alt="The Synozur Alliance"
                  width={42}
                  height={42}
                  className="h-8 w-8"
                />
              ) : (
                <img
                  src={LOGO_COLOR_URL}
                  alt="The Synozur Alliance"
                  width={154}
                  height={42}
                  className="h-8 w-auto max-w-full"
                />
              )}
            </Link>
          </div>

          {/* ── Center: merged nav (desktop) ─────────────────────────────── */}
          <nav className="hidden lg:flex items-center gap-1 flex-1 justify-center">
            {MAIN_NAV.map(link => (
              <Link
                key={link.name}
                href={link.href}
                className={`px-4 py-2 rounded-md text-sm font-semibold transition-colors ${
                  isActive(link.href)
                    ? "text-primary bg-primary/10"
                    : overDark
                      ? "text-white/75 hover:text-white hover:bg-white/10"
                      : "text-foreground/75 hover:text-foreground hover:bg-foreground/10"
                }`}
              >
                {link.name}
              </Link>
            ))}

            {/* Resources dropdown */}
            <ResourcesDropdown overDark={overDark} isActive={isResourcesActive} />
          </nav>

          {/* ── Right: Book CTA + mobile hamburger ───────────────────────── */}
          <div className="ml-auto lg:ml-0 flex items-center gap-2">
            <Link
              href={BOOK_HREF}
              className={`hidden lg:inline-flex h-9 px-5 items-center justify-center rounded-md bg-primary text-primary-foreground text-sm font-semibold transition-colors hover:bg-primary/90 shadow-[0_0_16px_rgba(129,15,251,0.35)] ${
                isActive(BOOK_HREF) ? "ring-2 ring-primary/40 ring-offset-2 ring-offset-background" : ""
              }`}
            >
              Book
            </Link>

            {/* Mobile hamburger */}
            <button
              type="button"
              aria-label={mobileMenuOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={mobileMenuOpen}
              onClick={() => setMobileMenuOpen(v => !v)}
              className={`lg:hidden p-2 transition-colors ${overDark ? "text-white/70 hover:text-white" : "text-foreground/70 hover:text-foreground"}`}
            >
              {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
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

              {/* Primary nav links */}
              {MAIN_NAV.map(link => (
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

              {/* Resources group */}
              <div className="pt-3 mt-3 border-t border-border/50">
                <button
                  type="button"
                  onClick={() => setMobileResourcesOpen(v => !v)}
                  className="flex items-center justify-between w-full px-3 pb-2 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold"
                >
                  Resources
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${mobileResourcesOpen ? "rotate-180" : ""}`} />
                </button>
                {mobileResourcesOpen && (
                  <div className="grid grid-cols-2 gap-1">
                    {RESOURCES_HUB.map(({ icon: Icon, label, href }) => (
                      <Link
                        key={label}
                        href={href}
                        className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
                      >
                        <Icon className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                        {label}
                      </Link>
                    ))}
                    <Link
                      href={RESOURCES_HUB_HREF}
                      className="col-span-2 px-3 py-2 text-sm font-semibold text-primary hover:text-primary/80 transition-colors"
                    >
                      Visit the Resources hub →
                    </Link>
                  </div>
                )}
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
