import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight, CalendarDays, Megaphone, Mic, PenLine, Sparkles } from "lucide-react";
import { api, type BookingDto } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Meta } from "@/lib/meta";
import { useParentPage } from "@/lib/parent-page";

const PARENT_PAGE_DEFAULTS = {
  heroEyebrow: "Get Started",
  heroHeadline: "Book time, or send a brief.",
  heroSubhead:
    "Pick a Bookings calendar that fits — a general intro, an offer-specific slot, or a conference window. Prefer to write it out? Send a brief instead.",
  seoTitle: "Get Started",
  seoDescription:
    "Book time with The Synozur Alliance — general intros, offer-specific calendars, and conference windows.",
};

const SCOPE_META: Record<
  string,
  { label: string; icon: typeof Sparkles }
> = {
  general: { label: "Always available", icon: Sparkles },
  offer: { label: "Offer", icon: Megaphone },
  conference: { label: "Conference", icon: Mic },
};

function formatRange(b: BookingDto): string | null {
  if (!b.startsAt && !b.endsAt) return null;
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  if (b.startsAt && b.endsAt) return `${fmt(b.startsAt)} – ${fmt(b.endsAt)}`;
  if (b.startsAt) return `Opens ${fmt(b.startsAt)}`;
  if (b.endsAt) return `Through ${fmt(b.endsAt)}`;
  return null;
}

function BookingCard({ booking }: { booking: BookingDto }) {
  const meta = SCOPE_META[booking.scope] ?? SCOPE_META.general;
  const Icon = meta.icon;
  const range = formatRange(booking);
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

export default function Start() {
  const copy = useParentPage("start", PARENT_PAGE_DEFAULTS);

  const { data, isLoading, error } = useQuery({
    queryKey: ["public-bookings"],
    queryFn: () => api.listBookings(),
  });

  const bookings = data?.items ?? [];
  const general = bookings.filter((b) => b.scope === "general");
  const featured = bookings.filter((b) => b.scope !== "general");

  return (
    <>
      <Meta title={copy.seoTitle} description={copy.seoDescription} />

      <section className="relative overflow-hidden bg-[#0B0B1A] py-28 md:py-32">
        <div className="absolute inset-0 nebula-gradient opacity-25" />
        <div className="container relative z-10 mx-auto px-4 max-w-5xl">
          <p className="text-sm uppercase tracking-widest text-primary mb-4 inline-flex items-center gap-2">
            <CalendarDays className="h-4 w-4" />
            {copy.heroEyebrow}
          </p>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-6">
            {copy.heroHeadline}
          </h1>
          <p className="text-xl md:text-2xl text-zinc-300 leading-relaxed max-w-3xl">
            {copy.heroSubhead}
          </p>
        </div>
      </section>

      <div className="container mx-auto px-4 py-12 md:py-16 max-w-5xl">
        {isLoading && (
          <div className="text-muted-foreground">Loading bookings…</div>
        )}
        {error && (
          <div className="text-destructive">
            Failed to load bookings. Please try again or send a brief instead.
          </div>
        )}

        {!isLoading && !error && (
          <>
            {general.length > 0 && (
              <section className="mb-12" data-testid="bookings-general-section">
                <h2 className="text-2xl font-semibold text-foreground mb-6 pb-2 border-b border-border">
                  Always available
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {general.map((b) => (
                    <BookingCard key={b.id} booking={b} />
                  ))}
                </div>
              </section>
            )}

            {featured.length > 0 && (
              <section className="mb-12" data-testid="bookings-featured-section">
                <h2 className="text-2xl font-semibold text-foreground mb-6 pb-2 border-b border-border">
                  Offers and conferences
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {featured.map((b) => (
                    <BookingCard key={b.id} booking={b} />
                  ))}
                </div>
              </section>
            )}

            {bookings.length === 0 && (
              <p className="text-muted-foreground">
                No booking calendars are open right now. Send a brief and a partner
                will follow up directly.
              </p>
            )}
          </>
        )}

        <section
          className="mt-12 rounded-2xl border border-border/60 bg-card p-8 md:p-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6"
          data-testid="start-brief-callout"
        >
          <div>
            <p className="text-xs uppercase tracking-widest text-primary mb-2 inline-flex items-center gap-2">
              <PenLine className="h-3.5 w-3.5" />
              Prefer to write
            </p>
            <h3 className="text-xl md:text-2xl font-semibold mb-1">
              Send a brief instead.
            </h3>
            <p className="text-sm text-muted-foreground max-w-xl">
              A partner will read your note personally and respond within two
              business days — no automation, no sales sequences.
            </p>
          </div>
          <Link href="/start/brief">
            <Button size="lg" data-testid="link-start-brief">
              Send a brief <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </section>
      </div>
    </>
  );
}
