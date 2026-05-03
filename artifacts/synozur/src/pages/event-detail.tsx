import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import {
  Calendar,
  MapPin,
  ExternalLink,
  ArrowLeft,
  Clock,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import Gone from "@/pages/gone";
import { Meta } from "@/lib/meta";
import { EventJsonLd } from "@/components/event-jsonld";
import { ShareRail } from "@/components/share-rail";
import { Button } from "@/components/ui/button";
import { startOfCurrentWeek } from "@/lib/eventTime";
import { toEmbedUrl } from "@/lib/video-embed";

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
    if (error instanceof ApiError && error.status === 410) {
      return <Gone backHref="/events" backLabel="Back to Events" />;
    }
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

  const mapSrc = event.location
    ? `https://www.google.com/maps?q=${encodeURIComponent(event.location)}&output=embed`
    : null;

  const recordingEmbed =
    isPast && event.recordingVideoUrl ? toEmbedUrl(event.recordingVideoUrl) : null;

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

      <EventJsonLd
        slug={slug!}
        name={event.title}
        description={event.teaser ?? event.description ?? null}
        image={event.imageUrl ?? null}
        startDate={event.startDate}
        location={event.location ?? null}
        registrationUrl={event.registrationUrl ?? null}
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

            {isPast && (recordingEmbed || event.recordingVideoUrl) && (
              <div className="mt-10" data-testid="event-recording">
                <div className="mb-4 rounded-md border border-border bg-card px-4 py-2 text-sm text-muted-foreground">
                  This event has ended. Watch the recording below.
                </div>
                {recordingEmbed ? (
                  <div className="rounded-lg overflow-hidden border border-border aspect-video bg-black">
                    <iframe
                      src={recordingEmbed}
                      title={event.recordingVideoTitle ?? `${event.title} recording`}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      className="w-full h-full"
                    />
                  </div>
                ) : (
                  event.recordingVideoUrl && (
                    <a
                      href={event.recordingVideoUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                    >
                      Watch the recording <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )
                )}
                {event.recordingVideoSlug && (
                  <Link
                    href={`/videos/${event.recordingVideoSlug}`}
                    className="mt-3 inline-block text-sm text-muted-foreground hover:text-foreground"
                  >
                    View on the videos library →
                  </Link>
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

            <ShareRail
              kind="event"
              title={event.title}
              targets={["facebook", "x", "linkedin"]}
            />
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
