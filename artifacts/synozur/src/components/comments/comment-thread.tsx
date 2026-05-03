import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListInsightComments,
  getListInsightCommentsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { CommentForm } from "./comment-form";
import { buildThread, renderCommentBody, timeAgo, type CommentNode } from "./utils";

interface CommentThreadProps {
  slug: string;
}

export function CommentThread({ slug }: CommentThreadProps) {
  const queryClient = useQueryClient();
  const queryKey = getListInsightCommentsQueryKey(slug);
  const { data, isLoading, isError, refetch } = useListInsightComments(slug, {
    query: {
      queryKey,
      // Re-fetch on window focus so newly approved comments appear without a manual reload.
      refetchOnWindowFocus: true,
      staleTime: 30_000,
    },
  });

  const [activeReply, setActiveReply] = useState<string | null>(null);

  const comments = data ?? [];
  const tree = buildThread(comments);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey });
  };

  return (
    <section
      id="discussion"
      aria-labelledby="discussion-heading"
      className="border-t border-border bg-background py-16"
      data-testid="discussion-section"
    >
      <div className="container mx-auto px-4 max-w-3xl">
        <header className="mb-8 flex items-baseline justify-between flex-wrap gap-2">
          <h2 id="discussion-heading" className="text-2xl md:text-3xl font-bold">
            Discussion
          </h2>
          <p className="text-sm text-muted-foreground" data-testid="comment-count">
            {comments.length === 0
              ? "No comments yet"
              : `${comments.length} comment${comments.length === 1 ? "" : "s"}`}
          </p>
        </header>

        {isLoading && (
          <div className="space-y-4 animate-pulse" data-testid="comments-loading">
            <div className="h-24 rounded-2xl bg-muted/30" />
            <div className="h-24 rounded-2xl bg-muted/30" />
          </div>
        )}

        {isError && (
          <div className="rounded-2xl border border-border/60 bg-card p-6 text-center">
            <p className="text-sm text-muted-foreground mb-3">
              We couldn&apos;t load the comments right now.
            </p>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Try again
            </Button>
          </div>
        )}

        {!isLoading && !isError && tree.length === 0 && (
          <div
            className="rounded-2xl border border-border/60 bg-card p-6 text-center"
            data-testid="comments-empty"
          >
            <p className="text-base">Be the first to share your thoughts.</p>
          </div>
        )}

        {!isLoading && !isError && tree.length > 0 && (
          <ol className="space-y-6" data-testid="comments-list">
            {tree.map((node) => (
              <CommentItem
                key={node.id}
                node={node}
                slug={slug}
                activeReply={activeReply}
                setActiveReply={setActiveReply}
                onReplyPosted={refresh}
              />
            ))}
          </ol>
        )}

        <div className="mt-10">
          <CommentForm slug={slug} onSuccess={refresh} />
        </div>
      </div>
    </section>
  );
}

interface CommentItemProps {
  node: CommentNode;
  slug: string;
  depth?: number;
  activeReply: string | null;
  setActiveReply: (id: string | null) => void;
  onReplyPosted: () => void;
}

function CommentItem({
  node,
  slug,
  depth = 0,
  activeReply,
  setActiveReply,
  onReplyPosted,
}: CommentItemProps) {
  const isReplying = activeReply === node.id;
  const isReply = depth > 0;
  return (
    <li
      id={`comment-${node.id}`}
      className={isReply ? "mt-4 scroll-mt-24" : "scroll-mt-24"}
      data-testid={`comment-${node.id}`}
    >
      <article className="rounded-2xl border border-border/60 bg-card p-5">
        <header className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
          <p className="font-semibold" data-testid="comment-author">
            {node.authorName}
          </p>
          <p className="text-xs text-muted-foreground" data-testid="comment-time">
            {timeAgo(node.createdAt)}
          </p>
        </header>
        <div
          className="text-sm leading-relaxed text-foreground whitespace-pre-wrap"
          data-testid="comment-body"
          // Body sanitized in renderCommentBody (escapes HTML, allows links + line breaks only).
          dangerouslySetInnerHTML={{ __html: renderCommentBody(node.bodyText) }}
        />
        <div className="mt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setActiveReply(isReplying ? null : node.id)}
            data-testid={`comment-reply-toggle-${node.id}`}
          >
            {isReplying ? "Cancel reply" : "Reply"}
          </Button>
        </div>
      </article>

      {isReplying && (
        <div className={`mt-4 ${isReply ? "" : "ml-6"}`}>
          <CommentForm
            slug={slug}
            parentCommentId={node.id}
            parentAuthorName={node.authorName}
            onCancel={() => setActiveReply(null)}
            onSuccess={() => {
              setActiveReply(null);
              onReplyPosted();
            }}
          />
        </div>
      )}

      {node.replies.length > 0 && (
        <ol className="mt-4 ml-6 border-l border-border/60 pl-4 space-y-4">
          {node.replies.map((reply) => (
            <CommentItem
              key={reply.id}
              node={reply}
              slug={slug}
              depth={depth + 1}
              activeReply={activeReply}
              setActiveReply={setActiveReply}
              onReplyPosted={onReplyPosted}
            />
          ))}
        </ol>
      )}
    </li>
  );
}
