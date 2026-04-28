import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Plus,
  FileText,
  Clock,
  CheckCircle2,
  MessageSquare,
  Eye,
  TrendingUp,
  Activity,
  BarChart2,
  Users,
  MousePointerClick,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useAdminAccess } from "@/components/admin/AdminGate";
import {
  useListCmsPosts,
  useListCmsComments,
  useGetCmsAnalyticsOverview,
} from "@workspace/api-client-react";
import type { AnalyticsActivityItem } from "@workspace/api-client-react";
import { trafficApi, type TrafficFilters } from "@/lib/traffic-api";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatShortDate(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function StatCard({
  label,
  value,
  icon: Icon,
  testId,
}: {
  label: string;
  value: number | string;
  icon: typeof FileText;
  testId: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
          <div className="text-3xl font-semibold mt-1" data-testid={testId}>
            {value}
          </div>
        </div>
        <Icon className="h-8 w-8 text-muted-foreground/50" />
      </div>
    </Card>
  );
}

function activityLabel(item: AnalyticsActivityItem): string {
  if (item.kind === "publish") return `Published "${item.postTitle}"`;
  const who = item.authorName ? `${item.authorName} commented on` : `New comment on`;
  const status = item.status !== "approved" ? ` (${item.status})` : "";
  return `${who} "${item.postTitle}"${status}`;
}

function activityIcon(kind: AnalyticsActivityItem["kind"]) {
  if (kind === "publish") return <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />;
  return <MessageSquare className="h-4 w-4 text-blue-400 shrink-0" />;
}

const TOOLTIP_STYLE = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  color: "hsl(var(--foreground))",
  fontSize: 12,
};

export default function AdminDashboard() {
  const { access } = useAdminAccess();
  const [rangeDays, setRangeDays] = useState<7 | 30>(30);

  const enabledCms = { query: { enabled: !!access?.hasCmsRole } as never };
  const drafts = useListCmsPosts({ status: "draft", pageSize: 5 }, enabledCms);
  const scheduled = useListCmsPosts({ status: "scheduled", pageSize: 5 }, enabledCms);
  const published = useListCmsPosts({ status: "published", pageSize: 5 }, enabledCms);
  const recent = useListCmsPosts(
    { pageSize: 8, ...(access?.cmsUser?.id ? { authorId: access.cmsUser.id } : {}) },
    enabledCms,
  );
  const pendingComments = useListCmsComments(
    { status: "pending", pageSize: 5 },
    { query: { enabled: !!access?.isEditorOrAbove } as never },
  );

  const analytics = useGetCmsAnalyticsOverview(
    { days: rangeDays },
    { query: { enabled: !!access?.hasCmsRole } as never },
  );

  // Site-wide traffic — queried separately because it covers all pages, not
  // just posts, and uses session-aware aggregation. The endpoint requires
  // editor or admin role.
  const trafficFilters = useMemo<TrafficFilters>(
    () => ({ days: rangeDays, includeBots: "false" }),
    [rangeDays],
  );
  const trafficEnabled = !!access?.isEditorOrAbove;
  const trafficOverview = useQuery({
    queryKey: ["dashboard-traffic-overview", trafficFilters],
    queryFn: () => trafficApi.overview(trafficFilters),
    enabled: trafficEnabled,
  });
  const trafficSeries = useQuery({
    queryKey: ["dashboard-traffic-series", trafficFilters],
    queryFn: () => trafficApi.timeseries(trafficFilters),
    enabled: trafficEnabled,
  });
  const trafficPages = useQuery({
    queryKey: ["dashboard-traffic-pages", trafficFilters],
    queryFn: () => trafficApi.pages({ ...trafficFilters, limit: 10 }),
    enabled: trafficEnabled,
  });

  const seriesData = (analytics.data?.series ?? []).map((d) => ({
    day: new Date(d.day + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    views: d.views,
  }));

  const trafficSeriesData = (trafficSeries.data?.series ?? []).map((d) => ({
    day: new Date(d.day + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    pageviews: d.pageviews,
    sessions: d.sessions,
  }));

  return (
    <AdminLayout
      title="Dashboard"
      actions={
        access?.hasCmsRole ? (
          <Link href="/insights/posts/new">
            <Button data-testid="button-new-post">
              <Plus className="h-4 w-4 mr-2" /> New post
            </Button>
          </Link>
        ) : null
      }
    >
      {!access?.hasCmsRole && (
        <Card className="p-6 mb-6 bg-muted/30">
          <p className="text-sm">
            You don't have a CMS role yet, but your account is on the admin
            allow-list. You can manage events and submissions from the sidebar.
          </p>
        </Card>
      )}

      {access?.hasCmsRole && (
        <>
          {/* Post status counts */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard
              label="Drafts"
              value={drafts.data?.total ?? 0}
              icon={FileText}
              testId="stat-drafts"
            />
            <StatCard
              label="Scheduled"
              value={scheduled.data?.total ?? 0}
              icon={Clock}
              testId="stat-scheduled"
            />
            <StatCard
              label="Published"
              value={published.data?.total ?? 0}
              icon={CheckCircle2}
              testId="stat-published"
            />
          </div>

          {/* Analytics stats + range picker */}
          <div className="mt-6 flex items-center justify-between flex-wrap gap-2 mb-3">
            <h2 className="font-semibold flex items-center gap-2 text-sm">
              <TrendingUp className="h-4 w-4" /> Performance
            </h2>
            <Select
              value={String(rangeDays)}
              onValueChange={(v) => setRangeDays(Number(v) as 7 | 30)}
            >
              <SelectTrigger className="w-[120px] h-8 text-xs" data-testid="select-analytics-range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Site-wide traffic (editors+) — sits above post-only metrics so the
              dashboard always reflects whole-site activity, not just posts. */}
          {access.isEditorOrAbove && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                <StatCard
                  label={`Pageviews (${rangeDays}d)`}
                  value={trafficOverview.data?.totals.pageviews ?? 0}
                  icon={MousePointerClick}
                  testId="stat-pageviews"
                />
                <StatCard
                  label={`Sessions (${rangeDays}d)`}
                  value={trafficOverview.data?.totals.sessions ?? 0}
                  icon={Activity}
                  testId="stat-sessions"
                />
                <StatCard
                  label={`Unique visitors (${rangeDays}d)`}
                  value={trafficOverview.data?.totals.uniqueVisitors ?? 0}
                  icon={Users}
                  testId="stat-unique-visitors"
                />
              </div>

              <Card className="p-5 mb-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-medium text-muted-foreground">
                    Site traffic — last {rangeDays} days
                  </div>
                  <Link href="/marketing/traffic">
                    <a className="text-xs text-primary hover:underline" data-testid="link-traffic-details">
                      Details
                    </a>
                  </Link>
                </div>
                {trafficSeries.isLoading ? (
                  <div className="text-sm text-muted-foreground py-6 text-center">Loading…</div>
                ) : trafficSeriesData.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-6 text-center">
                    No site traffic recorded yet in this window.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={160}>
                    <AreaChart data={trafficSeriesData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                      <defs>
                        <linearGradient id="pageviewsGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="day"
                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                        tickLine={false}
                        axisLine={false}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                        tickLine={false}
                        axisLine={false}
                        allowDecimals={false}
                      />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Area
                        type="monotone"
                        dataKey="pageviews"
                        stroke="hsl(var(--primary))"
                        strokeWidth={2}
                        fill="url(#pageviewsGrad)"
                        dot={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </Card>

              {/* Top pages widget */}
              <Card className="p-5 mb-4" data-testid="card-top-pages">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    <h2 className="font-semibold text-sm">Top pages ({rangeDays}d)</h2>
                  </div>
                  <Link href="/marketing/traffic">
                    <a className="text-xs text-primary hover:underline" data-testid="link-top-pages-details">
                      Full breakdown
                    </a>
                  </Link>
                </div>
                {trafficPages.isLoading ? (
                  <div className="text-sm text-muted-foreground py-6 text-center">Loading…</div>
                ) : (trafficPages.data?.items.length ?? 0) === 0 ? (
                  <div className="text-sm text-muted-foreground py-6 text-center">
                    No page traffic recorded yet in this window.
                  </div>
                ) : (
                  <ol className="divide-y divide-border">
                    {trafficPages.data?.items.slice(0, 10).map((row, idx) => (
                      <li key={row.path} className="py-2.5 flex items-center gap-3">
                        <span className="text-xs font-mono text-muted-foreground w-4 shrink-0">
                          {idx + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate" title={row.path}>
                            <a
                              href={row.path}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:underline"
                            >
                              {row.path}
                            </a>
                          </div>
                          {row.title && (
                            <div className="text-xs text-muted-foreground truncate">
                              <a
                                href={row.path}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:underline"
                              >
                                {row.title}
                              </a>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <MousePointerClick className="h-3 w-3" />
                            {row.pageviews.toLocaleString()}
                          </div>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Users className="h-3 w-3" />
                            {row.sessions.toLocaleString()}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>
            </>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <StatCard
              label={`Post views (${rangeDays}d)`}
              value={analytics.data?.totals.views ?? 0}
              icon={Eye}
              testId="stat-views"
            />
            <StatCard
              label={`Published posts`}
              value={analytics.data?.totals.published ?? 0}
              icon={BarChart2}
              testId="stat-published-analytics"
            />
            <StatCard
              label={`Comments (${rangeDays}d)`}
              value={analytics.data?.totals.comments ?? 0}
              icon={MessageSquare}
              testId="stat-comments-analytics"
            />
          </div>

          {/* Views sparkline */}
          {seriesData.length > 0 && (
            <Card className="p-5 mb-4">
              <div className="text-sm font-medium mb-3 text-muted-foreground">
                Post views per day — last {rangeDays} days
              </div>
              <ResponsiveContainer width="100%" height={140}>
                <AreaChart data={seriesData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <defs>
                    <linearGradient id="viewsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="day"
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Area
                    type="monotone"
                    dataKey="views"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    fill="url(#viewsGrad)"
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </Card>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-2">
            {/* Top posts */}
            <Card className="p-5 col-span-1">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                <h2 className="font-semibold text-sm">Top posts ({rangeDays}d)</h2>
              </div>
              {analytics.isLoading ? (
                <div className="text-sm text-muted-foreground">Loading…</div>
              ) : (analytics.data?.topPosts.length ?? 0) === 0 ? (
                <div className="text-sm text-muted-foreground py-6 text-center">
                  No view data yet. Views are tracked when visitors read posts.
                </div>
              ) : (
                <ol className="divide-y divide-border">
                  {analytics.data?.topPosts.map((p, idx) => (
                    <li key={p.id} className="py-2.5 flex items-center gap-3">
                      <span className="text-xs font-mono text-muted-foreground w-4 shrink-0">
                        {idx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <Link href={`/insights/posts/${p.id}/analytics`}>
                          <a className="text-sm font-medium truncate hover:underline block">
                            {p.title}
                          </a>
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {formatShortDate(p.publishedAt)}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                        <Eye className="h-3 w-3" />
                        {p.views.toLocaleString()}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Card>

            {/* Recent posts */}
            <Card className="p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold">Your recent posts</h2>
                <Link href="/insights/posts">
                  <a className="text-xs text-primary hover:underline">View all</a>
                </Link>
              </div>
              {recent.isLoading ? (
                <div className="text-sm text-muted-foreground">Loading…</div>
              ) : (recent.data?.items.length ?? 0) === 0 ? (
                <div className="text-sm text-muted-foreground py-6 text-center">
                  No posts yet. Create your first post to get started.
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {recent.data?.items.map((p) => (
                    <li key={p.id} className="py-2.5 flex items-center justify-between gap-3">
                      <Link href={`/insights/posts/${p.id}/edit`}>
                        <a className="flex-1 min-w-0 hover:underline">
                          <div className="text-sm font-medium truncate">{p.title}</div>
                          <div className="text-xs text-muted-foreground">
                            {p.status} · updated {formatDate(p.updatedAt)}
                          </div>
                        </a>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* Activity feed */}
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <h2 className="font-semibold text-sm">Recent activity ({rangeDays}d)</h2>
              </div>
              {analytics.isLoading ? (
                <div className="text-sm text-muted-foreground">Loading…</div>
              ) : (analytics.data?.activity.length ?? 0) === 0 ? (
                <div className="text-sm text-muted-foreground py-6 text-center">
                  No activity yet in this window.
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {analytics.data?.activity.map((item, i) => (
                    <li key={i} className="py-2.5 flex items-start gap-2">
                      {activityIcon(item.kind)}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs leading-snug">{activityLabel(item)}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {formatDate(item.at)}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* Comments moderation (editors+) */}
          {access.isEditorOrAbove && (
            <Card className="p-5 mt-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" /> Comments awaiting moderation
                </h2>
                <Link href="/insights/comments">
                  <a className="text-xs text-primary hover:underline">View all</a>
                </Link>
              </div>
              {pendingComments.isLoading ? (
                <div className="text-sm text-muted-foreground">Loading…</div>
              ) : (pendingComments.data?.items.length ?? 0) === 0 ? (
                <div className="text-sm text-muted-foreground py-6 text-center">
                  No comments awaiting moderation.
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {pendingComments.data?.items.map((c) => (
                    <li key={c.id} className="py-2.5">
                      <div className="text-sm font-medium">{c.authorName}</div>
                      <div className="text-xs text-muted-foreground line-clamp-2">
                        {c.bodyText}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </>
      )}
    </AdminLayout>
  );
}
