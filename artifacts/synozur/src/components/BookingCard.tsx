import { Link } from "wouter";
import { ArrowRight, Megaphone, Mic, Sparkles } from "lucide-react";

const SCOPE_META: Record<string, { label: string; icon: typeof Sparkles }> = {
  general: { label: "Always available", icon: Sparkles },
  offer: { label: "Offer", icon: Megaphone },
  conference: { label: "Conference", icon: Mic },
};

function formatRange(startsAt: string | null, endsAt: string | null): string | null {
  if (!startsAt && !endsAt) return null;
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  if (startsAt && endsAt) return `${fmt(startsAt)} – ${fmt(endsAt)}`;
  if (startsAt) return `Opens ${fmt(startsAt)}`;
  if (endsAt) return `Through ${fmt(endsAt)}`;
  return null;
}

export interface BookingCardProps {
  id: string;
  slug: string;
  title: string;
  teaser: string | null;
  scope: string;
  startsAt: string | null;
  endsAt: string | null;
}

export function BookingCard({ booking }: { booking: BookingCardProps }) {
  const meta = SCOPE_META[booking.scope] ?? SCOPE_META.general;
  const Icon = meta.icon;
  const range = formatRange(booking.startsAt, booking.endsAt);
  return (
    <Link
      href={`/start/${booking.slug}`}
      className="group flex flex-col rounded-2xl border border-border bg-card p-6 hover-elevate transition-colors"
      data-testid={`booking-card-${booking.slug}`}
    >
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-primary mb-4">
        <Icon className="h-3.5 w-3.5" />
        <span>{meta.label}</span>
        {range && <span className="text-muted-foreground normal-case tracking-normal">· {range}</span>}
      </div>
      <h3 className="text-2xl font-semibold mb-2 group-hover:text-primary transition-colors">
        {booking.title}
      </h3>
      {booking.teaser && (
        <p className="text-sm text-muted-foreground leading-relaxed mb-6">
          {booking.teaser}
        </p>
      )}
      <div className="mt-auto inline-flex items-center gap-2 text-sm font-medium text-primary">
        Book time <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}
