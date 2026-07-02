/**
 * Unit tests for the email transport.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:email
 *
 * These tests don't touch the live SendGrid connector or network. We:
 *   - Stub `globalThis.fetch` so `getUncachableSendGridClient()` thinks the
 *     Replit connector is configured and returns a fake api_key/from_email.
 *   - Patch `MailService.prototype.send` to capture the message that the
 *     transport would have sent (and to simulate 4xx/5xx errors when needed).
 *   - Drive the env that is captured at module-load time (EMAIL_FROM,
 *     SITE_URL, FORMS_NOTIFY_EMAIL) before the dynamic import below so the
 *     module observes the values we want.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MailService } from "@sendgrid/mail";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HARNESS = path.join(__dirname, "email.test.envHarness.ts");

// Module-load-time env captures live in email.ts. Set these *before* the
// dynamic import below so the module sees a clean default state for the
// "no override" / friendly-name test, and can address a stable SITE_URL.
delete process.env["EMAIL_FROM"];
delete process.env["EMAIL_DISABLED"];
delete process.env["FORMS_NOTIFY_EMAIL"];
process.env["SITE_URL"] = "https://synozur.com";
process.env["REPLIT_CONNECTORS_HOSTNAME"] = "connectors.test.invalid";
process.env["REPL_IDENTITY"] = "test-identity";

const email = await import("./email.js");

interface CapturedMessage {
  to: unknown;
  from: { email: string; name?: string } | string;
  subject: string;
  html: string;
  text: string;
  replyTo?: unknown;
}

let captured: CapturedMessage | null = null;
let sendImpl: (msg: CapturedMessage) => Promise<unknown> = async () => [
  { statusCode: 202 },
  {},
];

const originalSend = MailService.prototype.send;
MailService.prototype.send = async function patchedSend(
  this: MailService,
  msg: unknown,
): Promise<Awaited<ReturnType<typeof originalSend>>> {
  captured = msg as CapturedMessage;
  return sendImpl(msg as CapturedMessage) as ReturnType<typeof originalSend>;
} as unknown as typeof originalSend;

const originalFetch = globalThis.fetch;

function installConnectorFetch(opts: {
  fromEmail?: string;
  apiKey?: string;
} = {}): void {
  const fromEmail = opts.fromEmail ?? "alliance@synozur.com";
  const apiKey = opts.apiKey ?? "SG.test-key";
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
          items: [{ settings: { api_key: apiKey, from_email: fromEmail } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

test.beforeEach(() => {
  captured = null;
  sendImpl = async () => [{ statusCode: 202 }, {}];
  installConnectorFetch();
  process.env["REPLIT_CONNECTORS_HOSTNAME"] = "connectors.test.invalid";
  process.env["REPL_IDENTITY"] = "test-identity";
  delete process.env["EMAIL_DISABLED"];
});

test.after(() => {
  globalThis.fetch = originalFetch;
  MailService.prototype.send = originalSend;
});

// ---------------------------------------------------------------------------
// parseFromOverride
// ---------------------------------------------------------------------------

test('parseFromOverride: "Display Name <addr@x.com>" -> { name, email }', () => {
  assert.deepEqual(email.parseFromOverride("Display Name <addr@x.com>"), {
    name: "Display Name",
    email: "addr@x.com",
  });
});

test("parseFromOverride: quoted display name has its outer quotes stripped", () => {
  assert.deepEqual(email.parseFromOverride('"Quoted Name" <a@b.com>'), {
    name: "Quoted Name",
    email: "a@b.com",
  });
});

test("parseFromOverride: bare address without angle brackets", () => {
  assert.deepEqual(email.parseFromOverride("addr@x.com"), {
    email: "addr@x.com",
  });
});

test("parseFromOverride: angle-bracket form with no display name", () => {
  assert.deepEqual(email.parseFromOverride("<addr@x.com>"), {
    email: "addr@x.com",
  });
});

test("parseFromOverride: empty / whitespace-only input -> null", () => {
  assert.equal(email.parseFromOverride(""), null);
  assert.equal(email.parseFromOverride("   "), null);
});

// ---------------------------------------------------------------------------
// sendEmail — transport-level behaviour
// ---------------------------------------------------------------------------

test("sendEmail: SendGridNotConfiguredError -> { status: 'skipped' }", async () => {
  // Drop the connectors hostname so the SDK throws SendGridNotConfiguredError
  // immediately, without going to the network.
  delete process.env["REPLIT_CONNECTORS_HOSTNAME"];
  const r = await email.sendEmail({
    to: "a@b.com",
    subject: "s",
    html: "<p>h</p>",
    text: "t",
    template: "test",
  });
  assert.deepEqual(r, { status: "skipped", error: null });
  assert.equal(captured, null, "send() should not be called when skipped");
});

test("sendEmail: SendGrid 4xx is surfaced as { status: 'error' } with http code", async () => {
  sendImpl = async () => {
    throw Object.assign(new Error("Bad Request"), { code: 400 });
  };
  const r = await email.sendEmail({
    to: "a@b.com",
    subject: "s",
    html: "<p>h</p>",
    text: "t",
    template: "test",
  });
  assert.equal(r.status, "error");
  assert.match(r.error ?? "", /http_400/);
  assert.match(r.error ?? "", /Bad Request/);
});

test("sendEmail: SendGrid 5xx is surfaced as { status: 'error' } with http code", async () => {
  sendImpl = async () => {
    throw Object.assign(new Error("Internal"), { code: 500 });
  };
  const r = await email.sendEmail({
    to: "a@b.com",
    subject: "s",
    html: "<p>h</p>",
    text: "t",
    template: "test",
  });
  assert.equal(r.status, "error");
  assert.match(r.error ?? "", /http_500/);
  assert.match(r.error ?? "", /Internal/);
});

test("sendEmail: error without http code falls back to bare message", async () => {
  sendImpl = async () => {
    throw new Error("connection reset");
  };
  const r = await email.sendEmail({
    to: "a@b.com",
    subject: "s",
    html: "<p>h</p>",
    text: "t",
    template: "test",
  });
  assert.equal(r.status, "error");
  assert.equal(r.error, "connection reset");
});

test("sendEmail: with no EMAIL_FROM override, the connector from_email is used with the 'The Synozur Alliance' friendly name", async () => {
  installConnectorFetch({ fromEmail: "connector-default@synozur.com" });
  const r = await email.sendEmail({
    to: "u@x.com",
    subject: "Hello",
    html: "<p>h</p>",
    text: "t",
    template: "test",
  });
  assert.equal(r.status, "ok");
  assert.deepEqual(captured?.from, {
    email: "connector-default@synozur.com",
    name: "The Synozur Alliance",
  });
});

test("sendEmail: replyTo is forwarded when provided, omitted otherwise", async () => {
  await email.sendEmail({
    to: "u@x.com",
    subject: "s",
    html: "h",
    text: "t",
    replyTo: "r@x.com",
    template: "test",
  });
  assert.equal(captured?.replyTo, "r@x.com");

  captured = null;
  await email.sendEmail({
    to: "u@x.com",
    subject: "s",
    html: "h",
    text: "t",
    template: "test",
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(captured, "replyTo"),
    false,
    "replyTo should be omitted entirely when not provided",
  );
});

test("sendEmail: EMAIL_DISABLED=1 short-circuits to skipped without contacting SendGrid", async () => {
  process.env["EMAIL_DISABLED"] = "1";
  const r = await email.sendEmail({
    to: "u@x.com",
    subject: "s",
    html: "h",
    text: "t",
    template: "test",
  });
  assert.deepEqual(r, { status: "skipped", error: null });
  assert.equal(captured, null);
});

// ---------------------------------------------------------------------------
// Branded HTML shell — heading, preheader, footer site link per template
// ---------------------------------------------------------------------------

function assertBrandedShell(
  html: string,
  expected: { heading: string; preheader: string },
): void {
  // Heading appears in the gradient header band.
  assert.match(
    html,
    new RegExp(`>${escapeRe(expected.heading)}</div>`),
    `heading "${expected.heading}" should appear in the header band`,
  );
  // Preheader is the hidden inbox-preview span.
  assert.match(
    html,
    new RegExp(
      `display:none[^"]*">${escapeRe(expected.preheader)}</span>`,
    ),
    `preheader "${expected.preheader}" should appear in the hidden span`,
  );
  // Footer site link points at SITE_URL.
  assert.match(
    html,
    /<a href="https:\/\/synozur\.com" style="color:#810FFB;[^"]*">synozur\.com<\/a>/,
    "footer should link to SITE_URL with brand colour",
  );
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("sendVisitorConfirmation(contact) renders the branded shell + greeting", async () => {
  const r = await email.sendVisitorConfirmation("contact", "u@x.com", "Alice");
  assert.equal(r.status, "ok");
  assert.ok(captured);
  assert.equal(
    captured!.subject,
    "We received your message — The Synozur Alliance",
  );
  assertBrandedShell(captured!.html, {
    heading: "Thanks for reaching out",
    preheader:
      "We&#39;ve received your message and a partner will reply within two business days.",
  });
  assert.match(captured!.html, /Hi Alice,/);
  assert.match(captured!.text, /Hi Alice,/);
});

test("sendVisitorConfirmation(subscribe) renders its own heading + preheader", async () => {
  const r = await email.sendVisitorConfirmation("subscribe", "u@x.com", null);
  assert.equal(r.status, "ok");
  assertBrandedShell(captured!.html, {
    heading: "Welcome aboard",
    preheader:
      "You&#39;re now on the list for Synozur insights and announcements.",
  });
  // null name -> default greeting.
  assert.match(captured!.html, /Hello,/);
});

test("sendVisitorConfirmation(start) renders its own heading + preheader", async () => {
  const r = await email.sendVisitorConfirmation("start", "u@x.com", null);
  assert.equal(r.status, "ok");
  assertBrandedShell(captured!.html, {
    heading: "Let&#39;s get started",
    preheader:
      "We&#39;ve received your Get Started request and a partner will reply within two business days.",
  });
});

test("sendCommentApprovedEmail renders branded shell, escapes user content, and points at the site", async () => {
  const r = await email.sendCommentApprovedEmail({
    to: "u@x.com",
    commenterName: "Bob",
    postTitle: "Hello & World",
    postSlug: "hello-world",
    commentId: "c1",
    bodyText: "<great> stuff",
  });
  assert.equal(r.status, "ok");
  assertBrandedShell(captured!.html, {
    heading: "Your comment is live",
    preheader: "Your comment on &quot;Hello &amp; World&quot; is now live.",
  });
  // Permalink to the comment anchor.
  assert.match(
    captured!.html,
    /href="https:\/\/synozur\.com\/insights\/hello-world#comment-c1"/,
  );
  // User-supplied body text is HTML-escaped, not interpolated raw.
  assert.match(captured!.html, /&lt;great&gt; stuff/);
  assert.doesNotMatch(captured!.html, /<great>/);
});

test("sendPasswordReset renders branded shell with token URL-encoded into the reset link", async () => {
  const r = await email.sendPasswordReset({
    to: "u@x.com",
    name: null,
    token: "tok+1/abc",
  });
  assert.equal(r.status, "ok");
  assertBrandedShell(captured!.html, {
    heading: "Reset your password",
    preheader: "Reset your Synozur Alliance account password.",
  });
  assert.match(
    captured!.html,
    /href="https:\/\/synozur\.com\/reset-password\?token=tok%2B1%2Fabc"/,
  );
  // null name -> default greeting.
  assert.match(captured!.html, /Hello,/);
});

test("sendSubscriptionConfirmation renders branded shell with the confirm URL", async () => {
  const r = await email.sendSubscriptionConfirmation({
    to: "u@x.com",
    confirmUrl: "https://synozur.com/confirm?t=abc",
  });
  assert.equal(r.status, "ok");
  assertBrandedShell(captured!.html, {
    heading: "Confirm your subscription",
    preheader: "Confirm your Synozur Alliance newsletter subscription.",
  });
  assert.match(
    captured!.html,
    /href="https:\/\/synozur\.com\/confirm\?t=abc"/,
  );
});

test("sendCommentReplyEmail renders branded shell, escapes content, and links to the reply", async () => {
  const r = await email.sendCommentReplyEmail({
    to: "u@x.com",
    parentCommenterName: null,
    replyAuthorName: "Jane <Doe>",
    postTitle: "Re: stuff",
    postSlug: "re-stuff",
    parentCommentId: "p1",
    replyCommentId: "r2",
    replyBodyText: "thanks!",
  });
  assert.equal(r.status, "ok");
  assertBrandedShell(captured!.html, {
    heading: "Someone replied to your comment",
    preheader:
      "Jane &lt;Doe&gt; replied to your comment on &quot;Re: stuff&quot;.",
  });
  assert.match(
    captured!.html,
    /href="https:\/\/synozur\.com\/insights\/re-stuff#comment-r2"/,
  );
  // Reply author name is escaped.
  assert.match(captured!.html, /Jane &lt;Doe&gt;/);
  // null parent name -> default greeting.
  assert.match(captured!.html, /Hello,/);
});

test("sendEmailVerification renders branded shell and URL-encodes the token", async () => {
  const r = await email.sendEmailVerification({
    to: "u@x.com",
    name: "Carol",
    token: "v+1/abc",
  });
  assert.equal(r.status, "ok");
  assertBrandedShell(captured!.html, {
    heading: "Verify your email address",
    preheader:
      "Verify your email address to activate your Synozur Alliance account.",
  });
  assert.match(
    captured!.html,
    /href="https:\/\/synozur\.com\/verify-email\?token=v%2B1%2Fabc"/,
  );
  assert.match(captured!.html, /Hi Carol,/);
});

test("sendOrgPendingApproval renders branded shell with the org name", async () => {
  const r = await email.sendOrgPendingApproval({
    to: "u@x.com",
    name: null,
    orgName: "Acme & Co",
  });
  assert.equal(r.status, "ok");
  assertBrandedShell(captured!.html, {
    heading: "Your account is registered",
    preheader:
      "Welcome to The Synozur Alliance — your organization is pending approval.",
  });
  // Org name is HTML-escaped.
  assert.match(captured!.html, /Acme &amp; Co/);
  assert.equal(
    captured!.subject,
    "Your Synozur Alliance account is registered — pending org approval",
  );
});

test("sendOrgApproved renders branded shell with sign-in link", async () => {
  const r = await email.sendOrgApproved({
    to: "u@x.com",
    name: "Dan",
    orgName: "Acme",
  });
  assert.equal(r.status, "ok");
  assertBrandedShell(captured!.html, {
    heading: "Your organization is approved",
    preheader:
      "Your organization Acme has been approved — you can now access Synozur apps.",
  });
  assert.match(captured!.html, /href="https:\/\/synozur\.com\/sign-in"/);
  assert.match(captured!.html, /Hi Dan,/);
});

test("sendClientOrgInvite renders branded shell and links to galaxy /accept-invite with token", async () => {
  const r = await email.sendClientOrgInvite({
    to: "u@x.com",
    name: null,
    orgName: "Acme",
    inviterName: "Eve",
    token: "inv+1",
  });
  assert.equal(r.status, "ok");
  assertBrandedShell(captured!.html, {
    heading: "You&#39;re invited to Acme",
    preheader: "You&#39;ve been invited to Acme on the Synozur Galaxy portal.",
  });
  // GALAXY_URL not set in this test -> falls back to SITE_URL origin.
  assert.match(
    captured!.html,
    /href="https:\/\/synozur\.com\/galaxy\/accept-invite\?token=inv%2B1"/,
  );
  // Inviter name is shown (escaped).
  assert.match(captured!.html, /Eve/);
});

// ---------------------------------------------------------------------------
// Process-isolated tests — exercise module-load-time env captures
// (EMAIL_FROM_OVERRIDE, FORMS_NOTIFY_EMAIL) by spawning a fresh node
// process via the harness.
// ---------------------------------------------------------------------------

interface HarnessOutput {
  result: { status: string; error: string | null };
  from?: unknown;
  to?: unknown;
  subject?: string | null;
  html?: string | null;
  replyTo?: unknown;
}

function runHarness(
  kind: "sendEmail" | "sendInternal",
  envOverrides: Record<string, string | undefined>,
): HarnessOutput {
  const env: Record<string, string> = { ...process.env } as Record<
    string,
    string
  >;
  // Wipe any inherited values that the harness's email.ts must observe as
  // "unset" by default.
  delete env["EMAIL_FROM"];
  delete env["FORMS_NOTIFY_EMAIL"];
  delete env["EMAIL_DISABLED"];
  env["SITE_URL"] = "https://synozur.com";
  env["REPLIT_CONNECTORS_HOSTNAME"] = "connectors.test.invalid";
  env["REPL_IDENTITY"] = "test-identity";
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", HARNESS, kind],
    { env, encoding: "utf8" },
  );
  assert.equal(
    result.status,
    0,
    `harness exited non-zero (status=${result.status}): ${result.stderr}`,
  );
  // Find the sentinel-delimited JSON line so we ignore any logger output
  // that pino interleaves on stdout.
  const SENTINEL = "__HARNESS_JSON__:";
  const line = result.stdout
    .split("\n")
    .map((l) => l.trim())
    .reverse()
    .find((l) => l.startsWith(SENTINEL));
  assert.ok(
    line,
    `harness produced no sentinel line. stdout=${result.stdout}`,
  );
  return JSON.parse(line!.slice(SENTINEL.length)) as HarnessOutput;
}

test('sendEmail honors EMAIL_FROM="Display Name <addr@x.com>" captured at module load', () => {
  const out = runHarness("sendEmail", {
    EMAIL_FROM: "Display Name <addr@x.com>",
  });
  assert.equal(out.result.status, "ok");
  assert.deepEqual(out.from, { name: "Display Name", email: "addr@x.com" });
});

test("sendEmail honors a bare-address EMAIL_FROM captured at module load", () => {
  const out = runHarness("sendEmail", { EMAIL_FROM: "addr@x.com" });
  assert.equal(out.result.status, "ok");
  assert.deepEqual(out.from, { email: "addr@x.com" });
});

test("sendEmail with no EMAIL_FROM falls back to connector from_email + 'The Synozur Alliance'", () => {
  const out = runHarness("sendEmail", { EMAIL_FROM: undefined });
  assert.equal(out.result.status, "ok");
  assert.deepEqual(out.from, {
    email: "connector-default@synozur.com",
    name: "The Synozur Alliance",
  });
});

test("sendInternalNotification: skipped when FORMS_NOTIFY_EMAIL is unset", () => {
  const out = runHarness("sendInternal", { FORMS_NOTIFY_EMAIL: undefined });
  assert.equal(out.result.status, "skipped");
  assert.equal(out.to, null, "send() should not have been called");
});

test("sendInternalNotification: when FORMS_NOTIFY_EMAIL is set, sends a branded notification with replyTo set to the visitor", () => {
  const out = runHarness("sendInternal", {
    FORMS_NOTIFY_EMAIL: "ops@synozur.com",
  });
  assert.equal(out.result.status, "ok");
  assert.equal(out.to, "ops@synozur.com");
  assert.equal(out.subject, "[Synozur Contact] #42 — Visitor");
  assert.equal(out.replyTo, "visitor@x.com");
  assert.ok(out.html);
  assertBrandedShell(out.html!, {
    heading: "New Contact submission",
    preheader: "New Contact submission #42",
  });
  // Payload is rendered with HTML-escaped values.
  assert.match(out.html!, /Hello &amp; &lt;world&gt;/);
  // Empty payload values are filtered out (phone="" should not appear).
  assert.doesNotMatch(out.html!, />phone</);
});
