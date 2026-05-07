import type { ReactNode } from "react";
import { PortalSiteHeader } from "@/components/portal-site-header";
import { PortalSiteFooter } from "@/components/portal-site-footer";
import { useTheme } from "@/context/theme";

export function PortalShell({ children }: { children: ReactNode }) {
  const { theme } = useTheme();

  return (
    <div className="min-h-screen w-full flex flex-col">
      <PortalSiteHeader />
      {/*
        The galaxy is always a dark surface. Force dark-mode CSS variables on
        the content area regardless of the user's theme preference so that
        text-foreground, text-muted-foreground, bg-card etc. are always the
        dark-mode values (white text, dark cards). Header and footer remain
        theme-aware since they sit outside this wrapper.
      */}
      <div className={`flex-1 flex flex-col w-full${theme === "light" ? " dark" : ""}`}>
        {children}
      </div>
      <PortalSiteFooter />
    </div>
  );
}
