---
name: B chrome header contrast & offset
description: How the site-wide B header decides top-of-page text color and reserves space, and the route list that must stay in sync.
---

# B chrome (SiteHeaderB) top-of-page contrast is ROUTE-based, not content-detected

The `SiteHeaderB` is `fixed` + transparent at the top and solid `bg-background` once
scrolled. Whether the *unscrolled* header uses WHITE text or theme-`foreground` text is
decided by route, not by inspecting the page: `isLightTopRoute(location)` (exported from
`site-header-b.tsx`, backed by `LIGHT_TOP_PREFIXES`).

- Most pages render a `PageHero` that is hardcoded dark (`bg-[#0B0B1A]`) in BOTH themes,
  so the header must be WHITE over them (`overDark = topOnDark && !isScrolled`). PageHero
  also supplies its own top padding to clear the fixed header.
- A handful of utility pages (auth, search, item/careers detail — the `LIGHT_TOP_PREFIXES`)
  start on a light `bg-background` with no hero, so the header must use `foreground` tokens
  even unscrolled, AND the `Layout` `<main>` adds `pt-16 lg:pt-[100px]` (single-row mobile /
  two-row desktop header height) so the fixed header doesn't overlap them.
- Flagship pages (`/`,`/sprint`,`/proof`,`/fit`,`/book`) use `forceDark` — always white idle
  header, no offset.

**Why:** utility pages previously used the sticky (in-flow) old `<Header>`; switching them
to the fixed two-row `SiteHeaderB` both broke contrast in light mode and overlapped content.

**How to apply:** when adding ANY new non-hero / light-top route under B chrome, add its
prefix to `LIGHT_TOP_PREFIXES` — that single list drives BOTH the header idle color and the
Layout top-offset. Forgetting it → white-on-light header text + header overlapping the page.
