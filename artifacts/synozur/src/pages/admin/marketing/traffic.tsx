import { useState } from "react";
import { Link } from "wouter";
import {
  Eye,
  MessageSquare,
  BarChart2,
  TrendingUp,
  Activity,
  CheckCircle2,
} from "lucide-react";
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
import { useGetCmsAnalyticsOverview } from "@workspace/api-client-react";
import type { AnalyticsActivityItem } from "@workspace/api-client-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

const TOOLTIP_STYLE: React.CSSProperties = {
  background: "hsl(var(--popover))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  color: "hsl(var(--foreground))",
  fontSize: 12,
};

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
  icon: typeof Eye;
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

type RangeDays = 7 | 30 | 90;

export default function MarketingTraffic() {
  const { access } = useAdminAccess();
  const [rangeDays, setRangeDays] = useState<RangeDays>(30);

  const analytics = useGetCmsAnalyticsOverview(
    { days: rangeDays },
    { query: { enabled: !!access?.hasCapability("content.moderate") } },
  );

  const seriesData = (analytics.data?.series ?? []).map((d) => ({
    day: new Date(d.day + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    views: d.views,
  }));

  return (
    <AdminLayout
      title="Traffic"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Marketing" }, { label: "Traffic" }]}
      actions={
        <Select
          value={String(rangeDays)}
          onValueChange={(v) => setRangeDays(Number(v) as RangeDays)}
        >
          <SelectTrigger className="w-[140px] h-8 text-xs" data-testid="select-traffic-range">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <StatCard
          label={`Views (${rangeDays}d)`}
          value={analytics.data?.totals.views ?? 0}
          icon={Eye}
          testId="stat-traffic-views"
        />
        <StatCard
          label="Published posts"
          value={analytics.data?.totals.published ?? 0}
          icon={BarChart2}
          testId="stat-traffic-published"
        />
        <StatCard
          label={`Comments (${rangeDays}d)`}
          value={analytics.data?.totals.comments ?? 0}
          icon={MessageSquare}
          testId="stat-traffic-comments"
        />
      </div>

      {seriesData.length > 0 && (
        <Card className="p-5 mb-4">
          <div className="text-sm font-medium mb-3 text-muted-foreground">
            Views per day — last {rangeDays} days
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={seriesData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="trafficViewsGrad" x1="0" y1="0" x2="0" y2="1">
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
                fill="url(#trafficViewsGrad)"
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5">
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
    </AdminLayout>
  );
}
