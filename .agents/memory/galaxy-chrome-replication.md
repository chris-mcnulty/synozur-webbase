---
name: Galaxy chrome replication & cross-artifact nav
description: Why Galaxy's portal header duplicates synozur's B chrome instead of importing it, and how cross-app links must escape the wouter base.
---

# Galaxy header mirrors synozur B chrome — by duplication, not import

Galaxy's `PortalSiteHeader` visually matches synozur's `SiteHeaderB`, but it does
**not** import it. Artifacts cannot import from each other in this monorepo, so
shared chrome is replicated per-artifact using each app's own local
`ThemeToggle` / `SynozurAppSwitcher` / `useAuth` / command palette. Only truly
shared, app-agnostic data lives in `@workspace/synozur-nav` (e.g. `LOGO_COLOR_URL`).

**Why:** keeping the B look consistent across the main site and the portal while
respecting the artifact-isolation rule. If you change the B header's structure,
update BOTH files — there is no single source.

**How to apply:** when the B chrome changes on synozur, mirror it in
`artifacts/galaxy/src/components/portal-site-header.tsx`.

## Cross-artifact nav links must use plain `<a>` root-absolute

Galaxy is mounted at `/galaxy/` and its router uses that as the wouter base.
Marketing links that should leave the portal for the main synozur app
(Home/Sprint/Proof/Fit/Book, About/Method/Insights/Events) use plain
`<a href="/sprint">` etc. — a wouter `<Link>` would resolve against the
`/galaxy` base and stay inside the portal. Only in-portal nav
(Home/Assess/Define/Deliver/Outcomes/Resources) uses `<Link>`.

## Portal header has no dark hero → render solid, not transparent

Unlike synozur pages (dark `PageHero` at top), portal pages start on a light
`bg-background` surface. The Galaxy header is therefore always-solid
(`bg-background/90`) in the theme-foreground state — do NOT port synozur's
transparent-over-dark / scroll-aware idle treatment, or you get white-on-light.
