import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import type { DailyRow, DimRow } from "@/lib/traffic-selection";

export const TOOLTIP_STYLE = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  color: "hsl(var(--foreground))",
  fontSize: 12,
};

export const SESSIONS_DEFINITION =
  "Sessions includes Orion recorded visits; not unique people across properties.";

const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : v.toLocaleString());

export function Metric({
  label, value, note, loading, tone = "default", testid,
}: {
  label: string;
  value: number | string | null;
  note?: ReactNode;
  loading?: boolean;
  tone?: "default" | "hero";
  testid: string;
}) {
  return (
    <Card className={`p-5 ${tone === "hero" ? "border-primary/40 bg-primary/[0.04]" : ""}`} data-testid={testid}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      {loading ? (
        <Skeleton className="h-9 w-28 mt-1" />
      ) : (
        <div className={`${tone === "hero" ? "text-4xl" : "text-3xl"} font-semibold mt-1 tabular-nums`}>
          {typeof value === "number" ? value.toLocaleString() : value ?? "n/a"}
        </div>
      )}
      {note && <div className="text-xs text-muted-foreground mt-1">{note}</div>}
    </Card>
  );
}

export function SourceStatus({
  kind, message, onRetry, testid,
}: { kind: "partial" | "stale" | "error"; message: string; onRetry?: () => void; testid: string }) {
  const cls = kind === "stale"
    ? "border-amber-500/40 bg-amber-500/10"
    : "border-destructive/40 bg-destructive/10";
  return (
    <div role={kind === "error" ? "alert" : "status"} className={`flex flex-wrap gap-2 items-center rounded-md border p-2.5 text-xs ${cls}`} data-testid={testid}>
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
      <span className="flex-1 min-w-0">{message}</span>
      {onRetry && (
        <Button size="sm" variant="outline" className="h-7" onClick={onRetry} data-testid={`${testid}-retry`}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function TrendCard({
  rows, loading, showLocal, showOrion,
}: { rows: (DailyRow & { sessions?: number })[]; loading: boolean; showLocal: boolean; showOrion: boolean }) {
  const data = rows.map((r) => ({
    ...r,
    day: new Date(`${r.date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
  }));
  return (
    <Card className="p-5 lg:col-span-2" data-testid="card-trend">
      <div className="text-sm font-medium mb-1">Traffic over time</div>
      <div className="text-xs text-muted-foreground mb-4">
        Daily sessions{showOrion ? " (local sessions + Orion visits)" : ""}
        {showLocal ? " and local pageviews" : ""}, UTC days. {showOrion ? SESSIONS_DEFINITION : ""}
      </div>
      {loading ? (
        <Skeleton className="h-64" />
      ) : data.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">No traffic in this window.</div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <defs>
              <linearGradient id="sessGradC" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="day" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Area type="monotone" dataKey="sessions" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#sessGradC)" name="Sessions" />
            {showLocal && showOrion && (
              <Area type="monotone" dataKey="orionVisits" stroke="hsl(var(--chart-2))" strokeWidth={1.5} strokeDasharray="4 3" fill="none" name="of which Orion visits" />
            )}
            {showLocal && (
              <Area type="monotone" dataKey="localPageviews" stroke="hsl(var(--chart-4))" strokeWidth={1.5} fill="none" name="Local pageviews" />
            )}
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

export function DimensionCard({
  title, head, rows, showLocal, showOrion, loading, testid, note,
}: {
  title: string;
  head: string;
  rows: DimRow[];
  showLocal: boolean;
  showOrion: boolean;
  loading: boolean;
  testid: string;
  note?: string;
}) {
  return (
    <Card className="p-5 min-w-0" data-testid={testid}>
      <div className="text-sm font-medium mb-1">{title}</div>
      <div className="text-xs text-muted-foreground mb-3">
        {note ?? (showLocal && showOrion ? "Local sessions and Orion visits shown per source, then combined." : showOrion ? "Orion recorded visits." : "Local sessions.")}
      </div>
      {loading ? (
        <Skeleton className="h-40" />
      ) : rows.length === 0 ? (
        <div className="text-sm text-muted-foreground py-4 text-center">No data in this window.</div>
      ) : (
        <div className="overflow-x-auto max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="text-left py-1.5 font-medium">{head}</th>
                {showLocal && <th className="text-right py-1.5 font-medium">Local sessions</th>}
                {showOrion && <th className="text-right py-1.5 font-medium">Orion visits</th>}
                {showLocal && showOrion && <th className="text-right py-1.5 font-medium">Sessions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.slice(0, 15).map((r) => (
                <tr key={r.key} data-testid={`${testid}-row-${r.key}`}>
                  <td className="py-1.5 pr-2 break-all">{r.key}</td>
                  {showLocal && <td className="py-1.5 text-right tabular-nums">{fmt(r.local)}</td>}
                  {showOrion && <td className="py-1.5 text-right tabular-nums">{fmt(r.orion)}</td>}
                  {showLocal && showOrion && (
                    <td className="py-1.5 text-right tabular-nums font-medium">
                      {r.local === null || r.orion === null ? "partial" : fmt(r.local + r.orion)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
