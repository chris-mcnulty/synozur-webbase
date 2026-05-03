import { logger } from "./logger";
import { signUnsubscribeToken } from "./unsubscribeToken";
import {
  getUncachableSendGridClient,
  SendGridNotConfiguredError,
} from "./sendgridClient";
import { db } from "@workspace/db";
import { emailMessagesTable } from "@workspace/db/schema";

// Email transport.
//
// Delivery goes through SendGrid via the Replit SendGrid connector. The
// connector must be installed via the Integrations panel — it provides
// `api_key` and `from_email` and the client is fetched fresh on every send
// (see `sendgridClient.ts`) so rotated tokens are picked up automatically.
//
// `EMAIL_FROM` (e.g. `"Display Name <addr@example.com>"`) and `FORMS_NOTIFY_EMAIL`
// continue to be honored as before. Without the SendGrid connector all sends
// are skipped gracefully so local development and tests still work.

const EMAIL_FROM_OVERRIDE = process.env["EMAIL_FROM"] ?? "";
const FORMS_NOTIFY_EMAIL = process.env["FORMS_NOTIFY_EMAIL"] ?? "";
const SITE_URL = process.env["SITE_URL"] ?? "https://synozur.com";
const FROM_NAME = "The Synozur Alliance";

export interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  // #221 — template slug recorded on the email_messages row so the admin
  // log at /admin/email can group / filter sends by template family. All
  // call sites in this file pass a stable string (e.g. "comment-approved").
  template: string;
}

export interface SendEmailResult {
  status: "ok" | "skipped" | "error";
  error: string | null;
  // X-Message-Id from the SendGrid response (when accepted). Captured so
  // callers can correlate a send with downstream webhook events without
  // having to hit the DB.
  messageId?: string | null;
}

// Parse "Display Name <addr@example.com>" or a bare address. Returns the
// {name?, email} pair SendGrid expects.
export function parseFromOverride(value: string): { email: string; name?: string } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const angle = trimmed.match(/^(.*)<\s*([^>]+)\s*>\s*$/);
  if (angle) {
    const name = angle[1]?.trim().replace(/^"(.*)"$/, "$1") ?? "";
    const email = angle[2]?.trim() ?? "";
    if (!email) return null;
    return name ? { email, name } : { email };
  }
  return { email: trimmed };
}

export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  // Test/CI hatch: when EMAIL_DISABLED=1, skip delivery entirely. Used by
  // integration tests that exercise routes which fire-and-forget email sends
  // (e.g. /api/auth/register) so they never hit the live SendGrid connector.
  if (process.env["EMAIL_DISABLED"] === "1") {
    logger.info(
      { to: args.to, subject: args.subject },
      "Email skipped (EMAIL_DISABLED=1)",
    );
    return { status: "skipped", error: null };
  }
  let handle;
  try {
    handle = await getUncachableSendGridClient();
  } catch (err) {
    if (err instanceof SendGridNotConfiguredError) {
      logger.info(
        { to: args.to, subject: args.subject },
        "Email skipped (SendGrid connector not configured)",
      );
      return { status: "skipped", error: null };
    }
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg, to: args.to }, "Email send threw");
    return { status: "error", error: msg };
  }

  const override = parseFromOverride(EMAIL_FROM_OVERRIDE);
  const from = override ?? { email: handle.fromEmail, name: FROM_NAME };

  try {
    const message: Parameters<typeof handle.client.send>[0] = {
      to: args.to,
      from,
      subject: args.subject,
      html: args.html,
      text: args.text,
      ...(args.replyTo ? { replyTo: args.replyTo } : {}),
    };
    const sendResult = await handle.client.send(message);
    // #221 — `@sendgrid/mail` returns `[ClientResponse, {}]` for a single
    // send; the X-Message-Id header is the prefix that webhook events
    // reference in `sg_message_id`.
    const messageId = extractMessageId(sendResult);
    logger.info(
      { to: args.to, subject: args.subject, messageId, template: args.template },
      "Email sent via SendGrid",
    );
    if (messageId) {
      try {
        await db
          .insert(emailMessagesTable)
          .values({
            messageId,
            toEmail: args.to,
            subject: args.subject,
            template: args.template,
          })
          .onConflictDoNothing({ target: emailMessagesTable.messageId });
      } catch (dbErr) {
        // Logging-only failure shouldn't fail the send. Webhook ingest
        // will still record the events; they'll just have a NULL FK.
        logger.warn(
          { err: dbErr, messageId },
          "Failed to persist email_messages row",
        );
      }
    } else {
      logger.warn(
        { to: args.to, template: args.template },
        "SendGrid accepted send but did not return X-Message-Id",
      );
    }
    return { status: "ok", error: null, messageId: messageId ?? null };
  } catch (err) {
    const e = err as { code?: number; message?: string; response?: { body?: unknown } };
    const status = typeof e.code === "number" ? e.code : undefined;
    const msg = e.message ?? String(err);
    logger.warn(
      { status, err: msg, to: args.to },
      "Email send failed",
    );
    return {
      status: "error",
      error: status ? `http_${status}: ${msg}` : msg,
    };
  }
}

// SendGrid's MailService.send() resolves with `[ClientResponse, {}]` where
// ClientResponse exposes the upstream response headers as a plain object.
// Some test/mocked clients return just the ClientResponse, so handle both.
function extractMessageId(result: unknown): string | null {
  const candidate: unknown = Array.isArray(result) ? result[0] : result;
  if (!candidate || typeof candidate !== "object") return null;
  const headers = (candidate as { headers?: Record<string, unknown> }).headers;
  if (!headers || typeof headers !== "object") return null;
  // Header names are case-insensitive; SendGrid sends lowercase. Check both
  // common spellings to be safe.
  const raw = headers["x-message-id"] ?? headers["X-Message-Id"] ?? headers["X-Message-ID"];
  if (typeof raw === "string" && raw.trim().length > 0) return raw.trim();
  return null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const BRAND_PRIMARY = "#810FFB";

function brandedShell(opts: {
  preheader: string;
  heading: string;
  bodyHtml: string;
}): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(opts.heading)}</title>
  </head>
  <body style="margin:0;padding:0;background:#0b0b1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a2e;">
    <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${escapeHtml(opts.preheader)}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0b1a;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.25);">
            <tr>
              <td style="background:linear-gradient(135deg,#810FFB 0%,#3a0ca3 100%);padding:28px 32px;color:#ffffff;">
                <div style="font-size:13px;letter-spacing:0.18em;text-transform:uppercase;opacity:0.85;">The Synozur Alliance</div>
                <div style="margin-top:6px;font-size:22px;font-weight:600;line-height:1.25;">${escapeHtml(opts.heading)}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px;font-size:15px;line-height:1.6;color:#1a1a2e;">
                ${opts.bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;border-top:1px solid #ececf5;font-size:12px;color:#6b6b80;">
                The Synozur Alliance &middot; The Transformation Company<br />
                <a href="${escapeHtml(SITE_URL)}" style="color:${BRAND_PRIMARY};text-decoration:none;">${escapeHtml(SITE_URL.replace(/^https?:\/\//, ""))}</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export interface VisitorEmailContent {
  subject: string;
  heading: string;
  preheader: string;
  intro: string;
  closing: string;
}

const VISITOR_COPY: Record<"contact" | "subscribe" | "start", VisitorEmailContent> = {
  contact: {
    subject: "We received your message — The Synozur Alliance",
    heading: "Thanks for reaching out",
    preheader: "We've received your message and a partner will reply within two business days.",
    intro: "Thanks for getting in touch with The Synozur Alliance. We've received your message and a partner from our team will personally reply within two business days.",
    closing: "If your note is time-sensitive, just reply to this email and it will reach us directly.",
  },
  subscribe: {
    subject: "You're subscribed to Synozur insights",
    heading: "Welcome aboard",
    preheader: "You're now on the list for Synozur insights and announcements.",
    intro: "Thanks for subscribing. You'll receive our occasional insights, research, and announcements — never spam, and you can unsubscribe at any time.",
    closing: "We're glad to have you with us.",
  },
  start: {
    subject: "Your Get Started request — The Synozur Alliance",
    heading: "Let's get started",
    preheader: "We've received your Get Started request and a partner will reply within two business days.",
    intro: "Thanks for telling us about your initiative. A partner from The Synozur Alliance will personally review your request and respond within two business days to schedule a conversation.",
    closing: "In the meantime, feel free to reply to this email with anything else you'd like us to know.",
  },
};

// #259 — DOI confirmation email. Sent on /forms/subscribe before any
// marketing send; recipient must click the signed link for the row to flip
// to `status='confirmed'` and unlock downstream sends.
export async function sendSubscriptionConfirmation(args: {
  to: string;
  confirmUrl: string;
}): Promise<SendEmailResult> {
  const html = brandedShell({
    preheader: "Confirm your Synozur Alliance newsletter subscription.",
    heading: "Confirm your subscription",
    bodyHtml: `
      <p style="margin:0 0 16px;">Hello,</p>
      <p style="margin:0 0 16px;">Thanks for signing up for Synozur Alliance insights. Please confirm your subscription by clicking the button below. This link expires in 7 days.</p>
      <p style="margin:24px 0;">
        <a href="${escapeHtml(args.confirmUrl)}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;">Confirm subscription</a>
      </p>
      <p style="margin:16px 0 0;font-size:13px;color:#6b6b80;">If you didn't sign up, you can safely ignore this email — we won't send you anything else.</p>
      <p style="margin:8px 0 0;font-size:12px;color:#9999aa;word-break:break-all;">Or copy this link: ${escapeHtml(args.confirmUrl)}</p>
    `,
  });
  const text = [
    "Hello,",
    "",
    "Thanks for signing up for Synozur Alliance insights. Please confirm your subscription by visiting the link below. This link expires in 7 days.",
    "",
    args.confirmUrl,
    "",
    "If you didn't sign up, you can safely ignore this email — we won't send you anything else.",
    "",
    "— The Synozur Alliance",
  ].join("\n");
  return sendEmail({
    to: args.to,
    subject: "Confirm your subscription — The Synozur Alliance",
    html,
    text,
    template: "subscription-confirmation",
  });
}

export async function sendVisitorConfirmation(
  formType: "contact" | "subscribe" | "start",
  to: string,
  name: string | null,
): Promise<SendEmailResult> {
  const copy = VISITOR_COPY[formType];
  const greeting = name && name.trim().length > 0 ? `Hi ${escapeHtml(name.trim())},` : "Hello,";
  const html = brandedShell({
    preheader: copy.preheader,
    heading: copy.heading,
    bodyHtml: `
      <p style="margin:0 0 16px;">${greeting}</p>
      <p style="margin:0 0 16px;">${escapeHtml(copy.intro)}</p>
      <p style="margin:0 0 16px;">${escapeHtml(copy.closing)}</p>
      <p style="margin:24px 0 0;">— The Synozur Alliance</p>
    `,
  });
  const text = [
    name && name.trim().length > 0 ? `Hi ${name.trim()},` : "Hello,",
    "",
    copy.intro,
    "",
    copy.closing,
    "",
    "— The Synozur Alliance",
    SITE_URL,
  ].join("\n");
  return sendEmail({
    to,
    subject: copy.subject,
    html,
    text,
    template: `visitor-${formType}`,
  });
}

function renderPayloadHtml(payload: Record<string, unknown>): string {
  const rows = Object.entries(payload)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => {
      const value = typeof v === "string" ? v : JSON.stringify(v);
      return `<tr>
        <td style="padding:6px 12px 6px 0;vertical-align:top;color:#6b6b80;font-weight:500;white-space:nowrap;">${escapeHtml(k)}</td>
        <td style="padding:6px 0;vertical-align:top;color:#1a1a2e;white-space:pre-wrap;">${escapeHtml(value)}</td>
      </tr>`;
    })
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px;">${rows}</table>`;
}

function renderPayloadText(payload: Record<string, unknown>): string {
  return Object.entries(payload)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("\n");
}

// #53: transactional email to a visitor whose comment has just been
// approved, or whose comment has just received a reply. Both use the
// branded shell; the destination post URL is derived from SITE_URL so
// emails always point at the canonical deployment.
function commentPostUrl(postSlug: string, commentId: string | null): string {
  const base = SITE_URL.replace(/\/$/, "");
  const path = `/insights/${encodeURIComponent(postSlug)}`;
  return commentId ? `${base}${path}#comment-${commentId}` : `${base}${path}`;
}

export async function sendCommentApprovedEmail(args: {
  to: string;
  commenterName: string | null;
  postTitle: string;
  postSlug: string;
  commentId: string;
  bodyText: string;
}): Promise<SendEmailResult> {
  const url = commentPostUrl(args.postSlug, args.commentId);
  const unsubToken = signUnsubscribeToken(args.commentId, "approval");
  const unsubUrl = `${SITE_URL.replace(/\/$/, "")}/api/comments/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
  const greeting =
    args.commenterName && args.commenterName.trim().length > 0
      ? `Hi ${escapeHtml(args.commenterName.trim())},`
      : "Hello,";
  const html = brandedShell({
    preheader: `Your comment on "${args.postTitle}" is now live.`,
    heading: "Your comment is live",
    bodyHtml: `
      <p style="margin:0 0 16px;">${greeting}</p>
      <p style="margin:0 0 16px;">Thanks for joining the conversation. Your comment on <strong>${escapeHtml(args.postTitle)}</strong> has been approved and is now visible to other readers.</p>
      <blockquote style="margin:0 0 20px;padding:12px 16px;border-left:3px solid ${BRAND_PRIMARY};background:#f7f5ff;color:#1a1a2e;white-space:pre-wrap;">${escapeHtml(args.bodyText)}</blockquote>
      <p style="margin:0 0 16px;">
        <a href="${escapeHtml(url)}" style="color:${BRAND_PRIMARY};font-weight:600;text-decoration:none;">View your comment →</a>
      </p>
      <p style="margin:24px 0 0;">— The Synozur Alliance</p>
      <p style="margin:16px 0 0;font-size:12px;color:#9999aa;">Don't want approval emails? <a href="${escapeHtml(unsubUrl)}" style="color:#9999aa;">Unsubscribe</a></p>
    `,
  });
  const text = [
    args.commenterName && args.commenterName.trim().length > 0
      ? `Hi ${args.commenterName.trim()},`
      : "Hello,",
    "",
    `Thanks for joining the conversation. Your comment on "${args.postTitle}" has been approved and is now visible to other readers.`,
    "",
    args.bodyText,
    "",
    `View it here: ${url}`,
    "",
    "— The Synozur Alliance",
    "",
    `Don't want approval emails? Unsubscribe: ${unsubUrl}`,
  ].join("\n");
  return sendEmail({
    to: args.to,
    subject: `Your comment on "${args.postTitle}" is live`,
    html,
    text,
    template: "comment-approved",
  });
}

export async function sendCommentReplyEmail(args: {
  to: string;
  parentCommenterName: string | null;
  replyAuthorName: string;
  postTitle: string;
  postSlug: string;
  parentCommentId: string;
  replyCommentId: string;
  replyBodyText: string;
}): Promise<SendEmailResult> {
  const url = commentPostUrl(args.postSlug, args.replyCommentId);
  const unsubToken = signUnsubscribeToken(args.parentCommentId, "reply");
  const unsubUrl = `${SITE_URL.replace(/\/$/, "")}/api/comments/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
  const greeting =
    args.parentCommenterName && args.parentCommenterName.trim().length > 0
      ? `Hi ${escapeHtml(args.parentCommenterName.trim())},`
      : "Hello,";
  const html = brandedShell({
    preheader: `${args.replyAuthorName} replied to your comment on "${args.postTitle}".`,
    heading: "Someone replied to your comment",
    bodyHtml: `
      <p style="margin:0 0 16px;">${greeting}</p>
      <p style="margin:0 0 16px;"><strong>${escapeHtml(args.replyAuthorName)}</strong> replied to your comment on <strong>${escapeHtml(args.postTitle)}</strong>:</p>
      <blockquote style="margin:0 0 20px;padding:12px 16px;border-left:3px solid ${BRAND_PRIMARY};background:#f7f5ff;color:#1a1a2e;white-space:pre-wrap;">${escapeHtml(args.replyBodyText)}</blockquote>
      <p style="margin:0 0 16px;">
        <a href="${escapeHtml(url)}" style="color:${BRAND_PRIMARY};font-weight:600;text-decoration:none;">Read the reply →</a>
      </p>
      <p style="margin:24px 0 0;">— The Synozur Alliance</p>
      <p style="margin:16px 0 0;font-size:12px;color:#9999aa;">Don't want reply emails? <a href="${escapeHtml(unsubUrl)}" style="color:#9999aa;">Unsubscribe</a></p>
    `,
  });
  const text = [
    args.parentCommenterName && args.parentCommenterName.trim().length > 0
      ? `Hi ${args.parentCommenterName.trim()},`
      : "Hello,",
    "",
    `${args.replyAuthorName} replied to your comment on "${args.postTitle}":`,
    "",
    args.replyBodyText,
    "",
    `Read it here: ${url}`,
    "",
    "— The Synozur Alliance",
    "",
    `Don't want reply emails? Unsubscribe: ${unsubUrl}`,
  ].join("\n");
  return sendEmail({
    to: args.to,
    subject: `New reply on "${args.postTitle}"`,
    html,
    text,
    template: "comment-reply",
  });
}

export async function sendEmailVerification(args: {
  to: string;
  name: string | null;
  token: string;
}): Promise<SendEmailResult> {
  const link = `${SITE_URL}/verify-email?token=${encodeURIComponent(args.token)}`;
  const greeting = args.name && args.name.trim().length > 0 ? `Hi ${escapeHtml(args.name.trim())},` : "Hello,";
  const html = brandedShell({
    preheader: "Verify your email address to activate your Synozur Alliance account.",
    heading: "Verify your email address",
    bodyHtml: `
      <p style="margin:0 0 16px;">${greeting}</p>
      <p style="margin:0 0 16px;">Thanks for creating an account with The Synozur Alliance. Please verify your email address by clicking the button below. This link expires in 24 hours.</p>
      <p style="margin:24px 0;">
        <a href="${escapeHtml(link)}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;">Verify email address</a>
      </p>
      <p style="margin:16px 0 0;font-size:13px;color:#6b6b80;">If you didn't create an account, you can safely ignore this email.</p>
      <p style="margin:8px 0 0;font-size:12px;color:#9999aa;word-break:break-all;">Or copy this link: ${escapeHtml(link)}</p>
    `,
  });
  const text = [
    args.name && args.name.trim().length > 0 ? `Hi ${args.name.trim()},` : "Hello,",
    "",
    "Thanks for creating an account with The Synozur Alliance. Please verify your email address by visiting the link below. This link expires in 24 hours.",
    "",
    link,
    "",
    "If you didn't create an account, you can safely ignore this email.",
    "",
    "— The Synozur Alliance",
  ].join("\n");
  return sendEmail({
    to: args.to,
    subject: "Verify your email — The Synozur Alliance",
    html,
    text,
    template: "email-verification",
  });
}

// Sent to a new Entra user whose sign-in auto-created a pending org.
export async function sendOrgPendingApproval(args: {
  to: string;
  name: string | null;
  orgName: string;
}): Promise<SendEmailResult> {
  const greeting = args.name && args.name.trim().length > 0 ? `Hi ${escapeHtml(args.name.trim())},` : "Hello,";
  const html = brandedShell({
    preheader: `Welcome to The Synozur Alliance — your organization is pending approval.`,
    heading: "Your account is registered",
    bodyHtml: `
      <p style="margin:0 0 16px;">${greeting}</p>
      <p style="margin:0 0 16px;">Welcome! You've signed in to The Synozur Alliance for the first time. We've automatically registered your organization, <strong>${escapeHtml(args.orgName)}</strong>, in our portal.</p>
      <p style="margin:0 0 16px;">Before your team can access our client applications, a Synozur partner needs to approve your organization. This usually happens within one business day.</p>
      <p style="margin:0 0 16px;">You'll receive another email once your organization has been approved and your account is fully activated.</p>
      <p style="margin:24px 0 0;">— The Synozur Alliance</p>
    `,
  });
  const text = [
    args.name && args.name.trim().length > 0 ? `Hi ${args.name.trim()},` : "Hello,",
    "",
    `Welcome! You've signed in to The Synozur Alliance for the first time. We've automatically registered your organization, ${args.orgName}, in our portal.`,
    "",
    "Before your team can access our client applications, a Synozur partner needs to approve your organization. This usually happens within one business day.",
    "",
    "You'll receive another email once your organization has been approved and your account is fully activated.",
    "",
    "— The Synozur Alliance",
    SITE_URL,
  ].join("\n");
  return sendEmail({
    to: args.to,
    subject: "Your Synozur Alliance account is registered — pending org approval",
    html,
    text,
    template: "org-pending-approval",
  });
}

// Sent when Synozur admin approves a pending client organization.
export async function sendOrgApproved(args: {
  to: string;
  name: string | null;
  orgName: string;
}): Promise<SendEmailResult> {
  const portalUrl = `${SITE_URL}/sign-in`;
  const greeting = args.name && args.name.trim().length > 0 ? `Hi ${escapeHtml(args.name.trim())},` : "Hello,";
  const html = brandedShell({
    preheader: `Your organization ${args.orgName} has been approved — you can now access Synozur apps.`,
    heading: "Your organization is approved",
    bodyHtml: `
      <p style="margin:0 0 16px;">${greeting}</p>
      <p style="margin:0 0 16px;">Great news — The Synozur Alliance has approved <strong>${escapeHtml(args.orgName)}</strong>. Your account now has full access to our client portal and applications.</p>
      <p style="margin:24px 0;">
        <a href="${escapeHtml(portalUrl)}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;">Sign in to the portal</a>
      </p>
      <p style="margin:24px 0 0;">— The Synozur Alliance</p>
    `,
  });
  const text = [
    args.name && args.name.trim().length > 0 ? `Hi ${args.name.trim()},` : "Hello,",
    "",
    `Great news — The Synozur Alliance has approved ${args.orgName}. Your account now has full access to our client portal and applications.`,
    "",
    `Sign in here: ${portalUrl}`,
    "",
    "— The Synozur Alliance",
    SITE_URL,
  ].join("\n");
  return sendEmail({
    to: args.to,
    subject: `Your organization ${args.orgName} is approved — The Synozur Alliance`,
    html,
    text,
    template: "org-approved",
  });
}

// #225 — invite email sent when an account manager adds a brand-new email
// to a client organization. Reuses the password-reset visual layout but with
// org-specific copy that mentions the organization name and links to a
// dedicated /accept-invite landing.
export async function sendClientOrgInvite(args: {
  to: string;
  name: string | null;
  orgName: string;
  inviterName: string | null;
  token: string;
}): Promise<SendEmailResult> {
  // Galaxy is the customer portal surface; the invite landing page lives
  // there so accepting drops the user straight into the portal experience
  // rather than the marketing site. Galaxy is mounted at /galaxy/ behind
  // the shared proxy on the same origin as SITE_URL. (#225)
  const galaxyOrigin = (process.env["GALAXY_URL"] ?? SITE_URL).replace(/\/$/, "");
  const link = `${galaxyOrigin}/galaxy/accept-invite?token=${encodeURIComponent(args.token)}`;
  const greeting =
    args.name && args.name.trim().length > 0
      ? `Hi ${escapeHtml(args.name.trim())},`
      : "Hello,";
  const inviter =
    args.inviterName && args.inviterName.trim().length > 0
      ? escapeHtml(args.inviterName.trim())
      : "Your account manager at The Synozur Alliance";
  const html = brandedShell({
    preheader: `You've been invited to ${args.orgName} on the Synozur Galaxy portal.`,
    heading: `You're invited to ${args.orgName}`,
    bodyHtml: `
      <p style="margin:0 0 16px;">${greeting}</p>
      <p style="margin:0 0 16px;">${inviter} has invited you to join <strong>${escapeHtml(args.orgName)}</strong> on the Synozur Galaxy portal. Click the button below to set your password — you'll be signed in automatically. This link expires in 7 days.</p>
      <p style="margin:24px 0;">
        <a href="${escapeHtml(link)}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;">Accept invitation</a>
      </p>
      <p style="margin:16px 0 0;font-size:13px;color:#6b6b80;">If you weren't expecting this invitation, you can safely ignore this email.</p>
      <p style="margin:8px 0 0;font-size:12px;color:#9999aa;word-break:break-all;">Or copy this link: ${escapeHtml(link)}</p>
    `,
  });
  const text = [
    args.name && args.name.trim().length > 0 ? `Hi ${args.name.trim()},` : "Hello,",
    "",
    `${args.inviterName ?? "Your account manager at The Synozur Alliance"} has invited you to join ${args.orgName} on the Synozur Galaxy portal. Visit the link below to set your password — you'll be signed in automatically. This link expires in 7 days.`,
    "",
    link,
    "",
    "If you weren't expecting this invitation, you can safely ignore this email.",
    "",
    "— The Synozur Alliance",
  ].join("\n");
  return sendEmail({
    to: args.to,
    subject: `You're invited to ${args.orgName} — Synozur Galaxy`,
    html,
    text,
    template: "client-org-invite",
  });
}

// #242 — Customer notification when an account manager publishes one or
// more deliverables on an engagement. The flusher coalesces multiple
// publishes into a single digest per engagement (~15 min throttle) so
// rapid back-to-back publishes don't spam the recipient.
export async function sendPortalDocumentsPublishedEmail(args: {
  to: string;
  recipientName: string | null;
  engagementTitle: string;
  filenames: string[];
}): Promise<SendEmailResult> {
  const galaxyOrigin = (process.env["GALAXY_URL"] ?? SITE_URL).replace(/\/$/, "");
  const link = `${galaxyOrigin}/galaxy/documents`;
  const greeting =
    args.recipientName && args.recipientName.trim().length > 0
      ? `Hi ${escapeHtml(args.recipientName.trim())},`
      : "Hello,";
  const count = args.filenames.length;
  const headline =
    count === 1
      ? `A new deliverable is ready on ${args.engagementTitle}`
      : `${count} new deliverables are ready on ${args.engagementTitle}`;
  const intro =
    count === 1
      ? `A new deliverable has been published on your <strong>${escapeHtml(args.engagementTitle)}</strong> engagement and is ready for review:`
      : `${count} new deliverables have been published on your <strong>${escapeHtml(args.engagementTitle)}</strong> engagement and are ready for review:`;
  const list = args.filenames
    .map((f) => `<li style="margin:4px 0;">${escapeHtml(f)}</li>`)
    .join("");
  const html = brandedShell({
    preheader: headline,
    heading: count === 1 ? "New deliverable available" : "New deliverables available",
    bodyHtml: `
      <p style="margin:0 0 16px;">${greeting}</p>
      <p style="margin:0 0 12px;">${intro}</p>
      <ul style="margin:0 0 20px;padding-left:22px;color:#1a1a2e;">${list}</ul>
      <p style="margin:24px 0;">
        <a href="${escapeHtml(link)}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;">Open Documents</a>
      </p>
      <p style="margin:24px 0 0;">— The Synozur Alliance</p>
    `,
  });
  const textIntro =
    count === 1
      ? `A new deliverable has been published on your ${args.engagementTitle} engagement and is ready for review:`
      : `${count} new deliverables have been published on your ${args.engagementTitle} engagement and are ready for review:`;
  const text = [
    args.recipientName && args.recipientName.trim().length > 0
      ? `Hi ${args.recipientName.trim()},`
      : "Hello,",
    "",
    textIntro,
    "",
    ...args.filenames.map((f) => `  - ${f}`),
    "",
    `Open Documents: ${link}`,
    "",
    "— The Synozur Alliance",
  ].join("\n");
  const subject =
    count === 1
      ? `New deliverable on ${args.engagementTitle} — Synozur Galaxy`
      : `${count} new deliverables on ${args.engagementTitle} — Synozur Galaxy`;
  return sendEmail({
    to: args.to,
    subject,
    html,
    text,
    template: "portal-documents-published",
  });
}

export async function sendPasswordReset(args: {
  to: string;
  name: string | null;
  token: string;
}): Promise<SendEmailResult> {
  const link = `${SITE_URL}/reset-password?token=${encodeURIComponent(args.token)}`;
  const greeting = args.name && args.name.trim().length > 0 ? `Hi ${escapeHtml(args.name.trim())},` : "Hello,";
  const html = brandedShell({
    preheader: "Reset your Synozur Alliance account password.",
    heading: "Reset your password",
    bodyHtml: `
      <p style="margin:0 0 16px;">${greeting}</p>
      <p style="margin:0 0 16px;">We received a request to reset the password for your account. Click the button below to choose a new password. This link expires in 1 hour.</p>
      <p style="margin:24px 0;">
        <a href="${escapeHtml(link)}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;">Reset password</a>
      </p>
      <p style="margin:16px 0 0;font-size:13px;color:#6b6b80;">If you didn't request a password reset, you can safely ignore this email — your password won't change.</p>
      <p style="margin:8px 0 0;font-size:12px;color:#9999aa;word-break:break-all;">Or copy this link: ${escapeHtml(link)}</p>
    `,
  });
  const text = [
    args.name && args.name.trim().length > 0 ? `Hi ${args.name.trim()},` : "Hello,",
    "",
    "We received a request to reset the password for your account. Visit the link below to choose a new password. This link expires in 1 hour.",
    "",
    link,
    "",
    "If you didn't request a password reset, you can safely ignore this email — your password won't change.",
    "",
    "— The Synozur Alliance",
  ].join("\n");
  return sendEmail({
    to: args.to,
    subject: "Reset your password — The Synozur Alliance",
    html,
    text,
    template: "password-reset",
  });
}

export async function sendInternalNotification(args: {
  formType: "contact" | "subscribe" | "start";
  submissionId: number;
  email: string | null;
  name: string | null;
  payload: Record<string, unknown>;
}): Promise<SendEmailResult> {
  if (!FORMS_NOTIFY_EMAIL) {
    return { status: "skipped", error: null };
  }
  const formLabel = { contact: "Contact", subscribe: "Subscribe", start: "Get Started" }[args.formType];
  const subject = `[Synozur ${formLabel}] #${args.submissionId}${args.name ? ` — ${args.name}` : ""}`;
  const html = brandedShell({
    preheader: `New ${formLabel} submission #${args.submissionId}`,
    heading: `New ${formLabel} submission`,
    bodyHtml: `
      <p style="margin:0 0 16px;">Submission <strong>#${args.submissionId}</strong> just came in.</p>
      ${renderPayloadHtml(args.payload)}
    `,
  });
  const text = [
    `New ${formLabel} submission #${args.submissionId}`,
    "",
    renderPayloadText(args.payload),
  ].join("\n");
  return sendEmail({
    to: FORMS_NOTIFY_EMAIL,
    subject,
    html,
    text,
    replyTo: args.email ?? undefined,
    template: `internal-${args.formType}`,
  });
}
