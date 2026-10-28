type BookingTitleInput = {
  title: string;
  seoTitle: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
};

/** Match the public booking endpoint's visibility window and browser title. */
export function bookingOgTitle(
  booking: BookingTitleInput,
  siteName: string,
  now = new Date(),
): string | null {
  if (booking.startsAt && booking.startsAt > now) return null;
  if (booking.endsAt && booking.endsAt <= now) return null;
  const title = booking.seoTitle || booking.title;
  return title.endsWith(` | ${siteName}`) ? title : `${title} | ${siteName}`;
}
