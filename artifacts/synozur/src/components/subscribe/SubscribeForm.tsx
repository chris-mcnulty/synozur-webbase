import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import {
  Turnstile,
  TURNSTILE_SITE_KEY,
  isBotCheckError,
  type TurnstileHandle,
} from "@/components/turnstile";
import { BotCheckCallout } from "@/components/bot-check-callout";
import { cn } from "@/lib/utils";
import { trackEvent } from "@/lib/traffic-tracker";

// The single subscribe component for the whole site. Replaces the ~5 duplicate
// implementations (InsightsSubscribeForm, FooterSubscribeForm, /join page form,
// insight-detail "Get on the list" link). All post to the same
// `api.submitSubscribe` endpoint (double opt-in #168, HubSpot mirror #131).
//
// Content-type preferences ("subscribe by type") are captured client-side and
// encoded into the `source` tag (e.g. "subscribe-center:blog,events") because
// the SubscribeFormInput API contract has no first-class topics field yet —
// promoting topics to a real API/DB column is a tracked follow-up. The admin
// subscribers view already groups by `source`, so the signal is usable today.

export const SUBSCRIBE_TOPICS = [
  { id: "blog", label: "Blog", hint: "Essays & analysis" },
  { id: "podcast", label: "Polaris Podcast", hint: "New episodes" },
  { id: "white-papers", label: "White papers", hint: "Research & guides" },
  { id: "events", label: "Events", hint: "Webinars & workshops" },
  { id: "newsletter", label: "Newsletter", hint: "The monthly digest" },
] as const;

export type SubscribeTopicId = (typeof SUBSCRIBE_TOPICS)[number]["id"];

type Status =
  | "idle"
  | "submitting"
  | "success"
  | "error"
  | "bot-check-failed";

export interface SubscribeFormProps {
  /** Base analytics/attribution source, e.g. "footer", "subscribe-center". */
  source: string;
  /** Show the content-type checkboxes. Off for tight surfaces like the footer. */
  showTopics?: boolean;
  /** Topics ticked by default. */
  defaultTopics?: SubscribeTopicId[];
  heading?: string;
  subcopy?: string;
  submitLabel?: string;
  successHeading?: string;
  successBody?: string;
  /** "card" (bordered panel) or "bare" (no chrome, e.g. inside footer). */
  variant?: "card" | "bare";
  className?: string;
}

export function SubscribeForm({
  source,
  showTopics = true,
  defaultTopics = ["newsletter"],
  heading = "Subscribe",
  subcopy = "Pick what you want to hear about. One email to confirm — unsubscribe anytime.",
  submitLabel = "Subscribe",
  successHeading = "You're in.",
  successBody = "Check your inbox to confirm your subscription. No spam, unsubscribe anytime.",
  variant = "card",
  className,
}: SubscribeFormProps) {
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [topics, setTopics] = useState<SubscribeTopicId[]>(defaultTopics);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);

  const toggleTopic = (id: SubscribeTopicId) =>
    setTopics((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id],
    );

  const resolvedSource =
    showTopics && topics.length > 0 ? `${source}:${topics.join(",")}` : source;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "submitting") return;
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      setStatus("error");
      setErrorMessage("Please complete the bot check before subscribing.");
      return;
    }
    setStatus("submitting");
    setErrorMessage(null);
    try {
      await api.submitSubscribe(
        {
          email,
          source: resolvedSource,
          website: website || null,
          turnstileToken,
        },
        { marketingOptIn: true },
      );
      void trackEvent("subscribe-submit", { source, topics: topics.join(",") });
      setStatus("success");
    } catch (err) {
      if (isBotCheckError(err)) {
        setStatus("bot-check-failed");
        setErrorMessage(null);
        setTurnstileToken(null);
        turnstileRef.current?.reset();
        return;
      }
      setStatus("error");
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Could not subscribe. Please try again.",
      );
    }
  };

  if (status === "success") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          variant === "card"
            ? "relative overflow-hidden rounded-2xl border border-primary/40 bg-card p-8 text-center md:p-10"
            : "text-center",
          className,
        )}
        data-testid={`subscribe-success-${source}`}
      >
        {variant === "card" && (
          <div className="absolute inset-0 nebula-gradient opacity-15" />
        )}
        <div className="relative">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Check className="h-7 w-7" />
          </div>
          <h3 className="mb-3 text-2xl font-bold">{successHeading}</h3>
          <p className="mx-auto max-w-md text-muted-foreground">{successBody}</p>
        </div>
      </motion.div>
    );
  }

  const form = (
    <form onSubmit={handleSubmit} className="space-y-5" data-testid={`subscribe-form-${source}`}>
      {(heading || subcopy) && (
        <div>
          {heading && <h3 className="mb-1 text-xl font-bold">{heading}</h3>}
          {subcopy && <p className="text-sm text-muted-foreground">{subcopy}</p>}
        </div>
      )}
      <div className="space-y-2">
        <label htmlFor={`sub-email-${source}`} className="text-sm font-medium leading-none">
          Email address
        </label>
        <Input
          id={`sub-email-${source}`}
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
        />
      </div>

      {showTopics && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium leading-none">
            What should we send you?
          </legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {SUBSCRIBE_TOPICS.map((t) => {
              const checked = topics.includes(t.id);
              return (
                <label
                  key={t.id}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                    checked
                      ? "border-primary/50 bg-primary/5"
                      : "border-border hover:border-primary/30",
                  )}
                  data-testid={`subscribe-topic-${t.id}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleTopic(t.id)}
                    aria-label={t.label}
                    className="mt-0.5 h-4 w-4 accent-[var(--primary)]"
                  />
                  <span className="min-w-0 text-sm font-medium">
                    {t.label}
                    <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                      {t.hint}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      {/* Honeypot — must stay empty */}
      <input
        type="text"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden"
      />
      <Turnstile ref={turnstileRef} onVerify={setTurnstileToken} />
      {status === "bot-check-failed" && <BotCheckCallout />}
      {status === "error" && errorMessage && (
        <p className="text-sm text-destructive" role="alert">
          {errorMessage}
        </p>
      )}
      <Button type="submit" disabled={status === "submitting"} className="w-full sm:w-auto">
        {status === "submitting" ? "Subscribing..." : submitLabel}
      </Button>
    </form>
  );

  if (variant === "card") {
    return (
      <div
        className={cn("rounded-2xl border border-border/60 bg-card p-8 md:p-10", className)}
      >
        {form}
      </div>
    );
  }
  return <div className={className}>{form}</div>;
}
