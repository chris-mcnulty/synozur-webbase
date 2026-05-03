import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Users,
  Globe,
  Bot,
  Download,
  MonitorSmartphone,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useAdminAccess } from "@/components/admin/AdminGate";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trafficApi, type TrafficFilters } from "@/lib/traffic-api";
import { trafficPropertiesApi } from "@/lib/traffic-properties-api";
import { Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";

const TOOLTIP_STYLE = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  color: "hsl(var(--foreground))",
  fontSize: 12,
};

const DEVICE_COLORS: Record<string, string> = {
  desktop: "hsl(var(--primary))",
  mobile: "#ec4899",
  tablet: "#f59e0b",
  bot: "#64748b",
  unknown: "#94a3b8",
};

const SOURCE_COLORS: Record<string, string> = {
  direct: "#64748b",
  organic: "#10b981",
  ai: "#8b5cf6",
  referral: "#3b82f6",
  social: "#ec4899",
  paid: "#f59e0b",
  internal: "#94a3b8",
  unknown: "#cbd5e1",
};

function Stat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  icon: typeof Activity;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="text-3xl font-semibold mt-1">
            {typeof value === "number" ? value.toLocaleString() : value}
          </div>
        </div>
        <Icon className="h-8 w-8 text-muted-foreground/50" />
      </div>
    </Card>
  );
}

function formatMs(ms: number | null): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m ${rs}s`;
}

export default function AdminTraffic() {
  const { access } = useAdminAccess();
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [includeBots, setIncludeBots] = useState<"false" | "true" | "only">("false");
  const [pageType, setPageType] = useState<string>("");
  const [device, setDevice] = useState<string>("");
  // #228 — multi-property filter; default is the canonical first-party feed.
  // Selection is persisted to the URL via ?properties=slug1,slug2 so the
  // current view is shareable and survives reloads.
  const [location, setLocation] = useLocation();
  const [propertySlugs, setPropertySlugs] = useState<string[]>(() => {
    if (typeof window === "undefined") return ["synozur"];
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("properties");
    if (!raw) return ["synozur"];
    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    return parts.length === 0 ? ["synozur"] : parts;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const isDefault = propertySlugs.length === 1 && propertySlugs[0] === "synozur";
    if (isDefault) {
      params.delete("properties");
    } else {
      params.set("properties", propertySlugs.join(","));
    }
    const qs = params.toString();
    const next = qs ? `${location.split("?")[0]}?${qs}` : location.split("?")[0]!;
    if (next !== location) setLocation(next, { replace: true });
  }, [propertySlugs, location, setLocation]);

  const enabled = !!access?.isEditorOrAbove;

  const propsListQ = useQuery({
    queryKey: ["traffic-properties"],
    queryFn: () => trafficPropertiesApi.list(),
    enabled,
  });
  const allProps = propsListQ.data?.items ?? [];

  const filters = useMemo<TrafficFilters>(
    () => ({
      days,
      includeBots,
      pageType: pageType || undefined,
      device: (device as TrafficFilters["device"]) || undefined,
      propertySlugs: propertySlugs.length === 0 ? ["synozur"] : propertySlugs,
    }),
    [days, includeBots, pageType, device, propertySlugs],
  );

  function togglePropertySlug(slug: string) {
    setPropertySlugs((prev) => {
      if (slug === "all") return ["all"];
      const without = prev.filter((s) => s !== "all");
      if (without.includes(slug)) {
        const next = without.filter((s) => s !== slug);
        return next.length === 0 ? ["synozur"] : next;
      }
      return [...without, slug];
    });
  }

  const propertyButtonLabel = propertySlugs.includes("all")
    ? "All properties"
    : propertySlugs.length === 1
      ? (allProps.find((p) => p.slug === propertySlugs[0])?.name ?? propertySlugs[0])
      : `${propertySlugs.length} properties`;

  const overviewQ = useQuery({
    queryKey: ["traffic-overview", filters],
    queryFn: () => trafficApi.overview(filters),
    enabled,
  });
  // #229 — The "By property" card is always full-mix: respect every other
  // filter (range/audience/device/etc.) but force `propertySlugs=['all']`
  // so admins can compare their portfolio at a glance without re-filtering.
  const byPropertyFilters = useMemo<TrafficFilters>(
    () => ({ ...filters, propertySlugs: ["all"] }),
    [filters],
  );
  const byPropertyQ = useQuery({
    queryKey: ["traffic-by-property", byPropertyFilters],
    queryFn: () => trafficApi.byProperty(byPropertyFilters),
    enabled,
  });
  const seriesQ = useQuery({
    queryKey: ["traffic-series", filters],
    queryFn: () => trafficApi.timeseries(filters),
    enabled,
  });
  const pagesQ = useQuery({
    queryKey: ["traffic-pages", filters],
    queryFn: () => trafficApi.pages(filters),
    enabled,
  });
  const sourcesQ = useQuery({
    queryKey: ["traffic-sources", filters],
    queryFn: () => trafficApi.sources(filters),
    enabled,
  });
  const devicesQ = useQuery({
    queryKey: ["traffic-devices", filters],
    queryFn: () => trafficApi.devices(filters),
    enabled,
  });
  const countriesQ = useQuery({
    queryKey: ["traffic-countries", filters],
    queryFn: () => trafficApi.countries(filters),
    enabled,
  });
  const aiQ = useQuery({
    queryKey: ["traffic-ai", filters],
    queryFn: () => trafficApi.aiCrawlers(filters),
    enabled,
  });
  const utmQ = useQuery({
    queryKey: ["traffic-utms", filters],
    queryFn: () => trafficApi.utms(filters),
    enabled,
  });
  const eventsQ = useQuery({
    queryKey: ["traffic-events", filters],
    queryFn: () => trafficApi.events(filters),
    enabled,
  });

  const seriesData = (seriesQ.data?.series ?? []).map((d) => ({
    day: new Date(d.day + "T00:00:00").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    pageviews: d.pageviews,
    sessions: d.sessions,
  }));

  const devicePie = (devicesQ.data?.byDevice ?? []).map((d) => ({
    name: d.deviceType,
    value: d.sessions,
    color: DEVICE_COLORS[d.deviceType] ?? DEVICE_COLORS.unknown,
  }));

  const sourcePie = (sourcesQ.data?.bySource ?? []).map((s) => ({
    name: s.source,
    value: s.sessions,
    color: SOURCE_COLORS[s.source] ?? SOURCE_COLORS.unknown,
  }));

  return (
    <AdminLayout
      title="Traffic Analytics"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Traffic" }]}
      actions={
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={trafficApi.overviewCsvUrl(filters)} download>
              <Download className="h-4 w-4 mr-1" /> Overview CSV
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href={trafficApi.sessionsCsvUrl(filters)} download>
              <Download className="h-4 w-4 mr-1" /> Sessions CSV
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href={trafficApi.exportCsvUrl(filters)} download>
              <Download className="h-4 w-4 mr-1" /> Pageviews CSV
            </a>
          </Button>
        </div>
      }
    >
      {!access?.isEditorOrAbove ? (
        <Card className="p-6 bg-muted/30">
          <p className="text-sm">You don&apos;t have access to site traffic analytics.</p>
        </Card>
      ) : (
        <>
          {/* Filters */}
          <Card className="p-4 mb-6">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <div className="text-xs text-muted-foreground mb-1">Properties</div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs min-w-[180px] justify-between"
                      data-testid="btn-property-filter"
                    >
                      <span className="truncate">{propertyButtonLabel}</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    <DropdownMenuLabel className="text-xs">Properties to include</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuCheckboxItem
                      checked={propertySlugs.includes("all")}
                      onCheckedChange={() => togglePropertySlug("all")}
                      data-testid="property-option-all"
                    >
                      All properties
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuSeparator />
                    {allProps.map((p) => (
                      <DropdownMenuCheckboxItem
                        key={p.id}
                        checked={!propertySlugs.includes("all") && propertySlugs.includes(p.slug)}
                        onCheckedChange={() => togglePropertySlug(p.slug)}
                        data-testid={`property-option-${p.slug}`}
                      >
                        <span className="flex-1 truncate">{p.name}</span>
                        {p.isDefault && <Check className="h-3 w-3 ml-1 text-muted-foreground" />}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Range</div>
                <Select value={String(days)} onValueChange={(v) => setDays(Number(v) as 7 | 30 | 90)}>
                  <SelectTrigger className="w-[160px] h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">Last 7 days</SelectItem>
                    <SelectItem value="30">Last 30 days</SelectItem>
                    <SelectItem value="90">Last 90 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Audience</div>
                <Select value={includeBots} onValueChange={(v) => setIncludeBots(v as typeof includeBots)}>
                  <SelectTrigger className="w-[160px] h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="false">Humans only</SelectItem>
                    <SelectItem value="true">Humans + bots</SelectItem>
                    <SelectItem value="only">Bots only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Page type</div>
                <Select value={pageType || "__all"} onValueChange={(v) => setPageType(v === "__all" ? "" : v)}>
                  <SelectTrigger className="w-[180px] h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
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
                <div className="text-xs text-muted-foreground mb-1">Device</div>
                <Select value={device || "__all"} onValueChange={(v) => setDevice(v === "__all" ? "" : v)}>
                  <SelectTrigger className="w-[140px] h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
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
          </Card>

          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Stat label="Pageviews" value={overviewQ.data?.totals.pageviews ?? 0} icon={Activity} />
            <Stat label="Sessions" value={overviewQ.data?.totals.sessions ?? 0} icon={Users} />
            <Stat label="Unique visitors" value={overviewQ.data?.totals.uniqueVisitors ?? 0} icon={MonitorSmartphone} />
            <Stat label="Countries" value={overviewQ.data?.totals.countries ?? 0} icon={Globe} />
          </div>

          {/* #229 — Per-property breakdown card is always rendered. It
              respects every other filter (range / audience / device / page
              type) but ignores the property multi-select so admins can see
              their full portfolio at a glance without re-filtering. */}
          <Card className="p-5 mb-6" data-testid="card-by-property">
            <div className="flex items-baseline justify-between mb-1">
              <div className="text-sm font-medium">By property</div>
              <div className="text-xs text-muted-foreground">
                Full portfolio — ignores the property filter
              </div>
            </div>
            <div className="text-xs text-muted-foreground mb-4">
              Sessions, unique visitors, and pageviews per property for the
              selected window.
            </div>
            {byPropertyQ.isLoading ? (
              <div className="text-sm text-muted-foreground py-4 text-center">
                Loading…
              </div>
            ) : (byPropertyQ.data?.items.length ?? 0) === 0 ? (
              <div className="text-sm text-muted-foreground py-4 text-center">
                No traffic recorded for any property in this window.
              </div>
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
                    {byPropertyQ.data!.items.map((row) => {
                      const friendly =
                        allProps.find((p) => p.slug === row.slug)?.name ?? row.slug;
                      return (
                        <tr key={row.slug} data-testid={`row-by-property-${row.slug}`}>
                          <td className="py-2">
                            <div className="font-medium">{friendly}</div>
                            <div className="text-xs text-muted-foreground font-mono">{row.slug}</div>
                          </td>
                          <td className="py-2 text-right">{row.sessions.toLocaleString()}</td>
                          <td className="py-2 text-right">{row.uniqueVisitors.toLocaleString()}</td>
                          <td className="py-2 text-right">{row.pageviews.toLocaleString()}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Visits over time */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            <Card className="p-5 lg:col-span-2">
              <div className="text-sm font-medium mb-1">Visits over time</div>
              <div className="text-xs text-muted-foreground mb-4">
                Daily pageview and session count for the selected period
              </div>
              {seriesQ.isLoading ? (
                <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">Loading…</div>
              ) : seriesData.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
                  No traffic data in this window yet.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={seriesData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                    <defs>
                      <linearGradient id="pvGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="sessGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#ec4899" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#ec4899" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Area type="monotone" dataKey="pageviews" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#pvGrad)" name="Pageviews" />
                    <Area type="monotone" dataKey="sessions" stroke="#ec4899" strokeWidth={2} fill="url(#sessGrad)" name="Sessions" />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </Card>

            {/* Device distribution */}
            <Card className="p-5">
              <div className="text-sm font-medium mb-1">Device distribution</div>
              <div className="text-xs text-muted-foreground mb-4">Breakdown by device type</div>
              {devicePie.length === 0 ? (
                <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">
                  No sessions yet.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={devicePie} dataKey="value" nameKey="name" outerRadius={80} label={(e) => `${e.name} ${Math.round((e.percent ?? 0) * 100)}%`}>
                      {devicePie.map((d, i) => (
                        <Cell key={i} fill={d.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </Card>
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
                        <th className="text-right py-2 font-medium text-muted-foreground">Avg time</th>
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

          {/* Countries + Browsers */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            <Card className="p-5">
              <div className="text-sm font-medium mb-4">Sessions by country</div>
              {(countriesQ.data?.items.length ?? 0) === 0 ? (
                <div className="text-sm text-muted-foreground">No country data yet (requires CF-IPCountry / X-Vercel-IP-Country headers from your edge).</div>
              ) : (
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-border">
                    {countriesQ.data?.items.slice(0, 15).map((r) => (
                      <tr key={r.country}>
                        <td className="py-2 font-mono text-xs">{r.country}</td>
                        <td className="py-2 text-right">{r.sessions.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
            <Card className="p-5">
              <div className="text-sm font-medium mb-4">Browsers & OS</div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-2">Browser</div>
                  <ul className="space-y-1">
                    {(devicesQ.data?.byBrowser ?? []).slice(0, 8).map((r, i) => (
                      <li key={i} className="flex justify-between gap-2">
                        <span className="truncate">{r.browser}</span>
                        <span className="text-muted-foreground shrink-0">{r.sessions.toLocaleString()}</span>
                      </li>
                    ))}
                    {(devicesQ.data?.byBrowser ?? []).length === 0 && (
                      <li className="text-muted-foreground text-xs">None yet.</li>
                    )}
                  </ul>
                </div>
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-2">Operating system</div>
                  <ul className="space-y-1">
                    {(devicesQ.data?.byOs ?? []).slice(0, 8).map((r, i) => (
                      <li key={i} className="flex justify-between gap-2">
                        <span className="truncate">{r.os}</span>
                        <span className="text-muted-foreground shrink-0">{r.sessions.toLocaleString()}</span>
                      </li>
                    ))}
                    {(devicesQ.data?.byOs ?? []).length === 0 && (
                      <li className="text-muted-foreground text-xs">None yet.</li>
                    )}
                  </ul>
                </div>
              </div>
            </Card>
          </div>

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
    </AdminLayout>
  );
}
