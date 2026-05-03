// #167 — Anthropic prompt-cache marker placement.
//
// Pure helpers for converting a plain `system` string + a flat history of
// `{ role, content }` rows into the content-array form Anthropic expects when
// you want a `cache_control: { type: "ephemeral" }` marker on stable prefixes.
//
// Splitting these out of the route makes the marker shape the unit-tested
// contract: an SDK upgrade that changes the cache-control wire format will
// fail this test rather than silently regress to non-cached billing.
//
// Caching rules (see Anthropic docs):
// - The marker caches the prefix UP TO AND INCLUDING the marked block.
// - Cache TTL is ~5 minutes, so re-mark on every turn to slide the window.
// - Never mark the user's current message; the next turn's prefix changes.
// - Don't cache tiny one-off blocks (cache writes have a 25 % surcharge,
//   only break-even after one read). Keep `getSimpleCompletion()`-style
//   helpers non-cached.

// Structural shape of AnthropicMessageParam — kept inline so this
// helper module doesn't pull `@anthropic-ai/sdk` into api-server's
// direct dependency graph (the SDK is consumed transitively through
// `@workspace/integrations-anthropic-ai`). The fields used here are
// stable across the 0.x SDK line; an upgrade that breaks them would
// also fail the unit tests in promptCache.test.ts.
type AnthropicTextBlock = {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
};
type AnthropicMessageParam = {
  role: "user" | "assistant";
  content: string | Array<AnthropicTextBlock>;
};

type CacheControl = { type: "ephemeral" };
const EPHEMERAL: CacheControl = { type: "ephemeral" };

export type CachedSystemBlock = {
  type: "text";
  text: string;
  cache_control: CacheControl;
};

// Build the `system` parameter as a single cached text block. Returns
// `undefined` for an empty prompt so the caller can skip the field entirely
// (Anthropic rejects an empty system array).
export function buildCachedSystemBlocks(
  systemPrompt: string,
): [CachedSystemBlock] | undefined {
  if (!systemPrompt) return undefined;
  return [{ type: "text", text: systemPrompt, cache_control: EPHEMERAL }];
}

export interface FlatMessage {
  role: "user" | "assistant";
  content: string;
}

// Convert a flat history into `MessageParam[]`, marking the LAST assistant
// message (if any) with `cache_control: { type: "ephemeral" }`. The current
// user turn is appended unmarked — its content is what makes this turn unique
// and we explicitly do not want to cache it.
export function applyHistoryCacheMarkers(
  priorMessages: readonly FlatMessage[],
  currentUserMessage: string,
): AnthropicMessageParam[] {
  const lastAssistantIdx = (() => {
    for (let i = priorMessages.length - 1; i >= 0; i--) {
      if (priorMessages[i].role === "assistant") return i;
    }
    return -1;
  })();

  const out: AnthropicMessageParam[] = priorMessages.map((m, i) => {
    if (i === lastAssistantIdx) {
      return {
        role: "assistant",
        content: [
          { type: "text", text: m.content, cache_control: EPHEMERAL },
        ],
      };
    }
    return { role: m.role, content: m.content };
  });
  out.push({ role: "user", content: currentUserMessage });
  return out;
}

// Future-proofing for #134 (`searchEditorialCorpus` tool). Tool schemas
// don't change per-call, so the LAST tool definition gets the marker — which
// caches every tool definition before it. Returns `undefined` on an empty
// list so the caller can skip the field.
//
// Today this is exported for completeness and unit-tested for shape; no
// route currently passes tools. When #134 wires in the corpus tool it will
// pipe its tool array through this helper.
export function applyToolCacheMarkers<T extends { name: string }>(
  tools: readonly T[],
): (T & { cache_control?: CacheControl })[] | undefined {
  if (tools.length === 0) return undefined;
  return tools.map((t, i) =>
    i === tools.length - 1 ? { ...t, cache_control: EPHEMERAL } : { ...t },
  );
}

// Streaming `usage` arrives split across two events:
// - `message_start.message.usage` carries `input_tokens`,
//   `cache_creation_input_tokens`, `cache_read_input_tokens`, and a
//   placeholder `output_tokens` (typically 1).
// - `message_delta.usage` carries the final `output_tokens`.
//
// This accumulator merges both into one record so the caller can log /
// persist a single rollup row per request.
export interface CacheUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export function emptyCacheUsage(): CacheUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
}

export function mergeMessageStartUsage(
  acc: CacheUsage,
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  },
): CacheUsage {
  return {
    inputTokens: usage.input_tokens ?? acc.inputTokens,
    outputTokens: usage.output_tokens ?? acc.outputTokens,
    cacheCreationInputTokens:
      usage.cache_creation_input_tokens ?? acc.cacheCreationInputTokens,
    cacheReadInputTokens:
      usage.cache_read_input_tokens ?? acc.cacheReadInputTokens,
  };
}

export function mergeMessageDeltaUsage(
  acc: CacheUsage,
  usage: { output_tokens?: number },
): CacheUsage {
  return {
    ...acc,
    outputTokens: usage.output_tokens ?? acc.outputTokens,
  };
}

// Total *billable* input tokens — useful for the cost-per-day chart in
// Site Health (#166). Cached reads are billed at ~10 % of the standard
// input-token rate; cache writes at ~125 %.
export function cacheHitRate(usage: CacheUsage): number {
  const denom =
    usage.inputTokens +
    usage.cacheCreationInputTokens +
    usage.cacheReadInputTokens;
  if (denom === 0) return 0;
  return usage.cacheReadInputTokens / denom;
}
