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

const lhciDir = process.env.LHCI_DIR ?? ".lighthouseci";
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

const manifest = readJson<ManifestEntry[]>(join(lhciDir, "manifest.json")) ?? [];
const assertions =
  readJson<AssertionResult[]>(join(lhciDir, "assertion-results.json")) ?? [];

const reps = manifest.filter((m) => m.isRepresentativeRun !== false);

const failures = assertions.filter((a) => a.level === "error" && a.passed !== true);
const warnings = assertions.filter((a) => a.level === "warn" && a.passed !== true);

const lines: string[] = [];
lines.push("<!-- lhci-pr-summary -->");
lines.push("## 🚦 Lighthouse CI");
lines.push("");
if (reps.length === 0) {
  lines.push("_No Lighthouse runs were collected._");
} else {
  lines.push("| Route | Perf | A11y | Best Practices | SEO |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const r of reps) {
    const s = r.summary ?? {};
    const url = r.url.replace(/^http:\/\/localhost:5000/, "") || "/";
    lines.push(
      `| \`${url}\` | ${emojiFor(s.performance, 0.85)} ${pct(s.performance)} | ${emojiFor(s.accessibility)} ${pct(s.accessibility)} | ${emojiFor(s["best-practices"])} ${pct(s["best-practices"])} | ${emojiFor(s.seo)} ${pct(s.seo)} |`,
    );
  }
}

lines.push("");
if (failures.length === 0) {
  lines.push(`✅ **0 blocking failures** · ${warnings.length} warning${warnings.length === 1 ? "" : "s"}`);
} else {
  lines.push(`❌ **${failures.length} blocking failure${failures.length === 1 ? "" : "s"}** · ${warnings.length} warning${warnings.length === 1 ? "" : "s"}`);
  lines.push("");
  lines.push("<details><summary>Failures</summary>");
  lines.push("");
  lines.push("| Route | Audit | Expected | Actual |");
  lines.push("| --- | --- | --- | --- |");
  for (const f of failures.slice(0, 50)) {
    const url = f.url.replace(/^http:\/\/localhost:5000/, "") || "/";
    const expected = `${f.operator} ${f.expected}`;
    const actual = typeof f.actual === "number" ? f.actual.toFixed(3) : String(f.actual);
    lines.push(`| \`${url}\` | \`${f.auditId ?? f.name}\` | ${expected} | ${actual} |`);
  }
  lines.push("");
  lines.push("</details>");
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
