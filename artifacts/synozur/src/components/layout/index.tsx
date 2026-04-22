import { ReactNode, useEffect } from "react";
import { useLocation } from "wouter";
import { Header } from "./header";
import { Footer } from "./footer";
import { Analytics } from "@/components/analytics";
import { OrganizationJsonLd } from "@/components/organization-jsonld";
import { useTheme } from "@/context/theme";
import { cn } from "@/lib/utils";
import { installTrafficTracker, trackPageview } from "@/lib/traffic-tracker";

export function Layout({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  const [location] = useLocation();

  useEffect(() => {
    installTrafficTracker();
  }, []);

  useEffect(() => {
    void trackPageview(location);
  }, [location]);

  return (
    <div className={cn("min-h-[100dvh] flex flex-col w-full bg-background text-foreground", theme)}>
      <OrganizationJsonLd />
      <Header />
      <main className="flex-1 flex flex-col w-full">
        {children}
      </main>
      <Footer />
      <Analytics />
    </div>
  );
}
