---
name: Purge link GET safety
description: Email security scanners pre-fetch all links via GET — destructive email actions must use GET=confirm + POST=execute pattern.
---

## Rule
Never make a destructive action reachable via GET when that URL is sent in an email. Email security scanners (Microsoft Defender, Google SafeBrowsing, Proofpoint, etc.) automatically follow every link in every email via GET to check for phishing/malware. A GET-triggered delete will be executed by the scanner before the user ever clicks the link.

**Why:** The briefing podcast purge link (`GET /api/briefing-podcast/purge?token=...`) immediately deleted the SPE audio file and set status=purged when hit by the email scanner. The user then clicked the audio link and got "Recording not found".

**How to apply:**
- Any link sent in an email that triggers a mutation must use the two-step pattern:
  - `GET` → renders a confirmation HTML page (scanner-safe, no side effects)
  - `POST` (form submit) → performs the actual destructive action
- This applies to: unsubscribe, delete, purge, cancel, revoke links in emails.
- The confirmation page should include a hidden `<input type="hidden" name="token" value="...">` so the POST carries the same token.
