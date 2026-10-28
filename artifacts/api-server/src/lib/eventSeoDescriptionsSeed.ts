import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db, eventsTable } from "@workspace/db";
import { logger } from "./logger";

// One-time content backfill: production had 18 of 29 events with no
// seo_description, so those event pages fell back to generic copy in search
// results and social shares. This seeds a hand-written meta description for
// each of those events, keyed by slug.
//
// Idempotent and non-destructive: a row is only updated when its
// seo_description is NULL or blank, so anything an admin has written (or
// edits later) is never overwritten. Runs on every startup like the other
// safe startup seeds; once every listed row has a value this is a no-op.

export const EVENT_SEO_DESCRIPTIONS: Record<string, string> = {
  "ai-driven-gtm-how-to-assess-rebuild-and-accelerate-your-2026-plans":
    "Webinar: assess your go-to-market, rebuild your funnel with AI, and accelerate your 2026 plans — practical agentic GTM strategies from Synozur.",
  "the-new-ai-frontier-market-shifts-maturity-gaps-and-how-to-lead-with-copilot":
    "Webinar: explore AI market shifts, close maturity gaps, and lead your organization with Microsoft Copilot — insights from Synozur strategists.",
  "m365-community-days-dc-2026":
    "Join Synozur at M365 Community Days DC 2026 in Arlington, VA — community-led sessions on Microsoft 365, Copilot, and the modern digital workplace.",
  "partner-vibe":
    "Synozur at Partner Vibe on South Padre Island — Microsoft partner leaders sharing strategies for growth, AI, and co-selling in 2026.",
  "strategy-now-with-ai-building-your-company-operating-system-for-2026-success":
    "Webinar: build your Company Operating System for 2026 — align strategy, culture, and AI into one operating rhythm with Synozur's North Star Method.",
  "experts-live-us":
    "Synozur at Experts Live US in New York City — expert-led sessions on Microsoft cloud, AI, and automation for IT pros and technology leaders.",
  "vancouver-ai-summit":
    "Join Synozur at the Vancouver AI Summit — practical sessions on AI adoption, governance, and real-world results for business and technology leaders.",
  "microsoft-ignite":
    "Meet Synozur at Microsoft Ignite in San Francisco — Microsoft's flagship conference for AI, Copilot, security, and cloud innovation.",
  "techcon-365-dallas":
    "Join Synozur at TechCon 365 Dallas — Microsoft 365, Power Platform, and Copilot training with deep-dive workshops and expert-led sessions.",
  "fy26-forward-microsoft-partner-success-strategies":
    "Webinar: FY26 Microsoft partner success strategies — navigate program changes, sharpen your co-sell motion, and plan for growth with Synozur.",
  "business-strategy-masterclass":
    "A hands-on masterclass on business strategy fundamentals — vision, differentiation, and execution — led by Synozur's strategy practitioners.",
  "mastering-your-ai-rollout-success-strategies":
    "Webinar: proven strategies for a successful AI rollout — adoption planning, governance, and change management guidance from Synozur experts.",
  "m365-philly-2025":
    "Join Synozur at M365 Philly 2025 in Malvern, PA — free community sessions on Microsoft 365, SharePoint, Teams, and Copilot for practitioners.",
  "ai-im-summit":
    "Synozur at the AIIM AI+IM Summit in Atlanta — where information management meets AI: governance, unstructured data, and intelligent automation.",
  "how-to-succeed-with-your-copilot-rollout":
    "Webinar: how to succeed with your Microsoft Copilot rollout — readiness, adoption, and measurement practices that make AI stick, from Synozur.",
  "techcon-365-seattle":
    "Join Synozur at TechCon 365 Seattle — Microsoft 365, SharePoint, Teams, and Copilot sessions and workshops for IT pros and business users.",
  "microsoft-365-community-conference":
    "Meet Synozur at the Microsoft 365 Community Conference in Las Vegas — hundreds of sessions on Copilot, Teams, SharePoint, and Viva.",
  "transforming-the-digital-workplace-strategies-for-engagement-and-success":
    "Webinar: strategies for digital workplace transformation — employee engagement, intranet success, and adoption insights from Synozur.",
};

/** Fill blank seo_description on the listed events. Returns count updated. */
export async function seedEventSeoDescriptionsIfMissing(): Promise<number> {
  let updated = 0;
  try {
    for (const [slug, seoDescription] of Object.entries(
      EVENT_SEO_DESCRIPTIONS,
    )) {
      const rows = await db
        .update(eventsTable)
        .set({ seoDescription })
        .where(
          and(
            eq(eventsTable.slug, slug),
            or(
              isNull(eventsTable.seoDescription),
              eq(sql`btrim(${eventsTable.seoDescription})`, ""),
            ),
          ),
        )
        .returning({ id: eventsTable.id });
      updated += rows.length;
    }
    if (updated > 0) {
      logger.info({ updated }, "Backfilled missing event SEO descriptions");
    }
  } catch (err) {
    // Best-effort content seed — never block server startup on it.
    logger.error({ err }, "Event SEO description backfill failed");
  }
  return updated;
}
