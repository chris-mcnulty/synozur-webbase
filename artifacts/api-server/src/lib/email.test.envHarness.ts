/**
 * Subprocess harness for testing module-load-time env captures in email.ts
 * (specifically EMAIL_FROM_OVERRIDE and FORMS_NOTIFY_EMAIL, which are read
 * once at import time). The parent test sets the desired env vars, spawns
 * this harness via `node --import tsx`, and parses the JSON it prints to
 * stdout to assert on the captured outgoing SendGrid message.
 *
 * Args: <kind>
 *   kind = "sendEmail"             -> calls sendEmail() and prints captured `from`
 *   kind = "sendInternal"          -> calls sendInternalNotification() and prints
 *                                     `{ to, subject, html, replyTo, status }`
 *
 * Stdout contract: the LAST line is JSON. Anything else (logger output, etc.)
 * is ignored by the parent.
 */
import { MailService } from "@sendgrid/mail";

interface CapturedMessage {
  to: unknown;
  from: unknown;
  subject: string;
  html: string;
  text: string;
  replyTo?: unknown;
}

const state: { captured: CapturedMessage | null } = { captured: null };
MailService.prototype.send = (async function patchedSend(
  msg: unknown,
): Promise<unknown> {
  state.captured = msg as CapturedMessage;
  return [{ statusCode: 202 }, {}];
}) as typeof MailService.prototype.send;

globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  if (url.includes("connectors.test.invalid")) {
    return new Response(
      JSON.stringify({
        items: [
          {
            settings: {
              api_key: "SG.harness",
              from_email: "connector-default@synozur.com",
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  return new Response("not found", { status: 404 });
}) as typeof fetch;

const kind = process.argv[2];

const email = await import("./email.js");

// Sentinel-delimited JSON so the parent can ignore any logger output that
// pino flushes alongside ours.
const SENTINEL = "__HARNESS_JSON__:";

if (kind === "sendEmail") {
  const result = await email.sendEmail({
    to: "to@x.com",
    subject: "harness",
    html: "<p>h</p>",
    text: "t",
    template: "test",
  });
  process.stdout.write(
    SENTINEL +
      JSON.stringify({ result, from: state.captured?.from ?? null }) +
      "\n",
  );
} else if (kind === "sendInternal") {
  const result = await email.sendInternalNotification({
    formType: "contact",
    submissionId: 42,
    email: "visitor@x.com",
    name: "Visitor",
    payload: { message: "Hello & <world>", phone: "" },
  });
  process.stdout.write(
    SENTINEL +
      JSON.stringify({
        result,
        to: state.captured?.to ?? null,
        subject: state.captured?.subject ?? null,
        html: state.captured?.html ?? null,
        replyTo: state.captured?.replyTo ?? null,
      }) +
      "\n",
  );
} else {
  process.stderr.write(`unknown kind: ${kind}\n`);
  process.exit(2);
}
