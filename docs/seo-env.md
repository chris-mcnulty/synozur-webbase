# SEO Audit & Search-Engine Submission — Environment Variables

This document describes the environment variables needed for the SEO audit, autofill, and URL submission features exposed at `/admin/marketing/seo-audit`.

The audit and autofill endpoints (`GET /api/seo/audit`, `POST /api/seo/audit/autofill`) require **no external credentials** — they read and write the existing artifact tables directly. Only the URL-submission channels (`POST /api/seo/submit`) need credentials.

Each submission channel is **independently opt-in**. Channels without credentials return `ok: false` with a descriptive `error` message and never throw, so partial configuration is safe — the admin UI renders a per-channel "credentials missing" state and continues to submit to whatever is configured.

---

## Environment variables

### Submission channels

| Var | Channel | Required? | Description |
| --- | --- | --- | --- |
| `INDEXNOW_KEY` | IndexNow (Bing, Yandex, Seznam, Naver, Yep) | Optional | Secret used both as the API key body parameter and as the name of the key-validation file served at `/{key}.txt`. If the value is already 8–128 hex chars it's passed through; any other value is SHA-256 hashed to produce a conforming key. |
| `GOOGLE_INDEXING_SA_JSON` | Google Indexing API | Optional | Full JSON for a Google service account with the Indexing API enabled. The service account must be added as an owner of the verified property in Google Search Console. |
| `BING_API_KEY` | Bing Webmaster Tools | Optional (with `BING_SITE_URL`) | API key from Bing Webmaster Tools → Settings → API access. |
| `BING_SITE_URL` | Bing Webmaster Tools | Optional (with `BING_API_KEY`) | The exact site URL as verified in Bing Webmaster Tools (e.g. `https://www.synozur.com`). Both `BING_API_KEY` and `BING_SITE_URL` must be set together. |
| `SITE_URL` | All | Falls back to `https://www.synozur.com` | Used to derive the host for IndexNow and to build the `/{key}.txt` location. |

Implementation lives in `artifacts/api-server/src/lib/seoSubmit.ts`. The api-server logs each channel's status at boot under the `launch-readiness: L3 SEO submission` prefix so misconfiguration is visible in the startup log.

### Site verification meta tags (Tier 1 launch-readiness L2)

| Var | Channel | Required? | Description |
| --- | --- | --- | --- |
| `GOOGLE_SITE_VERIFICATION` | Google Search Console | Required for organic discoverability | The verification token from the "HTML tag" verification method in Search Console. Spliced into the bare `index.html` response by `artifacts/synozur/server.mjs` as `<meta name="google-site-verification" content="…" />`. The value is read at boot, so rotation requires a redeploy. |
| `BING_SITE_VERIFICATION` | Bing Webmaster Tools | Required for Bing indexing | Same idea, emitted as `<meta name="msvalidate.01" content="…" />`. |

Both tokens have a redundant React-side fallback in `artifacts/synozur/src/components/layout/index.tsx` driven by the `seoGoogleSiteVerification` / `seoBingSiteVerification` columns in `site_settings`, but Search Console's verification crawler does not execute JavaScript — the env-driven SSR path is what actually completes verification.

### CSP rollout (Tier 1 launch-readiness L4)

| Var | Required? | Description |
| --- | --- | --- |
| `CSP_ENFORCE` | Optional | Set to `1` to flip the Content-Security-Policy from `Content-Security-Policy-Report-Only` to enforcing. Default (unset) keeps the policy in report-only mode so violations land in the `csp_violations` table without breaking anything. Per BACKLOG.md "SEO & web-platform debt" #1, run for ≥ 7 days against production traffic with an empty violation stream for two consecutive days before flipping. |
| `CSP_REPORT_URI` | Optional | Override the report destination on the SPA server. Defaults to `/api/csp/report`. The api-server route is at `routes/csp.ts` and writes one row per `(document_path, violated_directive, blocked_uri)` dedup key into `csp_violations`. |

The CSP allowlist lives in two places that must be kept in sync:

- `artifacts/api-server/src/lib/securityHeaders.ts` — applied to API responses.
- `artifacts/synozur/server.mjs` — applied to public HTML responses.

When adding a new third-party tag or embed, update both files (they currently allow GA4, LinkedIn Insight, Meta Pixel, YouTube, Microsoft Bookings, and Google Fonts).

---

## Step 1 — IndexNow (optional)

IndexNow is the easiest channel and covers Bing, Yandex, Seznam, Naver, and Yep in a single request.

1. Choose any random secret string (8–128 chars of hex work best — e.g. `openssl rand -hex 32`).
2. In the deployed app's secrets, set:

   | Var | Value |
   | --- | --- |
   | `INDEXNOW_KEY` | the hex string from step 1 |

3. Deploy. The app auto-serves `/{key}.txt` containing the key, which is how IndexNow validates ownership.
4. Verify by visiting `https://<your-domain>/{key}.txt` — it should return the key as plain text.

No dashboard signup is required.

---

## Step 2 — Google Indexing API (optional)

Google's public sitemap-ping endpoint was retired in 2023. The Indexing API is the only authoritative push channel. Officially it's scoped to `JobPosting` and `BroadcastEvent` schemas, but in practice it accepts all URLs and surfaces them in Search Console's "URL Inspection" freshness.

1. In Google Cloud Console, create a project (or reuse one) and enable the **Indexing API**.
2. Create a **service account**, then create a JSON key for it.
3. In Google Search Console, open the verified property for `synozur.com` → **Settings → Users and permissions → Add user** → paste the service account's email → **Owner**.
4. In the deployed app's secrets, set:

   | Var | Value |
   | --- | --- |
   | `GOOGLE_INDEXING_SA_JSON` | the entire JSON key file, pasted as one value |

The app parses this JSON at submission time; if it's malformed the channel reports `error: "GOOGLE_INDEXING_SA_JSON is not valid JSON"`.

---

## Step 3 — Bing Webmaster Tools (optional)

Independent of IndexNow — useful if you want `submitted` counts visible in the Bing dashboard.

1. In [Bing Webmaster Tools](https://www.bing.com/webmasters/), verify the site.
2. **Settings → API access** → copy the API key.
3. In the deployed app's secrets, set:

   | Var | Value |
   | --- | --- |
   | `BING_API_KEY` | the API key from step 2 |
   | `BING_SITE_URL` | the exact verified site URL, e.g. `https://www.synozur.com` |

Both must be present; the channel reports `error: "BING_API_KEY or BING_SITE_URL not set"` if either is missing.

---

## Channel skipping behavior

The admin page at `/admin/marketing/seo-audit` shows one result row per channel after submission. Missing-credentials errors are rendered as a neutral "credentials missing" line (pointing readers at this doc); other errors are rendered in red. Successful channels show the submitted count and HTTP status. See `SubmitResultRow` in `artifacts/synozur/src/pages/admin/marketing/seo-audit.tsx`.
