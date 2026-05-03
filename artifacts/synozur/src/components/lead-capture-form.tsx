// #131 — Shared lead-capture form mounted on the white-paper, webinar,
// partner, and demo detail pages. Submits to the generic
// `/forms/:formType` API which persists a `form_submissions` row and
// enqueues a HubSpot contact upsert + timeline event. Keeping the form
// minimal (email + name + optional company + marketing opt-in) avoids
// gating high-intent content behind heavy registration walls while
// still capturing the contact for lifecycle sync.
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, type GenericFormInput } from "@/lib/api";
import { trackEvent } from "@/lib/traffic-tracker";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Turnstile,
  TURNSTILE_SITE_KEY,
  isBotCheckError,
  type TurnstileHandle,
} from "@/components/turnstile";
import { BotCheckCallout } from "@/components/bot-check-callout";

const schema = z.object({
  name: z.string().min(2, "Please share your name"),
  email: z.string().email("Please share a valid email"),
  company: z.string().optional(),
  marketingOptIn: z.boolean().optional(),
  // Honeypot — real users cannot see this field.
  website: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

export type LeadCaptureFormType = "white-paper" | "webinar" | "partner" | "demo";

export interface LeadCaptureFormProps {
  formType: LeadCaptureFormType;
  /**
   * Type-specific context fields stored alongside the submission and
   * mirrored as HubSpot timeline-event tokens. Pulled from the page so
   * that, for example, downloading a white paper records `slug` +
   * `title`, while a webinar registration records `startsAt`.
   */
  context?: Pick<
    GenericFormInput,
    "title" | "slug" | "startsAt" | "application" | "depth" | "partnerType"
  >;
  heading?: string;
  description?: string;
  ctaLabel?: string;
  successMessage?: string;
  /** Optional callback fired after a successful submission. */
  onSuccess?: () => void;
  /** Analytics event name; defaults to `<formType>-form-submit`. */
  analyticsEventName?: string;
  className?: string;
}

export function LeadCaptureForm({
  formType,
  context,
  heading = "Stay in touch",
  description = "Share your details and we'll keep you posted.",
  ctaLabel = "Submit",
  successMessage = "Thanks — we received your submission.",
  onSuccess,
  analyticsEventName,
  className,
}: LeadCaptureFormProps) {
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [botCheckFailed, setBotCheckFailed] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    setSubmitError(null);
    setBotCheckFailed(false);
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      setSubmitError("Please complete the bot check before sending.");
      return;
    }
    try {
      await api.submitGenericForm(
        formType,
        {
          email: data.email,
          name: data.name,
          company: data.company ?? null,
          ...(context ?? {}),
          website: data.website,
          turnstileToken,
        },
        { marketingOptIn: data.marketingOptIn === true },
      );
      setSubmitted(true);
      void trackEvent(analyticsEventName ?? `${formType}-form-submit`, {
        slug: context?.slug ?? null,
      });
      onSuccess?.();
    } catch (err) {
      if (isBotCheckError(err)) {
        setBotCheckFailed(true);
        setTurnstileToken(null);
        turnstileRef.current?.reset();
        return;
      }
      setSubmitError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.",
      );
    }
  };

  if (submitted) {
    return (
      <div className={className}>
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-6">
          <p className="text-sm text-foreground">{successMessage}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="rounded-2xl border border-border/60 bg-card p-6 md:p-8">
        <h3 className="text-xl font-bold mb-2">{heading}</h3>
        <p className="text-sm text-muted-foreground mb-6">{description}</p>

        {botCheckFailed && (
          <div className="mb-4">
            <BotCheckCallout />
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {/* Honeypot: hidden from users, captured by naive bots. */}
          <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", top: "auto", width: 1, height: 1, overflow: "hidden" }}>
            <label>
              Website
              <input type="text" tabIndex={-1} autoComplete="off" {...register("website")} />
            </label>
          </div>

          <div>
            <Label htmlFor={`lc-${formType}-name`}>Name</Label>
            <Input id={`lc-${formType}-name`} {...register("name")} />
            {errors.name && (
              <p className="mt-1 text-xs text-destructive">{errors.name.message}</p>
            )}
          </div>
          <div>
            <Label htmlFor={`lc-${formType}-email`}>Email</Label>
            <Input id={`lc-${formType}-email`} type="email" {...register("email")} />
            {errors.email && (
              <p className="mt-1 text-xs text-destructive">{errors.email.message}</p>
            )}
          </div>
          <div>
            <Label htmlFor={`lc-${formType}-company`}>Company (optional)</Label>
            <Input id={`lc-${formType}-company`} {...register("company")} />
          </div>

          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <input type="checkbox" className="mt-0.5" {...register("marketingOptIn")} />
            <span>
              I'd like to receive occasional updates from Synozur. You can
              unsubscribe at any time.
            </span>
          </label>

          {TURNSTILE_SITE_KEY && (
            <Turnstile ref={turnstileRef} onVerify={setTurnstileToken} />
          )}

          {submitError && (
            <p className="text-sm text-destructive">{submitError}</p>
          )}

          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? "Sending…" : ctaLabel}
          </Button>
        </form>
      </div>
    </div>
  );
}
