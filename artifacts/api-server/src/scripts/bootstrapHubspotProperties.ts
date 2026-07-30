/**
 * #131 — Bootstrap Synozur custom contact properties + timeline event
 * templates on the HubSpot portal.
 *
 * Run once per portal (and again whenever this script is updated to add
 * new properties / templates). Idempotent: PUTs are skipped when an
 * existing definition matches; differences fall through to a PATCH.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server exec \
 *     tsx src/scripts/bootstrapHubspotProperties.ts
 *
 *   # Apply (default is dry-run — print what would change without writing)
 *   pnpm --filter @workspace/api-server exec \
 *     tsx src/scripts/bootstrapHubspotProperties.ts -- --apply
 *
 *   # Restrict to one phase
 *   ... -- --apply --only=properties
 *   ... -- --apply --only=events
 *
 * Requires either the Replit `hubspot` connector to be configured, or a
 * static `HUBSPOT_ACCESS_TOKEN` env var. Timeline-event registration also
 * requires `HUBSPOT_TIMELINE_APP_ID` (the numeric Public-App id that owns
 * the custom event types).
 */
import { ReplitConnectors } from "@replit/connectors-sdk";

// CLI flags. The named runner below (`runHubspotBootstrap`) overrides
// these via parameters so the function can be called from the api-server
// startup hook without simulating argv.
const APPLY_FROM_CLI = process.argv.includes("--apply");
const ONLY_FROM_CLI = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
let APPLY = APPLY_FROM_CLI;
let ONLY: string | undefined = ONLY_FROM_CLI;

const HUBSPOT_API = "https://api.hubapi.com";
const REPLIT_CONNECTORS_AVAILABLE = !!process.env["REPLIT_CONNECTORS_HOSTNAME"];

interface SimpleInit {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
}

async function hubspotProxy(path: string, init: SimpleInit = {}): Promise<Response> {
  const baseHeaders: Record<string, string> = {
    ...(init.headers ?? {}),
    ...(init.body ? { "Content-Type": "application/json" } : {}),
  };
  if (REPLIT_CONNECTORS_AVAILABLE) {
    const connectors = new ReplitConnectors();
    return connectors.proxy("hubspot", path, {
      method: init.method,
      body: init.body,
      headers: baseHeaders,
    }) as Promise<Response>;
  }
  const token = process.env["HUBSPOT_ACCESS_TOKEN"];
  if (!token) throw new Error("No HubSpot access token (set HUBSPOT_ACCESS_TOKEN or configure the Replit connector)");
  return fetch(`${HUBSPOT_API}${path}`, {
    method: init.method,
    body: init.body,
    headers: { ...baseHeaders, Authorization: `Bearer ${token}` },
  });
}

// ---------------------------------------------------------------------------
// Custom contact properties
// ---------------------------------------------------------------------------

interface PropertyDefinition {
  name: string;
  label: string;
  type: "string" | "enumeration" | "number" | "bool";
  fieldType: "text" | "textarea" | "select" | "number" | "booleancheckbox";
  groupName: string;
  description: string;
  options?: Array<{ label: string; value: string; displayOrder?: number }>;
}

const PROPERTY_GROUP = "synozur";

const PROPERTIES: PropertyDefinition[] = [
  {
    name: "synozur_form_type",
    label: "Synozur — Last form submitted",
    type: "string",
    fieldType: "text",
    groupName: PROPERTY_GROUP,
    description: "Most recent form on synozur.com that this contact submitted (contact, subscribe, start, white-paper, webinar, partner).",
  },
  {
    name: "synozur_marketing_opt_in",
    label: "Synozur — Marketing opt-in",
    type: "enumeration",
    fieldType: "select",
    groupName: PROPERTY_GROUP,
    description: "Whether the contact gave explicit consent to marketing communications when they submitted the form.",
    options: [
      { label: "Yes", value: "true", displayOrder: 0 },
      { label: "No", value: "false", displayOrder: 1 },
    ],
  },
  {
    name: "synozur_first_seen_url",
    label: "Synozur — First seen URL",
    type: "string",
    fieldType: "text",
    groupName: PROPERTY_GROUP,
    description: "Landing URL captured the first time this visitor was identified on synozur.com.",
  },
  {
    name: "synozur_audience_class",
    label: "Synozur — Audience class",
    type: "enumeration",
    fieldType: "select",
    groupName: PROPERTY_GROUP,
    description: "Coarse segmentation derived from form context and engagement (executive, practitioner, partner, candidate, other).",
    options: [
      { label: "Executive", value: "executive", displayOrder: 0 },
      { label: "Practitioner", value: "practitioner", displayOrder: 1 },
      { label: "Partner", value: "partner", displayOrder: 2 },
      { label: "Candidate", value: "candidate", displayOrder: 3 },
      { label: "Other", value: "other", displayOrder: 4 },
    ],
  },
  {
    name: "synozur_engagement_score",
    label: "Synozur — Engagement score",
    type: "number",
    fieldType: "number",
    groupName: PROPERTY_GROUP,
    description: "Rolling engagement score (0-100) computed from web events and form submissions.",
  },
  {
    name: "synozur_hubspotutk",
    label: "Synozur — HubSpot tracking cookie",
    type: "string",
    fieldType: "text",
    groupName: PROPERTY_GROUP,
    description: "Most recent `hubspotutk` cookie value seen at form submit. Lets HubSpot stitch the contact to their pre-form anonymous activity.",
  },
];

interface HubspotPropertyResponse {
  name?: string;
  label?: string;
  type?: string;
  fieldType?: string;
  description?: string;
  options?: Array<{ label?: string; value?: string }>;
}

async function ensurePropertyGroup(): Promise<void> {
  const get = await hubspotProxy(`/crm/v3/properties/contacts/groups/${PROPERTY_GROUP}`);
  if (get.ok) return;
  if (get.status !== 404) {
    const text = await get.text();
    throw new Error(`Failed to read property group: ${get.status} ${text.slice(0, 200)}`);
  }
  if (!APPLY) {
    console.log(`  [dry-run] would create property group '${PROPERTY_GROUP}'`);
    return;
  }
  const res = await hubspotProxy(`/crm/v3/properties/contacts/groups`, {
    method: "POST",
    body: JSON.stringify({
      name: PROPERTY_GROUP,
      label: "Synozur",
      displayOrder: -1,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create property group: ${res.status} ${text.slice(0, 200)}`);
  }
  console.log(`  ✓ created property group '${PROPERTY_GROUP}'`);
}

async function ensureProperty(p: PropertyDefinition): Promise<"created" | "updated" | "ok" | "dry-run"> {
  const get = await hubspotProxy(`/crm/v3/properties/contacts/${p.name}`);
  if (get.ok) {
    const existing = (await get.json()) as HubspotPropertyResponse;
    const matches =
      existing.label === p.label &&
      existing.type === p.type &&
      existing.fieldType === p.fieldType &&
      existing.description === p.description;
    if (matches) return "ok";
    if (!APPLY) {
      console.log(`  [dry-run] would update property '${p.name}'`);
      return "dry-run";
    }
    const patchBody: Record<string, unknown> = {
      label: p.label,
      description: p.description,
      groupName: p.groupName,
    };
    if (p.options) patchBody["options"] = p.options;
    const res = await hubspotProxy(`/crm/v3/properties/contacts/${p.name}`, {
      method: "PATCH",
      body: JSON.stringify(patchBody),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to update property ${p.name}: ${res.status} ${text.slice(0, 200)}`);
    }
    return "updated";
  }
  if (get.status !== 404) {
    const text = await get.text();
    throw new Error(`Failed to read property ${p.name}: ${get.status} ${text.slice(0, 200)}`);
  }
  if (!APPLY) {
    console.log(`  [dry-run] would create property '${p.name}'`);
    return "dry-run";
  }
  const body: Record<string, unknown> = {
    name: p.name,
    label: p.label,
    type: p.type,
    fieldType: p.fieldType,
    groupName: p.groupName,
    description: p.description,
  };
  if (p.options) body["options"] = p.options;
  const res = await hubspotProxy(`/crm/v3/properties/contacts`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create property ${p.name}: ${res.status} ${text.slice(0, 200)}`);
  }
  return "created";
}

// ---------------------------------------------------------------------------
// Custom timeline event templates
// ---------------------------------------------------------------------------

interface TimelineEventTemplateDefinition {
  name: string;
  headerTemplate: string;
  detailTemplate: string;
  tokens: Array<{ name: string; type: "string" | "number" | "enumeration"; label: string }>;
}

const EVENT_TEMPLATES: TimelineEventTemplateDefinition[] = [
  {
    name: "synozur_form_submitted",
    headerTemplate: "Submitted the {{form_type}} form on synozur.com",
    detailTemplate: "Source: {{utm_source}} / {{utm_medium}} · Campaign: {{utm_campaign}} · Landing: {{landing_page}}",
    tokens: [
      { name: "form_type", type: "string", label: "Form type" },
      { name: "utm_source", type: "string", label: "UTM source" },
      { name: "utm_medium", type: "string", label: "UTM medium" },
      { name: "utm_campaign", type: "string", label: "UTM campaign" },
      { name: "landing_page", type: "string", label: "Landing page" },
    ],
  },
  {
    name: "synozur_white_paper_downloaded",
    headerTemplate: "Downloaded a white paper: {{title}}",
    detailTemplate: "Slug: {{slug}} · Source: {{utm_source}} / {{utm_medium}}",
    tokens: [
      { name: "title", type: "string", label: "White paper title" },
      { name: "slug", type: "string", label: "White paper slug" },
      { name: "utm_source", type: "string", label: "UTM source" },
      { name: "utm_medium", type: "string", label: "UTM medium" },
    ],
  },
  {
    name: "synozur_webinar_registered",
    headerTemplate: "Registered for webinar: {{title}}",
    detailTemplate: "Starts {{starts_at}} · Source: {{utm_source}} / {{utm_medium}}",
    tokens: [
      { name: "title", type: "string", label: "Webinar title" },
      { name: "starts_at", type: "string", label: "Webinar start" },
      { name: "utm_source", type: "string", label: "UTM source" },
      { name: "utm_medium", type: "string", label: "UTM medium" },
    ],
  },
  {
    name: "synozur_application_demo_requested",
    headerTemplate: "Requested an application demo: {{application}}",
    detailTemplate: "Depth: {{depth}} · Source: {{utm_source}} / {{utm_medium}}",
    tokens: [
      { name: "application", type: "string", label: "Application" },
      { name: "depth", type: "string", label: "Depth" },
      { name: "utm_source", type: "string", label: "UTM source" },
      { name: "utm_medium", type: "string", label: "UTM medium" },
    ],
  },
  {
    name: "synozur_newsletter_subscribed",
    headerTemplate: "Subscribed to the Synozur newsletter",
    detailTemplate: "Source: {{utm_source}} / {{utm_medium}} · Landing: {{landing_page}}",
    tokens: [
      { name: "utm_source", type: "string", label: "UTM source" },
      { name: "utm_medium", type: "string", label: "UTM medium" },
      { name: "landing_page", type: "string", label: "Landing page" },
    ],
  },
  {
    name: "synozur_get_started_submitted",
    headerTemplate: "Submitted the Get Started form",
    detailTemplate: "Source: {{utm_source}} / {{utm_medium}} · Landing: {{landing_page}}",
    tokens: [
      { name: "utm_source", type: "string", label: "UTM source" },
      { name: "utm_medium", type: "string", label: "UTM medium" },
      { name: "landing_page", type: "string", label: "Landing page" },
    ],
  },
  {
    name: "synozur_event_registered",
    headerTemplate: "Registered for event: {{event_title}}",
    detailTemplate: "Slug: {{event_slug}} · Company: {{company}} · Title: {{job_title}}",
    tokens: [
      { name: "event_title", type: "string", label: "Event title" },
      { name: "event_slug", type: "string", label: "Event slug" },
      { name: "company", type: "string", label: "Company" },
      { name: "job_title", type: "string", label: "Job title" },
    ],
  },
];

interface TimelineEventTemplate {
  id?: string;
  name?: string;
  headerTemplate?: string;
  detailTemplate?: string;
  tokens?: Array<{ name?: string; type?: string; label?: string }>;
}

async function listTimelineTemplates(appId: string): Promise<TimelineEventTemplate[]> {
  const res = await hubspotProxy(`/crm/v3/timeline/${encodeURIComponent(appId)}/event-templates`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to list timeline templates: ${res.status} ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { results?: TimelineEventTemplate[] };
  return json.results ?? [];
}

async function ensureTimelineTemplate(
  appId: string,
  def: TimelineEventTemplateDefinition,
  existing: TimelineEventTemplate[],
): Promise<"created" | "updated" | "ok" | "dry-run"> {
  const found = existing.find((t) => t.name === def.name);
  const body = {
    name: def.name,
    objectType: "contacts",
    headerTemplate: def.headerTemplate,
    detailTemplate: def.detailTemplate,
    tokens: def.tokens,
  };
  if (!found) {
    if (!APPLY) {
      console.log(`  [dry-run] would create timeline template '${def.name}'`);
      return "dry-run";
    }
    const res = await hubspotProxy(`/crm/v3/timeline/${encodeURIComponent(appId)}/event-templates`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to create timeline template ${def.name}: ${res.status} ${text.slice(0, 200)}`);
    }
    return "created";
  }
  const matches =
    found.headerTemplate === def.headerTemplate &&
    found.detailTemplate === def.detailTemplate;
  if (matches) return "ok";
  if (!APPLY) {
    console.log(`  [dry-run] would update timeline template '${def.name}'`);
    return "dry-run";
  }
  const res = await hubspotProxy(
    `/crm/v3/timeline/${encodeURIComponent(appId)}/event-templates/${encodeURIComponent(found.id ?? "")}`,
    {
      method: "PUT",
      body: JSON.stringify({
        headerTemplate: def.headerTemplate,
        detailTemplate: def.detailTemplate,
        name: def.name,
      }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to update timeline template ${def.name}: ${res.status} ${text.slice(0, 200)}`);
  }
  return "updated";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// #131 — Reusable runner so the api-server can invoke the bootstrap
// idempotently on first deploy / startup as well as via the CLI.
export async function runHubspotBootstrap(opts?: {
  apply?: boolean;
  only?: "properties" | "events";
}): Promise<void> {
  if (opts?.apply !== undefined) APPLY = opts.apply;
  if (opts?.only !== undefined) ONLY = opts.only;
  await main();
}

async function main(): Promise<void> {
  console.log(`HubSpot bootstrap (apply=${APPLY})`);
  if (!APPLY) {
    console.log("(dry-run) — pass --apply to write changes to the portal\n");
  }

  if (!ONLY || ONLY === "properties") {
    console.log("Phase 1: contact properties");
    await ensurePropertyGroup();
    for (const p of PROPERTIES) {
      const result = await ensureProperty(p);
      const marker = result === "ok" ? "·" : result === "dry-run" ? "?" : "✓";
      console.log(`  ${marker} ${p.name.padEnd(34)} (${result})`);
    }
    console.log();
  }

  if (!ONLY || ONLY === "events") {
    console.log("Phase 2: timeline event templates");
    const appId = process.env["HUBSPOT_TIMELINE_APP_ID"];
    if (!appId) {
      console.log("  (skipped) — set HUBSPOT_TIMELINE_APP_ID to register custom timeline events");
    } else {
      const existing = APPLY ? await listTimelineTemplates(appId) : [];
      for (const def of EVENT_TEMPLATES) {
        const result = await ensureTimelineTemplate(appId, def, existing);
        const marker = result === "ok" ? "·" : result === "dry-run" ? "?" : "✓";
        console.log(`  ${marker} ${def.name.padEnd(34)} (${result})`);
      }
    }
  }

  console.log("\nDone.");
}

// Only auto-run when invoked directly (e.g. `tsx src/scripts/...`).
// NOTE: import.meta.url is NOT reliable inside an esbuild bundle —
// every module in the bundle shares the same URL (the entry point).
// Instead we check process.argv[1] for the script's own filename,
// which is only present when the script is invoked via tsx directly.
const isDirectRun = Boolean(process.argv[1]?.includes("bootstrapHubspotProperties"));
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
