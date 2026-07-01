import { sql, desc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  siteSettingsTable,
  seoUnpublishSubmissionsTable,
} from "@workspace/db/schema";
import { logger } from "./logger";
import { siteOrigin } from "./siteOrigin";

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
//   TRUST — Trust & Security page (/trust) pre-launch content sign-off:
//        the two REVIEW-BEFORE-LAUNCH items flagged in trust.tsx. Admins flip
//        the site_settings.trust_compliance_reviewed and
//        trust_security_mailbox_ready toggles from Site Settings once each is
//        done.
//
// All checks are non-fatal; misconfigured channels just log a warning.

export interface ChannelStatus {
  name: string;
  configured: boolean;
  source?: string;
  detail?: string;
  // #254 — latest "gone" submission attempt for this channel, if any.
  // Surfaced on /admin/site-config/launch-readiness so an operator can
  // confirm a recent unpublish actually pinged the search engine.
  lastUnpublishSubmission?: {
    submittedAt: string;
    ok: boolean;
    httpStatus: number | null;
    url: string;
    error: string | null;
  } | null;
}

export interface LaunchReadinessGroup {
  tier: "L2" | "L3" | "L5" | "TRUST";
  label: string;
  channels: ChannelStatus[];
}

export interface LaunchReadinessReport {
  generatedAt: string;
  groups: LaunchReadinessGroup[];
}

// Probe the public SPA HTML for the verification meta tags rather than
// reading our own process.env. The verification tags are spliced into the
// HTML response by the *separate* SPA server (artifacts/synozur/server.mjs)
// from its own env vars; the api-server's env may differ, so reading
// process.env here would lie to operators in either direction. Probing
// the rendered HTML is the only truthful signal that the public bot
// crawl will actually see the tags.
//
// Best-effort: a probe failure (origin unreachable, timeout, non-2xx) is
// reported as `configured: false` with a `detail` explaining why, never
// throws. The probe response is small (HTML head only), so we cap the
// read and the timeout to keep the admin endpoint snappy.
async function checkVerificationMetaTags(): Promise<ChannelStatus[]> {
  const origin = siteOrigin();
  let html: string | null = null;
  let probeError: string | null = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const res = await fetch(origin, {
        headers: { "User-Agent": "synozur-launch-readiness/1.0" },
        signal: controller.signal,
        redirect: "follow",
      });
      if (!res.ok) {
        probeError = `probe of ${origin} returned ${res.status}`;
      } else {
        // Cap the read at 64 KB — the verification tags live in <head>,
        // well before any meaningful body content.
        const buf = await res.arrayBuffer();
        const slice = buf.byteLength > 65_536 ? buf.slice(0, 65_536) : buf;
        html = new TextDecoder("utf-8", { fatal: false }).decode(slice);
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    probeError = `probe of ${origin} threw: ${(err as Error).message}`;
  }

  function detect(metaName: string): boolean {
    if (!html) return false;
    // Match `<meta name="…">` with the metaName as either name= or
    // property= attribute, in any order, with single or double quotes.
    const re = new RegExp(
      `<meta\\s+[^>]*name\\s*=\\s*["']${metaName.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}["'][^>]*content\\s*=\\s*["'][^"']+["']`,
      "i",
    );
    return re.test(html);
  }

  return [
    {
      name: "Google Search Console",
      configured: detect("google-site-verification"),
      source: `Admin → Marketing → SEO (Google verification) · rendered into ${origin} · GOOGLE_SITE_VERIFICATION env is the fallback`,
      detail: probeError ?? undefined,
    },
    {
      name: "Bing Webmaster verification",
      configured: detect("msvalidate.01"),
      source: `Admin → Marketing → SEO (Bing verification) · rendered into ${origin} · BING_SITE_VERIFICATION env is the fallback`,
      detail: probeError ?? undefined,
    },
  ];
}

// #254: most-recent unpublish-submission row per channel, so the L3
// readiness panel can show "last pinged X ago — ok/failed" alongside the
// configured/not-configured state.
async function loadLatestUnpublishSubmissions(): Promise<
  Map<string, NonNullable<ChannelStatus["lastUnpublishSubmission"]>>
> {
  const out = new Map<string, NonNullable<ChannelStatus["lastUnpublishSubmission"]>>();
  try {
    for (const channel of ["indexnow", "google-indexing", "bing-webmaster"]) {
      const [row] = await db
        .select()
        .from(seoUnpublishSubmissionsTable)
        .where(eq(seoUnpublishSubmissionsTable.channel, channel))
        .orderBy(desc(seoUnpublishSubmissionsTable.submittedAt))
        .limit(1);
      if (row) {
        out.set(channel, {
          submittedAt: row.submittedAt.toISOString(),
          ok: row.ok,
          httpStatus: row.httpStatus ?? null,
          url: row.url,
          error: row.error ?? null,
        });
      }
    }
  } catch (err) {
    logger.warn({ err }, "loadLatestUnpublishSubmissions failed");
  }
  return out;
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
      source: "INDEXNOW_KEY · Replit Secret, one-time setup by an operator with secrets access",
    },
    {
      name: "Google Indexing API",
      configured: googleSa.length > 0,
      source: "GOOGLE_INDEXING_SA_JSON · Replit Secret, one-time setup by an operator with secrets access",
    },
    {
      name: "Bing Webmaster Tools",
      configured: bingKey.length > 0 && bingSite.length > 0,
      source: "BING_API_KEY + BING_SITE_URL · Replit Secrets, one-time setup by an operator with secrets access",
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

// TRUST — manual pre-launch sign-off for the two REVIEW-BEFORE-LAUNCH items
// on the /trust page. Unlike the other tiers these are content/ops tasks with
// no automatic signal, so each is backed by a DB-toggled site-settings flag an
// admin flips from Site Settings:
//   - trust_compliance_reviewed — flip once the Trust page's "Compliance &
//     documentation" wording has been confirmed and any formal attestations
//     (SOC 2 / ISO 27001 / DPA) named.
//   - trust_security_mailbox_ready — flip once a monitored security@
//     disclosure mailbox is live (the page currently routes reports to
//     privacy@synozur.com).
async function checkTrustPageSignoff(): Promise<ChannelStatus[]> {
  let complianceReviewed = false;
  let securityMailboxReady = false;
  try {
    const [row] = await db
      .select({
        compliance: siteSettingsTable.trustComplianceReviewed,
        security: siteSettingsTable.trustSecurityMailboxReady,
      })
      .from(siteSettingsTable)
      .where(sql`${siteSettingsTable.id} = 1`)
      .limit(1);
    if (row) {
      complianceReviewed = row.compliance ?? false;
      securityMailboxReady = row.security ?? false;
    }
  } catch {
    // Site settings row may not exist yet on a fresh database; both stay false.
  }

  return [
    {
      name: "Trust page compliance copy reviewed",
      configured: complianceReviewed,
      source: "Site Settings → Trust & Security launch sign-off",
      detail: complianceReviewed
        ? undefined
        : "Confirm the /trust 'Compliance & documentation' wording and name any formal attestations (SOC 2 / ISO 27001 / DPA), then toggle this on in Site Settings.",
    },
    {
      name: "Security disclosure mailbox live (security@)",
      configured: securityMailboxReady,
      source: "Site Settings → Trust & Security launch sign-off",
      detail: securityMailboxReady
        ? undefined
        : "Stand up a monitored security@ inbox (and update /trust), then toggle this on in Site Settings. The page currently routes disclosures to privacy@synozur.com.",
    },
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
      channels: await checkVerificationMetaTags(),
    },
    {
      tier: "L3",
      label: "Search engine submission credentials",
      channels: await (async () => {
        const channels = checkSubmissionChannels();
        const latest = await loadLatestUnpublishSubmissions();
        // Map UI channel names back to the seoSubmit `target` keys so the
        // readout pairs each row with its most-recent unpublish attempt.
        const keyByName: Record<string, string> = {
          "IndexNow (Bing/Yandex/Seznam/Naver/Yep)": "indexnow",
          "Google Indexing API": "google-indexing",
          "Bing Webmaster Tools": "bing-webmaster",
        };
        for (const c of channels) {
          const key = keyByName[c.name];
          c.lastUnpublishSubmission = key ? (latest.get(key) ?? null) : null;
        }
        return channels;
      })(),
    },
    {
      tier: "L5",
      label: "GA4 + LinkedIn + Meta marketing tags",
      channels: await checkMarketingTags(),
    },
    {
      tier: "TRUST",
      label: "Trust & Security page pre-launch sign-off",
      channels: await checkTrustPageSignoff(),
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
