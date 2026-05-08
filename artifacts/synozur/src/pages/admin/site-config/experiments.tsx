/* eslint-disable jsx-a11y/label-has-associated-control --
   Admin form labels are positioned above their inputs (a sibling pattern
   used elsewhere in the admin UI) rather than wrapping or `htmlFor`-ing
   them. Form inputs all have visible labels and are usable; this rule's
   strict structural requirement is at odds with the inline-form layout. */
import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Play, Pause, Square, Trash2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { api } from "@/lib/api";
import type {
  AdminExperiment,
  CreateExperimentBody,
  ExperimentStatus,
} from "@workspace/api-zod/types";

function StatusPill({ status }: { status: ExperimentStatus }) {
  const styles: Record<ExperimentStatus, string> = {
    draft: "bg-zinc-700 text-zinc-200",
    running: "bg-emerald-600/30 text-emerald-300 border border-emerald-600/40",
    paused: "bg-amber-600/30 text-amber-300 border border-amber-600/40",
    ended: "bg-zinc-800 text-zinc-400 border border-zinc-700",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[status]}`}
    >
      {status}
    </span>
  );
}

export default function AdminExperimentsList() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [draftKey, setDraftKey] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draftPageKey, setDraftPageKey] = useState("home");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-experiments"],
    queryFn: () => api.listAdminExperiments(),
  });

  const createMutation = useMutation({
    mutationFn: (body: CreateExperimentBody) => api.createAdminExperiment(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-experiments"] });
      setCreating(false);
      setDraftKey("");
      setDraftName("");
      setDraftPageKey("home");
      setErrorMessage(null);
    },
    onError: (err) => {
      setErrorMessage(err instanceof Error ? err.message : "Create failed");
    },
  });

  const startMutation = useMutation({
    mutationFn: (id: string) => api.startAdminExperiment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-experiments"] }),
    onError: (err) =>
      setErrorMessage(err instanceof Error ? err.message : "Start failed"),
  });
  const pauseMutation = useMutation({
    mutationFn: (id: string) => api.pauseAdminExperiment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-experiments"] }),
  });
  const endMutation = useMutation({
    mutationFn: (id: string) => api.endAdminExperiment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-experiments"] }),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteAdminExperiment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-experiments"] }),
  });

  function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    createMutation.mutate({
      key: draftKey.trim(),
      name: draftName.trim(),
      description: null,
      pageKey: draftPageKey.trim(),
      trafficPercentage: 100,
      holdbackPercentage: 0,
      conversionPaths: [],
    });
  }

  return (
    <AdminLayout
      title="Experiments"
      crumbs={[
        { label: "Admin", href: "/" },
        { label: "Site Config" },
        { label: "Experiments" },
      ]}
    >
      <p className="text-sm text-muted-foreground mb-8 max-w-3xl">
        A/B experiments. Each running experiment is targeted to a specific
        page (e.g. <code>home</code>) and randomizes visitors across its
        variants. Conversions tracked: <code>conversion.cta.get_started</code>,{" "}
        <code>conversion.booking.click</code>, and configured path visits.
      </p>

      {errorMessage ? (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {errorMessage}
        </div>
      ) : null}

      <div className="mb-6">
        {creating ? (
          <form
            onSubmit={submitCreate}
            className="rounded-md border border-border p-4 space-y-3 max-w-2xl"
          >
            <div>
              <label className="block text-sm font-medium mb-1">
                Stable key
                <span className="text-muted-foreground font-normal">
                  {" "}
                  (lowercase, used in URL force-overrides; immutable)
                </span>
              </label>
              <Input
                value={draftKey}
                onChange={(e) => setDraftKey(e.target.value)}
                placeholder="home_hero_2026_05"
                required
                pattern="[a-z0-9][a-z0-9_-]*"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <Input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="Homepage hero — May 2026"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                Page key
                <span className="text-muted-foreground font-normal">
                  {" "}
                  (e.g. <code>home</code>, <code>services</code>,{" "}
                  <code>solutions/ai-strategy</code>)
                </span>
              </label>
              <Input
                value={draftPageKey}
                onChange={(e) => setDraftPageKey(e.target.value)}
                placeholder="home"
                required
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={createMutation.isPending}>
                Create as draft
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCreating(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New experiment
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : !data || data.experiments.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-8 text-center text-muted-foreground">
          No experiments yet. Create one to get started.
        </div>
      ) : (
        <div className="rounded-md border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Page</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Traffic</th>
                <th className="px-4 py-2">Variants</th>
                <th className="px-4 py-2">Started</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.experiments.map((e: AdminExperiment) => (
                <tr key={e.id} className="border-t border-border">
                  <td className="px-4 py-3">
                    <Link
                      href={`/site-config/experiments/${e.id}`}
                      className="text-primary hover:underline font-medium"
                    >
                      {e.name}
                    </Link>
                    <div className="text-xs text-muted-foreground font-mono">
                      {e.key}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{e.pageKey}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={e.status} />
                  </td>
                  <td className="px-4 py-3">{e.trafficPercentage}%</td>
                  <td className="px-4 py-3">{e.variants.length}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {e.startedAt
                      ? new Date(e.startedAt).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right space-x-1">
                    {e.status === "draft" || e.status === "paused" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => startMutation.mutate(e.id)}
                        title="Start"
                      >
                        <Play className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                    {e.status === "running" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => pauseMutation.mutate(e.id)}
                        title="Pause"
                      >
                        <Pause className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                    {e.status === "running" || e.status === "paused" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => endMutation.mutate(e.id)}
                        title="End"
                      >
                        <Square className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                    {e.status === "draft" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (confirm(`Delete draft "${e.name}"?`)) {
                            deleteMutation.mutate(e.id);
                          }
                        }}
                        title="Delete draft"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                    <Link
                      href={`/site-config/experiments/${e.id}`}
                      className="inline-flex items-center justify-center h-8 w-8 rounded hover:bg-muted text-muted-foreground"
                      title="Edit"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
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
