import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Meta } from "@/lib/meta";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { api, type CaseStudyDto } from "@/lib/api";
import { caseStudies as staticCaseStudies } from "@/data/case-studies";
import { cn } from "@/lib/utils";

const ALL = "All";

// Adapt the legacy static-TS case study shape to the DTO surface so the
// page code reads from a single type regardless of source.
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

export default function CaseStudies() {
  const [industry, setIndustry] = useState<string>(ALL);
  const [tag, setTag] = useState<string>(ALL);

  const listQ = useQuery({
    queryKey: ["case-studies"],
    queryFn: () => api.listCaseStudies(),
  });

  // When the table is empty or unreachable, fall back to the legacy
  // static data so the page keeps rendering. Lets the migration to
  // DB-backed case studies happen in the background without breaking
  // the public site.
  const studies: CaseStudyDto[] = useMemo(() => {
    const apiItems = listQ.data?.items ?? [];
    if (apiItems.length > 0) return apiItems;
    return staticCaseStudies.map(staticAsDto);
  }, [listQ.data]);

  const industries = useMemo(
    () => [ALL, ...Array.from(new Set(studies.map((s) => s.industry).filter(Boolean)))],
    [studies],
  );
  const tags = useMemo(
    () => [ALL, ...Array.from(new Set(studies.map((s) => s.tag).filter(Boolean)))],
    [studies],
  );

  const filtered = useMemo(
    () =>
      studies.filter(
        (s) =>
          (industry === ALL || s.industry === industry) &&
          (tag === ALL || s.tag === tag),
      ),
    [studies, industry, tag],
  );

  const isFiltered = industry !== ALL || tag !== ALL;

  return (
    <div className="w-full">
      <Meta
        title="Case Studies"
        description="Selected stories of transformation. The strategies, the work, and the outcomes."
      />

      <section className="relative overflow-hidden bg-[#0B0B1A] py-32">
        <div className="absolute inset-0 nebula-gradient opacity-25" />
        <div className="container relative z-10 mx-auto px-4 max-w-4xl">
          <p className="text-sm uppercase tracking-widest text-primary mb-4">
            Our Projects
          </p>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-6">
            Selected case studies
          </h1>
          <p className="text-xl md:text-2xl text-zinc-300 leading-relaxed max-w-3xl">
            At Synozur, we drive impactful change through strategy and craft.
            These are a few of the engagements we are able to share publicly —
            many more are available under NDA.
          </p>
        </div>
      </section>

      <section className="py-24 bg-background">
        <div className="container mx-auto px-4">
          <div className="mb-10 space-y-5" data-testid="case-study-filters">
            <FilterRow
              label="Industry"
              options={industries}
              selected={industry}
              onSelect={setIndustry}
              testIdPrefix="filter-industry"
            />
            <FilterRow
              label="Service"
              options={tags}
              selected={tag}
              onSelect={setTag}
              testIdPrefix="filter-tag"
            />
            <div className="flex items-center justify-between gap-4 pt-2 border-t border-border/50">
              <p
                className="text-sm text-muted-foreground"
                data-testid="case-study-count"
              >
                Showing {filtered.length} of {studies.length}{" "}
                {studies.length === 1 ? "case study" : "case studies"}
              </p>
              {isFiltered && (
                <button
                  type="button"
                  onClick={() => {
                    setIndustry(ALL);
                    setTag(ALL);
                  }}
                  className="text-sm font-medium text-primary hover:underline"
                  data-testid="filter-reset"
                >
                  Reset filters
                </button>
              )}
            </div>
          </div>

          {filtered.length === 0 ? (
            <div
              className="rounded-2xl border border-dashed border-border bg-card/50 py-20 text-center px-6"
              data-testid="case-study-empty"
            >
              <h2 className="text-2xl font-semibold mb-3">
                No case studies match these filters
              </h2>
              <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                Try a different combination, or reset to see every story we can
                share publicly.
              </p>
              <button
                type="button"
                onClick={() => {
                  setIndustry(ALL);
                  setTag(ALL);
                }}
                className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
                data-testid="filter-reset-empty"
              >
                Reset filters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {filtered.map((s, i) => (
                <motion.article
                  key={s.slug}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: i * 0.05 }}
                  className="group rounded-2xl border border-border/60 bg-card overflow-hidden hover:border-primary/40 transition-colors"
                >
                  <Link href={`/case-studies/${s.slug}`} className="block">
                    <div className="relative aspect-[4/3] overflow-hidden">
                      <img
                        src={s.heroImage}
                        alt={s.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                      <div className="absolute bottom-0 left-0 right-0 p-6 flex items-center gap-2">
                        <span className="inline-block py-1 px-3 rounded-full bg-white/15 border border-white/25 text-white text-xs font-medium backdrop-blur-md">
                          {s.industry}
                        </span>
                        <span className="inline-block py-1 px-3 rounded-full bg-primary/30 border border-primary/40 text-white text-xs font-medium backdrop-blur-md">
                          {s.tag}
                        </span>
                      </div>
                    </div>
                    <div className="p-7">
                      <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
                        {s.clientLabel}
                      </p>
                      <h2 className="text-xl font-bold mb-3 leading-snug group-hover:text-primary transition-colors">
                        {s.title}
                      </h2>
                      <p className="text-muted-foreground mb-6 leading-relaxed line-clamp-3">
                        {s.summary}
                      </p>
                      <div className="flex items-center justify-between pt-4 border-t border-border/50">
                        <span className="text-sm font-semibold text-primary leading-tight pr-3">
                          {s.headline}
                        </span>
                        <span className="inline-flex items-center text-sm text-muted-foreground group-hover:text-primary shrink-0">
                          Read{" "}
                          <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                        </span>
                      </div>
                    </div>
                  </Link>
                </motion.article>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="relative overflow-hidden bg-card border-t border-border py-24">
        <div className="absolute inset-0 nebula-gradient opacity-10" />
        <div className="container relative z-10 mx-auto px-4 text-center max-w-2xl">
          <h2 className="text-3xl md:text-4xl font-bold mb-6">
            Curious about a specific industry?
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            We share more detailed case material under NDA. Tell us what you are
            working on and we will send what is most relevant.
          </p>
          <Link
            href="/contact"
            className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
          >
            Request case material <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}

type FilterRowProps = {
  label: string;
  options: string[];
  selected: string;
  onSelect: (value: string) => void;
  testIdPrefix: string;
};

function FilterRow({
  label,
  options,
  selected,
  onSelect,
  testIdPrefix,
}: FilterRowProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
      <span className="text-xs uppercase tracking-widest text-muted-foreground sm:w-24 shrink-0">
        {label}
      </span>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isActive = option === selected;
          return (
            <button
              key={option}
              type="button"
              onClick={() => onSelect(option)}
              aria-pressed={isActive}
              className={cn(
                "inline-flex items-center rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-foreground border-border hover:border-primary/50 hover:text-primary",
              )}
              data-testid={`${testIdPrefix}-${option
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/(^-|-$)/g, "")}`}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}
