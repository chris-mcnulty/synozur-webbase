import type { PublicComment } from "@workspace/api-client-react";

/**
 * Strict body renderer: escapes HTML, preserves line breaks,
 * and turns http(s) URLs into safe anchors. Returns sanitized HTML.
 */
export function renderCommentBody(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  const linked = escaped.replace(
    /\b(https?:\/\/[^\s<]+[^\s<.,:;!?)\]'"`])/g,
    (m) =>
      `<a href="${m}" target="_blank" rel="nofollow noopener noreferrer" class="text-primary underline">${m}</a>`,
  );

  return linked.replace(/\n/g, "<br />");
}

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

export interface CommentNode extends PublicComment {
  replies: CommentNode[];
}

/**
 * Build a single-level threaded view: top-level comments plus a flat list
 * of replies under each. Deeper nesting is rendered inline at the same
 * level (parent points to closest top-level ancestor).
 */
export function buildThread(comments: PublicComment[]): CommentNode[] {
  const byId = new Map<string, PublicComment>();
  for (const c of comments) byId.set(c.id, c);

  const topLevelOf = (c: PublicComment): string => {
    let cur: PublicComment | undefined = c;
    const seen = new Set<string>();
    while (cur && cur.parentCommentId && !seen.has(cur.id)) {
      seen.add(cur.id);
      const parent = byId.get(cur.parentCommentId);
      if (!parent) break;
      cur = parent;
    }
    return cur?.id ?? c.id;
  };

  const roots: CommentNode[] = [];
  const rootMap = new Map<string, CommentNode>();
  // First pass: collect roots in chronological order.
  const sorted = [...comments].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  for (const c of sorted) {
    if (!c.parentCommentId) {
      const node: CommentNode = { ...c, replies: [] };
      roots.push(node);
      rootMap.set(c.id, node);
    }
  }
  // Second pass: attach replies to their nearest top-level ancestor.
  for (const c of sorted) {
    if (!c.parentCommentId) continue;
    const rootId = topLevelOf(c);
    const root = rootMap.get(rootId);
    if (root) root.replies.push({ ...c, replies: [] });
  }
  return roots;
}
