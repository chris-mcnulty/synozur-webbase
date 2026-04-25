import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Pencil,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { editorPathForSource } from "./_collateral-helpers";

// Read-only diagnostic surface for the collateral library. Calls
// /api/cms/collateral/audit which scans collateral and the source-of-truth
// tables for drift, then renders findings as collapsible sections so an
// editor can see each offending row and click through to fix it.
//
// All findings are advisory — this page never mutates anything.

interface UrlDriftFinding {
  id: string;
  slug: string;
  type: string;
  currentUrl: string;
  expectedUrl: string;
}
interface SourceIdFormatFinding {
  id: string;
  slug: string;
  type: string;
  sourceId: string;
}
interface TypeMismatchFinding {
  id: string;
  slug: string;
  type: string;
  sourceId: string;
  sourcePrefix: string;
  expectedTypes: string[];
}
interface DuplicateSourceIdFinding {
  sourceId: string;
  collateral: Array<{
    id: string;
    slug: string;
    type: string;
    active: boolean;
  }>;
}
interface OrphanedSyncFinding {
  id: string;
  slug: string;
  type: string;
  sourceId: string;
  reason: string;
}
interface MissingMirrorRow {
  id: string;
  slug: string;
  title: string;
}
interface CountMismatchFinding {
  sourceTable: string;
  publishedActive: number;
  activeMirrors: number;
  delta: number;
}

interface AuditReport {
  generatedAt: string;
  totals: {
    collateralRows: number;
    syncedRows: number;
    standaloneRows: number;
  };
  findings: {
    urlDrift: UrlDriftFinding[];
    sourceIdFormatDrift: SourceIdFormatFinding[];
    typeMismatch: TypeMismatchFinding[];
    duplicateSourceId: DuplicateSourceIdFinding[];
    orphanedSync: OrphanedSyncFinding[];
    missingMirror: Record<string, MissingMirrorRow[]>;
    countMismatch: CountMismatchFinding[];
  };
}

async function fetchAudit(): Promise<AuditReport> {
  const res = await fetch("/api/cms/collateral/audit", { credentials: "include" });
  if (!res.ok) throw new Error(`Audit failed: ${res.status} ${res.statusText}`);
  return res.json();
}

function FindingSection({
  title,
  description,
  count,
  children,
}: {
  title: string;
  description: string;
  count: number;
  children: React.ReactNode;
}) {
  const ok = count === 0;
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {ok ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
            )}
            <h2 className="text-base font-semibold">{title}</h2>
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${
                ok
                  ? "bg-emerald-500/10 text-emerald-500"
                  : "bg-amber-500/10 text-amber-500"
              }`}
            >
              {count}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        </div>
      </div>
      {!ok && children}
    </Card>
  );
}

function CollateralEditLink({ id, slug }: { id: string; slug: string }) {
  return (
    <Link href={`/library/collateral/${id}/edit`}>
      <a className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
        <Pencil className="h-3 w-3" />
        {slug}
      </a>
    </Link>
  );
}

export default function AdminCollateralAudit() {
  const auditQ = useQuery({
    queryKey: ["collateral-audit"],
    queryFn: fetchAudit,
    // Always refetch on mount so editors see fresh state after fixing rows.
    staleTime: 0,
    refetchOnMount: "always",
  });

  return (
    <AdminLayout
      title="Library audit"
      crumbs={[
        { label: "Admin", href: "/" },
        { label: "Library", href: "/library/collateral" },
        { label: "Audit" },
      ]}
      actions={
        <Button
          variant="outline"
          onClick={() => auditQ.refetch()}
          disabled={auditQ.isFetching}
          data-testid="button-refresh-audit"
        >
          <RefreshCw
            className={`h-4 w-4 mr-1 ${auditQ.isFetching ? "animate-spin" : ""}`}
          />
          {auditQ.isFetching ? "Scanning…" : "Re-scan"}
        </Button>
      }
    >
      {auditQ.isLoading && (
        <div className="text-sm text-muted-foreground">Running audit…</div>
      )}

      {auditQ.error && (
        <Card className="p-4 border-destructive/40 bg-destructive/5">
          <div className="text-sm text-destructive">
            Audit failed: {(auditQ.error as Error).message}
          </div>
        </Card>
      )}

      {auditQ.data && (
        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
              <span>
                <strong className="text-2xl tabular-nums">
                  {auditQ.data.totals.collateralRows}
                </strong>{" "}
                <span className="text-muted-foreground">collateral rows</span>
              </span>
              <span>
                <strong className="tabular-nums">
                  {auditQ.data.totals.syncedRows}
                </strong>{" "}
                <span className="text-muted-foreground">synced</span>
              </span>
              <span>
                <strong className="tabular-nums">
                  {auditQ.data.totals.standaloneRows}
                </strong>{" "}
                <span className="text-muted-foreground">standalone</span>
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                Generated{" "}
                {new Date(auditQ.data.generatedAt).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
            </div>
          </Card>

          <FindingSection
            title="URL drift"
            description="collateral.url doesn't match the canonical /<type>/<slug> shape. Fix by re-saving the row in the dedicated editor (which re-derives the URL server-side)."
            count={auditQ.data.findings.urlDrift.length}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Slug</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Current</TableHead>
                  <TableHead>Expected</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditQ.data.findings.urlDrift.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell>
                      <CollateralEditLink id={f.id} slug={f.slug} />
                    </TableCell>
                    <TableCell className="text-xs">{f.type}</TableCell>
                    <TableCell className="text-xs font-mono">
                      {f.currentUrl}
                    </TableCell>
                    <TableCell className="text-xs font-mono text-emerald-500">
                      {f.expectedUrl}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </FindingSection>

          <FindingSection
            title="sourceId format drift"
            description='collateral.sourceId should be "<prefix>:<uuid>" for synced rows. Raw UUIDs or other formats indicate a sync that pre-dates the current format. Re-save at the source to fix.'
            count={auditQ.data.findings.sourceIdFormatDrift.length}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Slug</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>sourceId</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditQ.data.findings.sourceIdFormatDrift.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell>
                      <CollateralEditLink id={f.id} slug={f.slug} />
                    </TableCell>
                    <TableCell className="text-xs">{f.type}</TableCell>
                    <TableCell className="text-xs font-mono">
                      {f.sourceId}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </FindingSection>

          <FindingSection
            title="Type mismatch"
            description="The sourceId prefix doesn't match the collateral.type. Either the type is wrong on the row or the sourceId points at the wrong source table."
            count={auditQ.data.findings.typeMismatch.length}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Slug</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Source prefix</TableHead>
                  <TableHead>Expected types</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditQ.data.findings.typeMismatch.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell>
                      <CollateralEditLink id={f.id} slug={f.slug} />
                    </TableCell>
                    <TableCell className="text-xs">{f.type}</TableCell>
                    <TableCell className="text-xs font-mono">
                      {f.sourcePrefix}
                    </TableCell>
                    <TableCell className="text-xs">
                      {f.expectedTypes.join(", ")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </FindingSection>

          <FindingSection
            title="Duplicate sourceId"
            description="Multiple collateral rows point at the same source. Sync only updates one of them; the other will become stale. Pick one canonical row and unlink (clear sourceId) on the others."
            count={auditQ.data.findings.duplicateSourceId.length}
          >
            <div className="space-y-3">
              {auditQ.data.findings.duplicateSourceId.map((dup) => (
                <div key={dup.sourceId} className="text-sm">
                  <div className="text-xs font-mono text-muted-foreground">
                    {dup.sourceId}
                  </div>
                  <ul className="ml-4 mt-1 space-y-1">
                    {dup.collateral.map((c) => (
                      <li key={c.id} className="text-xs">
                        <CollateralEditLink id={c.id} slug={c.slug} />
                        <span className="ml-2 text-muted-foreground">
                          ({c.type}, {c.active ? "active" : "inactive"})
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </FindingSection>

          <FindingSection
            title="Orphaned sync"
            description="The sourceId points at a source row that's missing, soft-deleted, or unpublished, but the collateral mirror is still active. Either re-publish the source or hide the mirror."
            count={auditQ.data.findings.orphanedSync.length}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Slug</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>sourceId</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditQ.data.findings.orphanedSync.map((f) => {
                  const editorPath = editorPathForSource(f.sourceId);
                  return (
                    <TableRow key={f.id}>
                      <TableCell>
                        <CollateralEditLink id={f.id} slug={f.slug} />
                      </TableCell>
                      <TableCell className="text-xs">{f.type}</TableCell>
                      <TableCell className="text-xs font-mono">
                        {f.sourceId}
                        {editorPath && (
                          <Link href={editorPath}>
                            <a
                              className="ml-2 inline-flex items-center text-primary hover:underline"
                              title="Open source editor"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </Link>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{f.reason}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </FindingSection>

          <FindingSection
            title="Missing mirror"
            description="A published source row has no active collateral mirror — invisible to the public library. Re-save the source row to trigger sync, or check the source's status."
            count={Object.values(auditQ.data.findings.missingMirror).reduce(
              (sum, list) => sum + list.length,
              0,
            )}
          >
            <div className="space-y-3">
              {Object.entries(auditQ.data.findings.missingMirror).map(
                ([sourceTable, rows]) => (
                  <div key={sourceTable} className="text-sm">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      {sourceTable} ({rows.length})
                    </div>
                    <ul className="ml-4 mt-1 space-y-1">
                      {rows.map((r) => (
                        <li key={r.id} className="text-xs">
                          <span className="font-mono">{r.slug}</span>
                          <span className="ml-2 text-muted-foreground">
                            — {r.title}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ),
              )}
            </div>
          </FindingSection>

          <FindingSection
            title="Count mismatch"
            description="For each source table, the number of published-active rows should equal the number of active mirrors of expected types in collateral."
            count={auditQ.data.findings.countMismatch.length}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source table</TableHead>
                  <TableHead className="text-right">Published-active</TableHead>
                  <TableHead className="text-right">Active mirrors</TableHead>
                  <TableHead className="text-right">Delta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditQ.data.findings.countMismatch.map((f) => (
                  <TableRow key={f.sourceTable}>
                    <TableCell className="text-xs font-mono">
                      {f.sourceTable}
                    </TableCell>
                    <TableCell className="text-xs text-right tabular-nums">
                      {f.publishedActive}
                    </TableCell>
                    <TableCell className="text-xs text-right tabular-nums">
                      {f.activeMirrors}
                    </TableCell>
                    <TableCell className="text-xs text-right tabular-nums">
                      <span
                        className={
                          f.delta > 0
                            ? "text-amber-500"
                            : f.delta < 0
                              ? "text-red-500"
                              : ""
                        }
                      >
                        {f.delta > 0 ? `+${f.delta}` : f.delta}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </FindingSection>
        </div>
      )}
    </AdminLayout>
  );
}
