---
name: Orion reporting semantics
description: Keep aggregate Orion traffic and learning activity distinct from local traffic and unique-person measures.
---

Treat Orion as the authoritative source of its traffic and activity. Central reporting should read replacement snapshots rather than accumulate overlapping aggregate responses or synthesize individual visits from them.

**Why:** The reporting feed supplies aggregate visits and activity, not stable individual pageview IDs or cross-app visitor identities. Repeated pulls and historical reconstruction must not inflate central totals. Activity events and section/resource breakdowns are dimensions of the report, not additional pageviews.

**How to apply:** Before combining Orion with another traffic feed, establish non-overlapping coverage and compatible definitions. Do not sum legacy activity aliases with newer activity breakdowns, label authentication-page visits as registrations, or call summed app visits/sessions unique people. Preserve the distinction between retained-record history and browser activity available only since expanded tracking.
