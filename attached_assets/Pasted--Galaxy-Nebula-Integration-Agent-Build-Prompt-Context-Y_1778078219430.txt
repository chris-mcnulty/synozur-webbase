# Galaxy × Nebula Integration — Agent Build Prompt

## Context

You are building the **Galaxy** side of a server-to-server integration with **Nebula**, Synozur's multi-tenant collaborative envisioning platform. Nebula exposes a read-only REST API that Galaxy must consume to display completed envisioning reports, a workspace directory, and related client data inside the Galaxy client portal.

This document is fully self-contained. Everything you need — authentication, endpoint contracts, response shapes, error codes, and what to build — is described here.

---

## 1. Authentication

All Nebula Galaxy API endpoints use **Bearer token** authentication.

```
Authorization: Bearer nebula_<48 hex characters>
```

**Key facts:**
- Keys are issued per-organisation by a Nebula company admin through the Nebula Admin Panel → API Keys tab.
- A key is scoped to exactly one Nebula organisation. It cannot read data from any other organisation.
- Keys are never rotated automatically; Galaxy should store the key securely as an environment secret (`NEBULA_API_KEY`).
- If the key is missing, empty, or revoked, every endpoint returns `401`.

**Recommended Galaxy implementation:**
- Store the key in an environment variable: `NEBULA_API_KEY`
- Store the Nebula base URL: `NEBULA_BASE_URL` (e.g. `https://nebula.synozur.com`)
- Create a single shared HTTP client/helper that injects `Authorization: Bearer ${NEBULA_API_KEY}` on every request to `NEBULA_BASE_URL/api/galaxy/*`.

---

## 2. Endpoints

Base path: `{NEBULA_BASE_URL}/api/galaxy`

All responses are `Content-Type: application/json`.

---

### 2.1 List Completed Reports

```
GET /api/galaxy/reports
```

Returns a **paginated list** of closed workspaces that have a completed AI-generated cohort report. Only workspaces in `status: "closed"` with at least one generated report are included.

#### Query parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | integer | `1` | Page number (1-based) |
| `limit` | integer | `20` | Results per page (max 100) |
| `domain` | string | — | Optional. Filter to workspaces whose organisation's primary or allowed email domain matches this value (e.g. `acme.com`). Returns empty `data: []` if the key's org does not own that domain. |

#### Success response `200`

```jsonc
{
  "data": [
    {
      "spaceId": "clx...",            // Nebula internal workspace ID
      "name": "Q1 Strategy Session",  // Human-readable workspace name
      "code": "1234-5678",            // 8-digit join code (nnnn-nnnn)
      "closedAt": "2025-03-15T14:22:00.000Z",     // ISO 8601, when workspace was closed
      "reportGeneratedAt": "2025-03-15T15:01:00.000Z",  // ISO 8601, when report was generated
      "summarySnippet": "Participants converged on three main themes..."  // First 200 chars of AI summary
    }
    // ... more items
  ],
  "page": 1,
  "limit": 20,
  "total": 47   // Total count (before pagination)
}
```

Results are sorted by `reportGeneratedAt` descending (most recent first).

#### Error responses

| Status | Meaning |
|--------|---------|
| `400` | `domain` query param is malformed |
| `401` | Missing, invalid, or revoked API key |
| `500` | Internal server error |

---

### 2.2 Get Full Report

```
GET /api/galaxy/reports/:spaceId
```

Returns the complete cohort result for one workspace. The `:spaceId` is the `spaceId` field from the list endpoint.

No query parameters.

#### Success response `200`

```jsonc
{
  "spaceId": "clx...",
  "name": "Q1 Strategy Session",
  "code": "1234-5678",
  "status": "closed",
  "closedAt": "2025-03-15T14:22:00.000Z",  // null if not closed

  // AI-generated content (all fields may be null if not generated)
  "summary": "The session surfaced strong alignment around...",
  "keyThemes": ["Innovation", "Cost reduction", "Talent"],  // string[] | null
  "topIdeas": [                            // top-ranked ideas | null
    { "content": "Adopt AI-assisted onboarding", "score": 0.94 }
  ],
  "insights": "Participants with cross-functional roles ...",     // string | null
  "recommendations": "Focus first on the top three ideas...",    // string | null

  // Idea breakdown by category
  "categoryBreakdown": [
    {
      "id": "cat_abc",
      "name": "Innovation",
      "color": "#7C3AED",
      "noteCount": 12,
      "notes": [
        { "id": "note_xyz", "content": "Adopt AI-assisted onboarding" }
        // ... more notes
      ]
    }
    // ... more categories
  ],

  "uncategorisedNoteCount": 3,   // Ideas not assigned to any category
  "generatedAt": "2025-03-15T15:01:00.000Z"
}
```

#### Error responses

| Status | Meaning |
|--------|---------|
| `401` | Missing, invalid, or revoked API key |
| `403` | The workspace exists but belongs to a different organisation |
| `404` | Workspace not found, or no cohort report has been generated yet |
| `500` | Internal server error |

---

### 2.3 List Workspaces

```
GET /api/galaxy/workspaces
```

Returns all non-template workspaces for the key's organisation, sorted by `createdAt` descending.

#### Query parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `domain` | string | — | Optional. Same domain-filter semantics as `/reports`. |

#### Success response `200`

```jsonc
{
  "data": [
    {
      "id": "clx...",
      "name": "Q1 Strategy Session",
      "code": "1234-5678",
      "status": "active",    // "active" | "closed" | "archived"
      "url": "https://nebula.synozur.com/workspace/1234-5678",  // Direct deep-link
      "createdAt": "2025-03-10T09:00:00.000Z"
    }
    // ... more workspaces
  ]
}
```

Note: this list is **not paginated** — all workspaces are returned. If an organisation has thousands of workspaces, add client-side filtering.

#### Error responses

| Status | Meaning |
|--------|---------|
| `400` | `domain` query param is malformed |
| `401` | Missing, invalid, or revoked API key |
| `500` | Internal server error |

---

## 3. What Galaxy Should Build

### 3.1 Server-side Nebula client

Create a server-side module (not called from the browser — the API key must never be exposed to the client) that wraps all three endpoints. Suggested file: `server/lib/nebula.ts` (or equivalent for your stack).

```typescript
// Pseudocode — adapt to your language/framework

const NEBULA_BASE = process.env.NEBULA_BASE_URL;   // e.g. https://nebula.synozur.com
const NEBULA_KEY  = process.env.NEBULA_API_KEY;    // nebula_<48 hex>

async function nebulaFetch(path: string, params?: Record<string, string>) {
  const url = new URL(`${NEBULA_BASE}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${NEBULA_KEY}` },
  });
  if (!res.ok) throw new Error(`Nebula API error ${res.status}: ${await res.text()}`);
  return res.json();
}

export const nebula = {
  listReports: (params?) => nebulaFetch("/api/galaxy/reports", params),
  getReport:   (spaceId: string) => nebulaFetch(`/api/galaxy/reports/${spaceId}`),
  listWorkspaces: (params?) => nebulaFetch("/api/galaxy/workspaces", params),
};
```

### 3.2 Environment variables required

Add these to your Galaxy Replit Secrets:

| Secret | Example value | Notes |
|--------|--------------|-------|
| `NEBULA_BASE_URL` | `https://nebula.synozur.com` | No trailing slash |
| `NEBULA_API_KEY` | `nebula_a3f9...` | Issued from Nebula Admin → API Keys |

### 3.3 Pages / UI to build

#### Reports portal (`/reports` or `/client/reports`)
- Call `GET /api/galaxy/reports` on the server and pass the data to the page.
- Show a list/table of completed reports: workspace name, closed date, report date, and summary snippet.
- Each row links to a detail page.
- Support pagination using the `page` and `limit` params.

#### Report detail (`/reports/:spaceId`)
- Call `GET /api/galaxy/reports/:spaceId` on the server.
- Display:
  - AI summary (full text)
  - Key themes (as tags/badges)
  - Top ideas (ranked list)
  - Insights and recommendations sections
  - Category breakdown: expandable sections per category, each showing its ideas
  - A "View in Nebula" button linking to the workspace `url` (get this from the workspaces endpoint or construct it as `NEBULA_BASE_URL/workspace/<code>`)
- Handle the `404` case gracefully (report not generated yet).

#### Workspace directory (`/workspaces`)
- Call `GET /api/galaxy/workspaces` on the server.
- Show a filterable list/table: name, join code, status badge, creation date, and a direct link (the `url` field) to open the workspace in Nebula.
- Status values and suggested badge colours: `active` → green, `closed` → grey, `archived` → amber.

### 3.4 Error handling

| Nebula response | Galaxy should do |
|----------------|-----------------|
| `401` | Log the error server-side; show the user a "Data unavailable — contact your administrator" message. Do not expose the API key error detail to the browser. |
| `403` | Log server-side; show "You do not have access to this report." |
| `404` | Show "Report not yet generated" or "Workspace not found." |
| `500` | Show a generic retry message; do not surface internal Nebula error strings. |
| Network timeout | Implement a 10-second fetch timeout; show a retry button in the UI. |

### 3.5 Caching recommendation

The Nebula API has no built-in caching layer. To avoid hammering Nebula on every Galaxy page load:
- Cache `listReports` and `listWorkspaces` responses for **60 seconds** (short TTL keeps data fresh enough).
- Cache individual `getReport` responses for **5 minutes** (report content only changes when a facilitator regenerates it).
- Use your existing caching layer (Redis, in-memory, or stale-while-revalidate on the server).

---

## 4. Domain Filtering (optional use)

The `?domain=acme.com` query parameter on both `/reports` and `/workspaces` is available if Galaxy needs to further scope results by email domain. This is useful if a single Galaxy instance serves multiple client accounts and the API key belongs to a parent/umbrella organisation.

If Galaxy issues one API key per client organisation (recommended), domain filtering is not needed.

---

## 5. Key Format Reference

All Nebula API keys have the format:

```
nebula_<48 lowercase hex characters>
```

Example: `nebula_a3f9c2d8e1b04f7a92c6d5e8f3b2a1c9d4e7f0b3a2c1d8e9f6b5a4c3d2e1f0`

Total length: 55 characters (`nebula_` = 7 + 48 hex = 55).

If the key in your secrets does not start with `nebula_`, it is wrong — contact the Nebula administrator to generate a new one.

---

## 6. Testing the Integration

Before building the UI, verify the integration is working with a quick server-side smoke test:

```bash
# Replace with your actual values
curl -s \
  -H "Authorization: Bearer nebula_<your key>" \
  "https://nebula.synozur.com/api/galaxy/workspaces" \
  | jq .

# Should return { "data": [ ... ] }
# 401 means the key is wrong or revoked
# Connection refused means NEBULA_BASE_URL is wrong
```

---

## 7. What Nebula Will Never Expose via This API

For clarity — these are explicitly out of scope and will not be added to the Galaxy API without a separate agreement:

- Individual participant (user) names or emails
- Per-participant personalised results
- Real-time WebSocket data
- Write operations (creating workspaces, adding ideas, etc.)
- Facilitator-only analytics (Pulse, pairwise vote tallies)
