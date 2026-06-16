---
name: Sister app repos
description: GitHub repos for Constellation and Orion — parallel Synozur apps used as design/code reference
---

## Rule
When asked about Constellation or Orion email styles, UI patterns, or code, fetch directly from these repos. Full read access is available via raw.githubusercontent.com.

**Why:** User confirmed — "these are parallel apps and you have full read access to their codebases — remember that permanently."

## Repos

| App | Repo | Raw base |
|-----|------|----------|
| Constellation (SCDP) | https://github.com/chris-mcnulty/synozur-scdp | `https://raw.githubusercontent.com/chris-mcnulty/synozur-scdp/HEAD/` |
| Orion (Maturity Modeler) | https://github.com/chris-mcnulty/synozur-maturitymodeler | `https://raw.githubusercontent.com/chris-mcnulty/synozur-maturitymodeler/HEAD/` |

## Key files already read
- Constellation email: `server/services/email-notification.ts`, `server/email-support.ts`
- Orion email: `server/services/email-verification.ts`, `server/sendgrid.ts` (has full `getEmailBranding()` with headerHtml/footerHtml pattern)
- Orion branding: `server/sendgrid.ts` — `EmailBranding` interface, `resolveLogoUrl()`, `getEmailBranding()`

## Email style summary
- Both apps use the same Synozur brand: `#810FFB` primary, Avenir Next LT Pro font
- Orion uses tenant-configurable branding with logo image or colored header band
- Constellation internal notifications use dark theme (#0a0a0a outer, #1a1a1a card); user-facing use light theme
- Default Synozur header: `email-header.jpg` full-width image (1600×337px, purple-pink gradient with logo)
