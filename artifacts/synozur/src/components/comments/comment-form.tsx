import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { submitComment } from "@/lib/comments-api";
import {
  Turnstile,
  TURNSTILE_SITE_KEY,
  type TurnstileHandle,
} from "@/components/turnstile";

interface CommentFormProps {
  slug: string;
  parentCommentId?: string | null;
  parentAuthorName?: string | null;
  onCancel?: () => void;
  onSuccess?: () => void;
}

interface FormState {
  authorName: string;
  authorEmail: string;
  bodyText: string;
  website: string;
  notifyOnApproval: boolean;
  notifyOnReply: boolean;
}

const EMPTY: FormState = {
  authorName: "",
  authorEmail: "",
  bodyText: "",
  website: "",
  notifyOnApproval: false,
  notifyOnReply: false,
};

export function CommentForm({
  slug,
  parentCommentId,
  parentAuthorName,
  onCancel,
  onSuccess,
}: CommentFormProps) {
  const [state, setState] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);

  function validate(): boolean {
    const next: Partial<Record<keyof FormState, string>> = {};
    if (!state.authorName.trim()) next.authorName = "Please add your name.";
    if (!state.authorEmail.trim()) next.authorEmail = "Please add your email.";
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(state.authorEmail.trim()))
      next.authorEmail = "That doesn't look like a valid email.";
    if (!state.bodyText.trim()) next.bodyText = "Please add a comment.";
    else if (state.bodyText.length > 5000) next.bodyText = "Comments must be under 5000 characters.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (!validate()) return;
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      setSubmitError("Please wait a moment while we verify your browser, then try again.");
      return;
    }
    setSubmitting(true);
    try {
      await submitComment(slug, {
        authorName: state.authorName.trim(),
        authorEmail: state.authorEmail.trim(),
        bodyText: state.bodyText.trim(),
        parentCommentId: parentCommentId ?? null,
        website: state.website,
        turnstileToken,
        notifyOnApproval: state.notifyOnApproval,
        notifyOnReply: parentCommentId ? false : state.notifyOnReply,
      });
      setSubmitted(true);
      setState(EMPTY);
      onSuccess?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      if (/429/.test(message)) {
        setSubmitError("You're commenting a bit fast — please wait a minute and try again.");
      } else {
        setSubmitError("We couldn't submit your comment. Please try again in a moment.");
      }
      turnstileRef.current?.reset();
      setTurnstileToken(null);
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div
        className="rounded-2xl border border-border/60 bg-card p-6"
        data-testid="comment-form-success"
      >
        <p className="text-base font-medium mb-1">Thanks — your comment is awaiting review.</p>
        <p className="text-sm text-muted-foreground">
          A moderator will take a look shortly. It will appear here once approved.
        </p>
        <div className="mt-4 flex gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setSubmitted(false)}
            data-testid="comment-form-add-another"
          >
            Add another comment
          </Button>
          {onCancel && (
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              Close
            </Button>
          )}
        </div>
      </div>
    );
  }

  const idPrefix = parentCommentId ? `reply-${parentCommentId}` : "comment";

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-border/60 bg-card p-6 space-y-4"
      data-testid={parentCommentId ? `comment-reply-form-${parentCommentId}` : "comment-form"}
      noValidate
    >
      <div>
        <h3 className="text-lg font-semibold">
          {parentCommentId ? `Reply to ${parentAuthorName ?? "comment"}` : "Leave a comment"}
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Comments are reviewed before they appear. Your email is never displayed publicly.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label htmlFor={`${idPrefix}-name`}>Name</Label>
          <Input
            id={`${idPrefix}-name`}
            name="name"
            value={state.authorName}
            onChange={(e) => setState((s) => ({ ...s, authorName: e.target.value }))}
            autoComplete="name"
            required
            aria-invalid={Boolean(errors.authorName)}
            data-testid="comment-input-name"
          />
          {errors.authorName && (
            <p className="text-xs text-destructive mt-1">{errors.authorName}</p>
          )}
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-email`}>Email (not displayed)</Label>
          <Input
            id={`${idPrefix}-email`}
            name="email"
            type="email"
            value={state.authorEmail}
            onChange={(e) => setState((s) => ({ ...s, authorEmail: e.target.value }))}
            autoComplete="email"
            required
            aria-invalid={Boolean(errors.authorEmail)}
            data-testid="comment-input-email"
          />
          {errors.authorEmail && (
            <p className="text-xs text-destructive mt-1">{errors.authorEmail}</p>
          )}
        </div>
      </div>

      <div>
        <Label htmlFor={`${idPrefix}-body`}>Comment</Label>
        <Textarea
          id={`${idPrefix}-body`}
          name="body"
          value={state.bodyText}
          onChange={(e) => setState((s) => ({ ...s, bodyText: e.target.value }))}
          rows={5}
          required
          aria-invalid={Boolean(errors.bodyText)}
          data-testid="comment-input-body"
        />
        {errors.bodyText && <p className="text-xs text-destructive mt-1">{errors.bodyText}</p>}
      </div>

      <div className="space-y-2">
        <label
          className="flex items-start gap-2 text-sm text-muted-foreground cursor-pointer"
          htmlFor={`${idPrefix}-notify-approval`}
        >
          <Checkbox
            id={`${idPrefix}-notify-approval`}
            checked={state.notifyOnApproval}
            onCheckedChange={(v) =>
              setState((s) => ({ ...s, notifyOnApproval: v === true }))
            }
            data-testid="comment-notify-approval"
          />
          <span>Email me when this comment is approved.</span>
        </label>
        {!parentCommentId && (
          <label
            className="flex items-start gap-2 text-sm text-muted-foreground cursor-pointer"
            htmlFor={`${idPrefix}-notify-reply`}
          >
            <Checkbox
              id={`${idPrefix}-notify-reply`}
              checked={state.notifyOnReply}
              onCheckedChange={(v) =>
                setState((s) => ({ ...s, notifyOnReply: v === true }))
              }
              data-testid="comment-notify-reply"
            />
            <span>Email me when someone replies.</span>
          </label>
        )}
      </div>

      {/* Honeypot — hidden via off-screen positioning, never display:none. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "-10000px",
          top: "auto",
          width: "1px",
          height: "1px",
          overflow: "hidden",
        }}
      >
        <Label htmlFor={`${idPrefix}-website`}>Website</Label>
        <Input
          id={`${idPrefix}-website`}
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={state.website}
          onChange={(e) => setState((s) => ({ ...s, website: e.target.value }))}
        />
      </div>

      {TURNSTILE_SITE_KEY && (
        <Turnstile
          ref={turnstileRef}
          onVerify={(token) => setTurnstileToken(token)}
          className="mt-2"
        />
      )}

      {submitError && (
        <p className="text-sm text-destructive" data-testid="comment-form-error">
          {submitError}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={submitting} data-testid="comment-submit">
          {submitting ? "Submitting…" : parentCommentId ? "Post reply" : "Post comment"}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
