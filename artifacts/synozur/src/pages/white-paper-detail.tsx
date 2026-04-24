import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { ArrowLeft, ArrowRight, Download } from "lucide-react";
import { Meta } from "@/lib/meta";
import { api, type WhitePaperDocType, type WhitePaperDto } from "@/lib/api";
import { trackEvent } from "@/lib/traffic-tracker";
import { RichText } from "@/components/rich-text";
import NotFound from "@/pages/not-found";

const DOC_TYPE_LABELS: Record<WhitePaperDocType, string> = {
  whitepaper: "White Paper",
  ebook: "eBook",
  report: "Report",
  guide: "Guide",
};

export default function WhitePaperDetail() {
  const [, params] = useRoute("/white-papers/:slug");
  const slug = params?.slug;
  const [item, setItem] = useState<WhitePaperDto | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    if (!slug) return;
    api
      .getWhitePaper(slug)
      .then((res) => {
        if (!cancelled) setItem(res);
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
  if (!item) return <NotFound />;

  const downloadHref = item.documentUrl || item.externalUrl;
  const downloadLabel = item.documentUrl ? "Download PDF" : item.externalUrl ? "Open" : null;
  const downloadIcon = item.documentUrl ? (
    <Download className="ml-2 h-4 w-4" />
  ) : (
    <ArrowRight className="ml-2 h-4 w-4" />
  );

  return (
    <div className="w-full">
      <Meta
        title={item.seoTitle || item.title}
        description={item.seoDescription || item.shortDescription}
        image={item.ogImage || item.heroImage}
        path={`/white-papers/${item.slug}`}
        type="article"
      />

      <section className="relative overflow-hidden bg-[#0B0B1A] pt-24 pb-16">
        <div className="container relative z-10 mx-auto px-4 max-w-4xl">
          <Link
            href="/white-papers"
            className="inline-flex items-center text-sm text-zinc-300 hover:text-white mb-8 transition-colors"
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> All white papers
          </Link>
          <span className="inline-block py-1 px-3 rounded-full bg-white/10 border border-white/25 text-white text-[11px] tracking-[0.2em] font-semibold backdrop-blur-md mb-4">
            {DOC_TYPE_LABELS[item.docType].toUpperCase()}
          </span>
          {item.subtitle && <p className="text-base text-primary mb-3">{item.subtitle}</p>}
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-white mb-6">
            {item.title}
          </h1>
          {item.publishedAt && (
            <p className="text-sm text-zinc-400">
              Published{" "}
              {new Date(item.publishedAt).toLocaleDateString(undefined, {
                dateStyle: "long",
                timeZone: "UTC",
              })}
            </p>
          )}
        </div>
      </section>

      {item.heroImage && (
        <section className="bg-background">
          <div className="container mx-auto px-4 max-w-4xl -mt-8 relative z-20">
            <div className="rounded-2xl overflow-hidden border border-border shadow-2xl aspect-[16/9] bg-card">
              <img
                src={item.heroImage}
                alt={item.heroImageAlt || item.title}
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        </section>
      )}

      <section className="bg-background py-16">
        <div className="container mx-auto px-4 max-w-3xl">
          {item.bodyHtml ? (
            <RichText
              html={item.bodyHtml}
              invert
              className="prose-p:text-foreground prose-headings:text-foreground prose-a:text-primary"
            />
          ) : (
            item.shortDescription && (
              <p className="text-lg text-foreground leading-relaxed whitespace-pre-line">
                {item.shortDescription}
              </p>
            )
          )}

          {item.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-10">
              {item.tags.map((t) => (
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
                    item.documentUrl ? "resource-download" : "resource-open-external",
                    {
                      slug: item.slug,
                      docType: item.docType,
                      title: item.title,
                    },
                  )
                }
              >
                {downloadLabel}
                {downloadIcon}
              </a>
              {item.pageCount && (
                <p className="text-xs text-muted-foreground mt-2">{item.pageCount} pages</p>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
