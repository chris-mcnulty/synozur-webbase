import { sendEmail } from "./email";
import { logger } from "./logger";

// #223 — Careers transactional emails. Branded with the same gradient shell
// the rest of the site uses; falls back to no-op when SendGrid isn't
// configured so dev / CI environments don't depend on the connector.

const SITE_URL = process.env["SITE_URL"] ?? "https://synozur.com";

const GRADIENT = "linear-gradient(135deg, #810FFB 0%, #E60CB3 100%)";

function shell(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#0b0b1f;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#fff;">
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:32px 16px;">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#11112a;border-radius:16px;overflow:hidden;">
<tr><td style="background:${GRADIENT};padding:24px;color:#fff;font-weight:700;font-size:20px;">The Synozur Alliance — Careers</td></tr>
<tr><td style="padding:24px;color:#e9e9f0;line-height:1.55;">
<h1 style="margin:0 0 16px;font-size:22px;color:#fff;">${title}</h1>
${bodyHtml}
</td></tr>
<tr><td style="padding:16px 24px;color:#8a8aa3;font-size:12px;border-top:1px solid #232347;">
Synozur Alliance · <a href="${SITE_URL}" style="color:#9d8aff;">synozur.com</a>
</td></tr>
</table></td></tr></table></body></html>`;
}

export async function sendApplicantConfirmation(args: {
  to: string;
  applicantName: string;
  jobTitle: string | null;
}): Promise<void> {
  const title = args.jobTitle
    ? `Thanks for applying to ${args.jobTitle}`
    : "Thanks for joining our talent network";
  const body = `<p>Hi ${args.applicantName || "there"},</p>
<p>We've received your application${
    args.jobTitle ? ` for <strong>${args.jobTitle}</strong>` : ""
  } and our team will be in touch if there's a fit.</p>
<p>You can review your submission anytime at <a href="${SITE_URL}/careers" style="color:#9d8aff;">${SITE_URL}/careers</a>.</p>
<p>— The Synozur Talent Team</p>`;
  try {
    await sendEmail({
      to: args.to,
      subject: title,
      html: shell(title, body),
      text: `${title}\n\nHi ${args.applicantName || "there"},\n\nWe've received your application${
        args.jobTitle ? ` for ${args.jobTitle}` : ""
      } and our team will be in touch.\n\n— The Synozur Talent Team`,
    });
  } catch (err) {
    logger.warn({ err }, "careersEmail: applicant confirmation failed");
  }
}

export async function sendHiringManagerNotification(args: {
  to: string;
  applicantName: string;
  jobTitle: string;
  applicationId: string;
}): Promise<void> {
  const adminUrl = `${SITE_URL}/admin/careers/applications/${args.applicationId}`;
  const title = `New application: ${args.jobTitle}`;
  const body = `<p><strong>${args.applicantName}</strong> just applied for <strong>${args.jobTitle}</strong>.</p>
<p><a href="${adminUrl}" style="display:inline-block;background:${GRADIENT};color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;">Review application</a></p>
<p style="color:#8a8aa3;font-size:12px;">${adminUrl}</p>`;
  try {
    await sendEmail({
      to: args.to,
      subject: title,
      html: shell(title, body),
      text: `${title}\n\n${args.applicantName} just applied for ${args.jobTitle}.\nReview: ${adminUrl}`,
    });
  } catch (err) {
    logger.warn({ err }, "careersEmail: hiring manager notification failed");
  }
}
