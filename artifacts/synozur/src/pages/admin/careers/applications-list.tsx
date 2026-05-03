import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Download } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { careersApi } from "@/lib/careers-api";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

const STATUS_BADGE: Record<string, string> = {
  new: "bg-blue-500/15 text-blue-300",
  reviewing: "bg-amber-500/15 text-amber-300",
  interview: "bg-fuchsia-500/15 text-fuchsia-300",
  offer: "bg-emerald-500/15 text-emerald-300",
  rejected: "bg-destructive/15 text-destructive",
};

export default function AdminCareersApplications() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-careers-applications"],
    queryFn: () => careersApi.adminListApplications(),
  });
  const { data: eeo } = useQuery({
    queryKey: ["admin-careers-eeo"],
    queryFn: () => careersApi.adminEeoSummary(),
    retry: false,
  });
  const items = data?.items ?? [];
  return (
    <AdminLayout title="Applications">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Applications</h1>
        <a href={`${BASE_PATH}/api/cms/careers/applications/export.csv`} target="_blank" rel="noreferrer">
          <Button variant="outline" data-testid="button-export-csv">
            <Download size={14} className="mr-1" /> Export CSV
          </Button>
        </a>
      </div>

      {eeo && (
        <div className="rounded border border-border bg-card p-4 mb-6 text-sm" data-testid="eeo-summary-panel">
          <div className="font-medium mb-2">EEO snapshot ({eeo.total} total)</div>
          <div className="grid md:grid-cols-3 gap-4 text-xs text-muted-foreground">
            <div>
              <div className="font-medium text-foreground mb-1">Race / ethnicity</div>
              {Object.entries(eeo.race).map(([k, v]) => (
                <div key={k}>{k}: <span className="text-foreground">{v}</span></div>
              ))}
            </div>
            <div>
              <div className="font-medium text-foreground mb-1">Gender</div>
              {Object.entries(eeo.gender).map(([k, v]) => (
                <div key={k}>{k}: <span className="text-foreground">{v}</span></div>
              ))}
            </div>
            <div>
              <div className="font-medium text-foreground mb-1">Veteran status</div>
              {Object.entries(eeo.veteran).map(([k, v]) => (
                <div key={k}>{k}: <span className="text-foreground">{v}</span></div>
              ))}
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : items.length === 0 ? (
        <div className="rounded border border-border p-8 text-muted-foreground" data-testid="empty-applications">No applications yet.</div>
      ) : (
        <div className="rounded border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="text-left p-3">Submitted</th>
                <th className="text-left p-3">Name</th>
                <th className="text-left p-3">Email</th>
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">Score</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id} className="border-t border-border" data-testid={`row-app-${a.id}`}>
                  <td className="p-3 text-muted-foreground">
                    {new Date(a.submittedAt).toLocaleDateString()}
                  </td>
                  <td className="p-3 font-medium">{a.fullName}</td>
                  <td className="p-3 text-xs">{a.email}</td>
                  <td className="p-3">
                    <span className={`text-xs px-2 py-0.5 rounded uppercase ${STATUS_BADGE[a.status] ?? ""}`}>
                      {a.status}
                    </span>
                  </td>
                  <td className="p-3 text-xs">
                    {a.aiMatchScore != null ? `${a.aiMatchScore}/100` : "—"}
                  </td>
                  <td className="p-3 text-right">
                    <Link href={`/careers/applications/${a.id}`}>
                      <a className="text-fuchsia-300 hover:underline text-xs" data-testid={`view-app-${a.id}`}>View</a>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminLayout>
  );
}
