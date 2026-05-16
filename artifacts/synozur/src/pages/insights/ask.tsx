import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Send, Sparkles, ExternalLink, Loader2 } from "lucide-react";
import { marked } from "marked";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Meta } from "@/lib/meta";
import {
  Turnstile,
  TURNSTILE_SITE_KEY,
  type TurnstileHandle,
} from "@/components/turnstile";
import { BotCheckCallout } from "@/components/bot-check-callout";

// Convert single newlines to <br> so AI paragraph breaks render naturally.
marked.use({ breaks: true });

function renderMarkdown(text: string): string {
  if (!text) return "";
  return marked.parse(text, { async: false }) as string;
}

interface AskSource {
  kind: string;
  id: string;
  title: string;
  url: string;
  score?: number;
}

interface Turn {
  question: string;
  answer: string;
  sources: AskSource[];
  questionId: string | null;
  refused: boolean;
  lowConfidence: boolean;
  done: boolean;
}

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
const API_BASE = `${BASE_PATH}/api`;
const MAX_HISTORY_TURNS = 3;

const KIND_LABELS: Record<string, string> = {
  post: "Insight",
  case_study: "Case study",
  white_paper: "White paper",
  faq: "FAQ",
  polaris: "Polaris episode",
  application: "Synozur platform",
};

const STARTER_QUESTIONS = [
  "What is Synozur's approach to change management?",
  "What does the Polaris podcast explore?",
  "What's your point of view on AI for sales teams?",
  "What is Orion?",
];

// Stable per-tab session id so /admin/insights/questions can group a
// conversation thread. We use sessionStorage so refreshes preserve it
// but a new tab starts fresh.
function getSessionId(): string {
  try {
    const existing = sessionStorage.getItem("ask-synozur-session");
    if (existing) return existing;
    const fresh =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `s_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    sessionStorage.setItem("ask-synozur-session", fresh);
    return fresh;
  } catch {
    return `s_${Date.now()}`;
  }
}

export default function InsightsAskPage() {
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [botCheckFailed, setBotCheckFailed] = useState(false);
  // #282 — Once the server has accepted a Turnstile token for this session,
  // it caches that decision per (sessionId, ip) and no longer requires a
  // fresh token on follow-up turns. Mirror that on the client so the UI
  // doesn't disable the Ask button just because the (single-use) token
  // isn't around any more.
  const [botCheckSatisfied, setBotCheckSatisfied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);
  const sessionIdRef = useRef<string>("");

  useEffect(() => {
    sessionIdRef.current = getSessionId();
    return () => abortRef.current?.abort();
  }, []);

  function recordSourceClick(turn: Turn) {
    if (!turn.questionId) return;
    // Fire-and-forget — the link still navigates normally.
    void fetch(`${API_BASE}/ai/ask/click`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({ questionId: turn.questionId }),
    }).catch(() => {
      /* ignore */
    });
  }

  async function ask(q: string) {
    const trimmed = q.trim();
    if (!trimmed || loading) return;
    // #282 — when Turnstile is configured we require a token before the
    // *first* question; subsequent follow-ups are accepted by the server's
    // (sessionId, ip) cache so we no longer block on token presence.
    if (TURNSTILE_SITE_KEY && !botCheckSatisfied && !turnstileToken) {
      setError("Please complete the bot check before asking.");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Build history from prior completed turns (last N pairs).
    const history = turns
      .filter((t) => t.done && !t.refused && t.answer)
      .slice(-MAX_HISTORY_TURNS)
      .flatMap((t) => [
        { role: "user" as const, content: t.question },
        { role: "assistant" as const, content: t.answer },
      ]);

    const turnIndex = turns.length;
    const seed: Turn = {
      question: trimmed,
      answer: "",
      sources: [],
      questionId: null,
      refused: false,
      lowConfidence: false,
      done: false,
    };
    setTurns((prev) => [...prev, seed]);
    setQuestion("");
    setLoading(true);
    setError(null);
    setBotCheckFailed(false);

    const updateTurn = (patch: Partial<Turn>) =>
      setTurns((prev) => {
        const next = [...prev];
        if (!next[turnIndex]) return prev;
        next[turnIndex] = { ...next[turnIndex], ...patch };
        return next;
      });

    try {
      const res = await fetch(`${API_BASE}/ai/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: trimmed,
          sessionId: sessionIdRef.current,
          history,
          turnstileToken,
        }),
        signal: controller.signal,
      });
      if (res.status === 403) {
        // #282 — bot check failed. Surface the existing callout, reset the
        // widget, and drop the optimistic turn so the visitor can retry.
        let code: string | null = null;
        try {
          const data = (await res.json()) as { code?: string };
          code = data.code ?? null;
        } catch {
          /* ignore */
        }
        if (code === "bot_check_failed") {
          setBotCheckFailed(true);
          // Server cache may have expired (or restarted); fall back to
          // requiring a fresh token before the next attempt.
          setBotCheckSatisfied(false);
          setTurnstileToken(null);
          turnstileRef.current?.reset();
          setTurns((prev) => prev.filter((_, i) => i !== turnIndex));
          return;
        }
        throw new Error(`Request failed (${res.status})`);
      }
      if (!res.ok || !res.body) {
        throw new Error(`Request failed (${res.status})`);
      }
      // Server accepted the request → bot check passed for this session.
      // Subsequent follow-ups can omit the token (server-side cache).
      setBotCheckSatisfied(true);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const evt of events) {
          const line = evt.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          try {
            const payload = JSON.parse(line.slice(6));
            if (payload.sources) {
              updateTurn({ sources: payload.sources as AskSource[] });
            }
            if (payload.content) {
              setTurns((prev) => {
                const next = [...prev];
                const t = next[turnIndex];
                if (!t) return prev;
                next[turnIndex] = {
                  ...t,
                  answer: t.answer + (payload.content as string),
                };
                return next;
              });
            }
            if (payload.meta) {
              updateTurn({
                questionId: payload.meta.questionId ?? null,
                refused: !!payload.meta.refused,
                lowConfidence: !!payload.meta.lowConfidence,
              });
            }
            if (payload.done) updateTurn({ done: true });
          } catch {
            /* ignore malformed event */
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError("Sorry — something went wrong. Please try again in a moment.");
      updateTurn({ done: true });
    } finally {
      setLoading(false);
      updateTurn({ done: true });
    }
  }

  function clearConversation() {
    abortRef.current?.abort();
    setTurns([]);
    setQuestion("");
    setError(null);
    setBotCheckFailed(false);
    // New conversation = new session id will be generated next ask cycle
    // by the route's session logic, so re-arm the bot-check gate.
    setBotCheckSatisfied(false);
    setTurnstileToken(null);
    turnstileRef.current?.reset();
  }

  return (
    <>
      <Meta
        title="Ask Synozur — Insights"
        description="Ask a question and get a grounded answer from Synozur's published research, case studies, and Polaris episodes."
      />
      <div className="mx-auto max-w-3xl px-6 py-16">
        <header className="mb-8">
          <Link
            href="/insights"
            className="text-sm text-muted-foreground hover:underline"
            data-testid="link-back-to-insights"
          >
            ← Back to Insights
          </Link>
          <h1
            className="mt-4 flex items-center gap-3 text-4xl font-bold tracking-tight"
            data-testid="heading-ask-synozur"
          >
            <Sparkles className="h-8 w-8 text-primary" />
            Ask Synozur
          </h1>
          <p className="mt-3 text-muted-foreground">
            Get a grounded answer from our published research, case studies,
            and Polaris episodes. Every answer cites the source material
            it's drawn from. You can ask follow-up questions —
            we'll keep the conversation in mind.
          </p>
        </header>

        {turns.length === 0 && (
          <div className="mb-8" data-testid="block-starters">
            <p className="text-sm font-medium text-muted-foreground">
              Try one of these:
            </p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {STARTER_QUESTIONS.map((q) => (
                <li key={q}>
                  <button
                    type="button"
                    onClick={() => ask(q)}
                    className="rounded-full border bg-background px-3 py-1.5 text-sm hover:bg-muted"
                    data-testid={`button-starter-${q.length}`}
                  >
                    {q}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {turns.length > 0 && (
          <ol className="mb-8 space-y-8" data-testid="list-turns">
            {turns.map((turn, i) => (
              <li
                key={i}
                className="space-y-4"
                data-testid={`turn-${i}`}
              >
                <div className="rounded-lg border bg-muted/40 p-4">
                  <p className="text-sm font-medium text-muted-foreground">
                    Your question
                  </p>
                  <p className="mt-1" data-testid={`text-question-${i}`}>
                    {turn.question}
                  </p>
                </div>

                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Answer
                  </p>
                  {turn.refused ? (
                    <RefusalAnswer />
                  ) : (
                    <div className="mt-2" data-testid={`text-answer-${i}`}>
                      {turn.answer ? (
                        <div
                          className="prose prose-sm dark:prose-invert max-w-none
                            prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-1
                            prose-p:my-1.5 prose-p:leading-relaxed
                            prose-li:my-0.5 prose-ul:my-2 prose-ol:my-2
                            prose-strong:font-semibold
                            prose-code:text-primary prose-code:bg-muted prose-code:rounded prose-code:px-1 prose-code:py-0.5 prose-code:text-sm prose-code:before:content-none prose-code:after:content-none
                            prose-pre:bg-muted prose-pre:rounded-lg"
                          dangerouslySetInnerHTML={{ __html: renderMarkdown(turn.answer) }}
                        />
                      ) : (
                        loading && i === turns.length - 1 && (
                          <span className="text-muted-foreground text-base">…</span>
                        )
                      )}
                      {loading && i === turns.length - 1 && !turn.done && turn.answer && (
                        <span className="inline-block h-4 w-2 animate-pulse bg-current align-middle ml-0.5" />
                      )}
                    </div>
                  )}
                </div>

                {!turn.refused && turn.sources.length > 0 && (
                  <section data-testid={`block-sources-${i}`}>
                    <p className="text-sm font-medium text-muted-foreground">
                      Sources
                    </p>
                    <ol className="mt-2 space-y-2">
                      {turn.sources.map((s, si) => (
                        <li
                          key={`${s.kind}-${s.id}-${si}`}
                          className="flex items-start gap-2"
                        >
                          <span className="mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                            {si + 1}
                          </span>
                          <div className="flex-1">
                            <Link
                              href={s.url}
                              onClick={() => recordSourceClick(turn)}
                              className="font-medium hover:underline"
                              data-testid={`link-source-${i}-${si}`}
                            >
                              {s.title}
                              <ExternalLink className="ml-1 inline h-3 w-3" />
                            </Link>
                            <p className="text-xs text-muted-foreground">
                              {KIND_LABELS[s.kind] ?? s.kind}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </section>
                )}
              </li>
            ))}
          </ol>
        )}

        {error && (
          <p
            className="mb-4 text-sm text-destructive"
            data-testid="text-error"
          >
            {error}
          </p>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(question);
          }}
          className="flex flex-col gap-3"
          data-testid="form-ask"
        >
          <div className="flex gap-2">
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={
                turns.length > 0 ? "Ask a follow-up…" : "Ask a question…"
              }
              disabled={loading}
              data-testid="input-ask-question"
              className="flex-1"
              maxLength={2000}
            />
            <Button
              type="submit"
              disabled={
                loading ||
                question.trim().length < 3 ||
                (TURNSTILE_SITE_KEY && !botCheckSatisfied
                  ? !turnstileToken
                  : false)
              }
              data-testid="button-ask-submit"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              <span className="ml-2">Ask</span>
            </Button>
          </div>
          <Turnstile ref={turnstileRef} onVerify={setTurnstileToken} />
          {botCheckFailed && <BotCheckCallout className="text-left" />}
        </form>

        {turns.length > 0 && !loading && (
          <div className="mt-4 text-sm text-muted-foreground">
            <button
              type="button"
              className="underline"
              onClick={clearConversation}
              data-testid="button-clear-conversation"
            >
              Start a new conversation
            </button>
            {" · "}
            <Link href="/contact" className="underline">
              Talk to a human
            </Link>
          </div>
        )}

        <footer className="mt-16 border-t pt-6 text-xs text-muted-foreground">
          Answers are AI-generated and grounded in our published material.
          They may be incomplete or out of date — when in doubt,{" "}
          <Link href="/contact" className="underline">
            talk to a human
          </Link>
          .
        </footer>
      </div>
    </>
  );
}

function RefusalAnswer() {
  return (
    <div
      className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-4 text-base leading-relaxed dark:border-amber-900 dark:bg-amber-950"
      data-testid="block-refusal"
    >
      <p>
        We don't have published material on that yet — but we'd love to
        talk about it.
      </p>
      <p className="mt-3">
        <Link
          href="/contact"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          data-testid="link-refusal-contact"
        >
          Talk to a human
          <ExternalLink className="h-3 w-3" />
        </Link>
      </p>
    </div>
  );
}
