import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Coins, Loader2 } from "lucide-react";
import {
  getGetChapterAudioCostsQueryKey,
  getListChapterAudioQueryKey,
  useEstimateChapterAudio,
  useGetChapterAudioCosts,
  useSaveChapterAudioPricing,
  type ChapterAudioCurrencyCost,
  type ChapterAudioEstimate,
  type ChapterAudioJobCost,
  type ChapterAudioPricing,
  type ChapterAudioUsage,
  type ChapterAudioUsageGroup,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

const MAX_TEXT = 200000;
const MAX_NOTES = 100000;
const DEBOUNCE_MS = 750;

export const COST_DISCLAIMER =
  "Estimates cover speech synthesis only. Hosting and storage are excluded, and retries may increase costs.";

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 4 }).format(amount);
  } catch {
    return `${amount.toFixed(4)} ${currency}`;
  }
}
const n = (v: number) => v.toLocaleString();

function errText(e: unknown, fallback: string): string {
  const d = (e as { data?: { error?: unknown } } | null)?.data;
  if (d && typeof d.error === "string") return d.error;
  return e instanceof Error && e.message ? e.message : fallback;
}

/* ---------------- Live estimate in the narration form ---------------- */

export function NarrationEstimate({ text, notes, appendNotes, voice, disabled, rateId }: {
  text: string; notes: string; appendNotes: boolean; voice: string; disabled?: boolean; rateId: string | null;
}) {
  const estimate = useEstimateChapterAudio();
  const mutateRef = useRef(estimate.mutateAsync);
  mutateRef.current = estimate.mutateAsync;
  const seq = useRef(0);
  const [result, setResult] = useState<ChapterAudioEstimate | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const empty = !text.trim();
  const overLimit = text.length > MAX_TEXT || notes.length > MAX_NOTES;

  useEffect(() => {
    const id = ++seq.current;
    setResult(null);
    setError(null);
    if (empty || overLimit || !voice || disabled) { setPending(false); return; }
    setPending(true);
    const t = window.setTimeout(() => {
      mutateRef.current({ data: { text, notes: notes || undefined, appendNotes, voice } })
        .then((r) => { if (id === seq.current) { setResult(r); setPending(false); } })
        .catch((e) => { if (id === seq.current) { setError(errText(e, "Estimate failed.")); setPending(false); } });
    }, DEBOUNCE_MS);
    return () => { ++seq.current; window.clearTimeout(t); };
  }, [text, notes, appendNotes, voice, empty, overLimit, disabled, rateId]);

  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2.5 text-sm" aria-live="polite" data-testid="panel-estimate">
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
        <Coins className="h-3.5 w-3.5" /> Speech cost estimate
      </p>
      {empty ? (
        <p className="mt-1 text-muted-foreground">Add chapter text to see an estimate.</p>
      ) : overLimit ? (
        <p className="mt-1 text-destructive">Text exceeds the estimate limit.</p>
      ) : error ? (
        <p className="mt-1 text-destructive" data-testid="text-estimate-error">{error}</p>
      ) : pending || !result ? (
        <p className="mt-1 flex items-center gap-1.5 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Estimating…</p>
      ) : (
        <div className="mt-1 flex flex-wrap items-baseline gap-x-5 gap-y-1 tabular-nums" data-testid="text-estimate">
          <span><span className="text-muted-foreground">Source </span>{n(result.sourceCharacters)} chars</span>
          <span><span className="text-muted-foreground">Est. billable </span>{n(result.billableCharacters)} chars</span>
          {result.estimatedCost != null && result.currency ? (
            <span className="font-semibold">~{money(result.estimatedCost, result.currency)}</span>
          ) : (
            <span className="text-amber-700 dark:text-amber-300">Cost estimate unavailable</span>
          )}
        </div>
      )}
      <p className="mt-1.5 text-[11px] text-muted-foreground">{COST_DISCLAIMER}</p>
    </div>
  );
}

/* ---------------- Per-job cost details ---------------- */

function CostLines({ costs }: { costs: ChapterAudioCurrencyCost[] }) {
  if (costs.length === 0) return <span className="text-muted-foreground">No priced requests</span>;
  return (
    <span className="flex flex-wrap gap-x-3">
      {costs.map((c) => (
        <span key={c.currency}>
          ~{money(c.amount, c.currency)}
          {c.uncertainAmount > 0 && <span className="text-amber-700 dark:text-amber-300"> (includes {money(c.uncertainAmount, c.currency)} uncertain)</span>}
        </span>
      ))}
    </span>
  );
}

export function JobCostDetails({ cost, jobId }: { cost?: ChapterAudioJobCost; jobId: string }) {
  if (!cost) return null;
  const u = cost.usage;
  const est = cost.initialEstimate;
  return (
    <details className="mt-3 rounded-md border border-border/70 bg-muted/20 text-xs" data-testid={`cost-job-${jobId}`}>
      <summary className="cursor-pointer select-none px-3 py-1.5 text-muted-foreground hover:text-foreground">
        Estimated speech cost
      </summary>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-3 pb-2.5 pt-1 tabular-nums">
        <dt className="text-muted-foreground">Original estimate</dt>
        <dd>
          {est
            ? est.estimatedCost != null && est.currency
              ? `~${money(est.estimatedCost, est.currency)} · ${n(est.billableCharacters)} chars`
              : `Cost estimate unavailable · ${n(est.billableCharacters)} chars`
            : "Not recorded"}
        </dd>
        <dt className="text-muted-foreground">Submitted characters</dt><dd>{n(u.submittedCharacters)}</dd>
        <dt className="text-muted-foreground">Attempts</dt><dd>{n(u.attempts)}</dd>
        <dt className="text-muted-foreground">Reused sections</dt><dd>{n(u.reusedSections)}</dd>
        <dt className="text-muted-foreground">Est. submitted-request cost</dt><dd><CostLines costs={u.costs} /></dd>
      </dl>
      <UsageWarnings usage={u} legacy={cost.legacyUsageGap} />
      <p className="px-3 pb-2 text-[11px] text-muted-foreground">Estimates, not actual charges. {COST_DISCLAIMER}</p>
    </details>
  );
}

function UsageWarnings({ usage, legacy }: { usage: ChapterAudioUsage; legacy?: boolean }) {
  const w: string[] = [];
  if (usage.uncertainCharacters > 0) w.push(`${n(usage.uncertainCharacters)} characters have uncertain outcomes and may or may not be billed.`);
  if (usage.unpricedCharacters > 0) w.push(`${n(usage.unpricedCharacters)} characters were submitted with no rate configured and are unpriced.`);
  if (legacy) w.push("Usage before cost tracking began is not recorded for this narration.");
  if (!w.length) return null;
  return (
    <ul className="space-y-0.5 px-3 pb-2 text-amber-700 dark:text-amber-300">
      {w.map((t) => <li key={t} className="flex gap-1.5"><AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />{t}</li>)}
    </ul>
  );
}

/* ---------------- Administrator panel ---------------- */

function currentMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function CostAdminPanel({ pricing }: { pricing: ChapterAudioPricing }) {
  if (!pricing.canManageRates) return null;
  return (
    <section className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]" data-testid="section-cost-admin">
      <RateSettings pricing={pricing} />
      <MonthlySummary />
    </section>
  );
}

function RateSettings({ pricing }: { pricing: ChapterAudioPricing }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const save = useSaveChapterAudioPricing();
  const rate = pricing.currentRate;
  const [perMillion, setPerMillion] = useState("");
  const [currency, setCurrency] = useState(rate?.currency ?? "");
  const [from, setFrom] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const pm = Number(perMillion);
  const validPm = perMillion.trim() !== "" && Number.isFinite(pm) && pm >= 0 && pm <= 1000000;
  const validCur = /^[A-Z]{3}$/.test(currency);
  const fromDate = from ? new Date(from) : null;
  const validFrom = !from || (fromDate !== null && !isNaN(fromDate.getTime()));
  const ok = validPm && validCur && validFrom;

  const submit = () => {
    setErr(null);
    const effectiveFrom = (fromDate && from ? fromDate : new Date()).toISOString();
    save.mutate({ data: { perMillion: pm, currency, effectiveFrom } }, {
      onSuccess: () => {
        toast({ title: "Rate saved", description: "Applies to future attempts only." });
        setPerMillion(""); setFrom("");
        void qc.invalidateQueries({ queryKey: getListChapterAudioQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetChapterAudioCostsQueryKey() });
      },
      onError: (e) => setErr(errText(e, "Could not save rate.")),
    });
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <header>
        <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Administrators only</p>
        <h2 className="text-lg font-semibold mt-1">Speech rate</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Enter the per-million-character rate for your Azure Speech resource, region and contract, verified from your Azure pricing or agreement. No default is assumed. Each save creates a new version that applies to future attempts; past usage is never repriced.
        </p>
      </header>
      <p className="text-sm tabular-nums" data-testid="text-current-rate">
        {rate
          ? <>Current: <strong>{money(rate.perMillion, rate.currency)}</strong> per 1M characters, effective {new Date(rate.effectiveFrom).toLocaleString()}</>
          : <span className="text-amber-700 dark:text-amber-300">No rate configured. Costs show as unavailable.</span>}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="rate-pm">Per 1M characters</Label>
          <Input id="rate-pm" inputMode="decimal" value={perMillion} onChange={(e) => setPerMillion(e.target.value)} aria-invalid={perMillion !== "" && !validPm} data-testid="input-rate-per-million" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rate-cur">Currency (ISO)</Label>
          <Input id="rate-cur" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} placeholder="USD" aria-invalid={currency !== "" && !validCur} data-testid="input-rate-currency" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="rate-from">Effective from (blank = now)</Label>
          <Input id="rate-from" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="input-rate-effective" />
        </div>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <Button onClick={submit} disabled={!ok || save.isPending} data-testid="button-save-rate">
        {save.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Save new rate version
      </Button>
    </div>
  );
}

function MonthlySummary() {
  const [month, setMonth] = useState(currentMonth());
  const valid = /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
  const params = { month };
  const q = useGetChapterAudioCosts(params, { query: { enabled: valid, queryKey: getGetChapterAudioCostsQueryKey(params), refetchInterval: 10000 } });
  const d = q.data;

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Monthly usage, UTC</p>
          <h2 className="text-lg font-semibold mt-1">Estimated speech spend</h2>
        </div>
        <div className="space-y-1">
          <Label htmlFor="cost-month" className="text-xs">Month</Label>
          <Input id="cost-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40" data-testid="input-cost-month" />
        </div>
      </header>
      {!valid ? (
        <p className="text-sm text-muted-foreground">Choose a month.</p>
      ) : q.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : q.isError || !d ? (
        <div className="text-sm">
          <p className="text-destructive">{errText(q.error, "Could not load monthly costs.")}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => void q.refetch()}>Retry</Button>
        </div>
      ) : (
        <>
          <UsageSummary usage={d.usage} />
          <UsageWarnings usage={d.usage} />
          <div className="grid gap-4 md:grid-cols-2">
            <GroupTable title="By user" groups={d.byUser} />
            <GroupTable title="By voice" groups={d.byVoice} />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Tracking began {new Date(d.coverageStartedAt).toLocaleString()}; earlier usage is not included. Currencies are never combined. Usage metadata remains after audio is deleted. These are estimates, not actual charges. {COST_DISCLAIMER}
          </p>
        </>
      )}
    </div>
  );
}

function UsageSummary({ usage: u }: { usage: ChapterAudioUsage }) {
  return (
    <div className="space-y-3">
      {u.costs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No priced usage this month.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {u.costs.map((c) => (
            <div key={c.currency} className="rounded-md border border-border p-3 tabular-nums" data-testid={`cost-total-${c.currency}`}>
              <p className="text-2xl font-semibold">~{money(c.amount, c.currency)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Retries {money(c.retryAmount, c.currency)} · Samples {money(c.sampleAmount, c.currency)}
                {c.uncertainAmount > 0 && <> · Uncertain {money(c.uncertainAmount, c.currency)}</>}
              </p>
            </div>
          ))}
        </div>
      )}
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs tabular-nums">
        {[
          ["Chapters", u.chapterCount], ["Attempts", u.attempts], ["Submitted chars", u.submittedCharacters],
          ["Unpriced chars", u.unpricedCharacters], ["Retry chars", u.retryCharacters], ["Sample attempts", u.sampleAttempts],
          ["Rejected chars", u.rejectedCharacters], ["Reused sections", u.reusedSections],
        ].map(([k, v]) => (
          <div key={k as string}><dt className="text-muted-foreground">{k}</dt><dd className="font-medium">{n(v as number)}</dd></div>
        ))}
      </dl>
    </div>
  );
}

function GroupTable({ title, groups }: { title: string; groups: ChapterAudioUsageGroup[] }) {
  return (
    <div>
      <h3 className="text-sm font-medium mb-1.5">{title}</h3>
      {groups.length === 0 ? <p className="text-xs text-muted-foreground">No usage.</p> : (
        <table className="w-full text-xs tabular-nums">
          <thead><tr className="text-left text-muted-foreground"><th className="font-normal py-1">Name</th><th className="font-normal">Chars</th><th className="font-normal">Est. cost</th></tr></thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.id} className="border-t border-border/60 align-top">
                <td className="py-1 pr-2 break-all">{g.label}</td>
                <td className="pr-2">{n(g.usage.submittedCharacters)}{g.usage.unpricedCharacters > 0 && <span className="block text-amber-700 dark:text-amber-300">{n(g.usage.unpricedCharacters)} unpriced</span>}</td>
                <td><CostLines costs={g.usage.costs} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
