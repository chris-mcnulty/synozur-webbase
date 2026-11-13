import assert from "node:assert/strict";
import test from "node:test";
import { webhookBulkRetryFeedback, webhookRetryFeedback } from "./submissions-webhook-feedback";

test("successful webhook delivery does not imply a HubSpot retry", () => {
  assert.equal(webhookRetryFeedback({ id: 13, webhookStatus: "ok" }),
    "External webhook delivered for #13. HubSpot was not retried.");
});

test("skipped webhook explains the missing destination and retained submission", () => {
  const message = webhookRetryFeedback({ id: 13, webhookStatus: "skipped" });
  assert.match(message, /no external webhook destination is configured/);
  assert.match(message, /submission remains saved/);
  assert.match(message, /HubSpot was not retried/);
  assert.doesNotMatch(message, /delivered|succeeded/);
});

test("failed and missing webhook statuses stay explicit", () => {
  assert.match(webhookRetryFeedback({ id: 13, webhookStatus: "error" }), /returned “error”/);
  assert.match(webhookRetryFeedback({ id: 13, webhookStatus: null }), /returned “error”/);
  assert.match(webhookRetryFeedback({ id: 13 }), /HubSpot was not retried/);
});

test("bulk feedback does not equate the API's combined count with delivery", () => {
  assert.equal(webhookBulkRetryFeedback({ retried: 4, succeeded: 3, failed: 1 }),
    "Retried 4 external webhooks: 3 delivered or skipped, 1 failed. Skipped means no external webhook destination is configured. Submissions remain saved; HubSpot was not retried.");
});

test("empty bulk retry identifies the channel", () => {
  assert.equal(webhookBulkRetryFeedback({ retried: 0, succeeded: 0, failed: 0 }),
    "No failed external webhooks to retry. HubSpot was not retried.");
});
