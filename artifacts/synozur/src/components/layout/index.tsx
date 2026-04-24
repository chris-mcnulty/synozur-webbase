import { ReactNode, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Header } from "./header";
import { Footer } from "./footer";
import { Analytics } from "@/components/analytics";
import { OrganizationJsonLd } from "@/components/organization-jsonld";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { useTheme } from "@/context/theme";
import { cn } from "@/lib/utils";
import { installTrafficTracker, trackPageview } from "@/lib/traffic-tracker";
import { api } from "@/lib/api";

function upsertMeta(name: string, content: string) {
  let el = document.head.querySelector(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("name", name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function removeMeta(name: string) {
  const el = document.head.querySelector(`meta[name="${name}"]`);
  if (el) el.remove();
}

export function Layout({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  const [location] = useLocation();

  const { data: settings } = useQuery({
    queryKey: ["public-site-settings"],
    queryFn: () => api.getPublicSiteSettings(),
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    installTrafficTracker();
  }, []);

  useEffect(() => {
    void trackPageview(location);
  }, [location]);

  // Emit site-verification meta tags when tokens are configured.
  useEffect(() => {
    const google = settings?.seoGoogleSiteVerification;
    const bing = settings?.seoBingSiteVerification;
    if (google) {
      upsertMeta("google-site-verification", google);
    } else {
      removeMeta("google-site-verification");
    }
    if (bing) {
      upsertMeta("msvalidate.01", bing);
    } else {
      removeMeta("msvalidate.01");
    }
  }, [settings?.seoGoogleSiteVerification, settings?.seoBingSiteVerification]);

  return (
    <div className={cn("min-h-[100dvh] flex flex-col w-full bg-background text-foreground", theme)}>
      <OrganizationJsonLd />
      <BreadcrumbJsonLd />
      <Header />
      <main className="flex-1 flex flex-col w-full">
        {children}
      </main>
      <Footer />
      <Analytics />
    </div>
  );
}
