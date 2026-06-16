import { MailService } from "@sendgrid/mail";

// Replit-Connector–backed SendGrid client.
//
// Resolution order:
//   1. SENDGRID_API_KEY + SENDGRID_FROM_EMAIL env vars — direct key, no connector needed.
//   2. Replit Connector (REPLIT_CONNECTORS_HOSTNAME) — legacy connector path.
//
// When neither is available, throws SendGridNotConfiguredError so the caller
// can convert it into a graceful { status: "skipped" }.

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
  // --- Path 1: direct env vars (takes priority over connector) ---
  const directApiKey   = process.env["SENDGRID_API_KEY"];
  const directFromEmail = process.env["SENDGRID_FROM_EMAIL"];
  if (directApiKey && directFromEmail) {
    const client = new MailService();
    client.setApiKey(directApiKey);
    return { client, fromEmail: directFromEmail };
  }

  // --- Path 2: Replit Connector ---
  const hostname = process.env["REPLIT_CONNECTORS_HOSTNAME"];
  if (!hostname) {
    throw new SendGridNotConfiguredError(
      "REPLIT_CONNECTORS_HOSTNAME is not set and SENDGRID_API_KEY/SENDGRID_FROM_EMAIL are not configured",
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

  // Fresh MailService instance per call — never reuse a cached client.
  const client = new MailService();
  client.setApiKey(apiKey);
  return { client, fromEmail };
}
