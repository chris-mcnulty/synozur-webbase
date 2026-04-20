import { useGetCmsPost } from "@workspace/api-client-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Badge } from "@/components/ui/badge";

interface Props {
  id: string;
}

export default function PostPreview({ id }: Props) {
  const { data: post, isLoading, error } = useGetCmsPost(id);

  return (
    <AdminLayout
      title="Post Preview"
      crumbs={[
        { label: "Admin", href: "/admin" },
        { label: "Posts", href: "/admin/posts" },
        { label: post?.title ?? "Preview" },
      ]}
    >
      {isLoading && <div className="text-muted-foreground">Loading…</div>}
      {error && (
        <div className="text-destructive" data-testid="preview-error">
          {(error as Error).message}
        </div>
      )}
      {post && (
        <article className="max-w-3xl mx-auto">
          <div className="mb-3">
            <Badge variant="secondary" data-testid="preview-status">{post.status}</Badge>
            {post.scheduledFor && (
              <span className="ml-2 text-xs text-muted-foreground">
                Scheduled for {new Date(post.scheduledFor).toLocaleString()}
              </span>
            )}
          </div>
          <h1 className="text-4xl font-bold mb-2" data-testid="preview-title">{post.title}</h1>
          {post.subtitle && (
            <p className="text-lg text-muted-foreground mb-6">{post.subtitle}</p>
          )}
          {post.heroImageUrl && (
            <img
              src={post.heroImageUrl}
              alt=""
              className="w-full rounded-lg mb-8"
            />
          )}
          {post.bodyHtml ? (
            <div
              className="prose prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: post.bodyHtml }}
              data-testid="preview-body"
            />
          ) : (
            <p className="text-muted-foreground italic">No content yet.</p>
          )}
        </article>
      )}
    </AdminLayout>
  );
}
