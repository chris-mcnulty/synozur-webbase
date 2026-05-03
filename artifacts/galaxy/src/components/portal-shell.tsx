import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/auth";
import type { ReactNode } from "react";

// Shared chrome for the signed-in portal. Header has the Galaxy mark, two
// top-level links (Home, Apps), the email, and a sign-out button. Each page
// supplies its own <main>.

const NAV: { href: string; label: string }[] = [
  { href: "/", label: "Home" },
  { href: "/documents", label: "Documents" },
  { href: "/apps", label: "Apps" },
];

export function PortalShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const [location] = useLocation();

  return (
    <div className="min-h-screen w-full bg-background">
      <header className="border-b border-border">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <Link href="/">
              <a className="flex items-center gap-3" data-testid="link-home">
                <div className="h-8 w-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center text-sm font-semibold">
                  G
                </div>
                <div className="hidden sm:block">
                  <p className="text-sm font-semibold leading-tight">Galaxy</p>
                  <p className="text-xs text-muted-foreground leading-tight">
                    Synozur customer portal
                  </p>
                </div>
              </a>
            </Link>
            <nav className="flex items-center gap-1">
              {NAV.map((n) => {
                const active =
                  n.href === "/"
                    ? location === "/"
                    : location === n.href || location.startsWith(`${n.href}/`);
                return (
                  <Link key={n.href} href={n.href}>
                    <a
                      data-testid={`nav-${n.label.toLowerCase()}`}
                      className={`px-3 py-1.5 rounded-md text-sm ${
                        active
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {n.label}
                    </a>
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {user?.email ? (
              <span className="text-xs text-muted-foreground hidden sm:inline">
                {user.email}
              </span>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void signOut()}
              data-testid="button-sign-out"
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
