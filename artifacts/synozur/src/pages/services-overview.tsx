import { Meta } from "@/lib/meta";
import { motion } from "framer-motion";
import { Link, useRoute } from "wouter";
import { ArrowRight, Layers } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api, type ServiceWithSolutions } from "@/lib/api";
import { RichText } from "@/components/rich-text";
import NotFound from "./not-found";
import { JsonLd } from "@/components/jsonld";
import { SITE_NAME, SITE_ORIGIN } from "@/lib/seo-config";
import { useOverride } from "@/lib/experiments";
import { PageHero } from "@/components/layout/page-hero";

function PillarIcon({ url, fallback }: { url: string | null; fallback?: React.ReactNode }) {
  if (url) {
    return (
      <img
        src={url}
        alt=""
        className="h-7 w-7 object-contain"
        loading="lazy"
      />
    );
  }
  return <>{fallback ?? <Layers className="h-7 w-7" />}</>;
}

function PageShell({ children }: { children: React.ReactNode }) {
  return <div className="w-full">{children}</div>;
}

function LoadingHero() {
  return (
    <section className="relative overflow-hidden bg-[#0B0B1A] py-32">
      <div className="container relative z-10 mx-auto px-4 max-w-4xl">
        <div className="h-4 w-24 bg-white/10 rounded mb-4 animate-pulse" />
        <div className="h-12 w-3/4 bg-white/10 rounded mb-6 animate-pulse" />
        <div className="h-4 w-2/3 bg-white/10 rounded animate-pulse" />
      </div>
    </section>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <section className="py-24 bg-background">
      <div className="container mx-auto px-4 max-w-2xl text-center">
        <h2 className="text-2xl font-bold mb-3">We hit a snag loading this page</h2>
        <p className="text-muted-foreground mb-6">{message}</p>
        <Link
          href="/contact"
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Contact us
        </Link>
      </div>
    </section>
  );
}

const FEATURED_GROUP_META: Record<
  "ai_strategy" | "gtm" | "company_os",
  { label: string; phase: string; tagline: string }
> = {
  ai_strategy: {
    label: "AI Strategy & Design",
    phase: "Assess · Define",
    tagline:
      "Find the AI plays that actually move the number — and the guardrails that let you ship them.",
  },
  gtm: {
    label: "GTM Strategy & Execution",
    phase: "Deliver",
    tagline:
      "Reposition, repackage, and take the story to market with motions that prove it in revenue.",
  },
  company_os: {
    label: "Company OS",
    phase: "Outcomes",
    tagline:
      "Embed the operating habits, measurement, and rhythm so the change keeps compounding.",
  },
};

function DefaultOverview() {
  const list = useQuery({
    queryKey: ["solutions", "menu"],
    queryFn: () => api.listSolutions({ showInMenu: true }),
  });
  // Also fetch the full set so we can render hidden/lower-tier consulting
  // solutions on the overview (they're public, just not in the nav).
  const allList = useQuery({
    queryKey: ["solutions", "all"],
    queryFn: () => api.listSolutions({}),
  });
  const heroEyebrow = useOverride<string>(
    "services.hero.eyebrow",
    "Solutions",
  );
  const heroHeadlineOverride = useOverride<string | null>(
    "services.hero.headline",
    "AI-native. Human-centered. Built to land.",
  );
  const heroBodyOverride = useOverride<string | null>(
    "services.hero.body",
    "Three flagship solutions cover the arc from AI strategy through GTM execution to Company OS adoption. A consulting bench composes around whatever piece you need next.",
  );

  const items = list.data?.items ?? [];
  const featuredTrio = (["ai_strategy", "gtm", "company_os"] as const)
    .map((g) => ({
      group: g,
      meta: FEATURED_GROUP_META[g],
      solution: items.find((s) => s.solutionGroup === g),
    }))
    .filter((row) => row.solution != null);

  const consultingAll = (allList.data?.items ?? []).filter(
    (s) => s.solutionGroup === "consulting_services",
  );

  const overviewUrl = `${SITE_ORIGIN}/services-overview/default`;
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_ORIGIN },
      { "@type": "ListItem", position: 2, name: "Services", item: overviewUrl },
    ],
  };
  const itemListJsonLd =
    featuredTrio.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: "Flagship solutions",
          itemListElement: featuredTrio.map((row, i) => ({
            "@type": "ListItem",
            position: i + 1,
            url: `${SITE_ORIGIN}/solutions/${row.solution!.slug}`,
            name: row.solution!.title,
          })),
        }
      : null;

  return (
    <PageShell>
      <Meta
        title="Solutions Overview"
        description="Three flagship solutions — AI Strategy & Design, GTM Strategy & Execution, and Company OS — plus a consulting bench that composes around your situation."
        image="/opengraph.jpg"
      />
      <JsonLd data={breadcrumbJsonLd} id="services-overview-breadcrumb-jsonld" />
      {itemListJsonLd ? (
        <JsonLd data={itemListJsonLd} id="services-overview-itemlist-jsonld" />
      ) : null}

      <PageHero
        eyebrow={heroEyebrow}
        title={heroHeadlineOverride ?? "AI-native. Human-centered. Built to land."}
        subtitle={heroBodyOverride}
        data-testid="solutions-overview-hero"
      />

      {list.isError ? (
        <ErrorBlock message="The services list could not be loaded right now." />
      ) : (
        <>
          <section className="py-24 bg-background">
            <div className="container mx-auto px-4">
              <div className="max-w-3xl mb-12">
                <p className="text-sm uppercase tracking-widest text-primary mb-3">
                  Flagship Solutions
                </p>
                <h2 className="text-3xl md:text-4xl font-bold">
                  Three engagements. One Method.
                </h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {list.isLoading
                  ? [0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className="h-72 rounded-2xl border border-border/60 bg-card animate-pulse"
                      />
                    ))
                  : featuredTrio.map((row, i) => {
                      const sol = row.solution!;
                      return (
                        <motion.div
                          key={sol.slug}
                          initial={{ opacity: 0, y: 24 }}
                          whileInView={{ opacity: 1, y: 0 }}
                          viewport={{ once: true }}
                          transition={{ duration: 0.5, delay: i * 0.06 }}
                        >
                          <Link
                            href={`/solutions/${sol.slug}`}
                            className="group block h-full rounded-2xl border border-border/60 bg-card p-8 hover:border-primary/40 hover:bg-card/80 transition-all nebula-card"
                          >
                            <div className="h-14 w-14 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-6">
                              <PillarIcon url={sol.iconUrl} />
                            </div>
                            <p className="text-xs uppercase tracking-widest text-primary mb-2">
                              {row.meta.phase}
                            </p>
                            <h3 className="text-2xl font-bold mb-3 group-hover:text-primary transition-colors">
                              {sol.title}
                            </h3>
                            <p className="text-base text-muted-foreground mb-6">
                              {row.meta.tagline}
                            </p>
                            <span className="inline-flex items-center text-sm font-semibold text-primary">
                              Explore
                              <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                            </span>
                          </Link>
                        </motion.div>
                      );
                    })}
              </div>
            </div>
          </section>

          <section className="py-24 bg-card border-y border-border">
            <div className="container mx-auto px-4">
              <div className="max-w-3xl mb-12">
                <p className="text-sm uppercase tracking-widest text-primary mb-3">
                  Consulting Services
                </p>
                <h2 className="text-3xl md:text-4xl font-bold mb-4">
                  Specialist benches that plug into any phase
                </h2>
                <p className="text-base text-muted-foreground">
                  When the flagship engagements aren't the right shape, our
                  consulting bench composes around the specific gap — leadership,
                  brand, Microsoft, delivery, or design.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {allList.isLoading
                  ? [0, 1, 2, 3, 4, 5].map((i) => (
                      <div
                        key={i}
                        className="h-32 rounded-xl border border-border/60 bg-background/50 animate-pulse"
                      />
                    ))
                  : consultingAll.map((s, i) => (
                      <motion.div
                        key={s.slug}
                        initial={{ opacity: 0, y: 16 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.4, delay: i * 0.04 }}
                      >
                        <Link
                          href={`/solutions/${s.slug}`}
                          className="group block h-full rounded-xl border border-border/60 bg-background/50 p-6 hover:border-primary/40 transition-colors"
                        >
                          <div className="flex items-start gap-4 h-full">
                            <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                              <PillarIcon url={s.iconUrl} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <h3 className="text-base font-semibold mb-1 group-hover:text-primary transition-colors leading-snug line-clamp-2">
                                {s.title}
                                {s.showInMenu === false ? (
                                  <span className="ml-2 inline-flex items-center rounded-full border border-border bg-background px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                                    On request
                                  </span>
                                ) : null}
                              </h3>
                              {s.blurbHtml ? (
                                <RichText
                                  html={s.blurbHtml}
                                  className="prose-sm prose-p:text-muted-foreground prose-p:text-sm prose-p:my-0 [&_p]:line-clamp-3"
                                />
                              ) : null}
                            </div>
                          </div>
                        </Link>
                      </motion.div>
                    ))}
              </div>
            </div>
          </section>
        </>
      )}
    </PageShell>
  );
}

function PillarOverview({ slug }: { slug: string }) {
  const detail = useQuery({
    queryKey: ["services", slug],
    queryFn: () => api.getService(slug),
    retry: (count, err) => {
      if (err instanceof Error && /404/.test(err.message)) return false;
      return count < 2;
    },
  });
  const list = useQuery({
    queryKey: ["services"],
    queryFn: () => api.listServices(),
  });

  const service = detail.data;
  const solutions: ServiceWithSolutions["solutions"] =
    list.data?.items.find((s) => s.slug === slug)?.solutions ?? [];

  if (detail.isError && detail.error instanceof Error && /404/.test(detail.error.message)) {
    return <NotFound />;
  }

  if (detail.isError) {
    return (
      <PageShell>
        <Meta title="Services" />
        <LoadingHero />
        <ErrorBlock message="We couldn't load this service right now. Please try again in a moment." />
      </PageShell>
    );
  }

  // Pillar overview pages render the same service content as /services/:slug,
  // so we point rel=canonical (and og:url) at the service detail URL to
  // consolidate ranking signals there and avoid duplicate-content competition.
  const seoDescription =
    service?.seoDescription ||
    (service?.blurbHtml ? stripHtml(service.blurbHtml) : undefined);
  const absoluteImage = service?.iconUrl
    ? service.iconUrl.startsWith("http")
      ? service.iconUrl
      : `${SITE_ORIGIN}${service.iconUrl}`
    : null;
  const serviceJsonLd = service
    ? {
        "@context": "https://schema.org",
        "@type": "Service",
        name: service.title,
        url: `${SITE_ORIGIN}/services/${service.slug}`,
        ...(seoDescription ? { description: seoDescription } : {}),
        ...(absoluteImage ? { image: absoluteImage } : {}),
        provider: {
          "@type": "Organization",
          name: SITE_NAME,
          url: SITE_ORIGIN,
        },
      }
    : null;
  const breadcrumbJsonLd = service
    ? {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: SITE_ORIGIN },
          {
            "@type": "ListItem",
            position: 2,
            name: "Services",
            item: `${SITE_ORIGIN}/services-overview/default`,
          },
          {
            "@type": "ListItem",
            position: 3,
            name: service.title,
            item: `${SITE_ORIGIN}/services/${service.slug}`,
          },
        ],
      }
    : null;

  return (
    <PageShell>
      <Meta
        title={service?.seoTitle || service?.title || "Services"}
        description={seoDescription}
        image={service?.iconUrl ?? undefined}
        rawTitle={!!service?.seoTitle}
        canonicalPath={service ? `/services/${service.slug}` : undefined}
      />
      {serviceJsonLd ? (
        <JsonLd data={serviceJsonLd} id="pillar-overview-service-jsonld" />
      ) : null}
      {breadcrumbJsonLd ? (
        <JsonLd data={breadcrumbJsonLd} id="pillar-overview-breadcrumb-jsonld" />
      ) : null}

      {detail.isLoading || !service ? (
        <LoadingHero />
      ) : (
        <section className="relative overflow-hidden bg-[#0B0B1A] py-24 md:py-32">
          <div aria-hidden="true" className="absolute inset-0 nebula-gradient opacity-25" />
          <div className="container relative z-10 mx-auto px-4 max-w-4xl">
            <Link
              href="/services-overview/default"
              className="text-sm text-zinc-400 hover:text-white inline-flex items-center mb-8"
            >
              ← All Solutions
            </Link>
            <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-6">
              {service.title}
            </h1>
            {service.heroTextHtml ? (
              <RichText
                html={service.heroTextHtml}
                invert
                className="prose-lg prose-p:text-zinc-300 prose-strong:text-white"
              />
            ) : null}
          </div>
        </section>
      )}

      {service?.secondaryTitle || service?.secondaryTextHtml ? (
        <section className="py-24 bg-background">
          <div className="container mx-auto px-4 max-w-4xl">
            {service.secondaryTitle ? (
              <h2 className="text-3xl md:text-4xl font-bold mb-6">
                {service.secondaryTitle}
              </h2>
            ) : null}
            <RichText html={service.secondaryTextHtml} className="prose-lg" />
          </div>
        </section>
      ) : null}

      {service?.tertiaryTitle || service?.tertiaryTextHtml ? (
        <section className="py-24 bg-card border-y border-border">
          <div className="container mx-auto px-4 max-w-4xl">
            {service.tertiaryTitle ? (
              <h2 className="text-3xl md:text-4xl font-bold mb-6">
                {service.tertiaryTitle}
              </h2>
            ) : null}
            <RichText html={service.tertiaryTextHtml} />
          </div>
        </section>
      ) : null}

      <section className="py-24 bg-background">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mb-12">
            <p className="text-sm uppercase tracking-widest text-primary mb-3">
              Solutions
            </p>
            <h2 className="text-3xl md:text-4xl font-bold">
              Explore the work inside {service?.title ?? "this pillar"}
            </h2>
          </div>
          {solutions.length === 0 ? (
            <p className="text-muted-foreground">
              Solutions for this pillar will be published soon.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {solutions.map((s, i) => (
                <motion.div
                  key={s.slug}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: i * 0.05 }}
                >
                  <Link
                    href={`/solutions/${s.slug}`}
                    className="group flex flex-col h-full rounded-xl border border-border/60 bg-card p-6 hover:border-primary/40 transition-colors nebula-card"
                  >
                    <div className="h-12 w-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-4">
                      {s.iconUrl ? (
                        <img src={s.iconUrl} alt="" className="h-6 w-6 object-contain" loading="lazy" />
                      ) : (
                        <Layers className="h-6 w-6" />
                      )}
                    </div>
                    <h3 className="text-lg font-bold mb-2 group-hover:text-primary transition-colors">
                      {s.title}
                    </h3>
                    {s.blurbCopy ? (
                      <p className="text-sm text-muted-foreground leading-relaxed flex-1">
                        {s.blurbCopy}
                      </p>
                    ) : null}
                    <span className="mt-4 inline-flex items-center text-sm font-semibold text-primary">
                      Explore <ArrowRight className="ml-2 h-4 w-4" />
                    </span>
                  </Link>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </section>
    </PageShell>
  );
}

function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
}

export default function ServicesOverview() {
  const [matchSlug, slugParams] = useRoute("/services-overview/:slug");
  const slug = matchSlug ? slugParams?.slug ?? "default" : "default";
  if (slug === "default") return <DefaultOverview />;
  return <PillarOverview slug={slug} />;
}
