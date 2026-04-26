import { Meta } from "@/lib/meta";
import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Headphones,
  Play,
  Calendar,
  Clock,
  User,
} from "lucide-react";
import NotFound from "@/pages/not-found";

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
  publishedAt: string | null;
}

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

async function fetchEpisode(slug: string): Promise<PolarisEpisodeDto> {
  const res = await fetch(`${BASE_PATH}/api/polaris/episodes/${encodeURIComponent(slug)}`);
  if (res.status === 404) throw new Error("not-found");
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

const platformLinks = [
  {
    key: "apple" as const,
    label: "Apple Podcasts",
    url: (ep: PolarisEpisodeDto) => ep.appleUrl,
    color: "bg-[#8B3FD9]",
  },
  {
    key: "spotify" as const,
    label: "Spotify",
    url: (ep: PolarisEpisodeDto) => ep.spotifyUrl,
    color: "bg-[#1DB954]",
  },
];

export default function PolarisEpisodeDetail() {
  const [, params] = useRoute("/polaris/:slug");
  const slug = params?.slug ?? "";

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

              {/* Platform links */}
              <div className="flex flex-wrap gap-3 mb-8">
                {episode.audioUrl && (
                  <a
                    href={episode.audioUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
                  >
                    <Play className="h-4 w-4 fill-current" />
                    Play Episode
                  </a>
                )}
                {platformLinks.map((p) => {
                  const href = p.url(episode);
                  if (!href) return null;
                  return (
                    <a
                      key={p.key}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-5 py-2.5 text-sm text-white hover:bg-white/10 hover:border-primary/60 transition-colors"
                    >
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

      {/* Show notes */}
      {summaryLines.length > 0 && (
        <section className="bg-background py-20 border-t border-border/60">
          <div className="container mx-auto px-4 max-w-3xl">
            <p className="text-sm uppercase tracking-widest text-primary mb-4">
              Show Notes
            </p>
            <div className="space-y-4 text-muted-foreground leading-relaxed text-base">
              {summaryLines.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
          </div>
        </section>
      )}

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
    </div>
  );
}
