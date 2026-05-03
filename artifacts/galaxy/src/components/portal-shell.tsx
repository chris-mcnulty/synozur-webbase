import type { ReactNode } from "react";
import { PortalSiteHeader } from "@/components/portal-site-header";
import { PortalSiteFooter } from "@/components/portal-site-footer";

export function PortalShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen w-full bg-background flex flex-col">
      <PortalSiteHeader />
      <div className="flex-1 flex flex-col w-full">
        {children}
      </div>
      <PortalSiteFooter />
    </div>
  );
}
