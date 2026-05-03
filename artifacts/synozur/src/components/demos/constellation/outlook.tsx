import { useState } from "react";
import { ArrowRight, Mail, CheckCircle2, Loader2 } from "lucide-react";
import { constellationDemoSeed } from "@/data/constellation-demo-seed";
import { emitDemoEvent } from "./telemetry";

export function DemoOutlook({ onContinue }: { onContinue: () => void }) {
  const seed = constellationDemoSeed;
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");

  const subject = `Weekly status — ${seed.engagement.name} (week of ${new Date(
    seed.weekOf,
  ).toLocaleDateString("en-US", { month: "short", day: "numeric" })})`;
  const body = `Hi ${seed.engagement.executiveSponsor.split(",")[0]},\n\nWeek-of-${seed.weekOf} update for ${seed.client.name}:\n\n• 2 deliverables complete; 3 on track; 1 slipping (Underwriter Copilot prototype).\n• Highest-priority risk: Copilot slip ~6 business days. Mitigation in motion — Risk persona working session this week.\n• Forecast at complete tracking $${(seed.financials.forecastAtComplete / 1000).toFixed(0)}K against $${(seed.financials.contractValue / 1000).toFixed(0)}K contract; margin ${seed.financials.marginPct.toFixed(1)}%.\n\nFull narrative + drill-downs in Constellation: app.synozur.com/constellation/anomaly-bank\n\n— ${seed.engagement.leadConsultant}`;

  function handleSend() {
    if (status !== "idle") return;
    setStatus("sending");
    emitDemoEvent(
      { kind: "outlook_simulated_send" },
      { app: "constellation", depth: "partial" },
    );
    // Simulated send — no real network call.
    window.setTimeout(() => setStatus("sent"), 900);
  }

  return (
    <div className="space-y-6" data-testid="constellation-demo-outlook">
      <header>
        <p className="text-xs uppercase tracking-widest text-primary mb-1 inline-flex items-center gap-2">
          <Mail className="h-3.5 w-3.5" /> Send to Outlook
        </p>
        <h3 className="text-2xl md:text-3xl font-bold">
          One click to the sponsor's inbox — no copy-paste
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Constellation drafts the email from the same data you just saw. This is a
          simulated send — no real message will leave the sandbox.
        </p>
      </header>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-background/40 text-xs text-muted-foreground space-y-1">
          <div>
            <span className="font-medium text-foreground">To:</span>{" "}
            {seed.engagement.executiveSponsor}
          </div>
          <div>
            <span className="font-medium text-foreground">Subject:</span> {subject}
          </div>
        </div>
        <pre className="px-5 py-4 text-sm whitespace-pre-wrap font-sans leading-relaxed">
          {body}
        </pre>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {status === "sent" && (
          <span className="inline-flex items-center gap-2 text-sm text-emerald-300">
            <CheckCircle2 className="h-4 w-4" /> Simulated send complete
          </span>
        )}
        <button
          type="button"
          onClick={handleSend}
          disabled={status !== "idle"}
          className="inline-flex h-11 items-center justify-center rounded-md border border-border bg-background px-6 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-60"
          data-testid="constellation-demo-outlook-send"
        >
          {status === "sending" ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending…
            </>
          ) : status === "sent" ? (
            <>
              <CheckCircle2 className="mr-2 h-4 w-4" /> Sent
            </>
          ) : (
            <>
              <Mail className="mr-2 h-4 w-4" /> Send to Outlook (sandbox)
            </>
          )}
        </button>
        <button
          type="button"
          onClick={onContinue}
          disabled={status !== "sent"}
          className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:opacity-60"
          data-testid="constellation-demo-outlook-next"
        >
          Wrap up
          <ArrowRight className="ml-2 h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
