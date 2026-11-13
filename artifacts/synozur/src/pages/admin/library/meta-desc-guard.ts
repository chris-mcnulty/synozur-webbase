/**
 * Shared meta-description guard utilities used by library item editors.
 *
 * Extracted so the pure guard logic can be tested independently from React
 * component rendering.  If either function is changed, the corresponding
 * test suite will fail immediately.
 */

/**
 * Returns true when a Polaris episode has no usable meta description.
 * Both `summary` (shown on list pages) and `seoDescription` (explicit meta
 * tag) are checked; if either is non-blank the episode is considered covered.
 */
export function polarisEpisodeNoMetaDesc(seoDescription: string, summary: string): boolean {
  return !seoDescription.trim() && !summary.trim();
}

/**
 * Returns true when a video/webinar item has no usable meta description.
 * Both `shortDescription` (shown on cards) and `seoDescription` (explicit
 * meta tag) are checked; if either is non-blank the video is considered
 * covered.
 */
export function videoNoMetaDesc(seoDescription: string, shortDescription: string): boolean {
  return !seoDescription.trim() && !shortDescription.trim();
}

/**
 * Returns true when a workshop has no usable meta description.
 * Both `shortDescription` (shown on list pages / cards) and `seoDescription`
 * (the explicit SEO meta tag, sourced from `form.seo.description`) are
 * checked; if either is non-blank the workshop is considered covered.
 */
export function workshopNoMetaDesc(shortDescription: string, seoDescription: string): boolean {
  return !shortDescription.trim() && !seoDescription.trim();
}

/**
 * Returns true when a collateral item has no usable meta description.
 * Both `description` (the main body/card description) and `seoDescription`
 * (the explicit SEO meta tag) are checked; if either is non-blank the item
 * is considered covered.
 */
export function collateralNoMetaDesc(description: string, seoDescription: string): boolean {
  return !description.trim() && !seoDescription.trim();
}

/**
 * Returns true when an insight item has no usable meta description.
 * Insights are edited via the generic collateral editor; this named function
 * exists so the guard can be tested explicitly for the insight type.
 * Both `description` (the card/body description) and `seoDescription`
 * (the explicit SEO meta tag) are checked; if either is non-blank the item
 * is considered covered.
 */
export function insightNoMetaDesc(description: string, seoDescription: string): boolean {
  return !description.trim() && !seoDescription.trim();
}

/**
 * Returns true when an event item has no usable meta description.
 * Events are edited via the generic collateral editor; this named function
 * exists so the guard can be tested explicitly for the event type.
 * Both `description` (the card/body description) and `seoDescription`
 * (the explicit SEO meta tag) are checked; if either is non-blank the item
 * is considered covered.
 */
export function eventNoMetaDesc(description: string, seoDescription: string): boolean {
  return !description.trim() && !seoDescription.trim();
}
