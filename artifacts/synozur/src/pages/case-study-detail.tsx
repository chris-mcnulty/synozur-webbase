import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Meta } from "@/lib/meta";
import { dynamicOgImageUrl } from "@/lib/og-image-url";
import { useRoute, Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Quote } from "lucide-react";
import { api, type CaseStudyDto } from "@/lib/api";
import {
  caseStudies as staticCaseStudies,
  getCaseStudyBySlug as getStaticCaseStudyBySlug,
} from "@/data/case-studies";
import NotFound from "@/pages/not-found";

function staticAsDto(s: (typeof staticCaseStudies)[number]): CaseStudyDto {
  return {
    id: s.slug,
    slug: s.slug,
    title: s.title,
    client: s.client,
    clientLabel: s.clientLabel,
    industry: s.industry,
    established: s.established ?? null,
    tag: s.tag,
    headline: s.headline,
    summary: s.summary,
    heroImage: s.heroImage,
    clientLogo: null,
    challenge: s.challenge,
    approach: s.approach,
    outcome: s.outcome,
    metrics: s.metrics,
    quote: s.quote,
    serviceId: null,
    solutionId: null,
    status: "published",
    publishedAt: null,
    unpublishedAt: null,
    featured: false,
    featuredRank: null,
    seoTitle: null,
    seoDescription: null,
    ogImage: null,
    active: true,
    sourceId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export default function CaseStudyDetail() {
  const [, params] = useRoute("/case-studies/:slug");
  const slug = params?.slug ?? "";

  const detailQ = useQuery({
    queryKey: ["case-studies", slug, "detail"],
    queryFn: () => api.getCaseStudy(slug),
    enabled: slug.length > 0,
    retry: (count, err) => {
      if (err instanceof Error && /404/.test(err.message)) return false;
      return count < 2;
    },
  });

  const relatedQ = useQuery({
    queryKey: ["case-studies"],
    queryFn: () => api.listCaseStudies(),
  });

  const staticFallback = slug ? getStaticCaseStudyBySlug(slug) : undefined;
  const study: CaseStudyDto | undefined = useMemo(() => {
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

  if (!study) {
    return <NotFound />;
  }

  const apiItems = relatedQ.data?.items ?? [];
  const pool =
    apiItems.length > 0 ? apiItems : staticCaseStudies.map(staticAsDto);
  const related = pool.filter((c) => c.slug !== study.slug).slice(0, 2);

  return (
    <div className="w-full">
      <Meta
        title={study.title}
        description={study.summary}
        type="article"
        image={
          study.ogImage ||
          study.heroImage ||
          dynamicOgImageUrl("case-study", study.id, study.updatedAt) ||
          undefined
        }
      />

      <section className="relative overflow-hidden bg-[#0B0B1A] pt-24 pb-20">
        <div className="absolute inset-0 nebula-gradient opacity-15" />
        <div className="container relative z-10 mx-auto px-4 max-w-5xl">
          <Link
            href="/case-studies"
            className="inline-flex items-center text-sm text-zinc-300 hover:text-white mb-8 transition-colors"
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> All case studies
          </Link>
          <div className="flex flex-wrap items-center gap-3 mb-6">
            <span className="inline-block py-1 px-3 rounded-full bg-white/10 border border-white/20 text-white text-xs font-medium backdrop-blur-sm">
              {study.industry}
            </span>
            <span className="inline-block py-1 px-3 rounded-full bg-primary/20 border border-primary/30 text-white text-xs font-medium backdrop-blur-sm">
              {study.tag}
            </span>
            <span className="text-xs uppercase tracking-widest text-zinc-400">
              {study.clientLabel}
            </span>
          </div>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-white mb-6 max-w-4xl">
            {study.title}
          </h1>
          <p className="text-lg md:text-xl text-zinc-300 leading-relaxed max-w-3xl">
            {study.summary}
          </p>
        </div>
      </section>

      <section className="bg-background">
        <div className="container mx-auto px-4 max-w-5xl -mt-12 relative z-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="rounded-2xl overflow-hidden border border-border shadow-2xl aspect-[16/9] bg-card"
          >
            <img
              src={study.heroImage}
              alt={study.title}
              className="w-full h-full object-cover"
            />
          </motion.div>
        </div>
      </section>

      {study.metrics.length > 0 && (
        <section className="py-16 bg-background">
          <div className="container mx-auto px-4 max-w-5xl">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-border rounded-xl overflow-hidden border border-border">
              {study.metrics.map((m) => (
                <div
                  key={m.label}
                  className="bg-card p-8 flex flex-col items-start"
                >
                  <p className="text-2xl md:text-3xl font-bold text-primary mb-2 leading-tight">
                    {m.value}
                  </p>
                  <p className="text-sm text-muted-foreground leading-snug">
                    {m.label}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="py-16 bg-background">
        <div className="container mx-auto px-4 max-w-3xl">
          <p className="text-sm uppercase tracking-widest text-primary mb-3">
            {study.challenge.heading}
          </p>
          <h2 className="text-3xl md:text-4xl font-bold mb-8">
            What the team was facing
          </h2>
          <div className="space-y-5 text-lg text-muted-foreground leading-relaxed">
            {study.challenge.body.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
            {study.challenge.bullets && (
              <ul className="list-disc pl-6 space-y-2 text-base">
                {study.challenge.bullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <section className="py-16 bg-card border-y border-border">
        <div className="container mx-auto px-4 max-w-3xl">
          <p className="text-sm uppercase tracking-widest text-primary mb-3">
            Our approach
          </p>
          <h2 className="text-3xl md:text-4xl font-bold mb-12">
            How Synozur worked the problem
          </h2>
          <div className="space-y-12">
            {study.approach.map((block, i) => (
              <div key={i} className="border-l-2 border-primary/50 pl-6">
                <h3 className="text-xl md:text-2xl font-semibold mb-4">
                  {block.heading}
                </h3>
                <div className="space-y-4 text-muted-foreground leading-relaxed">
                  {block.body.map((p, j) => (
                    <p key={j}>{p}</p>
                  ))}
                  {block.bullets && (
                    <ul className="list-disc pl-6 space-y-2">
                      {block.bullets.map((b, j) => (
                        <li key={j}>{b}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {study.quote.text && (
        <section className="py-20 bg-background">
          <div className="container mx-auto px-4 max-w-3xl">
            <figure className="rounded-2xl border border-border/60 bg-card p-10 md:p-12">
              <Quote className="h-8 w-8 text-primary mb-6" />
              <blockquote className="text-xl md:text-2xl font-medium leading-relaxed text-foreground/90 mb-6">
                "{study.quote.text}"
              </blockquote>
              <figcaption className="text-sm text-muted-foreground">
                — {study.quote.attribution}
              </figcaption>
            </figure>
          </div>
        </section>
      )}

      <section className="py-16 bg-background">
        <div className="container mx-auto px-4 max-w-3xl">
          <p className="text-sm uppercase tracking-widest text-primary mb-3">
            {study.outcome.heading}
          </p>
          <h2 className="text-3xl md:text-4xl font-bold mb-8">
            What changed
          </h2>
          <div className="space-y-5 text-lg text-muted-foreground leading-relaxed">
            {study.outcome.body.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
            {study.outcome.bullets && (
              <ul className="list-disc pl-6 space-y-2 text-base">
                {study.outcome.bullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {related.length > 0 && (
        <section className="py-20 bg-card border-t border-border">
          <div className="container mx-auto px-4 max-w-5xl">
            <p className="text-sm uppercase tracking-widest text-primary mb-3">
              More work
            </p>
            <h2 className="text-2xl md:text-3xl font-bold mb-10">
              Related case studies
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {related.map((r) => (
                <Link
                  key={r.slug}
                  href={`/case-studies/${r.slug}`}
                  className="group rounded-2xl border border-border/60 bg-background overflow-hidden hover:border-primary/40 transition-colors block"
                >
                  <div className="aspect-[16/9] overflow-hidden">
                    <img
                      src={r.heroImage}
                      alt={r.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  </div>
                  <div className="p-6">
                    <span className="text-xs uppercase tracking-widest text-primary">
                      {r.industry}
                    </span>
                    <h3 className="text-lg font-bold mt-2 mb-3 group-hover:text-primary transition-colors leading-snug">
                      {r.title}
                    </h3>
                    <span className="inline-flex items-center text-sm text-muted-foreground group-hover:text-primary">
                      Read <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="relative overflow-hidden bg-card border-t border-border py-20">
        <div className="absolute inset-0 nebula-gradient opacity-10" />
        <div className="container relative z-10 mx-auto px-4 text-center max-w-2xl">
          <h2 className="text-3xl md:text-4xl font-bold mb-6">
            Ready for the next chapter of your transformation?
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            Tell us where you are headed. We will tell you honestly what it would take to get there.
          </p>
          <Link
            href="/start"
            className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
          >
            Start the conversation <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
