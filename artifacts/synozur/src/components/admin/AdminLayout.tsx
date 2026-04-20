import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useClerk } from "@clerk/react";
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
  Compass,
  Layers,
  Library as LibraryIcon,
  GraduationCap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAdminAccess } from "@/components/admin/AdminGate";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  show: (a: ReturnType<typeof useAdminAccess>["access"]) => boolean;
  testId: string;
}

const NAV: NavItem[] = [
  {
    href: "/",
    label: "Dashboard",
    icon: LayoutDashboard,
    show: () => true,
    testId: "nav-admin-dashboard",
  },
  {
    href: "/posts",
    label: "Posts",
    icon: FileText,
    show: (a) => !!a?.hasCmsRole,
    testId: "nav-admin-posts",
  },
  {
    href: "/media",
    label: "Media",
    icon: ImageIcon,
    show: (a) => !!a?.hasCmsRole,
    testId: "nav-admin-media",
  },
  {
    href: "/taxonomy",
    label: "Taxonomy",
    icon: Tags,
    show: (a) => !!a?.hasCmsRole,
    testId: "nav-admin-taxonomy",
  },
  {
    href: "/services",
    label: "Services",
    icon: Compass,
    show: (a) => !!a?.hasCmsRole,
    testId: "nav-admin-services",
  },
  {
    href: "/solutions",
    label: "Solutions",
    icon: Layers,
    show: (a) => !!a?.hasCmsRole,
    testId: "nav-admin-solutions",
  },
  {
    href: "/collateral",
    label: "Library",
    icon: LibraryIcon,
    show: (a) => !!a?.hasCmsRole,
    testId: "nav-admin-collateral",
  },
  {
    href: "/workshops",
    label: "Workshops",
    icon: GraduationCap,
    show: (a) => !!a?.hasCmsRole,
    testId: "nav-admin-workshops",
  },
  {
    href: "/comments",
    label: "Comments",
    icon: MessageSquare,
    show: (a) => !!a?.isEditorOrAbove,
    testId: "nav-admin-comments",
  },
  {
    href: "/users",
    label: "Users & Roles",
    icon: Users,
    show: (a) => !!a?.isAdmin,
    testId: "nav-admin-users",
  },
  {
    href: "/events",
    label: "Events",
    icon: CalendarDays,
    show: (a) => !!a?.isAllowListed,
    testId: "nav-admin-events",
  },
  {
    href: "/team-members",
    label: "Team",
    icon: UserSquare2,
    show: (a) => !!a?.isAllowListed,
    testId: "nav-admin-team",
  },
  {
    href: "/submissions",
    label: "Submissions",
    icon: Inbox,
    show: (a) => !!a?.isAllowListed,
    testId: "nav-admin-submissions",
  },
];

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
  const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");

  const items = NAV.filter((n) => n.show(access));

  const isActive = (href: string) => {
    if (href === "/") return location === "/" || location === "";
    return location === href || location.startsWith(`${href}/`);
  };

  return (
    <div className="min-h-screen bg-background text-foreground dark">
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
          <nav className="flex-1 py-3" data-testid="admin-sidebar">
            {items.map((item) => {
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
          </nav>
          <div className="p-4 border-t border-border text-xs text-muted-foreground">
            <div className="truncate" title={access?.signedInEmail ?? ""}>
              {access?.signedInEmail ?? ""}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 w-full justify-start"
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
