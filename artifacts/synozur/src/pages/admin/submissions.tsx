import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useUser, useClerk } from "@clerk/react";
import { ArrowLeft, Download, LogOut, Search } from "lucide-react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";

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

export default function AdminSubmissionsList() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");

  const [formType, setFormType] = useState<string>("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

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
            <Link href="/admin">
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

      <div className="rounded-md border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[170px]">Received</TableHead>
              <TableHead className="w-[100px]">Form</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Message / Details</TableHead>
              <TableHead className="w-[120px]">Webhook</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && items.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
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
                <TableRow key={s.id} data-testid={`row-submission-${s.id}`}>
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
    </div>
  );
}
