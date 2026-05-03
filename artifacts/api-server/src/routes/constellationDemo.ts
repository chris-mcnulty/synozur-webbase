import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  applicationDemoCompletionsTable,
  db,
  hubspotSyncEventsTable,
  siteSettingsTable,
} from "@workspace/db";
import {
  CONSTELLATION_DEMO_SEED_ID,
  CONSTELLATION_DEMO_SEED_FIXTURE,
  type DemoSeed,
} from "../lib/constellationDemoSeed.js";

// Opaque per-visitor identifier dropped as a first-party cookie. We use it
// to stitch anonymous demo completions to a later self-identifying form
// submission. 6-month TTL — long enough to cover most evaluation cycles
// without becoming an unbounded tracker.
const VISITOR_COOKIE_NAME = "syn_visitor";
const VISITOR_COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 180;

// #133 — Constellation interactive demo: AI-synthesized executive narrative.
//
// The narrative is keyed by `seedId` and cached in-memory so concurrent
// visitors share a single generation per server lifetime. The cache also
// holds an in-flight Promise per key so two visitors hitting the endpoint
// at once don't both call Claude — the second visitor awaits the first
// visitor's pending request. This is the "lock by seedId" guarantee called
// out in the task brief.
//
// The cache is intentionally process-local — restarts are cheap and the
// fixture is small (one seed today). If we add per-vertical demo seeds
// later, swap in object-storage caching the same way #161 does for OG
// images.

const router: IRouter = Router();

interface NarrativePayload {
  seedId: string;
  generatedAt: string;
  paragraphs: string[];
}

interface CacheEntry {
  payload: NarrativePayload;
  expiresAt: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<NarrativePayload>>();

const KNOWN_SEEDS: Record<string, DemoSeed> = {
  [CONSTELLATION_DEMO_SEED_ID]: CONSTELLATION_DEMO_SEED_FIXTURE,
};

function buildPrompt(seed: DemoSeed): string {
  return [
    `You are Constellation, Synozur's AI Consulting Delivery Platform. Write a concise weekly executive narrative for the engagement below.`,
    ``,
    `Audience: the executive sponsor (${seed.engagement.executiveSponsor}).`,
    `Tone: confident, plainspoken, no hedging. Lead with what changed and what action is needed. Do not invent facts beyond the data given.`,
    `Format: 3 short paragraphs. No headings, no lists, no markdown.`,
    `  Paragraph 1: this week's bottom-line status and the most important thing that changed.`,
    `  Paragraph 2: the highest-priority risk and the recommended action.`,
    `  Paragraph 3: financial position and one forward-looking call-out.`,
    ``,
    `--- Engagement data (week of ${seed.weekOf}) ---`,
    `Client: ${seed.client.name} (${seed.client.industry}, ${seed.client.region})`,
    `Engagement: ${seed.engagement.name}`,
    `Phase: ${seed.engagement.phase}`,
    `Lead consultant: ${seed.engagement.leadConsultant}`,
    `Target end: ${seed.engagement.targetEndOn}`,
    ``,
    `Deliverables:`,
    ...seed.deliverables.map(
      (d) =>
        `- ${d.name} — owner ${d.owner}, due ${d.dueOn}, ${d.percentComplete}% complete, status ${d.status}${d.notes ? `; ${d.notes}` : ""}`,
    ),
    ``,
    `Risks:`,
    ...seed.risks.map(
      (r) =>
        `- [${r.severity}/${r.trend}] ${r.title}. Rationale: ${r.rationale} Recommendation: ${r.recommendation}`,
    ),
    ``,
    `Financials: contract $${seed.financials.contractValue.toLocaleString()}, burned $${seed.financials.burnedToDate.toLocaleString()}, forecast $${seed.financials.forecastAtComplete.toLocaleString()}, margin ${seed.financials.marginPct}%.`,
  ].join("\n");
}

function fallbackNarrative(seed: DemoSeed): string[] {
  // Deterministic fallback used if the AI integration is unreachable or
  // returns an empty body. Keeps the demo working in offline / test
  // environments without requiring Anthropic credentials.
  const slipping = seed.deliverables.find((d) => d.status === "slipping");
  const topRisk = seed.risks[0];
  return [
    `Week of ${seed.weekOf}: ${seed.engagement.name} is in ${seed.engagement.phase}. Two deliverables closed; ${slipping ? `the ${slipping.name} is slipping at ${slipping.percentComplete}% against a ${slipping.dueOn} due date.` : "execution is on plan."}`,
    `${topRisk.title}. ${topRisk.recommendation}`,
    `Forecast at complete is $${seed.financials.forecastAtComplete.toLocaleString()} against a $${seed.financials.contractValue.toLocaleString()} contract, holding margin at ${seed.financials.marginPct}%. Next week's focus is unblocking the persona reviews so the pilot rollout window stays intact.`,
  ];
}

async function generateNarrative(seed: DemoSeed): Promise<NarrativePayload> {
  const prompt = buildPrompt(seed);
  let paragraphs: string[];

  // Env-gated lazy import. The Anthropic client throws at module load when
  // the integration env vars are unset, so we must avoid touching it at all
  // in unprovisioned environments (preview deploys, local dev without
  // secrets, CI). When unavailable, the demo silently falls back to a
  // deterministic seed-derived narrative — that's the documented offline
  // behavior.
  const anthropicConfigured =
    !!process.env["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"] &&
    !!process.env["AI_INTEGRATIONS_ANTHROPIC_API_KEY"];
  if (!anthropicConfigured) {
    paragraphs = fallbackNarrative(seed);
    return {
      seedId: seed.id,
      generatedAt: new Date().toISOString(),
      paragraphs,
    };
  }

  try {
    const { anthropic } = await import("@workspace/integrations-anthropic-ai");
    const result = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 700,
      messages: [{ role: "user", content: prompt }],
    });
    const text = result.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();
    paragraphs = text
      ? text
          .split(/\n{2,}/)
          .map((p) => p.replace(/\s+/g, " ").trim())
          .filter((p) => p.length > 0)
      : fallbackNarrative(seed);
  } catch {
    paragraphs = fallbackNarrative(seed);
  }
  return {
    seedId: seed.id,
    generatedAt: new Date().toISOString(),
    paragraphs,
  };
}

router.get("/demos/constellation/narrative", async (req, res) => {
  const seedId = typeof req.query["seedId"] === "string" ? req.query["seedId"] : "";
  const seed = KNOWN_SEEDS[seedId];
  if (!seed) {
    res.status(404).json({ error: "Unknown seed id" });
    return;
  }

  // Cache hit?
  const now = Date.now();
  const hit = cache.get(seedId);
  if (hit && hit.expiresAt > now) {
    res.set("Cache-Control", "public, max-age=300");
    res.json({ ...hit.payload, cached: true });
    return;
  }

  // In-flight coalescing — second concurrent caller waits for the first.
  let pending = inflight.get(seedId);
  if (!pending) {
    pending = generateNarrative(seed)
      .then((payload) => {
        cache.set(seedId, { payload, expiresAt: Date.now() + CACHE_TTL_MS });
        return payload;
      })
      .finally(() => {
        inflight.delete(seedId);
      });
    inflight.set(seedId, pending);
  }

  try {
    const payload = await pending;
    res.set("Cache-Control", "public, max-age=300");
    res.json({ ...payload, cached: false });
  } catch (err) {
    req.log.error({ err, seedId }, "Constellation narrative generation failed");
    res.status(500).json({ error: "Narrative generation failed" });
  }
});

// Lightweight telemetry sink for the in-page demo. We always log a
// structured row so an analyst can grep server logs even when an ad-blocker
// has stripped the GA4 tag.
//
// When the visitor reaches `depth=full` AND has a server-verified session
// with an email on the user record (logged-in portal user via
// `attachUserIfPresent`), we also enqueue a HubSpot timeline event into
// the existing #131 sync queue. The queue worker delivers it through the
// same backoff + dead-letter machinery as form submissions; if HubSpot is
// disabled or the timeline app id isn't registered, the row is
// terminal-skipped without raising.
//
// Security note: we deliberately ignore any caller-supplied email in the
// request body. Trusting it would let an unauthenticated visitor forge
// HubSpot timeline events for arbitrary contacts. Anonymous /
// unauthenticated visitors stay log-only — that's the right behavior
// because HubSpot timeline events require a real contact, and we won't
// synthesize ghost contacts from client input.
router.post("/demos/constellation/event", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const kind = typeof body["kind"] === "string" ? body["kind"] : null;
  const step = typeof body["step"] === "string" ? body["step"] : null;
  const depth = typeof body["depth"] === "string" ? body["depth"] : "partial";
  const path = typeof body["path"] === "string" ? body["path"] : null;
  // Per-session client-generated UUID. Used to dedupe `demo_completed_full`
  // across retries / network races / page refreshes. Bounded length so a
  // hostile caller can't push 1MB strings into our unique index.
  const rawCompletionId = typeof body["completionId"] === "string" ? body["completionId"] : "";
  const completionId =
    rawCompletionId.length >= 8 && rawCompletionId.length <= 64 ? rawCompletionId : null;
  // Server-verified email from the authed session only. We do not read any
  // email field off the request body.
  const sessionEmail = req.authedUser?.email ?? null;
  const contactEmail =
    sessionEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sessionEmail)
      ? sessionEmail.toLowerCase()
      : null;
  if (!kind) {
    res.status(400).json({ error: "kind is required" });
    return;
  }
  req.log.info(
    {
      event: "synozur_application_demo_requested",
      app: "constellation",
      kind,
      step,
      depth,
      path,
      hasContact: contactEmail !== null,
    },
    "constellation demo telemetry",
  );

  // Depth=full path. Two outcomes depending on whether the visitor is
  // server-authed: either persist as anonymous (so we can flush later via
  // the contact-form path) or enqueue a HubSpot timeline event right
  // away. Both branches are gated by `kind === "demo_completed_full"` and
  // a `completionId` UUID so step navigation can never accidentally fire
  // a high-intent event, and any retry / refresh / re-mount with the same
  // UUID is a no-op via the UNIQUE index on `completion_id`.
  if (depth === "full" && kind === "demo_completed_full" && completionId) {
    try {
      let visitorId =
        typeof req.cookies?.[VISITOR_COOKIE_NAME] === "string"
          ? (req.cookies[VISITOR_COOKIE_NAME] as string)
          : null;
      if (!visitorId || visitorId.length < 8 || visitorId.length > 64) {
        visitorId = randomUUID();
        res.cookie(VISITOR_COOKIE_NAME, visitorId, {
          httpOnly: true,
          sameSite: "lax",
          secure: req.secure || req.protocol === "https",
          maxAge: VISITOR_COOKIE_MAX_AGE_MS,
          path: "/",
        });
      }
      // Insert and rely on ON CONFLICT (completion_id) to dedupe. The
      // returning clause tells us whether this was a fresh completion or
      // a retry; only fresh completions are forwarded to HubSpot for
      // authed sessions. For anonymous, the row stays pending until the
      // visitor identifies via a contact form (see
      // `flushPendingDemoCompletionsForVisitor`).
      // Insert the completion row first WITHOUT setting `syncedAt`, so a
      // failed HubSpot enqueue doesn't strand the row in a "synced" state
      // that the visitor-identification flush path will subsequently skip.
      // Only flip `syncedAt` once the queue insert has succeeded.
      const inserted = await db
        .insert(applicationDemoCompletionsTable)
        .values({
          app: "constellation",
          visitorId,
          step,
          path,
          completionId,
        })
        .onConflictDoNothing({
          target: applicationDemoCompletionsTable.completionId,
        })
        .returning({ id: applicationDemoCompletionsTable.id });

      if (inserted.length > 0 && contactEmail) {
        const settings = await db.query.siteSettingsTable.findFirst({
          where: eq(siteSettingsTable.id, 1),
        });
        if (settings?.hubspotEnabled === true) {
          await db.insert(hubspotSyncEventsTable).values({
            kind: "timeline.synozur_application_demo_requested",
            contactEmail,
            payload: {
              app: "constellation",
              depth: "full",
              completionId,
              tokens: {
                app: "constellation",
                depth: "full",
                completion_id: completionId,
                completed_step: step ?? "complete",
                landing_path: path ?? null,
              },
            },
          });
          await db
            .update(applicationDemoCompletionsTable)
            .set({ syncedAt: new Date() })
            .where(eq(applicationDemoCompletionsTable.id, inserted[0]!.id));
        }
      }
    } catch (err) {
      // Never fail the telemetry endpoint on a queue/persist error — the
      // structured log above is the durable record.
      req.log.warn({ err }, "constellation demo completion persist failed");
    }
  }

  res.status(204).end();
});

export default router;
