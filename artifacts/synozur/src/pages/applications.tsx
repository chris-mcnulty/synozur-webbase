import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Meta } from "@/lib/meta";
import { useParentPage } from "@/lib/parent-page";
import { Link } from "wouter";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Compass,
  ExternalLink,
  Gift,
  Layers,
  Lightbulb,
  Network,
  Shield,
  type LucideProps,
} from "lucide-react";
import { api, type ApplicationDto } from "@/lib/api";
import { getActiveApplications } from "@/data/applications";
import { useOverride } from "@/lib/experiments";
import { CtaBlock } from "@/components/cta/CtaBlock";

const APP_ICON_MAP: Record<string, React.ComponentType<LucideProps>> = {
  vega: BarChart3,
  nebula: Lightbulb,
  constellation: Network,
  orion: Compass,
  orbit: Activity,
  zenith: Shield,
  "holidays-and-birthdays-web-part": Gift,
};

function AppIcon({ slug, className }: { slug: string; className?: string }) {
  const Icon = APP_ICON_MAP[slug] ?? Layers;
  return <Icon className={className ?? "h-6 w-6"} />;
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
    audience: null,
    userGuideUrl: null,
    showInNav: true,
    status: "published",
    publishedAt: null,
    unpublishedAt: null,
    featured: false,
    featuredRank: null,
    seoTitle: null,
    seoDescription: null,
    ogImage: null,
    active: s.isActive,
    serviceId: null,
    solutionId: null,
    bookingId: null,
    sourceId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export default function Applications() {
  const listQ = useQuery({
    queryKey: ["applications"],
    queryFn: () => api.listApplications(),
  });

  const apps: ApplicationDto[] = useMemo(() => {
    const items = listQ.data?.items ?? [];
    if (items.length > 0) return items;
    return getActiveApplications().map(staticAsDto);
  }, [listQ.data]);

  const copy = useParentPage("applications", {
    heroEyebrow: "Our Applications",
    heroHeadline: "A constellation of products",
    heroSubhead:
      "Purpose-built platforms that turn Synozur's frameworks, research, and advisory experience into software your teams can use every day.",
    seoTitle: "Applications",
    seoDescription:
      "Synozur's portfolio of AI-powered applications — Vega, Nebula, Constellation, Orion, Orbit, Zenith, and more.",
  });
  const heroEyebrow = useOverride<string>(
    "applications.hero.eyebrow",
    copy.heroEyebrow,
  );
  const heroHeadline = useOverride<string>(
    "applications.hero.headline",
    copy.heroHeadline,
  );
  const heroBody = useOverride<string>(
    "applications.hero.body",
    copy.heroSubhead,
  );

  return (
    <div className="w-full">
      <Meta
        title={copy.seoTitle}
        description={copy.seoDescription}
        path="/applications"
        image={copy.ogImage}
      />

      <section className="relative overflow-hidden bg-[#0B0B1A] py-24 md:py-32">
        <div aria-hidden="true" className="absolute inset-0 nebula-gradient opacity-25" />
        <div className="container relative z-10 mx-auto px-4 max-w-4xl">
          <p className="text-sm uppercase tracking-widest text-primary mb-4">
            {heroEyebrow}
          </p>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-6">
            {heroHeadline}
          </h1>
          <p className="text-xl md:text-2xl text-zinc-300 leading-relaxed max-w-3xl">
            {heroBody}
          </p>
          {copy.introHtml && (
            <div
              className="prose prose-invert max-w-3xl mt-6 text-zinc-300"
              dangerouslySetInnerHTML={{ __html: copy.introHtml }}
            />
          )}
        </div>
      </section>

      <section className="py-24 bg-background">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {apps.map((app, i) => {
              // Top row of cards is above the fold on a 1350x940 desktop
              // Lighthouse run, so eager-load + high-priority hint those
              // screenshots — keeps them out of the `lcp-lazy-loaded` and
              // `prioritize-lcp-image` audits. Remaining rows stay lazy.
              const aboveFold = i < 3;
              return (
                <article
                  key={app.slug}
                  className="group rounded-2xl border border-border/60 bg-card overflow-hidden hover:border-primary/40 transition-colors flex flex-col"
                  data-testid={`app-card-${app.slug}`}
                >
                  <Link
                    href={`/applications/${app.slug}`}
                    className="block aspect-[16/10] overflow-hidden bg-[#0B0B1A]"
                    aria-label={`View details for ${app.name}`}
                  >
                    <img
                      src={app.screenshot}
                      alt={`${app.name} screenshot`}
                      width={1280}
                      height={800}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      loading={aboveFold ? "eager" : "lazy"}
                      decoding="async"
                      fetchPriority={aboveFold ? "high" : "auto"}
                    />
                  </Link>
                  <div className="p-7 flex-1 flex flex-col">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="h-12 w-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                        <AppIcon slug={app.slug} className="h-6 w-6" />
                      </div>
                      <div>
                        <h2 className="text-xl font-bold leading-snug group-hover:text-primary transition-colors">
                          {app.name}
                        </h2>
                        {app.version && (
                          <p className="text-xs uppercase tracking-widest text-muted-foreground">
                            v{app.version}
                          </p>
                        )}
                      </div>
                    </div>
                    <p className="text-sm font-medium text-primary mb-2">
                      {app.tagline}
                    </p>
                    <p className="text-xs text-muted-foreground mb-3">
                      <span className="font-medium text-foreground">Who it's for:</span>{" "}
                      {app.audience ??
                        "Leaders and teams putting AI to work across the business."}
                    </p>
                    <p className="text-muted-foreground mb-6 leading-relaxed text-sm flex-1">
                      {app.shortSummary}
                    </p>
                    <div className="flex items-center justify-between pt-4 border-t border-border/50 gap-3">
                      <Link
                        href={`/applications/${app.slug}`}
                        className="text-sm font-semibold text-foreground hover:text-primary inline-flex items-center"
                        data-testid={`app-learn-more-${app.slug}`}
                        aria-label={`Learn more about ${app.name}`}
                      >
                        Learn more
                        <ArrowRight className="ml-1.5 h-4 w-4 transition-transform group-hover:translate-x-1" />
                      </Link>
                      {app.websiteUrl && (
                        <a
                          href={app.websiteUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-muted-foreground hover:text-primary inline-flex items-center"
                          data-testid={`app-open-${app.slug}`}
                          aria-label={`Open ${app.name} website (opens in new tab)`}
                        >
                          Open
                          <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="py-12 bg-background border-t border-border/50">
        <div className="container mx-auto px-4 max-w-3xl text-center">
          <p className="text-sm text-muted-foreground">
            All Synozur applications are hosted in SOC&nbsp;2 Type&nbsp;II certified data centers.
            For details on how we protect your data, see our{" "}
            <Link href="/trust" className="text-primary hover:text-primary/80 transition-colors">
              Trust &amp; Security page
            </Link>
            .
          </p>
        </div>
      </section>

      <CtaBlock
        intent="talk"
        source="applications"
        heading="Want to see one in action?"
        body="Each Synozur application is built on the same frameworks our advisors use with clients. Tell us what you're working on and we'll point you to the right one."
        ctaLabel="Talk to us"
        secondary={{ label: "Book a walkthrough", href: "/book" }}
      />
    </div>
  );
}
