import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, CalendarDays } from "lucide-react";
import { api } from "@/lib/api";
import { Meta } from "@/lib/meta";
import { sanitizeHtml } from "@/components/rich-text";
import NotFound from "@/pages/not-found";

interface Props {
  slug: string;
}

export default function StartDetail({ slug }: Props) {
  const { data: booking, isLoading, error } = useQuery({
    queryKey: ["public-booking", slug],
    queryFn: () => api.getBooking(slug),
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-24 max-w-5xl">
        <div className="text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (error || !booking) {
    return <NotFound />;
  }

  const description = booking.descriptionHtml ? sanitizeHtml(booking.descriptionHtml) : null;

  return (
    <>
      <Meta
        title={booking.seoTitle || booking.title}
        description={booking.seoDescription || booking.teaser || undefined}
      />

      <section className="relative overflow-hidden bg-[#0B0B1A] py-20 md:py-24">
        <div className="absolute inset-0 nebula-gradient opacity-25" />
        <div className="container relative z-10 mx-auto px-4 max-w-5xl">
          <Link
            href="/start"
            className="inline-flex items-center gap-2 text-sm text-zinc-300 hover:text-white mb-6"
            data-testid="link-back-to-start"
          >
            <ArrowLeft className="h-4 w-4" /> All bookings
          </Link>
          <p className="text-sm uppercase tracking-widest text-primary mb-4 inline-flex items-center gap-2">
            <CalendarDays className="h-4 w-4" />
            Book time
          </p>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-white mb-4">
            {booking.title}
          </h1>
          {booking.teaser && (
            <p className="text-lg md:text-xl text-zinc-300 leading-relaxed max-w-3xl">
              {booking.teaser}
            </p>
          )}
        </div>
      </section>

      {description && (
        <div className="container mx-auto px-4 pt-12 md:pt-16 max-w-5xl">
          <div
            className="prose prose-invert max-w-3xl"
            dangerouslySetInnerHTML={{ __html: description }}
          />
        </div>
      )}

      {/*
        Microsoft Bookings is served from a cross-origin host, so its internal
        fonts and colors cannot be restyled from this page (browser sandbox).
        The widest impact we can have is giving it more horizontal room so the
        embedded UI lays its time-slot options out in multiple columns instead
        of a single tall stack. We break out of the narrower text container
        here and use a wider wrapper on lg+ breakpoints.
      */}
      <div className="container mx-auto px-4 py-12 md:py-16 max-w-7xl 2xl:max-w-screen-2xl">
        <div
          className="rounded-2xl border border-border bg-card overflow-hidden"
          data-testid="booking-embed"
        >
          <iframe
            src={booking.embedUrl}
            title={booking.title}
            width="100%"
            height="1100"
            scrolling="yes"
            style={{ border: 0, display: "block" }}
            allow="clipboard-write"
          />
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          Calendar provided by Microsoft Bookings. Having trouble?{" "}
          <a
            href={booking.embedUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="underline hover:text-foreground"
          >
            Open in a new tab
          </a>
          .
        </p>
      </div>
    </>
  );
}
