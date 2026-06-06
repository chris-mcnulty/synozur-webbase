# Pre-launch QA sweep (June 2026)

Static editorial/quality sweep of the public marketing site, run as part of
the pre-launch feature work on branch
`claude/pre-launch-feature-priorities-UH0aB`. This is the source-level pass;
the human-driven checks that require the running site or production CMS data
are listed at the end as a go-live checklist.

## Method

- Scanned `artifacts/synozur/src/pages` and `artifacts/synozur/src/components`
  (public surfaces; admin and test files excluded) for placeholder/leftover
  content, dead links, stray debug output, and TODO markers.
- Confirmed which quality gates are already enforced in CI so the sweep
  doesn't duplicate them.

## Automated findings (source level)

| Check | Result |
| --- | --- |
| `lorem` / `ipsum` / "dummy text" / "placeholder text" | **None** in public copy |
| "Coming soon" / "TBD" | 2 hits — both **intentional empty-state fallbacks** (`home.tsx` "New stories coming soon", `home-b.tsx` "Workshop details coming soon"); not leftovers |
| Dead links (`href="#"`, `to="#"`, empty `href`) | **None** |
| Example/test data (`example.com`, `test@…`) | Only legitimate input `placeholder=` hints (`you@example.com` on sign-in/up, forgot-password) |
| `console.log` / `debugger` in public code | **None** |
| `TODO` / `FIXME` / `HACK` / `XXX` in public code | **None** |
| Image `alt` text | Enforced by `jsx-a11y/alt-text: "error"` (see `eslint.config.js`) across all 66 `<img>` in public code — CI fails on a missing alt |
| `G-XXXXXXXXXX` GA4 string | Lives only in the admin SEO settings form as an input example — not user-facing content |

Conclusion: the public source is clean of placeholder/leftover content,
broken internal links, and debug output. Accessibility alt-text coverage is
gate-enforced rather than spot-checked.

## Known REVIEW-BEFORE-LAUNCH flags introduced on this branch

- `artifacts/synozur/src/pages/trust.tsx` — two source comments flag the
  Trust & Security page's **compliance/attestations** wording (kept
  non-committal until the team names any formal attestations such as SOC 2 /
  ISO 27001 / a published DPA) and the **security-reporting mailbox**
  (currently routes to `privacy@synozur.com` + the contact page; swap in
  `security@synozur.com` once that inbox is live).

## Human-driven go-live checklist (cannot be verified statically)

These require the running site, production CMS data, or external tooling and
should be walked before DNS cutover:

1. **Social/OG link previews** — paste each flagship URL (home, top services,
   top insights, case studies, Trust page) into the LinkedIn Post Inspector
   and confirm the OG image + title + description render as intended. (Per-page
   OG backfill is also tracked as launch-readiness item L7.)
2. **Editorial proofing with production data** — review the live copy on the
   top ~20 pages for typos, stale dates, and correct CTAs once production
   content is loaded.
3. **Empty-state visuals with production data** — confirm list pages
   (insights, workshops, webinars, case studies) and the new social-proof band
   look right with the real published set, not just seed/fallback data.
4. **Cross-device / cross-browser pass** — spot-check the home, a service
   page, the Trust page, and a form on mobile Safari + Chrome and desktop.
5. **Forms end-to-end** — submit the contact, subscribe, and "Get Started"
   flows against production (Turnstile + SendGrid + HubSpot) and confirm
   receipt + routing.
6. **404 / redirect spot-checks** — hit a sample of known legacy Wix URLs and
   confirm they redirect (ties to launch-readiness item L6).

## Related

- Launch-readiness gate (Tier 1–3) in `backlog.md`.
- Deferred post-launch items in `BACKLOG.md` → "Pre-launch review: deferred
  items (June 2026)".
