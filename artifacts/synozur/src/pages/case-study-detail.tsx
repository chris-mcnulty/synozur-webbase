import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Meta } from "@/lib/meta";
import { dynamicOgImageUrl } from "@/lib/og-image-url";
import { useRoute, Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Quote } from "lucide-react";
import { ShareRail } from "@/components/share-rail";
import { api, type CaseStudyDto } from "@/lib/api";
import {
  caseStudies as staticCaseStudies,
  getCaseStudyBySlug as getStaticCaseStudyBySlug,
} from "@/data/case-studies";
import NotFound from "@/pages/not-found";
import Gone from "@/pages/gone";
import { ApiError } from "@/lib/api";

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
    atAGlance: null,
    whatWeDid: null,
    whyItWorked: null,
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
    if (detailQ.error instanceof ApiError && detailQ.error.status === 410) {
      return <Gone kind="case-study" />;
    }
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

      {/* ── Desktop proof panel: metrics left 1/3 | image+quote right 2/3 ── */}
      <section className="bg-background">
        <div className="container mx-auto px-4 max-w-5xl -mt-12 relative z-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="rounded-2xl overflow-hidden border border-border shadow-2xl bg-card flex flex-col lg:flex-row min-h-[420px]"
          >
            {/* Left: metrics chicklets — hidden when no metrics */}
            {study.metrics.length > 0 && (
              <div className="lg:w-1/3 flex flex-col divide-y divide-border border-b lg:border-b-0 lg:border-r border-border bg-card">
                {study.metrics.map((m) => (
                  <div key={m.label} className="flex-1 flex flex-col justify-center p-8">
                    <p className="text-3xl lg:text-4xl font-bold text-primary mb-2 leading-none">
                      {m.value}
                    </p>
                    <p className="text-sm text-muted-foreground leading-snug">
                      {m.label}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Right: hero image + darkening overlay + quote */}
            <div className={`relative overflow-hidden ${study.metrics.length > 0 ? "lg:w-2/3" : "w-full"} min-h-[280px] lg:min-h-0`}>
              <img
                src={study.heroImage}
                alt={study.title}
                className="absolute inset-0 w-full h-full object-cover"
              />
              {/* Darkening gradient — stronger at bottom where quote sits */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-black/10" />

              {/* Quote overlaid on image */}
              {study.quote.text && (
                <div className="absolute inset-x-0 bottom-0 p-7 lg:p-9">
                  <Quote className="h-5 w-5 text-primary mb-3 opacity-80" />
                  <blockquote className="text-white text-base lg:text-lg font-medium leading-snug mb-3 drop-shadow">
                    "{study.quote.text}"
                  </blockquote>
                  <figcaption className="text-xs text-white/60 tracking-wide">
                    — {study.quote.attribution}
                  </figcaption>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      </section>

      {(study.atAGlance || study.whatWeDid || study.whyItWorked) && (
        <section className="py-12 bg-background">
          <div className="container mx-auto px-4 max-w-5xl">
            <div className={`grid grid-cols-1 gap-4 ${[study.atAGlance, study.whatWeDid, study.whyItWorked].filter(Boolean).length === 2 ? "md:grid-cols-2" : "md:grid-cols-3"}`}>
              {study.atAGlance && (
                <div className="rounded-xl border border-border bg-card p-6">
                  <p className="text-xs uppercase tracking-widest text-primary mb-3 font-medium">At a Glance</p>
                  <p className="text-sm text-muted-foreground leading-relaxed">{study.atAGlance}</p>
                </div>
              )}
              {study.whatWeDid && (
                <div className="rounded-xl border border-border bg-card p-6">
                  <p className="text-xs uppercase tracking-widest text-primary mb-3 font-medium">What We Did</p>
                  <p className="text-sm text-muted-foreground leading-relaxed">{study.whatWeDid}</p>
                </div>
              )}
              {study.whyItWorked && (
                <div className="rounded-xl border border-border bg-card p-6">
                  <p className="text-xs uppercase tracking-widest text-primary mb-3 font-medium">Why It Worked</p>
                  <p className="text-sm text-muted-foreground leading-relaxed">{study.whyItWorked}</p>
                </div>
              )}
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

      <section className="bg-background py-10">
        <div className="container mx-auto px-4 max-w-3xl">
          <ShareRail kind="case-study" label="case study" title={study.title} className="" />
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
