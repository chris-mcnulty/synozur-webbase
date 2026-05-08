// Booking links block. Shown on the homepage hero only when an active
// experiment populates `home.booking.*` overrides. Hidden by default.
import { Link } from "wouter";
import { ArrowRight, Calendar } from "lucide-react";
import { useOverride, useTrackConversion } from "@/lib/experiments";
import type { BookingLink as BookingLinkType } from "@workspace/api-zod";

const DEFAULT_LINKS: BookingLinkType[] = [];

export function BookingLinks() {
  const visible = useOverride<boolean>("home.booking.visible", false);
  const heading = useOverride<string>("home.booking.heading", "");
  const links = useOverride<BookingLinkType[]>(
    "home.booking.links",
    DEFAULT_LINKS,
  );
  const trackConversion = useTrackConversion();

  if (!visible || links.length === 0) return null;

  return (
    <section className="py-12 bg-background border-b border-border">
      <div className="container mx-auto px-4">
        {heading ? (
          <h2 className="text-xl font-semibold mb-6 text-center">{heading}</h2>
        ) : null}
        <ul className="flex flex-wrap justify-center gap-4">
          {links.map((link) => (
            <li key={`${link.eventId}:${link.href}`}>
              <Link
                href={link.href}
                className="inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-5 py-3 text-sm font-medium text-primary hover:bg-primary/20 transition-colors"
                onClick={() =>
                  trackConversion("conversion.booking.click", {
                    eventId: link.eventId,
                    href: link.href,
                    label: link.label,
                  })
                }
              >
                <Calendar className="h-4 w-4" />
                {link.label}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
