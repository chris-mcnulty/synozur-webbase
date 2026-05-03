/**
 * @workspace/auth-sdk — helper package for consuming the Synozur OAuth 2.0 /
 * OIDC provider (#128).
 *
 * Three entry points:
 *   "@workspace/auth-sdk"          — shared types + isomorphic PKCE helpers
 *                                    (uses Web Crypto, works in browsers and
 *                                    Node 20+).
 *   "@workspace/auth-sdk/browser"  — browser OIDC client: build authorize URL,
 *                                    redeem code, refresh, fetch userinfo.
 *   "@workspace/auth-sdk/server"   — server-side ID-token verification via
 *                                    JWKS + an Express `requireOidcUser`
 *                                    middleware.
 */

export * from "./types";
export * from "./pkce";
