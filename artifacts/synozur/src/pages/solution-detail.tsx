import { Meta } from "@/lib/meta";
import { motion } from "framer-motion";
import { Link, useRoute } from "wouter";
import { ArrowRight, Layers } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { RichText } from "@/components/rich-text";
import { RelatedContent } from "@/components/related-content";
import NotFound from "./not-found";
import { JsonLd } from "@/components/jsonld";
import { SITE_NAME, SITE_ORIGIN } from "@/lib/seo-config";

function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
}

function isLightHex(hex: string | null | undefined): boolean {
  if (!hex) return false;
  const m = hex.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return false;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  // Perceived luminance.
  return r * 0.299 + g * 0.587 + b * 0.114 > 180;
}

export default function SolutionDetail() {
  const [, params] = useRoute("/solutions/:slug");
  const slug = params?.slug ?? "";
  const previewToken =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("preview")
      : null;
  const q = useQuery({
    queryKey: ["solutions", slug, previewToken ?? ""],
    queryFn: () => api.getSolution(slug, previewToken),
    enabled: slug.length > 0,
    retry: (count, err) => {
      if (err instanceof Error && /404/.test(err.message)) return false;
      return count < 2;
    },
  });

  if (q.isError && q.error instanceof Error && /404/.test(q.error.message)) {
    return <NotFound />;
  }

  if (q.isError) {
    return (
      <div className="w-full">
        <Meta title="Solution" />
        <section className="py-32 bg-background">
          <div className="container mx-auto px-4 max-w-2xl text-center">
            <h1 className="text-3xl md:text-4xl font-bold mb-4">
              We couldn't load this solution
            </h1>
            <p className="text-muted-foreground mb-8">
              Something went wrong reaching our content service. Please try
              again, or browse all of our services.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => q.refetch()}
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

  const sol = q.data;
  // Hero color comes from Wix; if it would be unreadable on the dark hero,
  // fall back to the default light text instead of trusting the value blindly.
  const heroColor = sol?.heroTextColor ?? null;
  const heroStyle =
    heroColor && isLightHex(heroColor) ? { color: heroColor } : undefined;

  const seoDescription =
    sol?.seoDescription || stripHtml(sol?.blurbHtml) || sol?.blurbCopy || undefined;
  const solutionJsonLd = sol
    ? {
        "@context": "https://schema.org",
        "@type": "Service",
        name: sol.title,
        url: `${SITE_ORIGIN}/solutions/${sol.slug}`,
        ...(seoDescription ? { description: seoDescription } : {}),
        ...(sol.iconUrl ? { image: sol.iconUrl } : {}),
        provider: {
          "@type": "Organization",
          name: SITE_NAME,
          url: SITE_ORIGIN,
        },
        ...(sol.parentService
          ? {
              isRelatedTo: {
                "@type": "Service",
                name: sol.parentService.title,
                url: `${SITE_ORIGIN}/services/${sol.parentService.slug}`,
              },
            }
          : {}),
      }
    : null;

  return (
    <div className="w-full">
      <Meta
        title={sol?.seoTitle || sol?.title || "Solution"}
        description={seoDescription || undefined}
        image={sol?.iconUrl ?? undefined}
        rawTitle={!!sol?.seoTitle}
      />
      {solutionJsonLd ? <JsonLd data={solutionJsonLd} id="solution-jsonld" /> : null}

      <section className="relative overflow-hidden bg-[#0B0B1A] py-32">
        <div className="absolute inset-0 nebula-gradient opacity-25" />
        <div className="container relative z-10 mx-auto px-4 max-w-4xl">
          {sol?.parentService ? (
            <Link
              href={`/services/${sol.parentService.slug}`}
              className="text-sm text-zinc-400 hover:text-white inline-flex items-center mb-8"
            >
              ← Back to {sol.parentService.title}
            </Link>
          ) : (
            <Link
              href="/services-overview/default"
              className="text-sm text-zinc-400 hover:text-white inline-flex items-center mb-8"
            >
              ← All Services
            </Link>
          )}
          <div className="h-16 w-16 rounded-2xl bg-primary/20 text-primary flex items-center justify-center mb-8">
            {sol?.iconUrl ? (
              <img src={sol.iconUrl} alt="" className="h-8 w-8 object-contain" loading="lazy" />
            ) : (
              <Layers className="h-8 w-8" />
            )}
          </div>
          {q.isLoading || !sol ? (
            <>
              <div className="h-12 w-2/3 bg-white/10 rounded mb-6 animate-pulse" />
              <div className="h-4 w-3/4 bg-white/10 rounded animate-pulse" />
            </>
          ) : (
            <>
              <h1
                className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-6"
                style={heroStyle}
              >
                {sol.title}
              </h1>
              {sol.heroTextHtml ? (
                <RichText
                  html={sol.heroTextHtml}
                  invert
                  className="prose-lg prose-p:text-zinc-300 prose-strong:text-white"
                />
              ) : null}
            </>
          )}
        </div>
      </section>

      {sol?.blurbHtml ? (
        <section className="py-20 bg-background">
          <div className="container mx-auto px-4 max-w-4xl">
            <RichText html={sol.blurbHtml} className="prose-lg" />
          </div>
        </section>
      ) : null}

      {sol?.secondaryTitle || sol?.secondaryTextHtml ? (
        <section className="py-24 bg-card border-y border-border">
          <div className="container mx-auto px-4 max-w-4xl">
            {sol.secondaryTitle ? (
              <h2 className="text-3xl md:text-4xl font-bold mb-6">
                {sol.secondaryTitle}
              </h2>
            ) : null}
            <RichText html={sol.secondaryTextHtml} className="prose-lg" />
          </div>
        </section>
      ) : null}

      {sol?.ourApproachTitle || sol?.ourApproachTextHtml ? (
        <section className="py-24 bg-background">
          <div className="container mx-auto px-4 max-w-4xl">
            <p className="text-sm uppercase tracking-widest text-primary mb-3">
              Our Approach
            </p>
            {sol.ourApproachTitle ? (
              <h2 className="text-3xl md:text-4xl font-bold mb-6">
                {sol.ourApproachTitle}
              </h2>
            ) : null}
            <RichText html={sol.ourApproachTextHtml} />
          </div>
        </section>
      ) : null}

      {sol?.capabilities && sol.capabilities.length > 0 ? (
        <section className="py-24 bg-card border-y border-border">
          <div className="container mx-auto px-4">
            <div className="max-w-2xl mb-12">
              <p className="text-sm uppercase tracking-widest text-primary mb-3">
                Capabilities
              </p>
              <h2 className="text-3xl md:text-4xl font-bold">What's included</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {sol.capabilities.map((c, i) => (
                <motion.div
                  key={c.id}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: i * 0.05 }}
                  className="rounded-xl border border-border/60 bg-background/50 p-6"
                >
                  <div className="h-12 w-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-4">
                    {c.iconUrl ? (
                      <img src={c.iconUrl} alt="" className="h-6 w-6 object-contain" loading="lazy" />
                    ) : (
                      <Layers className="h-6 w-6" />
                    )}
                  </div>
                  <h3 className="text-lg font-bold mb-3">{c.title}</h3>
                  <RichText html={c.bodyHtml} className="prose-sm prose-p:text-muted-foreground" />
                </motion.div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {sol ? (
        <RelatedContent
          solutionId={sol.id}
          title={sol.title}
          fallback={
            sol.parentService ? { serviceId: sol.parentService.id } : undefined
          }
        />
      ) : null}

      <section className="relative overflow-hidden bg-background border-t border-border py-24">
        <div className="container relative z-10 mx-auto px-4 text-center max-w-2xl">
          <h2 className="text-3xl md:text-4xl font-bold mb-6">
            Ready to talk{sol ? ` about ${sol.title.toLowerCase()}` : ""}?
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            Tell us where you are headed. We will tell you where we can help.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/start"
              className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
            >
              Get Started <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
            {sol?.parentService ? (
              <Link
                href={`/services/${sol.parentService.slug}`}
                className="inline-flex h-12 items-center justify-center rounded-md border border-border px-8 text-base font-medium text-foreground hover:bg-muted/50"
              >
                Back to {sol.parentService.title}
              </Link>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
