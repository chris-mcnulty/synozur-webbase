---
name: OG / social share image sizing
description: How social-share (Open Graph) images are kept small and crawler-safe on the Synozur site
---

# OG image sizing

Social crawlers (LinkedIn especially) reject or silently drop large images and
do not reliably render WebP. The site's stored hero/media images are often
multi-MB JPEGs that crawlers won't preview.

**Rule:** OG `og:image` URLs that point at our own resizable storage routes must
be served as a resized JPEG, not the original and not WebP.

**How to apply:**
- The api-server storage route (`GET /api/storage/(public-)objects/*`) resizes
  on the fly when given `?w=<width>`. It defaults to WebP; pass `?fmt=jpeg` to
  get a JPEG (flatten on white + mozjpeg). WebP remains the default for normal
  in-page `<img>` usage — do not change that default.
- `ogResolver.ts` has `ogImageVariant(url, origin)` which appends
  `?w=1200&fmt=jpeg` **only** to same-origin storage URLs (it checks
  `url.startsWith(origin)` AND the storage path regex). External URLs, the
  dynamic `/api/og/image` branded card, and static assets pass through
  untouched. Every image source in `resolveMeta` is wrapped with it.
- Do NOT wrap `dynamicOgImageUrl(...)` — that card is already correctly sized.

**Why:** a real techcon365-chicago post had a 5.8 MB hero JPEG as its og:image;
the 1200px JPEG variant is ~197 KB, well under LinkedIn's ~5 MB limit.

**Unrelated open issue (deferred by owner):** og:image absolute origin comes
from `siteOrigin()` (`SITE_URL` env, else www.synozur.com). On dev the image
exists; on prod the post/image can 404 until the prod DB is synced. Owner chose
to publish live first rather than fix the dev-vs-prod origin — do not change
`siteOrigin()` without asking.

**Re-confirmed July 2026:** offered to point share links at the baseline domain
for the pre-launch phase; owner explicitly chose to leave siteOrigin at
www.synozur.com. Consequence: all og:image URLs 404 on the old Wix site, so
real LinkedIn/Slack/Teams/X unfurls show NO bespoke image for any page
(including the Sprint cards /sprint /proof /fit /book) until the www cutover.
Do not re-raise; re-validate unfurls (and flush platform caches via LinkedIn
Post Inspector) after cutover + republish.
