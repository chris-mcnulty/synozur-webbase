import { z } from "zod";

// These URLs become public iframe sources and links. Keep the host allowlist
// explicit, and allow only the existing HTTP(S) schemes.
const ALLOWED_BOOKING_HOSTS = new Set([
  "outlook.office.com",
  "outlook.office365.com",
  "outlook.live.com",
  "book.ms",
  "bookings.cloud.microsoft",
]);

export const bookingEmbedUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
      return ALLOWED_BOOKING_HOSTS.has(parsed.hostname.toLowerCase());
    } catch {
      return false;
    }
  }, "embedUrl must be an http(s) URL on a Microsoft Bookings host (outlook.office.com, outlook.office365.com, outlook.live.com, book.ms, or bookings.cloud.microsoft)");
