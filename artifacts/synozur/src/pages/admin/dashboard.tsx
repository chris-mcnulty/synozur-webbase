import { Link } from "wouter";
import { Plus, FileText, Clock, CheckCircle2, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useAdminAccess } from "@/components/admin/AdminGate";
import {
  useListCmsPosts,
  useListCmsComments,
} from "@workspace/api-client-react";

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

function StatCard({
  label,
  value,
  icon: Icon,
  testId,
}: {
  label: string;
  value: number | string;
  icon: typeof FileText;
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

export default function AdminDashboard() {
  const { access } = useAdminAccess();

  const enabledCms = { query: { enabled: !!access?.hasCmsRole } as never };
  const drafts = useListCmsPosts({ status: "draft", pageSize: 5 }, enabledCms);
  const scheduled = useListCmsPosts({ status: "scheduled", pageSize: 5 }, enabledCms);
  const published = useListCmsPosts({ status: "published", pageSize: 5 }, enabledCms);
  const recent = useListCmsPosts(
    { pageSize: 8, ...(access?.cmsUser?.id ? { authorId: access.cmsUser.id } : {}) },
    enabledCms,
  );
  const pendingComments = useListCmsComments(
    { status: "pending", pageSize: 5 },
    { query: { enabled: !!access?.isEditorOrAbove } as never },
  );

  return (
    <AdminLayout
      title="Dashboard"
      actions={
        access?.hasCmsRole ? (
          <Link href="/admin/posts/new">
            <Button data-testid="button-new-post">
              <Plus className="h-4 w-4 mr-2" /> New post
            </Button>
          </Link>
        ) : null
      }
    >
      {!access?.hasCmsRole && (
        <Card className="p-6 mb-6 bg-muted/30">
          <p className="text-sm">
            You don't have a CMS role yet, but your account is on the admin
            allow-list. You can manage events and submissions from the sidebar.
          </p>
        </Card>
      )}

      {access?.hasCmsRole && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard
              label="Drafts"
              value={drafts.data?.total ?? 0}
              icon={FileText}
              testId="stat-drafts"
            />
            <StatCard
              label="Scheduled"
              value={scheduled.data?.total ?? 0}
              icon={Clock}
              testId="stat-scheduled"
            />
            <StatCard
              label="Published"
              value={published.data?.total ?? 0}
              icon={CheckCircle2}
              testId="stat-published"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
            <Card className="p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold">Your recent posts</h2>
                <Link href="/admin/posts">
                  <a className="text-xs text-primary hover:underline">View all</a>
                </Link>
              </div>
              {recent.isLoading ? (
                <div className="text-sm text-muted-foreground">Loading…</div>
              ) : (recent.data?.items.length ?? 0) === 0 ? (
                <div className="text-sm text-muted-foreground py-6 text-center">
                  No posts yet. Create your first post to get started.
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {recent.data?.items.map((p) => (
                    <li key={p.id} className="py-2.5 flex items-center justify-between gap-3">
                      <Link href={`/admin/posts/${p.id}/edit`}>
                        <a className="flex-1 min-w-0 hover:underline">
                          <div className="text-sm font-medium truncate">{p.title}</div>
                          <div className="text-xs text-muted-foreground">
                            {p.status} · updated {formatDate(p.updatedAt)}
                          </div>
                        </a>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {access.isEditorOrAbove && (
              <Card className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-semibold flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" /> Comments awaiting moderation
                  </h2>
                  <Link href="/admin/comments">
                    <a className="text-xs text-primary hover:underline">View all</a>
                  </Link>
                </div>
                {pendingComments.isLoading ? (
                  <div className="text-sm text-muted-foreground">Loading…</div>
                ) : (pendingComments.data?.items.length ?? 0) === 0 ? (
                  <div className="text-sm text-muted-foreground py-6 text-center">
                    No comments awaiting moderation.
                  </div>
                ) : (
                  <ul className="divide-y divide-border">
                    {pendingComments.data?.items.map((c) => (
                      <li key={c.id} className="py-2.5">
                        <div className="text-sm font-medium">{c.authorName}</div>
                        <div className="text-xs text-muted-foreground line-clamp-2">
                          {c.bodyText}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}
          </div>
        </>
      )}
    </AdminLayout>
  );
}
