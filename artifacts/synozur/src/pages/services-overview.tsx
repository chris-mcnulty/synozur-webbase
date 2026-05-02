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

const OVERVIEW_HERO_SLUG = "our-services";

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

function DefaultOverview() {
  const list = useQuery({
    queryKey: ["services"],
    queryFn: () => api.listServices(),
  });

  const heroService = list.data?.items.find((s) => s.slug === OVERVIEW_HERO_SLUG);
  const pillars = (list.data?.items ?? []).filter((s) => s.slug !== OVERVIEW_HERO_SLUG);

  // Hub-level breadcrumbs (Home › Services) and an ItemList of pillars so
  // search engines can render the four pillars as a sitelinks-style rail.
  const overviewUrl = `${SITE_ORIGIN}/services-overview/default`;
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_ORIGIN },
      { "@type": "ListItem", position: 2, name: "Services", item: overviewUrl },
    ],
  };
  const pillarsItemListJsonLd =
    pillars.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: "Service pillars",
          itemListElement: pillars.map((p, i) => ({
            "@type": "ListItem",
            position: i + 1,
            url: `${SITE_ORIGIN}/services/${p.slug}`,
            name: p.title,
          })),
        }
      : null;

  return (
    <PageShell>
      <Meta
        title={heroService?.seoTitle || "Services Overview"}
        description={
          heroService?.seoDescription ||
          stripHtml(heroService?.heroTextHtml) ||
          stripHtml(heroService?.blurbHtml) ||
          "Four service pillars built to power transformation that is rooted in people, powered by technology, and driven by purpose."
        }
        image={heroService?.iconUrl ?? undefined}
        rawTitle={!!heroService?.seoTitle}
      />
      <JsonLd data={breadcrumbJsonLd} id="services-overview-breadcrumb-jsonld" />
      {pillarsItemListJsonLd ? (
        <JsonLd data={pillarsItemListJsonLd} id="services-overview-itemlist-jsonld" />
      ) : null}

      {list.isLoading ? (
        <LoadingHero />
      ) : (
        <section className="relative overflow-hidden bg-[#0B0B1A] py-32">
          <div className="absolute inset-0 nebula-gradient opacity-25" />
          <div className="container relative z-10 mx-auto px-4 max-w-4xl">
            <p className="text-sm uppercase tracking-widest text-primary mb-4">
              Our Services
            </p>
            <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-8">
              {heroService?.title ?? "Four pillars. One destination."}
            </h1>
            {heroService?.heroTextHtml ? (
              <RichText
                html={heroService.heroTextHtml}
                invert
                className="prose-lg prose-p:text-zinc-300 prose-strong:text-white"
              />
            ) : (
              <p className="text-xl md:text-2xl text-zinc-300 leading-relaxed max-w-3xl">
                Every engagement is shaped from the same set of disciplines. We compose them around your situation — never the other way around.
              </p>
            )}
          </div>
        </section>
      )}

      {list.isError ? (
        <ErrorBlock message="The services list could not be loaded right now." />
      ) : (
        <section className="py-24 bg-background">
          <div className="container mx-auto px-4 space-y-8">
            {list.isLoading
              ? [0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-40 rounded-2xl border border-border/60 bg-card animate-pulse"
                  />
                ))
              : pillars.map((p, i) => (
                  <motion.div
                    key={p.slug}
                    initial={{ opacity: 0, y: 24 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.5, delay: i * 0.05 }}
                  >
                    <Link
                      href={`/services/${p.slug}`}
                      className="group block rounded-2xl border border-border/60 bg-card p-8 md:p-12 hover:border-primary/40 hover:bg-card/80 transition-all nebula-card"
                    >
                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                        <div className="lg:col-span-1">
                          <div className="h-14 w-14 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                            <PillarIcon url={p.iconUrl} />
                          </div>
                        </div>
                        <div className="lg:col-span-7">
                          <h2 className="text-2xl md:text-3xl font-bold mb-3 group-hover:text-primary transition-colors">
                            {p.title}
                          </h2>
                          {p.blurbHtml ? (
                            <RichText
                              html={p.blurbHtml}
                              className="prose-p:text-muted-foreground prose-p:text-lg"
                            />
                          ) : null}
                        </div>
                        <div className="lg:col-span-4">
                          <p className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
                            Solutions
                          </p>
                          <ul className="space-y-2">
                            {p.solutions.slice(0, 6).map((s) => (
                              <li
                                key={s.slug}
                                className="text-sm text-foreground/90 flex items-center gap-2"
                              >
                                <span className="h-1 w-1 rounded-full bg-primary" />
                                {s.title}
                              </li>
                            ))}
                          </ul>
                          <span className="mt-6 inline-flex items-center text-sm font-semibold text-primary">
                            Browse solutions
                            <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                          </span>
                        </div>
                      </div>
                    </Link>
                  </motion.div>
                ))}
          </div>
        </section>
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
        <section className="relative overflow-hidden bg-[#0B0B1A] py-32">
          <div className="absolute inset-0 nebula-gradient opacity-25" />
          <div className="container relative z-10 mx-auto px-4 max-w-4xl">
            <Link
              href="/services-overview/default"
              className="text-sm text-zinc-400 hover:text-white inline-flex items-center mb-8"
            >
              ← All Services
            </Link>
            <div className="h-16 w-16 rounded-2xl bg-primary/20 text-primary flex items-center justify-center mb-8">
              <PillarIcon url={service.iconUrl} />
            </div>
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
