import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Meta } from "@/lib/meta";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { ArrowRight, Quote } from "lucide-react";
import { api, type CaseStudyDto } from "@/lib/api";
import { caseStudies as staticCaseStudies } from "@/data/case-studies";
import { clientLogos } from "@/data/logos";
import { LogoRotator } from "@/components/logo-rotator";
import { ReviewJsonLd } from "@/components/review-jsonld";
import { SITE_ORIGIN } from "@/lib/seo-config";
import { PageHero } from "@/components/layout/page-hero";

type DisplayQuote = { quote: string; name: string; org: string };

// Hardcoded defaults used when the DB-backed `client_testimonials`
// table is empty. The /clients page continues to render even if the
// testimonials endpoint is unreachable.
const DEFAULT_QUOTES: DisplayQuote[] = [
  {
    quote:
      "Our journey with the Company Operating System has truly transformed the way we operate and lead. The clear focus on priorities and performance metrics have empowered us to make strategic decisions more effectively.",
    name: "Senior leader",
    org: "North American luxury manufacturer",
  },
  {
    quote:
      "Synozur's impact through this project has truly revolutionized how our employees interact and collaborate, positioning us for greater innovation and success.",
    name: "Vice President of Digital Collaboration",
    org: "North American Energy Company",
  },
  {
    quote:
      "The team finally had a shared way to plan, measure, and adjust together — instead of reinventing the playbook every quarter.",
    name: "Product Marketing Group leader",
    org: "Microsoft Modern Work",
  },
];


export default function Clients() {
  const testimonialsQ = useQuery({
    queryKey: ["testimonials"],
    queryFn: () => api.listTestimonials(),
  });
  const caseStudiesQ = useQuery({
    queryKey: ["case-studies"],
    queryFn: () => api.listCaseStudies(),
  });

  const quotes: DisplayQuote[] = useMemo(() => {
    const items = testimonialsQ.data?.items ?? [];
    if (items.length === 0) return DEFAULT_QUOTES;
    return items.map((t) => ({
      quote: t.quote,
      name: t.authorName,
      org: t.organization,
    }));
  }, [testimonialsQ.data]);

  const caseStudies: Pick<
    CaseStudyDto,
    "slug" | "title" | "heroImage" | "industry" | "summary"
  >[] = useMemo(() => {
    const items = caseStudiesQ.data?.items ?? [];
    if (items.length > 0) return items;
    return staticCaseStudies.map((s) => ({
      slug: s.slug,
      title: s.title,
      heroImage: s.heroImage,
      industry: s.industry,
      summary: s.summary,
    }));
  }, [caseStudiesQ.data]);
  return (
    <div className="w-full">
      <Meta
        title="Our Clients"
        description="Synozur partners with global enterprises and breakout growth companies. With years of experience working with global customers across various industries, we have the insights to tackle complex challenges and drive meaningful change."
      />
      <ReviewJsonLd
        canonicalUrl={`${SITE_ORIGIN}/clients`}
        reviews={(testimonialsQ.data?.items ?? []).map((t) => ({
          quote: t.quote,
          authorName: t.authorName,
          authorRole: t.authorRole,
          organization: t.organization,
        }))}
      />

      <PageHero
        eyebrow="Our Clients"
        title="Global experience and deep expertise."
        subtitle="With years of experience working with global customers across various
            industries, we have the insights to tackle complex challenges and
            drive meaningful change."
        data-testid="clients-hero"
      />

      {/* Logo rotator */}
      <section className="py-12 md:py-16 bg-[hsl(240_35%_10%)] border-b border-border">
        <div className="container mx-auto px-4">
          <p className="text-xs uppercase tracking-[0.25em] text-primary text-center mb-6">
            Trusted by
          </p>
          <LogoRotator logos={clientLogos} />
        </div>
      </section>

      {/* Industries served */}
      <section className="py-24 bg-background border-b border-border">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mb-12">
            <p className="text-sm uppercase tracking-widest text-primary mb-3">
              Industries served
            </p>
            <h2 className="text-3xl md:text-4xl font-bold">
              Patterns we've seen — across sectors
            </h2>
            <p className="mt-4 text-lg text-muted-foreground leading-relaxed">
              We work with Fortune 500 enterprises and breakout growth
              companies. The vocabulary changes by industry; the operating
              questions rarely do.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                title: "Technology & Software",
                body:
                  "Platforms, ISVs, and Microsoft partners moving from product-led to AI-native.",
              },
              {
                title: "Financial Services",
                body:
                  "Banks, insurers, and asset managers modernizing distribution and the workplace around it.",
              },
              {
                title: "Energy & Industrials",
                body:
                  "Operators bringing transformation programs into engineering, field, and back-office teams.",
              },
              {
                title: "Consumer & Retail",
                body:
                  "Brands aligning go-to-market, content, and digital workplace with the pace of category change.",
              },
              {
                title: "Manufacturing & Automotive",
                body:
                  "Global manufacturers connecting strategy to shop-floor adoption and supplier collaboration.",
              },
              {
                title: "Healthcare & Life Sciences",
                body:
                  "Providers, payers, and pharma teams adopting governed AI and modern collaboration patterns.",
              },
              {
                title: "Media & Entertainment",
                body:
                  "Studios and publishers reshaping creative operations around AI-assisted workflows.",
              },
              {
                title: "Professional Services",
                body:
                  "Consultancies and agencies industrializing delivery with shared frameworks and tooling.",
              },
            ].map((row) => (
              <div
                key={row.title}
                className="rounded-2xl border border-border/60 bg-card p-6"
              >
                <h3 className="text-base font-semibold mb-2">{row.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {row.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Case Studies preview */}
      <section className="py-24 bg-card border-y border-border">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row justify-between items-end gap-6 mb-12">
            <div className="max-w-2xl">
              <p className="text-sm uppercase tracking-widest text-primary mb-3">
                Case studies
              </p>
              <h2 className="text-3xl md:text-4xl font-bold">
                The work, in their words
              </h2>
            </div>
            <Link
              href="/case-studies"
              className="inline-flex items-center text-sm font-medium border border-border rounded-md px-4 py-2 hover:bg-muted transition-colors shrink-0"
            >
              View all case studies <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {caseStudies.map((s) => (
              <Link
                key={s.slug}
                href={`/case-studies/${s.slug}`}
                className="group rounded-2xl border border-border/60 bg-background overflow-hidden hover:border-primary/40 transition-colors block"
              >
                <div className="aspect-[16/9] overflow-hidden">
                  <img
                    src={s.heroImage}
                    alt={s.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                </div>
                <div className="p-6">
                  <p className="text-xs uppercase tracking-widest text-primary mb-2">
                    {s.industry}
                  </p>
                  <h3 className="text-lg font-bold mb-2 group-hover:text-primary transition-colors leading-snug">
                    {s.title}
                  </h3>
                  <p className="text-sm text-muted-foreground line-clamp-3">
                    {s.summary}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Quotes */}
      <section className="py-24 bg-card border-y border-border">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="max-w-2xl mb-16">
            <p className="text-sm uppercase tracking-widest text-primary mb-3">
              In their words
            </p>
            <h2 className="text-3xl md:text-4xl font-bold">
              What our clients tell us
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {quotes.map((q, i) => (
              <motion.figure
                key={q.org}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.08 }}
                className="rounded-xl border border-border/60 bg-background/50 p-8 flex flex-col"
              >
                <Quote className="h-7 w-7 text-primary mb-6" />
                <blockquote className="text-base md:text-lg text-foreground/90 leading-relaxed mb-6 flex-1">
                  "{q.quote}"
                </blockquote>
                <figcaption>
                  <p className="font-semibold text-foreground">{q.name}</p>
                  <p className="text-sm text-muted-foreground">{q.org}</p>
                </figcaption>
              </motion.figure>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 bg-background">
        <div className="container mx-auto px-4 text-center max-w-2xl">
          <h2 className="text-3xl md:text-4xl font-bold mb-6">
            See the work in detail
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            Our case studies tell the story of how transformation actually unfolds —
            including the parts most firms leave out.
          </p>
          <Link
            href="/case-studies"
            className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
          >
            View Case Studies <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
