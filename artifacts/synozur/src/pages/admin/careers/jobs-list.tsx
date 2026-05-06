import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Code, Check } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { careersApi } from "@/lib/careers-api";

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  published: "bg-emerald-500/15 text-emerald-400",
  closed: "bg-destructive/15 text-destructive",
};

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

function embedCode(slug: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `<iframe\n  src="${origin}${BASE_PATH}/careers/embed/job/${slug}"\n  width="100%"\n  height="600"\n  frameborder="0"\n  style="border:none; border-radius:12px; max-width:800px;"\n  title="Synozur job listing">\n</iframe>`;
}

function allJobsEmbedCode(): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `<iframe\n  src="${origin}${BASE_PATH}/careers/embed/jobs"\n  width="100%"\n  height="600"\n  frameborder="0"\n  style="border:none; border-radius:12px; max-width:800px;"\n  title="Synozur careers">\n</iframe>`;
}

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

  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  function copyEmbed(code: string, key: string) {
    void navigator.clipboard.writeText(code).then(() => {
      setCopiedSlug(key);
      setTimeout(() => setCopiedSlug((s) => (s === key ? null : s)), 2000);
    });
  }

  return (
    <AdminLayout title="Job postings">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold">Job postings</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => copyEmbed(allJobsEmbedCode(), "all")}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-border text-muted-foreground hover:text-foreground hover:border-fuchsia-400 transition-colors"
            title="Copy embed code for all jobs"
            data-testid="button-embed-all"
          >
            {copiedSlug === "all" ? <Check size={13} className="text-emerald-400" /> : <Code size={13} />}
            {copiedSlug === "all" ? "Copied!" : "Embed all jobs"}
          </button>
          <Link href="/careers/jobs/new">
            {/* eslint-disable-next-line jsx-a11y/anchor-is-valid -- wouter <Link> injects href into the inner <a>. */}
            <a>
              <Button data-testid="button-new-job"><Plus size={16} className="mr-1" /> New job</Button>
            </a>
          </Link>
        </div>
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
                  <td className="p-3 text-right space-x-3">
                    <button
                      type="button"
                      onClick={() => copyEmbed(embedCode(j.slug), j.slug)}
                      className="inline-flex items-center text-xs gap-1 text-muted-foreground hover:text-fuchsia-300"
                      title="Copy embed code for this job"
                      data-testid={`embed-${j.slug}`}
                    >
                      {copiedSlug === j.slug ? <Check size={12} className="text-emerald-400" /> : <Code size={12} />}
                      {copiedSlug === j.slug ? "Copied!" : "Embed"}
                    </button>
                    <Link href={`/careers/jobs/${j.id}/edit`}>
                      {/* eslint-disable-next-line jsx-a11y/anchor-is-valid -- wouter <Link> injects href into the inner <a>. */}
                      <a className="inline-flex items-center text-xs gap-1 text-fuchsia-300 hover:underline" data-testid={`edit-${j.slug}`}>
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
