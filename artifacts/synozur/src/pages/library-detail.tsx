import { useEffect, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { Meta } from "@/lib/meta";
import { ArrowLeft, ArrowRight, Download } from "lucide-react";
import {
  fetchCollateralBySlug,
  TYPE_LABELS,
  type Collateral,
} from "@/data/collateral";
import NotFound from "@/pages/not-found";

/**
 * Returns true if the collateral item's `url` already maps to a richer local
 * detail page handled by another route. In that case, `/library/:slug` should
 * redirect — the visitor should land on the canonical URL instead.
 */
function hasRicherLocalRoute(item: Collateral): boolean {
  const url = item.url;
  if (!url.startsWith("/")) return false;
  // Match either the section root (e.g. "/polaris") or a nested page (e.g.
  // "/polaris/some-slug"). Important: do NOT swallow "/library/..." — that's
  // this route itself.
  const richerSections = [
    "case-studies",
    "applications",
    "events",
    "insights",
    "polaris",
    "items",
    "webinars",
    "workshops",
  ];
  return richerSections.some(
    (s) => url === `/${s}` || url.startsWith(`/${s}/`),
  );
}

function primaryCtaFor(item: Collateral) {
  if (item.downloadUrl) {
    return {
      label: "Download",
      href: item.downloadUrl,
      external: true,
      icon: <Download className="ml-2 h-4 w-4" />,
    };
  }
  if (item.external) {
    return { label: "Open", href: item.url, external: true, icon: <ArrowRight className="ml-2 h-4 w-4" /> };
  }
  return { label: "Get in touch", href: "/contact", external: false, icon: <ArrowRight className="ml-2 h-4 w-4" /> };
}

export default function LibraryDetail() {
  const [, params] = useRoute("/library/:slug");
  const [, navigate] = useLocation();
  const slug = params?.slug;
  const [item, setItem] = useState<Collateral | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    if (!slug) return;
    fetchCollateralBySlug(slug)
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

  // If this collateral's canonical URL is a richer local route, redirect there
  // immediately (replace history so /library/:slug doesn't appear in the back
  // stack). External URLs and library-only items render normally below.
  useEffect(() => {
    if (item && hasRicherLocalRoute(item)) {
      navigate(item.url, { replace: true });
    }
  }, [item, navigate]);

  if (item === undefined) {
    return (
      <div className="container mx-auto px-4 py-32 text-center text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!item) return <NotFound />;
  if (hasRicherLocalRoute(item)) {
    // The redirect effect above is in flight; render nothing visible.
    return null;
  }

  const cta = primaryCtaFor(item);

  return (
    <div className="w-full">
      <Meta
        title={item.title}
        description={item.description}
        image={item.heroImage}
        path={`/library/${item.slug}`}
        type="article"
      />

      <section className="relative overflow-hidden bg-[#0B0B1A] pt-24 pb-16">
        <div className="container relative z-10 mx-auto px-4 max-w-4xl">
          <Link
            href="/library"
            className="inline-flex items-center text-sm text-zinc-300 hover:text-white mb-8 transition-colors"
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to library
          </Link>
          <span className="inline-block py-1 px-3 rounded-full bg-white/10 border border-white/25 text-white text-[11px] tracking-[0.2em] font-semibold backdrop-blur-md mb-4">
            {TYPE_LABELS[item.type]}
          </span>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-white mb-6">
            {item.title}
          </h1>
          {item.subtitle && (
            <p className="text-xl text-zinc-300 mb-4">{item.subtitle}</p>
          )}
          <p className="text-sm text-zinc-400">
            Published {new Date(item.publishedAt).toLocaleDateString(undefined, { dateStyle: "long" })}
          </p>
        </div>
      </section>

      <section className="bg-background">
        <div className="container mx-auto px-4 max-w-4xl -mt-8 relative z-20">
          <div className="rounded-2xl overflow-hidden border border-border shadow-2xl aspect-[16/9] bg-card">
            <img src={item.heroImage} alt={item.title} className="w-full h-full object-cover" />
          </div>
        </div>
      </section>

      <section className="bg-background py-16">
        <div className="container mx-auto px-4 max-w-3xl">
          <p className="text-lg text-foreground leading-relaxed">{item.description}</p>

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

          <div className="mt-12">
            {cta.external ? (
              <a
                href={cta.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
              >
                {cta.label}
                {cta.icon}
              </a>
            ) : (
              <Link
                href={cta.href}
                className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
              >
                {cta.label}
                {cta.icon}
              </Link>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
