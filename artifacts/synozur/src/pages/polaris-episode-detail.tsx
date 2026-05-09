import { useEffect, useState } from "react";
import { Meta } from "@/lib/meta";
import { dynamicOgImageUrl } from "@/lib/og-image-url";
import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Headphones,
  Calendar,
  Clock,
  User,
} from "lucide-react";
import NotFound from "@/pages/not-found";
import Gone from "@/pages/gone";
import type { PolarisLinkedPostDto } from "@/lib/api";
import { VideoJsonLd } from "@/components/video-jsonld";
import { SITE_ORIGIN } from "@/lib/seo-config";
import { EditWedge } from "@/components/edit-wedge";

interface PolarisEpisodeDto {
  id: string;
  slug: string;
  title: string;
  episodeNumber: number;
  summary: string | null;
  guestName: string | null;
  audioUrl: string;
  appleUrl: string | null;
  spotifyUrl: string | null;
  durationSeconds: number | null;
  artworkUrl: string;
  ogImage: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
  linkedPost: PolarisLinkedPostDto | null;
}

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

const SHOW_LINKS = [
  {
    key: "apple",
    label: "Apple Podcasts",
    showUrl: "https://podcasts.apple.com/us/podcast/polaris-pathways-a-synozur-podcast/id1773172041",
    episodeUrl: (ep: PolarisEpisodeDto) => ep.appleUrl,
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4 shrink-0">
        <path d="M12 0C5.374 0 0 5.373 0 12c0 6.628 5.374 12 12 12 6.628 0 12-5.372 12-12C24 5.373 18.628 0 12 0zm0 2.182a9.818 9.818 0 1 1 0 19.636A9.818 9.818 0 0 1 12 2.182zm-.01 3.636c-2.534 0-4.674 1.642-5.437 3.92-.155.458-.232.937-.232 1.426 0 .682.148 1.33.414 1.916.37.82.972 1.516 1.73 1.997l-.463 2.776a.545.545 0 0 0 .536.628h6.924a.545.545 0 0 0 .536-.628l-.462-2.776c.757-.481 1.36-1.177 1.73-1.997.265-.586.413-1.234.413-1.916 0-.489-.077-.968-.232-1.426-.763-2.278-2.903-3.92-5.437-3.92zm0 1.637c2.024 0 3.74 1.313 4.351 3.134.123.368.185.754.185 1.145 0 .546-.118 1.065-.33 1.534-.297.657-.779 1.214-1.386 1.6a.545.545 0 0 0-.24.58l.43 2.577H9.99l.43-2.577a.545.545 0 0 0-.24-.58c-.607-.386-1.089-.943-1.385-1.6a3.615 3.615 0 0 1-.33-1.534c0-.391.062-.777.184-1.145.612-1.821 2.327-3.134 4.35-3.134zm0 1.636a1.636 1.636 0 1 0 0 3.273 1.636 1.636 0 0 0 0-3.273z"/>
      </svg>
    ),
    color: "bg-[#872EC4] border-[#872EC4] hover:bg-[#7022b0]",
  },
  {
    key: "spotify",
    label: "Spotify",
    showUrl: "https://open.spotify.com/show/1cEtlJsybYcFFGTiKU1pX6?si=6faafd668eb44d5b",
    episodeUrl: (ep: PolarisEpisodeDto) => ep.spotifyUrl,
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4 shrink-0">
        <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
      </svg>
    ),
    color: "bg-[#1DB954] border-[#1DB954] hover:bg-[#17a349]",
  },
  {
    key: "amazon",
    label: "Amazon Music",
    showUrl: "https://music.amazon.com/podcasts/db9939ac-8343-420e-97c3-ee09eae50c74/polaris-pathways---a-synozur-podcast",
    episodeUrl: () => null,
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4 shrink-0">
        <path d="M13.958 10.09c0 1.232.029 2.256-.591 3.351-.502.891-1.301 1.438-2.186 1.438-1.214 0-1.922-.924-1.922-2.292 0-2.692 2.415-3.182 4.699-3.182v.685zm3.186 7.705c-.209.189-.512.201-.745.076-1.051-.872-1.238-1.276-1.814-2.106-1.732 1.767-2.958 2.297-5.201 2.297-2.657 0-4.72-1.641-4.72-4.924 0-2.565 1.392-4.311 3.371-5.163 1.715-.755 4.11-.891 5.938-1.098v-.408c0-.748.059-1.633-.381-2.277-.381-.574-1.124-.811-1.773-.811-1.204 0-2.277.617-2.541 1.896-.054.283-.261.562-.546.576l-3.063-.33c-.258-.059-.545-.267-.471-.663.706-3.717 4.06-4.836 7.068-4.836 1.537 0 3.546.41 4.758 1.574 1.537 1.435 1.39 3.352 1.39 5.437v4.929c0 1.481.614 2.132 1.192 2.932.201.283.246.621-.01.831-.645.54-1.79 1.541-2.422 2.098-.003-.003-.003-.003-.003-.003l.003-.006z"/>
      </svg>
    ),
    color: "bg-[#FF9900] border-[#FF9900] hover:bg-[#e68a00]",
  },
  {
    key: "youtube",
    label: "YouTube",
    showUrl: "https://www.youtube.com/@SynozurVideos",
    episodeUrl: () => null,
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4 shrink-0">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
      </svg>
    ),
    color: "bg-[#FF0000] border-[#FF0000] hover:bg-[#e60000]",
  },
  {
    key: "rss",
    label: "RSS",
    showUrl: `${BASE_PATH}/polaris/rss.xml`,
    episodeUrl: () => null,
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4 shrink-0">
        <path d="M6.18 15.64a2.18 2.18 0 0 1 2.18 2.18C8.36 19.01 7.38 20 6.18 20C4.98 20 4 19.01 4 17.82a2.18 2.18 0 0 1 2.18-2.18M4 4.44A15.56 15.56 0 0 1 19.56 20h-2.83A12.73 12.73 0 0 0 4 7.27V4.44m0 5.66a9.9 9.9 0 0 1 9.9 9.9h-2.83A7.07 7.07 0 0 0 4 12.93V10.1z"/>
      </svg>
    ),
    color: "bg-[#F26522] border-[#F26522] hover:bg-[#d95510]",
  },
];

class PolarisEpisodeError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "PolarisEpisodeError";
    this.status = status;
  }
}

async function fetchEpisode(slug: string): Promise<PolarisEpisodeDto> {
  const res = await fetch(`${BASE_PATH}/api/polaris/episodes/${encodeURIComponent(slug)}`);
  if (res.status === 404) throw new PolarisEpisodeError(404, "not-found");
  if (res.status === 410) throw new PolarisEpisodeError(410, "gone");
  if (!res.ok) throw new Error(`Failed to fetch episode: ${res.status}`);
  return (await res.json()) as PolarisEpisodeDto;
}

function formatReleaseDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}

const SHOW_NOTES_PREVIEW = 3;

/**
 * Finds "Show Notes" (case-insensitive) as a heading in the blog post HTML and
 * returns everything that follows it. Handles both plain headings
 * (`<h1>Show Notes</h1>`) and Wix-nested ones
 * (`<h2><span><span>Show Notes</span></span></h2>`).
 * Returns null if the marker isn't found.
 */
function extractShowNotesHtml(html: string): string | null {
  const lower = html.toLowerCase();
  const markerIdx = lower.indexOf("show notes");
  if (markerIdx === -1) return null;

  // Walk forward from the marker to find the closing heading tag (</h1..3>).
  // This skips any nested closing spans/tags that wrap the text.
  const afterMarker = markerIdx + "show notes".length;
  const headingClose = lower.indexOf("</h", afterMarker);
  if (headingClose === -1) {
    // No heading close — fall back to taking everything after the next >
    const gt = html.indexOf(">", afterMarker);
    if (gt === -1) return null;
    return html.slice(gt + 1).trim() || null;
  }

  // Find the > that ends the closing heading tag (e.g. </h2>)
  const gt = html.indexOf(">", headingClose);
  if (gt === -1) return null;

  const rest = html.slice(gt + 1).trim();
  return rest || null;
}

/**
 * Rewrites image src attributes that point to /objects/ paths so they resolve
 * through the API storage proxy (same treatment as hero images).
 */
function rewriteStorageUrls(html: string, basePath: string): string {
  return html.replace(
    /src="(\/objects\/[^"]+)"/g,
    `src="${basePath}/api/storage$1"`,
  );
}

function ShowNotesHtml({ html }: { html: string }) {
  return (
    <section className="bg-background py-20 border-t border-border/60">
      <div className="container mx-auto px-4 max-w-3xl">
        <p className="text-sm uppercase tracking-widest text-primary mb-6">
          Show Notes
        </p>
        <div
          className="prose prose-invert prose-violet max-w-none
            prose-headings:font-semibold prose-headings:tracking-tight
            prose-h2:text-xl prose-h3:text-lg
            prose-a:text-primary prose-a:no-underline hover:prose-a:underline
            prose-strong:text-foreground
            prose-li:text-muted-foreground prose-p:text-muted-foreground
            prose-ul:my-3 prose-ol:my-3 prose-li:my-0.5
            prose-img:rounded-xl prose-img:my-6"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </section>
  );
}

function ShowNotesPlain({ lines }: { lines: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = lines.length > SHOW_NOTES_PREVIEW;
  const visible = expanded || !collapsible ? lines : lines.slice(0, SHOW_NOTES_PREVIEW);

  return (
    <section className="bg-background py-20 border-t border-border/60">
      <div className="container mx-auto px-4 max-w-3xl">
        <p className="text-sm uppercase tracking-widest text-primary mb-4">
          Show Notes
        </p>
        <div className="space-y-4 text-muted-foreground leading-relaxed text-base">
          {visible.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
        {collapsible && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
          >
            {expanded ? "Show less" : `Show full notes (${lines.length - SHOW_NOTES_PREVIEW} more paragraphs)`}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        )}
      </div>
    </section>
  );
}

export default function PolarisEpisodeDetail() {
  const [, params] = useRoute("/polaris/:slug");
  const slug = params?.slug ?? "";

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [slug]);

  const { data: episode, isLoading, error } = useQuery({
    queryKey: ["polaris-episode", slug],
    queryFn: () => fetchEpisode(slug),
    enabled: !!slug,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="w-full min-h-screen bg-[#0B0B1A] flex items-center justify-center">
        <div className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (error || !episode) {
    if (error instanceof PolarisEpisodeError && error.status === 410) {
      return <Gone kind="polaris-episode" />;
    }
    return <NotFound />;
  }

  const releaseDate = formatReleaseDate(episode.publishedAt);
  const duration = formatDuration(episode.durationSeconds);
  const summaryLines = (episode.summary ?? "").trim().split(/\n+/).filter(Boolean);

  return (
    <div className="w-full">
      <Meta
        title={`${episode.title} — Polaris Pathways`}
        description={summaryLines[0] ?? "Listen to this Polaris Pathways episode from Synozur."}
        type="article"
        image={
          episode.ogImage ||
          episode.artworkUrl ||
          dynamicOgImageUrl(
            "polaris",
            episode.id,
            episode.updatedAt ?? episode.publishedAt,
          ) ||
          undefined
        }
      />
      <VideoJsonLd
        canonicalUrl={`${SITE_ORIGIN}/polaris/${episode.slug}`}
        name={episode.title}
        description={summaryLines[0] ?? null}
        thumbnailUrl={episode.artworkUrl}
        uploadDate={episode.publishedAt}
        durationSeconds={episode.durationSeconds}
        contentUrl={episode.audioUrl}
      />

      {/* Hero */}
      <section className="relative overflow-hidden bg-[#0B0B1A] pt-28 pb-20">
        <div className="absolute inset-0 nebula-gradient opacity-25" />
        <div className="container relative z-10 mx-auto px-4">
          {/* Back link */}
          <Link
            href="/polaris"
            className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors mb-10"
          >
            <ArrowLeft className="h-4 w-4" />
            All Episodes
          </Link>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
            {/* Artwork */}
            <motion.div
              className="lg:col-span-4"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5 }}
            >
              <div className="relative aspect-square rounded-3xl overflow-hidden shadow-2xl ring-1 ring-white/10">
                <img
                  src={episode.artworkUrl}
                  alt={episode.title}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-tr from-black/30 via-transparent to-transparent" />
              </div>
            </motion.div>

            {/* Info */}
            <motion.div
              className="lg:col-span-8"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
            >
              <p className="text-sm uppercase tracking-widest text-primary mb-4 inline-flex items-center gap-2">
                <Headphones className="h-4 w-4" />
                Episode {episode.episodeNumber}
              </p>
              <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-white mb-5 leading-tight">
                {episode.title}
              </h1>

              {/* Meta row */}
              <div className="flex flex-wrap items-center gap-5 text-sm text-zinc-400 mb-8">
                {episode.guestName && (
                  <span className="flex items-center gap-1.5">
                    <User className="h-4 w-4" />
                    {episode.guestName}
                  </span>
                )}
                {releaseDate && (
                  <span className="flex items-center gap-1.5">
                    <Calendar className="h-4 w-4" />
                    {releaseDate}
                  </span>
                )}
                {duration && (
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-4 w-4" />
                    {duration}
                  </span>
                )}
              </div>

              {/* Platform chiclets — episode-specific URL takes priority, falls back to show URL */}
              <div className="flex flex-wrap gap-2.5 mb-8">
                {SHOW_LINKS.map((p) => {
                  const href = p.episodeUrl(episode) ?? p.showUrl;
                  return (
                    <a
                      key={p.key}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm text-white transition-colors ${p.color}`}
                    >
                      {p.icon}
                      {p.label}
                    </a>
                  );
                })}
              </div>

              {/* Inline audio player */}
              {episode.audioUrl && (
                <audio
                  controls
                  preload="none"
                  className="w-full rounded-xl opacity-80 hover:opacity-100 transition-opacity"
                  style={{ filter: "invert(0) brightness(0.9)" }}
                >
                  <source src={episode.audioUrl} type="audio/mpeg" />
                  Your browser does not support the audio element.
                </audio>
              )}
            </motion.div>
          </div>
        </div>
      </section>

      {/* Featured linked blog post — renders only when an editor has linked
          a related post (typically one categorized as Polaris or podcast). */}
      {episode.linkedPost && (
        <section className="bg-background py-14 border-t border-border/60">
          <div className="container mx-auto px-4 max-w-3xl">
            <p className="text-sm uppercase tracking-widest text-primary mb-4">
              Read the post
            </p>
            <Link
              href={`/insights/${episode.linkedPost.slug}`}
              className="group block rounded-2xl border border-border/70 bg-card hover:border-primary/60 hover:shadow-lg transition-all overflow-hidden"
              data-testid="polaris-linked-post-card"
            >
              <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-0">
                {episode.linkedPost.heroImageUrl ? (
                  <div className="aspect-[4/3] sm:aspect-auto sm:h-full bg-muted overflow-hidden">
                    <img
                      src={episode.linkedPost.heroImageUrl}
                      alt={episode.linkedPost.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  </div>
                ) : (
                  <div className="aspect-[4/3] sm:aspect-auto sm:h-full bg-gradient-to-br from-primary/20 to-primary/5 hidden sm:block" />
                )}
                <div className="p-6 flex flex-col justify-center">
                  <h3 className="text-xl font-semibold text-foreground group-hover:text-primary transition-colors mb-2 leading-tight">
                    {episode.linkedPost.title}
                  </h3>
                  {episode.linkedPost.excerpt && (
                    <p className="text-sm text-muted-foreground line-clamp-3 mb-3">
                      {episode.linkedPost.excerpt}
                    </p>
                  )}
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
                    Read the post
                    <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
                  </span>
                </div>
              </div>
            </Link>
          </div>
        </section>
      )}

      {/* Show notes — prefer rich HTML extracted from the linked blog post when
          it contains a "Show Notes" heading; fall back to the plain-text DB
          summary for episodes without a linked post or when the heading isn't
          found in the post body. */}
      {(() => {
        const rawHtml = episode.linkedPost?.bodyHtml ?? null;
        if (rawHtml) {
          const extracted = extractShowNotesHtml(rawHtml);
          if (extracted) {
            const rewritten = rewriteStorageUrls(extracted, BASE_PATH);
            return <ShowNotesHtml html={rewritten} />;
          }
        }
        return summaryLines.length > 0 ? <ShowNotesPlain lines={summaryLines} /> : null;
      })()}

      {/* Back to all episodes */}
      <section className="bg-background py-14 border-t border-border/60">
        <div className="container mx-auto px-4 flex justify-center">
          <Link
            href="/polaris"
            className="inline-flex items-center gap-2 rounded-full border border-border bg-transparent px-7 py-3 text-sm font-medium text-foreground hover:border-primary hover:text-primary transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to all episodes
          </Link>
        </div>
      </section>

      <EditWedge
        kind="polaris-episode"
        id={episode.id}
        slug={episode.slug}
        snapshot={episode}
        queryKey={["polaris-episode", slug]}
      />
    </div>
  );
}
