import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { CheckCircle2 } from "lucide-react";
import {
  DEMO_STEPS,
  isDemoStepId,
  type DemoStepId,
} from "@/data/constellation-demo-seed";
import { DemoDashboard } from "./dashboard";
import { DemoNarrative } from "./narrative";
import { DemoRisk } from "./risk";
import { DemoOutlook } from "./outlook";
import { DemoComplete } from "./complete";
import { emitDemoEvent } from "./telemetry";

// Step-driven controller for the Constellation interactive demo. The active
// step is mirrored into the URL via the `?step=` query so we can deep-link
// from ad campaigns straight to a specific moment (e.g. ?step=narrative).
//
// We only count a session as "full depth" — the high-intent telemetry
// signal — once the visitor has actually viewed every step in the canonical
// order. Linking directly to /applications/constellation?step=outlook does
// not earn that signal.

const STEP_ORDER: readonly DemoStepId[] = [
  "dashboard",
  "narrative",
  "risk",
  "outlook",
  "complete",
];

function readStepFromSearch(search: string): DemoStepId {
  const params = new URLSearchParams(search);
  const raw = params.get("step");
  return isDemoStepId(raw) ? raw : "dashboard";
}

export function ConstellationDemo() {
  const [location, navigate] = useLocation();
  const search = useSearch();
  const [step, setStep] = useState<DemoStepId>(() => readStepFromSearch(search));
  const seenSteps = useRef<Set<DemoStepId>>(new Set());
  const startedRef = useRef(false);
  const completionFiredRef = useRef(false);

  // Sync with URL on outside changes (back/forward).
  useEffect(() => {
    const next = readStepFromSearch(search);
    if (next !== step) setStep(next);
  }, [search, step]);

  // Telemetry rules:
  // - `step_viewed` is *always* partial. It's a navigation breadcrumb, not
  //   a high-intent signal.
  // - `demo_completed_full` is the single high-intent event. It fires
  //   exactly once per session, only after the visitor has actually seen
  //   every canonical moment (dashboard → narrative → risk → outlook,
  //   confirmed by simulated Outlook send) AND lands on the completion
  //   screen. Reaching `complete` is gated by `DemoOutlook.onContinue`,
  //   which only fires after the simulated send finishes.
  // - We latch the completion in sessionStorage as well as a ref so a
  //   page refresh in the middle of a session can't re-fire it, and pair
  //   it with a per-session `completionId` UUID so the server can dedupe
  //   even if the client retries the POST.
  useEffect(() => {
    if (!startedRef.current) {
      startedRef.current = true;
      emitDemoEvent({ kind: "demo_started", step }, { app: "constellation", depth: "partial" });
    }
    seenSteps.current.add(step);
    emitDemoEvent({ kind: "step_viewed", step }, { app: "constellation", depth: "partial" });

    const allSeen = ["dashboard", "narrative", "risk", "outlook"].every((s) =>
      seenSteps.current.has(s as DemoStepId),
    );
    const sessionLatched =
      typeof window !== "undefined" &&
      window.sessionStorage.getItem("synozur.constellation.completedAt") !== null;
    if (
      step === "complete" &&
      allSeen &&
      !completionFiredRef.current &&
      !sessionLatched
    ) {
      completionFiredRef.current = true;
      let completionId: string;
      try {
        const existing = window.sessionStorage.getItem("synozur.constellation.completionId");
        completionId = existing ?? (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
        window.sessionStorage.setItem("synozur.constellation.completionId", completionId);
        window.sessionStorage.setItem(
          "synozur.constellation.completedAt",
          new Date().toISOString(),
        );
      } catch {
        completionId = `${Date.now()}-${Math.random()}`;
      }
      emitDemoEvent(
        { kind: "demo_completed_full", completionId },
        { app: "constellation", depth: "full" },
      );
    }
  }, [step]);

  function go(next: DemoStepId) {
    emitDemoEvent({ kind: "step_completed", step }, { app: "constellation" });
    setStep(next);
    const params = new URLSearchParams(search);
    params.set("step", next);
    const base = location.split("?")[0];
    navigate(`${base}?${params.toString()}`, { replace: false });
    // Scroll the demo into view rather than the top of the page so the
    // header stays visible as the visitor moves through steps.
    if (typeof window !== "undefined") {
      const el = document.getElementById("constellation-demo-stage");
      if (el) {
        const top = el.getBoundingClientRect().top + window.scrollY - 80;
        window.scrollTo({ top, behavior: "smooth" });
      }
    }
  }

  const currentIndex = useMemo(() => STEP_ORDER.indexOf(step), [step]);

  return (
    <section
      id="constellation-demo-stage"
      className="py-16 md:py-20 bg-card border-t border-border"
      data-testid="constellation-demo"
    >
      <div className="container mx-auto px-4 max-w-5xl">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-widest text-primary mb-2">
              Try it · sandboxed
            </p>
            <h2 className="text-3xl md:text-4xl font-bold">
              Walk through Constellation, no booking required
            </h2>
            <p className="text-muted-foreground mt-2 max-w-2xl">
              Four moments, fictional client data, real product behaviour. Takes about
              two minutes.
            </p>
          </div>
        </div>

        <ol
          className="mb-8 flex flex-wrap gap-2"
          aria-label="Demo progress"
          data-testid="constellation-demo-stepper"
        >
          {DEMO_STEPS.filter((s) => s.id !== "complete").map((s, idx) => {
            const isActive = s.id === step;
            const isDone = idx < currentIndex || step === "complete";
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => go(s.id)}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm border transition-colors ${
                    isActive
                      ? "border-primary bg-primary/10 text-primary"
                      : isDone
                        ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300 hover:border-emerald-500/50"
                        : "border-border bg-background text-muted-foreground hover:border-primary/40"
                  }`}
                  data-testid={`constellation-demo-step-${s.id}`}
                  aria-current={isActive ? "step" : undefined}
                >
                  <span
                    className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
                      isDone
                        ? "bg-emerald-500/20 text-emerald-300"
                        : isActive
                          ? "bg-primary/20"
                          : "bg-muted"
                    }`}
                    aria-hidden="true"
                  >
                    {isDone ? <CheckCircle2 className="h-3 w-3" /> : idx + 1}
                  </span>
                  {s.short}
                </button>
              </li>
            );
          })}
        </ol>

        <div className="rounded-3xl border border-border bg-background/50 p-5 md:p-8">
          {step === "dashboard" && <DemoDashboard onContinue={() => go("narrative")} />}
          {step === "narrative" && <DemoNarrative onContinue={() => go("risk")} />}
          {step === "risk" && <DemoRisk onContinue={() => go("outlook")} />}
          {step === "outlook" && <DemoOutlook onContinue={() => go("complete")} />}
          {step === "complete" && <DemoComplete onRestart={() => go("dashboard")} />}
        </div>
      </div>
    </section>
  );
}
