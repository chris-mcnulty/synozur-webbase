import { useState } from "react";
import { Link } from "wouter";
import {
  Eye,
  MessageSquare,
  BarChart2,
  ExternalLink,
  ArrowLeft,
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
import { useGetCmsPostAnalytics } from "@workspace/api-client-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

const TOOLTIP_STYLE = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  color: "hsl(var(--foreground))",
  fontSize: 12,
};

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  icon: typeof Eye;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="text-3xl font-semibold mt-1">{value}</div>
        </div>
        <Icon className="h-8 w-8 text-muted-foreground/50" />
      </div>
    </Card>
  );
}

export default function PostAnalytics({ id }: { id: string }) {
  const { access } = useAdminAccess();
  const [rangeDays, setRangeDays] = useState<7 | 30 | 90>(30);

  const { data, isLoading } = useGetCmsPostAnalytics(
    id,
    { days: rangeDays },
    { query: { enabled: !!access?.hasCmsRole } as never },
  );

  const seriesData = (data?.series ?? []).map((d) => ({
    day: new Date(d.day + "T00:00:00").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    views: d.views,
  }));

  const postTitle = data?.post.title ?? "Post";
  const postSlug = data?.post.slug;
  const basePath = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

  return (
    <AdminLayout
      title={isLoading ? "Loading…" : `Analytics — ${postTitle}`}
      crumbs={[
        { label: "Admin", href: "/admin" },
        { label: "Posts", href: "/admin/posts" },
        { label: postTitle, href: `/admin/posts/${id}/edit` },
        { label: "Analytics" },
      ]}
      actions={
        <div className="flex items-center gap-2">
          <Link href={`/admin/posts/${id}/edit`}>
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" /> Back to editor
            </Button>
          </Link>
          {postSlug && (
            <a
              href={`${basePath}/insights/${postSlug}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline" size="sm">
                <ExternalLink className="h-4 w-4 mr-1" /> View post
              </Button>
            </a>
          )}
        </div>
      }
    >
      {!access?.hasCmsRole ? (
        <Card className="p-6 bg-muted/30">
          <p className="text-sm">You don't have access to analytics.</p>
        </Card>
      ) : (
        <>
          {/* Range picker */}
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">
              {data?.post.publishedAt
                ? `Published ${new Date(data.post.publishedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`
                : ""}
            </p>
            <Select
              value={String(rangeDays)}
              onValueChange={(v) => setRangeDays(Number(v) as 7 | 30 | 90)}
            >
              <SelectTrigger className="w-[130px] h-8 text-xs" data-testid="select-post-analytics-range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Summary stats */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <StatCard
              label={`Views (${rangeDays}d)`}
              value={data?.totals.views ?? 0}
              icon={Eye}
            />
            <StatCard
              label="Views (all time)"
              value={data?.totals.viewsAllTime ?? 0}
              icon={BarChart2}
            />
            <StatCard
              label={`Comments (${rangeDays}d)`}
              value={data?.totals.comments ?? 0}
              icon={MessageSquare}
            />
          </div>

          {/* Daily chart */}
          <Card className="p-5 mb-6">
            <div className="text-sm font-medium mb-4">
              Daily views — last {rangeDays} days
            </div>
            {isLoading ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
                Loading…
              </div>
            ) : seriesData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
                No view data in this window yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={seriesData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <defs>
                    <linearGradient id="postViewsGrad" x1="0" y1="0" x2="0" y2="1">
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
                    fill="url(#postViewsGrad)"
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </Card>

          {/* Referrers */}
          <Card className="p-5">
            <div className="text-sm font-medium mb-4">
              Top referrers — last {rangeDays} days
            </div>
            {isLoading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : (data?.referrers.length ?? 0) === 0 ? (
              <div className="text-sm text-muted-foreground py-4 text-center">
                No referrer data yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 font-medium text-muted-foreground">Source</th>
                      <th className="text-right py-2 font-medium text-muted-foreground">Views</th>
                      <th className="text-right py-2 font-medium text-muted-foreground">Share</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data?.referrers.map((r) => {
                      const total = data.totals.views || 1;
                      const pct = Math.round((r.views / total) * 100);
                      return (
                        <tr key={r.host}>
                          <td className="py-2.5 font-mono text-xs">{r.host}</td>
                          <td className="py-2.5 text-right">{r.views.toLocaleString()}</td>
                          <td className="py-2.5 text-right text-muted-foreground">{pct}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </AdminLayout>
  );
}
