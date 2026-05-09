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

function detectTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

// How many days ahead the availability window extends.
const BOOKING_DAYS = 28;

// Week-day column labels (Sunday-first).
const WEEKDAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

// Returns "YYYY-MM-DD" in the visitor's timezone — used as a stable Map key.
function localDateKey(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: tz,
  }).format(d);
}

// Same calendar day in tz?
function sameDayInTz(a: Date, b: Date, tz: string): boolean {
  return localDateKey(a, tz) === localDateKey(b, tz);
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

  const [serviceId, setServiceId] = useState<string | null>(null);
  const [selectedDateIso, setSelectedDateIso] = useState<string>(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today.toISOString();
  });
  const [selectedSlot, setSelectedSlot] = useState<{ startUtc: string; endUtc: string } | null>(null);

  const [confirmed, setConfirmed] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [botCheckFailed, setBotCheckFailed] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);

  // Build the calendar grid and the availability fetch window.
  //
  // gridDays  — every cell rendered in the calendar (Sunday-aligned rows).
  // stripDays — today → today+BOOKING_DAYS (the window we query for slots).
  // todayMs   — local midnight of today (stable reference).
  const { gridDays, stripDays, todayMs } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tMs = today.getTime();

    // Availability window: today to today + BOOKING_DAYS.
    const strip: Date[] = [];
    for (let i = 0; i < BOOKING_DAYS; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      strip.push(d);
    }

    // Grid starts on the Sunday of the current week.
    const gridStart = new Date(today);
    gridStart.setDate(today.getDate() - today.getDay());

    // Grid ends on the Saturday on or after the last strip day.
    const lastStrip = strip[strip.length - 1]!;
    const gridEnd = new Date(lastStrip);
    gridEnd.setDate(lastStrip.getDate() + (6 - lastStrip.getDay()));

    const grid: Date[] = [];
    const cur = new Date(gridStart);
    while (cur <= gridEnd) {
      grid.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }

    return { gridDays: grid, stripDays: strip, todayMs: tMs };
  }, []);

  // Services + business metadata.
  const servicesQuery = useQuery({
    queryKey: ["native-bookings", slug, "services"],
    queryFn: () => api.listNativeBookingServices(slug),
    retry: false,
  });

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

  // Availability — one fetch for the full 28-day window; filtered client-side per day.
  const stripStartUtc = stripDays[0]?.toISOString();
  const stripEndMs = stripDays[stripDays.length - 1]
    ? stripDays[stripDays.length - 1]!.getTime() + 24 * 60 * 60 * 1000
    : undefined;
  const stripEndUtc = stripEndMs ? new Date(stripEndMs).toISOString() : undefined;

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

  // Set of "YYYY-MM-DD" strings (in visitor tz) that have at least one slot.
  const datesWithSlots = useMemo<Set<string> | null>(() => {
    if (!availabilityQuery.data) return null; // null = still loading
    const s = new Set<string>();
    for (const slot of availabilityQuery.data.slots) {
      s.add(localDateKey(new Date(slot.startUtc), tz));
    }
    return s;
  }, [availabilityQuery.data, tz]);

  const slotsForSelectedDate = useMemo(() => {
    if (!selectedDateIso || !availabilityQuery.data) return [];
    const target = new Date(selectedDateIso);
    return availabilityQuery.data.slots.filter((s) =>
      sameDayInTz(new Date(s.startUtc), target, tz),
    );
  }, [availabilityQuery.data, selectedDateIso, tz]);

  // Submit appointment.
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

  const windowEndMs = todayMs + BOOKING_DAYS * 24 * 60 * 60 * 1000;
  const isLoading = availabilityQuery.isLoading;

  return (
    <div className="space-y-8" data-testid="booking-native">
      {/* Service picker */}
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

      {/* Calendar grid */}
      {selectedService && (
        <div>
          <h2 className="text-sm uppercase tracking-widest text-primary mb-3 flex items-center gap-2">
            <CalendarIcon className="h-4 w-4" /> Pick a day
          </h2>

          {/* Weekday column headers */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEKDAY_HEADERS.map((h) => (
              <div
                key={h}
                className="text-center text-xs font-medium text-muted-foreground py-1"
              >
                {h}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-1">
            {gridDays.map((d) => {
              const dMs = d.getTime();
              const iso = d.toISOString();
              const key = localDateKey(d, tz);
              const isToday = dMs === todayMs;
              const isPast = dMs < todayMs;
              const isBeyond = dMs >= windowEndMs;
              const isOutside = isPast || isBeyond;
              const isSelected = iso === selectedDateIso;

              // Has slots: null while loading (show neutral), true/false once loaded.
              const hasSlots = datesWithSlots === null ? null : datesWithSlots.has(key);
              const isUnavailable = !isOutside && !isLoading && hasSlots === false;

              // Month label shown only on the 1st of each month (or on gridStart
              // if it's not the 1st, so the user sees which month they're in).
              const showMonth = d.getDate() === 1 || (dMs === gridDays[0]?.getTime());
              const monthLabel = d.toLocaleDateString(undefined, { month: "short", timeZone: tz });

              let cellClass =
                "relative flex flex-col items-center justify-center rounded-lg border py-2 min-h-[3.25rem] text-center transition-colors select-none ";

              if (isSelected && !isOutside) {
                cellClass += "border-primary bg-primary text-primary-foreground font-semibold ";
              } else if (isOutside) {
                cellClass += "border-transparent text-muted-foreground/25 cursor-default ";
              } else if (isLoading) {
                cellClass +=
                  "border-border/40 text-muted-foreground/40 animate-pulse cursor-default ";
              } else if (isUnavailable) {
                cellClass +=
                  "border-border/30 text-muted-foreground/40 cursor-pointer hover:border-border/60 ";
              } else {
                cellClass +=
                  "border-border cursor-pointer hover:border-primary/60 hover:bg-primary/5 ";
                if (isToday) cellClass += "ring-1 ring-primary/30 ";
              }

              return (
                <button
                  key={iso}
                  type="button"
                  disabled={isOutside}
                  onClick={() => {
                    if (isOutside) return;
                    setSelectedDateIso(iso);
                    setSelectedSlot(null);
                  }}
                  data-testid={`date-${iso}`}
                  className={cellClass}
                >
                  {/* Month label on 1st or grid start */}
                  {showMonth && !isOutside && (
                    <span className="text-[10px] leading-none text-muted-foreground mb-0.5">
                      {monthLabel}
                    </span>
                  )}

                  {/* Day number */}
                  <span
                    className={`text-base font-semibold leading-none ${
                      isUnavailable ? "line-through decoration-muted-foreground/40" : ""
                    }`}
                  >
                    {d.getDate()}
                  </span>

                  {/* Today dot */}
                  {isToday && !isSelected && (
                    <span className="absolute bottom-1 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-primary" />
                  )}

                  {/* Unavailable × */}
                  {isUnavailable && (
                    <span className="text-[9px] leading-none text-muted-foreground/50 mt-0.5">
                      ✕
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Legend */}
          <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm border border-border" />
              Available
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm border border-border/30 opacity-40" />
              No openings
            </span>
          </div>
        </div>
      )}

      {/* Time slot grid */}
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
              No open times on this day — pick another date above.
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

      {/* Contact form */}
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
