import type { Logger } from "pino";
import {
  GraphMailClient,
  readGraphMailConfigFromEnv,
  type GraphSubscription,
} from "./storage/spe/graphMail";
import { readSpeGraphConfigFromEnv } from "./storage/spe/graphClient";

// Keeps the Graph mail subscription for the briefing mailbox alive.
//
// On startup (and every renewal interval) it ensures a subscription exists
// pointing at our webhook, and renews it before Graph's ~3-day cap. Graph
// silently drops subscriptions it can't renew, so we re-create if the
// existing one has vanished.
//
// No-ops gracefully when either the Graph app credentials or the BRIEFING_*
// env (mailbox / webhook url / secret) are absent, so local dev and
// environments without the feature configured don't error.

const RENEW_INTERVAL_MS = 12 * 60 * 60 * 1000; // every 12h

export interface BriefingSubscriptionWorker {
  stop: () => void;
}

async function ensureSubscription(log: Logger): Promise<void> {
  const cfg = readGraphMailConfigFromEnv();
  if (!cfg) {
    log.info("Briefing subscription worker idle — BRIEFING_* env not set");
    return;
  }
  if (!readSpeGraphConfigFromEnv()) {
    log.warn("Briefing subscription worker idle — Graph credentials not set");
    return;
  }
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

export function startBriefingSubscriptionWorker(
  logger: Logger,
): BriefingSubscriptionWorker {
  // Kick off shortly after boot so the listen() call isn't blocked.
  const initial = setTimeout(() => void ensureSubscription(logger), 5_000);
  initial.unref();
  const interval = setInterval(
    () => void ensureSubscription(logger),
    RENEW_INTERVAL_MS,
  );
  interval.unref();
  return {
    stop: () => {
      clearTimeout(initial);
      clearInterval(interval);
    },
  };
}
