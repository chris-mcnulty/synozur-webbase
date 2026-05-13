// Synonym expansion for the public search route. Kept in its own module
// (no DB imports) so the rewrite contract can be unit-tested without
// booting the database.
//
// The expansion is query-time: instead of widening the FTS index with
// every alias, we leave the lexical index alone and rewrite the user's
// query into a tsquery that ORs each matched synonym group together,
// then ANDs that with the remainder of the input. This means
// `AI strategy` matches pages that only ever say "artificial
// intelligence strategy" — the bug behind the original "AI returns one
// result" complaint.

export const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ["ai", "artificial intelligence"],
  ["ml", "machine learning"],
  ["genai", "gen ai", "generative ai"],
  ["llm", "llms", "large language model", "large language models"],
  ["nlp", "natural language processing"],
  ["rag", "retrieval augmented generation", "retrieval-augmented generation"],
  ["m365", "microsoft 365", "office 365", "o365"],
  ["ado", "azure devops"],
  ["spo", "sharepoint online"],
  ["power bi", "powerbi", "pbi"],
  ["copilot", "microsoft copilot", "ms copilot"],
  ["kpi", "kpis", "key performance indicator", "key performance indicators"],
  ["sso", "single sign on", "single sign-on"],
  ["devops", "dev ops"],
  ["roi", "return on investment"],
  ["ux", "user experience"],
  ["ui", "user interface"],
  ["cx", "customer experience"],
  ["dx", "developer experience"],
  ["saas", "software as a service"],
  ["paas", "platform as a service"],
  ["iaas", "infrastructure as a service"],
  ["pm", "project management", "project manager"],
  ["po", "product owner"],
  ["pmo", "program management office", "project management office"],
  ["cms", "content management system"],
  ["crm", "customer relationship management"],
  ["erp", "enterprise resource planning"],
] as const;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeSqlLiteral(s: string): string {
  return s.replace(/'/g, "''");
}

// Build a SQL expression that evaluates to a tsquery, with any matching
// synonym phrases expanded as OR-groups AND-combined with the rest of
// the user's terms. Each variant runs through `plainto_tsquery` so
// PostgreSQL's english config still handles stemming / stopwords / case
// — we just splice the synonym fan-out on top.
export function buildTsqueryExpr(rawQuery: string): string {
  const lower = rawQuery.toLowerCase().replace(/\s+/g, " ").trim();
  if (!lower) {
    return `plainto_tsquery('english', '')`;
  }

  let remaining = lower;
  const parts: string[] = [];
  const usedGroups = new Set<number>();

  // Repeatedly pick the longest synonym variant that still matches
  // `remaining`, across every group that hasn't been consumed yet. The
  // search is *global* — not group-local — so e.g. "generative ai"
  // matches the 13-char "generative ai" alias in the GenAI group
  // instead of getting devoured by the 2-char "ai" in an earlier group
  // and leaving "generative" stranded as a required free-text term.
  while (true) {
    let bestGroupIdx = -1;
    let bestVariant: string | null = null;
    let bestLen = 0;

    SYNONYM_GROUPS.forEach((group, idx) => {
      if (usedGroups.has(idx)) return;
      for (const variant of group) {
        if (variant.length <= bestLen) continue;
        const re = new RegExp(`\\b${escapeRegex(variant)}\\b`, "i");
        if (re.test(remaining)) {
          bestGroupIdx = idx;
          bestVariant = variant;
          bestLen = variant.length;
        }
      }
    });

    if (bestGroupIdx < 0 || bestVariant === null) break;
    usedGroups.add(bestGroupIdx);
    remaining = remaining
      .replace(new RegExp(`\\b${escapeRegex(bestVariant)}\\b`, "gi"), " ")
      .replace(/\s+/g, " ")
      .trim();
    const group = SYNONYM_GROUPS[bestGroupIdx]!;
    const orParts = group.map(
      (v) => `plainto_tsquery('english', '${escapeSqlLiteral(v)}')`,
    );
    parts.push(`(${orParts.join(" || ")})`);
  }

  if (remaining.length > 0) {
    parts.push(`plainto_tsquery('english', '${escapeSqlLiteral(remaining)}')`);
  }

  if (parts.length === 0) {
    return `plainto_tsquery('english', '${escapeSqlLiteral(rawQuery)}')`;
  }
  if (parts.length === 1) return parts[0];
  return `(${parts.join(" && ")})`;
}
