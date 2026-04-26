import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Meta } from "@/lib/meta";
import { JsonLd } from "@/components/jsonld";
import { api, type FaqCategoryWithItemsDto, type FaqItemDto } from "@/lib/api";
import { RichText } from "@/components/rich-text";

// Stable anchor format inside the in-page accordion. Same shape as the path
// segments below so the same string can act as both a DOM id and a deep-link
// pointer.
function anchorId(categorySlug: string, itemSlug: string): string {
  return `${categorySlug}/${itemSlug}`;
}

// Strip HTML for the JSON-LD answer body and meta descriptions. Search
// engines and AIO crawlers consume plain text; markup creates snippet noise.
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(s: string, max = 160): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

// Parse the wouter path into (category, item). `useLocation` returns a Wouter-
// relative path, so the `/faq` prefix here is the right one regardless of any
// configured base path.
function parseFaqPath(location: string): {
  categorySlug: string | null;
  itemSlug: string | null;
} {
  const trimmed = location.replace(/^\/+|\/+$/g, "");
  const parts = trimmed.split("/").filter(Boolean);
  if (parts[0] !== "faq") return { categorySlug: null, itemSlug: null };
  return {
    categorySlug: parts[1] ?? null,
    itemSlug: parts[2] ?? null,
  };
}

function buildFaqJsonLd(
  categories: FaqCategoryWithItemsDto[],
  origin: string,
) {
  const mainEntity = categories.flatMap((c) =>
    c.items.map((it) => ({
      "@type": "Question",
      name: it.question,
      // Per-question canonical URL so the structured-data @id matches the
      // sitemap entry and the page that ranks for that question.
      "@id": `${origin}/faq/${c.slug}/${it.slug}`,
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
  const [location] = useLocation();
  const { categorySlug, itemSlug } = parseFaqPath(location);

  const { data, isLoading } = useQuery({
    queryKey: ["faq"],
    queryFn: () => api.listFaq(),
  });

  const categories: FaqCategoryWithItemsDto[] = data?.categories ?? [];

  const activeCategory = useMemo(
    () => (categorySlug ? categories.find((c) => c.slug === categorySlug) ?? null : null),
    [categories, categorySlug],
  );
  const activeItem: FaqItemDto | null = useMemo(() => {
    if (!activeCategory || !itemSlug) return null;
    return activeCategory.items.find((it) => it.slug === itemSlug) ?? null;
  }, [activeCategory, itemSlug]);

  // Controlled accordion state so navigation between deep-link URLs reopens
  // the matching item without remounting the page.
  const [openItems, setOpenItems] = useState<string[]>([]);
  useEffect(() => {
    if (!activeCategory || !activeItem) return;
    const id = anchorId(activeCategory.slug, activeItem.slug);
    setOpenItems((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, [activeCategory, activeItem]);

  // Scroll the targeted question (or category, when no item is named) into
  // view once content has rendered. Native browser hash handling can't do
  // this on its own because the list hydrates asynchronously.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!categories.length) return;

    let targetId: string | null = null;
    if (activeCategory && activeItem) {
      targetId = anchorId(activeCategory.slug, activeItem.slug);
    } else if (activeCategory) {
      targetId = activeCategory.slug;
    } else {
      const hash = window.location.hash.replace(/^#/, "");
      if (hash) targetId = hash;
    }
    if (!targetId) return;

    const el = document.getElementById(targetId);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [categories.length, activeCategory, activeItem]);

  const jsonLd = useMemo(() => {
    if (!categories.length) return null;
    const origin =
      typeof window !== "undefined" ? window.location.origin : "https://www.synozur.com";
    return buildFaqJsonLd(categories, origin);
  }, [categories]);

  // Per-URL meta. A direct hit on an item gets the question as its title and
  // the answer text (or editor-supplied seoDescription) as the description.
  // Category pages get the category name. Bare /faq keeps the section copy.
  const meta = useMemo(() => {
    if (activeItem && activeCategory) {
      const description =
        activeItem.seoDescription ||
        truncate(stripHtml(activeItem.answerHtml)) ||
        `Answer from The Synozur Alliance FAQ.`;
      return {
        title: activeItem.seoTitle || activeItem.question,
        description,
        path: `/faq/${activeCategory.slug}/${activeItem.slug}`,
      };
    }
    if (activeCategory) {
      return {
        title: `${activeCategory.name} — FAQ`,
        description:
          activeCategory.description ||
          `Frequently asked questions about ${activeCategory.name.toLowerCase()} from The Synozur Alliance.`,
        path: `/faq/${activeCategory.slug}`,
      };
    }
    return {
      title: "Frequently Asked Questions",
      description:
        "Answers to the questions we hear most often about working with The Synozur Alliance — engagements, services, AI, Microsoft 365, and more.",
      path: "/faq",
    };
  }, [activeCategory, activeItem]);

  return (
    <div className="w-full">
      <Meta
        title={meta.title}
        description={meta.description}
        path={meta.path}
        rawTitle={Boolean(activeItem)}
      />
      {jsonLd && <JsonLd data={jsonLd} id="faq-jsonld" />}

      <section className="relative overflow-hidden bg-[#0B0B1A] pt-24 pb-12">
        <div className="absolute inset-0 nebula-gradient opacity-25" />
        <div className="container relative z-10 mx-auto px-4 max-w-4xl">
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
                  <Accordion
                    type="multiple"
                    // Each category accordion is controlled with only the
                    // open ids that belong to it, and `onValueChange` merges
                    // back into the global `openItems` set. Otherwise opening
                    // a question in one category would clobber state in
                    // another (Radix only reports the value of the accordion
                    // that fired the event).
                    value={openItems.filter((id) =>
                      c.items.some((it) => anchorId(c.slug, it.slug) === id),
                    )}
                    onValueChange={(next) => {
                      setOpenItems((prev) => [
                        ...prev.filter(
                          (id) =>
                            !c.items.some(
                              (it) => anchorId(c.slug, it.slug) === id,
                            ),
                        ),
                        ...next,
                      ]);
                    }}
                    className="rounded-xl border border-border/60 bg-card divide-y divide-border"
                  >
                    {c.items.map((it) => {
                      const id = anchorId(c.slug, it.slug);
                      const itemUrl = `/faq/${c.slug}/${it.slug}`;
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
                          {/* `forceMount` keeps the answer in the DOM even
                              when collapsed so search engines and LLM
                              crawlers see every Q&A on first paint. Scoped
                              here so it doesn't apply to every Accordion
                              elsewhere in the app. */}
                          <AccordionContent forceMount>
                            <RichText
                              html={it.answerHtml}
                              className="prose-sm"
                            />
                            <div className="mt-3 text-xs text-muted-foreground">
                              <Link
                                href={itemUrl}
                                className="hover:text-foreground"
                                data-testid={`faq-permalink-${c.slug}-${it.slug}`}
                              >
                                Link to this question
                              </Link>
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
