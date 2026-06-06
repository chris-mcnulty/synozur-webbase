import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight, Quote } from "lucide-react";
import { api, type CaseStudyDto } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Social-proof band: surfaces real client pull-quotes and quantified outcomes
 * drawn from published case studies — the highest-converting content on a
 * consulting site, and content the editors already manage (no new admin
 * surface). Reuses the `quote` + `metrics` fields on `CaseStudyDto`.
 *
 * Empty-safe by design: if no published case study has a quote (e.g. sparse
 * data at launch), the component renders nothing rather than an empty shell.
 * Pass `serviceId` / `solutionId` to scope the quotes to a product page.
 */
interface SocialProofProps {
  eyebrow?: string;
  heading?: string;
  /** Scope quotes to a specific service's case studies. */
  serviceId?: string | null;
  /** Scope quotes to a specific solution's case studies. */
  solutionId?: string | null;
  /** Max quote cards to show. */
  limit?: number;
  className?: string;
}

function hasQuote(c: CaseStudyDto): boolean {
  return Boolean(c.quote?.text && c.quote.text.trim().length > 0);
}

// Featured studies first (by featuredRank asc), then the rest in API order.
function rankCaseStudies(items: CaseStudyDto[]): CaseStudyDto[] {
  return [...items].sort((a, b) => {
    if (a.featured !== b.featured) return a.featured ? -1 : 1;
    const ar = a.featuredRank ?? Number.MAX_SAFE_INTEGER;
    const br = b.featuredRank ?? Number.MAX_SAFE_INTEGER;
    return ar - br;
  });
}

export function SocialProof({
  eyebrow = "Proof, not promises",
  heading = "What our clients say",
  serviceId,
  solutionId,
  limit = 3,
  className,
}: SocialProofProps) {
  const { data } = useQuery({
    queryKey: ["case-studies", "social-proof", serviceId ?? null, solutionId ?? null],
    queryFn: () =>
      api.listCaseStudies({
        ...(serviceId ? { serviceId } : {}),
        ...(solutionId ? { solutionId } : {}),
      }),
    staleTime: 5 * 60 * 1000,
  });

  const quotes = useMemo(() => {
    const items = data?.items ?? [];
    return rankCaseStudies(items.filter(hasQuote)).slice(0, Math.max(1, limit));
  }, [data, limit]);

  // Render nothing until we have at least one real quote to show.
  if (quotes.length === 0) return null;

  return (
    <section
      className={cn("py-24 bg-background", className)}
      aria-labelledby="social-proof-heading"
      data-testid="social-proof"
    >
      <div className="container mx-auto px-4">
        <div className="mb-12 text-center">
          <p className="text-sm uppercase tracking-[0.25em] text-primary mb-3">
            {eyebrow}
          </p>
          <h2
            id="social-proof-heading"
            className="text-3xl md:text-4xl font-bold"
          >
            {heading}
          </h2>
        </div>

        <div
          className={cn(
            "grid gap-6",
            quotes.length === 1
              ? "max-w-3xl mx-auto"
              : quotes.length === 2
                ? "md:grid-cols-2 max-w-5xl mx-auto"
                : "md:grid-cols-3",
          )}
        >
          {quotes.map((cs) => {
            const metrics = (cs.metrics ?? [])
              .filter((m) => m.value && m.label)
              .slice(0, 2);
            const attribution =
              cs.quote.attribution?.trim() ||
              cs.clientLabel?.trim() ||
              cs.client?.trim();
            return (
              <Card
                key={cs.id}
                className="flex flex-col border-border/50 bg-card hover-elevate"
              >
                <CardContent className="flex flex-1 flex-col p-8">
                  <Quote
                    className="h-7 w-7 text-primary/60 mb-4"
                    aria-hidden="true"
                  />
                  <blockquote className="text-lg leading-relaxed flex-1">
                    “{cs.quote.text}”
                  </blockquote>
                  {attribution ? (
                    <figcaption className="mt-5 text-sm font-semibold text-muted-foreground">
                      — {attribution}
                    </figcaption>
                  ) : null}

                  {metrics.length > 0 ? (
                    <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-3 border-t border-border/60 pt-5">
                      {metrics.map((m, i) => (
                        <div key={`${m.label}-${i}`}>
                          <dt className="text-2xl font-bold text-primary">
                            {m.value}
                          </dt>
                          <dd className="text-xs uppercase tracking-wide text-muted-foreground">
                            {m.label}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}

                  <Link
                    href={`/case-studies/${cs.slug}`}
                    className="mt-6 inline-flex items-center text-sm font-semibold text-primary hover:text-primary/80 transition-colors"
                    data-testid={`social-proof-link-${cs.slug}`}
                  >
                    Read the case study{" "}
                    <ArrowRight className="ml-1.5 h-4 w-4" />
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}
