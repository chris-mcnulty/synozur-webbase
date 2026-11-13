---
name: Crawler test request semantics
description: Why changing a fetch User-Agent does not reproduce a raw crawler request.
---

Crawler visibility tests must reproduce navigation headers, not just the User-Agent.

**Why:** Node's fetch adds `Sec-Fetch-Mode: cors` to requests, including synthetic curl User-Agents. Tests using fetch can therefore exercise the browser fallback rather than the raw HTTP crawler path; supplying an empty value did not reproduce a headerless request reliably.

**How to apply:** Use raw HTTP requests for tests that depend on the absence of browser navigation headers. Use real browser requests separately to verify SPA routing and private authentication state.
