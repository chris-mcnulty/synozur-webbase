import { ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useClerk } from "@clerk/react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAdminAccess } from "@/components/admin/AdminGate";
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
      { href: "/insights/media", label: "Media", icon: ImageIcon, capability: "content.author", testId: "nav-admin-media" },
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
    ],
  },
  {
    id: "access",
    label: "Access",
    icon: ShieldCheck,
    items: [
      { href: "/access/users", label: "Users & Roles", icon: Users, capability: "users.manage", testId: "nav-admin-users" },
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
  const { signOut } = useClerk();
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

  useEffect(() => {
    if (activeSectionId) {
      setOpenSections((prev) =>
        prev[activeSectionId] ? prev : { ...prev, [activeSectionId]: true },
      );
    }
  }, [activeSectionId]);

  const toggleSection = (id: string) =>
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <div className={cn("min-h-screen bg-background text-foreground", theme)}>
      <div className="flex">
        <aside className="w-60 shrink-0 border-r border-border min-h-screen sticky top-0 hidden md:flex flex-col">
          <div className="p-5 border-b border-border">
            <Link href="/">
              <a className="block">
                <div className="text-xs uppercase tracking-widest text-muted-foreground">
                  Synozur
                </div>
                <div className="text-lg font-semibold">Admin</div>
              </a>
            </Link>
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
              onClick={() => signOut({ redirectUrl: `${baseUrl || ""}/` })}
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
