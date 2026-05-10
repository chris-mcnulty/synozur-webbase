# Research Brief: Entra-Native Multi-Tenant Authentication Architecture for Galaxy

## Background

The Galaxy customer portal currently uses a Backend-for-Frontend (BFF) pattern. The api-server holds static API keys for Orion and Nebula, and uses an OAuth client credentials grant with a `target_client_id` parameter for Constellation/SCDP. When a user from a client organisation logs in, the api-server injects a `domain=` query parameter or a per-client ID to scope downstream API calls to the correct tenant's data.

This works today with 25 clients but requires manual key provisioning each time a new client needs access to a downstream service (Orion, Nebula, Constellation, and future apps). It also places tenant isolation responsibility on the application layer rather than on the identity platform.

## Problem Statement

As the client count grows, the current model has the following friction points:

1. Each new client requires individual API key generation or consent record creation in each downstream service.
2. Tenant isolation is enforced by passing a `domain=` or `clientId=` parameter — an application-layer convention, not a platform-enforced boundary.
3. Token revocation, auditing, and access control are fragmented across multiple services with no central view.
4. The `no_client_consent` class of error (currently seen in Constellation) will recur for every new service added.

## Proposed Architecture

Replace per-service static credentials with **Entra-native multi-tenant token exchange**, using the following model:

### Core concept

Every Synozur application (Orion, Nebula, Constellation, future apps) is registered as a **multi-tenant resource application** in Entra. Galaxy is registered as a **multi-tenant client application**. Each client organisation's Entra tenant admin grants consent once — either admin consent for the whole org, or per-user consent — covering all resource apps.

When a user's request arrives at the Galaxy api-server, the server:
1. Identifies the user's Entra tenant ID (already available from the SSO login or the user's `clientOrganization` record).
2. Exchanges credentials for a **tenant-scoped access token** for the target resource app (Orion, Nebula, etc.) using one of two flows:
   - **Client Credentials** — when the service only needs to know *which org/tenant*, not *which specific user*. Suitable for Nebula reports, Orion course listings.
   - **On-Behalf-Of (OBO)** — when the service needs the user's own Entra identity to make per-user access decisions (e.g. personalised assessments, per-user project access in Constellation).
3. Calls the downstream service with that token. The service validates the token's `tid` (tenant ID) and `aud` (audience) claims — no `domain=` parameter needed.

### User login is decoupled from backend token exchange

Users can authenticate to Galaxy via:
- **Entra SSO** (existing, for client orgs with an Entra tenant)
- **Local email/password** (existing, for users without Entra)

In either case, the api-server looks up the user's `clientOrganization`, finds the associated `entraTenantId`, and uses that to obtain the correctly-scoped downstream token. The login method does not affect the backend flow.

### Onboarding a new client

Under the new model, adding a new client requires:
1. Recording their `entraTenantId` in the `client_organizations` table (already stored today for SSO).
2. The client's Entra tenant admin granting admin consent to Galaxy's Entra app registration.
3. No API key generation, no consent record in SCDP, no per-service provisioning.

Consent is managed centrally in Entra and propagates to all resource apps automatically.

## Research Questions

1. **OBO vs Client Credentials trade-off** — For which Galaxy features does per-user identity need to flow to the downstream service? Where is org-level scoping sufficient? This determines which token flow each service integration should use.

2. **Resource app registration requirements** — What changes are needed in Orion, Nebula, and Constellation to accept Entra-issued tokens instead of (or in addition to) static API keys? Do they need to define Entra permission scopes, and if so, what granularity?

3. **Consent UX** — What does the admin consent flow look like for a client org's IT admin? Is there a self-service path (consent URL redirect) or does it require Synozur to initiate? What happens if consent lapses?

4. **Token caching and refresh** — Client credentials tokens are short-lived (typically 1 hour in Entra vs 15 min in Constellation today). What is the right caching and refresh strategy on the api-server to avoid per-request token fetches at scale?

5. **Backward compatibility / migration path** — Some clients may not have an Entra tenant (local-auth only). How should the system fall back for those clients? Is a hybrid model (Entra tokens where available, static keys as fallback) viable during a transition period?

6. **Audit and revocation** — How does Entra's token audit trail compare to the current per-service API key audit? What does an incident response workflow look like (e.g. a client's data access needs to be revoked immediately)?

## Findings

The findings below answer each numbered question, anchored in the current
codebase. File references use `path:line` so the reader can navigate to the
relevant code.

### Current state — at a glance

| Service | Auth today | Tenant scope today | Token cache today |
| --- | --- | --- | --- |
| Orion | Static `Authorization: ApiKey ${ORION_KEY}` (`artifacts/api-server/src/lib/orion.ts:56`) | `?domain=` query param from `clientOrganization.approvedEmailDomains[0]` (`orion.ts:47-48`) | n/a — single static key |
| Nebula | Static `Authorization: Bearer ${NEBULA_API_KEY}` (`artifacts/api-server/src/lib/nebula.ts:45`) | `?domain=` query param (`nebula.ts:38-39`, `routes/portalNebula.ts:23-29`) | n/a — single static key |
| Constellation | OAuth 2.0 client-credentials grant against `${CONSTELLATION_BASE}/api/galaxy/v1/oauth/token` with `target_client_id` (`constellation.ts:18-58`) | `target_client_id` form field on the token grant; bearer token then carries the binding (`constellation.ts:24, 94`) | per-`target_client_id` token cache, 900 s TTL with 60 s early refresh (`constellation.ts:11-70`) |
| Entra SSO (login only) | OIDC auth-code + PKCE; verified via JWKS (`artifacts/api-server/src/lib/entraOidc.ts:160-298`) | `tid` claim → `clientOrganizationsTable.entraTenantId` (`routes/auth.ts:379-413`) | per-tenant Graph app-only token cache (`lib/entra.ts:34-80`) |

The Drizzle schema already carries the columns the new architecture
needs: `client_organizations.entra_tenant_id` (unique) and
`users.entra_tenant_id` / `entra_object_id`. So the data model is ready;
the work is in token-exchange code and downstream-service token
validation.

### 1. OBO vs Client Credentials — per-route mapping

The right rule of thumb: **use client credentials for org-scoped
read/aggregate calls; use OBO whenever the downstream service records
an attribution (signoff, comment, approval) tied to an individual
human, or makes per-user authorization decisions.** Galaxy already
gates routes with `requireCustomerAudience`, so org-scoping is enforced
at the BFF; the downstream service only needs to trust the `tid` claim
on a CC token to enforce tenant isolation.

Mapping the existing portal routes:

| Route (file:line) | Today | Recommended flow |
| --- | --- | --- |
| `GET /portal/orion/models` (`routes/portalOrion.ts:52`) | Org domain | **CC** — pure org listing |
| `GET /portal/orion/courses` (`routes/portalOrion.ts:64`) | Org domain | **CC** |
| `GET /portal/orion/results` (`routes/portalOrion.ts:76`) | Org domain | **OBO if** Orion filters per-user enrollments; otherwise CC. Today the BFF passes only `domain=`, so org-wide is the existing contract. Stay on CC unless Orion adds per-user gating. |
| `GET /portal/orion/traffic` (`routes/portalOrion.ts:90`) | Org domain | **CC** — analytics aggregate |
| `GET /portal/nebula/reports`, `/:spaceId`, `/workspaces` (`routes/portalNebula.ts:56,75,86`) | Org domain | **CC** — Nebula reports are org-scoped |
| `GET /portal/constellation/projects[/:id]` (`routes/portalConstellation.ts:59,75`) | `target_client_id` | **CC** |
| `GET /portal/constellation/projects/:id/status-reports` (`portalConstellation.ts:88`) | CC | **CC** |
| `POST /portal/constellation/status-reports/:id/acknowledge` (`portalConstellation.ts:103`) | CC + `comment` body | **OBO** — acknowledgement creates a `signoff` row with author attribution; Constellation must be able to bind the action to a specific user. |
| `GET /portal/constellation/projects/:id/milestones` (`portalConstellation.ts:118`) | CC | **CC** |
| `POST /portal/constellation/milestones/:id/{accept,reject}` (`portalConstellation.ts:134,147`) | CC | **OBO** — same signoff attribution argument |
| `GET /portal/constellation/estimates/:id` (`portalConstellation.ts:162`) | CC | **CC** |
| `POST /portal/constellation/estimates/:id/{approve,request-changes}` (`portalConstellation.ts:173,186`) | CC | **OBO** — approvals are legally meaningful and need a real user identity in Constellation's audit trail |
| `GET /portal/constellation/invoices` (`portalConstellation.ts:201`) | CC | **CC** |
| `GET /portal/constellation/projects/:id/raidd` (`portalConstellation.ts:218`) | CC | **CC** |
| `POST /portal/constellation/raidd/:id/comments` (`portalConstellation.ts:233`) | CC + `comment` body | **OBO** — comments are user-attributed |

In short: every read endpoint can stay on client-credentials; the six
mutation endpoints in Constellation that produce signoffs or comments
should switch to OBO so that Constellation receives a token whose `oid`
claim is the real authoring user. Until OBO is wired up, today's code
passes a `comment` body string with the user's attribution embedded by
Galaxy (`constellation.ts:266-303`); that's an application-layer
attribution, not a platform-enforced one.

A pragmatic interim option: keep CC for the mutations and pass the
acting user's `entra_object_id` in a custom request header that
Constellation logs alongside the signoff. This decouples the
Constellation rebuild from the Galaxy-side token plumbing.

### 2. Resource app registration requirements

Each downstream service becomes a multi-tenant resource app in Entra.
The work splits into *Entra-side configuration* and *service-side code*:

**Entra-side, per resource app (Orion, Nebula, Constellation):**

- App registration with `signInAudience = AzureADMultipleOrgs`.
- Expose an Application ID URI, e.g. `api://orion.synozur.com`.
- Define **app roles** for client-credentials callers (these become
  `roles` claims on CC tokens):
  - Orion: `Models.Read`, `Courses.Read`, `Results.Read`, `Traffic.Read`
  - Nebula: `Reports.Read`, `Workspaces.Read`
  - Constellation (read side): `Projects.Read`, `Milestones.Read`,
    `StatusReports.Read`, `Estimates.Read`, `Invoices.Read`,
    `RAIDD.Read`
- Define **delegated scopes** for OBO (these become `scp` claims on
  user tokens):
  - Constellation only: `StatusReports.Acknowledge`,
    `Milestones.Sign`, `Estimates.Approve`, `RAIDD.Comment`
- Mark scopes that should not require per-user consent as
  "admin only" so they fold under the Galaxy admin-consent grant.

**Galaxy app registration (single multi-tenant client app):**

- Add `Required permissions` entries for each app role above
  (application permissions, admin-consent required) and each delegated
  scope (delegated, admin-consent required if marked admin-only).
- Keep the existing OIDC user-login config; the same registration
  serves both purposes.

**Service-side code (Orion, Nebula, Constellation):**

The current shape: each service trusts a static API key and trusts
the `domain=` query param. The replacement:

1. JWT bearer middleware that validates: signature against
   `https://login.microsoftonline.com/common/discovery/v2.0/keys`,
   `iss` matching `https://login.microsoftonline.com/{tid}/v2.0` (or
   `sts.windows.net/{tid}/` for v1.0 tokens), `aud` matching the
   service's Application ID URI, and `exp`.
2. Tenant-scoping middleware that maps `tid` → the service's internal
   tenant/customer record. For Orion and Nebula this means the
   service stores a `customers (entra_tenant_id, internal_id)` row;
   queries scope by `internal_id` instead of by the email-domain
   lookup. For Constellation, the existing `clients` table needs an
   `entra_tenant_id` column populated from today's `target_client_id`
   mappings.
3. Authorization middleware that checks `roles` (CC) or `scp` (OBO)
   against the route's required permission.
4. A transition period (see Q5) where the legacy API-key /
   `target_client_id` paths coexist with the JWT path.

Granularity recommendation: **one role per resource read-set, one
scope per user-attributable action**. Coarser than per-endpoint, finer
than a single `Galaxy.All`. This matches how customer admins read
permission lists in the Entra consent dialog — fewer items reads
better and reduces the chance an admin balks at the consent screen.

### 3. Consent UX

**Self-service path is the right default.** Synozur should not need
to manually initiate anything per client. The flow:

1. During onboarding, Galaxy admin UI surfaces a "Connect your
   Microsoft tenant" CTA on the customer-org settings page.
2. Clicking redirects the customer's IT admin to:
   ```
   https://login.microsoftonline.com/organizations/v2.0/adminconsent
     ?client_id={GALAXY_APP_ID}
     &redirect_uri={GALAXY_BASE}/galaxy/admin-consent-callback
     &scope={comma-separated app permissions}
     &state={signed_state_with_org_id}
   ```
3. The IT admin signs in, sees the consolidated permission list
   (every resource app's roles + scopes Galaxy declared as required),
   and clicks Accept.
4. Microsoft redirects back to
   `/galaxy/admin-consent-callback?tenant={tid}&admin_consent=True&state=...`.
5. Galaxy verifies the signed `state`, upserts
   `client_organizations.entra_tenant_id`, and writes a row to a new
   `tenant_consent_state` table tracking `granted_at`, `granted_by_oid`,
   `last_verified_at`.
6. Subsequent token requests for that tenant will succeed.

**What "lapsed consent" looks like.** Admin consent is durable —
Microsoft does not expire it. It only goes away if:

- A tenant admin actively revokes the Galaxy enterprise app from
  Azure portal → Enterprise applications → Galaxy → Properties →
  Delete (or removes individual permissions).
- Galaxy adds a new required permission since the last consent and a
  user/admin hasn't re-consented (Entra calls this "incremental
  consent"; `AADSTS65001` is the error).
- The customer's Entra tenant is deleted.

**Detection and recovery.** When the api-server's token-exchange code
hits `AADSTS65001` (no consent) or `AADSTS50105` (user not assigned to
app, when assignment is required), it should:

- Mark the org's `tenant_consent_state.last_token_fetch_error`.
- Return `503 consent_required` to Galaxy with a `consent_url`
  pointing back to the admin-consent endpoint.
- Galaxy renders an in-app banner: "Microsoft tenant connection
  expired — please reconnect" with a button that re-runs the
  consent flow.

**Per-user consent for OBO scopes.** If any OBO scope is *not*
admin-consented (because the customer admin chose not to), individual
users will see a Microsoft consent dialog the first time they hit the
Galaxy login redirect. To minimize friction, mark all required scopes
as "admin only" and rely on the admin-consent path exclusively.

### 4. Token caching and refresh

The pattern in `lib/entra.ts:34-80` (per-tenant app-only Graph token
cache) and `lib/constellation.ts:11-70` (per-`target_client_id` token
cache) is the right shape — generalize it into one helper module.
Recommended design:

- **Cache key**:
  - CC: `${resourceAppId}:${tenantId}`
  - OBO: `${resourceAppId}:${tenantId}:${userOid}` — never cached
    across users
- **TTL**: respect `expires_in` from the token response (Entra issues
  3600 s for app tokens, ~1 h for user tokens). Refresh **5 min**
  early, not 60 s — gives more headroom on long-running batch jobs.
- **Single-flight**: store `Promise<string>` in the cache, not
  resolved strings. The current code in `constellation.ts:60-70`
  has a thundering-herd risk when many requests for the same tenant
  arrive within the early-refresh window — they all race to call
  `fetchClientCredentialsToken`. Replace with:
  ```ts
  const inflight = new Map<string, Promise<TokenEntry>>();
  function getToken(key) {
    const cached = cache.get(key);
    if (cached && cached.expiresAt - 300_000 > Date.now()) return cached.token;
    let p = inflight.get(key);
    if (!p) {
      p = fetchToken(key).then(entry => { cache.set(key, entry); return entry; })
        .finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    return (await p).token;
  }
  ```
- **Negative caching**: on `AADSTS65001` or repeated 5xx, cache the
  *failure* for 30 s so a misconfigured tenant doesn't generate
  hundreds of token requests per second.
- **Storage**: in-memory is fine for the current single-process
  api-server. When the api-server scales to N replicas, the
  per-replica × per-tenant token volume is `N × T × 1/3600 req/s`
  which for `N=4, T=100` is ~0.1 req/s — well within Entra's quota
  (Entra publishes a 1500 req/min/app limit). No Redis needed for
  scale; introduce only if duplicate refresh costs become measurable.
- **OBO**: cache user tokens only for the lifetime of the user's
  Galaxy session. Don't persist refresh tokens to disk unless
  encrypted (and unless there's a clear product reason — most OBO
  flows can re-acquire from the user's current Galaxy access token
  without a refresh token).
- **Never log token strings.** Today's code already gets this right
  (`constellation.ts:50` logs status + body but the body contains
  the error JSON, not the token). Keep that discipline in any new
  helper.

### 5. Backward compatibility and migration

There are **two independent migration axes**, and they can move at
different speeds:

**(a) Some clients have no Entra tenant.** These are local-email/
password customers; `client_organizations.entra_tenant_id` is `NULL`.
For them:

- Orion / Nebula: keep the static API-key path. The friction described
  in the brief (per-client provisioning) only applies to *Entra-tenant*
  customers; the static key works for the long tail of small clients.
- Constellation: keep the existing `target_client_id` flow as fallback.
  `client_organizations` already carries enough metadata to look up
  the right `clientId`.

So the rule becomes: **use Entra tokens when `entraTenantId` is
present; fall back to legacy auth otherwise**. A single helper in
`lib/` — call it `getDownstreamCredential(service, org, user?)` —
returns `{ kind: "entra-cc"|"entra-obo"|"static-key", credential }`
and each service module branches once at the top of its fetch
helper.

**(b) Services migrate at different rates.** Per-service order, easiest
first:

1. **Nebula** — three GET endpoints, no writes, small surface. Build
   the JWT-validation middleware once here and reuse the pattern.
2. **Orion** — four GET endpoints, similar shape. Keep the
   per-domain cache key, but key by `tid` instead of `domain` once
   migrated.
3. **Constellation reads** — six GET endpoints. Reuse the existing
   read cache shape (`constellation.ts:124-140`), swap the token
   source.
4. **Constellation writes** — six POST endpoints, all need OBO.
   Slowest because both Galaxy and Constellation need new code.

Per-service rollout: dual-accept (API key OR JWT) for one release,
then remove API-key acceptance once Galaxy has flipped over for all
Entra-tenant clients. Track the cutover with a `Migration-Source`
header in api-server requests so service owners can see the ratio.

### 6. Audit and revocation

**What Entra gives you that you don't have today:**

- **Sign-in logs** for every service-principal token issuance. Visible
  to *both* Synozur (for the Galaxy app registration) and the customer
  tenant admin (filtered to their tenant). Today, Galaxy's static
  API-key calls are invisible to customer admins entirely.
- **Audit logs** for consent grants, permission scope changes, app
  role assignments, and admin-consent revocations.
- **Conditional Access** policies that the customer's tenant admin
  applies to the Galaxy app — IP restrictions, MFA, named locations,
  device compliance. They get this for free with no Synozur work.

**What Entra makes harder than today:** Synozur cannot directly delete
a service principal in a customer's tenant — only the customer admin
can. So "I need to revoke this customer's data access in 30 seconds"
requires a Synozur-side enforcement point.

**Recommended IR model — two-layer revocation:**

1. **Synozur-side denylist (instant).** A `tenant_blocklist` table
   checked in the api-server before any `getDownstreamCredential`
   call. Adding a `tid` here causes 403 on every subsequent
   downstream call within seconds, regardless of whether Microsoft
   tokens are still valid. This is the surgical, fast lever.
2. **Customer-side consent revocation (durable).** Email the
   customer admin a deep link to Azure portal → Enterprise
   applications → Galaxy → Properties → Delete. Once they revoke,
   no new tokens issuable for that tenant.
3. **Last-resort Synozur key rotation.** Rotate Galaxy's client
   credentials. All currently issued tokens still work until they
   expire (≤1 h), but no new tokens issuable *for any tenant*.
   Avoid unless multi-tenant compromise is suspected.

**Compared to today.** Right now, "revoke customer X" means rotate or
remove their Constellation API record + any Orion/Nebula keys; it's
multi-step, manual, per-service. The denylist approach above is
single-step, instant, applies to all current and future services, and
leaves a clean audit trail in `tenant_blocklist`.

**Audit forwarding.** For incident review, plan to:

- Subscribe to `Microsoft.Graph` audit-log webhooks for the Galaxy
  app, mirror into the api-server's `audit_log` table.
- Add explicit `audit()` calls (`lib/audit.ts:3-21`) at every
  `getDownstreamCredential` site, recording `actorId`, `tid`,
  `resourceApp`, and `flow`. Today these are not logged for
  Orion/Nebula/Constellation reads (the explore confirmed there are
  no `audit()` calls in `portalOrion.ts`/`portalNebula.ts`/
  `portalConstellation.ts`). Adding even a sampled audit trail
  closes a visibility gap that is independent of the Entra migration.

## Recommended migration sequence

A concrete ordering that follows the answers above:

1. **Schema + helper** — add `tenant_consent_state` and
   `tenant_blocklist` tables; add `getDownstreamCredential(service,
   org, user?)` helper; add JWT-validation middleware library shared
   across services.
2. **Galaxy app registration in Entra** — multi-tenant, with all
   required app permissions and OBO scopes declared up front so the
   first admin-consent grant covers everything.
3. **Admin-consent UI in Galaxy** — the redirect flow and callback
   from §3, plus a settings-page banner when consent is missing or
   stale.
4. **Nebula migration** — first end-to-end target; build the bearer
   middleware here, dual-accept for one release.
5. **Orion migration** — repeat the Nebula pattern.
6. **Constellation reads** — swap token source, keep `target_client_id`
   path as fallback for local-auth clients.
7. **Constellation writes (OBO)** — last; requires Constellation-side
   work to consume `oid` claim for signoff attribution.
8. **Audit and denylist** — deploy `tenant_blocklist` enforcement and
   audit-log forwarding alongside step 1's helper, validated through
   the rollout.

## Alternative architecture: Galaxy-orchestrated provisioning + internal RBAC

A pragmatic alternative to the Entra-native model, surfaced in
discussion: keep today's BFF + static-key shape, but **automate the
provisioning** that today is manual. The flow:

1. Client setup begins in Constellation (already the system of record).
2. Constellation offers a "publish to Galaxy" action that calls a new
   Galaxy admin endpoint with the client's metadata.
3. Galaxy fans out: calls Orion, Nebula, and SCDP admin endpoints to
   instantiate per-client API keys, stores them encrypted in the
   Galaxy database alongside the existing `client_organizations` row.
4. Galaxy uses the stored keys to call downstream services on behalf
   of users.
5. Galaxy's existing RBAC (`userRoles`, `entraGroupRoleMappingsTable`)
   gates which users see which features — Finance vs. Status Reports
   vs. Courseware are role-scoped capabilities inside Galaxy, not
   downstream-service-scoped.

This is explicitly designed around the constraint that **not all
clients can be required to have an Entra tenant**.

### Pros

1. **Universal — works for every client.** No "ask your IT admin to
   consent" step. SMB clients, clients on Google Workspace, sole-
   proprietor consultancies, and Entra-tenant clients all flow through
   the same pipeline.
2. **Aligned with the business.** Constellation is already the system
   of record for clients; making it the entry point and fanning out
   matches how onboarding actually works today.
3. **Builds on existing code, not against it.** The `domain=` plumbing
   in `lib/orion.ts:47-48` and `lib/nebula.ts:38-39` already works at
   scale. The `target_client_id` grant in `lib/constellation.ts:18-58`
   already works. You're automating the provisioning, not rebuilding
   the auth model.
4. **No service-side identity-platform work.** Orion and Nebula keep
   their bearer-token middleware. Each service just needs one
   admin-only `POST /admin/clients` endpoint Galaxy can call with a
   service-to-service credential.
5. **Faster delivery.** Probably weeks vs. quarters compared to the
   multi-tenant Entra path. No JWKS validation, no admin-consent UX,
   no per-service Entra app registration.
6. **RBAC stays product-shaped.** Roles like "Finance Reader" /
   "Project Lead" / "Course Admin" map cleanly to Galaxy capabilities.
   This is how features are organized in the UI and how
   `entra_group_role_mappings` already works.
7. **Single-pane audit.** Every "user X viewed Y in service Z" event
   is one row in Galaxy's `audit_log` table. With Entra, audit
   splinters across the customer's sign-in logs and Synozur's
   downstream service logs.

### Cons

1. **Galaxy becomes the crown jewel.** A breach of the Galaxy DB =
   every client's keys for every downstream service. The current model
   has this concentration risk too; automating it expands the blast
   radius. Requires KMS-encrypted secrets, rotation schedule,
   revocation playbook, and the discipline never to log a key.
2. **Tenant isolation stays application-layer.** This was the second
   bullet in the original problem statement and it doesn't go away. A
   bug in BFF code that swaps `clientId` between in-flight requests
   still cross-contaminates tenants. Entra `tid` validation would
   have been *platform-enforced*; this is not. Mitigations: contract
   tests, sampled audit, per-request integrity checks — but those are
   guard rails, not a railroad.
3. **You now own a credential lifecycle.** Per-service rotation,
   per-tenant revocation, alerting on rotation failure, secret-store
   integration. Real ongoing operational work that wasn't there
   before. Galaxy effectively becomes a small secrets-management
   product.
4. **No customer-side audit or revocation.** A customer admin can't
   see "Galaxy made N calls as us today" or unilaterally revoke
   Galaxy. They have to email Synozur. With Entra, those are
   self-service in their Azure portal. Irrelevant for SMB clients;
   matters for the ~5–10 % of enterprise clients whose security teams
   ask before signing.
5. **Conditional Access doesn't propagate.** Customer policies
   (require MFA, block from country X, require compliant device) on
   their tenant don't apply to Galaxy traffic. Galaxy must enforce
   its own MFA at login.
6. **Per-user attribution is still application-layer.** Constellation's
   signoff records get a Galaxy-injected `comment` field with the
   user's name in it, not a token-bound `oid` claim. If a regulator
   audits "did Jane actually approve this?", the proof lives in
   Galaxy's logs, not in Constellation's. Discoverable, but more
   fragile.
7. **Distributed-transaction problem on provisioning.** Galaxy calls
   Orion (ok) → Nebula (ok) → SCDP (timeout). What's the consistency
   model? Either build a saga with compensation, or accept that some
   clients land half-provisioned and need manual cleanup. Worth
   designing up front, not papering over.
8. **Doesn't fix `no_client_consent`** — automating Constellation
   consent-record creation just moves the failure window from "first
   user click" to "onboarding step 3." Net positive (errors surface
   earlier), but the underlying Constellation logic is unchanged.

### Recommendation: hybrid, not either/or

The two architectures aren't mutually exclusive, and this is where to
land:

**Default path (the architecture above).** Constellation push →
Galaxy → fans out and provisions API keys → Galaxy RBAC gates feature
visibility. Works for every client. Ship this first.

**Opportunistic Entra layer.** When
`client_organizations.entra_tenant_id` is populated (already captured
for SSO), offer a "Connect your Microsoft tenant" flow in Galaxy
admin. On admin-consent, that org switches **only the user-attributable
mutations** — the Constellation signoffs / approvals / comments
identified as OBO targets in the Findings table — to Entra-issued
tokens. Reads stay on API keys for everyone.

This gives the onboarding-speed win for the long tail *and* gives
enterprise clients platform-enforced attribution and audit trail
where it actually matters (legally meaningful approvals), without
doubling the migration scope. The `getDownstreamCredential(service,
org, user)` helper from the Recommended migration sequence becomes
the seam: it returns either an API key or an Entra token based on
what's available, and individual service modules don't care which.

### What to nail down before building

- **Secret storage.** Wherever auto-provisioned keys land, that's
  now the most security-critical surface in the stack. Decide on KMS
  / Vault / sealed envelope encryption *and* a rotation cadence
  before the first automated `POST /admin/clients` call goes out.
  Retrofitting this later is painful.
- **Provisioning saga.** Define the consistency model up front: at
  minimum, idempotent per-service provisioning endpoints (so retries
  don't double-issue keys), a `client_provisioning_state` table in
  Galaxy tracking which downstream services are wired up, and a
  reconcile job that flags partially-provisioned clients.
- **Service-to-service credential.** Galaxy needs a privileged
  credential to call each service's `POST /admin/clients`. Treat
  this as a tier-0 secret — separate KMS key, narrow IP allow-list,
  audit on every use. Rotate on a fixed schedule, not on demand.
- **Revocation contract.** Each downstream service needs a
  `DELETE /admin/clients/:id` (or `revoke`) endpoint. Define the
  expected latency ("revoke takes effect within N seconds") so the
  IR runbook can promise customers a real number.
- **RBAC mapping.** Settle the role taxonomy now: Finance Reader,
  Status Report Reader, Course Admin, Project Lead, etc. Map each
  Galaxy capability to exactly one role; avoid per-feature role
  proliferation. This becomes the contract surface for both local
  and Entra-group-driven role assignments.

## Reference

- Microsoft identity platform — On-Behalf-Of flow: https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-on-behalf-of-flow
- Multi-tenant app registration in Entra: https://learn.microsoft.com/en-us/entra/identity-platform/howto-convert-app-to-be-multi-tenant
- Client credentials flow: https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow
- Admin consent: https://learn.microsoft.com/en-us/entra/identity-platform/v2-admin-consent
