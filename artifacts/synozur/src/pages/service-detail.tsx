import { Meta } from "@/lib/meta";
import { motion } from "framer-motion";
import { Link, useRoute } from "wouter";
import { ArrowRight, Clock, Layers, Monitor } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api, type ServiceWithSolutions } from "@/lib/api";
import { RichText } from "@/components/rich-text";
import { RelatedContent } from "@/components/related-content";
import NotFound from "./not-found";
import { JsonLd } from "@/components/jsonld";
import { SITE_NAME, SITE_ORIGIN } from "@/lib/seo-config";
import { BookingCard } from "@/components/BookingCard";

// The former string-matching map that paired service slugs with
// workshop categories is gone (#105). The "related workshops" rail now
// queries `GET /api/workshops?serviceId=...` — workshops carry a real
// service FK (#100), so an editor renaming a service doesn't silently
// break this page. Workshops left without a service assignment simply
// don't appear here until they're linked.
type WorkshopListItem = {
  slug: string;
  title: string;
  category: string;
  shortDescription: string;
  heroImage: string;
  duration: string;
  deliveryFormat: string;
};

function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
}

function Icon({ url }: { url: string | null }) {
  if (url) return <img src={url} alt="" className="h-7 w-7 object-contain" loading="lazy" />;
  return <Layers className="h-7 w-7" />;
}

function RelatedWorkshopsRail({
  serviceId,
  serviceTitle,
}: {
  serviceId: string | null;
  serviceTitle: string | null;
}) {
  const q = useQuery({
    queryKey: ["workshops", "by-service", serviceId],
    queryFn: () =>
      serviceId
        ? api.listWorkshopsByService(serviceId)
        : Promise.resolve({ items: [] as WorkshopListItem[] }),
    enabled: Boolean(serviceId),
  });
  const workshops = (q.data?.items ?? []) as WorkshopListItem[];
  if (!serviceId || workshops.length === 0) return null;
  return (
    <section className="py-24 bg-card border-y border-border">
      <div className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
          <div>
            <p className="text-sm uppercase tracking-widest text-primary mb-3">
              Workshops
            </p>
            <h2 className="text-3xl md:text-4xl font-bold">
              Accelerate with a focused workshop
            </h2>
            <p className="mt-4 text-lg text-muted-foreground max-w-2xl">
              Jump-start your {serviceTitle?.toLowerCase() ?? "transformation"} journey
              with a structured, facilitated intensive — designed to produce clear
              deliverables in a single session.
            </p>
          </div>
          <Link
            href="/workshops"
            className="inline-flex shrink-0 items-center text-primary font-semibold hover:text-primary/80 transition-colors"
          >
            All workshops <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {workshops.map((workshop, i) => (
            <motion.div
              key={workshop.slug}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.08 }}
            >
              <Link href={`/workshops/${workshop.slug}`} className="group block h-full">
                <div className="flex flex-col h-full rounded-2xl border border-border/60 bg-background overflow-hidden hover-elevate">
                  <div className="relative aspect-[16/7] overflow-hidden bg-muted">
                    <img
                      src={workshop.heroImage}
                      alt={workshop.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                    <span className="absolute bottom-3 left-3 inline-block py-0.5 px-2.5 rounded-full bg-white/10 border border-white/25 text-white text-[10px] tracking-[0.15em] font-semibold backdrop-blur-md">
                      {workshop.category}
                    </span>
                  </div>
                  <div className="flex flex-col flex-1 p-6">
                    <h3 className="font-bold text-lg leading-snug mb-2 group-hover:text-primary transition-colors">
                      {workshop.title}
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed flex-1">
                      {workshop.shortDescription}
                    </p>
                    <div className="mt-5 flex flex-wrap gap-4 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {workshop.duration}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Monitor className="h-3 w-3" /> {workshop.deliveryFormat}
                      </span>
                    </div>
                    <div className="mt-4 inline-flex items-center text-primary text-sm font-semibold">
                      Learn more <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                    </div>
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function ServiceDetail() {
  const [, params] = useRoute("/services/:slug");
  const slug = params?.slug ?? "";
  const previewToken =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("preview")
      : null;

  const detail = useQuery({
    queryKey: ["services", slug, "detail", previewToken ?? ""],
    queryFn: () => api.getService(slug, previewToken),
    enabled: slug.length > 0,
    retry: (count, err) => {
      if (err instanceof Error && /404/.test(err.message)) return false;
      return count < 2;
    },
  });
  const list = useQuery({
    queryKey: ["services"],
    queryFn: () => api.listServices(),
  });

  if (detail.isError && detail.error instanceof Error && /404/.test(detail.error.message)) {
    return <NotFound />;
  }

  if (detail.isError) {
    return (
      <div className="w-full">
        <Meta title="Services" />
        <section className="py-32 bg-background">
          <div className="container mx-auto px-4 max-w-2xl text-center">
            <h1 className="text-3xl md:text-4xl font-bold mb-4">
              We couldn't load this service
            </h1>
            <p className="text-muted-foreground mb-8">
              Something went wrong reaching our content service. Please try again
              in a moment, or get in touch and we'll point you to the right place.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => detail.refetch()}
                className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Try again
              </button>
              <Link
                href="/services-overview/default"
                className="inline-flex h-10 items-center justify-center rounded-md border border-border px-6 text-sm font-medium text-foreground hover:bg-muted/50"
              >
                All services
              </Link>
            </div>
          </div>
        </section>
      </div>
    );
  }

  const service = detail.data;
  const solutions: ServiceWithSolutions["solutions"] =
    list.data?.items.find((s) => s.slug === slug)?.solutions ?? [];

  const seoDescription =
    service?.seoDescription ?? stripHtml(service?.blurbHtml) ?? undefined;
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
        ...(solutions.length > 0
          ? {
              hasOfferCatalog: {
                "@type": "OfferCatalog",
                name: `${service.title} solutions`,
                itemListElement: solutions.map((s, i) => ({
                  "@type": "Offer",
                  position: i + 1,
                  itemOffered: {
                    "@type": "Service",
                    name: s.title,
                    url: `${SITE_ORIGIN}/solutions/${s.slug}`,
                  },
                })),
              },
            }
          : {}),
      }
    : null;
  // Breadcrumbs trace the navigation path so search engines can render
  // rich-result rails: Home › Services › {this service}.
  const breadcrumbJsonLd = service
    ? {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Home",
            item: SITE_ORIGIN,
          },
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
    <div className="w-full">
      <Meta
        title={service?.seoTitle || service?.title || "Services"}
        description={seoDescription || undefined}
        image={service?.iconUrl ?? undefined}
        rawTitle={!!service?.seoTitle}
      />
      {serviceJsonLd ? <JsonLd data={serviceJsonLd} id="service-jsonld" /> : null}
      {breadcrumbJsonLd ? (
        <JsonLd data={breadcrumbJsonLd} id="service-breadcrumb-jsonld" />
      ) : null}

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
            <Icon url={service?.iconUrl ?? null} />
          </div>
          {detail.isLoading ? (
            <>
              <div className="h-12 w-2/3 bg-white/10 rounded mb-6 animate-pulse" />
              <div className="h-4 w-3/4 bg-white/10 rounded animate-pulse" />
            </>
          ) : (
            <>
              <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-6">
                {service?.title}
              </h1>
              {service?.heroTextHtml ? (
                <RichText
                  html={service.heroTextHtml}
                  invert
                  className="prose-lg prose-p:text-zinc-300 prose-strong:text-white"
                />
              ) : null}
            </>
          )}
        </div>
      </section>

      {service?.blurbHtml ? (
        <section className="py-20 bg-background">
          <div className="container mx-auto px-4 max-w-4xl">
            <RichText html={service.blurbHtml} className="prose-lg" />
          </div>
        </section>
      ) : null}

      {service?.secondaryTitle || service?.secondaryTextHtml ? (
        <section className="py-24 bg-card border-y border-border">
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
        <section className="py-24 bg-background">
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

      {service?.methodologies && service.methodologies.length > 0 ? (
        <section className="py-24 bg-card border-y border-border">
          <div className="container mx-auto px-4">
            <div className="max-w-2xl mb-12">
              <p className="text-sm uppercase tracking-widest text-primary mb-3">
                Methodologies
              </p>
              <h2 className="text-3xl md:text-4xl font-bold">How we work</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {service.methodologies.map((m, i) => (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: i * 0.05 }}
                  className="rounded-xl border border-border/60 bg-background/50 p-6"
                >
                  <div className="h-12 w-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-4">
                    {m.iconUrl ? (
                      <img src={m.iconUrl} alt="" className="h-6 w-6 object-contain" loading="lazy" />
                    ) : (
                      <Layers className="h-6 w-6" />
                    )}
                  </div>
                  <h3 className="text-lg font-bold mb-3">{m.title}</h3>
                  <RichText html={m.bodyHtml} className="prose-sm prose-p:text-muted-foreground" />
                </motion.div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="py-24 bg-background">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mb-12">
            <p className="text-sm uppercase tracking-widest text-primary mb-3">
              Solutions
            </p>
            <h2 className="text-3xl md:text-4xl font-bold">What's included</h2>
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
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: i * 0.05 }}
                >
                  <Link
                    href={`/solutions/${s.slug}`}
                    className="group flex flex-col h-full rounded-xl border border-border/60 bg-card p-6 hover:border-primary/40 transition-colors"
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

      {service ? (
        <RelatedContent serviceId={service.id} title={service.title} />
      ) : null}

      <RelatedWorkshopsRail
        serviceId={service?.id ?? null}
        serviceTitle={service?.title ?? null}
      />

      {service?.booking && (
        <section className="py-16 border-t border-border">
          <div className="container mx-auto px-4 max-w-2xl">
            <BookingCard booking={service.booking} />
          </div>
        </section>
      )}

      <section className="relative overflow-hidden bg-card border-t border-border py-24">
        <div className="absolute inset-0 nebula-gradient opacity-10" />
        <div className="container relative z-10 mx-auto px-4 text-center max-w-2xl">
          <h2 className="text-3xl md:text-4xl font-bold mb-6">
            Ready to start a conversation
            {service ? ` about ${service.title.toLowerCase()}` : ""}?
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            Tell us where you are headed. We will tell you where we can help.
          </p>
          <Link
            href="/start"
            className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
          >
            Get Started <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
