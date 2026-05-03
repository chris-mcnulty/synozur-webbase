import { ArrowRight, AlertCircle, TrendingDown, Lightbulb } from "lucide-react";
import { constellationDemoSeed } from "@/data/constellation-demo-seed";

export function DemoRisk({ onContinue }: { onContinue: () => void }) {
  const seed = constellationDemoSeed;
  const risk = seed.risks.find((r) => r.id === "r-copilot-slip")!;
  const impacted = risk.impactedDeliverableIds
    .map((id) => seed.deliverables.find((d) => d.id === id))
    .filter((d): d is NonNullable<typeof d> => d !== undefined);

  return (
    <div className="space-y-6" data-testid="constellation-demo-risk">
      <header>
        <p className="text-xs uppercase tracking-widest text-primary mb-1 inline-flex items-center gap-2">
          <AlertCircle className="h-3.5 w-3.5" /> Risk drill-down
        </p>
        <h3 className="text-2xl md:text-3xl font-bold">{risk.title}</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Surfaced{" "}
          {new Date(risk.surfacedOn).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}{" "}
          · severity {risk.severity} · trend {risk.trend}
        </p>
      </header>

      <div className="grid md:grid-cols-2 gap-5">
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-5">
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-rose-300 mb-3">
            <TrendingDown className="h-3.5 w-3.5" /> Why Constellation flagged this
          </div>
          <p className="text-sm leading-relaxed">{risk.rationale}</p>
        </div>
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-emerald-300 mb-3">
            <Lightbulb className="h-3.5 w-3.5" /> Recommended next move
          </div>
          <p className="text-sm leading-relaxed">{risk.recommendation}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
          Impacted deliverables
        </div>
        <ul className="space-y-2 text-sm">
          {impacted.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3">
              <span className="font-medium">{d.name}</span>
              <span className="text-muted-foreground text-xs">
                {d.owner} · due{" "}
                {new Date(d.dueOn).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}{" "}
                · {d.percentComplete}%
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onContinue}
          className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
          data-testid="constellation-demo-risk-next"
        >
          Send this update to the sponsor
          <ArrowRight className="ml-2 h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
