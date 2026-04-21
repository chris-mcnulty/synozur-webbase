import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import {
  Calendar,
  MapPin,
  ExternalLink,
  ArrowLeft,
  Clock,
  Facebook,
  Linkedin,
} from "lucide-react";
import { api } from "@/lib/api";
import { Meta } from "@/lib/meta";
import { Button } from "@/components/ui/button";
import { startOfCurrentWeek } from "@/lib/eventTime";

function formatDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(iso: string | Date): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function XIcon({ className }: { className?: string }) {
  // Lucide doesn't ship an X/Twitter glyph; inline SVG keeps us off extra deps.
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="currentColor"
    >
      <path d="M18.244 2H21.5l-7.52 8.593L22.9 22h-6.93l-5.43-6.84L4.2 22H.94l8.04-9.194L1.1 2h7.09l4.9 6.28L18.244 2Zm-1.22 18h1.913L7.07 4H5.05l11.974 16Z" />
    </svg>
  );
}

export default function EventDetail() {
  const { slug } = useParams<{ slug: string }>();

  const { data: event, isLoading, error } = useQuery({
    queryKey: ["event", slug],
    queryFn: () => api.publicEvent(slug!),
    enabled: Boolean(slug),
  });

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-20 max-w-4xl">
        <div className="h-8 w-64 bg-muted animate-pulse rounded mb-4" />
        <div className="h-4 w-48 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="container mx-auto px-4 py-20 max-w-4xl text-center">
        <h1 className="text-2xl font-bold mb-4">Event not found</h1>
        <p className="text-muted-foreground mb-8">
          This event may have been removed or the link is incorrect.
        </p>
        <Link href="/events">
          <Button variant="outline">
            <ArrowLeft className="h-4 w-4 mr-2" /> Back to Events
          </Button>
        </Link>
      </div>
    );
  }

  const weekStart = startOfCurrentWeek();
  const isPast =
    new Date(event.startDate).getTime() < weekStart || event.status === "ENDED";
  const canRegister =
    !isPast &&
    (event.registrationStatus === "OPEN" ||
      event.registrationStatus === "OPEN_EXTERNAL") &&
    event.registrationUrl;

  const shareUrl =
    typeof window !== "undefined" ? window.location.href : "";
  const shareTitle = event.title;
  const facebookShare = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`;
  const xShare = `https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareTitle)}`;
  const linkedinShare = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`;

  const mapSrc = event.location
    ? `https://www.google.com/maps?q=${encodeURIComponent(event.location)}&output=embed`
    : null;

  return (
    <div className="w-full">
      <Meta
        title={event.title}
        description={
          event.teaser ??
          event.description ??
          `${event.title} — Synozur Alliance event.`
        }
      />

      {/* Hero */}
      <div className="relative w-full bg-[#0B0B1A] overflow-hidden">
        {event.imageUrl ? (
          <img
            src={event.imageUrl}
            alt={event.title}
            className="w-full max-h-[420px] object-cover opacity-60"
          />
        ) : (
          <div className="w-full h-64 md:h-80 flex items-center justify-center">
            <Calendar className="h-24 w-24 text-primary/30" />
          </div>
        )}
        <div className="absolute inset-0 nebula-gradient opacity-20 pointer-events-none" />
      </div>

      <div className="container mx-auto px-4 py-12 max-w-4xl">
        {/* Back link */}
        <Link
          href="/events"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
        >
          <ArrowLeft className="h-4 w-4" /> All Events
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
          {/* Main content */}
          <div className="lg:col-span-2">
            {event.eventType && (
              <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-3">
                {event.eventType}
              </p>
            )}
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
              {event.title}
            </h1>

            {event.teaser && (
              <p
                className="text-lg text-muted-foreground leading-relaxed mb-8"
                data-testid="text-event-teaser"
              >
                {event.teaser}
              </p>
            )}

            {event.description && (
              <div className="prose prose-sm dark:prose-invert max-w-none text-foreground/90 leading-relaxed">
                <h2 className="text-xl font-semibold mb-4">About the event</h2>
                {event.description.split("\n").map((para, i) =>
                  para.trim() ? (
                    <p key={i} className="mb-4">
                      {para}
                    </p>
                  ) : null,
                )}
              </div>
            )}

            {mapSrc && (
              <div className="mt-10" data-testid="event-map">
                <iframe
                  title={`Map of ${event.location}`}
                  src={mapSrc}
                  width="100%"
                  height="320"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  className="rounded-lg border border-border"
                />
              </div>
            )}

            <div className="mt-10 pt-6 border-t border-border">
              <p className="text-sm font-medium mb-3">Share this event</p>
              <div className="flex items-center gap-3">
                <a
                  href={facebookShare}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label="Share on Facebook"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground hover:text-primary hover:border-primary transition-colors"
                  data-testid="share-facebook"
                >
                  <Facebook className="h-4 w-4" />
                </a>
                <a
                  href={xShare}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label="Share on X"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground hover:text-primary hover:border-primary transition-colors"
                  data-testid="share-x"
                >
                  <XIcon className="h-3.5 w-3.5" />
                </a>
                <a
                  href={linkedinShare}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label="Share on LinkedIn"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground hover:text-primary hover:border-primary transition-colors"
                  data-testid="share-linkedin"
                >
                  <Linkedin className="h-4 w-4" />
                </a>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <aside className="space-y-6">
            <div className="rounded-xl border border-border bg-card p-6 space-y-4">
              <div className="flex items-start gap-3">
                <Calendar className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium">{formatDate(event.startDate)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatTime(event.startDate)}
                  </p>
                </div>
              </div>

              {event.location && (
                <div className="flex items-start gap-3">
                  <MapPin className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                  <p className="text-sm">{event.location}</p>
                </div>
              )}

              {isPast ? (
                <p className="text-xs uppercase tracking-wide text-muted-foreground pt-2 border-t border-border">
                  Past Event
                </p>
              ) : canRegister ? (
                <a
                  href={event.registrationUrl ?? "#"}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
                >
                  Register Now <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : (
                <p className="text-xs uppercase tracking-wide text-muted-foreground pt-2 border-t border-border">
                  Registration Closed
                </p>
              )}
            </div>

            <div className="text-center">
              <Link href="/contact">
                <Button variant="outline" size="sm" className="w-full">
                  Contact us about this event
                </Button>
              </Link>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
