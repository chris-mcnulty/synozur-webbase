import { CheckCircle2, AlertTriangle, AlertCircle, Clock, ArrowRight } from "lucide-react";
import {
  constellationDemoSeed,
  type DemoDeliverable,
} from "@/data/constellation-demo-seed";

const STATUS_META: Record<DemoDeliverable["status"], {
  label: string;
  className: string;
  Icon: typeof CheckCircle2;
}> = {
  on_track: {
    label: "On track",
    className: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
    Icon: CheckCircle2,
  },
  complete: {
    label: "Complete",
    className: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
    Icon: CheckCircle2,
  },
  at_risk: {
    label: "At risk",
    className: "bg-amber-500/10 text-amber-300 border-amber-500/30",
    Icon: AlertTriangle,
  },
  slipping: {
    label: "Slipping",
    className: "bg-rose-500/10 text-rose-300 border-rose-500/30",
    Icon: AlertCircle,
  },
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function DemoDashboard({ onContinue }: { onContinue: () => void }) {
  const seed = constellationDemoSeed;
  const counts = {
    onTrack: seed.deliverables.filter((d) => d.status === "on_track" || d.status === "complete").length,
    atRisk: seed.deliverables.filter((d) => d.status === "at_risk").length,
    slipping: seed.deliverables.filter((d) => d.status === "slipping").length,
  };
  const usd = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  return (
    <div className="space-y-6" data-testid="constellation-demo-dashboard">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-primary mb-1">
            Sandboxed sample · {seed.client.name} · {seed.client.industry}
          </p>
          <h3 className="text-2xl md:text-3xl font-bold">{seed.engagement.name}</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {seed.engagement.phase} · Week of {fmtDate(seed.weekOf)} · Lead {seed.engagement.leadConsultant}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div className="rounded-lg border border-border bg-card px-3 py-2 min-w-[5rem] text-center">
            <div className="text-xs text-muted-foreground">On track</div>
            <div className="text-xl font-semibold text-emerald-300">{counts.onTrack}</div>
          </div>
          <div className="rounded-lg border border-border bg-card px-3 py-2 min-w-[5rem] text-center">
            <div className="text-xs text-muted-foreground">At risk</div>
            <div className="text-xl font-semibold text-amber-300">{counts.atRisk}</div>
          </div>
          <div className="rounded-lg border border-border bg-card px-3 py-2 min-w-[5rem] text-center">
            <div className="text-xs text-muted-foreground">Slipping</div>
            <div className="text-xl font-semibold text-rose-300">{counts.slipping}</div>
          </div>
        </div>
      </header>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-3 text-xs uppercase tracking-widest text-muted-foreground border-b border-border bg-background/40">
          Deliverables
        </div>
        <ul className="divide-y divide-border">
          {seed.deliverables.map((d) => {
            const meta = STATUS_META[d.status];
            const { Icon } = meta;
            return (
              <li key={d.id} className="px-5 py-4 flex flex-wrap items-center gap-4">
                <div className="flex-1 min-w-[14rem]">
                  <div className="font-medium">{d.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {d.owner} · due {fmtDate(d.dueOn)}
                  </div>
                </div>
                <div className="w-40">
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${d.percentComplete}%` }}
                      aria-label={`${d.percentComplete}% complete`}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{d.percentComplete}%</div>
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${meta.className}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {meta.label}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
            Financials
          </div>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Contract</dt>
            <dd className="text-right font-medium">{usd(seed.financials.contractValue)}</dd>
            <dt className="text-muted-foreground">Burned to date</dt>
            <dd className="text-right font-medium">{usd(seed.financials.burnedToDate)}</dd>
            <dt className="text-muted-foreground">Forecast at complete</dt>
            <dd className="text-right font-medium">{usd(seed.financials.forecastAtComplete)}</dd>
            <dt className="text-muted-foreground">Margin</dt>
            <dd className="text-right font-medium">{seed.financials.marginPct.toFixed(1)}%</dd>
          </dl>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
            Recent activity
          </div>
          <ul className="space-y-3 text-sm">
            {seed.recentEvents.slice(0, 4).map((e) => (
              <li key={e.ts} className="flex gap-2.5">
                <Clock className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(e.ts).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </div>
                  <div>{e.summary}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onContinue}
          className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
          data-testid="constellation-demo-dashboard-next"
        >
          See this week's AI narrative
          <ArrowRight className="ml-2 h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
