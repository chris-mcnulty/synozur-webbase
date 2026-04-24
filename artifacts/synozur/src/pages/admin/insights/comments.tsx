import { useState } from "react";
import { CheckCircle2, Trash2, ShieldAlert, BellRing, BellOff } from "lucide-react";
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
import { useToast } from "@/hooks/use-toast";

// Server-side zod accepts an optional `notify` boolean alongside `action`;
// the generated client type hasn't been regenerated yet, so we widen it at
// the call site. Unknown fields are stripped silently by zod anyway.
type ModerateBody = { action: "approve" | "reject" | "spam" | "delete"; notify?: boolean };

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
}

function fmt(d: string): string {
  return new Date(d).toLocaleString();
}

export default function CommentsModeration() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<CommentStatus | "all">("pending");
  // Per-comment "notify on approve" flag (defaults to true; only effective
  // if the commenter opted in).
  const [notifyDraft, setNotifyDraft] = useState<Record<string, boolean>>({});
  const { data, isLoading, refetch } = useListCmsComments({
    ...(statusFilter !== "all" ? { status: statusFilter } : {}),
    pageSize: 100,
  });

  const moderate = useModerateCmsComment({
    mutation: {
      onSuccess: (_, vars) => {
        toast({ title: `Comment ${vars.data.action}` });
        refetch();
      },
      onError: (e: Error) =>
        toast({ title: "Failed", description: e.message, variant: "destructive" }),
    },
  });

  const approve = (c: CommentRow) => {
    const notify = notifyDraft[c.id] ?? true;
    moderate.mutate({ id: c.id, data: { action: "approve", notify } as ModerateBody });
  };

  return (
    <AdminLayout
      title="Comments"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Comments" }]}
      actions={
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as CommentStatus | "all")}>
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
      }
    >
      {isLoading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : (data?.items ?? []).length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          No comments match this filter.
        </Card>
      ) : (
        <div className="space-y-3">
          {(data?.items ?? []).map((raw) => {
            const c = raw as unknown as CommentRow;
            const canNotify =
              c.notifyOnApproval === true &&
              !c.notifiedApprovedAt &&
              c.status !== "approved";
            const notifyChecked = notifyDraft[c.id] ?? true;
            return (
              <Card key={c.id} className="p-4" data-testid={`comment-card-${c.id}`}>
                <div className="flex items-start justify-between gap-3">
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
                    onClick={() =>
                      moderate.mutate({
                        id: c.id,
                        data: { action: "delete", notify: false } as ModerateBody,
                      })
                    }
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
