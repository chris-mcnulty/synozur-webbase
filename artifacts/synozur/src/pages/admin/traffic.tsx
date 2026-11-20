import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Bot, Download, Check, ChevronDown, Orbit } from "lucide-react";
import { ResponsiveContainer, Tooltip, PieChart, Pie, Cell } from "recharts";
import { OrionTrafficPanel } from "@/components/admin/OrionTrafficPanel";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useAdminAccess } from "@/components/admin/AdminGate";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { trafficApi, type TrafficFilters } from "@/lib/traffic-api";
import { trafficPropertiesApi } from "@/lib/traffic-properties-api";
import { useOrionSnapshot, useTrafficWindow } from "@/hooks/use-orion-snapshot";
import {
  ALL_SLUG, DEFAULT_SLUG, ORION_SLUG, parseSelection, serializeSelection, toggleSelection,
  resolveSelection, mergeDimension, mergeDaily, withCombinedSessions, combineSessions,
  CORE_SOURCE_SLUGS, groupPropertyRows,
} from "@/lib/traffic-selection";
import { AnnualSessions } from "@/components/admin/traffic/AnnualSessions";
import {
  TOOLTIP_STYLE, SESSIONS_DEFINITION, Metric, SourceStatus, TrendCard, DimensionCard,
} from "@/components/admin/traffic/TrafficParts";

const SOURCE_COLORS: Record<string, string> = {
  direct: "#64748b", organic: "#10b981", ai: "#8b5cf6", referral: "#3b82f6",
  social: "#ec4899", paid: "#f59e0b", internal: "#94a3b8", unknown: "#cbd5e1",
};

function formatMs(ms: number | null): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

type RangePreset = "7" | "30" | "90" | "183" | "ytd" | "365";
const PRESET_LABELS: Record<RangePreset, string> = {
  "7": "Last 7 days", "30": "Last 30 days", "90": "Last 90 days",
  "183": "Last 6 months", ytd: "Year to date", "365": "Last 12 months",
};

export default function AdminTraffic() {
  const { access } = useAdminAccess();
  const [rangePreset, setRangePreset] = useState<RangePreset>("30");
  const [includeBots, setIncludeBots] = useState<"false" | "true" | "only">("false");
  const [pageType, setPageType] = useState<string>("");
  const [device, setDevice] = useState<string>("");
  const [detailOpen, setDetailOpen] = useState(false);
  const [location, setLocation] = useLocation();
  const [selection, setSelection] = useState<string[]>(() =>
    typeof window === "undefined" ? [DEFAULT_SLUG] : parseSelection(new URLSearchParams(window.location.search).get("properties")),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const ser = serializeSelection(selection);
    if (ser === null) params.delete("properties");
    else params.set("properties", ser);
    const qs = params.toString();
    const basePath = location.split("?")[0]!;
    const next = qs ? `${basePath}?${qs}` : basePath;
    if (next !== location) setLocation(next, { replace: true });
  }, [selection, location, setLocation]);

  const enabled = !!access?.isEditorOrAbove;
  const propsListQ = useQuery({
    queryKey: ["traffic-properties"],
    queryFn: () => trafficPropertiesApi.list(),
    enabled,
  });
  // Orion is a synthetic entry; drop any DB record with the same slug.
  const localProps = useMemo(
    () => (propsListQ.data?.items ?? []).filter((p) => p.slug !== ORION_SLUG),
    [propsListQ.data],
  );
  const knownLocalSlugs = useMemo(
    () => resolveSelection([ALL_SLUG], localProps.map((p) => p.slug)).localSlugs,
    [localProps],
  );
  const propsReady = propsListQ.isSuccess;
  const sel = useMemo(() => resolveSelection(selection, knownLocalSlugs), [selection, knownLocalSlugs]);
  const hasLocal = sel.localSlugs.length > 0;
  const showOrion = sel.includeOrion;
  const nameOf = (slug: string) =>
    slug === DEFAULT_SLUG ? "WWW (synozur.com)" : slug === ORION_SLUG ? "Orion" : localProps.find((p) => p.slug === slug)?.name ?? slug;

  const win = useTrafficWindow(rangePreset);
  const filters = useMemo<TrafficFilters>(
    () => ({
      from: win.from,
      to: win.to,
      includeBots,
      pageType: pageType || undefined,
      device: (device as TrafficFilters["device"]) || undefined,
      propertySlugs: sel.localSlugs,
    }),
    [win, includeBots, pageType, device, sel.localSlugs],
  );
  // Local queries never run for an Orion-only selection, and All waits for the
  // property list so it always sends explicit local slugs.
  const localEnabled = enabled && hasLocal && (!sel.isAll || propsReady);
  const orion = useOrionSnapshot(win, enabled && showOrion);

  const overviewQ = useQuery({ queryKey: ["traffic-overview", filters], queryFn: () => trafficApi.overview(filters), enabled: localEnabled });
  const byPropertyFilters = useMemo<TrafficFilters>(() => ({ ...filters, propertySlugs: knownLocalSlugs }), [filters, knownLocalSlugs]);
  const byPropertyQ = useQuery({
    queryKey: ["traffic-by-property", byPropertyFilters],
    queryFn: () => trafficApi.byProperty(byPropertyFilters),
    enabled: enabled && propsReady && knownLocalSlugs.length > 0,
  });
  const propertyRows = useMemo(() => groupPropertyRows(byPropertyQ.data?.items ?? []), [byPropertyQ.data]);
  const seriesQ = useQuery({ queryKey: ["traffic-series", filters], queryFn: () => trafficApi.timeseries(filters), enabled: localEnabled });
  const pagesQ = useQuery({ queryKey: ["traffic-pages", filters], queryFn: () => trafficApi.pages(filters), enabled: localEnabled });
  const sourcesQ = useQuery({ queryKey: ["traffic-sources", filters], queryFn: () => trafficApi.sources(filters), enabled: localEnabled });
  const devicesQ = useQuery({ queryKey: ["traffic-devices", filters], queryFn: () => trafficApi.devices(filters), enabled: localEnabled });
  const countriesQ = useQuery({ queryKey: ["traffic-countries", filters], queryFn: () => trafficApi.countries(filters), enabled: localEnabled });
  const aiQ = useQuery({ queryKey: ["traffic-ai", filters], queryFn: () => trafficApi.aiCrawlers(filters), enabled: localEnabled });
  const utmQ = useQuery({ queryKey: ["traffic-utms", filters], queryFn: () => trafficApi.utms(filters), enabled: localEnabled });
  const eventsQ = useQuery({ queryKey: ["traffic-events", filters], queryFn: () => trafficApi.events(filters), enabled: localEnabled });

  const od = orion.snap?.data ?? null;
  const localLoading = hasLocal && !propsListQ.isError && (!localEnabled || overviewQ.isLoading);
  const sessions = combineSessions(overviewQ.data?.totals.sessions ?? null, od?.totalVisits ?? null, showOrion, hasLocal);

  const trendRows = useMemo(
    () => withCombinedSessions(mergeDaily(hasLocal ? seriesQ.data?.series ?? null : null, showOrion ? od?.byDate ?? null : null, win)),
    [hasLocal, showOrion, seriesQ.data, od, win],
  );
  const L = <T,>(v: T | undefined) => (hasLocal ? v ?? null : null);
  const O = <T,>(v: T | undefined) => (showOrion ? v ?? null : null);
  const deviceRows = mergeDimension(
    L(devicesQ.data?.byDevice.map((d) => ({ key: d.deviceType.toLowerCase(), count: d.sessions }))),
    O(od?.byDevice.map((d) => ({ key: d.device.toLowerCase(), count: d.count }))),
  );
  const countryRows = mergeDimension(
    L(countriesQ.data?.items.map((d) => ({ key: d.country.toUpperCase(), count: d.sessions }))),
    O(od?.byCountry.map((d) => ({ key: d.country.toUpperCase(), count: d.count }))),
  );
  const browserRows = mergeDimension(
    L(devicesQ.data?.byBrowser.map((d) => ({ key: d.browser, count: d.sessions }))),
    O(od?.byBrowser.map((d) => ({ key: d.browser, count: d.count }))),
  );
  const dimLoading = (hasLocal && (devicesQ.isLoading || countriesQ.isLoading || !localEnabled)) || (showOrion && orion.isLoading);

  const sourcePie = (sourcesQ.data?.bySource ?? []).map((s) => ({
    name: s.source, value: s.sessions, color: SOURCE_COLORS[s.source] ?? SOURCE_COLORS.unknown,
  }));

  const propertyButtonLabel = sel.isAll
    ? "All properties"
    : selection.length === 1 ? nameOf(selection[0]!) : `${selection.length} properties`;
  const localOnlyHint = sel.mode === "mixed" ? " (local only)" : "";
  const filtersDisabled = sel.mode === "orion";

  const csv = (href: string, label: string, testid: string) =>
    hasLocal ? (
      <Button asChild variant="outline" size="sm" title={showOrion ? "Exports local properties only; Orion is not included." : undefined}>
        <a href={href} download data-testid={testid}>
          <Download className="h-4 w-4 mr-1" /> {label}{showOrion ? " (local only)" : ""}
        </a>
      </Button>
    ) : (
      <Button variant="outline" size="sm" disabled title="CSV exports cover local properties only" data-testid={testid}>
        <Download className="h-4 w-4 mr-1" /> {label} (local only)
      </Button>
    );

  return (
    <AdminLayout
      title="Traffic Analytics"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Traffic" }]}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {csv(trafficApi.overviewCsvUrl(filters), "Overview CSV", "button-csv-overview")}
          {csv(trafficApi.sessionsCsvUrl(filters), "Sessions CSV", "button-csv-sessions")}
          {csv(trafficApi.exportCsvUrl(filters), "Pageviews CSV", "button-csv-pageviews")}
        </div>
      }
    >
      {!access?.isEditorOrAbove ? (
        <Card className="p-6 bg-muted/30">
          <p className="text-sm">You don&apos;t have access to site traffic analytics.</p>
        </Card>
      ) : (
        <>
          <AnnualSessions enabled={enabled} localSlugsReady={propsReady} allLocalSlugs={knownLocalSlugs} propertyListError={propsListQ.isError} />
          {propsListQ.isError && <SourceStatus kind="error" testid="status-properties-error" message="The property list could not be loaded. All-properties coverage is unavailable." onRetry={() => propsListQ.refetch()} />}

          <Card className="p-4 mb-6">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <div className="text-xs text-muted-foreground mb-1">Properties</div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 text-xs min-w-[200px] justify-between" data-testid="btn-property-filter">
                      <span className="truncate">{propertyButtonLabel}</span>
                      <ChevronDown className="h-3 w-3 ml-1 opacity-60" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-64">
                    <DropdownMenuLabel className="text-xs">Properties to include</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuCheckboxItem checked={sel.isAll} onCheckedChange={() => setSelection((p) => toggleSelection(p, ALL_SLUG))} data-testid="property-option-all">
                      All properties (incl. Orion)
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuCheckboxItem
                      checked={!sel.isAll && selection.includes(DEFAULT_SLUG)}
                      onCheckedChange={() => setSelection((p) => toggleSelection(p, DEFAULT_SLUG))}
                      data-testid="property-option-synozur"
                    >
                      <span className="flex-1 truncate">WWW (synozur.com)</span>
                      <Check className="h-3 w-3 ml-1 text-muted-foreground" />
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={!sel.isAll && selection.includes(ORION_SLUG)}
                      onCheckedChange={() => setSelection((p) => toggleSelection(p, ORION_SLUG))}
                      data-testid="property-option-orion"
                    >
                      <span className="flex-1 truncate">Orion</span>
                      <span className="text-[10px] text-muted-foreground ml-1">live snapshot</span>
                    </DropdownMenuCheckboxItem>
                    {localProps.filter((p) => !CORE_SOURCE_SLUGS.includes(p.slug)).map((p) => (
                      <DropdownMenuCheckboxItem
                        key={p.id}
                        checked={!sel.isAll && selection.includes(p.slug)}
                        onCheckedChange={() => setSelection((prev) => toggleSelection(prev, p.slug))}
                        data-testid={`property-option-${p.slug}`}
                      >
                        <span className="flex-1 truncate">{p.name}</span>
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Range</div>
                <Select value={rangePreset} onValueChange={(v) => setRangePreset(v as RangePreset)}>
                  <SelectTrigger className="w-[170px] h-8 text-xs" data-testid="select-range"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PRESET_LABELS) as RangePreset[]).map((k) => (
                      <SelectItem key={k} value={k}>{PRESET_LABELS[k]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Audience{localOnlyHint}</div>
                <Select disabled={filtersDisabled} value={includeBots} onValueChange={(v) => setIncludeBots(v as typeof includeBots)}>
                  <SelectTrigger className="w-[160px] h-8 text-xs" data-testid="select-audience"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="false">Humans only</SelectItem>
                    <SelectItem value="true">Humans + bots</SelectItem>
                    <SelectItem value="only">Bots only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Page type{localOnlyHint}</div>
                <Select disabled={filtersDisabled} value={pageType || "__all"} onValueChange={(v) => setPageType(v === "__all" ? "" : v)}>
                  <SelectTrigger className="w-[180px] h-8 text-xs" data-testid="select-page-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">All pages</SelectItem>
                    <SelectItem value="home">Home</SelectItem>
                    <SelectItem value="insights">Insights list</SelectItem>
                    <SelectItem value="insight-detail">Insights post</SelectItem>
                    <SelectItem value="service-detail">Service detail</SelectItem>
                    <SelectItem value="solution-detail">Solution detail</SelectItem>
                    <SelectItem value="case-study-detail">Case study</SelectItem>
                    <SelectItem value="application-detail">Application</SelectItem>
                    <SelectItem value="contact">Contact</SelectItem>
                    <SelectItem value="start">Start</SelectItem>
                    <SelectItem value="polaris">Polaris</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Device{localOnlyHint}</div>
                <Select disabled={filtersDisabled} value={device || "__all"} onValueChange={(v) => setDevice(v === "__all" ? "" : v)}>
                  <SelectTrigger className="w-[140px] h-8 text-xs" data-testid="select-device"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">All devices</SelectItem>
                    <SelectItem value="desktop">Desktop</SelectItem>
                    <SelectItem value="mobile">Mobile</SelectItem>
                    <SelectItem value="tablet">Tablet</SelectItem>
                    <SelectItem value="bot">Bot</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {sel.mode !== "local" && (
              <div className="text-xs text-muted-foreground mt-3" data-testid="text-filter-scope">
                {sel.mode === "orion"
                  ? "Orion-only: audience, page type and device filters do not apply to the Orion snapshot."
                  : "Audience, page type and device filters apply to local properties only; Orion counts are unfiltered."}{" "}
                Window (UTC): {win.from.slice(0, 10)} to {win.to.slice(0, 10)}.
              </div>
            )}
          </Card>

          {/* Selected-property overview */}
          <div className="mb-2" data-testid="text-kpi-label">
            <div className="text-sm font-medium">{propertyButtonLabel}, {PRESET_LABELS[rangePreset].toLowerCase()}</div>
            <div className="text-xs text-muted-foreground">
              {showOrion ? SESSIONS_DEFINITION : "Selected local properties."} Unique visitors and time metrics cover local properties only. Time is reported as average time on page; raw server hits and session duration are not supplied by this report.
            </div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-3">
            <Metric
              testid="stat-sessions"
              label="Sessions"
              value={sessions.value}
              loading={localLoading || (showOrion && orion.isLoading)}
              note={showOrion && hasLocal ? `Local ${overviewQ.data?.totals.sessions.toLocaleString() ?? "n/a"} + Orion ${od?.totalVisits.toLocaleString() ?? "n/a"}` : showOrion ? "Orion recorded visits" : "Local sessions"}
            />
            <Metric testid="stat-pageviews" label="Pageviews" value={hasLocal ? overviewQ.data?.totals.pageviews ?? null : "n/a"} loading={localLoading} note={showOrion ? "Local only; Orion reports visits, not pageviews" : undefined} />
            <Metric testid="stat-unique-visitors" label="Unique visitors" value={hasLocal ? overviewQ.data?.totals.uniqueVisitors ?? null : "n/a"} loading={localLoading} note={showOrion ? "Local only; Orion has no unique visitors" : undefined} />
            <Metric testid="stat-countries" label="Countries" value={(hasLocal && countriesQ.data) || od ? countryRows.length : null} loading={dimLoading} note={showOrion && hasLocal ? "Distinct reported countries; partial if a source is unavailable" : undefined} />
          </div>
          <div className="space-y-2 mb-6">
            {sel.localSlugs.includes(DEFAULT_SLUG) && (
              <p className="text-xs text-muted-foreground" data-testid="text-www-source-coverage">
                WWW combines imported Wix history and current Synozur tracking. Transition-period totals are provisional pending confirmation of the overlapping coverage; no historical records have been removed.
              </p>
            )}
            {hasLocal && overviewQ.isError && <SourceStatus kind="error" testid="status-local-error" message="Local traffic could not be loaded; any displayed combined total is partial." onRetry={() => overviewQ.refetch()} />}
            {showOrion && orion.isError && (
              <SourceStatus kind="partial" testid="status-orion-partial" message={hasLocal ? "Orion snapshot unavailable: sessions and breakdowns are partial (local only)." : "Orion snapshot unavailable; no counts shown."} onRetry={orion.retry} />
            )}
            {showOrion && orion.isStale && <SourceStatus kind="stale" testid="status-orion-stale-summary" message="Orion counts are from the last successful snapshot and may be stale." />}
            {hasLocal && (seriesQ.isError || devicesQ.isError || countriesQ.isError) && <SourceStatus kind="error" testid="status-breakdown-error" message="Some local trends or breakdowns could not be refreshed; displayed data may be partial or stale." onRetry={() => { void seriesQ.refetch(); void devicesQ.refetch(); void countriesQ.refetch(); }} />}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            <TrendCard rows={trendRows} loading={(hasLocal && (seriesQ.isLoading || !localEnabled)) || (showOrion && orion.isLoading)} showLocal={hasLocal} showOrion={showOrion && !!od} />
            <DimensionCard title="Devices" head="Device" rows={deviceRows} showLocal={hasLocal} showOrion={showOrion} loading={dimLoading} testid="card-devices" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            <DimensionCard title="Countries" head="Country" rows={countryRows} showLocal={hasLocal} showOrion={showOrion} loading={dimLoading} testid="card-countries" />
            <DimensionCard title="Browsers" head="Browser" rows={browserRows} showLocal={hasLocal} showOrion={showOrion} loading={dimLoading} testid="card-browsers" />
          </div>

          {/* By property: portfolio comparison, ignores the property filter */}
          <Card className="p-5 mb-6" data-testid="card-by-property">
            <div className="flex items-baseline justify-between mb-1">
              <div className="text-sm font-medium">By property</div>
              <div className="text-xs text-muted-foreground">Full portfolio, ignores the property filter</div>
            </div>
            <div className="text-xs text-muted-foreground mb-4">{SESSIONS_DEFINITION} Orion has no pageviews or unique visitors.</div>
            {byPropertyQ.isLoading || !propsReady ? (
              <div className="text-sm text-muted-foreground py-4 text-center">Loading…</div>
            ) : byPropertyQ.isError ? (
              <SourceStatus kind="error" testid="status-by-property-error" message="Per-property traffic could not be loaded." onRetry={() => byPropertyQ.refetch()} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 font-medium text-muted-foreground">Property</th>
                      <th className="text-right py-2 font-medium text-muted-foreground">Sessions</th>
                      <th className="text-right py-2 font-medium text-muted-foreground">Unique visitors</th>
                      <th className="text-right py-2 font-medium text-muted-foreground">Pageviews</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {propertyRows.map((row) => (
                      <tr key={row.slug} data-testid={`row-by-property-${row.slug}`}>
                        <td className="py-2">
                          <div className="font-medium">{nameOf(row.slug)}</div>
                          {row.slug === DEFAULT_SLUG ? (
                            <details className="text-xs text-muted-foreground">
                              <summary className="cursor-pointer">Tracking-source breakdown</summary>
                              <ul className="mt-1 space-y-1">
                                {row.sources.map((source) => (
                                  <li key={source.slug}>
                                    {source.slug === "wix-legacy" ? "Wix history" : "Current tracking"}: {source.sessions.toLocaleString()} sessions
                                  </li>
                                ))}
                              </ul>
                            </details>
                          ) : <div className="text-xs text-muted-foreground font-mono">{row.slug}</div>}
                        </td>
                        <td className="py-2 text-right">{row.sessions.toLocaleString()}</td>
                        <td className="py-2 text-right" title={row.uniqueVisitors === null ? "Source-level unique counts cannot be added without cross-source visitor identities." : undefined}>
                          {row.uniqueVisitors?.toLocaleString() ?? "n/a"}
                        </td>
                        <td className="py-2 text-right">{row.pageviews.toLocaleString()}</td>
                      </tr>
                    ))}
                    <tr data-testid="row-by-property-orion">
                      <td className="py-2">
                        <div className="font-medium">Orion</div>
                        <div className="text-xs text-muted-foreground">recorded visits, unfiltered snapshot</div>
                      </td>
                      <td className="py-2 text-right">{showOrion ? od?.totalVisits.toLocaleString() ?? (orion.isLoading ? "…" : "Unavailable") : "Select Orion"}</td>
                      <td className="py-2 text-right text-muted-foreground">n/a</td>
                      <td className="py-2 text-right text-muted-foreground">n/a</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {showOrion && (
            <Card className="p-5 mb-6" data-testid="card-orion-detail">
              <button
                type="button"
                className="w-full flex items-center justify-between gap-2 text-left"
                aria-expanded={detailOpen}
                onClick={() => setDetailOpen((o) => !o)}
                data-testid="button-orion-detail-toggle"
              >
                <span className="text-sm font-medium flex items-center gap-2">
                  <Orbit className="h-4 w-4 text-primary" aria-hidden /> Orion drill-down
                  <span className="text-xs text-muted-foreground font-normal">sections, pages, learning activity, daily table</span>
                </span>
                <ChevronDown className={`h-4 w-4 transition-transform ${detailOpen ? "rotate-180" : ""}`} />
              </button>
              {detailOpen && <OrionTrafficPanel rangePreset={rangePreset} orion={orion} />}
            </Card>
          )}

          {hasLocal && (
            <>
              <div className="mb-2 text-sm font-medium" data-testid="text-local-detail-label">
                Local property detail <span className="text-xs text-muted-foreground font-normal">(Orion not included below)</span>
              </div>
          {/* Two-column: Top pages + Traffic sources */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            <Card className="p-5">
              <div className="text-sm font-medium mb-4">Top pages</div>
              {pagesQ.isLoading ? (
                <div className="text-sm text-muted-foreground">Loading…</div>
              ) : (pagesQ.data?.items.length ?? 0) === 0 ? (
                <div className="text-sm text-muted-foreground py-4 text-center">No pageviews yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 font-medium text-muted-foreground">Path</th>
                        <th className="text-right py-2 font-medium text-muted-foreground">Views</th>
                        <th className="text-right py-2 font-medium text-muted-foreground">Sessions</th>
                        <th className="text-right py-2 font-medium text-muted-foreground">Avg time on page</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {pagesQ.data?.items.slice(0, 20).map((r) => (
                        <tr key={r.path}>
                          <td className="py-2 font-mono text-xs truncate max-w-[280px]" title={r.path}>{r.path}</td>
                          <td className="py-2 text-right">{r.pageviews.toLocaleString()}</td>
                          <td className="py-2 text-right">{r.sessions.toLocaleString()}</td>
                          <td className="py-2 text-right text-muted-foreground">{formatMs(r.avgTimeOnPageMs)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card className="p-5">
              <div className="text-sm font-medium mb-4">Traffic sources</div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  {sourcePie.length === 0 ? (
                    <div className="h-52 flex items-center justify-center text-sm text-muted-foreground">No data.</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie data={sourcePie} dataKey="value" nameKey="name" outerRadius={70}>
                          {sourcePie.map((d, i) => (
                            <Cell key={i} fill={d.color} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={TOOLTIP_STYLE} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>
                <div className="text-xs">
                  <div className="font-medium text-muted-foreground mb-2">Top referrers</div>
                  <ul className="space-y-1">
                    {(sourcesQ.data?.byReferrer ?? []).slice(0, 8).map((r, i) => (
                      <li key={i} className="flex justify-between gap-2">
                        <span className="truncate font-mono" title={r.host}>{r.host}</span>
                        <span className="text-muted-foreground shrink-0">{r.sessions.toLocaleString()}</span>
                      </li>
                    ))}
                    {(sourcesQ.data?.byReferrer ?? []).length === 0 && (
                      <li className="text-muted-foreground">None yet.</li>
                    )}
                  </ul>
                </div>
              </div>
            </Card>
          </div>

          <Card className="p-5 mb-6">
            <div className="text-sm font-medium mb-4">Operating system <span className="text-xs text-muted-foreground font-normal">local sessions</span></div>
            <ul className="space-y-1 text-sm">
              {(devicesQ.data?.byOs ?? []).slice(0, 10).map((r, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="truncate">{r.os}</span>
                  <span className="text-muted-foreground shrink-0">{r.sessions.toLocaleString()}</span>
                </li>
              ))}
              {(devicesQ.data?.byOs ?? []).length === 0 && <li className="text-muted-foreground text-xs">None yet.</li>}
            </ul>
          </Card>

          {/* AI crawlers + AI platforms */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="p-5">
              <div className="text-sm font-medium mb-1 flex items-center gap-2">
                <Bot className="h-4 w-4" /> AI & search crawlers
              </div>
              <div className="text-xs text-muted-foreground mb-4">
                Bot user-agents visiting the site (GPTBot, ClaudeBot, Perplexity, Googlebot, …)
              </div>
              {(aiQ.data?.byBot.length ?? 0) === 0 ? (
                <div className="text-sm text-muted-foreground py-4 text-center">No crawler visits yet.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 font-medium text-muted-foreground">Bot</th>
                      <th className="text-left py-2 font-medium text-muted-foreground">Kind</th>
                      <th className="text-right py-2 font-medium text-muted-foreground">Sessions</th>
                      <th className="text-right py-2 font-medium text-muted-foreground">Pageviews</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {aiQ.data?.byBot.slice(0, 15).map((r, i) => (
                      <tr key={i}>
                        <td className="py-2">{r.botName}</td>
                        <td className="py-2 text-xs text-muted-foreground uppercase">{r.botCategory}</td>
                        <td className="py-2 text-right">{r.sessions.toLocaleString()}</td>
                        <td className="py-2 text-right">{r.pageviews.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card className="p-5">
              <div className="text-sm font-medium mb-1">Sessions from AI platforms</div>
              <div className="text-xs text-muted-foreground mb-4">
                Humans arriving via ChatGPT, Gemini, Perplexity, Copilot, etc.
              </div>
              {(aiQ.data?.fromAiPlatforms.length ?? 0) === 0 ? (
                <div className="text-sm text-muted-foreground py-4 text-center">None yet.</div>
              ) : (
                <ul className="space-y-2 text-sm">
                  {aiQ.data?.fromAiPlatforms.map((r, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span className="font-mono text-xs truncate">{r.host}</span>
                      <span className="text-muted-foreground">{r.sessions.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* UTM breakdowns */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
            {[
              { label: "utm_source", rows: utmQ.data?.bySource ?? [] },
              { label: "utm_medium", rows: utmQ.data?.byMedium ?? [] },
              { label: "utm_campaign", rows: utmQ.data?.byCampaign ?? [] },
            ].map((panel) => (
              <Card key={panel.label} className="p-5">
                <div className="text-sm font-medium mb-1">{panel.label}</div>
                <div className="text-xs text-muted-foreground mb-4">
                  Tagged sessions grouped by {panel.label}
                </div>
                {panel.rows.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-4 text-center">
                    No tagged sessions in this window.
                  </div>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {panel.rows.slice(0, 12).map((r, i) => (
                      <li key={i} className="flex justify-between gap-2">
                        <span className="font-mono text-xs truncate" title={r.value}>
                          {r.value}
                        </span>
                        <span className="text-muted-foreground shrink-0">
                          {r.sessions.toLocaleString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            ))}
          </div>

          {/* Custom events */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
            <Card className="p-5">
              <div className="text-sm font-medium mb-1">Top custom events</div>
              <div className="text-xs text-muted-foreground mb-4">
                Fired via <code className="font-mono">trackEvent</code> — form submits, CTA clicks, downloads, …
              </div>
              {(eventsQ.data?.byName.length ?? 0) === 0 ? (
                <div className="text-sm text-muted-foreground py-4 text-center">No events yet.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 font-medium text-muted-foreground">Event</th>
                      <th className="text-right py-2 font-medium text-muted-foreground">Count</th>
                      <th className="text-right py-2 font-medium text-muted-foreground">Sessions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {eventsQ.data?.byName.map((r, i) => (
                      <tr key={i}>
                        <td className="py-2 font-mono text-xs">{r.eventName}</td>
                        <td className="py-2 text-right">{r.total.toLocaleString()}</td>
                        <td className="py-2 text-right">{r.sessions.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card className="p-5">
              <div className="text-sm font-medium mb-1">Recent events</div>
              <div className="text-xs text-muted-foreground mb-4">
                Latest 50 events in this window
              </div>
              {(eventsQ.data?.recent.length ?? 0) === 0 ? (
                <div className="text-sm text-muted-foreground py-4 text-center">No events yet.</div>
              ) : (
                <ul className="space-y-2 text-sm max-h-[320px] overflow-y-auto pr-1">
                  {eventsQ.data?.recent.map((r, i) => (
                    <li key={i} className="flex items-start justify-between gap-3 border-b border-border/60 pb-2 last:border-0">
                      <div className="min-w-0">
                        <div className="font-mono text-xs">{r.eventName}</div>
                        <div className="text-xs text-muted-foreground font-mono truncate" title={r.path}>
                          {r.path}
                        </div>
                      </div>
                      <div className="text-[11px] text-muted-foreground shrink-0 whitespace-nowrap">
                        {new Date(r.occurredAt).toLocaleString()}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
            </>
          )}
        </>
      )}
    </AdminLayout>
  );
}
