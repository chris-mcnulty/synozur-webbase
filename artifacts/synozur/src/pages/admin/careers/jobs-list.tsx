import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { careersApi } from "@/lib/careers-api";

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  published: "bg-emerald-500/15 text-emerald-400",
  closed: "bg-destructive/15 text-destructive",
};

export default function AdminCareersJobs() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin-careers-jobs"],
    queryFn: () => careersApi.adminListJobs(),
  });
  const del = useMutation({
    mutationFn: (id: string) => careersApi.adminDeleteJob(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-careers-jobs"] }),
  });
  const jobs = data?.items ?? [];
  return (
    <AdminLayout title="Job postings">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Job postings</h1>
        <Link href="/careers/jobs/new">
          <a>
            <Button data-testid="button-new-job"><Plus size={16} className="mr-1" /> New job</Button>
          </a>
        </Link>
      </div>
      {isLoading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : jobs.length === 0 ? (
        <div className="rounded border border-border p-8 text-muted-foreground" data-testid="empty-jobs">
          No job postings yet.
        </div>
      ) : (
        <div className="rounded border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="text-left p-3">Title</th>
                <th className="text-left p-3">Req #</th>
                <th className="text-left p-3">Department</th>
                <th className="text-left p-3">Status</th>
                <th className="text-right p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-t border-border" data-testid={`row-job-${j.slug}`}>
                  <td className="p-3 font-medium">{j.title}</td>
                  <td className="p-3 font-mono text-xs">{j.requisitionNumber}</td>
                  <td className="p-3">{j.department || "—"}</td>
                  <td className="p-3">
                    <span className={`text-xs px-2 py-0.5 rounded uppercase ${STATUS_BADGE[j.status] ?? ""}`}>
                      {j.status}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    <Link href={`/careers/jobs/${j.id}/edit`}>
                      <a className="inline-flex items-center text-xs gap-1 mr-3 text-fuchsia-300 hover:underline" data-testid={`edit-${j.slug}`}>
                        <Pencil size={12} /> Edit
                      </a>
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Delete "${j.title}"?`)) del.mutate(j.id);
                      }}
                      className="inline-flex items-center text-xs gap-1 text-destructive hover:underline"
                      data-testid={`delete-${j.slug}`}
                    >
                      <Trash2 size={12} /> Delete
                    </button>
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
