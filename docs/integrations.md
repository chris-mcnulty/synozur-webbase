# Integrations runbook

Configuration runbook for the third-party integrations wired into the api-server.

## HubSpot (#131)

Lead-capture sync. Every contact / subscribe / start form submission upserts a
HubSpot Contact and emits a custom timeline event.

### Environment

| Variable | Required | Notes |
| --- | --- | --- |
| `HUBSPOT_ACCESS_TOKEN` | yes (to sync) | Private-app access token. Scopes: `crm.objects.contacts.read`, `crm.objects.contacts.write`, `crm.schemas.contacts.read`, `timeline`. |
| `HUBSPOT_PORTAL_ID` | yes (display) | Numeric portal id. Surfaced on `/admin/integrations/hubspot`. |

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
- `hubspotFormToggles` — per-form-type enable map, e.g.
  `{ "contact": true, "subscribe": true, "start": false }`.
- `hubspotLifecycleMappings` — per-form-type lifecycle override, e.g.
  `{ "contact": "lead", "subscribe": "subscriber", "start": "marketingqualifiedlead" }`.

### Custom HubSpot properties (one-time setup)

These properties must exist on the Contact object in the portal. Create them
under Settings → Properties → Contact properties:

- `synozur_form_type` (single-line text)
- `synozur_marketing_opt_in` (single-line text — values "true"/"false")

### Custom timeline event templates (one-time setup)

Create the following event templates against the HubSpot Public App whose id
goes in `hubspotTimelineAppId`:

- `synozur_form_submitted` — emitted on contact-form submissions
- `synozur_newsletter_subscribed` — emitted on subscribe submissions
- `synozur_get_started_submitted` — emitted on Get Started submissions

Each template should accept the tokens emitted by `enqueueContactSubmission`:
`form_type`, `utm_source`, `utm_medium`, `utm_campaign`, `landing_page`,
`marketing_opt_in`.

### Operations

- Status & queue depth: `GET /api/admin/integrations/hubspot/status`
- Force-drain: `POST /api/admin/integrations/hubspot/drain`
- Replay a dead-letter event: `POST /api/admin/integrations/hubspot/replay/:id`
- GDPR erasure: `POST /api/admin/integrations/hubspot/erasure` body `{ "email": "…" }`

The worker auto-runs every 30s in-process; manual drain is for triage only.

---

## Microsoft Entra SSO (#126)

Employees and admins authenticate with their Synozur Entra identity. Routed
through Clerk's Enterprise SSO connection so the public sign-in surface stays
unchanged; group membership is read off Microsoft Graph and reconciled against
the CMS role table on every sign-in.

### Environment

| Variable | Required | Notes |
| --- | --- | --- |
| `ENTRA_TENANT_ID` | yes (or per-connection metadata) | Synozur tenant id. Required to mint app-only Graph tokens. |
| `ENTRA_APP_CLIENT_ID` | optional | Entra app registration with `GroupMember.Read.All` (application permission). Used as fallback when the delegated SSO token doesn't carry the scope. |
| `ENTRA_APP_CLIENT_SECRET` | optional | Paired with `ENTRA_APP_CLIENT_ID`. |

### Clerk dashboard configuration

1. Create an Enterprise SSO connection of type **Microsoft / Entra ID**.
2. Bind the `synozur.com` email domain to the connection.
3. Set the connection's **Public metadata** to `{ "tenantId": "<tenant id>" }`
   so the api-server can pick it up without an env round-trip.
4. (Optional) Request the `GroupMember.Read.All` delegated scope so the SSO
   token can call Graph directly without app-only credentials.

### Group → role mapping

Admin-managed at `/admin/access/entra`. Each row maps an Entra security-group
**object id** (not display name) to a CMS role. On sign-in, every role mapped
from a group the user belongs to is granted; every role mapped from *any*
configured group that the user no longer belongs to is removed. Roles
manually granted in `/admin/access/users` (i.e. not mapped from any group)
are preserved.

The `entraAdminGroupFallback` site setting, when set, grants `admin` to any
member of that group regardless of the mapping table — useful for bootstrap.

### Operations

- List mappings: `GET /api/admin/entra/group-mappings`
- Create mapping: `POST /api/admin/entra/group-mappings`
- Delete mapping: `DELETE /api/admin/entra/group-mappings/:id`
