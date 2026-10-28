# Public description readability regression checks

With the Synozur frontend workflow running:

```sh
pnpm --filter @workspace/synozur test:page-readability
```

The focused config defaults to `http://localhost:80`; set `E2E_BASE_URL` to
use another development server. Install Chromium with
`pnpm --filter @workspace/synozur exec playwright install chromium` if needed.
No database, authentication, Microsoft credentials, or booking setup is needed.

The suite intercepts every `/api/` request and replaces the calendar iframe
with an inert document. Unexpected writes and Graph/appointment requests fail
the test without reaching a backend. It exercises the actual public landing
and booking renderers, not the admin booking share-image flow.

Coverage:
- Desktop and 375px mobile, starting in both light and dark mode.
- Real theme-toggle clicks in both directions without losing rich HTML.
- Computed foreground/background WCAG contrast of at least 4.5:1 for
  paragraphs, headings, emphasis, links, lists, and blockquotes.
- Transparent ancestor backgrounds and modern CSS color conversion to sRGB.
- Long heading wrapping, viewport containment, and header/utility geometry.
- Headingless light CTA body/link preservation.
- A deliberately white-on-white paragraph proves the measurement detects
  the original failure (ratio 1:1).

The contrast helper deliberately rejects gradient backgrounds and opacity
layers instead of claiming accurate measurements of those surfaces. It is
scoped to the solid description/CTA surfaces, not a full-site accessibility
audit or Microsoft’s cross-origin calendar UI.
