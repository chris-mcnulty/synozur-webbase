---
name: Graph Bookings staff assignment
description: Graph-created Bookings appointments are unassigned unless staffMemberIds is sent; how the native flow resolves staff.
---

**Rule:** `POST /solutions/bookingBusinesses/{id}/appointments` creates an UNASSIGNED appointment when `staffMemberIds` is omitted — the customer gets a confirmation but no staff member is booked or invited. The hosted Bookings page always assigns staff internally; the Graph API never does it for you.

**Why:** Live bug (July 2026): meetings booked through the native on-site flow were confirmed to attendees but no Synozur staff got the invite; direct Bookings-page bookings worked fine.

**How to apply:** The appointment route re-resolves availability at booking time (window widened ±24h around the slot — the availability walker's clip check excludes windows exactly equal to the slot duration), matches the slot by start+end instant, and picks one free staff member at random. If resolution fails it logs a warning and books unassigned (booking completion preferred over failing). Watch server logs for "creating unassigned appointment" warnings if the symptom recurs.
