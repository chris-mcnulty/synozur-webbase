import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { Meta } from "@/lib/meta";
import { ArrowLeft, ArrowRight, Download } from "lucide-react";
import { fetchCollateralBySlug, type Collateral } from "@/data/collateral";
import NotFound from "@/pages/not-found";

export default function ItemDetail() {
  const [, params] = useRoute("/items/:slug");
  const slug = params?.slug;
  const [item, setItem] = useState<Collateral | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    if (!slug) return;
    fetchCollateralBySlug(slug).then((res) => {
      if (!cancelled) setItem(res && res.type === "white_paper" ? res : null);
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

  const cta = item.downloadUrl
    ? { label: "Download", href: item.downloadUrl, external: true, icon: <Download className="ml-2 h-4 w-4" /> }
    : item.external
    ? { label: "Open", href: item.url, external: true, icon: <ArrowRight className="ml-2 h-4 w-4" /> }
    : { label: "Get in touch", href: "/contact", external: false, icon: <ArrowRight className="ml-2 h-4 w-4" /> };

  return (
    <div className="w-full">
      <Meta
        title={item.title}
        description={item.description}
        image={item.heroImage}
        path={`/items/${item.slug}`}
        type="article"
      />

      <section className="relative overflow-hidden bg-[#0B0B1A] pt-24 pb-16">
        <div className="container relative z-10 mx-auto px-4 max-w-4xl">
          <Link
            href="/items"
            className="inline-flex items-center text-sm text-zinc-300 hover:text-white mb-8 transition-colors"
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> All white papers
          </Link>
          <span className="inline-block py-1 px-3 rounded-full bg-white/10 border border-white/25 text-white text-[11px] tracking-[0.2em] font-semibold backdrop-blur-md mb-4">
            WHITE PAPER
          </span>
          {item.subtitle && (
            <p className="text-base text-primary mb-3">{item.subtitle}</p>
          )}
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-white mb-6">
            {item.title}
          </h1>
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
          <p className="text-lg text-foreground leading-relaxed whitespace-pre-line">
            {item.description}
          </p>

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
