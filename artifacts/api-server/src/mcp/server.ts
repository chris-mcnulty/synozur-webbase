import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPostReadTools } from "./tools/posts.js";
import { registerPostWriteTools } from "./tools/post-write.js";
import { registerTaxonomyTools } from "./tools/taxonomy.js";
import { registerMediaTools } from "./tools/media.js";
import { registerEventTools } from "./tools/events.js";
import { registerEpisodeTools } from "./tools/episodes.js";
import { registerLandingPageTools } from "./tools/landing-pages.js";

export function createMcpServer(writes: boolean): McpServer {
  const server = new McpServer({
    name: "synozur-www-mcp",
    version: "1.0.0",
  });

  registerPostReadTools(server);
  registerTaxonomyTools(server);
  registerMediaTools(server, writes);
  registerEventTools(server);
  registerEpisodeTools(server);
  registerLandingPageTools(server);

  if (writes) {
    registerPostWriteTools(server);
  }

  return server;
}
