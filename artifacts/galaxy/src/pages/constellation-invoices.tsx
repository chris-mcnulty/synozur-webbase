import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { PortalShell } from "@/components/portal-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Receipt, ExternalLink } from "lucide-react";
import { constellationApi, type CInvoice } from "@/lib/constellation-api";

const CONSTELLATION_BASE = (import.meta.env.VITE_CONSTELLATION_BASE_URL ?? "").replace(/\/$/, "");

function paymentStatusVariant(s: string): "default" | "secondary" | "destructive" | "outline" {
  if (s === "paid") return "secondary";
  if (s === "overdue") return "destructive";
  if (s === "outstanding") return "default";
  return "outline";
}

function fmt(amount: number | null): string {
  if (amount === null) return "—";
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(amount);
}

function InvoiceRow({ invoice }: { invoice: CInvoice }) {
  const pdfUrl = invoice.pdfDownloadUrl
    ? `${CONSTELLATION_BASE}${invoice.pdfDownloadUrl}`
    : null;

  return (
    <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          {invoice.glInvoiceNumber && (
            <span className="text-xs font-mono text-muted-foreground">{invoice.glInvoiceNumber}</span>
          )}
          <Badge variant={paymentStatusVariant(invoice.paymentStatus)} className="text-xs capitalize">
            {invoice.paymentStatus}
          </Badge>
        </div>
        <div className="font-semibold text-sm">
          {new Date(invoice.startDate).toLocaleDateString()} – {new Date(invoice.endDate).toLocaleDateString()}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
          {invoice.paymentTerms && <span>{invoice.paymentTerms}</span>}
          {invoice.paymentDate && (
            <span>Paid {new Date(invoice.paymentDate).toLocaleDateString()}</span>
          )}
          {invoice.finalizedAt && !invoice.paymentDate && (
            <span>Issued {new Date(invoice.finalizedAt).toLocaleDateString()}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-4 shrink-0">
        <div className="text-right">
          <div className="font-semibold text-base">{fmt(invoice.totalAmount)}</div>
          {invoice.taxAmount != null && (
            <div className="text-xs text-muted-foreground">incl. {fmt(invoice.taxAmount)} tax</div>
          )}
        </div>
        {pdfUrl && (
          <a
            href={pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-400 hover:text-violet-300 transition-colors"
            aria-label="Download invoice PDF"
          >
            <ExternalLink size={13} />
            PDF
          </a>
        )}
      </div>
    </div>
  );
}

export default function ConstellationInvoicesPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["constellation-invoices"],
    queryFn: () => constellationApi.listInvoices({ limit: 100 }),
    staleTime: 90_000,
  });

  const items = data?.items ?? [];

  return (
    <PortalShell>
      <main className="max-w-4xl mx-auto px-6 py-10 space-y-8">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <Link href="/projects">
              <a className="text-xs text-muted-foreground hover:underline">← Projects</a>
            </Link>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mt-3 mb-1">Constellation</p>
            <h1 className="text-2xl font-semibold tracking-tight">Invoices</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Billing history for your engagement.
            </p>
          </div>
        </div>

        {isError && (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            {error instanceof Error ? error.message : "Could not load invoice data. Please try again later."}
          </div>
        )}

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        ) : !isError && items.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              <Receipt size={32} className="mx-auto mb-3 opacity-30" />
              No invoices found yet.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3" data-testid="constellation-invoices-list">
            {items.map((inv) => <InvoiceRow key={inv.id} invoice={inv} />)}
          </div>
        )}
      </main>
    </PortalShell>
  );
}
