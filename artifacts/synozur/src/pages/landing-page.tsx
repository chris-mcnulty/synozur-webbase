import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, ExternalLink, Sparkles } from "lucide-react";
import { Meta } from "@/lib/meta";
import { JsonLd } from "@/components/jsonld";
import { sanitizeHtml } from "@/components/rich-text";
import { SITE_NAME, SITE_ORIGIN } from "@/lib/seo-config";
import {
  landingPagesApi,
  LandingPagesApiError,
  type LandingPageBlock,
  type LandingPageDto,
  type CardGridCard,
  type LandingPageCTA,
} from "@/lib/api-landing-pages";
import NotFound from "@/pages/not-found";

// Public renderer for DB-backed landing pages. Mounted at the public
// wildcard route `/:slug` — App.tsx delegates here for any single-segment
// path that doesn't match a code-defined route. If the slug isn't a
// published landing page we render the standard 404.

interface Props {
  slug: string;
}

const LEVEL_CLASS_FALLBACK =
  "bg-zinc-500/10 text-zinc-300 ring-1 ring-inset ring-zinc-400/20";

const LEVEL_CLASS: Record<string, string> = {
  Beginner: "bg-emerald-500/10 text-emerald-300 ring-1 ring-inset ring-emerald-400/20",
  Intermediate: "bg-amber-500/10 text-amber-300 ring-1 ring-inset ring-amber-400/20",
  Advanced: "bg-fuchsia-500/10 text-fuchsia-300 ring-1 ring-inset ring-fuchsia-400/20",
};

// Treat anything with an explicit URI scheme (or a protocol-relative `//`
// prefix) as external — `mailto:`, `tel:`, `sms:`, `https:` etc. all need
// to leave wouter's client-side `<Link>` and let the browser handle the
// navigation. Path-relative hrefs (e.g. `/contact`) stay internal.
function isExternal(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//");
}

function Cta({ cta }: { cta: LandingPageCTA }) {
  const isPrimary = (cta.variant ?? "primary") === "primary";
  const cls = isPrimary
    ? "inline-flex h-11 items-center justify-center gap-1.5 rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground hover:bg-primary/90"
    : "inline-flex h-11 items-center justify-center rounded-md border border-white/20 bg-white/5 px-6 text-sm font-medium text-white hover:bg-white/10";
  if (isExternal(cta.href)) {
    return (
      <a href={cta.href} target="_blank" rel="noopener noreferrer" className={cls}>
        {cta.label}
        {isPrimary && <ArrowRight className="h-4 w-4" />}
      </a>
    );
  }
  return (
    <Link href={cta.href} className={cls}>
      {cta.label}
      {isPrimary && <ArrowRight className="h-4 w-4" />}
    </Link>
  );
}

function HeroSection(block: Extract<LandingPageBlock, { type: "hero" }>) {
  const dark = (block.theme ?? "nebula") === "nebula";
  return (
    <section
      className={
        dark
          ? "relative overflow-hidden bg-[#0B0B1A] py-24 md:py-32"
          : "relative overflow-hidden bg-background py-24 md:py-32"
      }
    >
      {dark && <div className="absolute inset-0 nebula-gradient opacity-25" />}
      <div className="container relative z-10 mx-auto max-w-4xl px-4">
        {block.eyebrow && (
          <p
            className={
              "mb-4 inline-flex items-center gap-2 text-sm uppercase tracking-widest " +
              (dark ? "text-primary" : "text-primary")
            }
          >
            <Sparkles className="h-4 w-4" />
            {block.eyebrow}
          </p>
        )}
        <h1
          className={
            "mb-6 text-5xl font-bold tracking-tight md:text-7xl " +
            (dark ? "text-white" : "")
          }
        >
          {block.title}
        </h1>
        {block.subtitle && (
          <p
            className={
              "max-w-3xl text-xl leading-relaxed md:text-2xl " +
              (dark ? "text-zinc-300" : "text-muted-foreground")
            }
          >
            {block.subtitle}
          </p>
        )}
      </div>
    </section>
  );
}

function RichTextSection(block: Extract<LandingPageBlock, { type: "richText" }>) {
  return (
    <section className="bg-background py-16 md:py-20">
      <div className="container mx-auto max-w-3xl px-4">
        {block.heading && (
          <h2 className="mb-6 text-3xl font-bold tracking-tight md:text-4xl">
            {block.heading}
          </h2>
        )}
        <div
          className="prose prose-invert max-w-none"
          // Sanitise on render so HTML pasted directly into the admin
          // editor (or written before the upstream sanitiser existed) can't
          // smuggle scripts past us.
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(block.bodyHtml) }}
        />
      </div>
    </section>
  );
}

function CardGridSection(block: Extract<LandingPageBlock, { type: "cardGrid" }>) {
  return (
    <section className="bg-background py-20 md:py-24">
      <div className="container mx-auto max-w-6xl px-4">
        {(block.heading || block.intro) && (
          <div className="mb-10 max-w-2xl">
            {block.heading && (
              <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
                {block.heading}
              </h2>
            )}
            {block.intro && (
              <p className="mt-3 text-muted-foreground">{block.intro}</p>
            )}
          </div>
        )}
        <ul className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {block.cards.map((c, i) => (
            <CardItem key={`${c.code ?? c.title}-${i}`} card={c} index={i} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function CardItem({ card: c, index }: { card: CardGridCard; index: number }) {
  const inner = (
    <div className="group flex h-full flex-col rounded-2xl border border-border bg-card p-6 transition-colors hover:border-primary/60 hover:bg-card/80">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {c.code ?? ""}
        </span>
        {c.level && (
          <span
            className={
              "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide " +
              (LEVEL_CLASS[c.level] ?? LEVEL_CLASS_FALLBACK)
            }
          >
            {c.level}
          </span>
        )}
      </div>
      <h3 className="mb-2 text-lg font-semibold leading-snug">{c.title}</h3>
      {c.description && (
        <p className="mb-4 flex-grow text-sm text-muted-foreground">{c.description}</p>
      )}
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{c.source ?? ""}</span>
        {c.url && (
          <span className="inline-flex items-center gap-1 font-medium text-primary group-hover:gap-1.5 transition-all">
            Open
            {isExternal(c.url) ? (
              <ExternalLink className="h-3 w-3" />
            ) : (
              <ArrowRight className="h-3 w-3" />
            )}
          </span>
        )}
      </div>
    </div>
  );
  return (
    <motion.li
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.04, 0.3) }}
    >
      {c.url ? (
        isExternal(c.url) ? (
          <a
            href={c.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-2xl"
          >
            {inner}
          </a>
        ) : (
          <Link
            href={c.url}
            className="block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-2xl"
          >
            {inner}
          </Link>
        )
      ) : (
        inner
      )}
    </motion.li>
  );
}

function CtaSection(block: Extract<LandingPageBlock, { type: "cta" }>) {
  const dark = (block.theme ?? "nebula") === "nebula";
  return (
    <section
      className={
        dark
          ? "relative overflow-hidden border-t border-border bg-[#0B0B1A] py-20"
          : "border-t border-border bg-background py-20"
      }
    >
      {dark && <div className="absolute inset-0 nebula-gradient opacity-15" />}
      <div className="container relative z-10 mx-auto max-w-3xl px-4 text-center">
        <h2
          className={
            "mb-4 text-3xl font-bold tracking-tight md:text-4xl " +
            (dark ? "text-white" : "")
          }
        >
          {block.heading}
        </h2>
        {block.body && (
          <p
            className={
              "mb-8 text-lg " + (dark ? "text-zinc-300" : "text-muted-foreground")
            }
          >
            {block.body}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-center gap-3">
          {block.buttons.map((b, i) => (
            <Cta key={i} cta={b} />
          ))}
        </div>
      </div>
    </section>
  );
}

function ImageSection(block: Extract<LandingPageBlock, { type: "image" }>) {
  return (
    <section className="bg-background py-12">
      <div className="container mx-auto max-w-4xl px-4">
        <figure>
          <img
            src={block.url}
            alt={block.alt ?? ""}
            className="w-full rounded-2xl border border-border"
            loading="lazy"
          />
          {block.caption && (
            <figcaption className="mt-3 text-center text-sm text-muted-foreground">
              {block.caption}
            </figcaption>
          )}
        </figure>
      </div>
    </section>
  );
}

function FaqSection(block: Extract<LandingPageBlock, { type: "faq" }>) {
  return (
    <section className="bg-background py-20">
      <div className="container mx-auto max-w-3xl px-4">
        {block.heading && (
          <h2 className="mb-8 text-3xl font-bold tracking-tight md:text-4xl">
            {block.heading}
          </h2>
        )}
        <dl className="space-y-6">
          {block.items.map((it, i) => (
            <div key={i} className="rounded-2xl border border-border bg-card p-6">
              <dt className="text-lg font-semibold">{it.q}</dt>
              <dd className="mt-2 text-muted-foreground">{it.a}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function renderBlock(block: LandingPageBlock, index: number) {
  switch (block.type) {
    case "hero":
      return <HeroSection key={index} {...block} />;
    case "richText":
      return <RichTextSection key={index} {...block} />;
    case "cardGrid":
      return <CardGridSection key={index} {...block} />;
    case "cta":
      return <CtaSection key={index} {...block} />;
    case "image":
      return <ImageSection key={index} {...block} />;
    case "faq":
      return <FaqSection key={index} {...block} />;
    default:
      return null;
  }
}

// JSON-LD URLs must be absolute for Google's validators. Editors author
// CTAs / card links as either absolute URLs or root-relative paths; this
// normalises root-relative input to `${SITE_ORIGIN}${path}` and leaves
// anything else (http/https/mailto/etc.) alone.
function absoluteUrl(href: string): string {
  if (/^[a-z]+:/i.test(href) || href.startsWith("//")) return href;
  if (href.startsWith("/")) return `${SITE_ORIGIN}${href}`;
  return href;
}

function buildJsonLd(page: LandingPageDto, canonicalUrl: string) {
  const cardGrid = page.blocks.find((b) => b.type === "cardGrid") as
    | Extract<LandingPageBlock, { type: "cardGrid" }>
    | undefined;
  const faq = page.blocks.find((b) => b.type === "faq") as
    | Extract<LandingPageBlock, { type: "faq" }>
    | undefined;

  const webPage: Record<string, unknown> = {
    "@type": "WebPage",
    name: page.title,
    url: canonicalUrl,
    description: page.seoDescription ?? undefined,
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: SITE_ORIGIN },
  };

  if (cardGrid) {
    webPage.mainEntity = {
      "@type": "ItemList",
      numberOfItems: cardGrid.cards.length,
      itemListElement: cardGrid.cards.map((c, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: c.url ? absoluteUrl(c.url) : canonicalUrl,
        name: c.title,
      })),
    };
  }

  // FAQ rich results require a standalone FAQPage node — nesting it under
  // WebPage as `faq` is silently ignored by Google's validators. When both
  // a WebPage and FAQ are present we emit them as siblings under @graph.
  if (!faq) {
    return { "@context": "https://schema.org", ...webPage };
  }
  const faqPage = {
    "@type": "FAQPage",
    mainEntity: faq.items.map((it) => ({
      "@type": "Question",
      name: it.q,
      acceptedAnswer: { "@type": "Answer", text: it.a },
    })),
  };
  return {
    "@context": "https://schema.org",
    "@graph": [webPage, faqPage],
  };
}

export default function LandingPageView({ slug }: Props) {
  const normalized = slug.toLowerCase();
  const { data, isLoading, error } = useQuery({
    queryKey: ["landing-page", normalized],
    queryFn: () => landingPagesApi.getPublic(normalized),
    retry: (failureCount, err) => {
      if (err instanceof LandingPagesApiError && err.status === 404) return false;
      return failureCount < 2;
    },
  });

  if (isLoading) {
    return <div className="min-h-[60vh]" aria-hidden />;
  }
  if (error || !data) {
    return <NotFound />;
  }

  // Editors can override the canonical URL per page. The Meta component
  // takes a path and prepends SITE_ORIGIN, so we resolve an absolute
  // override back to a path-on-this-origin (cross-origin overrides we keep
  // as the full URL for JSON-LD and let Meta produce the same-origin
  // fallback). Empty override → use the page's own URL.
  const defaultPath = `/${data.slug}`;
  const override = data.seoCanonicalUrl?.trim() ?? "";
  let canonicalPath = defaultPath;
  let canonicalUrl = `${SITE_ORIGIN}${defaultPath}`;
  if (override) {
    if (override.startsWith("/")) {
      canonicalPath = override;
      canonicalUrl = `${SITE_ORIGIN}${override}`;
    } else if (override.startsWith(SITE_ORIGIN)) {
      canonicalPath = override.slice(SITE_ORIGIN.length) || "/";
      canonicalUrl = override;
    } else {
      // Cross-origin canonical: surface it in JSON-LD, and feed Meta the
      // closest same-origin equivalent so it still emits a sensible
      // <link rel="canonical">.
      canonicalUrl = override;
    }
  }

  return (
    <div className="w-full">
      <Meta
        title={data.seoTitle ?? data.title}
        description={data.seoDescription ?? undefined}
        canonicalPath={canonicalPath}
        image={data.ogImageUrl ?? undefined}
      />
      <JsonLd data={buildJsonLd(data, canonicalUrl)} />
      {data.blocks.map(renderBlock)}
    </div>
  );
}
