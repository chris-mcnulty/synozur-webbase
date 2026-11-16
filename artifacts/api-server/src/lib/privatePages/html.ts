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
let controls;
window.addEventListener("message", function(e){
 if(e.source!==parent || !e.data || e.data.type!=="private-page-assets")return;
 if(controls)controls.remove();
 if(objectUrl)URL.revokeObjectURL(objectUrl);
 objectUrl=e.data.audioBlob instanceof Blob?URL.createObjectURL(e.data.audioBlob):null;
 controls=document.createElement("aside");
 controls.setAttribute("aria-label","Private proposal attachments");
 controls.style.cssText="box-sizing:border-box;display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:10px 20px;background:#171128;color:#fff;font:14px system-ui;position:relative;z-index:100";
 function download(kind,label){
  const b=document.createElement("button");b.type="button";b.textContent=label;
  b.style.cssText="cursor:pointer;padding:7px 12px;border:1px solid #8c7ea5;border-radius:6px;background:transparent;color:#fff;font:inherit";
  b.addEventListener("click",function(){parent.postMessage({type:"private-page-download",kind:kind},"*");});
  controls.appendChild(b);
 }
 if(objectUrl){
  const details=document.createElement("details");details.id="private-proposal-listen";
  const summary=document.createElement("summary");summary.textContent="Listen to this proposal";summary.style.cursor="pointer";
  const audio=document.createElement("audio");audio.controls=true;audio.preload="metadata";audio.src=objectUrl;
  audio.style.cssText="display:block;max-width:100%;margin-top:10px";
  details.appendChild(summary);details.appendChild(audio);controls.appendChild(details);
  download("audio","Download audio");
  document.querySelectorAll("audio").forEach(function(a){a.src=objectUrl;a.load();});
 }
 if(e.data.hasTranscript===true)download("transcript","Download narration script");
 if(controls.childNodes.length)document.body.prepend(controls);
});
document.addEventListener("click",function(e){
 const a=e.target instanceof Element?e.target.closest("a"):null;
 if(!a)return;
 const kind=a.getAttribute("data-private-attachment");
 const href=a.getAttribute("href");
 // srcdoc inherits the parent's URL: native fragment navigation would load
 // the portal inside this sandbox instead of scrolling this document.
 if(!kind && href && href.charAt(0)==="#"){
  e.preventDefault();
  const target=document.getElementById(href.slice(1));
  if(target){
   target.scrollIntoView({behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth",block:"start"});
   if(!target.hasAttribute("tabindex"))target.setAttribute("tabindex","-1");
   target.focus({preventScroll:true});
  }
  return;
 }
 if(!kind)return;
 e.preventDefault();
 if(kind==="transcript")parent.postMessage({type:"private-page-download",kind:"transcript"},"*");
 else if(kind==="audio"){
  const d=document.getElementById("private-proposal-listen");
  if(d){d.open=true;d.scrollIntoView({behavior:"smooth",block:"nearest"});}
 }
},true);
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
            attrs.push({ name: "href", value: "#private-proposal-listen" }, { name: "data-private-attachment", value: "audio" });
          } else if (/^[a-z0-9 _.-]+\.docx$/i.test(attr.value)) {
            attrs.push({ name: "href", value: "#private-script" }, { name: "data-private-attachment", value: "transcript" });
          }
          // External navigation, including mailto, is deliberately disabled.
          // Its visible label remains unchanged; local attachments use the reviewed bridge.
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
