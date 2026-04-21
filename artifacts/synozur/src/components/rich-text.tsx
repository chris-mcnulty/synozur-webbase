import { useMemo } from "react";

const ALLOWED_TAGS = new Set([
  "P", "BR", "STRONG", "B", "EM", "I", "U", "SPAN",
  "UL", "OL", "LI",
  "H1", "H2", "H3", "H4",
  "A",
  "IMG",
  "BLOCKQUOTE", "HR",
  "TABLE", "THEAD", "TBODY", "TR", "TH", "TD",
  "PRE", "CODE",
  "IFRAME",
]);

// Hosts allowed inside <iframe src="..."> — trusted podcast & video platforms
const TRUSTED_IFRAME_HOSTS = new Set([
  "www.buzzsprout.com",
  "open.spotify.com",
  "spotify.com",
  "embed.podcasts.apple.com",
  "anchor.fm",
  "player.captivate.fm",
  "www.podbean.com",
  "share.transistor.fm",
  "w.soundcloud.com",
  "www.youtube.com",
  "www.youtube-nocookie.com",
  "player.vimeo.com",
  "vimeo.com",
  "www.iheart.com",
  "omny.fm",
  "player.simplecast.com",
  "embed.acast.com",
  "listen.pocketcasts.com",
  "html5-player.libsyn.com",
  "www.podtrac.com",
  "d3ctxlq1ktw2nl.cloudfront.net",
]);

function isTrustedIframeSrc(src: string): boolean {
  if (!src) return false;
  try {
    const url = new URL(src);
    if (url.protocol !== "https:") return false;
    return TRUSTED_IFRAME_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

const ALLOWED_ATTRS_BY_TAG: Record<string, Set<string>> = {
  A: new Set(["href", "title", "rel", "target"]),
  IMG: new Set(["src", "alt", "width", "height", "title"]),
  IFRAME: new Set([
    "src", "width", "height", "frameborder", "allow",
    "allowfullscreen", "scrolling", "title", "loading", "style",
  ]),
  TD: new Set(["colspan", "rowspan"]),
  TH: new Set(["colspan", "rowspan"]),
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
    // Unwrap: keep children, drop the tag.
    const frag = doc.createDocumentFragment();
    el.childNodes.forEach((child) => {
      const out = sanitizeNode(child, doc);
      if (out) frag.appendChild(out);
    });
    return frag;
  }

  // Special handling for <iframe>: validate src against trusted hosts
  if (tag === "IFRAME") {
    const src = el.getAttribute("src") ?? "";
    if (!isTrustedIframeSrc(src)) {
      // Drop entirely (don't even unwrap) if src isn't trusted
      return null;
    }
    const iframe = doc.createElement("iframe");
    const allowedAttrs = ALLOWED_ATTRS_BY_TAG["IFRAME"]!;
    for (const attr of Array.from(el.attributes)) {
      if (!allowedAttrs.has(attr.name.toLowerCase())) continue;
      iframe.setAttribute(attr.name, attr.value);
    }
    // Ensure sandbox-friendly defaults
    if (!iframe.getAttribute("width")) iframe.setAttribute("width", "100%");
    iframe.setAttribute("frameborder", "0");
    // Wrap in a responsive container
    const wrapper = doc.createElement("div");
    wrapper.className = "embed-wrapper";
    wrapper.appendChild(iframe);
    return wrapper;
  }

  const cleaned = doc.createElement(el.tagName.toLowerCase());
  const allowed = ALLOWED_ATTRS_BY_TAG[tag] ?? new Set<string>();
  for (const attr of Array.from(el.attributes)) {
    if (!allowed.has(attr.name.toLowerCase())) continue;
    if (attr.name === "href" && !isSafeUrl(attr.value)) continue;
    if (attr.name === "src" && !isSafeUrl(attr.value)) continue;
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
  className?: string;
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
