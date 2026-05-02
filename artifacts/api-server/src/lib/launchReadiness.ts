import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { siteSettingsTable } from "@workspace/db/schema";
import { logger } from "./logger";

// Launch-readiness configuration check (BACKLOG.md "Launch Readiness" Tier 1).
//
// Logs the live status of every Tier 1 configuration knob so an operator can
// verify production secrets after a deploy by reading the startup logs:
//
//   L2 — Search Console + Bing Webmaster verification meta tags
//        (GOOGLE_SITE_VERIFICATION / BING_SITE_VERIFICATION env vars used by
//         the SPA server in artifacts/synozur/server.mjs).
//   L3 — IndexNow / Google Indexing / Bing Webmaster credentials
//        (INDEXNOW_KEY / GOOGLE_INDEXING_SA_JSON / BING_API_KEY +
//         BING_SITE_URL — every channel without credentials returns
//         ok: false from /api/seo/submit).
//   L5 — GA4 + LinkedIn + Meta pixel IDs
//        (DB-backed siteSettings.tag* columns OR fallback VITE_* env vars
//         consumed by the SPA's components/analytics.tsx).
//
// All checks are non-fatal; misconfigured channels just log a warning.

export interface ChannelStatus {
  name: string;
  configured: boolean;
  source?: string;
  detail?: string;
}

export interface LaunchReadinessGroup {
  tier: "L2" | "L3" | "L5";
  label: string;
  channels: ChannelStatus[];
}

export interface LaunchReadinessReport {
  generatedAt: string;
  groups: LaunchReadinessGroup[];
}

function checkVerificationMetaTags(): ChannelStatus[] {
  const google = (process.env.GOOGLE_SITE_VERIFICATION ?? "").trim();
  const bing = (process.env.BING_SITE_VERIFICATION ?? "").trim();
  return [
    {
      name: "Google Search Console",
      configured: google.length > 0,
      source: "GOOGLE_SITE_VERIFICATION",
    },
    {
      name: "Bing Webmaster verification",
      configured: bing.length > 0,
      source: "BING_SITE_VERIFICATION",
    },
  ];
}

function checkSubmissionChannels(): ChannelStatus[] {
  const indexNow = (process.env.INDEXNOW_KEY ?? "").trim();
  const googleSa = (process.env.GOOGLE_INDEXING_SA_JSON ?? "").trim();
  const bingKey = (process.env.BING_API_KEY ?? "").trim();
  const bingSite = (process.env.BING_SITE_URL ?? "").trim();

  return [
    {
      name: "IndexNow (Bing/Yandex/Seznam/Naver/Yep)",
      configured: indexNow.length > 0,
      source: "INDEXNOW_KEY",
    },
    {
      name: "Google Indexing API",
      configured: googleSa.length > 0,
      source: "GOOGLE_INDEXING_SA_JSON",
    },
    {
      name: "Bing Webmaster Tools",
      configured: bingKey.length > 0 && bingSite.length > 0,
      source: "BING_API_KEY + BING_SITE_URL",
      detail:
        bingKey.length > 0 && bingSite.length === 0
          ? "BING_API_KEY set but BING_SITE_URL missing"
          : bingSite.length > 0 && bingKey.length === 0
            ? "BING_SITE_URL set but BING_API_KEY missing"
            : undefined,
    },
  ];
}

async function checkMarketingTags(): Promise<ChannelStatus[]> {
  let dbGa4: string | null = null;
  let dbLi: string | null = null;
  let dbMeta: string | null = null;
  try {
    const rows = await db
      .select({
        ga4: siteSettingsTable.tagGa4Id,
        li: siteSettingsTable.tagLinkedinPartnerId,
        meta: siteSettingsTable.tagMetaPixelId,
      })
      .from(siteSettingsTable)
      .where(sql`${siteSettingsTable.id} = 1`)
      .limit(1);
    const r = rows[0];
    if (r) {
      dbGa4 = r.ga4 ?? null;
      dbLi = r.li ?? null;
      dbMeta = r.meta ?? null;
    }
  } catch {
    // Site settings row may not exist yet on a fresh database; that's fine.
  }

  function pick(dbVal: string | null, envName: string): ChannelStatus {
    const envVal = (process.env[envName] ?? "").trim();
    const dbTrim = (dbVal ?? "").trim();
    if (dbTrim) return { name: envName, configured: true, source: "site_settings (DB)" };
    if (envVal) return { name: envName, configured: true, source: `env ${envName}` };
    return { name: envName, configured: false, source: `site_settings (DB) or env ${envName}` };
  }

  // LinkedIn Insight Tag has a hardcoded fallback partner ID (7337793) in the
  // SPA's analytics.tsx that activates when neither DB nor env is configured.
  // This check mirrors that logic so the readiness log reflects the actual
  // loader behaviour rather than always reporting "NOT configured".
  function pickLinkedIn(dbVal: string | null): ChannelStatus {
    const envVal = (process.env["VITE_LINKEDIN_PARTNER_ID"] ?? "").trim();
    const dbTrim = (dbVal ?? "").trim();
    if (dbTrim) return { name: "VITE_LINKEDIN_PARTNER_ID", configured: true, source: "site_settings (DB)" };
    if (envVal) return { name: "VITE_LINKEDIN_PARTNER_ID", configured: true, source: "env VITE_LINKEDIN_PARTNER_ID" };
    // analytics.tsx falls back to the hardcoded partner ID when neither source
    // is set, so the tag fires regardless.  Report it as configured.
    return {
      name: "VITE_LINKEDIN_PARTNER_ID",
      configured: true,
      source: "hardcoded default (7337793)",
    };
  }

  return [
    pick(dbGa4, "VITE_GA4_ID"),
    pickLinkedIn(dbLi),
    pick(dbMeta, "VITE_META_PIXEL_ID"),
  ];
}

function logChannel(label: string, status: ChannelStatus): void {
  if (status.configured) {
    logger.info(`launch-readiness: ${label} — ${status.name}: configured (${status.source})`);
  } else {
    logger.warn(
      `launch-readiness: ${label} — ${status.name}: NOT configured${status.detail ? ` (${status.detail})` : ""} — set ${status.source}`,
    );
  }
}

export async function getLaunchReadinessReport(): Promise<LaunchReadinessReport> {
  const groups: LaunchReadinessGroup[] = [
    {
      tier: "L2",
      label: "Search Console + Bing Webmaster verification",
      channels: checkVerificationMetaTags(),
    },
    {
      tier: "L3",
      label: "Search engine submission credentials",
      channels: checkSubmissionChannels(),
    },
    {
      tier: "L5",
      label: "GA4 + LinkedIn + Meta marketing tags",
      channels: await checkMarketingTags(),
    },
  ];
  return { generatedAt: new Date().toISOString(), groups };
}

export async function logLaunchReadiness(): Promise<void> {
  const report = await getLaunchReadinessReport();
  for (const g of report.groups) {
    for (const c of g.channels) logChannel(`${g.tier} ${g.label}`, c);
  }
}
