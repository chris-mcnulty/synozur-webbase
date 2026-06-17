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
    <>
      <Meta
        title="Events"
        description="Join The Synozur Alliance at upcoming conferences, webinars, and community gatherings — or browse highlights from our past events."
      />

      <section className="relative overflow-hidden bg-[#0B0B1A] py-24 md:py-32">
        <div aria-hidden="true" className="absolute inset-0 nebula-gradient opacity-25" />
        <div className="container relative z-10 mx-auto px-4 max-w-4xl">
          <p className="text-sm uppercase tracking-widest text-primary mb-4">
            Gatherings
          </p>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-6">
            Events
          </h1>
          <p className="text-xl md:text-2xl text-zinc-300 leading-relaxed max-w-3xl">
            Join Synozur at upcoming conferences, webinars, and
            community gatherings — or browse highlights from our past events.
          </p>
        </div>
      </section>

      <div className="container mx-auto px-4 py-12 md:py-16 max-w-7xl">
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

      </div>

      {/* Work with us on events */}
      <section className="relative overflow-hidden bg-card border-t border-border py-24">
        <div aria-hidden="true" className="absolute inset-0 nebula-gradient opacity-10" />
        <div className="container relative z-10 mx-auto px-4 max-w-4xl">
          <div className="text-center mb-12">
            <p className="text-sm uppercase tracking-widest text-primary mb-3">
              Work with us
            </p>
            <h2 className="text-3xl md:text-4xl font-bold mb-6">
              Bring Synozur to your next event
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Our partners speak, teach, and host gatherings across the
              transformation, AI, and digital workplace community. If you are
              planning something where our perspective fits, we would like to
              hear from you.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            {[
              {
                title: "Speaking & keynotes",
                body:
                  "Conferences, summits, and industry events. Our partners keynote on AI strategy, the future of work, and operating-model change.",
              },
              {
                title: "Workshops & roundtables",
                body:
                  "Half- and full-day working sessions for executive teams, partner networks, and customer councils — facilitated by senior practitioners.",
              },
              {
                title: "Sponsorships & co-hosted events",
                body:
                  "Microsoft, ISV, and partner-ecosystem events where Synozur sponsors, hosts, or co-produces alongside the organizing team.",
              },
            ].map((card) => (
              <div
                key={card.title}
                className="rounded-2xl border border-border/60 bg-background/60 p-6"
              >
                <h3 className="text-lg font-semibold mb-2">{card.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {card.body}
                </p>
              </div>
            ))}
          </div>
          <div className="text-center">
            <Link href="/contact">
              <Button size="lg" data-testid="events-contact-cta">
                Tell us about your event
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
