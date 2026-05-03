# @workspace/auth-sdk

Helper package for downstream Synozur web apps consuming the central OAuth 2.0
/ OIDC provider implemented in `artifacts/api-server/src/routes/oauth.ts`
(#128).

## Three entry points

| Import path | Use from | What it gives you |
|---|---|---|
| `@workspace/auth-sdk` | both | shared TypeScript types + isomorphic PKCE helpers (Web Crypto) |
| `@workspace/auth-sdk/browser` | SPA / browser | `BrowserOidcClient` — build authorize URL, redeem code, refresh, fetch userinfo |
| `@workspace/auth-sdk/server` | Node / Express | `verifyAccessToken`, `verifyIdToken`, `requireOidcUser` middleware |

## Browser SPA usage

```ts
import { BrowserOidcClient } from "@workspace/auth-sdk/browser";

const client = new BrowserOidcClient({
  issuer: window.location.origin,
  clientId: import.meta.env.VITE_OAUTH_CLIENT_ID,
  redirectUri: `${window.location.origin}/oauth-callback`,
  scope: "openid profile email offline_access",
});

// On sign-in:
window.location.assign(await client.buildAuthorizeUrl({ returnTo: "/" }));

// In your /oauth-callback route:
const { tokens, returnTo } = await client.handleCallback(
  new URLSearchParams(window.location.search),
);
window.history.replaceState(null, "", returnTo ?? "/");

// On every API request:
const token = await client.getAccessToken(); // refreshes transparently
fetch("/api/something", { headers: { Authorization: `Bearer ${token}` } });
```

## Express middleware usage

```ts
import express from "express";
import { requireOidcUser } from "@workspace/auth-sdk/server";

const app = express();
app.get(
  "/api/me",
  requireOidcUser({
    issuer: "https://synozur.com",
    audience: process.env.OAUTH_CLIENT_ID!,
    requiredScopes: ["profile"],
  }),
  (req, res) => {
    res.json({ sub: req.oidc!.sub, capabilities: req.oidc!.cap });
  },
);
```

## ID token verification (server-side)

```ts
import { verifyIdToken } from "@workspace/auth-sdk/server";

const claims = await verifyIdToken(idToken, {
  issuer: "https://synozur.com",
  audience: clientId,
});
console.log(claims.email, claims.name);
```
