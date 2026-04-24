// Hand-written wrapper around POST /api/insights/:slug/comments so we can
// pass the newer `turnstileToken`, `notifyOnApproval`, and `notifyOnReply`
// fields without regenerating the typed client for each additive change.
//
// The server's zod schema is the source of truth for which fields are
// honored; unknown fields are stripped silently by zod.

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

export interface SubmitCommentInput {
  authorName: string;
  authorEmail: string;
  bodyText: string;
  parentCommentId?: string | null;
  website?: string | null;
  turnstileToken?: string | null;
  notifyOnApproval?: boolean;
  notifyOnReply?: boolean;
}

export interface SubmitCommentResult {
  id: string;
  status: string;
}

export async function submitComment(
  slug: string,
  body: SubmitCommentInput,
): Promise<SubmitCommentResult> {
  const res = await fetch(`${BASE_PATH}/api/insights/${encodeURIComponent(slug)}/comments`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return (await res.json()) as SubmitCommentResult;
}
