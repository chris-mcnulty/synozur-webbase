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

## Reference

- Microsoft identity platform — On-Behalf-Of flow: https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-on-behalf-of-flow
- Multi-tenant app registration in Entra: https://learn.microsoft.com/en-us/entra/identity-platform/howto-convert-app-to-be-multi-tenant
- Client credentials flow: https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow
- Admin consent: https://learn.microsoft.com/en-us/entra/identity-platform/v2-admin-consent
