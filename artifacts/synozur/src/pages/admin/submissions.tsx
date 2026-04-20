import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useUser, useClerk } from "@clerk/react";
import { ArrowLeft, Copy, Download, Loader2, LogOut, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import type { AdminFormSubmission } from "@workspace/api-zod/types";

const PAGE_SIZE = 25;
const FORM_TYPES: { value: string; label: string }[] = [
  { value: "all", label: "All forms" },
  { value: "contact", label: "Contact" },
  { value: "subscribe", label: "Subscribe" },
  { value: "start", label: "Get Started" },
];

function formatDateTime(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusBadgeClass(status: string | null | undefined): string {
  if (!status) return "bg-muted text-muted-foreground";
  if (status === "ok") return "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-200";
  if (status === "skipped") return "bg-muted text-muted-foreground";
  return "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200";
}

function isFailedStatus(status: string | null | undefined): boolean {
  return status !== "ok" && status !== "skipped";
}

export default function AdminSubmissionsList() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");

  const [formType, setFormType] = useState<string>("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AdminFormSubmission | null>(null);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);

  const resendWebhook = async (id: number) => {
    setResending(true);
    try {
      const updated = await api.resendSubmissionWebhook(id);
      setSelected(updated);
      await queryClient.invalidateQueries({ queryKey: ["admin-submissions"] });
      if (updated.webhookStatus === "ok") {
        toast({ title: "Webhook resent", description: "Delivery succeeded." });
      } else {
        toast({
          title: "Webhook still failing",
          description: updated.webhookError ?? updated.webhookStatus ?? "Unknown error",
          variant: "destructive",
        });
      }
    } catch (err) {
      toast({
        title: "Resend failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setResending(false);
    }
  };

  const copyEmail = async (email: string) => {
    try {
      await navigator.clipboard.writeText(email);
      toast({ title: "Email copied", description: email });
    } catch {
      toast({ title: "Copy failed", description: email, variant: "destructive" });
    }
  };

  const effectiveType = formType === "all" ? undefined : formType;
  const { data, isLoading } = useQuery({
    queryKey: ["admin-submissions", effectiveType, search, page],
    queryFn: () =>
      api.listSubmissions({
        formType: effectiveType,
        search: search || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["admin-submissions"] });

  const retryOne = useMutation({
    mutationFn: (id: number) => api.retrySubmission(id),
    onSuccess: (row) => {
      setRetryError(null);
      setRetryMessage(
        row.webhookStatus === "ok"
          ? `Retry succeeded for #${row.id}.`
          : `Retry for #${row.id} returned “${row.webhookStatus ?? "error"}”.`,
      );
      void invalidate();
    },
    onError: (err) => {
      setRetryMessage(null);
      setRetryError(err instanceof Error ? err.message : "Retry failed");
    },
  });

  const retryAll = useMutation({
    mutationFn: () =>
      api.retryFailedSubmissions({
        formType: effectiveType,
        search: search || undefined,
      }),
    onSuccess: (result) => {
      setRetryError(null);
      setRetryMessage(
        result.retried === 0
          ? "No failed submissions to retry."
          : `Retried ${result.retried}: ${result.succeeded} succeeded, ${result.failed} failed.`,
      );
      void invalidate();
    },
    onError: (err) => {
      setRetryMessage(null);
      setRetryError(err instanceof Error ? err.message : "Bulk retry failed");
    },
  });

  const total = data?.total ?? 0;
  const items = data?.items ?? [];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const csvHref = api.submissionsCsvUrl({
    formType: effectiveType,
    search: search || undefined,
  });

  return (
    <div className="container mx-auto px-4 py-12 max-w-6xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <Link href="/">
              <a className="inline-flex items-center hover:text-foreground" data-testid="link-back-to-events">
                <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Events
              </a>
            </Link>
          </div>
          <h1 className="text-3xl font-bold">Form Submissions</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Signed in as {user?.primaryEmailAddress?.emailAddress}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={() => retryAll.mutate()}
            disabled={retryAll.isPending}
            data-testid="button-retry-all-failed"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${retryAll.isPending ? "animate-spin" : ""}`} />
            {retryAll.isPending ? "Retrying…" : "Retry all failed"}
          </Button>
          <a href={csvHref} download data-testid="link-export-csv">
            <Button variant="outline">
              <Download className="h-4 w-4 mr-2" /> Export CSV
            </Button>
          </a>
          <Button
            variant="outline"
            onClick={() => signOut({ redirectUrl: `${baseUrl || ""}/` })}
            data-testid="button-sign-out"
          >
            <LogOut className="h-4 w-4 mr-2" /> Sign out
          </Button>
        </div>
      </div>

      <form
        className="flex flex-wrap items-end gap-3 mb-4"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setSearch(searchInput.trim());
        }}
      >
        <div className="w-48">
          <label className="block text-xs uppercase tracking-wide text-muted-foreground mb-1">
            Form
          </label>
          <Select
            value={formType}
            onValueChange={(v) => {
              setPage(1);
              setFormType(v);
            }}
          >
            <SelectTrigger data-testid="select-form-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FORM_TYPES.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 min-w-[240px]">
          <label className="block text-xs uppercase tracking-wide text-muted-foreground mb-1">
            Search
          </label>
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Email, name, or company"
            data-testid="input-search"
          />
        </div>
        <Button type="submit" data-testid="button-search">
          <Search className="h-4 w-4 mr-2" /> Search
        </Button>
        {(search || formType !== "all") && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setSearchInput("");
              setSearch("");
              setFormType("all");
              setPage(1);
            }}
            data-testid="button-clear-filters"
          >
            Clear
          </Button>
        )}
      </form>

      {(retryMessage || retryError) && (
        <div
          className={`mb-3 text-sm rounded border px-3 py-2 ${
            retryError
              ? "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-900/30 dark:text-red-100"
              : "border-green-300 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-900/30 dark:text-green-100"
          }`}
          data-testid="text-retry-feedback"
        >
          {retryError ?? retryMessage}
        </div>
      )}

      <div className="rounded-md border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[170px]">Received</TableHead>
              <TableHead className="w-[100px]">Form</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Message / Details</TableHead>
              <TableHead className="w-[120px]">Webhook</TableHead>
              <TableHead className="w-[110px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && items.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No submissions found.
                </TableCell>
              </TableRow>
            )}
            {items.map((s) => {
              const payload = s.payload as Record<string, unknown>;
              const message =
                (typeof payload.message === "string" && payload.message) ||
                (typeof payload.brief === "string" && payload.brief) ||
                (typeof payload.source === "string" && `source: ${payload.source}`) ||
                "";
              return (
                <TableRow
                  key={s.id}
                  data-testid={`row-submission-${s.id}`}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setSelected(s)}
                >
                  <TableCell className="text-sm whitespace-nowrap">
                    {formatDateTime(s.createdAt)}
                  </TableCell>
                  <TableCell>
                    <span className="text-xs uppercase tracking-wide px-2 py-1 rounded bg-muted">
                      {s.formType}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">
                    <div className="font-medium">{s.name ?? "—"}</div>
                    <div className="text-muted-foreground">{s.email ?? "—"}</div>
                    {s.company && (
                      <div className="text-xs text-muted-foreground">{s.company}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm max-w-[420px]">
                    <div className="line-clamp-3 whitespace-pre-wrap">
                      {message || <span className="text-muted-foreground">—</span>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span
                      className={`text-xs uppercase tracking-wide px-2 py-1 rounded ${statusBadgeClass(s.webhookStatus)}`}
                      title={s.webhookError ?? undefined}
                    >
                      {s.webhookStatus ?? "—"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    {isFailedStatus(s.webhookStatus) ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={retryOne.isPending && retryOne.variables === s.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          retryOne.mutate(s.id);
                        }}
                        data-testid={`button-retry-${s.id}`}
                      >
                        <RefreshCw
                          className={`h-3.5 w-3.5 mr-1 ${
                            retryOne.isPending && retryOne.variables === s.id ? "animate-spin" : ""
                          }`}
                        />
                        Retry
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
        <div data-testid="text-pagination-summary">
          {total === 0
            ? "0 submissions"
            : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}`}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || isLoading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            data-testid="button-prev-page"
          >
            Previous
          </Button>
          <span data-testid="text-page-indicator">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages || isLoading}
            onClick={() => setPage((p) => p + 1)}
            data-testid="button-next-page"
          >
            Next
          </Button>
        </div>
      </div>

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-xl overflow-y-auto"
          data-testid="drawer-submission-detail"
        >
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>
                  <span className="text-xs uppercase tracking-wide px-2 py-1 rounded bg-muted mr-2">
                    {selected.formType}
                  </span>
                  Submission #{selected.id}
                </SheetTitle>
                <SheetDescription>
                  Received {formatDateTime(selected.createdAt)}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-6 text-sm">
                <section>
                  <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                    Contact
                  </h3>
                  <dl className="space-y-2">
                    <div className="flex gap-3">
                      <dt className="w-20 text-muted-foreground">Name</dt>
                      <dd className="flex-1" data-testid="text-detail-name">
                        {selected.name ?? "—"}
                      </dd>
                    </div>
                    <div className="flex gap-3 items-center">
                      <dt className="w-20 text-muted-foreground">Email</dt>
                      <dd className="flex-1 break-all" data-testid="text-detail-email">
                        {selected.email ?? "—"}
                      </dd>
                      {selected.email && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => copyEmail(selected.email!)}
                          data-testid="button-copy-email"
                        >
                          <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy
                        </Button>
                      )}
                    </div>
                    <div className="flex gap-3">
                      <dt className="w-20 text-muted-foreground">Company</dt>
                      <dd className="flex-1" data-testid="text-detail-company">
                        {selected.company ?? "—"}
                      </dd>
                    </div>
                  </dl>
                </section>

                <section>
                  <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                    Webhook
                  </h3>
                  <div className="flex items-start gap-2">
                    <span
                      className={`text-xs uppercase tracking-wide px-2 py-1 rounded ${statusBadgeClass(selected.webhookStatus)}`}
                      data-testid="text-detail-webhook-status"
                    >
                      {selected.webhookStatus ?? "—"}
                    </span>
                    {selected.webhookError && (
                      <pre
                        className="flex-1 text-xs whitespace-pre-wrap break-words text-red-700 dark:text-red-300"
                        data-testid="text-detail-webhook-error"
                      >
                        {selected.webhookError}
                      </pre>
                    )}
                  </div>
                  {selected.webhookStatus !== "ok" && (
                    <div className="mt-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => resendWebhook(selected.id)}
                        disabled={resending}
                        data-testid="button-resend-webhook"
                      >
                        {resending ? (
                          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                        )}
                        {resending ? "Resending…" : "Resend webhook"}
                      </Button>
                    </div>
                  )}
                </section>

                <section>
                  <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                    Request
                  </h3>
                  <dl className="space-y-2">
                    <div className="flex gap-3">
                      <dt className="w-20 text-muted-foreground">IP</dt>
                      <dd className="flex-1 font-mono text-xs" data-testid="text-detail-ip">
                        {selected.ipAddress ?? "—"}
                      </dd>
                    </div>
                    <div className="flex gap-3">
                      <dt className="w-20 text-muted-foreground">User agent</dt>
                      <dd
                        className="flex-1 font-mono text-xs break-all"
                        data-testid="text-detail-user-agent"
                      >
                        {selected.userAgent ?? "—"}
                      </dd>
                    </div>
                  </dl>
                </section>

                <section>
                  <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                    Payload
                  </h3>
                  <pre
                    className="rounded-md border border-border bg-muted/40 p-3 text-xs overflow-x-auto whitespace-pre-wrap break-words"
                    data-testid="text-detail-payload"
                  >
                    {JSON.stringify(selected.payload, null, 2)}
                  </pre>
                </section>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
