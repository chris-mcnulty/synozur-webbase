import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  Send,
  Wand2,
} from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useAdminAccess } from "@/components/admin/AdminGate";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  api,
  type SeoArtifactKind,
  type SeoAuditFinding,
  type SeoAuditReport,
  type SeoSubmitBundle,
} from "@/lib/api";

// ─── Kind labels + CMS editor deep-links ──────────────────────────────────────

const KIND_LABEL: Record<SeoArtifactKind, string> = {
  insight: "Insights",
  service: "Services",
  solution: "Solutions",
  application: "Applications",
  "case-study": "Case studies",
  model: "Models",
};

// Applications + case studies don't have dedicated /:id/edit routes today —
// they edit from the list view — so we link to the list for those.
function editorHref(kind: SeoArtifactKind, id: string): string {
  switch (kind) {
    case "insight":
      return `/insights/posts/${id}/edit`;
    case "service":
      return `/products/services/${id}/edit`;
    case "solution":
      return `/products/solutions/${id}/edit`;
    case "model":
      return `/products/models/${id}/edit`;
    case "application":
      return `/products/applications`;
    case "case-study":
      return `/products/case-studies`;
  }
}

// ─── Sitemap prefill: last 7 days ─────────────────────────────────────────────

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

async function fetchRecentSitemapUrls(): Promise<string[]> {
  const res = await fetch(`${BASE_PATH}/sitemap.xml`, { credentials: "same-origin" });
  if (!res.ok) return [];
  const text = await res.text();
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) return [];
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const out: string[] = [];
  doc.querySelectorAll("url").forEach((node) => {
    const loc = node.querySelector("loc")?.textContent?.trim();
    const lastmod = node.querySelector("lastmod")?.textContent?.trim();
    if (!loc || !lastmod) return;
    const t = Date.parse(lastmod);
    if (Number.isFinite(t) && t >= cutoff) out.push(loc);
  });
  return out;
}

// ─── Findings grouping ────────────────────────────────────────────────────────

function groupFindings(findings: SeoAuditFinding[]): Record<SeoArtifactKind, SeoAuditFinding[]> {
  const empty: Record<SeoArtifactKind, SeoAuditFinding[]> = {
    insight: [],
    service: [],
    solution: [],
    application: [],
    "case-study": [],
    model: [],
  };
  for (const f of findings) empty[f.kind].push(f);
  return empty;
}

function formatMissingLabel(field: string): string {
  const map: Record<string, string> = {
    seoTitle: "SEO title",
    seoDescription: "SEO description",
    ogImage: "OG image",
    seoDescriptionShort: "Desc too short",
    seoDescriptionLong: "Desc too long",
    seoTitleLong: "Title too long",
  };
  return map[field] ?? field;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MarketingSeoAudit() {
  const { access } = useAdminAccess();
  const canModerate = !!access?.hasCapability("content.moderate");
  const qc = useQueryClient();

  // Audit
  const audit = useQuery<SeoAuditReport>({
    queryKey: ["seo-audit"],
    queryFn: () => api.seoAudit(),
    enabled: canModerate,
  });

  // Autofill
  const [autofillError, setAutofillError] = useState<string | null>(null);
  const [autofillSummary, setAutofillSummary] = useState<string | null>(null);
  const autofill = useMutation({
    mutationFn: (ids?: Array<{ kind: SeoArtifactKind; id: string }>) =>
      api.seoAuditAutofill(ids),
    onSuccess: (result) => {
      const total = Object.values(result.touched).reduce((a, b) => a + b, 0);
      setAutofillError(null);
      setAutofillSummary(total === 0 ? "No rows needed autofill." : `Autofilled ${total} row${total === 1 ? "" : "s"}.`);
      qc.invalidateQueries({ queryKey: ["seo-audit"] });
    },
    onError: (err: unknown) => {
      setAutofillSummary(null);
      setAutofillError(err instanceof Error ? err.message : String(err));
    },
  });

  // Submission card
  const [submitUrls, setSubmitUrls] = useState<string>("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submit = useMutation<SeoSubmitBundle, unknown, string[]>({
    mutationFn: (urls) => api.seoSubmit(urls),
    onSuccess: () => setSubmitError(null),
    onError: (err: unknown) => {
      setSubmitError(err instanceof Error ? err.message : String(err));
    },
  });

  // Prefill textarea with last-7-days sitemap entries once audit loads.
  const [prefilled, setPrefilled] = useState(false);
  useEffect(() => {
    if (prefilled || !canModerate) return;
    setPrefilled(true);
    fetchRecentSitemapUrls().then((urls) => {
      if (urls.length > 0) setSubmitUrls(urls.join("\n"));
    });
  }, [canModerate, prefilled]);

  const groups = useMemo(
    () => (audit.data ? groupFindings(audit.data.findings) : null),
    [audit.data],
  );

  const parsedUrls = useMemo(
    () => submitUrls.split(/\s+/).map((s) => s.trim()).filter(Boolean),
    [submitUrls],
  );

  if (!canModerate) {
    return (
      <AdminLayout
        title="SEO Audit"
        crumbs={[{ label: "Admin", href: "/" }, { label: "Marketing" }, { label: "SEO Audit" }]}
      >
        <Card className="p-6">
          <p className="text-sm text-muted-foreground">
            You don't have permission to run the SEO audit.
          </p>
        </Card>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout
      title="SEO Audit"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Marketing" }, { label: "SEO Audit" }]}
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => audit.refetch()}
          disabled={audit.isFetching}
          data-testid="button-run-audit"
        >
          {audit.isFetching ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          {audit.data ? "Re-run audit" : "Run audit"}
        </Button>
      }
    >
      {/* Totals row */}
      {audit.data && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
          {(Object.keys(KIND_LABEL) as SeoArtifactKind[]).map((k) => {
            const t = audit.data!.totals[k];
            return (
              <Card key={k} className="p-4" data-testid={`stat-seo-audit-${k}`}>
                <div className="text-xs text-muted-foreground">{KIND_LABEL[k]}</div>
                <div className="text-2xl font-semibold mt-1">
                  {t.missing}
                  <span className="text-sm font-normal text-muted-foreground"> / {t.total}</span>
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">missing SEO data</div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Audit findings */}
      <Card className="p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-semibold text-sm">Findings</h2>
            {audit.data && (
              <span className="text-xs text-muted-foreground">
                Generated {new Date(audit.data.generatedAt).toLocaleString()}
              </span>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setAutofillError(null);
              setAutofillSummary(null);
              autofill.mutate(undefined);
            }}
            disabled={autofill.isPending || !audit.data || audit.data.findings.length === 0}
            data-testid="button-autofill-all"
          >
            {autofill.isPending && !autofill.variables ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Wand2 className="h-4 w-4 mr-2" />
            )}
            Autofill all empty
          </Button>
        </div>

        {autofillSummary && (
          <div className="mb-3 flex items-center gap-2 text-xs text-green-700 dark:text-green-400" data-testid="autofill-summary">
            <CheckCircle2 className="h-4 w-4" /> {autofillSummary}
          </div>
        )}
        {autofillError && (
          <div className="mb-3 flex items-center gap-2 text-xs text-destructive" data-testid="autofill-error">
            <AlertCircle className="h-4 w-4" /> {autofillError}
          </div>
        )}

        {audit.isLoading && !audit.data ? (
          <div className="text-sm text-muted-foreground py-8 text-center">Loading audit…</div>
        ) : audit.isError ? (
          <div className="text-sm text-destructive py-8 text-center">
            Failed to load audit: {audit.error instanceof Error ? audit.error.message : String(audit.error)}
          </div>
        ) : !audit.data ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            Click "Run audit" to scan for missing SEO metadata.
          </div>
        ) : audit.data.findings.length === 0 ? (
          <div className="flex items-center justify-center gap-2 text-sm text-green-700 dark:text-green-400 py-8">
            <CheckCircle2 className="h-5 w-5" />
            All published artifacts have complete SEO metadata.
          </div>
        ) : (
          <div className="space-y-5">
            {(Object.keys(KIND_LABEL) as SeoArtifactKind[]).map((kind) => {
              const items = groups?.[kind] ?? [];
              if (items.length === 0) return null;
              return (
                <section key={kind} data-testid={`findings-group-${kind}`}>
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                    {KIND_LABEL[kind]} <span className="font-normal">({items.length})</span>
                  </h3>
                  <ul className="divide-y divide-border border border-border rounded-md">
                    {items.map((f) => (
                      <FindingRow
                        key={f.id}
                        finding={f}
                        onAutofill={() => {
                          setAutofillError(null);
                          setAutofillSummary(null);
                          autofill.mutate([{ kind: f.kind, id: f.id }]);
                        }}
                        isAutofilling={
                          autofill.isPending &&
                          Array.isArray(autofill.variables) &&
                          autofill.variables.some((v) => v.kind === f.kind && v.id === f.id)
                        }
                      />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </Card>

      {/* Submission card */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <Send className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold text-sm">Submit URLs to search engines</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Submits to IndexNow, Google Indexing API, and Bing Webmaster Tools. Prefilled with items
          updated in the last 7 days (from <code>/sitemap.xml</code>). One absolute URL per line;
          max 200. Channels without credentials will be skipped individually —
          see <code>docs/seo-env.md</code> for required env vars.
        </p>
        <Textarea
          value={submitUrls}
          onChange={(e) => setSubmitUrls(e.target.value)}
          rows={8}
          className="font-mono text-xs"
          placeholder="https://www.synozur.com/insights/…"
          data-testid="textarea-submit-urls"
        />
        <div className="mt-3 flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            {parsedUrls.length} URL{parsedUrls.length === 1 ? "" : "s"} ready
            {parsedUrls.length > 200 && (
              <span className="text-destructive"> — only the first 200 will be sent</span>
            )}
          </div>
          <Button
            size="sm"
            onClick={() => {
              setSubmitError(null);
              submit.mutate(parsedUrls.slice(0, 200));
            }}
            disabled={submit.isPending || parsedUrls.length === 0}
            data-testid="button-submit-urls"
          >
            {submit.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Submit
          </Button>
        </div>

        {submitError && (
          <div className="mt-3 flex items-center gap-2 text-xs text-destructive" data-testid="submit-error">
            <AlertCircle className="h-4 w-4" /> {submitError}
          </div>
        )}

        {submit.data && (
          <div className="mt-4 space-y-2" data-testid="submit-results">
            <div className="text-xs text-muted-foreground">
              Submitted {submit.data.urls.length} URL{submit.data.urls.length === 1 ? "" : "s"} (deduplicated).
            </div>
            <ul className="divide-y divide-border border border-border rounded-md">
              {submit.data.results.map((r) => (
                <SubmitResultRow key={r.target} result={r} />
              ))}
            </ul>
          </div>
        )}
      </Card>
    </AdminLayout>
  );
}

// ─── Finding row ──────────────────────────────────────────────────────────────

function FindingRow({
  finding,
  onAutofill,
  isAutofilling,
}: {
  finding: SeoAuditFinding;
  onAutofill: () => void;
  isAutofilling: boolean;
}) {
  const FILLABLE_KEYS = new Set(["seoTitle", "seoDescription", "ogImage"]);
  const canAutofill = finding.missing.some((m) => FILLABLE_KEYS.has(m));

  return (
    <li className="py-2.5 px-3 flex items-center gap-3" data-testid={`finding-row-${finding.kind}-${finding.id}`}>
      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{finding.title || finding.slug}</div>
        <div className="text-xs text-muted-foreground truncate">
          {finding.path} · missing:{" "}
          {finding.missing.map((m) => formatMissingLabel(m)).join(", ")}
        </div>
      </div>
      <Link href={editorHref(finding.kind, finding.id)}>
        <a
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          data-testid={`edit-link-${finding.kind}-${finding.id}`}
          title="Open in CMS editor"
        >
          Edit <ExternalLink className="h-3 w-3" />
        </a>
      </Link>
      <Button
        variant="outline"
        size="sm"
        onClick={onAutofill}
        disabled={isAutofilling || !canAutofill}
        data-testid={`autofill-row-${finding.kind}-${finding.id}`}
        title={canAutofill ? "Apply suggested values to empty fields" : "No autofill suggestions available"}
        aria-label={canAutofill ? "Apply autofill to this row" : "No autofill available for this row"}
      >
        {isAutofilling ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Wand2 className="h-3.5 w-3.5" />
        )}
      </Button>
    </li>
  );
}

// ─── Submit result row ────────────────────────────────────────────────────────

const TARGET_LABEL: Record<"indexnow" | "google-indexing" | "bing-webmaster", string> = {
  indexnow: "IndexNow",
  "google-indexing": "Google Indexing API",
  "bing-webmaster": "Bing Webmaster Tools",
};

function SubmitResultRow({
  result,
}: {
  result: SeoSubmitBundle["results"][number];
}) {
  const missingCredentials =
    !result.ok && !!result.error && /not set/i.test(result.error);

  return (
    <li
      className="py-2.5 px-3 flex items-center gap-3 text-sm"
      data-testid={`submit-result-${result.target}`}
    >
      {result.ok ? (
        <CheckCircle2 className="h-4 w-4 text-green-700 dark:text-green-400 shrink-0" />
      ) : (
        <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="font-medium">{TARGET_LABEL[result.target]}</div>
        {result.ok ? (
          <div className="text-xs text-muted-foreground">
            Submitted {result.submitted} URL{result.submitted === 1 ? "" : "s"}
            {typeof result.status === "number" ? ` · HTTP ${result.status}` : ""}
          </div>
        ) : missingCredentials ? (
          <div className="text-xs text-muted-foreground">
            Credentials missing — {result.error}. See <code>docs/seo-env.md</code>.
          </div>
        ) : (
          <div className="text-xs text-destructive">
            {result.error || "Submission failed"}
            {typeof result.status === "number" ? ` · HTTP ${result.status}` : ""}
          </div>
        )}
      </div>
    </li>
  );
}
