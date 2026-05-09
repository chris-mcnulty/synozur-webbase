import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { ArrowLeft, ExternalLink, PlayCircle } from "lucide-react";
import { Meta } from "@/lib/meta";
import { api, type VideoCategory, type VideoDto } from "@/lib/api";
import { RichText } from "@/components/rich-text";
import NotFound from "@/pages/not-found";
import { toEmbedUrl } from "@/lib/video-embed";
import { VideoJsonLd } from "@/components/video-jsonld";
import { SITE_ORIGIN } from "@/lib/seo-config";
import { EditWedge } from "@/components/edit-wedge";

const CATEGORY_LABELS: Record<VideoCategory, string> = {
  interview: "Interview",
  webinar: "Webinar",
  demo: "Demo",
  talk: "Talk",
  clip: "Clip",
  other: "Video",
};

export default function VideoDetail() {
  const [, params] = useRoute("/videos/:slug");
  const slug = params?.slug;
  const [item, setItem] = useState<VideoDto | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    if (!slug) return;
    api
      .getVideo(slug)
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

  const embedUrl = item.videoUrl ? toEmbedUrl(item.videoUrl) : null;
  const publishedDate = item.publishedAt || item.recordedAt;

  return (
    <div className="w-full">
      <Meta
        title={item.seoTitle || item.title}
        description={item.seoDescription || item.shortDescription}
        image={item.ogImage || item.heroImage}
        path={`/videos/${item.slug}`}
        type="article"
      />
      <VideoJsonLd
        canonicalUrl={`${SITE_ORIGIN}/videos/${item.slug}`}
        name={item.title}
        description={item.seoDescription || item.shortDescription}
        thumbnailUrl={item.thumbnailUrl ?? item.heroImage}
        uploadDate={publishedDate}
        durationSeconds={item.durationSeconds}
        contentUrl={item.videoUrl}
        embedUrl={embedUrl}
      />

      <section className="relative overflow-hidden bg-[#0B0B1A] pt-24 pb-16">
        <div className="container relative z-10 mx-auto px-4 max-w-4xl">
          <Link
            href="/videos"
            className="inline-flex items-center text-sm text-zinc-300 hover:text-white mb-8 transition-colors"
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> All videos
          </Link>
          <span className="inline-block py-1 px-3 rounded-full bg-white/10 border border-white/25 text-white text-[11px] tracking-[0.2em] font-semibold backdrop-blur-md mb-4">
            {CATEGORY_LABELS[item.category].toUpperCase()}
          </span>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-white mb-6">
            {item.title}
          </h1>
          {item.shortDescription && (
            <p className="text-xl text-zinc-300 mb-4">{item.shortDescription}</p>
          )}
          {publishedDate && (
            <p className="text-sm text-zinc-400">
              {new Date(publishedDate).toLocaleDateString(undefined, {
                dateStyle: "long",
                timeZone: "UTC",
              })}
            </p>
          )}
        </div>
      </section>

      <section className="bg-background">
        <div className="container mx-auto px-4 max-w-4xl -mt-8 relative z-20">
          {embedUrl ? (
            <div className="rounded-2xl overflow-hidden border border-border shadow-2xl aspect-video bg-black">
              <iframe
                src={embedUrl}
                title={item.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="w-full h-full"
              />
            </div>
          ) : (
            <div className="relative rounded-2xl overflow-hidden border border-border shadow-2xl aspect-[16/9] bg-card">
              {item.heroImage ? (
                <img
                  src={item.heroImage}
                  alt={item.heroImageAlt || item.title}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                  <PlayCircle className="h-16 w-16" />
                </div>
              )}
              {item.videoUrl && (
                <a
                  href={item.videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="absolute inset-0 flex items-center justify-center bg-black/40 hover:bg-black/55 transition-colors"
                >
                  <span className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-primary text-primary-foreground font-semibold">
                    <PlayCircle className="h-5 w-5" /> Watch the video
                  </span>
                </a>
              )}
            </div>
          )}
        </div>
      </section>

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

          {item.videoUrl && !embedUrl && (
            <div className="mt-12">
              <a
                href={item.videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
              >
                Watch the video <ExternalLink className="ml-2 h-4 w-4" />
              </a>
            </div>
          )}
        </div>
      </section>

      <EditWedge kind="video" id={item.id} slug={item.slug} snapshot={item} />
    </div>
  );
}
