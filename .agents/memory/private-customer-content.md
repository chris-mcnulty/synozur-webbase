---
name: Private customer content boundaries
description: Confidential organization pages require private SharePoint storage, explicit preview authorization, and scoped shared identities.
---

Customer/prospect custom pages and their source HTML, audio and narration scripts must remain private in SharePoint Embedded. Do not reuse public media publication, anonymous links, search indexing, SEO previews, static assets or source control for these materials.

**Why:** The user explicitly requires confidential organization-restricted delivery. Prospect access must not depend on an engagement contract.

**How to apply:** Keep imports as drafts until an administrator reviews and publishes them. Resolve the intended organization exactly; never infer authorization from the first active organization. The first supplied example is MassHousing, not MassHealth.

Shared organization accounts are an explicitly provisioned exception, not a replacement for individual authentication. They must be read-only and attributed to the organization rather than an individual.

**Why:** The user requires direct shared username/password access without verification loops, while keeping ordinary individual and Microsoft authentication unchanged.

**How to apply:** Deny identity linking/recovery, inherited privileged roles, non-Galaxy applications and business actions. Rotation and disabling must invalidate every old cookie and token immediately.

Do not treat an opaque-origin iframe plus restrictive fetch CSP as proof of complete uploaded-script isolation.

**Why:** Sandboxing protects the parent but does not itself prohibit the child from navigating its own frame to an external destination. Arbitrary uploaded scripts can use navigation to disclose content.

**How to apply:** Establish and browser-test a safe interaction execution strategy before enabling confidential HTML delivery; preserve the supplied proposal's business content and supported interactions without granting unrestricted uploaded JavaScript execution.

Shared access intentionally uses dedicated short-lived server-side cookies, not Galaxy OAuth access/refresh tokens. Email-shaped usernames are labels, not verified email identities.

**Why:** Shared credentials must never become cross-application SSO credentials. Live session/account checks make revocation immediate while ordinary individual OAuth remains unchanged.

**How to apply:** Keep shared identities out of the ordinary identity loader and OAuth/recovery/linking flows. Do not add bearer issuance as a convenience without revisiting the entire audience and revocation boundary.

Confidential HTML allows only explicitly vetted script hashes; arbitrary uploaded JavaScript is rejected, not silently stripped.

**Why:** CSP and opaque origins do not stop an attacker-controlled script from navigating its own iframe to exfiltrate data. A vetted local interaction script preserves the original proposal controls without granting arbitrary execution.

**How to apply:** Review new interaction scripts before approving their hashes; preserve safe static SVG shapes, embedded raster images and local interactions. Attachment playback uses a parent-fetched Blob passed into the sandbox rather than authenticated iframe requests or bearer links.
