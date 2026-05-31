import { ReactNode, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Header } from "./header";
import { Footer } from "./footer";
import { AnnouncementBar } from "./AnnouncementBar";
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

  useEffect(() => {
    if (!window.location.hash) {
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    }
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

  const showAnnouncement =
    settings?.announcementEnabled === true && !!settings.announcementText;

  return (
    <div className={cn("min-h-[100dvh] flex flex-col w-full bg-background text-foreground", theme)}>
      <OrganizationJsonLd />
      <BreadcrumbJsonLd />
      {showAnnouncement && (
        <AnnouncementBar
          text={settings.announcementText!}
          linkText={settings.announcementLinkText}
          linkUrl={settings.announcementLinkUrl}
        />
      )}
      <Header />
      <main className="flex-1 flex flex-col w-full">
        {children}
      </main>
      <Footer />
      <Analytics />
    </div>
  );
}
