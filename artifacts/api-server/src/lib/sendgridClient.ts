import { MailService } from "@sendgrid/mail";

// Replit-Connector–backed SendGrid client.
//
// Mirrors the Constellation app's `getUncachableSendGridClient()` pattern:
// every call hits the connector API fresh and returns a configured
// `@sendgrid/mail` client plus the connector's `from_email`. We never cache
// the credentials because the connector token can rotate; calling it on
// every send is cheap relative to the SMTP round-trip.
//
// When the connector isn't installed we throw a typed
// `SendGridNotConfiguredError` so the email transport can convert it into a
// graceful `{ status: "skipped" }` (matching the old "no-RESEND_API_KEY"
// behaviour and keeping local dev / tests unblocked).

export class SendGridNotConfiguredError extends Error {
  constructor(message = "SendGrid connector is not configured") {
    super(message);
    this.name = "SendGridNotConfiguredError";
  }
}

export interface SendGridClientHandle {
  client: MailService;
  fromEmail: string;
}

interface ConnectorResponse {
  items?: Array<{
    settings?: {
      api_key?: string;
      from_email?: string;
    };
  }>;
}

export async function getUncachableSendGridClient(): Promise<SendGridClientHandle> {
  const hostname = process.env["REPLIT_CONNECTORS_HOSTNAME"];
  if (!hostname) {
    throw new SendGridNotConfiguredError(
      "REPLIT_CONNECTORS_HOSTNAME is not set",
    );
  }

  const replIdentity = process.env["REPL_IDENTITY"];
  const webReplRenewal = process.env["WEB_REPL_RENEWAL"];
  const xReplitToken = replIdentity
    ? `repl ${replIdentity}`
    : webReplRenewal
      ? `depl ${webReplRenewal}`
      : null;

  if (!xReplitToken) {
    throw new SendGridNotConfiguredError(
      "No Replit identity token available (REPL_IDENTITY / WEB_REPL_RENEWAL)",
    );
  }

  const url = `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=sendgrid`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      X_REPLIT_TOKEN: xReplitToken,
    },
  });

  if (!res.ok) {
    throw new SendGridNotConfiguredError(
      `SendGrid connector lookup failed (HTTP ${res.status})`,
    );
  }

  const data = (await res.json()) as ConnectorResponse;
  const settings = data.items?.[0]?.settings;
  const apiKey = settings?.api_key;
  const fromEmail = settings?.from_email;

  if (!apiKey || !fromEmail) {
    throw new SendGridNotConfiguredError(
      "SendGrid connector returned no api_key / from_email",
    );
  }

  // Fresh MailService instance per call — never reuse a cached client,
  // matching Constellation's getUncachableSendGridClient() contract.
  const client = new MailService();
  client.setApiKey(apiKey);
  return { client, fromEmail };
}
