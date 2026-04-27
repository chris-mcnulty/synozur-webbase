import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRight, Calendar as CalendarIcon, Check, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, type NativeBookingService } from "@/lib/api";
import {
  Turnstile,
  TURNSTILE_SITE_KEY,
  isBotCheckError,
  type TurnstileHandle,
} from "@/components/turnstile";
import { BotCheckCallout } from "@/components/bot-check-callout";

interface Props {
  slug: string;
  bookingTitle: string;
}

// Visitor's IANA timezone, captured once on mount.
function detectTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

// Number of days to show in the horizontal date strip. The matching
// availability window on the api-server caps at 14 days.
const DATE_STRIP_DAYS = 14;

// Format helpers that use the visitor's locale and the captured timezone.
function fmtDate(d: Date, tz: string): { weekday: string; day: string; month: string } {
  const fmt = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: tz,
  }).formatToParts(d);
  const part = (t: string) => fmt.find((p) => p.type === t)?.value ?? "";
  return { weekday: part("weekday"), day: part("day"), month: part("month") };
}

function fmtTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  }).format(new Date(iso));
}

function fmtFullDate(iso: string, tz: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: tz,
  }).format(new Date(iso));
}

// "Same calendar day in tz?" — used to filter slots into the selected date.
function sameDayInTz(a: Date, b: Date, tz: string): boolean {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: tz,
  });
  return fmt.format(a) === fmt.format(b);
}

const contactSchema = z.object({
  name: z.string().min(2, "Your name, please"),
  email: z.string().email("A valid email, please"),
  phone: z.string().optional(),
  notes: z.string().max(2000).optional(),
  website: z.string().optional(),
});

type ContactFormData = z.infer<typeof contactSchema>;

export default function StartDetailNative({ slug, bookingTitle }: Props) {
  const tz = useMemo(() => detectTimeZone(), []);

  // Visitor's selections. selectedDateIso is initialized lazily to today's
  // local midnight so it matches the dateStrip buttons (also local midnight)
  // and the sameDayInTz slot filtering.
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [selectedDateIso, setSelectedDateIso] = useState<string>(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today.toISOString();
  });
  const [selectedSlot, setSelectedSlot] = useState<{ startUtc: string; endUtc: string } | null>(null);

  // Confirmation + bot-check state.
  const [confirmed, setConfirmed] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [botCheckFailed, setBotCheckFailed] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);

  // Date strip — 14 days starting today, anchored to the visitor's local
  // midnight so button labels and timezone-aware slot filtering stay aligned.
  const dateStrip = useMemo(() => {
    const days: Date[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 0; i < DATE_STRIP_DAYS; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      days.push(d);
    }
    return days;
  }, []);

  // 1. Services + business metadata.
  const servicesQuery = useQuery({
    queryKey: ["native-bookings", slug, "services"],
    queryFn: () => api.listNativeBookingServices(slug),
    retry: false,
  });

  // Auto-pick service: prefer the booking's default; else the only service;
  // else stay null until the visitor chooses. Runs in an effect (not during
  // render) so React 18 strict-mode doesn't warn about updates during render.
  useEffect(() => {
    if (serviceId !== null) return;
    if (!servicesQuery.data) return;
    const services = servicesQuery.data.services;
    if (services.length === 0) return;
    const def = servicesQuery.data.defaultServiceId;
    const match = def ? services.find((s) => s.id === def) : null;
    if (match) {
      setServiceId(match.id);
    } else if (services.length === 1) {
      setServiceId(services[0]!.id);
    }
  }, [servicesQuery.data, serviceId]);

  // 2. Availability — fetch for the full strip in one round trip; we filter
  // client-side per day. Caching is by (slug, serviceId) so flipping dates
  // doesn't re-hit the server.
  const stripStartUtc = dateStrip[0]?.toISOString();
  const stripEndUtc = dateStrip[dateStrip.length - 1]
    ? new Date(dateStrip[dateStrip.length - 1]!.getTime() + 24 * 60 * 60 * 1000).toISOString()
    : undefined;

  const availabilityQuery = useQuery({
    queryKey: ["native-bookings", slug, "availability", serviceId, stripStartUtc, stripEndUtc],
    queryFn: () =>
      api.listNativeBookingAvailability(slug, {
        serviceId: serviceId!,
        startUtc: stripStartUtc!,
        endUtc: stripEndUtc!,
      }),
    enabled: Boolean(serviceId && stripStartUtc && stripEndUtc),
    retry: false,
  });

  const slotsForSelectedDate = useMemo(() => {
    if (!selectedDateIso || !availabilityQuery.data) return [];
    const target = new Date(selectedDateIso);
    return availabilityQuery.data.slots.filter((s) =>
      sameDayInTz(new Date(s.startUtc), target, tz),
    );
  }, [availabilityQuery.data, selectedDateIso, tz]);

  // 3. Submit appointment.
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ContactFormData>({
    resolver: zodResolver(contactSchema),
  });

  const submitMutation = useMutation({
    mutationFn: async (data: ContactFormData) => {
      if (!serviceId || !selectedSlot) throw new Error("Pick a time first.");
      if (TURNSTILE_SITE_KEY && !turnstileToken) {
        throw new Error("Please complete the bot check before sending.");
      }
      return api.createNativeBookingAppointment(slug, {
        serviceId,
        startUtc: selectedSlot.startUtc,
        endUtc: selectedSlot.endUtc,
        customer: {
          name: data.name,
          email: data.email,
          phone: data.phone || null,
          notes: data.notes || null,
        },
        customerTimeZone: tz,
        turnstileToken,
        website: data.website,
      });
    },
    onSuccess: () => setConfirmed(true),
    onError: (err: Error) => {
      if (isBotCheckError(err)) {
        setBotCheckFailed(true);
        setTurnstileToken(null);
        turnstileRef.current?.reset();
        return;
      }
      setSubmitError(err.message);
    },
  });

  // ------------- Render -------------

  if (servicesQuery.isLoading) {
    return <p className="text-muted-foreground">Loading availability…</p>;
  }
  if (servicesQuery.error) {
    return (
      <div
        className="rounded-2xl border border-destructive/40 bg-card p-6"
        data-testid="booking-native-error"
      >
        <p className="text-destructive font-medium mb-2">
          We couldn't load this booking right now.
        </p>
        <p className="text-sm text-muted-foreground">
          {servicesQuery.error instanceof Error
            ? servicesQuery.error.message
            : "Please try again or send a brief instead."}
        </p>
      </div>
    );
  }

  if (confirmed) {
    return (
      <div
        className="rounded-2xl border border-primary/40 bg-card p-10 text-center"
        data-testid="booking-native-confirmed"
      >
        <div className="mx-auto h-16 w-16 rounded-full bg-primary/15 text-primary flex items-center justify-center mb-6">
          <Check className="h-8 w-8" />
        </div>
        <h2 className="text-2xl font-bold mb-2">You're booked.</h2>
        <p className="text-muted-foreground max-w-md mx-auto mb-2">
          A confirmation email is on the way with calendar details and a link to
          reschedule or cancel.
        </p>
        {selectedSlot && (
          <p className="text-sm text-muted-foreground">
            {fmtFullDate(selectedSlot.startUtc, tz)} at{" "}
            {fmtTime(selectedSlot.startUtc, tz)} ({tz})
          </p>
        )}
      </div>
    );
  }

  const services = servicesQuery.data?.services ?? [];
  const selectedService: NativeBookingService | null =
    services.find((s) => s.id === serviceId) ?? null;

  return (
    <div className="space-y-8" data-testid="booking-native">
      {/* Service picker — only renders when there's a real choice to make. */}
      {services.length > 1 && (
        <div>
          <h2 className="text-sm uppercase tracking-widest text-primary mb-3">
            Choose a service
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {services.map((s) => {
              const active = s.id === serviceId;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setServiceId(s.id);
                    setSelectedSlot(null);
                  }}
                  data-testid={`service-${s.id}`}
                  className={`text-left rounded-xl border-2 p-4 transition-colors hover:border-primary/60 ${
                    active ? "border-primary bg-primary/5" : "border-border"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-medium">{s.displayName}</span>
                    {s.defaultDurationMinutes && (
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        <Clock className="inline h-3 w-3 mr-1 -mt-0.5" />
                        {s.defaultDurationMinutes} min
                      </span>
                    )}
                  </div>
                  {s.description && (
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                      {s.description}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Date strip */}
      {selectedService && (
        <div>
          <h2 className="text-sm uppercase tracking-widest text-primary mb-3 flex items-center gap-2">
            <CalendarIcon className="h-4 w-4" /> Pick a day
          </h2>
          <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
            {dateStrip.map((d) => {
              const iso = d.toISOString();
              const active = iso === selectedDateIso;
              const parts = fmtDate(d, tz);
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => {
                    setSelectedDateIso(iso);
                    setSelectedSlot(null);
                  }}
                  data-testid={`date-${iso}`}
                  className={`flex-shrink-0 w-20 rounded-xl border-2 p-3 text-center transition-colors hover:border-primary/60 ${
                    active ? "border-primary bg-primary/5" : "border-border"
                  }`}
                >
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    {parts.weekday}
                  </div>
                  <div className="text-2xl font-semibold leading-tight mt-1">
                    {parts.day}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {parts.month}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Time slot grid — multi-column on desktop, the whole reason we widened
          the page. */}
      {selectedService && (
        <div>
          <h2 className="text-sm uppercase tracking-widest text-primary mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4" /> Pick a time
            <span className="font-normal normal-case tracking-normal text-muted-foreground">
              · times shown in {tz}
            </span>
          </h2>
          {availabilityQuery.isLoading && (
            <p className="text-muted-foreground text-sm">Loading times…</p>
          )}
          {availabilityQuery.error && (
            <p className="text-destructive text-sm">
              {availabilityQuery.error instanceof Error
                ? availabilityQuery.error.message
                : "Couldn't load availability."}
            </p>
          )}
          {!availabilityQuery.isLoading && slotsForSelectedDate.length === 0 && (
            <p className="text-muted-foreground text-sm">
              No open times on this day. Try another day in the strip above.
            </p>
          )}
          {slotsForSelectedDate.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
              {slotsForSelectedDate.map((s) => {
                const active = selectedSlot?.startUtc === s.startUtc;
                return (
                  <button
                    key={s.startUtc}
                    type="button"
                    onClick={() => setSelectedSlot(s)}
                    data-testid={`slot-${s.startUtc}`}
                    className={`rounded-md border-2 px-3 py-2 text-sm font-medium transition-colors hover:border-primary/60 ${
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card"
                    }`}
                  >
                    {fmtTime(s.startUtc, tz)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Contact form — appears once a slot is chosen. */}
      {selectedSlot && (
        <form
          onSubmit={handleSubmit((d) => {
            setSubmitError(null);
            setBotCheckFailed(false);
            submitMutation.mutate(d);
          })}
          className="rounded-2xl border border-border bg-card p-6 md:p-8 space-y-5"
          data-testid="booking-native-form"
        >
          <div>
            <h2 className="text-sm uppercase tracking-widest text-primary mb-1">
              Confirm your details
            </h2>
            <p className="text-sm text-muted-foreground">
              {bookingTitle} ·{" "}
              <strong className="text-foreground">
                {fmtFullDate(selectedSlot.startUtc, tz)}
              </strong>{" "}
              at{" "}
              <strong className="text-foreground">
                {fmtTime(selectedSlot.startUtc, tz)}
              </strong>{" "}
              ({tz})
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="bn-name">Name</Label>
              <Input id="bn-name" {...register("name")} />
              {errors.name && (
                <p className="text-sm text-destructive">{errors.name.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="bn-email">Work email</Label>
              <Input id="bn-email" type="email" {...register("email")} />
              {errors.email && (
                <p className="text-sm text-destructive">{errors.email.message}</p>
              )}
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="bn-phone">Phone (optional)</Label>
              <Input id="bn-phone" type="tel" {...register("phone")} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="bn-notes">Anything we should know? (optional)</Label>
              <Textarea id="bn-notes" rows={4} {...register("notes")} />
            </div>
          </div>

          {/* Honeypot. */}
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden"
            {...register("website")}
          />

          <Turnstile ref={turnstileRef} onVerify={setTurnstileToken} />
          {botCheckFailed && <BotCheckCallout />}
          {submitError && (
            <p className="text-sm text-destructive" role="alert">
              {submitError}
            </p>
          )}

          <Button type="submit" disabled={isSubmitting || submitMutation.isPending}>
            {submitMutation.isPending ? (
              "Booking…"
            ) : (
              <>
                Confirm booking <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
        </form>
      )}
    </div>
  );
}
