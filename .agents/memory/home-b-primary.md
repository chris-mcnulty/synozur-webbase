---
name: Home B is the primary site
description: The B experience is the permanent homepage at /; the old A/B root toggle is retired.
---

# Home B is primary at `/`

Home B (the "decision-path" experience with B chrome — `SiteHeaderB`/`SiteFooterB`, dark) is the permanent public homepage, served at `/` and hardwired in `App.tsx` routing (a `BRoute component={HomeB}` in the B block, before the default-chrome catch-all). `/home-b` is kept as an alias.

**Why:** The user promoted the B experience to be THE site ("there is only one home page") and retired the old home. Root selection is no longer driven by `site_settings.home_root_variant` or the `home.layout` experiment override — those mechanisms (`RootHomeRoute`, `useOverride`) were removed.

**How to apply:**
- Old home (variant A) is parked at `/home-a`, reachable but unlinked from nav. Do not resurface it at `/` or add an A/B "Home / Alt Home" nav choice.
- The home page canonical/OG `path` must be `/` (set in `home-b.tsx` `<Meta>`), not `/home-b`.
- `home_root_variant` is set to `b` for consistency but routing ignores it; don't reintroduce a setting-driven root without also restoring B chrome handling.
- The admin "Alt Home" page still edits Home B copy/media; its A/B root selector was replaced with an informational note.

## Experiment instrumentation

`home-b.tsx` is now experiment-ready via `useOverride`/`useTrackConversion` (ported from the legacy A hero), reusing the `home.*` key namespace (pageKey `home` = `["/"]`). Instrumented: hero headline `home.hero.headline.{text,accentWord}`, `home.hero.subheadline.text`, primary CTA `home.hero.cta.{visible,label,href}` (→/book, tracks `conversion.booking.click`), secondary CTA `home.hero.cta2.{visible,label,href}` (→/proof, tracks `conversion.cta.get_started`), ladder `home.hero.ladder.{visible,caption}`, and Trusted-by `home.partners.{visible,heading}`.

**Why:** B was fully static; A's `home.*` hooks couldn't be reused verbatim because B's hero differs (single headline vs A's positioning+tagline+narrative; two CTAs vs one).

**How to apply:**
- Every new key is declared in `lib/api-zod/src/experiments.ts` `OverrideMap` AND in the admin registry in `experiment-detail.tsx` — keep both in sync when adding home override keys, or the admin editor won't surface them.
- **Do NOT reuse `home.hero.ladder.text` for B's ladder caption** — A parses that key as the full "AI-ready → AI-enabled → AI-first" string (split on `→`). B's trailing clause uses the separate `home.hero.ladder.caption`; the three rungs are fixed copy.
