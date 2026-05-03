import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  applicationDemoCompletionsTable,
  hubspotSyncEventsTable,
  siteSettingsTable,
} from "@workspace/db";
import { logger } from "./logger.js";

// #133 — When an anonymous visitor completes a depth=full demo, we persist
// the completion to `application_demo_completions` keyed by their opaque
// `syn_visitor` cookie. Later, when they self-identify via a contact-form
// submission carrying the same cookie, the form route calls this helper to
// flush every pending completion into the existing HubSpot sync queue,
// attached to the now-known contact email. The result is that the
// marketing funnel sees the prior demo engagement as a real timeline event
// the moment the visitor identifies themselves — without us ever
// synthesizing a ghost contact from client-supplied input.
//
// Returns the number of completions flushed (or 0 if HubSpot is disabled,
// no visitor cookie was supplied, or no pending rows existed). Errors are
// swallowed and logged; never let a flush failure break the form
// submission flow.
export async function flushPendingDemoCompletionsForVisitor(args: {
  visitorId: string | null | undefined;
  email: string | null | undefined;
}): Promise<number> {
  const { visitorId, email } = args;
  if (!visitorId || !email) return 0;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 0;

  try {
    const settings = await db.query.siteSettingsTable.findFirst({
      where: eq(siteSettingsTable.id, 1),
    });
    if (settings?.hubspotEnabled !== true) return 0;

    const pending = await db.query.applicationDemoCompletionsTable.findMany({
      where: and(
        eq(applicationDemoCompletionsTable.visitorId, visitorId),
        isNull(applicationDemoCompletionsTable.syncedAt),
      ),
    });
    if (pending.length === 0) return 0;

    const normalizedEmail = email.toLowerCase();
    let flushed = 0;
    for (const row of pending) {
      try {
        await db.insert(hubspotSyncEventsTable).values({
          kind: "timeline.synozur_application_demo_requested",
          contactEmail: normalizedEmail,
          payload: {
            app: row.app,
            depth: "full",
            tokens: {
              app: row.app,
              depth: "full",
              completed_step: row.step ?? "complete",
              landing_path: row.path ?? null,
              completed_at: row.completedAt.toISOString(),
              source: "anonymous_to_identified",
            },
          },
        });
        await db
          .update(applicationDemoCompletionsTable)
          .set({ syncedAt: new Date() })
          .where(eq(applicationDemoCompletionsTable.id, row.id));
        flushed += 1;
      } catch (err) {
        logger.warn(
          { err, completionId: row.id },
          "application demo completion flush failed for row",
        );
      }
    }
    return flushed;
  } catch (err) {
    logger.warn({ err }, "application demo completion flush failed");
    return 0;
  }
}
