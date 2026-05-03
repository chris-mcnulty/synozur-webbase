import { useState } from "react";
import {
  CheckCircle2,
  Trash2,
  ShieldAlert,
  BellRing,
  BellOff,
  RotateCcw,
  AlertCircle,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { AdminLayout } from "@/components/admin/AdminLayout";
import {
  useListCmsComments,
  useModerateCmsComment,
  type CommentStatus,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

// Server-side zod accepts an optional `notify` boolean alongside `action`;
// the generated client type hasn't been regenerated yet, so we widen it at
// the call site. Unknown fields are stripped silently by zod anyway.
type ModerateBody = { action: "approve" | "reject" | "spam" | "delete" | "pending"; notify?: boolean };

// The generated `Comment` type from api-client-react is driven by the OpenAPI
// spec which hasn't been regenerated to include the #53 notify-opt-in
// columns yet; cast to read the extra fields the server now returns.
interface CommentRow {
  id: string;
  status: CommentStatus;
  authorName: string;
  authorEmail: string;
  bodyText: string;
  createdAt: string;
  notifyOnApproval?: boolean;
  notifyOnReply?: boolean;
  notifiedApprovedAt?: string | null;
  // #54: spam signals from the spam scorer
  spamSignals?: string[] | null;
}

function fmt(d: string): string {
  return new Date(d).toLocaleString();
}

function formatSignal(signal: string): string {
  if (signal.startsWith("excessive-links:")) {
    const count = signal.split(":")[1];
    return `Too many links (${count})`;
  }
  if (signal.startsWith("keyword:")) {
    return `Keyword: "${signal.slice(8)}"`;
  }
  if (signal === "url-in-author-name") return "URL in author name";
  if (signal.startsWith("blocked-email-domain:")) {
    return `Blocked domain: ${signal.split(":")[1]}`;
  }
  if (signal === "akismet") return "Flagged by Akismet";
  if (signal === "akismet-discard") return "Akismet: definite spam (safe to discard)";
  return signal;
}

export default function CommentsModeration() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<CommentStatus | "all">("pending");
  // Per-comment "notify on approve" flag (defaults to true; only effective
  // if the commenter opted in).
  const [notifyDraft, setNotifyDraft] = useState<Record<string, boolean>>({});
  // Track which spam comments are selected for bulk delete
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const { data, isLoading, refetch } = useListCmsComments({
    ...(statusFilter !== "all" ? { status: statusFilter } : {}),
    pageSize: 100,
  });

  const moderate = useModerateCmsComment({
    mutation: {
      onSuccess: (_, vars) => {
        const action = (vars.data as ModerateBody).action;
        const label =
          action === "pending" ? "Restored to pending" : `Comment ${action}d`;
        toast({ title: label });
        setSelected(new Set());
        refetch();
        // Invalidate any other comment list queries (notably the spam
        // count badge in AdminLayout) so they reflect the new state.
        void queryClient.invalidateQueries({ queryKey: ["/api/cms/comments"] });
      },
      onError: (e: Error) =>
        toast({ title: "Failed", description: e.message, variant: "destructive" }),
    },
  });

  const approve = (c: CommentRow) => {
    const notify = notifyDraft[c.id] ?? true;
    moderate.mutate({ id: c.id, data: { action: "approve", notify } as ModerateBody });
  };

  const unspam = (id: string) => {
    moderate.mutate({ id, data: { action: "pending" } as ModerateBody });
  };

  const handleBulkDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Permanently delete ${selected.size} spam comment${selected.size === 1 ? "" : "s"}? This cannot be undone.`)) return;
    setBulkDeleting(true);
    try {
      const res = await fetch(`${BASE_PATH}/api/cms/comments/bulk-delete-spam`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json() as { deleted: string[] };
      toast({ title: `Deleted ${result.deleted.length} spam comment${result.deleted.length === 1 ? "" : "s"}` });
      setSelected(new Set());
      refetch();
      void queryClient.invalidateQueries({ queryKey: ["/api/cms/comments"] });
    } catch (e) {
      toast({ title: "Bulk delete failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBulkDeleting(false);
    }
  };

  const items = (data?.items ?? []) as unknown as CommentRow[];
  const isSpamFilter = statusFilter === "spam";
  const allSelected = items.length > 0 && items.every((c) => selected.has(c.id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((c) => c.id)));
    }
  };

  return (
    <AdminLayout
      title="Comments"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Comments" }]}
      actions={
        <div className="flex items-center gap-2">
          {isSpamFilter && selected.size > 0 && (
            <Button
              size="sm"
              variant="destructive"
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
              data-testid="bulk-delete-spam"
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Delete {selected.size} selected
            </Button>
          )}
          <Select value={statusFilter} onValueChange={(v) => {
            setStatusFilter(v as CommentStatus | "all");
            setSelected(new Set());
          }}>
            <SelectTrigger className="w-[160px]" data-testid="select-comment-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="spam">Spam</SelectItem>
              <SelectItem value="deleted">Deleted</SelectItem>
            </SelectContent>
          </Select>
        </div>
      }
    >
      {isLoading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : items.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          No comments match this filter.
        </Card>
      ) : (
        <div className="space-y-3">
          {isSpamFilter && items.length > 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground pb-1">
              <Checkbox
                checked={allSelected}
                onCheckedChange={toggleSelectAll}
                data-testid="select-all-spam"
              />
              <span>Select all ({items.length})</span>
            </div>
          )}
          {items.map((c) => {
            const canNotify =
              c.notifyOnApproval === true &&
              !c.notifiedApprovedAt &&
              c.status !== "approved";
            const notifyChecked = notifyDraft[c.id] ?? true;
            const isChecked = selected.has(c.id);
            return (
              <Card key={c.id} className="p-4" data-testid={`comment-card-${c.id}`}>
                <div className="flex items-start justify-between gap-3">
                  {isSpamFilter && (
                    <div className="pt-0.5">
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={(v) => {
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (v) next.add(c.id); else next.delete(c.id);
                            return next;
                          });
                        }}
                        data-testid={`select-${c.id}`}
                      />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{c.authorName}</span>
                      <span className="text-xs text-muted-foreground">{c.authorEmail}</span>
                      <Badge variant="secondary" className="text-xs">{c.status}</Badge>
                      {c.notifyOnApproval && (
                        <Badge variant="outline" className="text-xs gap-1">
                          <BellRing className="h-3 w-3" /> Opt-in: approval
                        </Badge>
                      )}
                      {c.notifyOnReply && (
                        <Badge variant="outline" className="text-xs gap-1">
                          <BellRing className="h-3 w-3" /> Opt-in: replies
                        </Badge>
                      )}
                      {c.notifiedApprovedAt && (
                        <Badge variant="outline" className="text-xs gap-1">
                          <BellOff className="h-3 w-3" /> Approval email sent
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground ml-auto">{fmt(c.createdAt)}</span>
                    </div>
                    {c.spamSignals && c.spamSignals.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1 mt-2">
                        <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                        {c.spamSignals.map((signal) => (
                          <Badge
                            key={signal}
                            variant="destructive"
                            className="text-xs font-normal"
                            data-testid={`signal-${c.id}`}
                          >
                            {formatSignal(signal)}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <p className="text-sm mt-2 whitespace-pre-wrap">{c.bodyText}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  {c.status !== "approved" && (
                    <Button
                      size="sm"
                      onClick={() => approve(c)}
                      data-testid={`approve-${c.id}`}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
                    </Button>
                  )}
                  {canNotify && (
                    <label
                      className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer"
                      htmlFor={`notify-${c.id}`}
                    >
                      <Checkbox
                        id={`notify-${c.id}`}
                        checked={notifyChecked}
                        onCheckedChange={(v) =>
                          setNotifyDraft((d) => ({ ...d, [c.id]: v === true }))
                        }
                        data-testid={`notify-toggle-${c.id}`}
                      />
                      Send approval email
                    </label>
                  )}
                  {c.status === "spam" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => unspam(c.id)}
                      data-testid={`unspam-${c.id}`}
                    >
                      <RotateCcw className="h-4 w-4 mr-1" /> Not spam
                    </Button>
                  )}
                  {c.status !== "spam" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        moderate.mutate({
                          id: c.id,
                          data: { action: "spam", notify: false } as ModerateBody,
                        })
                      }
                      data-testid={`spam-${c.id}`}
                    >
                      <ShieldAlert className="h-4 w-4 mr-1" /> Mark spam
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (!confirm(`Delete this comment by ${c.authorName ?? "anonymous"}? This cannot be undone.`)) return;
                      moderate.mutate({
                        id: c.id,
                        data: { action: "delete", notify: false } as ModerateBody,
                      });
                    }}
                    data-testid={`delete-${c.id}`}
                  >
                    <Trash2 className="h-4 w-4 mr-1 text-destructive" /> Delete
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </AdminLayout>
  );
}
