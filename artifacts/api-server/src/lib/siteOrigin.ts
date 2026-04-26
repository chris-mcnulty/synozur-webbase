/**
 * Resolves the public site origin used for building absolute URLs in
 * sitemaps, feeds, structured data, and outbound links. Reads `SITE_URL`
 * from the environment and falls back to the production hostname.
 *
 * Centralised here so SEO, FAQ, podcast, and any future route module agree
 * on the same origin without duplicating the constant.
 */

const DEFAULT_SITE_URL = "https://www.synozur.com";

export function siteOrigin(): string {
  return (process.env.SITE_URL || DEFAULT_SITE_URL).replace(/\/$/, "");
}
