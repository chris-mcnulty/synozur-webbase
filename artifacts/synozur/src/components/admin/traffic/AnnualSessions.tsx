import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarRange } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trafficApi } from "@/lib/traffic-api";
import { useOrionSnapshot, useTrafficWindow } from "@/hooks/use-orion-snapshot";
import { annualWindow, combineSessions, CORE_SOURCE_SLUGS } from "@/lib/traffic-selection";
import { Metric, SourceStatus, SESSIONS_DEFINITION } from "./TrafficParts";

/**
 * Primary marketing metric: sessions per calendar year for Core (WWW) and
 * All properties. Independent of the report range and property selection.
 */
export function AnnualSessions({
  enabled, localSlugsReady, allLocalSlugs, propertyListError,
}: { enabled: boolean; localSlugsReady: boolean; allLocalSlugs: string[]; propertyListError: boolean }) {
  const today = useTrafficWindow("ytd");
  const nowYear = Number(today.to.slice(0, 4));
  const [year, setYear] = useState(nowYear);
  const win = useMemo(() => annualWindow(year, new Date(today.to)), [year, today.to]);
  const isYtd = year === nowYear;
  const base = { from: win.from, to: win.to, includeBots: "false" as const };

  const coreQ = useQuery({
    queryKey: ["traffic-annual", "core", win, CORE_SOURCE_SLUGS],
    queryFn: () => trafficApi.overview({ ...base, propertySlugs: CORE_SOURCE_SLUGS }),
    enabled,
    refetchInterval: enabled ? 60000 : false,
  });
  const allQ = useQuery({
    queryKey: ["traffic-annual", "all-local", win, allLocalSlugs],
    queryFn: () => trafficApi.overview({ ...base, propertySlugs: allLocalSlugs }),
    enabled: enabled && localSlugsReady && allLocalSlugs.length > 0,
    refetchInterval: enabled && localSlugsReady ? 60000 : false,
  });
  const orion = useOrionSnapshot(win, enabled);

  const allLocalSessions = allQ.data ? allQ.data.totals.sessions : null;
  const orionVisits = orion.snap ? orion.snap.data.totalVisits : null;
  const all = combineSessions(allLocalSessions, orionVisits, true, true);
  const yearLabel = isYtd ? `${year} year to date` : `${year} full year`;

  return (
    <section className="mb-6" aria-labelledby="annual-heading" data-testid="section-annual-sessions">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-2">
        <div>
          <h2 id="annual-heading" className="text-sm font-medium flex items-center gap-2">
            <CalendarRange className="h-4 w-4 text-primary" aria-hidden /> Annual sessions
          </h2>
          <div className="text-xs text-muted-foreground">
            Primary marketing metric. Calendar year in UTC; local sessions exclude bots. Orion visits use Orion’s own counting rules. Independent of the filters below.
          </div>
        </div>
        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger className="w-[190px] h-8 text-xs" data-testid="select-annual-year">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[0, 1, 2, 3].map((d) => (
              <SelectItem key={d} value={String(nowYear - d)}>
                {d === 0 ? `${nowYear} (year to date)` : `${nowYear - d} (full year)`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Metric
          tone="hero"
          testid="stat-annual-core-sessions"
          label={`Core (WWW) sessions, ${yearLabel}`}
          value={coreQ.isError ? "Unavailable" : coreQ.data?.totals.sessions ?? null}
          loading={coreQ.isLoading}
          note="WWW sessions: imported Wix history plus current Synozur tracking."
        />
        <Metric
          tone="hero"
          testid="stat-annual-all-sessions"
          label={`All properties sessions, ${yearLabel}`}
          value={propertyListError ? "Unavailable" : all.value}
          loading={(!localSlugsReady && !propertyListError) || (localSlugsReady && allLocalSlugs.length > 0 && allQ.isLoading) || orion.isLoading}
          note={
            <>
              Local sessions {allLocalSessions?.toLocaleString() ?? "n/a"} + Orion visits{" "}
              {orionVisits?.toLocaleString() ?? "n/a"}. {SESSIONS_DEFINITION}
            </>
          }
        />
      </div>
      <div className="mt-2 space-y-2">
        <p className="text-xs text-muted-foreground" data-testid="annual-core-coverage">
          WWW totals include both tracking sources. Transition-period coverage overlaps in the retained records; totals covering that period are provisional until the cutover is confirmed.
        </p>
        {coreQ.isError && <SourceStatus kind="error" testid="status-annual-core-error" message="Core annual sessions could not be loaded." onRetry={() => coreQ.refetch()} />}
        {allQ.isError && <SourceStatus kind="error" testid="status-annual-all-error" message="Local annual sessions could not be loaded. The All properties total is partial if Orion visits are available." onRetry={() => allQ.refetch()} />}
        {propertyListError && <SourceStatus kind="error" testid="status-annual-properties-error" message="Property coverage could not be loaded; All properties sessions are unavailable." />}
        {orion.isError && !orion.isLoading && (
          <SourceStatus kind="partial" testid="status-annual-orion-partial" message="Orion snapshot unavailable: All properties total is partial (local sessions only)." onRetry={orion.retry} />
        )}
        {orion.isStale && (
          <SourceStatus kind="stale" testid="status-annual-orion-stale" message="Orion visits are from the last successful snapshot and may be stale." />
        )}
      </div>
    </section>
  );
}

