import { useState } from "react";
import { CheckCircle2, Trash2, ShieldAlert } from "lucide-react";
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
import { AdminLayout } from "@/components/admin/AdminLayout";
import {
  useListCmsComments,
  useModerateCmsComment,
  type CommentStatus,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

function fmt(d: string): string {
  return new Date(d).toLocaleString();
}

export default function CommentsModeration() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<CommentStatus | "all">("pending");
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
          {(data?.items ?? []).map((c) => (
            <Card key={c.id} className="p-4" data-testid={`comment-card-${c.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{c.authorName}</span>
                    <span className="text-xs text-muted-foreground">{c.authorEmail}</span>
                    <Badge variant="secondary" className="text-xs">{c.status}</Badge>
                    <span className="text-xs text-muted-foreground ml-auto">{fmt(c.createdAt)}</span>
                  </div>
                  <p className="text-sm mt-2 whitespace-pre-wrap">{c.bodyText}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-3">
                {c.status !== "approved" && (
                  <Button
                    size="sm"
                    onClick={() => moderate.mutate({ id: c.id, data: { action: "approve" } })}
                    data-testid={`approve-${c.id}`}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
                  </Button>
                )}
                {c.status !== "spam" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => moderate.mutate({ id: c.id, data: { action: "spam" } })}
                    data-testid={`spam-${c.id}`}
                  >
                    <ShieldAlert className="h-4 w-4 mr-1" /> Mark spam
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => moderate.mutate({ id: c.id, data: { action: "delete" } })}
                  data-testid={`delete-${c.id}`}
                >
                  <Trash2 className="h-4 w-4 mr-1 text-destructive" /> Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </AdminLayout>
  );
}
