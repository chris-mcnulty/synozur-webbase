import { Link, useLocation } from "wouter";
import { Menu, X, Search, LayoutDashboard, LogOut, Loader2 } from "lucide-react";
import { useState, useRef, useEffect, useCallback, FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
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
  LOGO_COLOR_URL,
  STATIC_SERVICE_PILLARS,
  STATIC_APPLICATIONS,
  STATIC_NAV_GROUPS_BASE,
  buildServicesGroup,
  buildApplicationsNestedSection,
  type NavLink,
  type NavGroup,
  type NavService,
  type NavApplication,
  type NestedSection,
} from "@workspace/synozur-nav";

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

// Lifecycle-stage navigation. Each entry maps to a customer-journey stage that
// composes the relevant app surfaces. Per-app deep links (/projects, /reports,
// /workspaces, etc.) still resolve, but they are reached *through* the stage
// pages rather than being top-level entries of their own.
const PORTAL_NAV: { href: string; label: string }[] = [
  { href: "/", label: "Home" },
  { href: "/assess", label: "Assess" },
  { href: "/define", label: "Define" },
  { href: "/deliver", label: "Deliver" },
  { href: "/outcomes", label: "Outcomes" },
  { href: "/resources", label: "Resources" },
];

function isExternal(href: string) {
  return /^https?:\/\//.test(href);
}

function NavDropdown({ group }: { group: NavGroup }) {
  const [open, setOpen] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const enter = useCallback(() => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    setOpen(true);
  }, []);

  const leave = useCallback(() => {
    leaveTimer.current = setTimeout(() => setOpen(false), 120);
  }, []);

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- hover wrapper around a real button; keyboard users open the dropdown via the button's focus/click.
    <div className="relative" onMouseEnter={enter} onMouseLeave={leave}>
      <button
        className="text-[17px] font-medium transition-colors py-2 text-muted-foreground hover:text-[#E60CB3] dark:hover:text-foreground"
        aria-haspopup="true"
        aria-expanded={open}
      >
        {group.title}
      </button>
      {open && (
        <div className="absolute left-0 top-full pt-2 z-50">
          <div className={`bg-popover border border-border rounded-md shadow-md p-4 flex flex-col gap-2 ${group.nested && group.nested.length > 0 ? "w-[28rem]" : "w-64"}`}>
            {group.links.map((link: NavLink) => (
              <SiteNavLink
                key={link.label}
                link={link}
                className="text-[17px] text-popover-foreground/80 hover:text-[#E60CB3] dark:hover:text-primary hover:bg-muted/50 px-3 py-2 rounded-md transition-colors"
              />
            ))}
            {group.nested && group.nested.length > 0 && (
              <div className="border-t border-border/60 pt-3 mt-1 flex flex-col gap-3">
                {group.nested.map((section: NestedSection) => (
                  <div key={section.label}>
                    {section.sectionTitle && (
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-3 pb-1">
                        {section.sectionTitle}
                      </p>
                    )}
                    <a href={section.href} className="block text-[17px] font-semibold px-3 py-1 rounded-md transition-colors hover:text-[#E60CB3] dark:hover:text-primary text-popover-foreground">
                      {section.label}
                    </a>
                    {section.children.length > 0 && (
                      <ul className="pl-3 mt-1 space-y-0.5">
                        {section.children.map((c: NavLink) => (
                          <li key={c.href}>
                            <a href={c.href} className="block text-[14px] px-3 py-1 rounded-md transition-colors hover:text-[#E60CB3] dark:hover:text-primary hover:bg-muted/40 text-popover-foreground/70">
                              {c.label}
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SiteNavLink({ link, className }: { link: NavLink; className: string }) {
  if (isExternal(link.href)) {
    return (
      <a href={link.href} target="_blank" rel="noopener noreferrer" className={className}>
        {link.label}
      </a>
    );
  }
  return <a href={link.href} className={className}>{link.label}</a>;
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
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted transition-colors text-sm"
      >
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt={shortName} className="h-7 w-7 rounded-full object-cover flex-shrink-0" />
        ) : (
          <span className="h-7 w-7 rounded-full bg-primary flex items-center justify-center text-xs font-bold text-primary-foreground flex-shrink-0">
            {initial}
          </span>
        )}
        <span className="hidden sm:block font-medium truncate max-w-[100px]">{shortName}</span>
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

  const servicesQuery = useQuery({
    queryKey: ["galaxy-nav-services"],
    queryFn: async () => {
      const res = await fetch("/api/services");
      if (!res.ok) return { items: [] as NavService[] };
      return res.json() as Promise<{ items: NavService[] }>;
    },
    staleTime: 5 * 60 * 1000,
  });

  const applicationsQuery = useQuery({
    queryKey: ["galaxy-nav-applications"],
    queryFn: async () => {
      const res = await fetch("/api/applications?active=true");
      if (!res.ok) return { items: [] as NavApplication[] };
      return res.json() as Promise<{ items: NavApplication[] }>;
    },
    staleTime: 5 * 60 * 1000,
  });

  const apiServiceItems = servicesQuery.data?.items;
  const pillars: NavService[] = apiServiceItems && apiServiceItems.length > 0
    ? apiServiceItems.filter((s) => s.slug !== "our-services")
    : STATIC_SERVICE_PILLARS;

  const apiAppItems = applicationsQuery.data?.items;
  const navApps: NavApplication[] = apiAppItems && apiAppItems.length > 0
    ? apiAppItems
    : STATIC_APPLICATIONS;

  const navGroups: NavGroup[] = [
    STATIC_NAV_GROUPS_BASE.ourStory,
    buildServicesGroup(pillars),
    STATIC_NAV_GROUPS_BASE.theFeed,
    {
      ...STATIC_NAV_GROUPS_BASE.resources,
      nested: [buildApplicationsNestedSection(navApps)],
    },
    {
      title: "Portal",
      links: [
        { label: "Home", href: "/galaxy/" },
        { label: "Assess", href: "/galaxy/assess" },
        { label: "Define", href: "/galaxy/define" },
        { label: "Deliver", href: "/galaxy/deliver" },
        { label: "Outcomes", href: "/galaxy/outcomes" },
        { label: "Resources", href: "/galaxy/resources" },
      ],
    },
  ];

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

  return (
    <div className="sticky top-0 z-50 w-full">
      {/* ── Main Synozur navigation bar ── */}
      <header className="w-full border-b border-border/40 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 h-20 flex items-center gap-3">

          <SynozurAppSwitcher currentApp="galaxy" />

          {/* Logo — links to main Synozur site */}
          <a href="/" className="flex items-center gap-2 transition-opacity hover:opacity-80 flex-shrink-0" aria-label="The Synozur Alliance — main site">
            <img src={LOGO_COLOR_URL} alt="The Synozur Alliance Logo" className="h-10 w-auto" />
          </a>

          {/* Desktop nav */}
          <nav className="hidden lg:flex items-center gap-8 flex-1 justify-center">
            <a href="/" className="text-[17px] font-medium text-muted-foreground hover:text-[#E60CB3] dark:hover:text-foreground transition-colors py-2">
              Home
            </a>
            {navGroups.map((group) => (
              <NavDropdown key={group.title} group={group} />
            ))}
          </nav>

          {/* Right-side controls */}
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden lg:flex items-center">
              <button
                type="button"
                aria-label="Open search (⌘K)"
                onClick={() => setSearchOpen(true)}
                data-testid="header-search-button"
                className="h-9 inline-flex items-center gap-2 rounded-md border border-border/60 px-3 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <Search className="h-4 w-4" />
                <span className="hidden xl:inline">Search…</span>
                <kbd className="hidden xl:inline-flex h-5 select-none items-center gap-1 rounded border border-border/50 bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                  <span className="text-xs">⌘</span>K
                </kbd>
              </button>
            </div>
            <ThemeToggle />
            {user ? <UserButton user={user} signOut={signOut} /> : null}
            {/* Mobile hamburger — right side, standard position */}
            <button
              className="lg:hidden p-2 text-foreground flex-shrink-0"
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
          <div className="lg:hidden absolute top-full left-0 w-full h-[calc(100vh-5rem)] bg-background border-t border-border overflow-y-auto z-40">
            <div className="p-6 flex flex-col gap-6">
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

              {/* Home link — back to main Synozur site */}
              <div className="flex flex-col gap-2">
                <a href="/" className="font-semibold text-foreground hover:text-primary text-sm py-1">
                  Home
                </a>
              </div>

              {/* Site nav groups — skip "Portal" since the Galaxy Portal section below handles it */}
              {navGroups.filter((g) => g.title !== "Portal").map((group) => (
                <div key={group.title} className="flex flex-col gap-3">
                  <h3 className="font-semibold text-foreground">{group.title}</h3>
                  <div className="flex flex-col gap-2 pl-4 border-l border-border/50">
                    {group.links.map((link: NavLink) => (
                      <SiteNavLink key={link.label} link={link} className="text-muted-foreground hover:text-primary py-1 text-sm" />
                    ))}
                    {group.nested?.map((section: NestedSection) => (
                      <div key={section.label} className="mt-2">
                        {section.sectionTitle && (
                          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pb-1">{section.sectionTitle}</p>
                        )}
                        <a href={section.href} className="block font-medium text-foreground/90 hover:text-primary py-1 text-sm">
                          {section.label}
                        </a>
                        {section.children.length > 0 && (
                          <ul className="pl-4 border-l border-border/40 ml-1 mt-1 space-y-1">
                            {section.children.map((c: NavLink) => (
                              <li key={c.href}>
                                <a href={c.href} className="block text-sm text-muted-foreground hover:text-primary py-0.5">{c.label}</a>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* Galaxy Portal section — always last in mobile menu */}
              {!hidePortalNav && (
                <div className="flex flex-col gap-3 pt-2 border-t border-border/50">
                  <h3 className="font-semibold text-foreground">Galaxy Portal</h3>
                  <div className="flex flex-col gap-2 pl-4 border-l border-border/50">
                    {PORTAL_NAV.map((n) => {
                      const active = n.href === "/" ? location === "/" : location === n.href || location.startsWith(`${n.href}/`);
                      return (
                        <Link key={n.href} href={n.href}
                          className={`py-1 text-sm ${active ? "text-[#E60CB3] font-semibold" : "text-muted-foreground hover:text-primary"}`}
                          onClick={() => setMobileMenuOpen(false)}>
                          {n.label}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}

              {user && (
                <div className="pt-6 mt-2 border-t border-border">
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
        <div className="container mx-auto px-4 h-10 flex items-center gap-1">
          <span className="text-xs text-muted-foreground font-medium mr-3 hidden sm:inline">Galaxy Portal</span>
          <div className="flex items-center gap-1">
            {PORTAL_NAV.map((n) => {
              const active = n.href === "/" ? location === "/" : location === n.href || location.startsWith(`${n.href}/`);
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
