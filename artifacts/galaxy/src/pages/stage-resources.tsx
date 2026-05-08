import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  useGetPortalMe,
  useListPortalDocuments,
  type PortalForbiddenReason,
} from "@workspace/api-client-react";
import { PortalShell } from "@/components/portal-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { PlaceholderCard, StageSection } from "@/components/lifecycle";
import NotCustomer from "./not-customer";
import { constellationApi, type CInvoice } from "@/lib/constellation-api";
import { ArrowRight, FileText, Receipt } from "lucide-react";

function fmtCurrency(amount: number | null): string {
  if (amount === null) return "—";
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(
    amount,
  );
}

function isPending(invoice: CInvoice): boolean {
  return invoice.paymentStatus === "outstanding" || invoice.paymentStatus === "overdue";
}

export default function StageResourcesPage() {
  const meQuery = useGetPortalMe();
  const docsQuery = useListPortalDocuments({ pageSize: 5 });
  const invoicesQuery = useQuery({
    queryKey: ["constellation-invoices"],
    queryFn: () => constellationApi.listInvoices({ limit: 100 }),
    staleTime: 90_000,
  });

  const forbiddenReason: PortalForbiddenReason | null = (() => {
    const err = (meQuery.error ?? docsQuery.error) as
      | { status?: number; data?: { reason?: PortalForbiddenReason } }
      | null
      | undefined;
    if (err && err.status === 403 && err.data?.reason) return err.data.reason;
    return null;
  })();
  if (forbiddenReason) return <NotCustomer reason={forbiddenReason} />;

  const docs = docsQuery.data?.items ?? [];
  const invoices = invoicesQuery.data?.items ?? [];
  const pendingInvoices = invoices.filter(isPending).slice(0, 3);
  const pendingTotal = invoices.filter(isPending).reduce(
    (sum, inv) => sum + (inv.totalAmount ?? 0),
    0,
  );

  return (
    <PortalShell>
      <main className="max-w-5xl mx-auto px-6 py-10 space-y-12">
        <header className="space-y-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Synozur portal
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Resources</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Documents your team is sharing with you, plus quick links to billing.
            Anything that doesn't fit a lifecycle stage lives here.
          </p>
        </header>

        <StageSection
          title="Recent documents"
          action={
            <Link href="/documents">
              {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
              <a className="text-xs font-medium text-violet-400 hover:text-violet-300">
                All documents →
              </a>
            </Link>
          }
        >
          {docsQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full rounded-lg" />
              <Skeleton className="h-14 w-full rounded-lg" />
            </div>
          ) : docs.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                <FileText size={28} className="mx-auto mb-2 opacity-30" />
                No documents shared yet.
              </CardContent>
            </Card>
          ) : (
            <ul className="space-y-2">
              {docs.slice(0, 5).map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="text-sm font-medium truncate">{d.filename}</div>
                    <div className="text-xs text-muted-foreground">
                      {d.lastModifiedAt
                        ? new Date(d.lastModifiedAt).toLocaleDateString()
                        : "—"}
                    </div>
                  </div>
                  <Link href="/documents">
                    {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
                    <a className="text-xs font-medium text-violet-400 hover:text-violet-300 shrink-0 inline-flex items-center gap-1">
                      Open <ArrowRight size={11} />
                    </a>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </StageSection>

        <StageSection
          title="Shared workspace"
          action={
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
              To be defined
            </Badge>
          }
        >
          <PlaceholderCard
            title="General shared documents area"
            description="A common space for shared reference materials, templates, and reusable artifacts that span engagements. Contents and structure to be confirmed with your account team."
            status="TBD"
          />
        </StageSection>

        <StageSection
          title="Billing"
          app="Constellation"
          action={
            <Link href="/invoices">
              {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
              <a className="text-xs font-medium text-violet-400 hover:text-violet-300">
                All invoices →
              </a>
            </Link>
          }
        >
          {invoicesQuery.isLoading ? (
            <Skeleton className="h-20 w-full rounded-xl" />
          ) : pendingInvoices.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                <Receipt size={28} className="mx-auto mb-2 opacity-30" />
                No pending invoices.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              <div className="rounded-xl border border-border bg-card p-4 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    Pending balance
                  </div>
                  <div className="text-2xl font-semibold mt-0.5">
                    {fmtCurrency(pendingTotal)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">
                    {pendingInvoices.length} invoice
                    {pendingInvoices.length !== 1 ? "s" : ""} outstanding
                  </div>
                </div>
              </div>
              <ul className="space-y-2">
                {pendingInvoices.map((inv) => (
                  <li
                    key={inv.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="text-sm font-medium truncate">
                        {inv.glInvoiceNumber ?? "Invoice"} ·{" "}
                        {new Date(inv.startDate).toLocaleDateString()} –{" "}
                        {new Date(inv.endDate).toLocaleDateString()}
                      </div>
                      <Badge
                        variant={
                          inv.paymentStatus === "overdue" ? "destructive" : "default"
                        }
                        className="text-[10px] capitalize"
                      >
                        {inv.paymentStatus}
                      </Badge>
                    </div>
                    <div className="text-sm font-semibold">
                      {fmtCurrency(inv.totalAmount)}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </StageSection>
      </main>
    </PortalShell>
  );
}
