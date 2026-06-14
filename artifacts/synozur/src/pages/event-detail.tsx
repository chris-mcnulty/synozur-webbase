import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Calendar,
  MapPin,
  ExternalLink,
  ArrowLeft,
  Clock,
  Download,
  CheckCircle2,
} from "lucide-react";
import { api, ApiError, type EventRegistrationInput } from "@/lib/api";
import Gone from "@/pages/gone";
import { Meta } from "@/lib/meta";
import { EventJsonLd } from "@/components/event-jsonld";
import { ShareRail } from "@/components/share-rail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EditWedge } from "@/components/edit-wedge";
import { startOfCurrentWeek } from "@/lib/eventTime";
import { toEmbedUrl } from "@/lib/video-embed";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Turnstile,
  TURNSTILE_SITE_KEY,
  isBotCheckError,
  type TurnstileHandle,
} from "@/components/turnstile";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

const registrationSchema = z.object({
  firstName: z.string().min(1, "First name is required").max(100),
  lastName: z.string().min(1, "Last name is required").max(100),
  email: z.string().email("Valid email required"),
  company: z.string().min(1, "Company is required").max(200),
  jobTitle: z.string().min(1, "Job title is required").max(200),
  wantsReminder: z.boolean(),
});
type RegistrationForm = z.infer<typeof registrationSchema>;

function EventRegistrationModal({
  open,
  onOpenChange,
  eventSlug,
  eventTitle,
  eventDate,
  showReminderOption,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  eventSlug: string;
  eventTitle: string;
  eventDate: string;
  showReminderOption: boolean;
}) {
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<RegistrationForm>({
    resolver: zodResolver(registrationSchema),
    defaultValues: { wantsReminder: showReminderOption },
  });

  const mutation = useMutation({
    mutationFn: (data: EventRegistrationInput) =>
      api.registerForEvent(eventSlug, data),
    onSuccess: () => {
      setRegistered(true);
      setServerError(null);
    },
    onError: (err) => {
      if (isBotCheckError(err)) {
        setServerError("Bot check failed — please try again.");
      } else if (err instanceof ApiError && err.status === 409) {
        setServerError("You're already registered for this event.");
      } else {
        setServerError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
      turnstileRef.current?.reset();
    },
  });

  function onSubmit(data: RegistrationForm) {
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      setServerError("Please complete the bot check.");
      return;
    }
    setServerError(null);
    mutation.mutate({
      ...data,
      turnstileToken: turnstileToken ?? "no-turnstile",
    });
  }

  function handleOpenChange(v: boolean) {
    if (!v) {
      reset();
      setRegistered(false);
      setServerError(null);
      setTurnstileToken(null);
    }
    onOpenChange(v);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        {registered ? (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <CheckCircle2 className="h-14 w-14 text-green-500" />
            <DialogHeader>
              <DialogTitle>You're registered!</DialogTitle>
              <DialogDescription>
                A confirmation email is on its way. We look forward to seeing you at {eventTitle}.
              </DialogDescription>
            </DialogHeader>
            <Button className="mt-2 w-full" onClick={() => handleOpenChange(false)}>
              Close
            </Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Register for {eventTitle}</DialogTitle>
              <DialogDescription>{eventDate}</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="reg-firstName">First name</Label>
                  <Input id="reg-firstName" {...register("firstName")} />
                  {errors.firstName && (
                    <p className="text-xs text-destructive">{errors.firstName.message}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reg-lastName">Last name</Label>
                  <Input id="reg-lastName" {...register("lastName")} />
                  {errors.lastName && (
                    <p className="text-xs text-destructive">{errors.lastName.message}</p>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reg-email">Work email</Label>
                <Input id="reg-email" type="email" {...register("email")} />
                {errors.email && (
                  <p className="text-xs text-destructive">{errors.email.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reg-company">Company</Label>
                <Input id="reg-company" {...register("company")} />
                {errors.company && (
                  <p className="text-xs text-destructive">{errors.company.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reg-jobTitle">Job title</Label>
                <Input id="reg-jobTitle" {...register("jobTitle")} />
                {errors.jobTitle && (
                  <p className="text-xs text-destructive">{errors.jobTitle.message}</p>
                )}
              </div>
              {showReminderOption && (
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    {...register("wantsReminder")}
                    className="h-4 w-4 rounded border border-border accent-primary"
                  />
                  <span className="text-sm">Remind me 24 hours before the event</span>
                </label>
              )}
              <Turnstile
                ref={turnstileRef}
                onVerify={setTurnstileToken}
                theme="auto"
                className="mt-1"
              />
              {serverError && (
                <p className="text-sm text-destructive">{serverError}</p>
              )}
              <Button
                type="submit"
                disabled={isSubmitting || mutation.isPending}
                className="w-full"
              >
                {isSubmitting || mutation.isPending ? "Registering…" : "Complete Registration"}
              </Button>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Speaker `imageUrl` values come straight from `team_members.image_url`
// and can be relative (e.g. `/images/...`). Resolve against BASE_PATH so
// the rendered `<img src>` works under a non-root deploy prefix, mirroring
// the helper on team-detail.tsx.
function resolveImageUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/")) return `${BASE_PATH}${url}`;
  return url;
}

function formatDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(iso: string | Date, timezone?: string | null): string {
  const opts: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  };
  if (timezone) opts.timeZone = timezone;
  return new Date(iso).toLocaleTimeString("en-US", opts);
}

export default function EventDetail() {
  const { slug } = useParams<{ slug: string }>();
  const [registerOpen, setRegisterOpen] = useState(false);

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
  const canRegisterNative = !isPast && event.registrationStatus === "OPEN";
  const canRegisterExternal =
    !isPast &&
    event.registrationStatus === "OPEN_EXTERNAL" &&
    event.registrationUrl;

  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
  const showReminderOption =
    new Date(event.startDate).getTime() - Date.now() > TWENTY_FOUR_HOURS_MS;

  const eventDateLabel = formatDate(event.startDate);

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

            {(event.speakers?.length ?? 0) > 0 && (
              <div className="mt-10" data-testid="event-speakers">
                <h2 className="text-xl font-semibold mb-4">Speakers</h2>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {event.speakers!.map((s) => {
                    const speakerImg = resolveImageUrl(s.imageUrl);
                    return (
                    <li key={s.teamMemberId}>
                      <Link
                        href={`/team/${encodeURIComponent(s.slug)}`}
                        className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 hover:border-primary/40 transition-colors"
                      >
                        <div className="h-12 w-12 rounded-full overflow-hidden bg-muted shrink-0">
                          {speakerImg ? (
                            <img
                              src={speakerImg}
                              alt={s.name}
                              loading="lazy"
                              decoding="async"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="h-full w-full flex items-center justify-center text-xs font-semibold text-muted-foreground">
                              {s.name
                                .split(" ")
                                .map((p) => p[0])
                                .filter(Boolean)
                                .slice(0, 2)
                                .join("")
                                .toUpperCase()}
                            </div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate">
                            {s.name}
                          </p>
                          {s.jobTitle && (
                            <p className="text-xs text-muted-foreground truncate">
                              {s.jobTitle}
                            </p>
                          )}
                        </div>
                      </Link>
                    </li>
                  );
                  })}
                </ul>
              </div>
            )}

            {event.location && mapSrc && (
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
                    {formatTime(event.startDate, (event as { timezone?: string | null }).timezone)}
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
              ) : canRegisterNative ? (
                <button
                  type="button"
                  onClick={() => setRegisterOpen(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
                >
                  Register Now
                </button>
              ) : canRegisterExternal ? (
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

            {(event as { hasSessions?: boolean }).hasSessions && (
              <Link
                href={`/events/${event.slug}/schedule`}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-primary/30 px-4 py-2.5 text-sm font-medium text-primary hover:bg-primary/5 transition-colors"
              >
                <Calendar className="h-4 w-4" />
                View Session Schedule
              </Link>
            )}

            <a
              href={`/api/events/${event.slug}/calendar.ics`}
              download={`${event.slug}.ics`}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-border/60 transition-colors"
            >
              <Download className="h-4 w-4" />
              Add to Calendar
            </a>

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

      <EditWedge
        kind="event"
        id={event.id}
        slug={event.slug}
        snapshot={event}
        queryKey={["event", slug]}
      />

      {canRegisterNative && (
        <EventRegistrationModal
          open={registerOpen}
          onOpenChange={setRegisterOpen}
          eventSlug={event.slug}
          eventTitle={event.title}
          eventDate={eventDateLabel}
          showReminderOption={showReminderOption}
        />
      )}
    </div>
  );
}
