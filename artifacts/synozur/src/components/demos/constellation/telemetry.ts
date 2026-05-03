import type { DemoStepId } from "@/data/constellation-demo-seed";

// Client-side telemetry helpers for the Constellation demo. Two channels:
//   1. GA4 / Meta / LinkedIn via the existing dataLayer that
//      `components/analytics.tsx` boots once consent is granted.
//   2. A POST to /api/demos/constellation/event so we have a server-side
//      record even when ad-blockers strip the GA4 tag. The server handler
//      logs the event and (best-effort) hands it to the HubSpot worker if
//      a contact email is in scope.
//
// All emitters are fire-and-forget and never throw — telemetry must not
// be able to break the demo experience.

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

type DataLayerWindow = Window &
  typeof globalThis & {
    dataLayer?: Array<Record<string, unknown>>;
  };

export type DemoEvent =
  | { kind: "demo_started"; step: DemoStepId }
  | { kind: "step_viewed"; step: DemoStepId }
  | { kind: "step_completed"; step: DemoStepId }
  | { kind: "outlook_simulated_send" }
  | { kind: "demo_completed_full"; completionId: string };

interface EmitOptions {
  app: "constellation";
  depth?: "partial" | "full";
}

export function emitDemoEvent(event: DemoEvent, options: EmitOptions): void {
  // GA4 + dataLayer mirror. The flat shape (kind/step/depth/app) keeps the
  // GA4 and Tag Manager event-builder configuration trivial — every demo
  // event shows up under a single event name with consistent parameters.
  try {
    const w = window as DataLayerWindow;
    if (!w.dataLayer) w.dataLayer = [];
    const step = "step" in event ? event.step : null;
    w.dataLayer.push({
      event: "synozur_application_demo_requested",
      app: options.app,
      depth: options.depth ?? "partial",
      kind: event.kind,
      step,
      ...("completionId" in event ? { completion_id: event.completionId } : {}),
    });
  } catch {
    /* swallow */
  }

  // Server mirror. The contact identity is resolved server-side from the
  // authed session cookie (`credentials: "include"` ensures the cookie is
  // sent); we deliberately do NOT include any client-side email so the
  // endpoint can't be tricked into emitting HubSpot timeline events for
  // arbitrary addresses.
  try {
    void fetch(`${BASE_PATH}/api/demos/constellation/event`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: event.kind,
        app: options.app,
        depth: options.depth ?? "partial",
        step: "step" in event ? event.step : null,
        path: typeof window !== "undefined" ? window.location.pathname + window.location.search : null,
        ts: new Date().toISOString(),
        ...("completionId" in event ? { completionId: event.completionId } : {}),
      }),
      // Use keepalive so the final "demo_completed_full" event survives a
      // tab close.
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* swallow */
  }
}
