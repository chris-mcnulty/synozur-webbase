/**
 * Synozur www MCP server — HTTP endpoint.
 *
 * External AI platforms (e.g. Orbit) call POST /api/mcp with a Bearer token
 * issued via the Admin → Access → MCP Keys page. Each token is looked up
 * against the api_keys table (same SHA-256 hash mechanism as the rest of the
 * site). A key with mcp.read grants read-only tool access; mcp.write adds
 * draft creation and image upload.
 *
 * Transport: StreamableHTTP in stateless mode (no session state between
 * requests). Appropriate for a low-volume external integration that sends
 * individual tool calls rather than maintaining a long-lived stream.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { requireAuth, requireCapability } from "../middlewares/auth.js";
import { createMcpServer } from "../mcp/server.js";

const router: IRouter = Router();

/**
 * Unauthenticated connectivity probe.  Orbit (and any other MCP client) can
 * GET /api/mcp/ping to confirm the server is reachable before attempting a
 * tool call.  A 200 here means "server up, check your Bearer token"; a
 * network error means "wrong URL or server down".  Distinguishing those two
 * failure modes is impossible when only the POST /api/mcp endpoint exists,
 * because a bad token returns 401 and Orbit's .catch(()=>[]) silences it.
 */
router.get("/mcp/ping", (_req: Request, res: Response): void => {
  res.json({ ok: true, service: "synozur-www-mcp" });
});

router.post(
  "/mcp",
  requireAuth,
  requireCapability("mcp.read", "mcp.write"),
  async (req: Request, res: Response): Promise<void> => {
    const writes = req.authedUser!.effectiveCapabilities.includes("mcp.write");
    const server = createMcpServer(writes);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — no session tracking
    });

    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  },
);

export default router;
