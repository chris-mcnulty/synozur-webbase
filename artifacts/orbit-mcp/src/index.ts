import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { validateStartupConfig, writesEnabled } from "./auth.js";
import { registerPostReadTools } from "./tools/posts.js";
import { registerPostWriteTools } from "./tools/post-write.js";
import { registerTaxonomyTools } from "./tools/taxonomy.js";
import { registerMediaTools } from "./tools/media.js";
import { registerEventTools } from "./tools/events.js";
import { registerEpisodeTools } from "./tools/episodes.js";
import { registerLandingPageTools } from "./tools/landing-pages.js";

validateStartupConfig();

const writes = writesEnabled();

const server = new McpServer({
  name: "synozur-orbit-mcp",
  version: "1.0.0",
});

// Read tools — always registered.
registerPostReadTools(server);
registerTaxonomyTools(server);
registerMediaTools(server);   // list_media always; upload_image self-guards on write mode
registerEventTools(server);
registerEpisodeTools(server);
registerLandingPageTools(server);

// Write tools — registered only when ORBIT_MCP_WRITE_KEY is set.
if (writes) {
  registerPostWriteTools(server);
  process.stderr.write("[orbit-mcp] Write tools enabled (create_draft_post, update_draft_post, schedule_post)\n");
} else {
  process.stderr.write("[orbit-mcp] Read-only mode. Set ORBIT_MCP_WRITE_KEY to enable write tools.\n");
}

const transport = new StdioServerTransport();
await server.connect(transport);
