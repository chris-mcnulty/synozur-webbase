import { Link, useLocation } from "wouter";
import { Menu, X, ArrowRight, Search, LayoutDashboard, LogOut } from "lucide-react";
import { useState, useRef, useEffect, FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { getActiveApplications } from "@/data/applications";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { SynozurAppSwitcher } from "@/components/synozur-app-switcher";
import { useAuth, type AuthedUser } from "@/context/auth";

type NavLink = { label: string; href: string };
type NestedSection = { sectionTitle?: string; label: string; href: string; children: NavLink[] };
type NavGroup = { title: string; links: NavLink[]; nested?: NestedSection[] };

const LOGO_COLOR_URL = "https://static.wixstatic.com/media/b805ce_7a5d9f47e6df42c6a2dab307ce8c4cf3~mv2.png/v1/fill/w_231,h_63,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/SA-Logo-Horizontal-color.png";
const BASE_PATH_HEADER = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
const MARK_URL = `${BASE_PATH_HEADER}/images/synozur-mark-color.png`;

type NavService = { title: string; slug: string; solutions: { title: string; slug: string }[] };

const STATIC_SERVICE_PILLARS: NavService[] = [
  {
    title: "Organizational Transformation",
    slug: "strategic-transformation",
    solutions: [
      { title: "Company OS", slug: "company-os" },
      { title: "Fractional Leadership", slug: "fractional-leadership" },
      { title: "Delivery Management", slug: "delivery-management" },
    ],
  },
  {
    title: "Technology Transformation",
    slug: "technology-transformation",
    solutions: [
      { title: "Strategic Roadmaps", slug: "strategic-roadmaps" },
      { title: "AI Strategy and Design", slug: "ai-strategy-and-design" },
      { title: "Employee Effectiveness", slug: "employee-effectiveness" },
      { title: "Microsoft 365 Adoption, Strategy & Optimization", slug: "microsoft-365-optimization" },
    ],
  },
  {
    title: "Experience Transformation",
    slug: "experiences",
    solutions: [
      { title: "Employee Strategies", slug: "employee-strategies" },
      { title: "Communication Strategies", slug: "communication-strategies" },
      { title: "Design Strategies", slug: "design-strategies" },
    ],
  },
  {
    title: "Go-To-Market Transformation",
    slug: "go-to-market-transformation",
    solutions: [
      { title: "Brand and Messaging", slug: "brand-and-messaging" },
      { title: "GTM Strategy and Execution", slug: "gtm-strategy-and-execution" },
      { title: "Microsoft Partner Development", slug: "microsoft-partner-development" },
    ],
  },
];

function isExternal(href: string) {
  return /^https?:\/\//.test(href);
}

function isLinkActive(href: string, location: string): boolean {
  if (href === "/" || href === "") return location === "/" || location === "";
  if (isExternal(href)) return false;
  return location === href || location.startsWith(href + "/");
}

function NavLinkItem({
  link,
  className,
  onClick,
}: {
  link: NavLink;
  className: string;
  onClick?: () => void;
}) {
  const [location] = useLocation();
  const active = isLinkActive(link.href, location);
  const activeClass = active ? " text-[#E60CB3] dark:text-primary font-semibold" : "";

  if (isExternal(link.href)) {
    return (
      <a
        href={link.href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        onClick={onClick}
      >
        {link.label}
      </a>
    );
  }
  return (
    <Link href={link.href} className={`${className}${activeClass}`} onClick={onClick}>
      {link.label}
    </Link>
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
  const hasRole = user.roles.length > 0;

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
          <img
            src={user.avatarUrl}
            alt={shortName}
            className="h-7 w-7 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <span className="h-7 w-7 rounded-full bg-primary flex items-center justify-center text-xs font-bold text-primary-foreground flex-shrink-0">
            {initial}
          </span>
        )}
        <span className="hidden sm:block font-medium truncate max-w-[100px]">{shortName}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-56 bg-popover border border-border rounded-lg shadow-lg z-50 overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-border">
            {user.displayName && (
              <div className="font-medium text-sm truncate">{user.displayName}</div>
            )}
            {user.email && (
              <div className="text-xs text-muted-foreground truncate">{user.email}</div>
            )}
          </div>
          {hasRole && (
            <Link
              href="/admin"
              onClick={() => setOpen(false)}
              role="menuitem"
              className="flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-muted transition-colors"
            >
              <LayoutDashboard className="h-4 w-4 text-muted-foreground" />
              Admin dashboard
            </Link>
          )}
          <button
            role="menuitem"
            onClick={() => { setOpen(false); void signOut(); }}
            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-muted transition-colors text-left"
          >
            <LogOut className="h-4 w-4 text-muted-foreground" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function Header() {
  const [location, navigate] = useLocation();
  const isHome = location === "/" || location === "";
  const { isSignedIn, user, signOut } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  function handleSearchSubmit(e: FormEvent) {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    setSearchOpen(false);
    setSearchQuery("");
    navigate(`/library?q=${encodeURIComponent(q)}`);
  }

  function handleMobileSearchSubmit(e: FormEvent) {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    setMobileMenuOpen(false);
    setSearchQuery("");
    navigate(`/library?q=${encodeURIComponent(q)}`);
  }

  const servicesQuery = useQuery({
    queryKey: ["services"],
    queryFn: () => api.listServices(),
    staleTime: 5 * 60 * 1000,
  });

  const applicationsQuery = useQuery({
    queryKey: ["applications", "nav"],
    queryFn: () => api.listApplications(true),
    staleTime: 5 * 60 * 1000,
  });

  // Used to label the "Home" nav group accurately. Whichever variant the
  // admin promoted to / is shown as "Home"; the non-active one is shown as
  // "Alt Home" pointing at its alternate path.
  const settingsQuery = useQuery({
    queryKey: ["public-site-settings"],
    queryFn: () => api.getPublicSiteSettings(),
    staleTime: 5 * 60 * 1000,
  });
  const activeHomeVariant: "a" | "b" =
    settingsQuery.data?.homeRootVariant === "b" ? "b" : "a";
  const navApplications = (() => {
    const apiItems = applicationsQuery.data?.items ?? [];
    return apiItems.length > 0
      ? apiItems
      : getActiveApplications().map((a) => ({ slug: a.slug, name: a.name }));
  })();

  const apiServiceItems = servicesQuery.data?.items;
  const pillars: NavService[] = apiServiceItems
    ? apiServiceItems.filter((s) => s.slug !== "our-services")
    : STATIC_SERVICE_PILLARS;

  const servicesGroup: NavGroup = {
    title: "Services",
    links: [{ label: "Services Overview", href: "/services-overview/default" }],
    nested: pillars.map((p) => ({
      label: p.title,
      href: `/services/${p.slug}`,
      children: p.solutions.map((s) => ({ label: s.title, href: `/solutions/${s.slug}` })),
    })),
  };

  const navGroups: NavGroup[] = [
    {
      title: "Home",
      links: [
        { label: "Home", href: "/" },
        {
          label: activeHomeVariant === "b" ? "Alt Home (A)" : "Alt Home (B)",
          href: activeHomeVariant === "b" ? "/home-a" : "/home-b",
        },
      ],
    },
    {
      title: "Our Story",
      links: [
        { label: "About", href: "/about" },
        { label: "Team", href: "/team" },
        { label: "Clients", href: "/clients" },
        { label: "Partners", href: "/partners" },
        { label: "Careers", href: "https://careers.synozur.com" },
      ],
    },
    servicesGroup,
    {
      title: "The Feed",
      links: [
        { label: "Insights Blog", href: "/insights" },
        { label: "Polaris Podcast", href: "/polaris" },
        { label: "Events", href: "/events" },
      ],
    },
    {
      title: "Resources",
      links: [
        { label: "Case Studies", href: "/case-studies" },
        { label: "Webinars", href: "/webinars" },
        { label: "White Papers", href: "/white-papers" },
        { label: "Workshops", href: "/workshops" },
        { label: "Models", href: "/models" },
        { label: "FAQ", href: "/faq" },
        { label: "Browse Library", href: "/library" },
      ],
      nested: [
        {
          sectionTitle: "Applications",
          label: "All Applications",
          href: "/applications",
          children: navApplications.map((a) => ({
            label: a.name,
            href: `/applications/${a.slug}`,
          })),
        },
      ],
    },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4 h-20 flex items-center gap-3">

        {/* ── App switcher: left-most on both desktop and mobile (signed-in only) ── */}
        {isSignedIn && <SynozurAppSwitcher currentApp="synozur" />}

        {/* ── Mobile hamburger (only shown when NOT signed-in on mobile, so it stays left-most) ── */}
        {/* On mobile, when signed-in the app switcher is already leftmost */}
        <button
          className={`lg:hidden p-2 text-foreground flex-shrink-0 ${isSignedIn ? "hidden" : ""}`}
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileMenuOpen}
        >
          {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>

        {/* ── Logo ── */}
        <Link href="/" className="flex items-center gap-2 transition-opacity hover:opacity-80 flex-shrink-0">
          {isHome ? (
            <img src={MARK_URL} alt="Synozur Alliance Wayfinder Mark" className="h-10 w-auto" />
          ) : (
            <img src={LOGO_COLOR_URL} alt="The Synozur Alliance Logo" className="h-10 w-auto" />
          )}
        </Link>

        {/* ── Desktop Nav (centered) ── */}
        <nav className="hidden lg:flex items-center gap-8 flex-1 justify-center">
          {navGroups.map((group) => {
            const allGroupLinks: string[] = [
              ...group.links.map((l) => l.href),
              ...(group.nested ?? []).flatMap((s) => [s.href, ...s.children.map((c) => c.href)]),
            ];
            const isGroupActive = allGroupLinks.some((href) => isLinkActive(href, location));
            return (
            <div key={group.title} className="relative group">
              <button
                className={`text-[17px] font-medium transition-colors py-2 ${
                  isGroupActive
                    ? "text-[#E60CB3] dark:text-primary"
                    : "text-muted-foreground hover:text-[#E60CB3] dark:hover:text-foreground"
                }`}
                aria-haspopup="true"
              >
                {group.title}
              </button>
              <div className="absolute left-0 top-full pt-2 opacity-0 translate-y-2 pointer-events-none group-hover:opacity-100 group-hover:translate-y-0 group-hover:pointer-events-auto transition-all duration-200 z-50">
                <div
                  className={`bg-popover border border-border rounded-md shadow-md p-4 flex flex-col gap-2 ${
                    group.nested && group.nested.length > 0 ? "w-[28rem]" : "w-64"
                  }`}
                >
                  {group.links.map((link) => (
                    <NavLinkItem
                      key={link.label}
                      link={link}
                      className="text-[17px] text-popover-foreground/80 hover:text-[#E60CB3] dark:hover:text-primary hover:bg-muted/50 px-3 py-2 rounded-md transition-colors"
                    />
                  ))}
                  {group.nested && group.nested.length > 0 && (
                    <div className="border-t border-border/60 pt-3 mt-1 flex flex-col gap-3">
                      {group.nested.map((section) => (
                        <div key={section.label}>
                          {section.sectionTitle && (
                            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-3 pb-1">
                              {section.sectionTitle}
                            </p>
                          )}
                          <Link
                            href={section.href}
                            className={`block text-[17px] font-semibold px-3 py-1 rounded-md transition-colors hover:text-[#E60CB3] dark:hover:text-primary ${isLinkActive(section.href, location) ? "text-[#E60CB3] dark:text-primary" : "text-popover-foreground"}`}
                          >
                            {section.label}
                          </Link>
                          {section.children.length > 0 && (
                            <ul className="pl-3 mt-1 space-y-0.5">
                              {section.children.map((c) => (
                                <li key={c.href}>
                                  <Link
                                    href={c.href}
                                    className={`block text-[14px] px-3 py-1 rounded-md transition-colors hover:text-[#E60CB3] dark:hover:text-primary hover:bg-muted/40 ${isLinkActive(c.href, location) ? "text-[#E60CB3] dark:text-primary font-semibold" : "text-popover-foreground/70"}`}
                                  >
                                    {c.label}
                                  </Link>
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
            </div>
          ); })}
        </nav>

        {/* ── Right-side controls (desktop + mobile share this group) ── */}
        <div className="ml-auto flex items-center gap-2">

          {/* Desktop expandable search */}
          <div className="hidden lg:flex items-center">
            {searchOpen ? (
              <form onSubmit={handleSearchSubmit} className="flex items-center gap-1">
                <input
                  ref={searchInputRef}
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search library…"
                  aria-label="Search library"
                  className="h-9 w-48 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") { setSearchOpen(false); setSearchQuery(""); }
                  }}
                />
                <button type="submit" aria-label="Submit search" className="h-9 w-9 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                  <Search className="h-4 w-4" />
                </button>
                <button type="button" aria-label="Close search" onClick={() => { setSearchOpen(false); setSearchQuery(""); }} className="h-9 w-9 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </form>
            ) : (
              <button type="button" aria-label="Open search" onClick={() => setSearchOpen(true)} className="h-9 w-9 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                <Search className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Theme toggle */}
          <ThemeToggle />

          {/* User button (signed-in) or Get Started (signed-out) */}
          {isSignedIn && user ? (
            <UserButton user={user} signOut={signOut} />
          ) : (
            <Link
              href="/start"
              className="hidden lg:inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              Get Started
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          )}

          {/* Mobile hamburger (only when signed-in — positioned right after user button) */}
          {isSignedIn && (
            <button
              className="lg:hidden p-2 text-foreground flex-shrink-0"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          )}
        </div>
      </div>

      {/* ── Mobile Nav Drawer ── */}
      {mobileMenuOpen && (
        <div className="lg:hidden absolute top-full left-0 w-full h-[calc(100vh-5rem)] bg-background border-t border-border overflow-y-auto z-40">
          <div className="p-6 flex flex-col gap-6">
            {/* Mobile search */}
            <form onSubmit={handleMobileSearchSubmit} className="flex items-center gap-2">
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search library…"
                aria-label="Search library"
                className="h-10 flex-1 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button type="submit" aria-label="Submit search" className="h-10 w-10 inline-flex items-center justify-center rounded-md bg-muted text-foreground hover:bg-muted/80 transition-colors">
                <Search className="h-4 w-4" />
              </button>
            </form>

            {navGroups.map((group) => (
              <div key={group.title} className="flex flex-col gap-3">
                <h3 className="font-semibold text-foreground">{group.title}</h3>
                <div className="flex flex-col gap-2 pl-4 border-l border-border/50">
                  {group.links.map((link) => (
                    <NavLinkItem
                      key={link.label}
                      link={link}
                      className="text-muted-foreground hover:text-primary py-1"
                      onClick={() => setMobileMenuOpen(false)}
                    />
                  ))}
                  {group.nested?.map((section) => (
                    <div key={section.label} className="mt-2">
                      {section.sectionTitle && (
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pb-1">
                          {section.sectionTitle}
                        </p>
                      )}
                      <Link
                        href={section.href}
                        className="block font-medium text-foreground/90 hover:text-primary py-1"
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        {section.label}
                      </Link>
                      {section.children.length > 0 && (
                        <ul className="pl-4 border-l border-border/40 ml-1 mt-1 space-y-1">
                          {section.children.map((c) => (
                            <li key={c.href}>
                              <Link
                                href={c.href}
                                className="block text-sm text-muted-foreground hover:text-primary py-0.5"
                                onClick={() => setMobileMenuOpen(false)}
                              >
                                {c.label}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <div className="pt-6 mt-6 border-t border-border flex flex-col gap-3">
              {!isSignedIn && (
                <Link
                  href="/start"
                  className="flex w-full h-12 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Get Started
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              )}
              {isSignedIn && user && user.roles.length > 0 && (
                <Link
                  href="/admin"
                  className="flex w-full h-12 items-center justify-center rounded-md border border-border text-sm font-medium hover:bg-muted transition-colors gap-2"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <LayoutDashboard className="h-4 w-4" />
                  Admin Dashboard
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
