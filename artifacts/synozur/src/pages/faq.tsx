import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Meta } from "@/lib/meta";
import { JsonLd } from "@/components/jsonld";
import { api, type FaqCategoryWithItemsDto } from "@/lib/api";

// Stable anchor format: "#{category-slug}/{question-slug}". This must match
// the anchor IDs we emit below so SERP snippets and AI citations can
// deep-link to the exact question.
function anchorId(categorySlug: string, itemSlug: string): string {
  return `${categorySlug}/${itemSlug}`;
}

// Strip HTML for the JSON-LD answer body. Search engines and AIO crawlers
// consume plain text; keeping markup out avoids snippet clutter.
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildFaqJsonLd(
  categories: FaqCategoryWithItemsDto[],
  origin: string,
) {
  const mainEntity = categories.flatMap((c) =>
    c.items.map((it) => ({
      "@type": "Question",
      name: it.question,
      "@id": `${origin}/faq#${anchorId(c.slug, it.slug)}`,
      acceptedAnswer: {
        "@type": "Answer",
        text: stripHtml(it.answerHtml) || it.question,
      },
    })),
  );
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity,
  };
}

export default function Faq() {
  const { data, isLoading } = useQuery({
    queryKey: ["faq"],
    queryFn: () => api.listFaq(),
  });

  const categories: FaqCategoryWithItemsDto[] = data?.categories ?? [];

  // If the URL arrived with a hash matching a known anchor, scroll to it
  // once content has rendered. Native browser behavior won't do this on its
  // own because the list hydrates asynchronously.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash || !categories.length) return;
    const el = document.getElementById(hash);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [categories.length]);

  const jsonLd = useMemo(() => {
    if (!categories.length) return null;
    const origin =
      typeof window !== "undefined" ? window.location.origin : "https://www.synozur.com";
    return buildFaqJsonLd(categories, origin);
  }, [categories]);

  return (
    <div className="w-full">
      <Meta
        title="Frequently Asked Questions"
        description="Answers to the questions we hear most often about working with The Synozur Alliance — engagements, services, AI, Microsoft 365, and more."
        path="/faq"
      />
      {jsonLd && <JsonLd data={jsonLd} id="faq-jsonld" />}

      <section className="bg-[#0B0B1A] pt-24 pb-12">
        <div className="container mx-auto px-4 max-w-4xl">
          <p className="text-sm uppercase tracking-[0.25em] text-primary mb-4">
            FAQ
          </p>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-white mb-4">
            Frequently asked questions
          </h1>
          <p className="text-lg md:text-xl text-zinc-300 max-w-3xl">
            Answers to the questions we hear most often — about engagements,
            services, and the way we work.
          </p>
        </div>
      </section>

      <section className="bg-background py-12">
        <div className="container mx-auto px-4 max-w-4xl">
          {isLoading ? (
            <div className="text-muted-foreground">Loading…</div>
          ) : categories.length === 0 ? (
            <div className="rounded-2xl border border-border/60 bg-card p-12 text-center text-muted-foreground">
              No questions yet.
            </div>
          ) : (
            <div className="space-y-12">
              {categories.map((c) => (
                <section key={c.id} data-testid={`faq-category-${c.slug}`}>
                  <h2
                    id={c.slug}
                    className="text-2xl font-semibold mb-2 scroll-mt-24"
                  >
                    {c.name}
                  </h2>
                  {c.description && (
                    <p className="text-muted-foreground mb-4">{c.description}</p>
                  )}
                  <Accordion type="multiple" className="rounded-xl border border-border/60 bg-card divide-y divide-border">
                    {c.items.map((it) => {
                      const id = anchorId(c.slug, it.slug);
                      return (
                        <AccordionItem
                          key={it.id}
                          value={id}
                          className="px-4 border-b-0 last:border-b-0 scroll-mt-24"
                          data-testid={`faq-item-${c.slug}-${it.slug}`}
                        >
                          {/* Separate anchor target so a direct link lands at
                              the card top, independent of the Radix Accordion
                              internals. */}
                          <span id={id} className="block -mt-24 pt-24" aria-hidden />
                          <AccordionTrigger className="text-left font-medium">
                            {it.question}
                          </AccordionTrigger>
                          <AccordionContent>
                            <div
                              className="prose prose-sm dark:prose-invert max-w-none"
                              dangerouslySetInnerHTML={{ __html: it.answerHtml }}
                            />
                            <div className="mt-3 text-xs text-muted-foreground">
                              <a
                                href={`#${id}`}
                                className="hover:text-foreground"
                                data-testid={`faq-permalink-${c.slug}-${it.slug}`}
                              >
                                Link to this question
                              </a>
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      );
                    })}
                  </Accordion>
                </section>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
