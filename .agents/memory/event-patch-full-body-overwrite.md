---
name: Event PATCH full-body overwrite
description: Admin events PATCH historically wiped omitted fields; registration fields now preserve stored values.
---
The admin events update route validates a full body and used to coerce omitted `registrationStatus` to `UNKNOWN_REGISTRATION_STATUS` (hiding the public Register button) and null out `registrationUrl`.

**Why:** Audit log showed real events silently downgraded whenever any client PATCHed without those fields; edit-wedge intentionally disables inline patch for events for this reason.

**How to apply:** Registration fields on the events PATCH now fall back to the `before` row when omitted/falsy; an explicit `UNKNOWN_REGISTRATION_STATUS` still clears. Other optional fields (`eventType`, `status`, `location`, etc.) still default-overwrite — if adding new PATCH clients or fields, preserve-when-omitted is the intended semantic. Check prod rows for stale UNKNOWN statuses on events that have a registration URL.
