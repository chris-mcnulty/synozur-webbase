// Microsoft Graph mail helper for the Briefing Podcast inbound flow.
//
// All synozur.com mail runs through Microsoft 365, so clients (and the
// Copilot Worker's own briefing) deliver into a watched shared mailbox. The
// API server subscribes to that mailbox via Graph change notifications;
// when a message arrives Graph POSTs to our webhook, we fetch the body,
// process it, and DELETE the message.
//
// Reuses SpeGraphClient purely for its app-only token acquisition + retry
// wrapper — the Graph credentials (ENTRA_TENANT_ID / ENTRA_APP_CLIENT_ID /
// ENTRA_APP_CLIENT_SECRET) are the same app registration already used for
// SharePoint Embedded. The app needs Mail.ReadWrite (application) granted to
// read and delete from the mailbox.

import {
  SpeGraphClient,
  readSpeGraphConfigFromEnv,
} from "./graphClient";
import { logger } from "../../logger";

const GRAPH_V1_URL = "https://graph.microsoft.com/v1.0";

// Graph caps mail subscriptions at ~4230 minutes (under 3 days). Renew well
// before that.
const SUBSCRIPTION_LIFETIME_MS = 47 * 60 * 60 * 1000; // ~47h

export interface GraphMailConfig {
  mailbox: string; // UPN/email of the watched shared mailbox
  notificationUrl: string; // public https URL of our webhook
  clientState: string; // shared secret echoed in notifications
}

export interface GraphMessage {
  id: string;
  subject: string;
  bodyHtml: string;
  bodyContentType: string;
  fromAddress: string | null;
  fromName: string | null;
}

export interface GraphSubscription {
  id: string;
  expirationDateTime: string;
  resource: string;
  notificationUrl: string;
}

export function readGraphMailConfigFromEnv(): GraphMailConfig | null {
  const mailbox = process.env["BRIEFING_MAILBOX"];
  const notificationUrl = process.env["BRIEFING_WEBHOOK_URL"];
  const clientState = process.env["BRIEFING_WEBHOOK_SECRET"];
  if (!mailbox || !notificationUrl || !clientState) return null;
  return { mailbox, notificationUrl, clientState };
}

export class GraphMailClient {
  private readonly graph: SpeGraphClient;

  constructor() {
    const cfg = readSpeGraphConfigFromEnv();
    if (!cfg) {
      throw new Error(
        "Graph mail client requires ENTRA_TENANT_ID / ENTRA_APP_CLIENT_ID / ENTRA_APP_CLIENT_SECRET",
      );
    }
    this.graph = new SpeGraphClient(cfg);
  }

  private mailboxResource(mailbox: string): string {
    return `/users/${encodeURIComponent(mailbox)}/mailFolders('inbox')/messages`;
  }

  async createSubscription(cfg: GraphMailConfig): Promise<GraphSubscription> {
    const expiration = new Date(
      Date.now() + SUBSCRIPTION_LIFETIME_MS,
    ).toISOString();
    const body = {
      changeType: "created",
      notificationUrl: cfg.notificationUrl,
      resource: this.mailboxResource(cfg.mailbox),
      expirationDateTime: expiration,
      clientState: cfg.clientState,
    };
    const sub = await this.graph.request<GraphSubscription>(
      `${GRAPH_V1_URL}/subscriptions`,
      {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      },
    );
    logger.info(
      { subscriptionId: sub.id, expiration: sub.expirationDateTime },
      "Created Graph mail subscription for briefing mailbox",
    );
    return sub;
  }

  async renewSubscription(subscriptionId: string): Promise<GraphSubscription> {
    const expiration = new Date(
      Date.now() + SUBSCRIPTION_LIFETIME_MS,
    ).toISOString();
    return this.graph.request<GraphSubscription>(
      `${GRAPH_V1_URL}/subscriptions/${subscriptionId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ expirationDateTime: expiration }),
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  async listSubscriptions(): Promise<GraphSubscription[]> {
    const data = await this.graph.request<{ value: GraphSubscription[] }>(
      `${GRAPH_V1_URL}/subscriptions`,
    );
    return data.value ?? [];
  }

  async deleteSubscription(subscriptionId: string): Promise<void> {
    await this.graph.request<void>(
      `${GRAPH_V1_URL}/subscriptions/${subscriptionId}`,
      { method: "DELETE" },
    );
  }

  // Fetch a single message's body + sender. `mailbox` is the watched
  // shared mailbox; `messageId` comes from the change notification.
  async getMessage(mailbox: string, messageId: string): Promise<GraphMessage> {
    const url =
      `${GRAPH_V1_URL}/users/${encodeURIComponent(mailbox)}/messages/${messageId}` +
      `?$select=id,subject,body,from`;
    const raw = await this.graph.request<{
      id: string;
      subject?: string;
      body?: { contentType?: string; content?: string };
      from?: { emailAddress?: { address?: string; name?: string } };
    }>(url);
    return {
      id: raw.id,
      subject: raw.subject ?? "(no subject)",
      bodyHtml: raw.body?.content ?? "",
      bodyContentType: raw.body?.contentType ?? "html",
      fromAddress: raw.from?.emailAddress?.address?.toLowerCase() ?? null,
      fromName: raw.from?.emailAddress?.name ?? null,
    };
  }

  async deleteMessage(mailbox: string, messageId: string): Promise<void> {
    await this.graph.request<void>(
      `${GRAPH_V1_URL}/users/${encodeURIComponent(mailbox)}/messages/${messageId}`,
      { method: "DELETE" },
    );
  }
}
