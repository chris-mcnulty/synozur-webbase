# Integrations runbook

Configuration runbook for the third-party integrations wired into the api-server.

## HubSpot (#131)

Lead-capture sync. Every contact / subscribe / start form submission upserts a
HubSpot Contact and emits a custom timeline event.

### Access-token sources (in priority order)

1. **Replit Connections** — when `REPLIT_CONNECTORS_HOSTNAME` is set in the
   environment (Replit injects this automatically when a HubSpot connector is
   added in the Connections UI), the api-server fetches a fresh OAuth token
   from `https://${REPLIT_CONNECTORS_HOSTNAME}/api/v2/connection?include_secrets=true&connector_names=hubspot`
   on demand. Tokens are cached until shortly before expiry. Auth header is
   sourced from `WEB_REPL_RENEWAL` or `REPL_IDENTITY` (whichever Replit
   provides for the deployment). This is the recommended production path —
   token rotation, scopes, and per-environment scoping are all managed in the
   Replit UI.
2. **Static env var** — `HUBSPOT_ACCESS_TOKEN` (private-app token) is used as
   a fallback for self-hosted/local dev or any deployment without Replit
   Connections.

The `/admin/integrations/hubspot` page surfaces the active source so an
operator can tell at a glance which path is in use.

### Other env

| Variable | Required | Notes |
| --- | --- | --- |
| `HUBSPOT_PORTAL_ID` | display only | Numeric portal id. Surfaced on the admin page. |

### Runtime configuration

All policy knobs live in `site_settings` and are editable at
`/admin/integrations/hubspot`:

- `hubspotEnabled` — master switch. When off, submissions still persist; the
  queue does not enqueue new rows.
- `hubspotTimelineAppId` — numeric HubSpot Public App id. Required for
  timeline events. Without it, contact upserts still run; timeline events are
  marked `skipped`.
- `hubspotEuOptInDefault` — when no explicit `marketingOptIn` is supplied with
  the form payload, default to `false` (opt-out). Otherwise default to `true`.
- `hubspotFormToggles` — per-form-type enable map.
- `hubspotLifecycleMappings` — per-form-type lifecycle override.

### Custom HubSpot properties (one-time setup)

These properties must exist on the Contact object in the portal. Create them
under Settings → Properties → Contact properties:

- `synozur_form_type` (single-line text)
- `synozur_marketing_opt_in` (single-line text — values "true"/"false")

### Custom timeline event templates (one-time setup)

Create the following event templates against the HubSpot Public App whose id
goes in `hubspotTimelineAppId`:

- `synozur_form_submitted`
- `synozur_newsletter_subscribed`
- `synozur_get_started_submitted`

### Operations

- Status & queue depth: `GET /api/admin/integrations/hubspot/status`
- Force-drain: `POST /api/admin/integrations/hubspot/drain`
- Replay a dead-letter event: `POST /api/admin/integrations/hubspot/replay/:id`
- GDPR erasure: `POST /api/admin/integrations/hubspot/erasure` body `{ "email": "…" }`

The worker auto-runs every 30s in-process; manual drain is for triage only.

---

## Microsoft Entra SSO (#126) — native OIDC

Employees and admins authenticate with their Synozur Entra identity through a
native OIDC flow (no third-party identity provider). The flow:

1. **`/api/auth/sign-in`** — issues a `state`, PKCE challenge, and `nonce`,
   persists them in `auth_pending_states`, and 302s the browser to Entra's
   authorize endpoint.
2. **`/api/auth/callback`** — exchanges the auth code for tokens, validates
   the ID token against the tenant JWKS (via `jose`), upserts the user row,
   reconciles role grants from group membership, mints a session row, and
   sets the `sid` HttpOnly cookie.
3. **`/api/auth/sign-out`** — destroys the local session and returns a
   redirect URL to Entra's RP-initiated logout endpoint.
4. **`/api/auth/me`** — returns the current user.
5. **`/api/auth/session`** — `{ signedIn, user }` probe, never 401s.

### Entra app registration (one-time setup)

1. **Microsoft Entra admin center → App registrations → New registration.**
2. Set redirect URI type to **Web** with the value of `AUTH_REDIRECT_URI`
   (e.g. `https://synozur.com/api/auth/callback`).
3. Under **API permissions**, add delegated permissions: `openid`, `profile`,
   `email`, `offline_access`, `User.Read`. Grant admin consent.
4. (Group reconciliation) Under **API permissions**, also add the application
   permission `GroupMember.Read.All` and grant admin consent — this lets the
   server resolve transitive group membership via app-only Graph tokens.
5. Under **Certificates & secrets**, create a client secret if you registered
   as a confidential web app. Public-client (PKCE-only) registrations don't
   need a secret.

### Environment

| Variable | Required | Notes |
| --- | --- | --- |
| `ENTRA_TENANT_ID` | yes | Tenant GUID, or `common` / `organizations` for multi-tenant. |
| `ENTRA_APP_CLIENT_ID` | yes | App registration client id. |
| `AUTH_REDIRECT_URI` | yes | Absolute callback URL — must match the app reg. |
| `ENTRA_APP_CLIENT_SECRET` | conditional | Required when registered as a confidential web app, or to mint app-only Graph tokens. |
| `AUTH_POST_LOGOUT_URI` | optional | Where Entra sends the browser after RP-initiated logout. |
| `ADMIN_EMAILS` | optional | Comma-separated allow-list. Listed emails always resolve to admin (bootstrap). |

### Group → role mapping

Admin-managed at `/admin/access/entra`. Each row maps an Entra security-group
**object id** (not display name) to a CMS role. On sign-in, every role mapped
from a group the user belongs to is granted; every role mapped from *any*
configured group that the user no longer belongs to is removed. Roles
manually granted in `/admin/access/users` (i.e. not mapped from any group)
are preserved.

The `entraAdminGroupFallback` site setting, when set, grants `admin` to any
member of that group regardless of the mapping table — useful for bootstrap.

### Sessions

- Backed by the `sessions` table; cookie carries only the (high-entropy)
  session id, hashed at rest.
- 8-hour rolling inactivity window; 30-day absolute cap.
- Hourly GC purges expired rows and abandoned auth-pending state.
- `pruneExpiredSessions()` and `destroyAllSessionsForUser(userId)` are
  available for ops scripts.

## Microsoft Bookings (native mode)

`/start/{slug}` pages have two render paths controlled by the site-level
`bookingsRenderMode` setting at `/admin/site-config/site-settings`:

- **`iframe`** (default): embeds Microsoft's hosted Bookings page. Zero
  configuration; cross-origin so the iframe contents cannot be themed.
- **`native`**: the api-server calls Microsoft Graph and the public site
  renders an on-brand React flow (service picker → date strip → multi-column
  slot grid → contact form → confirmation). Requires the env vars below
  **and** a populated `msBusinessId` on the booking row (admin form:
  `/admin/people/bookings/{id}`). Bookings without `msBusinessId` fall back
  to the iframe even when the global mode is `native`.

### Env

The native flow reuses the **existing Synozur Entra app registration** by
default — set nothing new and it picks up `ENTRA_TENANT_ID`,
`ENTRA_APP_CLIENT_ID`, and `ENTRA_CLIENT_SECRET` automatically. The
`MS_BOOKINGS_*` vars are escape hatches for the case where Bookings lives
in a different tenant or you want to scope a separate app registration to
just the Bookings permission.

| Variable | Default source | Notes |
| --- | --- | --- |
| `MS_BOOKINGS_TENANT_ID` | `ENTRA_TENANT_ID` | Tenant that owns the Bookings business. |
| `MS_BOOKINGS_CLIENT_ID` | `ENTRA_APP_CLIENT_ID` | App registration client id. |
| `MS_BOOKINGS_CLIENT_SECRET` | `ENTRA_CLIENT_SECRET` / `ENTRA_APP_CLIENT_SECRET` | App registration secret. |
| `TURNSTILE_SECRET_KEY` | — | Anti-spam on the appointment-create endpoint (recommended). |

### Graph application permission

The existing Synozur Entra app already holds `GroupMember.Read.All` for
the OIDC group-reconciliation flow. Native bookings adds one more:

1. Azure portal → **App registrations** → the Synozur app → **API
   permissions** → *Add a permission* → Microsoft Graph → **Application
   permissions** → `Bookings.ReadWrite.All` (or the narrower pair
   `Bookings.Read.All` + `BookingsAppointment.ReadWrite.All`).
2. Click **Grant admin consent for &lt;tenant&gt;** at the top of the
   permissions list. Without this, tokens issue successfully but every
   Graph call comes back 403 and the public page shows
   "Bookings provider rejected our credentials."
3. The Bookings calendar's owning mailbox must live in the **same
   tenant** as the app registration. Cross-tenant access via client
   credentials is not supported.

### Per-booking config

Each row in `bookings` carries two optional Graph fields, set on the
admin form at `/admin/people/bookings/{id}`:

- `msBusinessId` (**required for native**) — Microsoft Graph's identifier
  for one Bookings calendar. Format is usually
  `<emailAlias>@<tenant>.onmicrosoft.com` (or the tenant's primary
  domain), e.g. `NorthStarWorkshop@synozur.onmicrosoft.com`. Sometimes
  shown as a GUID.

  **Three ways to find it:**
  1. **Bookings admin UI** — at `https://outlook.office.com/bookings`,
     open the calendar, then go to *Business information* → the email
     address shown there is the `id`.
  2. **Graph Explorer** —
     [aka.ms/ge](https://developer.microsoft.com/graph/graph-explorer),
     sign in as a tenant admin, and run
     `GET https://graph.microsoft.com/v1.0/solutions/bookingBusinesses`.
     Each entry's `id` field is the value you want; `displayName` is the
     friendly name.
  3. **Existing embedUrl** — for share URLs of the form
     `https://outlook.office365.com/owa/calendar/{id}/bookings/`, the
     path segment between `/calendar/` and `/bookings/` is the id (URL-
     decode it first if it contains `%40` — that's the `@`). The newer
     `book.ms/b/{slug}` format does **not** expose the Graph id, so use
     option 1 or 2 in that case.

- `msDefaultServiceId` (optional) — pre-selects a service when the
  business exposes more than one. When null, the visitor picks (or the
  only service is auto-selected).

  **To find it:** with `msBusinessId` set, run
  `GET https://graph.microsoft.com/v1.0/solutions/bookingBusinesses/{msBusinessId}/services`
  in Graph Explorer. Each `value[]` entry has an `id` and a
  `displayName`. Or just leave it blank — the visitor will see a service
  picker.

### Endpoints used

The wrapper at `artifacts/api-server/src/lib/graphBookings.ts` calls:

- `GET  /solutions/bookingBusinesses/{id}` — business display name + tz
- `GET  /solutions/bookingBusinesses/{id}/services` — bookable services
- `GET  /solutions/bookingBusinesses/{id}/services/{id}` — staff list + duration
- `POST /solutions/bookingBusinesses/{id}/getStaffAvailability` — open windows
- `POST /solutions/bookingBusinesses/{id}/appointments` — create appointment

Confirmation emails, calendar invites, reminders, and reschedule/cancel links
are still generated by Bookings — the native flow only handles the booking
itself.

### Rate limits

The public Graph endpoints under `/api/bookings/{slug}/...` are rate-limited
per IP:

- `availability`: 30 / minute
- `appointments`: 10 / hour

## Briefing Podcast

Generates an audio ("podcast") version of a morning briefing email and
delivers it back to the recipient. Two entry points share one pipeline:

1. **Owner's own briefing** — the Copilot Worker that produces the daily
   briefing also sends (or BCCs) a copy to the watched mailbox. The sender
   is recognized as `BRIEFING_OWNER_EMAIL` and processed unconditionally.
2. **Approved clients** — external senders on the allow-list email the
   watched mailbox and receive an audio version back. Manage the allow-list
   in **Admin → Audience → Briefing Podcast** (`client_orgs.manage`).

### Pipeline

`M365 mailbox → Graph change notification → /api/briefing-podcast/webhook`
→ fetch message body → **delete the inbound message** → strip HTML to a
narration script (Claude, with a plain-text fallback) → OpenAI TTS (MP3) →
upload to SharePoint Embedded → email the recipient a streaming link
(`/api/briefing-podcast/:id/audio`) plus a signed one-click **purge** link
(`/api/briefing-podcast/purge?token=…`).

The MP3 lives in the existing SPE container under `/briefing/…` and can be
purged by the recipient (email link) or an admin (history view). Purging
deletes the SPE item and flips the `briefing_podcasts` row to `purged`.

### Environment

| Variable | Purpose |
| --- | --- |
| `BRIEFING_MAILBOX` | UPN of the watched shared mailbox (e.g. `briefing@synozur.com`) |
| `BRIEFING_WEBHOOK_URL` | Public HTTPS URL of the webhook (`https://…/api/briefing-podcast/webhook`) |
| `BRIEFING_WEBHOOK_SECRET` | Shared `clientState` echoed in Graph notifications |
| `BRIEFING_OWNER_EMAIL` | Address whose briefings are always processed (owner) |
| `OPENAI_API_KEY` | Required for TTS |
| `OPENAI_TTS_MODEL` | Optional, default `tts-1-hd` |
| `OPENAI_TTS_VOICE` | Optional, default `onyx` |

Reuses the existing Entra app registration (`ENTRA_TENANT_ID` /
`ENTRA_APP_CLIENT_ID` / `ENTRA_APP_CLIENT_SECRET`) for Graph access. The
narration rewrite reuses the Anthropic integration env.

### Graph application permission

The app registration needs **`Mail.ReadWrite`** (application) with admin
consent so it can read and delete messages in the watched mailbox. The
subscription is created/renewed automatically on startup by
`startBriefingSubscriptionWorker` (mail subscriptions expire in <3 days; it
renews every 12h and re-creates if the subscription has lapsed).
