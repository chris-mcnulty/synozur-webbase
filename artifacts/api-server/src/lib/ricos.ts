// Minimal Wix Ricos (rich content) JSON → HTML converter.
// Handles the subset of node types seen in the imported Team_*.csv
// long descriptions: PARAGRAPH / HEADING / TEXT with BOLD, ITALIC, UNDERLINE,
// LINK decorations, and ordered/unordered lists. Unknown nodes emit their
// children so no content is lost.

type RicosNode = {
  type?: string;
  nodes?: RicosNode[];
  textData?: {
    text?: string;
    decorations?: Array<{
      type?: string;
      linkData?: { link?: { url?: string; target?: string } };
    }>;
  };
  headingData?: { level?: number };
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderText(node: RicosNode): string {
  const text = escapeHtml(node.textData?.text ?? "");
  if (!text) return "";
  const decorations = node.textData?.decorations ?? [];
  let out = text;
  let bold = false;
  let italic = false;
  let underline = false;
  let href: string | null = null;
  let target: string | null = null;
  for (const d of decorations) {
    switch (d.type) {
      case "BOLD":
        bold = true;
        break;
      case "ITALIC":
        italic = true;
        break;
      case "UNDERLINE":
        underline = true;
        break;
      case "LINK":
        href = d.linkData?.link?.url ?? null;
        target = d.linkData?.link?.target ?? null;
        break;
    }
  }
  if (bold) out = `<strong>${out}</strong>`;
  if (italic) out = `<em>${out}</em>`;
  if (underline) out = `<u>${out}</u>`;
  if (href) {
    const lowercaseHref = href.trim().toLowerCase();
    const safeScheme =
      lowercaseHref.startsWith("http://") ||
      lowercaseHref.startsWith("https://") ||
      lowercaseHref.startsWith("mailto:");
    if (safeScheme) {
      const attrs = [`href="${escapeHtml(href)}"`];
      if (target === "BLANK") {
        attrs.push('target="_blank"', 'rel="noopener noreferrer"');
      }
      out = `<a ${attrs.join(" ")}>${out}</a>`;
    }
  }
  return out;
}

function renderChildren(nodes: RicosNode[] | undefined): string {
  if (!nodes) return "";
  return nodes.map(renderNode).join("");
}

function renderNode(node: RicosNode): string {
  switch (node.type) {
    case "TEXT":
      return renderText(node);
    case "PARAGRAPH":
      return `<p>${renderChildren(node.nodes)}</p>`;
    case "HEADING": {
      const level = Math.min(6, Math.max(1, node.headingData?.level ?? 2));
      return `<h${level}>${renderChildren(node.nodes)}</h${level}>`;
    }
    case "BULLETED_LIST":
      return `<ul>${renderChildren(node.nodes)}</ul>`;
    case "ORDERED_LIST":
      return `<ol>${renderChildren(node.nodes)}</ol>`;
    case "LIST_ITEM":
      return `<li>${renderChildren(node.nodes)}</li>`;
    case "BLOCKQUOTE":
      return `<blockquote>${renderChildren(node.nodes)}</blockquote>`;
    default:
      return renderChildren(node.nodes);
  }
}

export function ricosToHtml(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // If it doesn't start with '{' treat it as plain text to prevent XSS.
  if (!trimmed.startsWith("{")) {
    return `<p>${escapeHtml(trimmed)}</p>`;
  }
  try {
    const doc = JSON.parse(trimmed) as { nodes?: RicosNode[] };
    if (!doc || !Array.isArray(doc.nodes)) return null;
    const html = renderChildren(doc.nodes);
    return html || null;
  } catch {
    return `<p>${escapeHtml(trimmed)}</p>`;
  }
}
