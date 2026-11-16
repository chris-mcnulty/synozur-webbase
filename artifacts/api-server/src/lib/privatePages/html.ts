import { createHash } from "node:crypto";
import { parse, serialize, type DefaultTreeAdapterMap } from "parse5";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
const hash = (s: string) => createHash("sha256").update(s).digest("base64");
// Reviewed, self-contained local UI only: menu, benefit toggles, timeline, FAQ.
// Hashes authorize code, never customer identity or content.
const APPROVED_SCRIPTS = new Set(["aiYkONm6l8Y6WJoO1Qzn4rtDq94/Ce/YqoKgknYzAc8="]);
const BRIDGE = `(function(){
let objectUrl;
window.addEventListener("message", function(e){
 if(e.source!==parent || !e.data || e.data.type!=="private-page-audio" || !(e.data.blob instanceof Blob))return;
 if(objectUrl)URL.revokeObjectURL(objectUrl);
 objectUrl=URL.createObjectURL(e.data.blob);
 document.querySelectorAll("audio").forEach(function(a){a.src=objectUrl;a.load();});
});
})();`;

export function privateHtmlCsp(scriptHashes: string[]) {
  return [
    "default-src 'none'", `script-src ${scriptHashes.map(h => `'sha256-${h}'`).join(" ")}`,
    "style-src 'unsafe-inline'", "img-src data:", "font-src data:",
    "media-src blob:", "connect-src 'none'", "object-src 'none'", "frame-src 'none'",
    "worker-src 'none'", "form-action 'none'", "base-uri 'none'",
  ].join("; ");
}

const allowedTags = new Set(("html head body title meta style script main header footer nav section article aside div span p a img " +
  "h1 h2 h3 h4 h5 h6 ul ol li dl dt dd strong em b i u s small sub sup br hr blockquote pre code " +
  "table thead tbody tfoot tr td th caption colgroup col figure figcaption button details summary audio source").split(" "));
const allowedAttrs = new Set(("id class style title lang dir role hidden tabindex alt width height open type controls preload " +
  "colspan rowspan scope aria-label aria-controls aria-expanded aria-current aria-pressed aria-live aria-atomic aria-hidden").split(" "));
const svgTags = new Set(["svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "title", "desc"]);
const svgAttrs = new Set(["viewBox", "d", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
  "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "points", "transform"]);

export function preparePrivateHtml(source: string): { html: string; csp: string; requiresAudio: boolean } {
  if (!source.trim() || Buffer.byteLength(source) > 5 * 1024 * 1024) throw new Error("HTML must be nonempty and at most 5 MB.");
  const doc = parse(source);
  const hashes = [hash(BRIDGE)];
  let requiresAudio = false;
  let head: Element | undefined;
  let body: Element | undefined;
  function walk(parent: Node) {
    if (!("childNodes" in parent)) return;
    for (const node of [...parent.childNodes]) {
      if (!("tagName" in node)) continue;
      const tag = node.tagName;
      if (tag === "link" && node.attrs.some(a => a.name === "rel" && a.value === "icon") &&
          node.attrs.some(a => a.name === "href" && /^data:image\/(?:png|jpeg);base64,/i.test(a.value))) {
        parent.childNodes.splice(parent.childNodes.indexOf(node), 1);
        continue;
      }
      const isSvg = node.namespaceURI === "http://www.w3.org/2000/svg";
      if (isSvg ? !svgTags.has(tag) : (!allowedTags.has(tag) || node.namespaceURI !== "http://www.w3.org/1999/xhtml")) {
        throw new Error(`Unsupported HTML element: ${tag}. Use self-contained HTML without forms, frames, SVG or remote widgets.`);
      }
      if (tag === "head") head = node;
      if (tag === "body") body = node;
      if (tag === "meta") {
        parent.childNodes.splice(parent.childNodes.indexOf(node), 1);
        continue;
      }
      if (tag === "script") {
        if (node.attrs.length) throw new Error("External scripts and script attributes are not supported.");
        const text = node.childNodes.map(n => "value" in n ? n.value : "").join("");
        const scriptHash = hash(text);
        if (!APPROVED_SCRIPTS.has(scriptHash)) {
          throw new Error("This HTML contains an unapproved script. Only reviewed local interactions are supported; remote or arbitrary scripts cannot be published.");
        }
        hashes.push(scriptHash);
        continue;
      }
      const attrs: Element["attrs"] = [];
      for (const attr of node.attrs) {
        if (attr.name.startsWith("on")) throw new Error("Inline event handlers are not supported. Use reviewed local scripts.");
        if (attr.name === "src" && tag === "img") {
          if (!/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(attr.value)) {
            throw new Error("Images must be embedded PNG, JPEG, GIF or WebP data images.");
          }
          attrs.push(attr);
        } else if (attr.name === "src" && (tag === "audio" || tag === "source")) {
          if (!/^[a-z0-9 _.-]+\.mp3$/i.test(attr.value)) throw new Error("Audio must reference one local MP3 filename, supplied as the attached audio.");
          requiresAudio = true;
        } else if (attr.name === "href" && tag === "a") {
          if (/^#[a-z0-9_-]*$/i.test(attr.value)) attrs.push(attr);
          else if (/^[a-z0-9 _.-]+\.mp3$/i.test(attr.value)) {
            requiresAudio = true;
            attrs.push({ name: "href", value: "#listen" });
          }
          // External navigation, including mailto, is deliberately disabled.
          // Its visible label remains unchanged; downloads live in trusted chrome.
        } else if (allowedAttrs.has(attr.name) || (isSvg && svgAttrs.has(attr.name))) attrs.push(attr);
        else if (["srcset", "ping", "formaction", "srcdoc", "action", "background", "target"].includes(attr.name)) {
          throw new Error(`Unsupported resource/navigation attribute: ${attr.name}.`);
        }
      }
      node.attrs = attrs;
      walk(node);
    }
  }
  walk(doc);
  if (!head || !body) throw new Error("Invalid HTML document.");
  const csp = privateHtmlCsp(hashes);
  // parse5 escaping is used for the CSP attribute as well.
  const policyDoc = parse(`<html><head><meta http-equiv="Content-Security-Policy" content="${csp.replace(/"/g, "&quot;")}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><script>${BRIDGE}</script></body></html>`);
  const htmlNode = policyDoc.childNodes.find(n => "tagName" in n && n.tagName === "html") as Element;
  const policyHead = htmlNode.childNodes.find(n => "tagName" in n && n.tagName === "head") as Element;
  const policyBody = htmlNode.childNodes.find(n => "tagName" in n && n.tagName === "body") as Element;
  head.childNodes.unshift(...policyHead.childNodes);
  body.childNodes.push(...policyBody.childNodes);
  return { html: serialize(doc), csp, requiresAudio };
}
