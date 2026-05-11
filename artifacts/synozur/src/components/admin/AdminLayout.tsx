import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { AppLink } from "@/components/ui/app-link";
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
  CalendarClock,
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
  GraduationCap,
  ExternalLink,
  Link2,
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
  ShieldAlert,
  Settings,
  Cloud,
  Menu,
  X,
  KeyRound,
  UserCog,
  Brain,
  Sparkles,
  Mail,
  FlaskConical,
  LayoutTemplate,
} from "lucide-react";
import { useAdminAccess } from "@/components/admin/AdminGate";
import { PreviewButton } from "@/components/admin/PreviewButton";
import { SynozurAppSwitcher } from "@/components/synozur-app-switcher";
import type { Capability } from "@/lib/capabilities";
import { cn } from "@/lib/utils";
import {
  getListCmsCommentsQueryKey,
  useListCmsComments,
} from "@workspace/api-client-react";

type AccessLike = ReturnType<typeof useAdminAccess>["access"];

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  capability?: Capability;
  testId: string;
  badgeCount?: number;
  badgeTestId?: string;
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
      { href: "/people/bookings", label: "Bookings", icon: CalendarClock, capability: "site.manage", testId: "nav-admin-bookings" },
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
    id: "careers",
    label: "Careers",
    icon: Briefcase,
    items: [
      { href: "/careers/jobs", label: "Job Postings", icon: Briefcase, capability: "careers.jobs.read", testId: "nav-admin-careers-jobs" },
      { href: "/careers/applications", label: "Applications", icon: Inbox, capability: "careers.applications.read", testId: "nav-admin-careers-applications" },
      { href: "/careers/settings", label: "Settings", icon: Settings, capability: "careers.settings.manage", testId: "nav-admin-careers-settings" },
    ],
  },
  {
    id: "marketing",
    label: "Marketing",
    icon: Megaphone,
    items: [
      { href: "/marketing/traffic", label: "Traffic", icon: LineChart, capability: "content.moderate", testId: "nav-admin-marketing-traffic" },
      { href: "/marketing/traffic-properties", label: "Traffic Properties", icon: Network, capability: "content.moderate", testId: "nav-admin-marketing-traffic-properties" },
      { href: "/marketing/traffic-import", label: "Traffic Import", icon: Inbox, capability: "content.moderate", testId: "nav-admin-marketing-traffic-import" },
      { href: "/marketing/seo", label: "SEO", icon: Search, capability: "content.moderate", testId: "nav-admin-marketing-seo" },
      { href: "/marketing/seo-audit", label: "SEO Audit", icon: FileSearch, capability: "content.moderate", testId: "nav-admin-marketing-seo-audit" },
      { href: "/marketing/subscribers", label: "Subscribers", icon: Inbox, capability: "site.manage", testId: "nav-admin-marketing-subscribers" },
      { href: "/integrations/hubspot", label: "HubSpot", icon: Network, capability: "site.manage", testId: "nav-admin-hubspot" },
    ],
  },
  {
    id: "ai",
    label: "AI",
    icon: Sparkles,
    items: [
      { href: "/ai/grounding", label: "Grounding Documents", icon: Brain, capability: "ai.grounding.manage", testId: "nav-admin-ai-grounding" },
      { href: "/insights/questions", label: "Ask Synozur — Questions", icon: HelpCircle, capability: "content.moderate", testId: "nav-admin-ai-questions" },
    ],
  },
  {
    id: "access",
    label: "Access",
    icon: ShieldCheck,
    items: [
      { href: "/access/users", label: "Users & Roles", icon: Users, capability: "users.manage", testId: "nav-admin-users" },
      { href: "/access/capabilities", label: "Capabilities", icon: KeyRound, capability: "users.manage", testId: "nav-admin-capabilities" },
      { href: "/access/clients", label: "Organizations", icon: UsersRound, capability: "client_orgs.manage", testId: "nav-admin-client-orgs" },
      { href: "/access/engagement-documents", label: "Engagement Documents", icon: FileText, capability: "users.manage", testId: "nav-admin-engagement-documents" },
      { href: "/access/entra", label: "Entra Mappings", icon: ShieldCheck, capability: "users.manage", testId: "nav-admin-entra" },
      { href: "/access/security-log", label: "Security Log", icon: Activity, capability: "users.manage", testId: "nav-admin-security-log" },
      { href: "/access/audit-log", label: "Audit Log", icon: FileSearch, capability: "users.manage", testId: "nav-admin-audit-log" },
      { href: "/access/oauth-clients", label: "OAuth Clients", icon: AppWindow, capability: "oauth.manage", testId: "nav-admin-oauth-clients" },
    ],
  },
  {
    id: "site-config",
    label: "Site Config",
    icon: PanelTop,
    items: [
      { href: "/site-config/site-settings", label: "Settings", icon: Settings, capability: "site.manage", testId: "nav-admin-site-settings" },
      { href: "/site-config/alt-home", label: "Alt Home", icon: LayoutTemplate, capability: "site.manage", testId: "nav-admin-alt-home" },
      { href: "/site-config/experiments", label: "Experiments", icon: FlaskConical, capability: "site.manage", testId: "nav-admin-experiments" },
      { href: "/site-config/list-page-copy", label: "List Page Copy", icon: FileText, capability: "site.manage", testId: "nav-admin-list-page-copy" },
      { href: "/site-config/landing-pages", label: "Landing Pages", icon: LayoutTemplate, capability: "site.manage", testId: "nav-admin-landing-pages" },
      { href: "/site-config/redirects", label: "Redirects", icon: ExternalLink, capability: "site.manage", testId: "nav-admin-redirects" },
      { href: "/site-config/short-links", label: "Short Links", icon: Link2, capability: "site.manage", testId: "nav-admin-short-links" },
      { href: "/site-config/not-found-logs", label: "404 Log", icon: FileSearch, capability: "site.manage", testId: "nav-admin-not-found-logs" },
      { href: "/site-config/health", label: "Health", icon: Activity, capability: "site.manage", testId: "nav-admin-site-health" },
      { href: "/site-config/csp-violations", label: "CSP Violations", icon: ShieldAlert, capability: "site.manage", testId: "nav-admin-csp-violations" },
      { href: "/site-config/launch-readiness", label: "Launch Readiness", icon: ShieldCheck, capability: "site.manage", testId: "nav-admin-launch-readiness" },
      { href: "/site-config/email", label: "Email Log", icon: Mail, capability: "site.manage", testId: "nav-admin-email-log" },
      { href: "/integrations/spe", label: "SharePoint Embedded", icon: Cloud, capability: "site.manage", testId: "nav-admin-spe" },
    ],
  },
  {
    id: "account",
    label: "Account",
    icon: UserCog,
    items: [
      { href: "/account/profile", label: "My Profile", icon: UserCog, testId: "nav-admin-account-profile" },
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
  previewEntity,
}: {
  children: ReactNode;
  title?: string;
  crumbs?: Crumb[];
  actions?: ReactNode;
  /**
   * When set, auto-renders a PreviewButton in the header actions row
   * for the given entity. Saves every admin edit page from importing
   * and rendering the button itself.
   */
  previewEntity?: {
    kind: import("@/lib/entity-registry").EntityKind;
    id?: string | null;
    slug?: string | null;
    isDraft?: boolean;
  };
}) {
  const [location] = useLocation();
  const { signOut } = useAuth();
  const { access } = useAdminAccess();
  const { theme } = useTheme();
  const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");

  const isActive = (href: string) => {
    if (href === "/") return location === "/" || location === "";
    return location === href || location.startsWith(`${href}/`);
  };

  // Pull the count of pending spam comments so we can surface a badge on the
  // Comments nav item. Only enabled for users with content.moderate so we
  // don't fire 403s for everyone else.
  const canModerate = !!access?.hasCapability("content.moderate");
  const spamCountParams = { status: "spam" as const, pageSize: 1 };
  const spamCommentsQuery = useListCmsComments(spamCountParams, {
    query: {
      queryKey: getListCmsCommentsQueryKey(spamCountParams),
      enabled: canModerate,
      refetchOnWindowFocus: true,
      staleTime: 30_000,
    },
  });
  const spamCount = spamCommentsQuery.data?.total ?? 0;
  const refetchSpamCount = spamCommentsQuery.refetch;

  const visibleSections = useMemo(
    () =>
      SECTIONS
        .map((s) => ({
          section: s,
          items: visibleItems(s, access).map((item) =>
            item.testId === "nav-admin-comments"
              ? {
                  ...item,
                  badgeCount: spamCount,
                  badgeTestId: "badge-nav-admin-comments-spam",
                }
              : item,
          ),
        }))
        .filter(({ items }) => items.length > 0),
    [access, spamCount],
  );

  const activeSectionId = useMemo(() => {
    for (const { section, items } of visibleSections) {
      if (items.some((i) => isActive(i.href))) return section.id;
    }
    return null;
  }, [visibleSections, location]);

  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
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

  // Close the user menu when clicking outside it.
  useEffect(() => {
    if (!userMenuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [userMenuOpen]);

  // When the drawer is closed on mobile, hide it from a11y/keyboard so its
  // links aren't tab-reachable or announced by screen readers.
  const drawerHidden = !isMdUp && !mobileMenuOpen;

  const toggleSection = (id: string) =>
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));

  const userInitial = (access?.signedInEmail ?? "?")[0].toUpperCase();

  return (
    <div className={cn("min-h-screen bg-background text-foreground", theme)}>
      {/* Full-width top bar — always visible on all screen sizes. */}
      <header className="sticky top-0 z-30 h-12 flex items-center justify-between border-b border-border bg-background px-3 gap-2">
        {/* Left: hamburger (mobile) + wayfinder mark + Admin label + view site */}
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className="md:hidden inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover-elevate shrink-0"
            aria-label="Open admin menu"
            aria-expanded={mobileMenuOpen}
            data-testid="button-admin-mobile-menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <AppLink href="/" asChild unstyled className="flex items-center gap-2 shrink-0" data-testid="link-admin-top-home">
            <img
              src={`${baseUrl || ""}/images/synozur-mark-color.png`}
              alt="Synozur"
              className="h-6 w-auto"
            />
            <span className="hidden sm:inline text-sm font-semibold">Admin</span>
          </AppLink>
          <span className="hidden md:inline text-border/60 select-none mx-1">|</span>
          <a
            href={`${baseUrl || ""}/`}
            className="hidden md:flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            data-testid="link-view-website"
          >
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            <span>View site</span>
          </a>
        </div>
        {/* Right: app switcher + user avatar dropdown */}
        <div className="flex items-center gap-1 shrink-0">
          <SynozurAppSwitcher currentApp="synozur" />
          <div className="relative" ref={userMenuRef}>
            <button
              type="button"
              onClick={() => setUserMenuOpen((o) => !o)}
              aria-expanded={userMenuOpen}
              aria-haspopup="true"
              className="flex items-center gap-1 rounded-full pl-0.5 pr-2 py-0.5 text-xs hover:bg-muted transition-colors"
              data-testid="button-user-menu"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-primary text-xs font-bold">
                {userInitial}
              </span>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </button>
            {userMenuOpen && (
              <div className="absolute right-0 top-full mt-1 w-52 rounded-lg border border-border bg-popover shadow-lg z-50 overflow-hidden">
                <div className="px-3 py-2.5 text-xs text-muted-foreground truncate border-b border-border bg-muted/40">
                  {access?.signedInEmail ?? ""}
                </div>
                <a
                  href={`${baseUrl || ""}/`}
                  className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors md:hidden"
                  data-testid="link-view-website-mobile"
                >
                  <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                  View site
                </a>
                <button
                  type="button"
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors text-left"
                  onClick={() => { setUserMenuOpen(false); void signOut(); }}
                  data-testid="button-sign-out"
                >
                  <LogOut className="h-4 w-4 shrink-0 text-muted-foreground" />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

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
            "md:translate-x-0 md:sticky md:top-12 md:left-auto md:bottom-auto md:z-auto md:h-[calc(100vh-3rem)]",
          )}
          inert={drawerHidden || undefined}
          aria-hidden={drawerHidden || undefined}
        >
          <div className="p-5 border-b border-border flex items-center justify-between gap-3">
            <AppLink href="/" asChild unstyled className="block">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">
                Synozur
              </div>
              <div className="text-lg font-semibold">Admin</div>
            </AppLink>
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
          <nav className="flex-1 py-3 overflow-y-auto" data-testid="admin-sidebar">
            {TOP_LEVEL.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <AppLink
                  key={item.href}
                  href={item.href}
                  asChild
                  unstyled
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
                </AppLink>
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
                      const showBadge =
                        typeof item.badgeCount === "number" && item.badgeCount > 0;
                      // For the Comments item, refresh the spam count when
                      // the moderator hovers/focuses/clicks the link so the
                      // badge reflects reality before they navigate.
                      const isCommentsItem = item.testId === "nav-admin-comments";
                      const navRefresh = isCommentsItem && canModerate
                        ? () => { void refetchSpamCount(); }
                        : undefined;
                      return (
                        <AppLink
                          key={item.href}
                          href={item.href}
                          asChild
                          unstyled
                          className={cn(
                            "flex items-center gap-3 pl-10 pr-5 py-2 text-sm hover-elevate",
                            active
                              ? "text-primary font-medium border-l-2 border-primary bg-primary/5"
                              : "text-muted-foreground border-l-2 border-transparent",
                          )}
                          data-testid={item.testId}
                          onMouseEnter={navRefresh}
                          onFocus={navRefresh}
                          onClick={navRefresh}
                        >
                          <Icon className="h-4 w-4" />
                          <span className="flex-1">{item.label}</span>
                          {showBadge && (
                            <span
                              className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold leading-none"
                              aria-label={`${item.badgeCount} spam comment${item.badgeCount === 1 ? "" : "s"} pending review`}
                              data-testid={item.badgeTestId}
                            >
                              {item.badgeCount! > 99 ? "99+" : item.badgeCount}
                            </span>
                          )}
                        </AppLink>
                      );
                    })}
                </div>
              );
            })}
          </nav>
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
                        <AppLink href={c.href} unstyled className="hover:text-foreground">
                          {c.label}
                        </AppLink>
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
            {(previewEntity || actions) && (
              <div className="flex items-center gap-2">
                {previewEntity && (
                  <PreviewButton
                    kind={previewEntity.kind}
                    id={previewEntity.id ?? null}
                    slug={previewEntity.slug ?? null}
                    isDraft={previewEntity.isDraft}
                  />
                )}
                {actions}
              </div>
            )}
          </div>
          <div className="p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
