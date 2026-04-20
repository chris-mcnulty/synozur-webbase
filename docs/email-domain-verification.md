# Verifying synozur.com for Resend (Email Deliverability)

This is a one-time operations task. It requires:

1. Access to the **Resend** dashboard for the account that owns `RESEND_API_KEY`.
2. Access to the **DNS** for `synozur.com` (e.g. Cloudflare, Route 53, GoDaddy, Wix DNS).
3. Access to the **deployed app's environment variables** (Replit Deployment → Secrets).

The form-confirmation emails sent from `artifacts/api-server/src/lib/email.ts` use `EMAIL_FROM` (default `The Synozur Alliance <hello@synozur.com>`). Until the sending domain is verified with SPF + DKIM + DMARC, those messages are likely to be quarantined or rejected by Gmail / Outlook / Microsoft 365.

---

## Step 1 — Add the domain in Resend

1. Sign in at <https://resend.com/domains>.
2. Click **Add Domain** → enter `synozur.com` → choose the region closest to most recipients (typically `us-east-1`).
3. Resend will display a set of DNS records (typically 4): one TXT for SPF, two or three CNAMEs for DKIM, and one MX for the bounce subdomain (`send.synozur.com` or similar). **Copy them exactly as shown** — host names and values vary per account.

## Step 2 — Publish the DNS records

In the DNS provider for `synozur.com`:

| Type  | Host (example)                | Value (from Resend)                | TTL   |
| ----- | ----------------------------- | ---------------------------------- | ----- |
| TXT   | `send` (or `@` if combined)   | `v=spf1 include:amazonses.com ~all` (or whatever Resend shows) | Auto |
| MX    | `send`                        | `feedback-smtp.us-east-1.amazonses.com` (priority 10) | Auto |
| CNAME | `resend._domainkey`           | `resend._domainkey.<random>.amazonses.com` | Auto |
| CNAME | (additional DKIM, if present) | (as shown)                         | Auto |

**Important:** if `synozur.com` already has an SPF record at the apex (`@`), do **not** add a second one. Merge `include:amazonses.com` into the existing record. Two SPF records at the same host = both fail.

Then add a **DMARC** record (Resend doesn't auto-provision this; it's required for best deliverability):

| Type | Host       | Value                                                                                              |
| ---- | ---------- | -------------------------------------------------------------------------------------------------- |
| TXT  | `_dmarc`   | `v=DMARC1; p=none; rua=mailto:dmarc@synozur.com; ruf=mailto:dmarc@synozur.com; fo=1; adkim=r; aspf=r` |

Start at `p=none` (monitor only). After a week or two of clean reports, tighten to `p=quarantine` and eventually `p=reject`.

## Step 3 — Verify in Resend

Back in the Resend dashboard, click **Verify DNS Records**. Propagation usually takes 5–30 minutes, occasionally up to a few hours. All records must show **Verified** (green).

## Step 4 — Set production environment variables

In the deployed app's secrets (Replit Deployment → Secrets), confirm these are set:

| Var                  | Value                                                  | Notes |
| -------------------- | ------------------------------------------------------ | ----- |
| `RESEND_API_KEY`     | `re_...` (from Resend → API Keys)                      | Required for any email to send. |
| `EMAIL_FROM`         | `The Synozur Alliance <hello@synozur.com>`             | Must use the verified domain. |
| `FORMS_NOTIFY_EMAIL` | `hello@synozur.com` (or wherever internal notifications go) | If unset, internal notifications are silently skipped. |
| `SITE_URL`           | `https://synozur.com`                                  | Used in the email footer link. |

If `EMAIL_FROM` uses any domain other than the one verified in step 3, Resend will reject every send with a 403.

## Step 5 — Send live test submissions

From the live site, submit one form of each type using a **real inbox you control**:

1. `/contact` — fill in name, email, message.
2. `/subscribe` — enter the same email.
3. `/start` — fill in the Get Started form.

For each resulting confirmation email, in Gmail open **Show original** (or in Outlook, **View → Message Source**) and confirm:

- `SPF: PASS` (with `synozur.com` or the configured `send.synozur.com` subdomain)
- `DKIM: PASS` (signed by `resend._domainkey.synozur.com`)
- `DMARC: PASS`

Also confirm the messages land in **Inbox**, not Spam/Junk, on at least Gmail and Outlook.com.

## Step 6 — Sanity-check the bounce/complaint flow

In Resend, the `Logs` page should show the three test sends with status **Delivered**. If any show **Bounced** or **Complained**, fix before going wider.

---

## Rollback

If something goes wrong and emails start failing in production:

1. Unset `RESEND_API_KEY` — the code path treats this as `skipped` and submissions still succeed (see `sendEmail()` in `artifacts/api-server/src/lib/email.ts`). The user will not get a confirmation, but the form won't break.
2. Investigate Resend logs and DNS, then re-enable.
