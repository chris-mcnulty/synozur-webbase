import { Link } from "wouter";
import { CheckCircle2, ExternalLink, RotateCcw } from "lucide-react";

export function DemoComplete({ onRestart }: { onRestart: () => void }) {
  return (
    <div
      className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-8 md:p-12 text-center space-y-5"
      data-testid="constellation-demo-complete"
    >
      <CheckCircle2 className="h-12 w-12 text-emerald-300 mx-auto" />
      <div>
        <h3 className="text-2xl md:text-3xl font-bold mb-2">
          That's the Constellation loop
        </h3>
        <p className="text-base text-muted-foreground max-w-2xl mx-auto">
          Live data from delivery, financials, and Microsoft 365 — synthesized into a
          status the executive sponsor actually wants to read, with every risk and
          recommendation traceable back to the source. Ready to see it on your data?
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/contact?topic=constellation"
          className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
          data-testid="constellation-demo-complete-cta"
        >
          Talk to us about Constellation
        </Link>
        <a
          href="https://scdp.synozur.com"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-11 items-center justify-center rounded-md border border-border bg-background px-6 text-sm font-medium hover:bg-muted transition-colors"
        >
          Visit the product site
          <ExternalLink className="ml-2 h-4 w-4" />
        </a>
        <button
          type="button"
          onClick={onRestart}
          className="inline-flex h-11 items-center justify-center rounded-md border border-transparent px-4 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          Restart the demo
        </button>
      </div>
    </div>
  );
}
