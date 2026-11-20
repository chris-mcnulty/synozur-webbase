---
name: Orion reporting semantics
description: Keep aggregate Orion traffic and learning activity distinct from local traffic and unique-person measures.
---

Treat Orion as the authoritative source of its traffic and activity. Central reporting should read replacement snapshots rather than accumulate overlapping aggregate responses or synthesize individual visits from them.

**Why:** The reporting feed supplies aggregate visits and activity, not stable individual pageview IDs or cross-app visitor identities. Repeated pulls and historical reconstruction must not inflate central totals. Activity events and section/resource breakdowns are dimensions of the report, not additional pageviews.

**How to apply:** Before combining Orion with another traffic feed, establish non-overlapping coverage and compatible definitions. Do not sum legacy activity aliases with newer activity breakdowns, label authentication-page visits as registrations, or call summed app visits/sessions unique people. Preserve the distinction between retained-record history and browser activity available only since expanded tracking.

Annual sessions for Core and All properties are primary marketing metrics. The user explicitly approved Orion visits as sessions for this reporting purpose: “visits are fine as sessions.” WWW should remain the hero and default property; Orion belongs in the shared property selector, with its detailed activity available without dominating the overview.

**Why:** The user tracks annual Core and All sessions and wants a unified marketing report rather than a separate Orion dashboard.

**How to apply:** Include Orion's authoritative visit total once in the marketing Sessions measure, with a brief definition. Do not substitute activity counts, imply cross-property unique people, or hide failed/stale coverage behind a complete-looking total. Keep unavailable duration and unique-user metrics distinct.

Wix was WWW until midyear. Historical Wix traffic and current WWW tracking represent the same Core website, not separate business properties.

**Why:** The user explicitly corrected Core reporting that excluded the site's Wix history.

**How to apply:** Group Wix history with current Synozur tracking under WWW/Core in default and annual reporting. Retain source provenance only for optional diagnostics. The user identified June 30 as the WWW cutover date. Check overlapping migration coverage before summing; a calendar date alone does not establish transition-day ownership or an exact timestamp.
