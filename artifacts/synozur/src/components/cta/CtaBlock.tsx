import { Link } from "wouter";
import { ArrowRight, CalendarClock, Mail, MessageSquareText } from "lucide-react";
import { cn } from "@/lib/utils";
import { trackEvent } from "@/lib/traffic-tracker";

// Reusable end-of-page call-to-action. Replaces the per-page hand-rolled
// closing CTA <section>s that were duplicated across the site (applications,
// insight-detail, resource pages, …). Every click records a `cta-click`
// traffic event tagged with `source` so lead-gen effectiveness can be
// measured per surface once the experimentation/analytics layer (#140) lands.
//
// Three intents cover the site's needs:
//   - "talk"      → conversational lead-gen ("Talk to us about this")   → /contact
//   - "book"      → schedule time                                        → /book
//   - "subscribe" → join the content list                               → /subscribe
// Any of these can be overridden via `href`/`ctaLabel` for one-off targets.

export type CtaIntent = "talk" | "book" | "subscribe";

interface IntentPreset {
  eyebrow: string;
  heading: string;
  body: string;
  ctaLabel: string;
  href: string;
  Icon: typeof MessageSquareText;
}

const INTENT_PRESETS: Record<CtaIntent, IntentPreset> = {
  talk: {
    eyebrow: "Let's talk",
    heading: "Talk to us about this",
    body: "Tell us what you're working on and we'll point you to the people, frameworks, and applications that fit.",
    ctaLabel: "Talk to us",
    href: "/contact",
    Icon: MessageSquareText,
  },
  book: {
    eyebrow: "Get started",
    heading: "Book time with Synozur",
    body: "Grab a slot with our team, or send a brief and we'll come prepared.",
    ctaLabel: "Book time",
    href: "/book",
    Icon: CalendarClock,
  },
  subscribe: {
    eyebrow: "Stay in the loop",
    heading: "Get Synozur in your inbox",
    body: "New essays, models, Polaris episodes, and events — pick what you want and we'll send it.",
    ctaLabel: "Choose your subscriptions",
    href: "/subscribe",
    Icon: Mail,
  },
};

export interface CtaBlockProps {
  /** Which built-in call-to-action to show. Defaults to "talk". */
  intent?: CtaIntent;
  /** Analytics source tag, e.g. "insight-detail", "applications", "home-b". */
  source: string;
  /** Optional overrides for the preset copy/target. */
  eyebrow?: string;
  heading?: string;
  body?: string;
  ctaLabel?: string;
  href?: string;
  /** Optional secondary link (e.g. a subscribe link beside a "talk" CTA). */
  secondary?: { label: string; href: string };
  /** Visual treatment. "band" is a full-width section; "card" is inline. */
  variant?: "band" | "card";
  className?: string;
}

function isExternal(href: string) {
  return /^https?:\/\//.test(href);
}

export function CtaBlock({
  intent = "talk",
  source,
  eyebrow,
  heading,
  body,
  ctaLabel,
  href,
  secondary,
  variant = "band",
  className,
}: CtaBlockProps) {
  const preset = INTENT_PRESETS[intent];
  const resolvedHref = href ?? preset.href;
  const resolvedLabel = ctaLabel ?? preset.ctaLabel;
  const Icon = preset.Icon;

  const firePrimary = () =>
    void trackEvent("cta-click", { source, intent, href: resolvedHref });
  const fireSecondary = () =>
    secondary &&
    void trackEvent("cta-click", {
      source,
      intent: "secondary",
      href: secondary.href,
    });

  const primaryClasses =
    "inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90";

  const PrimaryButton = isExternal(resolvedHref) ? (
    <a
      href={resolvedHref}
      target="_blank"
      rel="noopener noreferrer"
      onClick={firePrimary}
      className={primaryClasses}
      data-testid={`cta-primary-${source}`}
    >
      {resolvedLabel} <ArrowRight className="ml-2 h-4 w-4" />
    </a>
  ) : (
    <Link
      href={resolvedHref}
      onClick={firePrimary}
      className={primaryClasses}
      data-testid={`cta-primary-${source}`}
    >
      {resolvedLabel} <ArrowRight className="ml-2 h-4 w-4" />
    </Link>
  );

  const inner = (
    <div className="mx-auto max-w-2xl text-center">
      <div className="mb-4 inline-flex items-center gap-2 text-sm uppercase tracking-widest text-primary">
        <Icon className="h-4 w-4" />
        <span>{eyebrow ?? preset.eyebrow}</span>
      </div>
      <h2 className="mb-4 text-3xl font-bold md:text-4xl">
        {heading ?? preset.heading}
      </h2>
      <p className="mb-8 text-lg text-muted-foreground">{body ?? preset.body}</p>
      <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
        {PrimaryButton}
        {secondary && (
          <Link
            href={secondary.href}
            onClick={fireSecondary}
            className="inline-flex h-12 items-center justify-center rounded-md border border-border px-6 text-base font-medium text-foreground transition-colors hover:text-primary"
            data-testid={`cta-secondary-${source}`}
          >
            {secondary.label}
          </Link>
        )}
      </div>
    </div>
  );

  if (variant === "card") {
    return (
      <div
        className={cn(
          "rounded-2xl border border-border bg-card p-8 md:p-10",
          className,
        )}
        data-testid={`cta-block-${source}`}
      >
        {inner}
      </div>
    );
  }

  return (
    <section
      className={cn(
        "relative overflow-hidden border-t border-border bg-card py-20 md:py-24",
        className,
      )}
      data-testid={`cta-block-${source}`}
    >
      <div aria-hidden="true" className="absolute inset-0 nebula-gradient opacity-10" />
      <div className="container relative z-10 mx-auto px-4">{inner}</div>
    </section>
  );
}
