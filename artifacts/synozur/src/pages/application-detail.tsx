import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Meta } from "@/lib/meta";
import { useRoute, Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";
import { api, type ApplicationDto } from "@/lib/api";
import { BookingCard } from "@/components/BookingCard";
import { ConstellationDemo } from "@/components/demos/constellation";
import {
  getApplicationBySlug as getStaticApplicationBySlug,
  getActiveApplications,
} from "@/data/applications";
import NotFound from "@/pages/not-found";
import Gone from "@/pages/gone";
import { ApiError } from "@/lib/api";
import { LeadCaptureForm } from "@/components/lead-capture-form";
import { EditWedge } from "@/components/edit-wedge";

// #133 — Constellation interactive demo A/B toggle.
//
// Two layers gate the demo:
//   1. The server-controlled `constellationDemoEnabled` flag on the public
//      site-settings response. Admins flip this from the site-settings
//      admin to disable the demo site-wide without a redeploy. When #140
//      lands proper bucketing, that framework will consult this flag
//      before assigning a treatment arm.
//   2. A per-visitor URL override (`?demo=on|off`) sticky in sessionStorage,
//      used to deep-link from ad campaigns straight into the treatment or
//      to force the control arm for screenshots / QA.
function resolveConstellationDemoEnabled(serverFlag: boolean | undefined): boolean {
  if (typeof window === "undefined") return serverFlag !== false;
  try {
    const params = new URLSearchParams(window.location.search);
    const override = params.get("demo");
    if (override === "off") {
      window.sessionStorage.setItem("synozur.constellationDemo", "off");
      return false;
    }
    if (override === "on") {
      window.sessionStorage.setItem("synozur.constellationDemo", "on");
      return true;
    }
    const sticky = window.sessionStorage.getItem("synozur.constellationDemo");
    if (sticky === "off") return false;
    if (sticky === "on") return true;
  } catch {
    /* sessionStorage unavailable — fall through to the server flag */
  }
  // Server flag is the source of truth when no per-visitor override is set.
  // Default to "on" if the server response predates the field (older API).
  return serverFlag !== false;
}

function staticAsDto(
  s: ReturnType<typeof getActiveApplications>[number],
): ApplicationDto {
  return {
    id: s.slug,
    slug: s.slug,
    title: s.name,
    name: s.name,
    tagline: s.tagline,
    shortSummary: s.shortSummary,
    description: s.description,
    version: s.version ?? null,
    releaseDate: s.releaseDate,
    websiteUrl: s.websiteUrl,
    logo: s.logo,
    screenshot: s.screenshot,
    userGuideUrl: null,
    showInNav: true,
    bookingId: null,
    status: "published",
    publishedAt: null,
    unpublishedAt: null,
    featured: false,
    featuredRank: null,
    seoTitle: null,
    seoDescription: null,
    ogImage: null,
    active: s.isActive,
    sourceId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export default function ApplicationDetail() {
  const [, params] = useRoute("/applications/:slug");
  const slug = params?.slug ?? "";

  const detailQ = useQuery({
    queryKey: ["applications", slug, "detail"],
    queryFn: () => api.getApplication(slug),
    enabled: slug.length > 0,
    retry: (count, err) => {
      if (err instanceof Error && /404/.test(err.message)) return false;
      return count < 2;
    },
  });

  const listQ = useQuery({
    queryKey: ["applications"],
    queryFn: () => api.listApplications(),
  });

  // #133 — Site-settings drives the Constellation demo kill-switch. Cached
  // long because the flag changes rarely; the URL `?demo=on|off` override
  // works regardless of cache freshness.
  const siteSettingsQ = useQuery({
    queryKey: ["public-site-settings"],
    queryFn: () => api.getPublicSiteSettings(),
    staleTime: 5 * 60_000,
  });
  const siteSettings = siteSettingsQ.data;

  const staticFallback = slug ? getStaticApplicationBySlug(slug) : undefined;
  const app: ApplicationDto | undefined = useMemo(() => {
    if (detailQ.data) return detailQ.data;
    if (detailQ.isError && staticFallback) return staticAsDto(staticFallback);
    return undefined;
  }, [detailQ.data, detailQ.isError, staticFallback]);

  if (detailQ.isLoading && !staticFallback) {
    return (
      <div className="w-full py-32 text-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!app) {
    if (detailQ.error instanceof ApiError && detailQ.error.status === 410) {
      return <Gone kind="application" />;
    }
    return <NotFound />;
  }

  const apiItems = listQ.data?.items ?? [];
  const pool =
    apiItems.length > 0 ? apiItems : getActiveApplications().map(staticAsDto);
  const others = pool.filter((a) => a.slug !== app.slug).slice(0, 3);

  const releaseLabel = (() => {
    if (!app.releaseDate) return "";
    const releaseDate = new Date(app.releaseDate);
    if (isNaN(releaseDate.getTime())) return "";
    return releaseDate.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  })();

  return (
    <div className="w-full">
      <Meta title={app.name} description={app.tagline} />

      <section className="relative overflow-hidden bg-[#0B0B1A] pt-24 pb-20">
        <div className="absolute inset-0 nebula-gradient opacity-15" />
        <div className="container relative z-10 mx-auto px-4 max-w-5xl">
          <Link
            href="/applications"
            className="inline-flex items-center text-sm text-zinc-300 hover:text-white mb-8 transition-colors"
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> All applications
          </Link>
          <div className="flex flex-col md:flex-row md:items-center gap-6 mb-8">
            <div className="h-20 w-20 rounded-xl overflow-hidden bg-white/5 border border-white/10 shrink-0">
              <img
                src={app.logo}
                alt={`${app.name} logo`}
                className="w-full h-full object-cover"
              />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-3 mb-3">
                {app.version && (
                  <span className="inline-block py-1 px-3 rounded-full bg-primary/20 border border-primary/30 text-white text-xs font-medium backdrop-blur-sm">
                    v{app.version}
                  </span>
                )}
                {releaseLabel && (
                  <span className="text-xs uppercase tracking-widest text-zinc-400">
                    Released {releaseLabel}
                  </span>
                )}
              </div>
              <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-white">
                {app.name}
              </h1>
            </div>
          </div>
          <p className="text-xl md:text-2xl text-zinc-300 leading-relaxed max-w-3xl mb-8">
            {app.tagline}
          </p>
          {app.websiteUrl && (
            <a
              href={app.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
              data-testid="app-primary-cta"
            >
              Visit {app.name}
              <ExternalLink className="ml-2 h-4 w-4" />
            </a>
          )}
        </div>
      </section>

      <section className="bg-background">
        <div className="container mx-auto px-4 max-w-5xl -mt-12 relative z-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="rounded-2xl overflow-hidden border border-border shadow-2xl bg-card"
          >
            <img
              src={app.screenshot}
              alt={`${app.name} screenshot`}
              className="w-full h-auto object-cover"
            />
          </motion.div>
        </div>
      </section>

      <section className="py-20 bg-background">
        <div className="container mx-auto px-4 max-w-3xl">
          <p className="text-sm uppercase tracking-widest text-primary mb-3">
            About {app.name}
          </p>
          <h2 className="text-3xl md:text-4xl font-bold mb-8">
            What it does
          </h2>
          <div className="space-y-5 text-lg text-muted-foreground leading-relaxed">
            {app.description.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
          {app.websiteUrl && (
            <div className="mt-12 pt-8 border-t border-border/60">
              <a
                href={app.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
              >
                Open {app.name}
                <ExternalLink className="ml-2 h-4 w-4" />
              </a>
            </div>
          )}
        </div>
      </section>

      {app.slug === "constellation" &&
        // Wait for the in-flight fetch so we don't briefly render the demo
        // and then yank it. But once the fetch settles — even on error —
        // fall through to the resolver, which defaults to enabled when the
        // server flag is unknown. This preserves the documented default-on
        // behavior if `/site-settings` is transiently unreachable.
        !siteSettingsQ.isLoading &&
        resolveConstellationDemoEnabled(siteSettings?.constellationDemoEnabled) && (
          <ConstellationDemo />
        )}

      {app.booking && (
        <section className="py-16 bg-background border-t border-border">
          <div className="container mx-auto px-4 max-w-3xl">
            <BookingCard booking={app.booking} />
          </div>
        </section>
      )}

      {/* #131 — Demo / interest capture for application detail pages.
          Stores the application slug as a timeline-event token so the
          HubSpot record reflects which app the lead asked about. */}
      <section className="py-16 bg-background border-t border-border">
        <div className="container mx-auto px-4 max-w-2xl">
          <LeadCaptureForm
            formType="demo"
            context={{ slug: app.slug, title: app.name, application: app.name }}
            heading={`See ${app.name} in action`}
            description="Tell us a little about your goals and we'll set up a personalized walkthrough."
            ctaLabel="Request a demo"
            successMessage="Thanks — we'll reach out shortly to schedule your demo."
          />
        </div>
      </section>

      {others.length > 0 && (
        <section className="py-20 bg-card border-t border-border">
          <div className="container mx-auto px-4 max-w-5xl">
            <p className="text-sm uppercase tracking-widest text-primary mb-3">
              More from Synozur
            </p>
            <h2 className="text-2xl md:text-3xl font-bold mb-10">
              Explore other applications
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {others.map((o) => (
                <Link
                  key={o.slug}
                  href={`/applications/${o.slug}`}
                  className="group rounded-2xl border border-border/60 bg-background p-6 hover:border-primary/40 transition-colors block"
                >
                  <div className="flex items-center gap-3 mb-4">
                    <div className="h-10 w-10 rounded-lg overflow-hidden bg-card border border-border shrink-0">
                      <img
                        src={o.logo}
                        alt={`${o.name} logo`}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <h3 className="text-lg font-bold group-hover:text-primary transition-colors">
                      {o.name}
                    </h3>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3 mb-4">
                    {o.shortSummary}
                  </p>
                  <span className="inline-flex items-center text-sm text-muted-foreground group-hover:text-primary">
                    Learn more
                    <ArrowRight className="ml-1.5 h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      <EditWedge
        kind="application"
        id={app?.id}
        slug={app?.slug}
        snapshot={app ?? undefined}
        queryKey={["applications", slug, "detail"]}
      />
    </div>
  );
}
