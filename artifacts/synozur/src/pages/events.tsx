import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Calendar, MapPin, ExternalLink, ChevronDown } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Meta } from "@/lib/meta";
import { startOfCurrentWeek } from "@/lib/eventTime";

function formatDate(iso: string | Date): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(iso: string | Date): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

interface EventLike {
  id: number;
  slug: string;
  title: string;
  startDate: string | Date;
  location?: string | null;
  imageUrl?: string | null;
  registrationStatus?: string;
  registrationUrl?: string | null;
  status?: string;
}

function EventCard({ event, isPast }: { event: EventLike; isPast: boolean }) {
  const canRegister =
    !isPast &&
    (event.registrationStatus === "OPEN" ||
      event.registrationStatus === "OPEN_EXTERNAL") &&
    event.registrationUrl;

  return (
    <div
      className="group flex flex-col md:flex-row gap-6 rounded-lg border border-border bg-card p-6 hover-elevate"
      data-testid={`event-card-${event.id}`}
    >
      <div className="md:w-56 shrink-0">
        <div className="aspect-[4/3] w-full overflow-hidden rounded-md bg-muted">
          {event.imageUrl ? (
            <img
              src={event.imageUrl}
              alt={event.title}
              className="h-full w-full object-cover transition-transform group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <Calendar className="h-12 w-12" />
            </div>
          )}
        </div>
      </div>
      <div className="flex-1 flex flex-col">
        <h3 className="text-xl font-semibold mb-2" data-testid={`event-title-${event.id}`}>
          <Link
            href={`/events/${event.slug}`}
            className="text-foreground hover:text-primary transition-colors"
          >
            {event.title}
          </Link>
        </h3>
        <div className="flex flex-col gap-1 text-sm text-muted-foreground mb-3">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 shrink-0" />
            <span>
              {formatDate(event.startDate)} · {formatTime(event.startDate)}
            </span>
          </div>
          {event.location && (
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 shrink-0" />
              <span>{event.location}</span>
            </div>
          )}
        </div>
        <div className="mt-auto pt-3">
          {canRegister ? (
            <a
              href={event.registrationUrl ?? "#"}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
              data-testid={`event-register-${event.id}`}
            >
              Register <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {isPast ? "Past Event" : "Registration Closed"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function EventsPage() {
  const [pastOpen, setPastOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["public-events"],
    queryFn: () => api.publicEvents(),
  });

  const weekStart = startOfCurrentWeek();
  const events = data ?? [];
  const upcoming = events
    .filter((e) => new Date(e.startDate).getTime() >= weekStart && e.status !== "ENDED")
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
  const past = events
    .filter((e) => new Date(e.startDate).getTime() < weekStart || e.status === "ENDED")
    .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());

  return (
    <div className="container mx-auto px-4 py-12 md:py-16 max-w-5xl">
      <Meta
        title="Events"
        description="Join The Synozur Alliance at upcoming conferences, webinars, and community gatherings — or browse highlights from our past events."
      />
      <div className="mb-12">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-foreground mb-3">
          Events
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl">
          Join The Synozur Alliance at upcoming conferences, webinars, and
          community gatherings — or browse highlights from our past events.
        </p>
      </div>

      {isLoading && <div className="text-muted-foreground">Loading events…</div>}
      {error && (
        <div className="text-destructive">Failed to load events. Please try again.</div>
      )}

      {!isLoading && !error && (
        <>
          <section className="mb-16" data-testid="events-upcoming-section">
            <h2 className="text-2xl font-semibold text-foreground mb-6 pb-2 border-b border-border">
              Upcoming Events ({upcoming.length})
            </h2>
            {upcoming.length === 0 ? (
              <p className="text-muted-foreground">No upcoming events scheduled.</p>
            ) : (
              <div className="flex flex-col gap-4">
                {upcoming.map((e) => (
                  <EventCard key={e.id} event={e} isPast={false} />
                ))}
              </div>
            )}
          </section>

          {past.length > 0 && (
            <section data-testid="events-past-section">
              <button
                type="button"
                onClick={() => setPastOpen((o) => !o)}
                className="flex w-full items-center justify-between gap-4 pb-2 border-b border-border group"
                aria-expanded={pastOpen}
              >
                <h2 className="text-2xl font-semibold text-foreground">
                  Past Events ({past.length})
                </h2>
                <ChevronDown
                  className={`h-5 w-5 text-muted-foreground transition-transform duration-200 group-hover:text-foreground ${pastOpen ? "rotate-180" : ""}`}
                />
              </button>

              {pastOpen && (
                <div className="mt-6 flex flex-col gap-4">
                  {past.map((e) => (
                    <EventCard key={e.id} event={e} isPast={true} />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}

      <div className="mt-16 text-center">
        <Link href="/contact">
          <Button variant="outline">Contact us about an event</Button>
        </Link>
      </div>
    </div>
  );
}
