/**
 * Server-rendered consent screen for /oauth/authorize — #128 Phase B.
 *
 * Kept as a self-contained HTML document (no SPA dependency) so the OAuth
 * surface isn't blocked on the marketing site's build. Same pattern as
 * socialBotRenderer.
 *
 * The form POSTs to /oauth/authorize/decision with the original authorize
 * parameters echoed as hidden inputs so a single CSRF token + a signed-in
 * session is sufficient to validate the decision.
 */

import { htmlEscape } from "./ogResolver";

export interface ConsentScopeRow {
  scope: string;
  description: string;
}

export interface ConsentScreenInput {
  clientName: string;
  clientDescription: string | null;
  scopeRows: ConsentScopeRow[];
  // Echoed back so the decision endpoint reconstructs the authorize request.
  hiddenFields: Record<string, string>;
  csrfToken: string;
  // Where the form posts. Present as a parameter so tests can override.
  decisionUrl: string;
}

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  openid: "Confirm your identity",
  profile: "Read your name and avatar",
  email: "Read your email address",
  offline_access: "Stay signed in without re-prompting (issues a refresh token)",
  "content.read": "Read your CMS content (posts, library, taxonomy)",
  "content.write": "Author and publish CMS content on your behalf",
  "engagements.read": "Read engagements you have access to",
  "deliverables.read": "Read deliverables you have access to",
  "invoices.read": "Read invoices you have access to",
};

export function describeScope(scope: string): string {
  return SCOPE_DESCRIPTIONS[scope] ?? scope;
}

export function renderConsentScreen(input: ConsentScreenInput): string {
  const hidden = Object.entries(input.hiddenFields)
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${htmlEscape(name)}" value="${htmlEscape(value)}" />`,
    )
    .join("\n");
  const scopeListItems = input.scopeRows
    .map(
      (s) =>
        `<li><strong>${htmlEscape(s.scope)}</strong> — ${htmlEscape(s.description)}</li>`,
    )
    .join("\n");
  const description = input.clientDescription
    ? `<p class="muted">${htmlEscape(input.clientDescription)}</p>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<title>Authorize ${htmlEscape(input.clientName)} | The Synozur Alliance</title>
<style>
  body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; background: #0a0a0f; color: #f4f4f6; margin: 0; padding: 2rem; min-height: 100vh; box-sizing: border-box; display: flex; align-items: center; justify-content: center; }
  .card { max-width: 520px; width: 100%; background: #15151c; border: 1px solid #2a2a36; border-radius: 12px; padding: 2rem; }
  h1 { margin: 0 0 0.25rem; font-size: 1.4rem; }
  .muted { color: #a4a4b0; font-size: 0.95rem; margin: 0.5rem 0 1.5rem; }
  ul { list-style: disc; padding-left: 1.25rem; line-height: 1.6; }
  li { margin-bottom: 0.4rem; }
  .actions { display: flex; gap: 0.75rem; margin-top: 2rem; }
  button { flex: 1; padding: 0.75rem 1.25rem; border-radius: 8px; border: 0; font-size: 1rem; font-weight: 600; cursor: pointer; }
  button.primary { background: #810FFB; color: white; }
  button.primary:hover { background: #6f0bd9; }
  button.secondary { background: transparent; color: #f4f4f6; border: 1px solid #2a2a36; }
  button.secondary:hover { background: #1f1f2a; }
</style>
</head>
<body>
<form method="POST" action="${htmlEscape(input.decisionUrl)}" class="card">
${hidden}
<input type="hidden" name="csrf_token" value="${htmlEscape(input.csrfToken)}" />
<h1>${htmlEscape(input.clientName)} wants to access your account</h1>
${description}
<p>If you allow this, ${htmlEscape(input.clientName)} will be able to:</p>
<ul>
${scopeListItems}
</ul>
<div class="actions">
  <button type="submit" name="decision" value="deny" class="secondary">Deny</button>
  <button type="submit" name="decision" value="approve" class="primary">Allow</button>
</div>
</form>
</body>
</html>`;
}
