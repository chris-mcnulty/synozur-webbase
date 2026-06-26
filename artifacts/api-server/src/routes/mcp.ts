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
