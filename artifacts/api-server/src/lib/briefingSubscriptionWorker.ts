import type { Logger } from "pino";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { siteSettingsTable } from "@workspace/db/schema";
import {
  GraphMailClient,
  buildGraphMailConfig,
  type GraphSubscription,
} from "./storage/spe/graphMail";
import { readSpeGraphConfigFromEnv } from "./storage/spe/graphClient";
import { logger as log } from "./logger";

// Keeps the Graph mail subscription for the briefing mailbox alive.
//
// On startup (and every renewal interval) it reads the watched mailbox from
// site_settings.briefing_mailbox, then ensures a subscription exists pointing
// at our webhook, renewing before Graph's ~3-day cap. Re-creates if lapsed.
//
// No-ops gracefully when Graph credentials are absent or no mailbox is
// configured, so local dev and unprovisioned environments don't error.
//
// Also exported as refreshBriefingSubscription() so route handlers can trigger
// an immediate re-check (e.g. after the mailbox setting changes) without
// waiting for the next hourly tick.

const RENEW_INTERVAL_MS = 60 * 60 * 1000; // every 1h — was 12h; shorter = faster self-healing

export interface BriefingSubscriptionWorker {
  stop: () => void;
  refresh: () => Promise<void>;
}

async function ensureSubscription(): Promise<void> {
  if (!readSpeGraphConfigFromEnv()) {
    log.warn("Briefing subscription worker idle — Graph credentials not set");
    return;
  }

  // Read watched mailbox from site_settings (admin-managed, not env).
  const [settings] = await db
    .select({ briefingMailbox: siteSettingsTable.briefingMailbox })
    .from(siteSettingsTable)
    .where(eq(siteSettingsTable.id, 1))
    .limit(1);
  const mailbox = settings?.briefingMailbox;
  if (!mailbox) {
    log.info(
      "Briefing subscription worker idle — no mailbox configured in site settings",
    );
    return;
  }

  const cfg = buildGraphMailConfig(mailbox);
  log.info(
    { notificationUrl: cfg.notificationUrl },
    "Briefing subscription worker — ensuring subscription",
  );
  const client = new GraphMailClient();
  let existing: GraphSubscription | undefined;
  try {
    const subs = await client.listSubscriptions();
    existing = subs.find((s) => s.notificationUrl === cfg.notificationUrl);
  } catch (err) {
    log.error({ err }, "Failed to list Graph subscriptions");
    return;
  }

  try {
    if (existing) {
      await client.renewSubscription(existing.id);
      log.info({ subscriptionId: existing.id }, "Renewed briefing subscription");
    } else {
      const sub = await client.createSubscription(cfg);
      log.info({ subscriptionId: sub.id }, "Created briefing subscription");
    }
  } catch (err) {
    log.error({ err }, "Failed to create/renew briefing subscription");
  }
}

// Exported so route handlers (e.g. the settings PATCH and the manual-refresh
// admin endpoint) can trigger an immediate subscription check without waiting
// for the next hourly tick.
export async function refreshBriefingSubscription(): Promise<void> {
  return ensureSubscription();
}

// _logger param kept for backward-compat with index.ts callers; the function
// now uses the module-level logger so the param is not used internally.
export function startBriefingSubscriptionWorker(
  _logger?: Logger,
): BriefingSubscriptionWorker {
  // Kick off shortly after boot so the listen() call isn't blocked.
  const initial = setTimeout(() => void ensureSubscription(), 5_000);
  initial.unref();
  const interval = setInterval(() => void ensureSubscription(), RENEW_INTERVAL_MS);
  interval.unref();
  return {
    stop: () => {
      clearTimeout(initial);
      clearInterval(interval);
    },
    refresh: ensureSubscription,
  };
}
