// Module-level singleton for the Galaxy OIDC browser client.
//
// Galaxy is mounted at `${BASE_URL}` (e.g. `/galaxy/`) on the same origin
// as the OAuth provider, so the issuer is `window.location.origin`.
// The redirect URI matches the seed in `artifacts/api-server/src/lib/galaxyOauthSeed.ts`.

import { BrowserOidcClient } from "@workspace/auth-sdk/browser";

export const GALAXY_OAUTH_CLIENT_ID = "galaxy-portal-spa";
export const GALAXY_OAUTH_SCOPE = "openid profile email offline_access";

function buildClient(): BrowserOidcClient {
  const base = import.meta.env.BASE_URL.replace(/\/+$/, "");
  return new BrowserOidcClient({
    issuer: window.location.origin,
    clientId: GALAXY_OAUTH_CLIENT_ID,
    redirectUri: `${window.location.origin}${base}/oauth-callback`,
    scope: GALAXY_OAUTH_SCOPE,
    storage: window.localStorage,
    storageKeyPrefix: "galaxy-oauth",
  });
}

let _client: BrowserOidcClient | null = null;

export function getOauthClient(): BrowserOidcClient {
  if (!_client) _client = buildClient();
  return _client;
}
