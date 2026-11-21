---
name: Private customer content boundaries
description: Confidential organization pages require private SharePoint storage, explicit preview authorization, and scoped shared identities.
---

Customer/prospect custom pages and their source HTML, audio and narration scripts must remain private in SharePoint Embedded. Do not reuse public media publication, anonymous links, search indexing, SEO previews, static assets or source control for these materials.

**Why:** The user explicitly requires confidential organization-restricted delivery. Prospect access must not depend on an engagement contract.

**How to apply:** Keep imports as drafts until an administrator reviews and publishes them. Resolve the intended organization exactly; never infer authorization from the first active organization. The first supplied example is MassHousing, not MassHealth. Synozur site administrators must also be able to open direct private-page links without joining a client organization (explicit user requirement); non-admin staff previews remain organization-scoped.

Shared organization accounts are an explicitly provisioned exception, not a replacement for individual authentication. They must be read-only and attributed to the organization rather than an individual.

Administrators must be able to choose shared organization passwords, not only generate them.

**Why:** The user explicitly requested administrator-set passwords for Galaxy.

**How to apply:** Offer custom and generated passwords for creation and replacement; preserve immediate revocation of existing sessions on replacement.

**Why:** The user requires direct shared username/password access without verification loops, while keeping ordinary individual and Microsoft authentication unchanged.

**How to apply:** Deny identity linking/recovery, inherited privileged roles, non-Galaxy applications and business actions. Rotation and disabling must invalidate every old cookie and token immediately.

Do not treat an opaque-origin iframe plus restrictive fetch CSP as proof of complete uploaded-script isolation.

**Why:** Sandboxing protects the parent but does not itself prohibit the child from navigating its own frame to an external destination. Arbitrary uploaded scripts can use navigation to disclose content.

**How to apply:** Establish and browser-test a safe interaction execution strategy before enabling confidential HTML delivery; preserve the supplied proposal's business content and supported interactions without granting unrestricted uploaded JavaScript execution.

Shared access intentionally uses dedicated short-lived server-side cookies, not Galaxy OAuth access/refresh tokens. Email-shaped usernames are labels, not verified email identities.

The Galaxy credential form must accept individual and shared accounts in the same fields without asking visitors to select an account type.

**Why:** The user explicitly rejected separate login dialogs after shared credentials repeatedly reached individual sign-in.

**How to apply:** Resolve the account type on the server while preserving separate session scopes and shared-account restrictions; a unified form does not authorize unified privileges.

**Why:** Shared credentials must never become cross-application SSO credentials. Live session/account checks make revocation immediate while ordinary individual OAuth remains unchanged.

**How to apply:** Keep shared identities out of the ordinary identity loader and OAuth/recovery/linking flows. Do not add bearer issuance as a convenience without revisiting the entire audience and revocation boundary.

Confidential HTML allows only explicitly vetted script hashes; arbitrary uploaded JavaScript is rejected, not silently stripped.

**Why:** CSP and opaque origins do not stop an attacker-controlled script from navigating its own iframe to exfiltrate data. A vetted local interaction script preserves the original proposal controls without granting arbitrary execution.

**How to apply:** Review new interaction scripts before approving their hashes; preserve safe static SVG shapes, embedded raster images and local interactions. Attachment playback uses a parent-fetched Blob passed into the sandbox rather than authenticated iframe requests or bearer links.

Private proposal HTML is the primary reading experience, not a small embedded panel below Galaxy navigation. Keep audio and script controls compact inside the proposal and avoid a full transcript outside it or nested scrolling.

Most private HTML pages will not have audio; the MassHousing proposal is an exception.

**Why:** The user explicitly clarified that audio is optional, not the default page experience.

**How to apply:** Show media controls only for available attachments and keep navigation usable without any media.

**Why:** The user rejected the crowded preview and explicitly requested more screen space with attachment links inside the page.

**How to apply:** Preserve proposal content and privacy while using a single scrolling surface and authenticated attachment controls.
