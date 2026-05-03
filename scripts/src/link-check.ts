/**
 * Broken-link checker (#157 / launch-readiness L20).
 *
 * Crawls a running synozur instance starting from the sitemap plus a
 * hand-curated list of well-known surfaces, and reports per-page totals
 * (200 / 30x / 4xx / 5xx / skipped / allowlisted). Emits:
 *   - .link-check/results.json — full machine-readable result, used as
 *     the baseline artifact uploaded on `push: main` and downloaded on
 *     PRs to compute diff-aware gating.
 *   - .link-check/summary.md — Markdown summary used by the sticky PR
 *     comment + the nightly tracking issue body.
 *
 * Gating model:
 *   - Expired allowlist entries always fail the build (exit 1).
 *   - "Newly broken" links (broken in this run, not broken in the
 *     baseline at LINK_CHECK_BASELINE) fail the build (exit 1).
 *   - Pre-existing broken links present in the baseline are reported
 *     but do not fail the build, so the PR gate stays scoped to the
 *     diff vs. main per the task spec.
 *   - When no baseline file is available (first ever run, or the
 *     baseline download failed), the build fails on ANY non-allowlisted
 *     broken link, matching the conservative default.
 *
 * Exit codes:
 *   0 — clean (or only baseline / allowlisted broken links)
 *   1 — gating failure
 *   2 — configuration error (missing base URL, unreachable target, …)
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { LinkChecker, LinkState, type LinkResult } from "linkinator";
import { parse as parseYaml } from "yaml";

// All path-bearing env vars are resolved against this root so the
// script behaves identically regardless of cwd. `pnpm --filter` runs
// scripts inside the package directory (`scripts/`), but the
// allowlist, baseline, and output paths are repo-root-relative by
// convention. LINK_CHECK_ROOT lets callers pin the root explicitly;
// otherwise we fall back to GITHUB_WORKSPACE (set by every GitHub
// Actions runner) and finally to process.cwd() for local invocations.
const repoRoot = resolve(
  process.env.LINK_CHECK_ROOT ??
    process.env.GITHUB_WORKSPACE ??
    process.cwd(),
);

function resolveRoot(p: string): string {
  if (!p) return p;
  return isAbsolute(p) ? p : resolve(repoRoot, p);
}

type AllowlistEntry = {
  pattern: string;
  reason: string;
  expires: string;
  added?: string;
};

type AllowlistFile = {
  entries?: AllowlistEntry[];
};

type CompiledAllowlist = {
  raw: AllowlistEntry;
  regex: RegExp;
  expiresAt: Date;
  expired: boolean;
};

type StatusBucket = "ok" | "redirect" | "client_error" | "server_error";

type BrokenLink = {
  url: string;
  status: number;
  parent: string;
  state: string;
  bucket: "client_error" | "server_error" | "unknown";
  allowlistedBy?: string;
  preExisting?: boolean;
};

type PerPageBuckets = {
  ok: number;
  redirect: number;
  client_error: number;
  server_error: number;
  skipped: number;
};

type Summary = {
  baseUrl: string;
  startedAt: string;
  finishedAt: string;
  baseline: {
    used: boolean;
    path?: string;
    brokenInBaseline: number;
  };
  totals: {
    total: number;
    ok: number;
    redirect: number;
    client_error: number;
    server_error: number;
    skipped: number;
    allowlisted: number;
    preExisting: number;
    new: number;
  };
  perPage: Record<string, PerPageBuckets>;
  broken: BrokenLink[];
  expiredAllowlistEntries: AllowlistEntry[];
};

const baseUrl = (process.env.LINK_CHECK_BASE_URL ?? "").replace(/\/$/, "");
const allowlistPath = resolveRoot(
  process.env.LINK_CHECK_ALLOWLIST ?? ".github/link-check-allowlist.yml",
);
const baselinePath = process.env.LINK_CHECK_BASELINE
  ? resolveRoot(process.env.LINK_CHECK_BASELINE)
  : "";
const outDir = resolveRoot(process.env.LINK_CHECK_OUT_DIR ?? ".link-check");
const concurrency = Number(process.env.LINK_CHECK_CONCURRENCY ?? "10");
const sitemapPath = process.env.LINK_CHECK_SITEMAP ?? "/sitemap.xml";
// Hand-curated set of surfaces that must always be crawled even when
// the sitemap is missing or partial. Sitemap-driven discovery dedupes
// against this list.
const wellKnownPaths = [
  "/",
  "/about",
  "/services",
  "/solutions",
  "/applications",
  "/case-studies",
  "/insights",
  "/library",
  "/contact",
  "/privacy",
  "/terms",
];

function fail(code: number, message: string): never {
  console.error(`link-check: ${message}`);
  process.exit(code);
}

function loadAllowlist(): CompiledAllowlist[] {
  if (!existsSync(allowlistPath)) {
    console.warn(`link-check: allowlist file not found at ${allowlistPath}`);
    return [];
  }
  const raw = readFileSync(allowlistPath, "utf8");
  const parsed = (parseYaml(raw) ?? {}) as AllowlistFile;
  const entries = parsed.entries ?? [];
  const now = new Date();
  return entries.map((e) => {
    if (!e.pattern || !e.reason || !e.expires) {
      fail(
        2,
        `allowlist entry missing required field (pattern/reason/expires): ${JSON.stringify(e)}`,
      );
    }
    const expiresAt = new Date(e.expires);
    if (Number.isNaN(expiresAt.getTime())) {
      fail(2, `allowlist entry has invalid expires date: ${e.expires}`);
    }
    let regex: RegExp;
    try {
      regex = new RegExp(e.pattern);
    } catch (err) {
      fail(
        2,
        `allowlist entry pattern is not a valid regex: ${e.pattern} (${(err as Error).message})`,
      );
    }
    return {
      raw: e,
      regex,
      expiresAt,
      expired: expiresAt.getTime() < now.getTime(),
    };
  });
}

function bucketForStatus(status: number): StatusBucket | "broken_unknown" {
  if (status >= 200 && status < 300) return "ok";
  if (status >= 300 && status < 400) return "redirect";
  if (status >= 400 && status < 500) return "client_error";
  if (status >= 500 && status < 600) return "server_error";
  return "broken_unknown";
}

async function discoverSitemapUrls(): Promise<string[]> {
  const url = `${baseUrl}${sitemapPath}`;
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) {
      console.warn(
        `link-check: sitemap fetch returned ${res.status} from ${url}; falling back to well-known paths only`,
      );
      return [];
    }
    const xml = await res.text();
    const locs = Array.from(xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)).map(
      (m) => m[1]!,
    );
    // If the sitemap is a sitemap index, recurse into nested sitemap
    // documents one level deep.
    const nestedSitemaps = locs.filter((l) => /\.xml(?:$|\?)/i.test(l));
    const pageUrls = locs.filter((l) => !nestedSitemaps.includes(l));
    for (const nested of nestedSitemaps) {
      try {
        const r = await fetch(nested, { redirect: "follow" });
        if (!r.ok) continue;
        const x = await r.text();
        for (const m of x.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
          pageUrls.push(m[1]!);
        }
      } catch (err) {
        console.warn(
          `link-check: nested sitemap ${nested} failed: ${(err as Error).message}`,
        );
      }
    }
    // Restrict to same-origin URLs so foreign locs in someone's mirror
    // sitemap don't blow up the crawl scope.
    const origin = new URL(baseUrl).origin;
    const filtered = pageUrls.filter((u) => {
      try {
        return new URL(u).origin === origin;
      } catch {
        return false;
      }
    });
    console.log(
      `link-check: sitemap discovered ${filtered.length} URL(s) from ${url}`,
    );
    return filtered;
  } catch (err) {
    console.warn(
      `link-check: sitemap fetch failed (${(err as Error).message}); falling back to well-known paths only`,
    );
    return [];
  }
}

function loadBaselineBrokenSet(): {
  used: boolean;
  path?: string;
  brokenKeys: Set<string>;
  count: number;
} {
  if (!baselinePath) {
    return { used: false, brokenKeys: new Set(), count: 0 };
  }
  if (!existsSync(baselinePath)) {
    console.warn(
      `link-check: baseline path ${baselinePath} not found; gating on ANY non-allowlisted broken link`,
    );
    return { used: false, path: baselinePath, brokenKeys: new Set(), count: 0 };
  }
  try {
    const raw = readFileSync(baselinePath, "utf8");
    const parsed = JSON.parse(raw) as Summary;
    const keys = new Set<string>();
    for (const b of parsed.broken ?? []) {
      // Key on (source page, target URL) so a brand-new broken link
      // from a changed page is still "new" even when the same target
      // is broken from a different page on main. Matches the task's
      // "fail PRs on broken links found in the diff" requirement.
      keys.add(`${b.parent ?? ""}\u0000${b.url}`);
    }
    return { used: true, path: baselinePath, brokenKeys: keys, count: keys.size };
  } catch (err) {
    console.warn(
      `link-check: baseline parse failed (${(err as Error).message}); gating on ANY non-allowlisted broken link`,
    );
    return { used: false, path: baselinePath, brokenKeys: new Set(), count: 0 };
  }
}

function writeOut(name: string, contents: string) {
  const target = join(outDir, name);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function fmtTable(rows: string[][]): string {
  if (rows.length === 0) return "_(none)_\n";
  const header = rows[0]!;
  const sep = header.map(() => "---");
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${sep.join(" | ")} |`,
    ...rows.slice(1).map((r) => `| ${r.join(" | ")} |`),
  ];
  return `${lines.join("\n")}\n`;
}

async function main() {
  if (!baseUrl) {
    fail(2, "LINK_CHECK_BASE_URL must be set (e.g. http://localhost:5000)");
  }

  const allowlist = loadAllowlist();
  const expired = allowlist.filter((a) => a.expired);
  const baseline = loadBaselineBrokenSet();

  const sitemapUrls = await discoverSitemapUrls();
  const seedSet = new Set<string>();
  seedSet.add(baseUrl);
  for (const p of wellKnownPaths) seedSet.add(`${baseUrl}${p}`);
  for (const u of sitemapUrls) seedSet.add(u);

  const checker = new LinkChecker();
  const startedAt = new Date();

  const result = await checker.check({
    path: Array.from(seedSet),
    recurse: true,
    concurrency,
    timeout: 20_000,
    retry: true,
    retryErrors: true,
    retryErrorsCount: 2,
    // Scope to navigational/document links only — images, scripts,
    // stylesheets, fonts, and other static assets are explicitly out
    // of scope per the task spec ("Image / asset 404 detection
    // (separate pass)"). linkinator extracts URLs from `<img src>`,
    // `<script src>`, `<link rel=stylesheet href>` etc. by default,
    // so we filter them by file extension before they're requested.
    linksToSkip: [
      "^mailto:",
      "^tel:",
      "^javascript:",
      "^data:",
      // Common static-asset extensions. Matched anywhere in the URL,
      // including when followed by a query string or fragment.
      "\\.(png|jpe?g|gif|svg|webp|avif|ico|bmp|tiff?|mp4|m4v|webm|mov|mp3|wav|ogg|m4a|pdf|zip|gz|tar|woff2?|ttf|otf|eot|css|js|mjs|map)(\\?|#|$)",
    ],
  });

  const finishedAt = new Date();

  const perPage: Summary["perPage"] = {};
  const broken: BrokenLink[] = [];
  let ok = 0;
  let redirect = 0;
  let clientError = 0;
  let serverError = 0;
  let skipped = 0;

  const bumpPage = (parent: string, bucket: keyof PerPageBuckets) => {
    const key = parent || baseUrl;
    perPage[key] ??= {
      ok: 0,
      redirect: 0,
      client_error: 0,
      server_error: 0,
      skipped: 0,
    };
    perPage[key][bucket] += 1;
  };

  for (const link of result.links as LinkResult[]) {
    const parent = link.parent ?? "";
    if (link.state === LinkState.OK) {
      const status = link.status ?? 0;
      const b = bucketForStatus(status);
      if (b === "redirect") {
        redirect += 1;
        bumpPage(parent, "redirect");
      } else {
        ok += 1;
        bumpPage(parent, "ok");
      }
    } else if (link.state === LinkState.SKIPPED) {
      skipped += 1;
      bumpPage(parent, "skipped");
    } else if (link.state === LinkState.BROKEN) {
      const matched = allowlist.find(
        (a) => !a.expired && a.regex.test(link.url),
      );
      const status = link.status ?? 0;
      const sb = bucketForStatus(status);
      const bucket: BrokenLink["bucket"] =
        sb === "client_error"
          ? "client_error"
          : sb === "server_error"
            ? "server_error"
            : "unknown";
      const preExistingKey = `${parent}\u0000${link.url}`;
      const preExisting =
        baseline.used && baseline.brokenKeys.has(preExistingKey);
      const entry: BrokenLink = {
        url: link.url,
        status,
        parent,
        state: String(link.state),
        bucket,
        allowlistedBy: matched?.raw.pattern,
        preExisting,
      };
      broken.push(entry);
      if (matched) {
        bumpPage(parent, "skipped");
      } else if (bucket === "server_error") {
        serverError += 1;
        bumpPage(parent, "server_error");
      } else {
        // 4xx and unknown-failure (DNS / timeout / etc) bucket together
        // as client-side breakage.
        clientError += 1;
        bumpPage(parent, "client_error");
      }
    }
  }

  const allowlistedCount = broken.filter((b) => b.allowlistedBy).length;
  const failingBroken = broken.filter((b) => !b.allowlistedBy);
  const newBroken = failingBroken.filter((b) => !b.preExisting);
  const preExistingBroken = failingBroken.filter((b) => b.preExisting);

  const summary: Summary = {
    baseUrl,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    baseline: {
      used: baseline.used,
      path: baseline.path,
      brokenInBaseline: baseline.count,
    },
    totals: {
      total: result.links.length,
      ok,
      redirect,
      client_error: clientError,
      server_error: serverError,
      skipped,
      allowlisted: allowlistedCount,
      preExisting: preExistingBroken.length,
      new: newBroken.length,
    },
    perPage,
    broken,
    expiredAllowlistEntries: expired.map((e) => e.raw),
  };

  writeOut("results.json", JSON.stringify(summary, null, 2));

  // Markdown summary
  const lines: string[] = [];
  lines.push(`## Broken-link check`);
  lines.push("");
  lines.push(`- Base URL: \`${baseUrl}\``);
  lines.push(`- Seed pages: ${seedSet.size} (sitemap: ${sitemapUrls.length}, well-known: ${wellKnownPaths.length})`);
  lines.push(
    `- Baseline: ${
      baseline.used
        ? `\`${baseline.path}\` (${baseline.count} broken target${baseline.count === 1 ? "" : "s"})`
        : "_not available — gating on any non-allowlisted broken link_"
    }`,
  );
  lines.push(`- Started: ${summary.startedAt}`);
  lines.push(`- Finished: ${summary.finishedAt}`);
  lines.push("");
  lines.push("### Totals");
  lines.push("");
  lines.push(
    fmtTable([
      ["Total", "200", "30x", "4xx", "5xx", "Skipped", "Allowlisted", "Pre-existing", "New"],
      [
        String(summary.totals.total),
        String(summary.totals.ok),
        String(summary.totals.redirect),
        String(summary.totals.client_error),
        String(summary.totals.server_error),
        String(summary.totals.skipped),
        String(summary.totals.allowlisted),
        String(summary.totals.preExisting),
        String(summary.totals.new),
      ],
    ]),
  );

  // Per-page breakdown — only show pages that have at least one
  // non-OK result so the comment doesn't drown a PR.
  const noisyPages = Object.entries(perPage)
    .filter(
      ([, b]) =>
        b.client_error > 0 || b.server_error > 0 || b.redirect > 0 || b.skipped > 0,
    )
    .sort(
      ([, a], [, b]) =>
        b.client_error + b.server_error - (a.client_error + a.server_error),
    );
  if (noisyPages.length > 0) {
    lines.push("");
    lines.push("### Per-page totals (pages with non-200 results)");
    lines.push("");
    lines.push(
      fmtTable([
        ["Page", "200", "30x", "4xx", "5xx", "Skipped"],
        ...noisyPages
          .slice(0, 30)
          .map(([page, b]) => [
            page,
            String(b.ok),
            String(b.redirect),
            String(b.client_error),
            String(b.server_error),
            String(b.skipped),
          ]),
      ]),
    );
    if (noisyPages.length > 30) {
      lines.push(
        `_…and ${noisyPages.length - 30} more page(s). See the \`results.json\` artifact._`,
      );
    }
  }

  if (expired.length > 0) {
    lines.push("");
    lines.push("### ⚠️ Expired allowlist entries");
    lines.push("");
    lines.push(
      fmtTable([
        ["Pattern", "Reason", "Expired"],
        ...expired.map((e) => [
          `\`${e.raw.pattern}\``,
          e.raw.reason,
          e.raw.expires,
        ]),
      ]),
    );
  }

  if (newBroken.length > 0) {
    lines.push("");
    lines.push(`### ❌ New broken links vs. baseline (${newBroken.length})`);
    lines.push("");
    lines.push(
      fmtTable([
        ["Status", "Bucket", "Source page", "Broken target"],
        ...newBroken.slice(0, 100).map((b) => [
          String(b.status || "—"),
          b.bucket,
          b.parent || "_(root)_",
          b.url,
        ]),
      ]),
    );
    if (newBroken.length > 100) {
      lines.push(
        `_…and ${newBroken.length - 100} more. See the \`results.json\` artifact._`,
      );
    }
  } else if (failingBroken.length === 0) {
    lines.push("");
    lines.push("### ✅ No broken links");
  } else {
    lines.push("");
    lines.push(
      `### ✅ No new broken links vs. baseline (${failingBroken.length} pre-existing tolerated)`,
    );
  }

  if (preExistingBroken.length > 0) {
    lines.push("");
    lines.push(
      `<details><summary>Pre-existing broken links (${preExistingBroken.length}) — not gating</summary>`,
    );
    lines.push("");
    lines.push(
      fmtTable([
        ["Status", "Bucket", "Source page", "Broken target"],
        ...preExistingBroken.slice(0, 100).map((b) => [
          String(b.status || "—"),
          b.bucket,
          b.parent || "_(root)_",
          b.url,
        ]),
      ]),
    );
    lines.push("</details>");
  }

  writeOut("summary.md", lines.join("\n") + "\n");

  // Exit code
  if (expired.length > 0) {
    console.error(
      `link-check: ${expired.length} expired allowlist entr${expired.length === 1 ? "y" : "ies"}.`,
    );
    process.exit(1);
  }
  if (baseline.used) {
    if (newBroken.length > 0) {
      console.error(
        `link-check: ${newBroken.length} new broken link(s) vs. baseline (${preExistingBroken.length} pre-existing, ${allowlistedCount} allowlisted).`,
      );
      process.exit(1);
    }
  } else if (failingBroken.length > 0) {
    console.error(
      `link-check: ${failingBroken.length} broken link(s) (no baseline available, ${allowlistedCount} allowlisted).`,
    );
    process.exit(1);
  }
  console.log(
    `link-check: ${summary.totals.total} link(s) checked — ok=${summary.totals.ok} redirect=${summary.totals.redirect} 4xx=${summary.totals.client_error} 5xx=${summary.totals.server_error} skipped=${summary.totals.skipped} allowlisted=${allowlistedCount}.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
