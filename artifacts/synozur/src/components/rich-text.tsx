import { useMemo } from "react";

const ALLOWED_TAGS = new Set([
  "P", "BR", "STRONG", "B", "EM", "I", "U", "SPAN",
  "UL", "OL", "LI",
  "H2", "H3", "H4",
  "A",
  "BLOCKQUOTE", "HR",
]);

const ALLOWED_ATTRS_BY_TAG: Record<string, Set<string>> = {
  A: new Set(["href", "title", "rel", "target"]),
};

function isSafeUrl(url: string): boolean {
  const trimmed = url.trim().toLowerCase();
  if (!trimmed) return false;
  if (trimmed.startsWith("javascript:")) return false;
  if (trimmed.startsWith("data:") && !trimmed.startsWith("data:image/")) return false;
  return true;
}

function sanitizeNode(node: Node, doc: Document): Node | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return doc.createTextNode(node.textContent ?? "");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }
  const el = node as Element;
  const tag = el.tagName.toUpperCase();

  if (!ALLOWED_TAGS.has(tag)) {
    // Unwrap: keep the children, drop the tag.
    const frag = doc.createDocumentFragment();
    el.childNodes.forEach((child) => {
      const out = sanitizeNode(child, doc);
      if (out) frag.appendChild(out);
    });
    return frag;
  }

  const cleaned = doc.createElement(el.tagName.toLowerCase());
  const allowed = ALLOWED_ATTRS_BY_TAG[tag] ?? new Set<string>();
  for (const attr of Array.from(el.attributes)) {
    if (!allowed.has(attr.name.toLowerCase())) continue;
    if ((attr.name === "href") && !isSafeUrl(attr.value)) continue;
    cleaned.setAttribute(attr.name, attr.value);
  }
  if (tag === "A") {
    const href = cleaned.getAttribute("href") ?? "";
    if (/^https?:\/\//i.test(href)) {
      cleaned.setAttribute("target", "_blank");
      cleaned.setAttribute("rel", "noopener noreferrer");
    }
  }
  el.childNodes.forEach((child) => {
    const out = sanitizeNode(child, doc);
    if (out) cleaned.appendChild(out);
  });
  return cleaned;
}

export function sanitizeHtml(html: string): string {
  if (!html) return "";
  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    // SSR or non-browser fallback: strip all tags.
    return html.replace(/<[^>]*>/g, "");
  }
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const wrapper = doc.body.firstElementChild;
  if (!wrapper) return "";
  const out = doc.createElement("div");
  wrapper.childNodes.forEach((child) => {
    const c = sanitizeNode(child, doc);
    if (c) out.appendChild(c);
  });
  return out.innerHTML;
}

export interface RichTextProps {
  html: string | null | undefined;
  /** Extra Tailwind classes to merge with the default prose styles. */
  className?: string;
  /** When true, applies inverted prose colors for dark backgrounds. */
  invert?: boolean;
}

const BASE_PROSE =
  "prose prose-neutral max-w-none prose-headings:font-bold prose-h2:text-2xl prose-h2:mt-8 prose-h2:mb-4 prose-h3:text-xl prose-h3:mt-6 prose-h3:mb-3 prose-p:leading-relaxed prose-li:leading-relaxed prose-a:text-primary prose-a:no-underline hover:prose-a:underline prose-strong:text-foreground";

export function RichText({ html, className = "", invert = false }: RichTextProps) {
  const safe = useMemo(() => sanitizeHtml(html ?? ""), [html]);
  if (!safe) return null;
  const cls = [
    BASE_PROSE,
    invert ? "prose-invert" : "dark:prose-invert",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return <div className={cls} dangerouslySetInnerHTML={{ __html: safe }} />;
}
