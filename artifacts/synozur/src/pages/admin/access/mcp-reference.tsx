import { AdminLayout } from "@/components/admin/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { BookOpen, Lock, Pencil } from "lucide-react";

const ENDPOINT = "https://synozur-baseline.replit.app/api/mcp";

interface Param {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

interface Tool {
  name: string;
  description: string;
  access: "read" | "write";
  params: Param[];
  returns: string;
}

interface Group {
  label: string;
  tools: Tool[];
}

const GROUPS: Group[] = [
  {
    label: "Posts",
    tools: [
      {
        name: "search_posts",
        access: "read",
        description: "Search and list Insights blog posts. Supports full-text query plus filter by category, tag, and status. Defaults to published posts only.",
        params: [
          { name: "query", type: "string", required: false, description: "Full-text search term" },
          { name: "categorySlug", type: "string", required: false, description: "Filter by category slug" },
          { name: "tagSlug", type: "string", required: false, description: "Filter by tag slug" },
          { name: "status", type: '"draft"|"scheduled"|"published"|"archived"', required: false, description: "Filter by post status. Defaults to published." },
          { name: "page", type: "number", required: false, description: "Page number (default 1)" },
          { name: "pageSize", type: "number", required: false, description: "Results per page, max 50 (default 12)" },
        ],
        returns: '{ items: Post[], page, pageSize, total }',
      },
      {
        name: "get_post",
        access: "read",
        description: "Fetch a single blog post by slug, including full body HTML and Markdown, SEO fields, author profile, categories, and tags.",
        params: [
          { name: "slug", type: "string", required: true, description: "Post slug" },
        ],
        returns: "Full Post object including bodyHtml, bodyMarkdown, heroImageUrl, author, categories, tags",
      },
      {
        name: "get_post_performance",
        access: "read",
        description: "Traffic analytics for a post: total views, unique sessions, 30-day daily trend, and top referrer hosts.",
        params: [
          { name: "slug", type: "string", required: true, description: "Post slug" },
        ],
        returns: "{ totalViews, uniqueSessions, viewsByDay[], topReferrers[] }",
      },
      {
        name: "create_draft_post",
        access: "write",
        description: "Create a new blog post draft. Call list_authors for valid authorId values and list_categories / list_tags for valid IDs to assign.",
        params: [
          { name: "title", type: "string", required: true, description: "Post title" },
          { name: "bodyMarkdown", type: "string", required: true, description: "Post body in Markdown" },
          { name: "authorId", type: "uuid", required: true, description: "UUID of the post author (from list_authors)" },
          { name: "categoryIds", type: "uuid[]", required: false, description: "Category UUIDs to assign" },
          { name: "tagIds", type: "uuid[]", required: false, description: "Tag UUIDs to assign" },
          { name: "excerpt", type: "string", required: false, description: "Short excerpt shown in listing cards" },
          { name: "heroImageId", type: "uuid", required: false, description: "Media UUID for the hero image" },
          { name: "seoTitle", type: "string", required: false, description: "Override SEO title" },
          { name: "seoDescription", type: "string", required: false, description: "Override SEO description" },
        ],
        returns: "{ id, slug, status: 'draft', title }",
      },
      {
        name: "update_draft_post",
        access: "write",
        description: "Update fields on an existing draft or scheduled post. Will not modify published or archived posts. Supplying categoryIds or tagIds replaces all existing assignments.",
        params: [
          { name: "id", type: "uuid", required: true, description: "Post UUID" },
          { name: "title", type: "string", required: false, description: "New title" },
          { name: "bodyMarkdown", type: "string", required: false, description: "New body content" },
          { name: "excerpt", type: "string", required: false, description: "New excerpt" },
          { name: "heroImageId", type: "uuid | null", required: false, description: "New hero image, or null to clear" },
          { name: "categoryIds", type: "uuid[]", required: false, description: "Replaces all existing categories" },
          { name: "tagIds", type: "uuid[]", required: false, description: "Replaces all existing tags" },
          { name: "seoTitle", type: "string | null", required: false, description: "Override SEO title" },
          { name: "seoDescription", type: "string | null", required: false, description: "Override SEO description" },
        ],
        returns: "{ id, updated: true }",
      },
      {
        name: "schedule_post",
        access: "write",
        description: "Set a future publish date on a draft post. Status becomes 'scheduled'. The publish worker flips it to 'published' at the scheduled time.",
        params: [
          { name: "id", type: "uuid", required: true, description: "Post UUID" },
          { name: "scheduledFor", type: "string (ISO 8601)", required: true, description: "When the post should publish, e.g. 2026-07-01T09:00:00Z" },
        ],
        returns: "{ id, status: 'scheduled', scheduledFor }",
      },
    ],
  },
  {
    label: "Taxonomy",
    tools: [
      {
        name: "list_categories",
        access: "read",
        description: "List all Insights post categories. Use the returned IDs when calling create_draft_post or update_draft_post.",
        params: [],
        returns: "Category[] — { id, name, slug, description }",
      },
      {
        name: "list_tags",
        access: "read",
        description: "List all Insights post tags. Use the returned IDs when creating or updating posts.",
        params: [],
        returns: "Tag[] — { id, name, slug }",
      },
      {
        name: "list_authors",
        access: "read",
        description: "List users who have authored at least one post. Use these UUIDs as the authorId when creating new drafts.",
        params: [],
        returns: "Author[] — { id, displayName, avatarUrl, bio }",
      },
    ],
  },
  {
    label: "Media",
    tools: [
      {
        name: "list_media",
        access: "read",
        description: "Search the media library. Returns image and document records with public URLs, dimensions, and metadata.",
        params: [
          { name: "query", type: "string", required: false, description: "Search by alt text or filename" },
          { name: "categoryId", type: "uuid", required: false, description: "Filter by asset category UUID" },
          { name: "page", type: "number", required: false, description: "Page number (default 1)" },
          { name: "pageSize", type: "number", required: false, description: "Results per page, max 100 (default 20)" },
        ],
        returns: "{ items: Media[], page, pageSize } — each item includes id, publicUrl, altText, mime, width, height",
      },
      {
        name: "upload_image",
        access: "write",
        description: "Upload an image to the media library as base64-encoded bytes. Returns the registered media record including the public URL. Requires mcp.write.",
        params: [
          { name: "imageData", type: "string (base64)", required: true, description: "Base64-encoded image bytes" },
          { name: "mimeType", type: "string", required: true, description: "MIME type, e.g. image/jpeg, image/png, image/webp" },
          { name: "altText", type: "string", required: true, description: "Descriptive alt text (required for accessibility)" },
          { name: "filename", type: "string", required: false, description: "Original filename for the library record" },
          { name: "categoryId", type: "uuid", required: false, description: "Asset category UUID" },
        ],
        returns: "{ id, publicUrl, altText, mime }",
      },
    ],
  },
  {
    label: "Events",
    tools: [
      {
        name: "list_events",
        access: "read",
        description: "List upcoming events (startDate in the future), ordered soonest first. Returns title, dates, location, registration info, and image URL.",
        params: [
          { name: "page", type: "number", required: false, description: "Page number (default 1)" },
          { name: "pageSize", type: "number", required: false, description: "Results per page, max 50 (default 12)" },
        ],
        returns: "{ items: Event[], page, pageSize }",
      },
      {
        name: "list_past_events",
        access: "read",
        description: "List past events (startDate before now), most recent first. Useful for retrospectives and archive promotion.",
        params: [
          { name: "page", type: "number", required: false, description: "Page number (default 1)" },
          { name: "pageSize", type: "number", required: false, description: "Results per page, max 50 (default 12)" },
        ],
        returns: "{ items: Event[], page, pageSize }",
      },
      {
        name: "get_event",
        access: "read",
        description: "Get full details for a single event by slug — including session schedule (title, time, room, track) and the speaker roster (bio, job title, LinkedIn).",
        params: [
          { name: "slug", type: "string", required: true, description: "Event slug" },
        ],
        returns: "Full Event object with sessions[] and speakers[]",
      },
    ],
  },
  {
    label: "Episodes",
    tools: [
      {
        name: "list_episodes",
        access: "read",
        description: "List published Polaris podcast episodes, most recent first.",
        params: [
          { name: "page", type: "number", required: false, description: "Page number (default 1)" },
          { name: "pageSize", type: "number", required: false, description: "Results per page, max 50 (default 12)" },
        ],
        returns: "{ items: Episode[], page, pageSize } — includes title, guestName, summary, durationSeconds, audioUrl, artworkUrl",
      },
      {
        name: "get_episode",
        access: "read",
        description: "Get full details for a Polaris episode by slug — guest info, all platform URLs (Apple, Spotify), service/solution associations, and optionally the full transcript.",
        params: [
          { name: "slug", type: "string", required: true, description: "Episode slug" },
          { name: "includeTranscript", type: "boolean", required: false, description: "Set true to include transcriptHtml. Transcripts can be large; omit for browse flows." },
        ],
        returns: "Full Episode object; transcriptHtml included only when requested",
      },
    ],
  },
  {
    label: "Landing Pages",
    tools: [
      {
        name: "list_landing_pages",
        access: "read",
        description: "List published landing pages. Useful for understanding the site's campaign-specific pages when planning or cross-linking content.",
        params: [
          { name: "page", type: "number", required: false, description: "Page number (default 1)" },
          { name: "pageSize", type: "number", required: false, description: "Results per page, max 50 (default 20)" },
        ],
        returns: "{ items: LandingPage[], page, pageSize } — includes slug, title, subtitle, tags, publishedAt",
      },
    ],
  },
];

function ParamRow({ p }: { p: Param }) {
  return (
    <tr className="border-b border-border/40 last:border-0">
      <td className="py-2 pr-4 align-top">
        <code className="font-mono text-xs text-foreground">{p.name}</code>
        {p.required && <span className="ml-1 text-destructive text-xs">*</span>}
      </td>
      <td className="py-2 pr-4 align-top">
        <code className="font-mono text-xs text-muted-foreground">{p.type}</code>
      </td>
      <td className="py-2 align-top text-sm text-muted-foreground">{p.description}</td>
    </tr>
  );
}

function ToolCard({ tool }: { tool: Tool }) {
  const isWrite = tool.access === "write";
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {isWrite
            ? <Pencil className="h-4 w-4 text-amber-500 shrink-0" />
            : <BookOpen className="h-4 w-4 text-primary/70 shrink-0" />}
          <code className="font-mono text-sm font-semibold">{tool.name}</code>
        </div>
        <Badge variant={isWrite ? "default" : "secondary"} className="text-xs shrink-0">
          {isWrite ? "mcp.write" : "mcp.read"}
        </Badge>
      </div>
      <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{tool.description}</p>

      {tool.params.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Parameters</p>
          <table className="w-full text-left text-sm min-w-[420px]">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="pb-1 pr-4 font-medium">Name</th>
                <th className="pb-1 pr-4 font-medium">Type</th>
                <th className="pb-1 font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              {tool.params.map((p) => <ParamRow key={p.name} p={p} />)}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 bg-muted/50 rounded-md px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mr-2">Returns</span>
        <code className="text-xs font-mono text-foreground">{tool.returns}</code>
      </div>
    </Card>
  );
}

export default function McpReferencePage() {
  return (
    <AdminLayout title="MCP Reference">
      <div className="flex flex-col sm:flex-row sm:items-start gap-4 mb-8">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold">MCP Server Reference</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Tool catalogue for the Synozur www MCP server. Use this as a reference when configuring Cursor, Copilot, or any other AI assistant that connects via an MCP key.
          </p>
        </div>
      </div>

      {/* Connection block */}
      <Card className="p-5 mb-8">
        <h2 className="text-sm font-semibold mb-4">Connection details</h2>
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
            <span className="text-muted-foreground w-28 shrink-0">Endpoint</span>
            <code className="font-mono text-xs bg-muted px-2 py-1 rounded break-all">{ENDPOINT}</code>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
            <span className="text-muted-foreground w-28 shrink-0">Transport</span>
            <span>Streamable HTTP — stateless, one <code className="font-mono text-xs bg-muted px-1 rounded">POST</code> per call</span>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
            <span className="text-muted-foreground w-28 shrink-0">Auth header</span>
            <code className="font-mono text-xs bg-muted px-2 py-1 rounded break-all">Authorization: Bearer syn_&lt;key&gt;</code>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
            <span className="text-muted-foreground w-28 shrink-0">Content-Type</span>
            <code className="font-mono text-xs bg-muted px-2 py-1 rounded">application/json</code>
          </div>
        </div>
        <div className="mt-4 flex items-start gap-2 rounded-md bg-muted/60 border px-3 py-2.5 text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            Keys are issued on the <a href="/access/mcp-keys" className="underline underline-offset-2 hover:text-foreground">MCP Keys</a> page.
            A key with <strong>mcp.read</strong> grants access to all read tools.
            A key with <strong>mcp.write</strong> additionally unlocks{" "}
            <code className="font-mono">create_draft_post</code>, <code className="font-mono">update_draft_post</code>,{" "}
            <code className="font-mono">schedule_post</code>, and <code className="font-mono">upload_image</code>.
          </span>
        </div>
      </Card>

      {/* Tool groups */}
      <div className="flex flex-col gap-10">
        {GROUPS.map((group) => (
          <section key={group.label}>
            <h2 className="text-base font-semibold mb-3">{group.label}</h2>
            <div className="flex flex-col gap-4">
              {group.tools.map((tool) => <ToolCard key={tool.name} tool={tool} />)}
            </div>
          </section>
        ))}
      </div>
    </AdminLayout>
  );
}
