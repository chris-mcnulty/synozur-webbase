---
name: SendGrid 401 "not authorized to send mail"
description: Root cause and fix for SendGrid mail/send returning 401 despite valid API key
---

## Rule
When SendGrid's `/v3/mail/send` returns `401 {"message":"Authenticated user is not authorized to send mail"}` even though `/v3/user/profile` returns 200, the account is **suspended due to billing** — not a key scope issue.

**Why:** A suspended SendGrid account keeps the API key valid for read endpoints (profile, credits) but blocks all outbound mail sends. The Replit connector's cached key also becomes stale when the account is suspended and then reactivated — the connector must be reconnected to get a fresh key.

**How to apply:**
1. Check SendGrid account billing status at app.sendgrid.com → Settings → Account Details.
2. After resolving billing, disconnect and reconnect the SendGrid integration in Replit's Integrations panel to provision a fresh key.
3. Redeploy the api-server so production picks up the new connector credentials.
4. Verify with a direct `POST /v3/mail/send` test (202 = working).
