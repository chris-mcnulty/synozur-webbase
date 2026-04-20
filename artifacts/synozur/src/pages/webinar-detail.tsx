import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { Meta } from "@/lib/meta";
import { ArrowLeft, ExternalLink, PlayCircle } from "lucide-react";
import { fetchCollateralBySlug, type Collateral } from "@/data/collateral";
import NotFound from "@/pages/not-found";

function isEmbeddable(url: string) {
  return /youtube\.com\/embed|player\.vimeo\.com|wistia\.net\/embed/.test(url);
}

export default function WebinarDetail() {
  const [, params] = useRoute("/webinars/:slug");
  const slug = params?.slug;
  const [item, setItem] = useState<Collateral | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    if (!slug) return;
    fetchCollateralBySlug(slug).then((res) => {
      if (!cancelled) setItem(res && res.type === "webinar" ? res : null);
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

  const embeddable = item.videoUrl ? isEmbeddable(item.videoUrl) : false;

  return (
    <div className="w-full">
      <Meta
        title={item.title}
        description={item.description}
        image={item.heroImage}
        path={`/webinars/${item.slug}`}
        type="article"
      />

      <section className="relative overflow-hidden bg-[#0B0B1A] pt-24 pb-16">
        <div className="container relative z-10 mx-auto px-4 max-w-4xl">
          <Link
            href="/webinars"
            className="inline-flex items-center text-sm text-zinc-300 hover:text-white mb-8 transition-colors"
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> All webinars
          </Link>
          <span className="inline-block py-1 px-3 rounded-full bg-white/10 border border-white/25 text-white text-[11px] tracking-[0.2em] font-semibold backdrop-blur-md mb-4">
            WEBINAR
          </span>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-white mb-6">
            {item.title}
          </h1>
          {item.subtitle && <p className="text-xl text-zinc-300 mb-4">{item.subtitle}</p>}
          <p className="text-sm text-zinc-400">
            Published {new Date(item.publishedAt).toLocaleDateString(undefined, { dateStyle: "long" })}
          </p>
        </div>
      </section>

      <section className="bg-background">
        <div className="container mx-auto px-4 max-w-4xl -mt-8 relative z-20">
          {embeddable && item.videoUrl ? (
            <div className="rounded-2xl overflow-hidden border border-border shadow-2xl aspect-video bg-black">
              <iframe
                src={item.videoUrl}
                title={item.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="w-full h-full"
              />
            </div>
          ) : (
            <div className="relative rounded-2xl overflow-hidden border border-border shadow-2xl aspect-[16/9] bg-card">
              <img src={item.heroImage} alt={item.title} className="w-full h-full object-cover" />
              {item.videoUrl && (
                <a
                  href={item.videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="absolute inset-0 flex items-center justify-center bg-black/40 hover:bg-black/55 transition-colors"
                >
                  <span className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-primary text-primary-foreground font-semibold">
                    <PlayCircle className="h-5 w-5" /> Watch the recording
                  </span>
                </a>
              )}
            </div>
          )}
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

          {item.videoUrl && !embeddable && (
            <div className="mt-12">
              <a
                href={item.videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
              >
                Watch the recording <ExternalLink className="ml-2 h-4 w-4" />
              </a>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
