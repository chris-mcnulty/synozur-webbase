import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type AssertionResult = {
  url: string;
  auditId?: string;
  auditProperty?: string;
  expected: number;
  actual: number;
  level: "error" | "warn";
  name: string;
  operator: string;
  passed?: boolean;
};

type ManifestEntry = {
  url: string;
  htmlPath?: string;
  jsonPath?: string;
  isRepresentativeRun?: boolean;
  summary?: {
    performance?: number;
    accessibility?: number;
    "best-practices"?: number;
    seo?: number;
    pwa?: number;
  };
};

type Profile = {
  key: "desktop" | "mobile";
  label: string;
  dir: string;
};

const profiles: Profile[] = [
  {
    key: "desktop",
    label: "Desktop",
    dir: process.env.LHCI_DESKTOP_DIR ?? ".lighthouseci-desktop",
  },
  {
    key: "mobile",
    label: "Mobile",
    dir: process.env.LHCI_MOBILE_DIR ?? ".lighthouseci-mobile",
  },
];

// Back-compat: if neither split dir exists but the legacy single dir does,
// fall back to treating it as the desktop run. Keeps local re-runs working
// for anyone invoking `lhci autorun` against just lighthouserc.json.
const legacyDir = process.env.LHCI_DIR ?? ".lighthouseci";
if (!existsSync(profiles[0].dir) && !existsSync(profiles[1].dir) && existsSync(legacyDir)) {
  profiles[0].dir = legacyDir;
}

const outPath = process.env.GITHUB_STEP_SUMMARY_OUT ?? "lhci-pr-summary.md";

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function pct(n: number | undefined): string {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  return `${Math.round(n * 100)}`;
}

function emojiFor(score: number | undefined, threshold = 0.9): string {
  if (typeof score !== "number") return "⚪";
  if (score >= threshold) return "🟢";
  if (score >= threshold - 0.1) return "🟡";
  return "🔴";
}

function normalizeUrl(url: string): string {
  return url.replace(/^http:\/\/localhost:5000/, "") || "/";
}

type LoadedProfile = {
  profile: Profile;
  reps: ManifestEntry[];
  failures: AssertionResult[];
  warnings: AssertionResult[];
  loaded: boolean;
};

function loadProfile(profile: Profile): LoadedProfile {
  const manifest = readJson<ManifestEntry[]>(join(profile.dir, "manifest.json"));
  const assertions =
    readJson<AssertionResult[]>(join(profile.dir, "assertion-results.json")) ?? [];
  const reps = (manifest ?? []).filter((m) => m.isRepresentativeRun !== false);
  return {
    profile,
    reps,
    failures: assertions.filter((a) => a.level === "error" && a.passed !== true),
    warnings: assertions.filter((a) => a.level === "warn" && a.passed !== true),
    loaded: manifest !== null,
  };
}

function renderProfile(p: LoadedProfile, lines: string[]): void {
  lines.push(`### ${p.profile.label}`);
  lines.push("");
  if (!p.loaded) {
    lines.push(`_No ${p.profile.label.toLowerCase()} Lighthouse run was collected._`);
    lines.push("");
    return;
  }
  if (p.reps.length === 0) {
    lines.push(`_No representative runs in ${p.profile.label.toLowerCase()} manifest._`);
    lines.push("");
    return;
  }
  lines.push("| Route | Perf | A11y | Best Practices | SEO |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const r of p.reps) {
    const s = r.summary ?? {};
    const url = normalizeUrl(r.url);
    // Mobile perf budgets are stricter, so use a slightly lower emoji
    // threshold for the perf column on mobile to avoid every row going
    // yellow on first rollout. A11y/BP/SEO use the standard 0.9 bar.
    const perfThreshold = p.profile.key === "mobile" ? 0.8 : 0.85;
    lines.push(
      `| \`${url}\` | ${emojiFor(s.performance, perfThreshold)} ${pct(s.performance)} | ${emojiFor(s.accessibility)} ${pct(s.accessibility)} | ${emojiFor(s["best-practices"])} ${pct(s["best-practices"])} | ${emojiFor(s.seo)} ${pct(s.seo)} |`,
    );
  }
  lines.push("");
  if (p.failures.length === 0) {
    lines.push(
      `✅ **0 blocking failures** · ${p.warnings.length} warning${p.warnings.length === 1 ? "" : "s"}`,
    );
  } else {
    lines.push(
      `❌ **${p.failures.length} blocking failure${p.failures.length === 1 ? "" : "s"}** · ${p.warnings.length} warning${p.warnings.length === 1 ? "" : "s"}`,
    );
    lines.push("");
    lines.push("<details><summary>Failures</summary>");
    lines.push("");
    lines.push("| Route | Audit | Expected | Actual |");
    lines.push("| --- | --- | --- | --- |");
    for (const f of p.failures.slice(0, 50)) {
      const url = normalizeUrl(f.url);
      const expected = `${f.operator} ${f.expected}`;
      const actual = typeof f.actual === "number" ? f.actual.toFixed(3) : String(f.actual);
      lines.push(`| \`${url}\` | \`${f.auditId ?? f.name}\` | ${expected} | ${actual} |`);
    }
    lines.push("");
    lines.push("</details>");
  }
  lines.push("");
}

const loaded = profiles.map(loadProfile);

const lines: string[] = [];
lines.push("<!-- lhci-pr-summary -->");
lines.push("## 🚦 Lighthouse CI");
lines.push("");

const anyLoaded = loaded.some((p) => p.loaded);
if (!anyLoaded) {
  lines.push("_No Lighthouse runs were collected._");
} else {
  for (const p of loaded) {
    renderProfile(p, lines);
  }
  const totalFailures = loaded.reduce((n, p) => n + p.failures.length, 0);
  const totalWarnings = loaded.reduce((n, p) => n + p.warnings.length, 0);
  lines.push(
    `**Combined:** ${totalFailures} blocking failure${totalFailures === 1 ? "" : "s"} · ${totalWarnings} warning${totalWarnings === 1 ? "" : "s"} across desktop + mobile.`,
  );
  lines.push("");
  lines.push(
    "_Mobile assertions currently start at `warn` (task #248); they do not block merge until thresholds are flipped to `error`._",
  );
}

lines.push("");
lines.push(
  "_The full HTML report is attached to this run as the `lighthouse-report` artifact._",
);

const body = lines.join("\n") + "\n";
writeFileSync(outPath, body);
console.log(body);

if (process.env.GITHUB_STEP_SUMMARY) {
  try {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, body, { flag: "a" });
  } catch (err) {
    console.error("Failed to append GITHUB_STEP_SUMMARY:", err);
  }
}
