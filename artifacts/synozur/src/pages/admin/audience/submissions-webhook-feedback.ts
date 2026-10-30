export function webhookRetryFeedback(row: { id: number; webhookStatus?: string | null }): string {
  if (row.webhookStatus === "ok") {
    return `External webhook delivered for #${row.id}. HubSpot was not retried.`;
  }
  if (row.webhookStatus === "skipped") {
    return `External webhook skipped for #${row.id}: no external webhook destination is configured. The submission remains saved; HubSpot was not retried.`;
  }
  return `External webhook retry for #${row.id} returned “${row.webhookStatus ?? "error"}”. HubSpot was not retried.`;
}

export function webhookBulkRetryFeedback(result: { retried: number; succeeded: number; failed: number }): string {
  if (result.retried === 0) {
    return "No failed external webhooks to retry. HubSpot was not retried.";
  }
  // The existing API combines delivered and skipped outcomes in `succeeded`.
  // Do not present that aggregate as confirmed delivery.
  return `Retried ${result.retried} external webhooks: ${result.succeeded} delivered or skipped, ${result.failed} failed. Skipped means no external webhook destination is configured. Submissions remain saved; HubSpot was not retried.`;
}
