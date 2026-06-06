import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, AlertCircle, RefreshCcw, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AdminLayout } from "@/components/admin/AdminLayout";

// Launch-readiness diagnostic surface (Tier 1 L2 / L3 / L5).
//
// Mirrors the startup-log emitter `logLaunchReadiness()` so an admin
// can see at a glance which production secrets are wired without
// grepping the server logs after a deploy. Backed by
// GET /api/cms/launch-readiness, gated on the `site.manage` capability.

interface ChannelStatus {
  name: string;
  configured: boolean;
  source?: string;
  detail?: string;
  // #254 — most-recent unpublish-submission attempt for this channel,
  // surfaced so an operator can confirm IndexNow / Google Indexing /
  // Bing Webmaster were actually pinged after archiving content.
  lastUnpublishSubmission?: {
    submittedAt: string;
    ok: boolean;
    httpStatus: number | null;
    url: string;
    error: string | null;
  } | null;
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const diffMs = Date.now() - then;
  if (diffMs < 60_000) return "just now";
  const mins = Math.round(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

interface LaunchReadinessGroup {
  tier: "L2" | "L3" | "L5" | "TRUST";
  label: string;
  channels: ChannelStatus[];
}

interface LaunchReadinessReport {
  generatedAt: string;
  groups: LaunchReadinessGroup[];
}

function apiFetch<T>(path: string): Promise<T> {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  return fetch(`${base}${path}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  }).then(async (r) => {
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error(`HTTP ${r.status}${text ? `: ${text}` : ""}`);
    }
    return r.json() as Promise<T>;
  });
}

export default function LaunchReadinessPage() {
  const { data, isLoading, isFetching, refetch } = useQuery<LaunchReadinessReport>({
    queryKey: ["launch-readiness"],
    queryFn: () => apiFetch<LaunchReadinessReport>("/api/cms/launch-readiness"),
    refetchInterval: 60_000,
  });

  const totals = computeTotals(data);

  return (
    <AdminLayout
      title="Launch Readiness"
      crumbs={[
        { label: "Site Config" },
        { label: "Launch Readiness" },
      ]}
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refetch()}
          disabled={isFetching}
          data-testid="launch-readiness-refresh"
        >
          <RefreshCcw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      }
    >
      <div className="space-y-4">
        <Card className="p-4 bg-zinc-500/5 border-zinc-500/20">
          <div className="flex gap-3">
            <Info className="w-4 h-4 text-zinc-400 mt-0.5 shrink-0" />
            <div className="text-sm text-zinc-300 space-y-1">
              <div>
                Live status of every Tier 1 configuration knob (per{" "}
                <code className="text-xs bg-zinc-800 px-1 py-0.5 rounded">backlog.md</code>{" "}
                Launch Readiness section). Mirrors the startup logs so you don't have
                to grep after a deploy.
              </div>
              <div className="text-zinc-500 text-xs">
                Refreshes automatically every 60 seconds.
                {data && (
                  <> Last refreshed {new Date(data.generatedAt).toLocaleTimeString()}.</>
                )}
              </div>
            </div>
          </div>
        </Card>

        {totals && (
          <Card className="p-4 flex items-center gap-6 flex-wrap" data-testid="launch-readiness-summary">
            <div>
              <div className="text-2xl font-semibold tabular-nums text-zinc-100">
                {totals.configured} <span className="text-zinc-500 text-base">/ {totals.total}</span>
              </div>
              <div className="text-xs text-zinc-500 uppercase tracking-wide">Channels configured</div>
            </div>
            {totals.notConfigured > 0 ? (
              <Badge variant="outline" className="bg-amber-500/10 text-amber-300 border-amber-500/20">
                {totals.notConfigured} not yet set
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-green-500/10 text-green-300 border-green-500/20">
                All channels configured
              </Badge>
            )}
          </Card>
        )}

        {isLoading && (
          <Card className="p-12 text-center text-zinc-500">Loading launch-readiness report…</Card>
        )}

        {data?.groups.map((group) => (
          <GroupCard key={group.tier} group={group} />
        ))}
      </div>
    </AdminLayout>
  );
}

function computeTotals(report: LaunchReadinessReport | undefined): {
  configured: number;
  notConfigured: number;
  total: number;
} | null {
  if (!report) return null;
  let configured = 0;
  let notConfigured = 0;
  for (const g of report.groups) {
    for (const c of g.channels) {
      if (c.configured) configured++;
      else notConfigured++;
    }
  }
  return { configured, notConfigured, total: configured + notConfigured };
}

function GroupCard({ group }: { group: LaunchReadinessGroup }) {
  const allConfigured = group.channels.every((c) => c.configured);

  return (
    <Card className="p-5" data-testid={`launch-readiness-group-${group.tier}`}>
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
              {group.tier}
            </span>
            <h2 className="text-sm font-medium text-zinc-200">{group.label}</h2>
          </div>
        </div>
        {allConfigured ? (
          <Badge variant="outline" className="bg-green-500/10 text-green-300 border-green-500/20">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Ready
          </Badge>
        ) : (
          <Badge variant="outline" className="bg-amber-500/10 text-amber-300 border-amber-500/20">
            <AlertCircle className="w-3 h-3 mr-1" />
            Action needed
          </Badge>
        )}
      </div>

      <div className="space-y-2">
        {group.channels.map((channel) => (
          <div
            key={channel.name}
            className="flex items-start gap-3 p-3 rounded-md bg-zinc-900/50 border border-zinc-800"
            data-testid={`launch-readiness-channel-${channel.name}`}
          >
            {channel.configured ? (
              <CheckCircle2 className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-zinc-100">{channel.name}</div>
              <div className="text-xs text-zinc-500">
                {channel.configured ? "Configured" : "Not configured"}
                {channel.source && (
                  <>
                    {" · "}
                    <code className="bg-zinc-800 px-1 py-0.5 rounded text-zinc-400">
                      {channel.source}
                    </code>
                  </>
                )}
              </div>
              {channel.detail && (
                <div className="text-xs text-amber-400 mt-1">{channel.detail}</div>
              )}
              {channel.lastUnpublishSubmission ? (
                <div
                  className={`text-xs mt-1 ${
                    channel.lastUnpublishSubmission.ok
                      ? "text-zinc-400"
                      : "text-amber-400"
                  }`}
                  data-testid={`launch-readiness-channel-${channel.name}-last-unpublish`}
                >
                  Last unpublish ping:{" "}
                  {channel.lastUnpublishSubmission.ok ? "ok" : "failed"}
                  {channel.lastUnpublishSubmission.httpStatus != null && (
                    <> ({channel.lastUnpublishSubmission.httpStatus})</>
                  )}
                  {" · "}
                  {formatRelative(channel.lastUnpublishSubmission.submittedAt)}
                  {" · "}
                  <span className="text-zinc-500 break-all">
                    {channel.lastUnpublishSubmission.url}
                  </span>
                  {channel.lastUnpublishSubmission.error && (
                    <div className="text-amber-400/80 mt-0.5">
                      {channel.lastUnpublishSubmission.error}
                    </div>
                  )}
                </div>
              ) : channel.lastUnpublishSubmission === null && channel.configured ? (
                <div className="text-xs text-zinc-500 mt-1">
                  No unpublish pings recorded yet.
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
