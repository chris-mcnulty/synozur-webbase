export type AgentBotCategory = "ai" | "search" | "other";

export interface AgentBotSignature {
  readonly match: RegExp;
  readonly name: string;
  readonly category: AgentBotCategory;
}

/**
 * Named AI-crawler and search-engine patterns (no broad catch-alls).
 * traffic.ts uses this to interleave social-bot entries before the generic
 * fetcher catch-alls.
 */
export declare const SPECIFIC_AGENT_BOT_SIGNATURES: ReadonlyArray<AgentBotSignature>;

/**
 * Broad catch-all patterns for generic non-JS HTTP fetchers.
 * Must be applied after all named patterns.
 */
export declare const GENERIC_FETCHER_SIGNATURES: ReadonlyArray<AgentBotSignature>;

/**
 * Combined array (SPECIFIC_AGENT_BOT_SIGNATURES + GENERIC_FETCHER_SIGNATURES).
 * Used by server.mjs for boolean prerender-routing checks.
 */
export declare const AGENT_BOT_SIGNATURES: ReadonlyArray<AgentBotSignature>;
