import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { PortalShell } from "@/components/portal-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertCircle,
  CheckCircle2,
  XCircle,
  Clock,
  MessageSquare,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { constellationApi, type CProject, type CMilestone, type CStatusReport, type CRaidd } from "@/lib/constellation-api";
import { useToast } from "@/hooks/use-toast";

// ── RAG / health helpers ──────────────────────────────────────────────────────

function ragColor(rag: string | null) {
  if (!rag) return "bg-muted";
  const r = rag.toLowerCase();
  if (r === "green") return "bg-emerald-500";
  if (r === "amber") return "bg-amber-400";
  if (r === "red") return "bg-rose-500";
  return "bg-muted";
}

function ragLabel(rag: string | null) {
  if (!rag) return "—";
  const map: Record<string, string> = { green: "Green", amber: "Amber", red: "Red" };
  return map[rag.toLowerCase()] ?? rag;
}

function healthBadgeClass(s: string | null) {
  if (!s) return "";
  const l = s.toLowerCase();
  if (l === "green" || l === "on_track") return "border-emerald-500/40 text-emerald-400";
  if (l === "amber" || l === "at_risk") return "border-amber-400/40 text-amber-400";
  if (l === "red" || l === "off_track") return "border-rose-500/40 text-rose-400";
  return "";
}

// ── Sign-off dialog ───────────────────────────────────────────────────────────

function SignoffDialog({
  open,
  title,
  description,
  confirmLabel,
  confirmVariant = "default",
  onConfirm,
  onCancel,
  isPending,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  confirmVariant?: "default" | "destructive";
  onConfirm: (comment: string) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [comment, setComment] = useState("");
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
        </DialogHeader>
        <div className="space-y-2 py-2">
          <label className="text-sm font-medium">Comment <span className="text-muted-foreground">(optional)</span></label>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Add a note for the Synozur team..."
            rows={3}
            disabled={isPending}
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel} disabled={isPending}>Cancel</Button>
          <Button
            variant={confirmVariant}
            onClick={() => onConfirm(comment)}
            disabled={isPending}
          >
            {isPending ? "Submitting…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Status Reports tab ────────────────────────────────────────────────────────

function StatusReportsTab({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [ackId, setAckId] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["constellation-status-reports", projectId],
    queryFn: () => constellationApi.listStatusReports(projectId, { limit: 50 }),
    staleTime: 90_000,
  });

  const ackMutation = useMutation({
    mutationFn: ({ id, comment }: { id: string; comment: string }) =>
      constellationApi.acknowledgeStatusReport(id, comment || undefined),
    onSuccess: () => {
      toast({ title: "Report acknowledged", description: "The status report has been acknowledged." });
      void qc.invalidateQueries({ queryKey: ["constellation-status-reports", projectId] });
      setAckId(null);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to acknowledge", description: err.message, variant: "destructive" });
      setAckId(null);
    },
  });

  const items = data?.items ?? [];

  if (isLoading) return <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}</div>;
  if (isError) return <ErrorNote message="Could not load status reports." />;
  if (items.length === 0) return <EmptyNote icon={<Clock size={28} />} message="No status reports published yet." />;

  return (
    <>
      <div className="space-y-4">
        {items.map((r) => (
          <Card key={r.id} className="overflow-hidden">
            <div className={`h-1 w-full ${ragColor(r.ragStatus)}`} />
            <CardHeader className="pb-2 flex-row items-start justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground">
                  {new Date(r.publishedAt).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}
                </p>
                <CardTitle className="text-base mt-0.5">{r.reportPeriod}</CardTitle>
              </div>
              <div className="flex items-center gap-2 flex-wrap justify-end">
                <Badge
                  variant="outline"
                  className={`text-xs ${ragColor(r.ragStatus).replace("bg-", "border-").replace("500", "500/40").replace("400", "400/40")} ${r.ragStatus?.toLowerCase() === "green" ? "text-emerald-400" : r.ragStatus?.toLowerCase() === "amber" ? "text-amber-400" : "text-rose-400"}`}
                >
                  {ragLabel(r.ragStatus)}
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => setAckId(r.id)}
                >
                  <CheckCircle2 size={12} className="mr-1" /> Acknowledge
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {r.accomplishments && <Section label="Accomplishments" body={r.accomplishments} />}
              {r.milestones && <Section label="Milestones" body={r.milestones} />}
              {r.risks && <Section label="Risks" body={r.risks} />}
              {r.notes && <Section label="Notes" body={r.notes} />}
            </CardContent>
          </Card>
        ))}
      </div>

      <SignoffDialog
        open={ackId !== null}
        title="Acknowledge status report"
        description="This will be recorded as an acknowledgement and shared with your Synozur team."
        confirmLabel="Acknowledge"
        onConfirm={(comment) => ackMutation.mutate({ id: ackId!, comment })}
        onCancel={() => setAckId(null)}
        isPending={ackMutation.isPending}
      />
    </>
  );
}

// ── Milestones tab ────────────────────────────────────────────────────────────

function milestoneBadge(status: string): { label: string; className: string } {
  const map: Record<string, { label: string; className: string }> = {
    pending: { label: "Pending", className: "border-border text-muted-foreground" },
    in_progress: { label: "In progress", className: "border-violet-500/40 text-violet-400" },
    completed: { label: "Completed", className: "border-emerald-500/40 text-emerald-400" },
    accepted: { label: "Accepted", className: "border-emerald-500/40 text-emerald-400" },
    rejected: { label: "Rejected", className: "border-rose-500/40 text-rose-400" },
  };
  return map[status.toLowerCase()] ?? { label: status, className: "border-border text-muted-foreground" };
}

function MilestonesTab({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<{ id: string; action: "accept" | "reject" } | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["constellation-milestones", projectId],
    queryFn: () => constellationApi.listMilestones(projectId, { limit: 100 }),
    staleTime: 90_000,
  });

  const signoffMutation = useMutation({
    mutationFn: ({ id, action, comment }: { id: string; action: "accept" | "reject"; comment: string }) =>
      action === "accept"
        ? constellationApi.acceptMilestone(id, comment || undefined)
        : constellationApi.rejectMilestone(id, comment || undefined),
    onSuccess: (_, vars) => {
      toast({
        title: vars.action === "accept" ? "Milestone accepted" : "Milestone rejected",
        description: "Your response has been recorded.",
      });
      void qc.invalidateQueries({ queryKey: ["constellation-milestones", projectId] });
      setDialog(null);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to submit", description: err.message, variant: "destructive" });
      setDialog(null);
    },
  });

  const items = data?.items ?? [];
  if (isLoading) return <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}</div>;
  if (isError) return <ErrorNote message="Could not load milestones." />;
  if (items.length === 0) return <EmptyNote icon={<CheckCircle2 size={28} />} message="No milestones yet." />;

  return (
    <>
      <div className="space-y-3">
        {items.map((m) => {
          const badge = milestoneBadge(m.clientFacingStatus);
          const canSignoff = ["completed", "in_progress"].includes(m.clientFacingStatus.toLowerCase());
          return (
            <div key={m.id} className="rounded-xl border border-border bg-card p-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className={`text-xs ${badge.className}`}>{badge.label}</Badge>
                  <Badge variant="outline" className="text-xs capitalize">{m.type}</Badge>
                </div>
                <div className="font-medium text-sm mt-1">{m.name}</div>
                {m.description && <p className="text-xs text-muted-foreground line-clamp-2">{m.description}</p>}
                <div className="flex gap-3 text-xs text-muted-foreground flex-wrap">
                  {m.targetDate && <span>Due {new Date(m.targetDate).toLocaleDateString()}</span>}
                  {m.completedDate && <span>Completed {new Date(m.completedDate).toLocaleDateString()}</span>}
                  {m.amount != null && (
                    <span className="font-medium text-foreground">
                      {new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(m.amount)}
                    </span>
                  )}
                </div>
              </div>
              {canSignoff && (
                <div className="flex gap-2 shrink-0">
                  <Button size="sm" variant="outline" className="text-xs h-8 text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/10"
                    onClick={() => setDialog({ id: m.id, action: "accept" })}>
                    <CheckCircle2 size={12} className="mr-1" /> Accept
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs h-8 text-rose-400 border-rose-500/40 hover:bg-rose-500/10"
                    onClick={() => setDialog({ id: m.id, action: "reject" })}>
                    <XCircle size={12} className="mr-1" /> Reject
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {dialog && (
        <SignoffDialog
          open
          title={dialog.action === "accept" ? "Accept milestone" : "Reject milestone"}
          description={`This will ${dialog.action === "accept" ? "confirm acceptance of" : "raise a rejection against"} this milestone.`}
          confirmLabel={dialog.action === "accept" ? "Accept" : "Reject"}
          confirmVariant={dialog.action === "reject" ? "destructive" : "default"}
          onConfirm={(comment) => signoffMutation.mutate({ id: dialog.id, action: dialog.action, comment })}
          onCancel={() => setDialog(null)}
          isPending={signoffMutation.isPending}
        />
      )}
    </>
  );
}

// ── RAIDD tab ─────────────────────────────────────────────────────────────────

const RAIDD_TYPE_LABELS: Record<string, string> = {
  risk: "Risk",
  action: "Action",
  issue: "Issue",
  dependency: "Dependency",
  decision: "Decision",
};

const RAIDD_PRIORITY_CLASS: Record<string, string> = {
  high: "text-rose-400",
  medium: "text-amber-400",
  low: "text-muted-foreground",
};

function RaiddTab({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [commentId, setCommentId] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["constellation-raidd", projectId],
    queryFn: () => constellationApi.listRaidd(projectId, { limit: 100 }),
    staleTime: 90_000,
  });

  const commentMutation = useMutation({
    mutationFn: ({ id, comment }: { id: string; comment: string }) =>
      constellationApi.commentOnRaidd(id, comment),
    onSuccess: () => {
      toast({ title: "Comment added", description: "Your comment has been shared with the Synozur team." });
      void qc.invalidateQueries({ queryKey: ["constellation-raidd", projectId] });
      setCommentId(null);
      setCommentText("");
    },
    onError: (err: Error) => {
      toast({ title: "Failed to add comment", description: err.message, variant: "destructive" });
    },
  });

  const items = data?.items ?? [];
  if (isLoading) return <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>;
  if (isError) return <ErrorNote message="Could not load RAIDD items." />;
  if (items.length === 0) return <EmptyNote icon={<AlertCircle size={28} />} message="No RAIDD items to display." />;

  const grouped = Object.entries(
    items.reduce<Record<string, CRaidd[]>>((acc, r) => {
      const k = r.type || "other";
      (acc[k] = acc[k] ?? []).push(r);
      return acc;
    }, {}),
  );

  return (
    <>
      <div className="space-y-6">
        {grouped.map(([type, entries]) => (
          <div key={type}>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              {RAIDD_TYPE_LABELS[type] ?? type} ({entries.length})
            </h3>
            <div className="space-y-2">
              {entries.map((r) => {
                const isExpanded = expandedId === r.id;
                return (
                  <div key={r.id} className="rounded-xl border border-border bg-card overflow-hidden">
                    <button
                      className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-muted/30 transition-colors"
                      onClick={() => setExpandedId(isExpanded ? null : r.id)}
                    >
                      {isExpanded ? <ChevronDown size={14} className="mt-0.5 shrink-0 text-muted-foreground" /> : <ChevronRight size={14} className="mt-0.5 shrink-0 text-muted-foreground" />}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {r.refNumber && <span className="text-xs font-mono text-muted-foreground">{r.refNumber}</span>}
                          <span className={`text-xs font-medium capitalize ${RAIDD_PRIORITY_CLASS[r.priority?.toLowerCase()] ?? ""}`}>
                            {r.priority}
                          </span>
                          <Badge variant="outline" className="text-xs capitalize">{r.status}</Badge>
                        </div>
                        <div className="font-medium text-sm mt-0.5">{r.title}</div>
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="px-4 pb-4 space-y-3 border-t border-border">
                        {r.description && (
                          <p className="text-sm text-muted-foreground mt-3 whitespace-pre-wrap">{r.description}</p>
                        )}
                        {r.dueDate && (
                          <p className="text-xs text-muted-foreground">Due: {new Date(r.dueDate).toLocaleDateString()}</p>
                        )}
                        <div className="pt-1">
                          {commentId === r.id ? (
                            <div className="space-y-2">
                              <Textarea
                                value={commentText}
                                onChange={(e) => setCommentText(e.target.value)}
                                placeholder="Add a comment…"
                                rows={3}
                                disabled={commentMutation.isPending}
                                autoFocus
                              />
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  className="text-xs h-8"
                                  disabled={!commentText.trim() || commentMutation.isPending}
                                  onClick={() => commentMutation.mutate({ id: r.id, comment: commentText.trim() })}
                                >
                                  {commentMutation.isPending ? "Sending…" : "Send"}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-xs h-8"
                                  disabled={commentMutation.isPending}
                                  onClick={() => { setCommentId(null); setCommentText(""); }}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs h-8"
                              onClick={() => { setCommentId(r.id); setCommentText(""); }}
                            >
                              <MessageSquare size={12} className="mr-1" /> Add comment
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function Section({ label, body }: { label: string; body: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
      <p className="text-sm whitespace-pre-wrap">{body}</p>
    </div>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
      <AlertCircle size={15} className="mt-0.5 shrink-0" />
      {message}
    </div>
  );
}

function EmptyNote({ icon, message }: { icon: React.ReactNode; message: string }) {
  return (
    <Card>
      <CardContent className="p-8 text-center text-muted-foreground">
        <div className="mx-auto mb-3 opacity-30 flex justify-center">{icon}</div>
        {message}
      </CardContent>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ConstellationProjectPage({ id }: { id: string }) {
  const { data: project, isLoading, isError } = useQuery({
    queryKey: ["constellation-project", id],
    queryFn: () => constellationApi.getProject(id),
    staleTime: 90_000,
  });

  return (
    <PortalShell>
      <main className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        <div className="space-y-3">
          <Link href="/projects">
            <a className="text-xs text-muted-foreground hover:underline">← All projects</a>
          </Link>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-8 w-80" />
            </div>
          ) : isError ? (
            <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              Could not load project. Please try again.
            </div>
          ) : project ? (
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                {project.code && (
                  <span className="text-xs font-mono text-muted-foreground">{project.code}</span>
                )}
                <Badge variant="outline" className="text-xs capitalize">{project.status}</Badge>
                {project.healthStatus && (
                  <Badge variant="outline" className={`text-xs ${healthBadgeClass(project.healthStatus)}`}>
                    {project.healthStatus}
                  </Badge>
                )}
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
              <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
                {project.pmName && <span>PM: {project.pmName}</span>}
                {project.startDate && <span>Started {new Date(project.startDate).toLocaleDateString()}</span>}
                {project.endDate && <span>· Due {new Date(project.endDate).toLocaleDateString()}</span>}
              </div>
            </div>
          ) : null}
        </div>

        {!isLoading && !isError && (
          <Tabs defaultValue="status-reports">
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="status-reports">Status Reports</TabsTrigger>
              <TabsTrigger value="milestones">Milestones</TabsTrigger>
              <TabsTrigger value="raidd">RAIDD</TabsTrigger>
            </TabsList>
            <TabsContent value="status-reports" className="mt-6">
              <StatusReportsTab projectId={id} />
            </TabsContent>
            <TabsContent value="milestones" className="mt-6">
              <MilestonesTab projectId={id} />
            </TabsContent>
            <TabsContent value="raidd" className="mt-6">
              <RaiddTab projectId={id} />
            </TabsContent>
          </Tabs>
        )}
      </main>
    </PortalShell>
  );
}
