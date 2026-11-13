/**
 * Generates reviewed content-only release documents/assets. No database or network access.
 * pnpm --filter @workspace/api-server exec tsx src/scripts/prepareTribalRelease.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const root = new URL("../../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const write = (path: string, text: string) => writeFileSync(new URL(path, root), text);
const page = JSON.parse(read("artifacts/api-server/src/content/tribal-first-nations.dev.json"));
const booking = JSON.parse(read("artifacts/api-server/src/content/tribal-context-conversation.json"));
const { slug, ...pagePatch } = page;
write("release-files/tribal-first-nations.landing-page.json", JSON.stringify(pagePatch, null, 2) + "\n");
write("release-files/tribal-context-conversation.booking.json", JSON.stringify(booking, null, 2) + "\n");
write("release-files/tribal-context-conversation-description.html", booking.descriptionHtml + "\n");

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
for (const [source, target, subheading, supporting] of [
  ["tribal-first-nations", "tribal-first-nations-champion-system", "The Champion System", "Trusted AI capability. Governed by your Nation."],
  ["tribal-first-nations-workshop", "tribal-first-nations-context-conversation", "Start a context conversation", "Your priorities. Your context. A path defined together."],
]) {
  const base = read(`release-files/${source}-og.svg`);
  // Retain the established nebula artwork and embedded brand logo.
  const artwork = base.slice(0, base.indexOf('<text font-family='));
  const svg = `${artwork}<text font-family="Avenir Next, Liberation Sans, Arial, sans-serif" font-size="72" font-weight="800" fill="#fff"><tspan x="80" y="270">Tribal Nations &amp;</tspan><tspan x="80" y="350">First Nations</tspan></text>
<text x="80" y="424" font-family="Avenir Next, Liberation Sans, Arial, sans-serif" font-size="38" font-weight="600" fill="#fff">${esc(subheading!)}</text>
<text x="80" y="485" font-family="Avenir Next, Liberation Sans, Arial, sans-serif" font-size="30" fill="#fff" fill-opacity=".88">${esc(supporting!)}</text></svg>`;
  write(`release-files/${source}-og.svg`, svg);
  const jpeg = await sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
  writeFileSync(new URL(`release-files/${source}-og.jpg`, root), jpeg);
  writeFileSync(new URL(`artifacts/synozur/public/og/${target}.jpg`, root), jpeg);
}

const fields = (obj: Record<string, unknown>) => Object.entries(obj)
  .map(([key, value]) => `<tr><th>${esc(key)}</th><td>${esc(typeof value === "string" ? value : JSON.stringify(value))}</td></tr>`).join("");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Champion System — Tribal production release</title><style>
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f6f5fa;color:#20202b;font:16px/1.6 system-ui,sans-serif}main{max-width:1000px;margin:auto;padding:32px 20px}section{background:white;border:1px solid #ddd;padding:24px;margin:24px 0;border-radius:12px}h1,h2{line-height:1.2}th,td{text-align:left;vertical-align:top;padding:10px;border-bottom:1px solid #ddd;overflow-wrap:anywhere}table{width:100%;table-layout:fixed}th{width:28%}pre,textarea{white-space:pre-wrap;overflow-wrap:anywhere;width:100%;background:#f5f3fa;color:#20202b;padding:16px;border:1px solid #ddd}textarea{height:320px}code{overflow-wrap:anywhere}a{color:#6500b9}label{display:block;margin:12px 0}img{max-width:100%}.notice{border-left:5px solid #7800e8}
</style></head><body><main>
<h1>Tribal Nations &amp; First Nations<br>Champion System production release</h1>
<section class="notice"><strong>Dev/test implementation and release preparation only. Production changes require separate approval.</strong>
<p>Use this package to update EXISTING records, not create duplicates or replace the database. The landing-page JSON is now a <strong>content-only patch, not a direct CMS import</strong>. Never import it directly, and never reuse the old Draft import.</p>
<p>Keep <code>/tribal-first-nations</code> and <code>/start/tribal-nations-first-nations-workshop</code>. Development retains its existing <code>/start/tribal-first-nations-workshop</code> route; release content uses the corrected production route.</p></section>
<section><h2>1. Back up and review current production</h2><ol>
<li>After release approval, export the existing page from Admin → Site Config → Landing Pages. Save that fresh, unmodified export for restoration.</li>
<li>Record the existing booking title, teaser, HTML description, SEO title/description and image. Preserve its slug, active/time-window settings, order, scope, calendar URL, Graph business/service IDs and timezone.</li>
<li>Compare the live content with this approved package. Stop if someone has made new edits that conflict. Included field changes do not authorize overwriting later editorial changes.</li>
</ol><p>The companion <code>tribal-production-change-manifest.json</code> records public before/after fields for review. It is a dated observation, not a CMS import or restoration backup; fresh exports remain required.</p>
<p>Preserve the selected landing-page hero image, canonical URL, publication dates, classification and references. Library stays on; homepage featuring stays off. No schema migration or startup content seed is required.</p></section>
<section><h2>2. Publish reviewed code and image assets</h2><p>Review the complete pending code release, not just this feature, then use Replit Publish after separate approval. Code includes the revised Fit description, light/dark rich-text support, booking SEO suffix handling, and the two new JPEG assets. Publishing code does not copy CMS records.</p>
<p><strong>Do not overwrite the production database with development data.</strong> Existing image URLs remain available for restoration; new content selects the new asset paths.</p>
<table>${fields({landingImage: page.ogImageUrl, bookingImage: booking.ogImageUrl})}</table>
<p>Confirm both new assets return 1200 × 630 JPEGs before selecting them in production.</p></section>
<section><h2>3. Update the existing booking</h2><p>In Admin → People → Bookings, open slug <code>tribal-nations-first-nations-workshop</code>. Change only the fields below, then save. This is an Initial Context Conversation, not an included assessment or paid-readout checkout.</p>
<table>${fields(Object.fromEntries(Object.entries(booking).filter(([key]) => key !== "descriptionHtml")))}</table>
<h3>HTML description</h3><textarea readonly>${esc(booking.descriptionHtml)}</textarea>
<p>The companion booking JSON is a field reference or authenticated PATCH payload, not a booking import. Do not change the calendar configuration, assignment, duration, price, or authentication connection.</p></section>
<section><h2>4. Prepare a preservation-safe landing-page import</h2>
<p>Combine the approved content patch with the <strong>fresh production CMS export</strong> offline. This preserves production-only fields and the published status rather than taking the live page offline as Draft.</p>
<pre>node release-files/prepare-tribal-import.mjs fresh-production-export.json /tmp/tribal-reviewed-import.json</pre>
<p>The helper does not contact production. It refuses unexpected visibility, leaves the original export untouched, and generates a normal CMS import without a force flag. Review the output against the fresh export: only the following fields should change.</p>
<table>${fields(Object.fromEntries(Object.entries(pagePatch).filter(([key]) => key !== "blocks")))}</table>
<p><strong>blocks:</strong> replace the old Sprint-only journey with the approved hero, context CTA, trust/capability explanation, Champion System, five roles, four offers, North Star Method, measurement/governance, sovereignty resource, six FAQs and closing CTA.</p>
<p>In the production landing-page list, import the reviewed merged file. The CMS will detect the existing slug. Confirm that specific overwrite only after comparison, and do not save if the record has changed since export. Preserve the existing hero image; it also remains the Library card thumbnail. Changing that selected image requires an explicit editorial decision.</p>
</section>
<section><h2>5. Verify production and retain restoration files</h2><ul>
<li>Check landing and booking on desktop/mobile and in light/dark themes, including long headings and description contrast.</li>
<li>Test all three booking CTAs and the Champion System in-page link. Every production booking CTA must use <code>/start/tribal-nations-first-nations-workshop</code>.</li>
<li>Confirm native calendar services and availability load. Inspect the details form without submitting a real appointment. Production Microsoft authorization is separate from dev/test; do not copy tokens or revert to an iframe.</li>
<li>Confirm the revised listing in /start, Fit callout, Library summary/tags, selected Library thumbnail, and existing sovereignty article link. No separate booking Library item or homepage feature.</li>
<li>Check browser title, description, canonical, crawler response, FAQ structured data, sitemap entries, and the distinct new OG images. Social platforms may cache old previews.</li>
<li>Confirm no excluded proof lines, invented results, pricing or duration promises appear. Check that header, Resources navigation, footer, icons and Polaris remain unchanged.</li>
</ul><p><strong>Known verification gap:</strong> the current sitemap includes the Tribal Library entry but omits the landing-page and booking-detail URLs. This existing discovery gap is separate follow-up work, not fixed by importing content. Desktop landing and mobile booking screenshots, crawler metadata, Library data, and native service/availability requests were checked in development. Dark-theme classes were inspected in source; a full interactive dark-mode and appointment-submission test was not performed. No real appointment was created.</p><h3>Restoration</h3><p>If content must be restored, use the original production landing-page export after reviewing any subsequent edits, and restore only the six saved booking content fields. Keep calendar settings and URLs unchanged. Restore the previous image selections; old assets remain available. For a code regression, use the reviewed deployment/checkpoint recovery process separately. Do not restore the whole database.</p></section>
<section><h2>Copy and discovery reference</h2><p><strong>Fit:</strong> Build trusted, sustainable AI capability through the Champion System—grounded in community priorities, designed in partnership, and governed by each Nation.</p>
<p><strong>Library:</strong> ${esc(page.description)}</p><p><strong>Tags:</strong> ${page.tags.map(esc).join(" · ")}</p>
<p>Keep the existing public labels and URLs. The sovereignty article is supporting context, not Champion System delivery proof. The independent Sprint offer elsewhere is unchanged.</p></section>
</main></body></html>`;
write("release-files/tribal-production-checklist.html", html);
console.log("Prepared content-only patches, offline import helper reference, release checklist and two 1200×630 JPEGs.");
