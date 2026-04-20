import { logger } from "./logger";

const RESEND_API_KEY = process.env["RESEND_API_KEY"] ?? "";
const EMAIL_FROM =
  process.env["EMAIL_FROM"] ?? "The Synozur Alliance <hello@synozur.com>";
const FORMS_NOTIFY_EMAIL = process.env["FORMS_NOTIFY_EMAIL"] ?? "";
const SITE_URL = process.env["SITE_URL"] ?? "https://synozur.com";

export interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

export interface SendEmailResult {
  status: "ok" | "skipped" | "error";
  error: string | null;
}

export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  if (!RESEND_API_KEY) {
    logger.info({ to: args.to, subject: args.subject }, "Email skipped (no RESEND_API_KEY)");
    return { status: "skipped", error: null };
  }
  try {
    const body: Record<string, unknown> = {
      from: EMAIL_FROM,
      to: [args.to],
      subject: args.subject,
      html: args.html,
      text: args.text,
    };
    if (args.replyTo) body["reply_to"] = args.replyTo;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 500);
      logger.warn({ status: res.status, body: text, to: args.to }, "Email send failed");
      return { status: "error", error: `http_${res.status}: ${text}` };
    }
    return { status: "ok", error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg, to: args.to }, "Email send threw");
    return { status: "error", error: msg };
  }
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
  return sendEmail({ to, subject: copy.subject, html, text });
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
  });
}
