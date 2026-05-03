import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { ArrowLeft, ArrowRight, Download } from "lucide-react";
import { Meta } from "@/lib/meta";
import { dynamicOgImageUrl } from "@/lib/og-image-url";
import { api, type WhitePaperDocType, type WhitePaperDto } from "@/lib/api";
import { trackEvent } from "@/lib/traffic-tracker";
import { RichText } from "@/components/rich-text";
import { ShareRail } from "@/components/share-rail";
import { fetchCollateralBySlug, type Collateral } from "@/data/collateral";
import NotFound from "@/pages/not-found";
import Gone from "@/pages/gone";
import { ApiError } from "@/lib/api";

const DOC_TYPE_LABELS: Record<WhitePaperDocType, string> = {
  whitepaper: "White Paper",
  ebook: "eBook",
  report: "Report",
  guide: "Guide",
};

type PageItem =
  | { source: "white_papers"; data: WhitePaperDto }
  | { source: "collateral"; data: Collateral };

export default function WhitePaperDetail() {
  const [, params] = useRoute("/white-papers/:slug");
  const slug = params?.slug;
  const [item, setItem] = useState<PageItem | null | undefined>(undefined);
  // 410-Gone is tracked separately so it overrides the collateral fallback.
  // Collateral is normally the runtime authority, but a 410 from the editorial
  // source is an explicit "this is retired" signal we must honor (#162 / L13).
  const [isGone, setIsGone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!slug) return;
    setIsGone(false);
    // Collateral is the runtime authority for what's in the library: an
    // item appears here if and only if a matching collateral row exists.
    // We then try to hydrate richer editorial fields (bodyHtml, SEO meta)
    // from the white_papers source table by slug. If hydration fails the
    // collateral row still renders — so library items can never 404 just
    // because the source table drifted.
    fetchCollateralBySlug(slug)
      .then((col) => {
        if (cancelled) return;
        if (!col || (col.type !== "white_paper" && col.type !== "ebook")) {
          setItem(null);
          return;
        }
        return api
          .getWhitePaper(col.slug)
          .then((wp) => {
            if (cancelled) return;
            setItem(
              wp
                ? { source: "white_papers", data: wp }
                : { source: "collateral", data: col },
            );
          })
          .catch((err: unknown) => {
            if (cancelled) return;
            if (err instanceof ApiError && err.status === 410) {
              setIsGone(true);
              setItem(null);
              return;
            }
            setItem({ source: "collateral", data: col });
          });
      })
      .catch(() => {
        if (!cancelled) setItem(null);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (item === undefined) {
    return (
      <div className="container mx-auto px-4 py-32 text-center text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!item) {
    if (isGone) return <Gone kind="white-paper" />;
    return <NotFound />;
  }

  if (item.source === "white_papers") {
    const wp = item.data;
    const downloadHref = wp.documentUrl || wp.externalUrl;
    const downloadLabel = wp.documentUrl ? "Download PDF" : wp.externalUrl ? "Open" : null;
    const downloadIcon = wp.documentUrl ? (
      <Download className="ml-2 h-4 w-4" />
    ) : (
      <ArrowRight className="ml-2 h-4 w-4" />
    );

    return (
      <div className="w-full">
        <Meta
          title={wp.seoTitle || wp.title}
          description={wp.seoDescription || wp.shortDescription}
          image={
            wp.ogImage ||
            wp.heroImage ||
            dynamicOgImageUrl("white-paper", wp.id, wp.updatedAt) ||
            undefined
          }
          path={`/white-papers/${wp.slug}`}
          type="article"
        />

        <section className="relative overflow-hidden bg-[#0B0B1A] pt-24 pb-16">
          <div className="absolute inset-0 nebula-gradient opacity-25" />
          <div className="container relative z-10 mx-auto px-4 max-w-4xl">
            <Link
              href="/white-papers"
              className="inline-flex items-center text-sm text-zinc-300 hover:text-white mb-8 transition-colors"
            >
              <ArrowLeft className="mr-2 h-4 w-4" /> All white papers
            </Link>
            <span className="inline-block py-1 px-3 rounded-full bg-white/10 border border-white/25 text-white text-[11px] tracking-[0.2em] font-semibold backdrop-blur-md mb-4">
              {DOC_TYPE_LABELS[wp.docType].toUpperCase()}
            </span>
            {wp.subtitle && <p className="text-base text-primary mb-3">{wp.subtitle}</p>}
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-white mb-6">
              {wp.title}
            </h1>
            {wp.publishedAt && (
              <p className="text-sm text-zinc-400">
                Published{" "}
                {new Date(wp.publishedAt).toLocaleDateString(undefined, {
                  dateStyle: "long",
                  timeZone: "UTC",
                })}
              </p>
            )}
          </div>
        </section>

        {wp.heroImage && (
          <section className="bg-background">
            <div className="container mx-auto px-4 max-w-4xl -mt-8 relative z-20">
              <div className="rounded-2xl overflow-hidden border border-border shadow-2xl aspect-[16/9] bg-card">
                <img
                  src={wp.heroImage}
                  alt={wp.heroImageAlt || wp.title}
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          </section>
        )}

        <section className="bg-background pt-10">
          <div className="container mx-auto px-4 max-w-3xl">
            <ShareRail kind="white-paper" label="white paper" title={wp.title} className="" />
          </div>
        </section>

        <section className="bg-background py-16">
          <div className="container mx-auto px-4 max-w-3xl">
            {wp.bodyHtml ? (
              <RichText
                html={wp.bodyHtml}
                invert
                className="prose-p:text-foreground prose-headings:text-foreground prose-a:text-primary"
              />
            ) : (
              wp.shortDescription && (
                <p className="text-lg text-foreground leading-relaxed whitespace-pre-line">
                  {wp.shortDescription}
                </p>
              )
            )}

            {wp.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-10">
                {wp.tags.map((t) => (
                  <span
                    key={t}
                    className="px-3 py-1 rounded-full text-xs bg-card border border-border text-muted-foreground"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}

            {downloadHref && downloadLabel && (
              <div className="mt-12">
                <a
                  href={downloadHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
                  onClick={() =>
                    void trackEvent(
                      wp.documentUrl ? "resource-download" : "resource-open-external",
                      { slug: wp.slug, docType: wp.docType, title: wp.title },
                    )
                  }
                >
                  {downloadLabel}
                  {downloadIcon}
                </a>
                {wp.pageCount && (
                  <p className="text-xs text-muted-foreground mt-2">{wp.pageCount} pages</p>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    );
  }

  const col = item.data;
  const downloadHref = col.downloadUrl || (col.external ? col.url : null);
  const downloadLabel = col.downloadUrl ? "Download" : col.external ? "Open" : null;

  return (
    <div className="w-full">
      <Meta
        title={col.title}
        description={col.description}
        image={col.heroImage}
        path={`/white-papers/${col.slug}`}
        type="article"
      />

      <section className="relative overflow-hidden bg-[#0B0B1A] pt-24 pb-16">
        <div className="absolute inset-0 nebula-gradient opacity-25" />
        <div className="container relative z-10 mx-auto px-4 max-w-4xl">
          <Link
            href="/white-papers"
            className="inline-flex items-center text-sm text-zinc-300 hover:text-white mb-8 transition-colors"
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> All white papers
          </Link>
          <span className="inline-block py-1 px-3 rounded-full bg-white/10 border border-white/25 text-white text-[11px] tracking-[0.2em] font-semibold backdrop-blur-md mb-4">
            WHITE PAPER
          </span>
          {col.subtitle && <p className="text-base text-primary mb-3">{col.subtitle}</p>}
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-white mb-6">
            {col.title}
          </h1>
          {col.publishedAt && (
            <p className="text-sm text-zinc-400">
              Published{" "}
              {new Date(col.publishedAt).toLocaleDateString(undefined, { dateStyle: "long" })}
            </p>
          )}
        </div>
      </section>

      {col.heroImage && (
        <section className="bg-background">
          <div className="container mx-auto px-4 max-w-4xl -mt-8 relative z-20">
            <div className="rounded-2xl overflow-hidden border border-border shadow-2xl aspect-[16/9] bg-card">
              <img src={col.heroImage} alt={col.title} className="w-full h-full object-cover" />
            </div>
          </div>
        </section>
      )}

      <section className="bg-background pt-10">
        <div className="container mx-auto px-4 max-w-3xl">
          <ShareRail kind="white-paper" label="white paper" title={col.title} className="" />
        </div>
      </section>

      <section className="bg-background py-16">
        <div className="container mx-auto px-4 max-w-3xl">
          {col.description && (
            <p className="text-lg text-foreground leading-relaxed whitespace-pre-line">
              {col.description}
            </p>
          )}

          {col.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-10">
              {col.tags.map((t) => (
                <span
                  key={t}
                  className="px-3 py-1 rounded-full text-xs bg-card border border-border text-muted-foreground"
                >
                  {t}
                </span>
              ))}
            </div>
          )}

          <div className="mt-12">
            {downloadHref && downloadLabel ? (
              <a
                href={downloadHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
                onClick={() =>
                  void trackEvent("resource-download", { slug: col.slug, title: col.title })
                }
              >
                {downloadLabel}
                {col.downloadUrl ? (
                  <Download className="ml-2 h-4 w-4" />
                ) : (
                  <ArrowRight className="ml-2 h-4 w-4" />
                )}
              </a>
            ) : (
              <Link
                href="/contact"
                className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
              >
                Get in touch <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
