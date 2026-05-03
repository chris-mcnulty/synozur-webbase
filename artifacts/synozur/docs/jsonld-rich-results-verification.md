# Rich Results verification report (launch-readiness L19)

Tracks the verification of the JSON-LD schemas added in the "Expanded JSON-LD
schema coverage" task (LocalBusiness, Person, VideoObject,
Review/AggregateRating, Article/NewsArticle).

This file is **hand-maintained**. The auto-generated payload validation
output lives next to it in `jsonld-payload-validation.md` and is regenerated
by the script described below; regenerating that file never touches this
checklist.

## Two-layer verification

1. **Automated payload extraction (live preview).**
   `artifacts/synozur/scripts/extract-prod-jsonld.mjs` boots a chromium
   headless browser, navigates to one URL per new schema on the running
   site, waits for the SPA to settle, extracts each
   `<script type="application/ld+json">` payload from the rendered DOM, and
   validates it against the required + recommended properties Google
   publishes for the corresponding rich-result type.

   Run against the dev preview (default discovers real slugs from the API):

   ```sh
   node artifacts/synozur/scripts/extract-prod-jsonld.mjs \
     --base "https://$REPLIT_DEV_DOMAIN" \
     --out artifacts/synozur/docs/jsonld-payload-validation.md
   ```

   Or against the published origin once the new app is live at
   `https://www.synozur.com`:

   ```sh
   node artifacts/synozur/scripts/extract-prod-jsonld.mjs \
     --base https://www.synozur.com \
     --out artifacts/synozur/docs/jsonld-payload-validation.md
   ```

   Last run (preview, post-fix): **5 PASS, 1 WARN, 0 FAIL, 1 SKIP** out of 7
   cases — see `jsonld-payload-validation.md` for per-URL detail.

2. **Live tool runs (manual gate).**
   Google's [Rich Results Test](https://search.google.com/test/rich-results)
   has no public API, so the production check is manual. **Person isn't a
   Google rich-result type today**, so for `/team/<slug>` use the
   [Schema Markup Validator](https://validator.schema.org/) instead — RRT
   would correctly say "no rich result detected" even on a perfectly valid
   payload.

## URLs to verify post-deploy

| # | URL | Schema | Manual tool |
|---|-----|--------|-------------|
| 1 | `https://www.synozur.com/contact` | LocalBusiness | Google Rich Results Test |
| 2 | `https://www.synozur.com/team/<slug>` | Person | Schema Markup Validator |
| 3 | `https://www.synozur.com/videos/<slug>` | VideoObject | Google Rich Results Test |
| 4 | `https://www.synozur.com/polaris/<slug>` | VideoObject | Google Rich Results Test |
| 5 | `https://www.synozur.com/clients` | AggregateRating + Review | Google Rich Results Test |
| 6 | `https://www.synozur.com/insights/<news-tagged-slug>` | NewsArticle | Google Rich Results Test |
| 7 | `https://www.synozur.com/insights/<non-news-slug>` | Article | Google Rich Results Test |

For each URL:

1. Open the appropriate manual tool above and submit the URL.
2. Confirm the expected schema is detected with zero errors.
3. Record the result in the "Live runs" table below; file a bug for any
   non-zero error count and fix before flipping L19.
4. After all seven URLs return zero errors, mark L19 verified in
   `backlog.md`.

## Live runs

The new app is not yet serving `https://www.synozur.com` (the apex still
points at Wix as of this writing — its sitemap is the Wix-generated one).
Run the table below once the cutover happens.

| Date | URL | Tool | Detected type | Errors | Warnings | Notes |
|------|-----|------|---------------|--------|----------|-------|
| TBD  | /contact | RRT | — | — | — | — |
| TBD  | /team/&lt;slug&gt; | Schema Markup Validator | — | — | — | — |
| TBD  | /videos/&lt;slug&gt; | RRT | — | — | — | — |
| TBD  | /polaris/&lt;slug&gt; | RRT | — | — | — | — |
| TBD  | /clients | RRT | — | — | — | — |
| TBD  | /insights/&lt;news&gt; | RRT | — | — | — | — |
| TBD  | /insights/&lt;non-news&gt; | RRT | — | — | — | — |

## Bugs found and fixed during this verification pass

The automated extraction caught two real defects against the live preview
that would have been flagged by the manual tools — both have been fixed:

- **Person/Video/LocalBusiness `image` URL malformed when the source path
  starts with `/`.** The `absolutize` helpers stripped leading slashes after
  appending `SITE_ORIGIN`, producing e.g.
  `https://www.synozur.comimages/team/...`. Replaced with a simpler
  ensure-single-leading-slash join in `person-jsonld.tsx`,
  `video-jsonld.tsx`, and `local-business-jsonld.tsx`.
- **Two Organization JSON-LD blocks coexist on `/clients`** (the global
  Organization JSON-LD from the layout, plus the page-level Review wrapper
  that also uses `@type: Organization`). The extractor now disambiguates by
  picking the blob with `aggregateRating` for review-snippet checks; the
  payload itself was already correct, this was a verification-tooling bug.

## Outstanding items

- No insight is tagged `news` in the current dataset, so the NewsArticle
  branch has no live URL to spot-check yet. Either tag an existing press
  release with `news` (the `isNewsPost` helper recognises a `news` tag or
  category) or skip row 6 of the live table until such content exists.
- `/polaris/<slug>` legitimately omits `embedUrl` because Polaris is an
  audio podcast with no embeddable player. This shows up as a WARN in the
  automated report and is expected; it should not block L19.
