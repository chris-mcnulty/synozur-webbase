import { ReactNode, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Header } from "./header";
import { Footer } from "./footer";
import { SiteHeaderB, isLightTopRoute } from "./site-header-b";
import { SiteFooterB } from "./site-footer-b";
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

export function Layout({
  children,
  chrome = "default",
  forceDark = false,
}: {
  children: ReactNode;
  /** "default" = mainline header/footer. "b" = the decision-path B experience. */
  chrome?: "default" | "b";
  /** When true, always render dark regardless of the theme toggle — for the
   *  cinematic flagship pages (home + Sprint/Proof/Fit/Book) that are built on
   *  dark video/photography art. Content pages leave this false so the
   *  light/dark toggle keeps working. */
  forceDark?: boolean;
}) {
  const { theme } = useTheme();
  const [location] = useLocation();
  const isB = chrome === "b";

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

  // The B experience is authored exclusively for the cosmic dark palette
  // (white display copy over dark hero/section backgrounds), matching the
  // approved mockup. Force "dark" for B chrome so it never inverts to the
  // light theme when a visitor's OS prefers light or they toggle the mainline.
  return (
    <div
      className={cn(
        "min-h-[100dvh] flex flex-col w-full bg-background text-foreground",
        forceDark ? "dark" : theme,
      )}
    >
      <OrganizationJsonLd />
      <BreadcrumbJsonLd />
      {showAnnouncement && !forceDark && (
        <AnnouncementBar
          text={settings.announcementText!}
          linkText={settings.announcementLinkText}
          linkUrl={settings.announcementLinkUrl}
        />
      )}
      {isB ? <SiteHeaderB /> : <Header />}
      <main
        className={cn(
          "flex-1 flex flex-col w-full",
          // Hero pages supply their own top padding; utility pages under the
          // fixed B header do not, so reserve space (64px mobile single-row,
          // 100px desktop two-row) to avoid the header overlapping content.
          isB && isLightTopRoute(location) && "pt-16 lg:pt-[100px]",
        )}
      >
        {children}
      </main>
      {isB ? <SiteFooterB /> : <Footer />}
      <Analytics />
    </div>
  );
}
