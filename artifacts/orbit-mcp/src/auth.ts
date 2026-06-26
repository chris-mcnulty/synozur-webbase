/**
 * Startup auth for the Orbit MCP server.
 *
 * Configure one key per deployment — the caller never needs both simultaneously:
 *
 *   ORBIT_MCP_READ_KEY   — read-only access (list/get/search tools only)
 *   ORBIT_MCP_WRITE_KEY  — read + write access (all tools, including
 *                          create_draft_post, update_draft_post, schedule_post,
 *                          and upload_image)
 *
 * Exactly one of the two must be set. If ORBIT_MCP_WRITE_KEY is present it
 * takes precedence and write tools are registered; ORBIT_MCP_READ_KEY is
 * ignored in that case.
 *
 * Optional:
 *   ORBIT_MCP_API_URL  — base URL of the api-server (e.g. https://www.synozur.com).
 *                         Required when using write tools that delegate to the
 *                         api-server (upload_image).
 */

export function validateStartupConfig(): void {
  const hasRead = Boolean(process.env.ORBIT_MCP_READ_KEY);
  const hasWrite = Boolean(process.env.ORBIT_MCP_WRITE_KEY);
  if (!hasRead && !hasWrite) {
    throw new Error("Either ORBIT_MCP_READ_KEY or ORBIT_MCP_WRITE_KEY must be set");
  }
}

export function writesEnabled(): boolean {
  return Boolean(process.env.ORBIT_MCP_WRITE_KEY);
}

export function getActiveKey(): string {
  return (process.env.ORBIT_MCP_WRITE_KEY ?? process.env.ORBIT_MCP_READ_KEY)!;
}

export function getApiUrl(): string {
  const url = process.env.ORBIT_MCP_API_URL;
  if (!url) throw new Error("ORBIT_MCP_API_URL is required when using upload_image");
  return url.replace(/\/$/, "");
}
