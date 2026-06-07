import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { Calendar, MapPin, ArrowLeft, Clock, ExternalLink, Download } from "lucide-react";
import { api } from "@/lib/api";
import { Meta } from "@/lib/meta";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

function formatDate(iso: string | Date): string {
  return new Date(iso as string).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

type WithStartTime = { startTime?: Date | string | null };

/**
 * Session startTimes are stored as naive local timestamps (UTC hour = local
 * wall-clock hour). Group by the UTC date components which represent the
 * local event date.
 */
function toDateStr(startTime: Date | string | null | undefined): string | null {
  if (startTime == null) return null;
  const d = new Date(startTime as string | Date);
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  ).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Format a session time. Session startTime values are stored as naive local
 * timestamps — the UTC hour/minute equal the wall-clock local time. We
 * extract UTC components directly and append the timezone abbreviation.
 */
function toTimeStr(
  startTime: Date | string | null | undefined,
  timezone?: string | null,
): string | null {
  if (startTime == null) return null;
  const d = new Date(startTime as string | Date);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  const mStr = String(m).padStart(2, "0");
  if (!timezone) return `${h12}:${mStr} ${ampm}`;
  const abbr =
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "short",
    })
      .formatToParts(d)
      .find((p) => p.type === "timeZoneName")?.value ?? "";
  return `${h12}:${mStr} ${ampm}${abbr ? ` ${abbr}` : ""}`;
}

function groupByDate<T extends WithStartTime>(items: T[]) {
  const groups: Record<string, T[]> = {};
  for (const item of items) {
    const key = toDateStr(item.startTime) ?? "Unscheduled";
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }
  return groups;
}

const SESSION_TYPE_COLORS: Record<string, string> = {
  keynote: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  panel: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  workshop: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  talk: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  break: "bg-muted text-muted-foreground border-border",
  networking: "bg-pink-500/15 text-pink-400 border-pink-500/30",
};

function sessionTypeBadge(type: string | null | undefined) {
  if (!type) return null;
  const key = type.toLowerCase();
  const cls =
    SESSION_TYPE_COLORS[key] ?? "bg-muted text-muted-foreground border-border";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {type}
    </span>
  );
}

export default function EventSchedule() {
  const { slug } = useParams<{ slug: string }>();

  const { data: event, isLoading: eventLoading } = useQuery({
    queryKey: ["event", slug],
    queryFn: () => api.publicEvent(slug!),
    enabled: Boolean(slug),
  });

  const { data: schedule, isLoading: scheduleLoading } = useQuery({
    queryKey: ["event-schedule", slug],
    queryFn: () => api.getEventSchedule(slug!),
    enabled: Boolean(slug),
  });

  const isLoading = eventLoading || scheduleLoading;

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-20 max-w-4xl">
        <div className="h-8 w-64 bg-muted animate-pulse rounded mb-4" />
        <div className="h-4 w-48 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="container mx-auto px-4 py-20 max-w-4xl text-center">
        <h1 className="text-2xl font-bold mb-4">Event not found</h1>
        <Link href="/events">
          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to Events
          </span>
        </Link>
      </div>
    );
  }

  const sessions = schedule?.items ?? [];
  const groups = groupByDate(sessions);
  const groupKeys = Object.keys(groups);

  return (
    <div className="w-full">
      <Meta
        title={`Schedule — ${event.title}`}
        description={`Full session schedule for ${event.title}.`}
      />

      {/* Minimal hero strip */}
      <div className="bg-[#0B0B1A] border-b border-border/30">
        <div className="container mx-auto px-4 py-10 max-w-4xl">
          <Link
            href={`/events/${slug}`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
          >
            <ArrowLeft className="h-4 w-4" /> Back to event
          </Link>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-2">
            {event.eventType ?? "Event"}
          </p>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight mb-3">
            {event.title}
          </h1>
          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Calendar className="h-4 w-4 text-primary" />
              {formatDate(String(event.startDate))}
            </span>
            {event.location && (
              <span className="flex items-center gap-1.5">
                <MapPin className="h-4 w-4 text-primary" />
                {event.location}
              </span>
            )}
            {sessions.length > 0 && (
              <span className="text-muted-foreground">
                {sessions.length} session{sessions.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div className="mt-4">
            <a
              href={`${BASE_PATH}/api/events/${slug}/calendar.ics`}
              download={`${slug}.ics`}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-border/60 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              Download .ics
            </a>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-12 max-w-4xl">
        {sessions.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <Calendar className="h-12 w-12 mx-auto mb-4 opacity-30" />
            <p className="text-lg font-medium mb-2">Schedule coming soon</p>
            <p className="text-sm">
              The session schedule for this event hasn&rsquo;t been published yet.
            </p>
            <Link href={`/events/${slug}`}>
              <span className="mt-6 inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
                <ArrowLeft className="h-4 w-4" /> Back to event details
              </span>
            </Link>
          </div>
        ) : (
          <div className="space-y-10">
            {groupKeys.map((dateLabel) => (
              <section key={dateLabel}>
                <div className="flex items-center gap-3 mb-5">
                  <h2 className="text-lg font-semibold">{dateLabel}</h2>
                  <div className="flex-1 h-px bg-border" />
                </div>

                <div className="space-y-3">
                  {groups[dateLabel].map((sess, idx) => {
                    const s = sess as (typeof sessions)[number];
                    return (
                      <div
                        key={s.id}
                        className="rounded-xl border border-border bg-card p-5 flex flex-col sm:flex-row sm:items-start gap-4"
                      >
                        {/* Time column */}
                        <div className="sm:w-28 shrink-0">
                          {s.startTime != null ? (
                            <p className="text-sm font-medium text-primary flex items-center gap-1.5">
                              <Clock className="h-3.5 w-3.5" />
                              {toTimeStr(s.startTime, event.timezone)}
                            </p>
                          ) : (
                            <p className="text-xs text-muted-foreground">TBD</p>
                          )}
                          {s.room && (
                            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {s.room}
                            </p>
                          )}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-start gap-2 mb-1">
                            <h3 className="text-base font-semibold leading-snug">
                              {s.title}
                            </h3>
                            {sessionTypeBadge(s.sessionType)}
                            {s.track && (
                              <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                                {s.track}
                              </span>
                            )}
                          </div>
                          {s.speakers && (
                            <p className="text-sm text-muted-foreground mt-1">
                              {s.speakers}
                            </p>
                          )}
                        </div>

                        {/* Session link */}
                        {s.sessionUrl && (
                          <div className="shrink-0">
                            <a
                              href={s.sessionUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5 transition-colors"
                            >
                              Details <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}

            {/* Register CTA at bottom if open */}
            {event.registrationUrl &&
              (event.registrationStatus === "OPEN" ||
                event.registrationStatus === "OPEN_EXTERNAL") && (
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 text-center">
                  <p className="text-sm text-muted-foreground mb-3">
                    Registration is open for this event.
                  </p>
                  <a
                    href={event.registrationUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    Register Now <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              )}
          </div>
        )}
      </div>
    </div>
  );
}
