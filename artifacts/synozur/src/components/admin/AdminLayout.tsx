import { ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/context/auth";
import { useTheme } from "@/context/theme";
import {
  LayoutDashboard,
  FileText,
  Image as ImageIcon,
  Tags,
  MessageSquare,
  Users,
  CalendarDays,
  UserSquare2,
  Inbox,
  LogOut,
  ChevronRight,
  ChevronDown,
  Compass,
  Layers,
  Library as LibraryIcon,
  LayoutGrid,
  Video as VideoIcon,
  BookOpen as BookOpenIcon,
  CornerDownRight,
  GraduationCap,
  ExternalLink,
  Headphones,
  Briefcase,
  AppWindow,
  HelpCircle,
  PanelTop,
  Network,
  Activity,
  Newspaper,
  Package,
  UsersRound,
  Radio,
  Megaphone,
  LineChart,
  Search,
  FileSearch,
  ShieldCheck,
  Settings,
  Menu,
  X,
  KeyRound,
  UserCog,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAdminAccess } from "@/components/admin/AdminGate";
import { SynozurAppSwitcher } from "@/components/synozur-app-switcher";
import type { Capability } from "@/lib/capabilities";
import { cn } from "@/lib/utils";

type AccessLike = ReturnType<typeof useAdminAccess>["access"];

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  capability?: Capability;
  testId: string;
}

interface NavSection {
  id: string;
  label: string;
  icon: typeof LayoutDashboard;
  items: NavItem[];
}

const TOP_LEVEL: NavItem[] = [
  {
    href: "/",
    label: "Dashboard",
    icon: LayoutDashboard,
    testId: "nav-admin-dashboard",
  },
];

const SECTIONS: NavSection[] = [
  {
    id: "insights",
    label: "Insights",
    icon: Newspaper,
    items: [
      { href: "/insights/posts", label: "Posts", icon: FileText, capability: "content.author", testId: "nav-admin-posts" },
      { href: "/insights/taxonomy", label: "Taxonomy", icon: Tags, capability: "content.author", testId: "nav-admin-taxonomy" },
      { href: "/insights/comments", label: "Comments", icon: MessageSquare, capability: "content.moderate", testId: "nav-admin-comments" },
    ],
  },
  {
    id: "products",
    label: "Products",
    icon: Package,
    items: [
      { href: "/products/services", label: "Services", icon: Compass, capability: "content.publish", testId: "nav-admin-services" },
      { href: "/products/solutions", label: "Solutions", icon: Layers, capability: "content.publish", testId: "nav-admin-solutions" },
      { href: "/products/case-studies", label: "Case Studies", icon: Briefcase, capability: "content.publish", testId: "nav-admin-case-studies" },
      { href: "/products/applications", label: "Applications", icon: AppWindow, capability: "content.publish", testId: "nav-admin-applications" },
      { href: "/products/models", label: "Models", icon: Network, capability: "content.publish", testId: "nav-admin-models" },
      { href: "/products/faq", label: "FAQ", icon: HelpCircle, capability: "content.publish", testId: "nav-admin-faq" },
    ],
  },
  {
    id: "library",
    label: "Library",
    icon: LibraryIcon,
    items: [
      { href: "/library/assets", label: "Assets", icon: ImageIcon, capability: "content.author", testId: "nav-admin-assets" },
      { href: "/library/collateral", label: "Collateral", icon: LibraryIcon, capability: "content.publish", testId: "nav-admin-collateral" },
      { href: "/library/carousel", label: "Carousel", icon: LayoutGrid, capability: "content.publish", testId: "nav-admin-carousel" },
      { href: "/library/videos", label: "Videos", icon: VideoIcon, capability: "content.publish", testId: "nav-admin-videos" },
      { href: "/library/white-papers", label: "White Papers", icon: BookOpenIcon, capability: "content.publish", testId: "nav-admin-white-papers" },
      { href: "/library/workshops", label: "Workshops", icon: GraduationCap, capability: "content.publish", testId: "nav-admin-workshops" },
      { href: "/library/polaris-episodes", label: "Polaris", icon: Headphones, capability: "content.publish", testId: "nav-admin-polaris" },
    ],
  },
  {
    id: "people",
    label: "People",
    icon: UsersRound,
    items: [
      { href: "/people/team-members", label: "Team", icon: UserSquare2, capability: "site.manage", testId: "nav-admin-team" },
      { href: "/people/events", label: "Events", icon: CalendarDays, capability: "site.manage", testId: "nav-admin-events" },
    ],
  },
  {
    id: "audience",
    label: "Audience",
    icon: Radio,
    items: [
      { href: "/audience/submissions", label: "Submissions", icon: Inbox, capability: "site.manage", testId: "nav-admin-submissions" },
    ],
  },
  {
    id: "marketing",
    label: "Marketing",
    icon: Megaphone,
    items: [
      { href: "/marketing/traffic", label: "Traffic", icon: LineChart, capability: "content.moderate", testId: "nav-admin-marketing-traffic" },
      { href: "/marketing/seo", label: "SEO", icon: Search, capability: "content.moderate", testId: "nav-admin-marketing-seo" },
      { href: "/marketing/seo-audit", label: "SEO Audit", icon: FileSearch, capability: "content.moderate", testId: "nav-admin-marketing-seo-audit" },
      { href: "/integrations/hubspot", label: "HubSpot", icon: Network, capability: "site.manage", testId: "nav-admin-hubspot" },
    ],
  },
  {
    id: "access",
    label: "Access",
    icon: ShieldCheck,
    items: [
      { href: "/access/users", label: "Users & Roles", icon: Users, capability: "users.manage", testId: "nav-admin-users" },
      { href: "/access/organizations", label: "Organizations", icon: UsersRound, capability: "users.manage", testId: "nav-admin-organizations" },
      { href: "/access/entra", label: "Entra Mappings", icon: ShieldCheck, capability: "users.manage", testId: "nav-admin-entra" },
      { href: "/access/security-log", label: "Security Log", icon: Activity, capability: "users.manage", testId: "nav-admin-security-log" },
    ],
  },
  {
    id: "site-config",
    label: "Site Config",
    icon: PanelTop,
    items: [
      { href: "/site-config/site-settings", label: "Settings", icon: Settings, capability: "site.manage", testId: "nav-admin-site-settings" },
      { href: "/site-config/list-page-copy", label: "List Page Copy", icon: FileText, capability: "site.manage", testId: "nav-admin-list-page-copy" },
      { href: "/site-config/redirects", label: "Redirects", icon: ExternalLink, capability: "site.manage", testId: "nav-admin-redirects" },
      { href: "/site-config/health", label: "Health", icon: Activity, capability: "site.manage", testId: "nav-admin-site-health" },
    ],
  },
  {
    id: "account",
    label: "Account",
    icon: UserCog,
    items: [
      { href: "/account/sessions", label: "Active Sessions", icon: KeyRound, testId: "nav-admin-account-sessions" },
    ],
  },
];

function itemVisible(item: NavItem, access: AccessLike): boolean {
  if (!item.capability) return true;
  return !!access?.hasCapability(item.capability);
}

function visibleItems(section: NavSection, access: AccessLike): NavItem[] {
  return section.items.filter((i) => itemVisible(i, access));
}

export interface Crumb {
  label: string;
  href?: string;
}

export function AdminLayout({
  children,
  title,
  crumbs,
  actions,
}: {
  children: ReactNode;
  title?: string;
  crumbs?: Crumb[];
  actions?: ReactNode;
}) {
  const [location, navigate] = useLocation();
  const { signOut } = useAuth();
  const { access } = useAdminAccess();
  const { theme } = useTheme();
  const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");

  const isActive = (href: string) => {
    if (href === "/") return location === "/" || location === "";
    return location === href || location.startsWith(`${href}/`);
  };

  const visibleSections = useMemo(
    () =>
      SECTIONS
        .map((s) => ({ section: s, items: visibleItems(s, access) }))
        .filter(({ items }) => items.length > 0),
    [access],
  );

  const activeSectionId = useMemo(() => {
    for (const { section, items } of visibleSections) {
      if (items.some((i) => isActive(i.href))) return section.id;
    }
    return null;
  }, [visibleSections, location]);

  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // Track whether we're at the md breakpoint or above so the drawer's a11y
  // hiding (inert/aria-hidden) only applies on mobile, where the drawer is
  // actually translated off-canvas.
  const [isMdUp, setIsMdUp] = useState<boolean>(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(min-width: 768px)").matches
      : true,
  );

  useEffect(() => {
    if (activeSectionId) {
      setOpenSections((prev) =>
        prev[activeSectionId] ? prev : { ...prev, [activeSectionId]: true },
      );
    }
  }, [activeSectionId]);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location]);

  // Watch the md breakpoint. When the viewport grows past md (e.g. orientation
  // change), force the drawer closed so the body-scroll lock releases and the
  // user can't be stranded with no visible close control.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = (e: MediaQueryListEvent) => {
      setIsMdUp(e.matches);
      if (e.matches) setMobileMenuOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Lock body scroll while the mobile drawer is open. Skip on desktop — the
  // drawer is always "open" (in-flow sidebar) at md+ but should never lock.
  useEffect(() => {
    if (!mobileMenuOpen || isMdUp) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileMenuOpen, isMdUp]);

  // Close the drawer on Escape so keyboard users have a non-pointer dismissal.
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileMenuOpen]);

  // When the drawer is closed on mobile, hide it from a11y/keyboard so its
  // links aren't tab-reachable or announced by screen readers.
  const drawerHidden = !isMdUp && !mobileMenuOpen;

  const toggleSection = (id: string) =>
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <div className={cn("min-h-screen bg-background text-foreground", theme)}>
      {/* Mobile top bar — only visible below md breakpoint. */}
      <div className="md:hidden sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background px-4 py-3">
        <button
          type="button"
          onClick={() => setMobileMenuOpen(true)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md hover-elevate"
          aria-label="Open admin menu"
          aria-expanded={mobileMenuOpen}
          data-testid="button-admin-mobile-menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Link href="/">
          <a className="text-sm" data-testid="link-admin-mobile-home">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              Synozur
            </span>{" "}
            <span className="font-semibold">Admin</span>
          </a>
        </Link>
        <div className="flex items-center gap-1">
          <SynozurAppSwitcher currentApp="synozur" />
          <a
            href={`${baseUrl || ""}/`}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover-elevate"
            aria-label="View website"
            data-testid="link-admin-mobile-view-site"
          >
            <ExternalLink className="h-5 w-5" />
          </a>
        </div>
      </div>

      {/* Backdrop for mobile drawer. */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
          data-testid="admin-mobile-backdrop"
        />
      )}

      <div className="flex">
        <aside
          className={cn(
            "w-60 shrink-0 border-r border-border bg-background flex flex-col",
            // Mobile: slide-in drawer.
            "fixed inset-y-0 left-0 z-50 transition-transform duration-200 ease-out",
            mobileMenuOpen ? "translate-x-0" : "-translate-x-full",
            // Desktop: in-flow sticky sidebar (overrides the mobile classes above).
            "md:translate-x-0 md:sticky md:top-0 md:left-auto md:bottom-auto md:z-auto md:min-h-screen",
          )}
          inert={drawerHidden || undefined}
          aria-hidden={drawerHidden || undefined}
        >
          <div className="p-5 border-b border-border flex items-start justify-between gap-3">
            <Link href="/">
              <a className="block">
                <div className="text-xs uppercase tracking-widest text-muted-foreground">
                  Synozur
                </div>
                <div className="text-lg font-semibold">Admin</div>
              </a>
            </Link>
            <div className="flex items-center gap-1">
              <div className="hidden md:block">
                <SynozurAppSwitcher currentApp="synozur" />
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="md:hidden inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover-elevate"
                aria-label="Close admin menu"
                data-testid="button-admin-mobile-close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          <nav className="flex-1 py-3 overflow-y-auto" data-testid="admin-sidebar">
            {TOP_LEVEL.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link key={item.href} href={item.href}>
                  <a
                    className={cn(
                      "flex items-center gap-3 px-5 py-2.5 text-sm hover-elevate",
                      active
                        ? "text-primary font-medium border-l-2 border-primary bg-primary/5"
                        : "text-muted-foreground border-l-2 border-transparent",
                    )}
                    data-testid={item.testId}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </a>
                </Link>
              );
            })}
            {visibleSections.map(({ section, items }) => {
              const SectionIcon = section.icon;
              const isOpen = openSections[section.id] ?? section.id === activeSectionId;
              const sectionHasActive = section.id === activeSectionId;
              return (
                <div key={section.id} className="mt-1">
                  <button
                    type="button"
                    onClick={() => toggleSection(section.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-5 py-2 text-xs uppercase tracking-wider hover-elevate border-l-2 border-transparent",
                      sectionHasActive ? "text-foreground" : "text-muted-foreground",
                    )}
                    data-testid={`nav-admin-section-${section.id}`}
                    aria-expanded={isOpen}
                  >
                    <SectionIcon className="h-3.5 w-3.5" />
                    <span className="flex-1 text-left">{section.label}</span>
                    {isOpen ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                  </button>
                  {isOpen &&
                    items.map((item) => {
                      const Icon = item.icon;
                      const active = isActive(item.href);
                      return (
                        <Link key={item.href} href={item.href}>
                          <a
                            className={cn(
                              "flex items-center gap-3 pl-10 pr-5 py-2 text-sm hover-elevate",
                              active
                                ? "text-primary font-medium border-l-2 border-primary bg-primary/5"
                                : "text-muted-foreground border-l-2 border-transparent",
                            )}
                            data-testid={item.testId}
                          >
                            <Icon className="h-4 w-4" />
                            {item.label}
                          </a>
                        </Link>
                      );
                    })}
                </div>
              );
            })}
          </nav>
          <div className="p-4 border-t border-border text-xs text-muted-foreground space-y-1">
            <a
              href={`${baseUrl || ""}/`}
              className="flex items-center gap-2 px-1 py-1.5 rounded hover:text-foreground transition-colors w-full"
              data-testid="link-view-website"
            >
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              <span>View website</span>
            </a>
            <div className="truncate pt-1 border-t border-border/50 mt-1" title={access?.signedInEmail ?? ""}>
              {access?.signedInEmail ?? ""}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 w-full justify-start px-1"
              onClick={() => { void signOut(); }}
              data-testid="button-sign-out"
            >
              <LogOut className="h-3.5 w-3.5 mr-2" /> Sign out
            </Button>
          </div>
        </aside>

        <main className="flex-1 min-w-0">
          <div className="border-b border-border px-6 py-4 flex items-center justify-between flex-wrap gap-3">
            <div className="min-w-0">
              {crumbs && crumbs.length > 0 && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                  {crumbs.map((c, i) => (
                    <span key={i} className="flex items-center gap-1">
                      {i > 0 && <ChevronRight className="h-3 w-3" />}
                      {c.href ? (
                        <Link href={c.href}>
                          <a className="hover:text-foreground">{c.label}</a>
                        </Link>
                      ) : (
                        <span>{c.label}</span>
                      )}
                    </span>
                  ))}
                </div>
              )}
              {title && (
                <h1 className="text-2xl font-semibold truncate" data-testid="admin-page-title">
                  {title}
                </h1>
              )}
            </div>
            {actions && <div className="flex items-center gap-2">{actions}</div>}
          </div>
          <div className="p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
