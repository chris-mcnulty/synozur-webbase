import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Mail,
  RefreshCcw,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  Clock,
  XCircle,
  Eye,
  MousePointerClick,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AdminLayout } from "@/components/admin/AdminLayout";

// #221 — Transactional email log. Surfaces every send that flowed through
// SendGrid along with its latest webhook event (delivered/bounce/etc.) so
// editors can spot deliverability problems without digging through logs.

interface EmailMessage {
  id: string;
  messageId: string;
  toEmail: string;
  subject: string;
  template: string;
  latestEvent: string | null;
  latestEventAt: string | null;
  createdAt: string;
}

interface ListResponse {
  total: number;
  items: EmailMessage[];
}

interface EmailEvent {
  id: string;
  sgMessageId: string;
  event: string;
  emailAddr: string | null;
  reason: string | null;
  eventAt: string;
  receivedAt: string;
}

const PAGE_SIZE = 50;

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "pending", label: "Pending (no event yet)" },
  { value: "delivered", label: "Delivered" },
  { value: "processed", label: "Processed" },
  { value: "deferred", label: "Deferred" },
  { value: "bounce", label: "Bounce" },
  { value: "dropped", label: "Dropped" },
  { value: "spamreport", label: "Spam report" },
  { value: "unsubscribe", label: "Unsubscribe" },
  { value: "open", label: "Open" },
  { value: "click", label: "Click" },
];

function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  return fetch(`${base}${path}`, {
    credentials: "include",
    headers: { Accept: "application/json", ...init.headers },
    ...init,
  }).then(async (r) => {
    if (r.status === 204) return undefined as T;
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error(`HTTP ${r.status}${text ? `: ${text}` : ""}`);
    }
    return r.json() as Promise<T>;
  });
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function eventBadge(event: string | null): {
  label: string;
  className: string;
  Icon: typeof CheckCircle2;
} {
  if (!event)
    return {
      label: "pending",
      className: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
      Icon: Clock,
    };
  switch (event) {
    case "delivered":
      return {
        label: "delivered",
        className: "bg-green-500/10 text-green-400 border-green-500/20",
        Icon: CheckCircle2,
      };
    case "processed":
    case "deferred":
      return {
        label: event,
        className: "bg-blue-500/10 text-blue-400 border-blue-500/20",
        Icon: Clock,
      };
    case "bounce":
    case "dropped":
      return {
        label: event,
        className: "bg-red-500/10 text-red-400 border-red-500/20",
        Icon: XCircle,
      };
    case "spamreport":
      return {
        label: "spam report",
        className: "bg-orange-500/10 text-orange-400 border-orange-500/20",
        Icon: ShieldAlert,
      };
    case "unsubscribe":
    case "group_unsubscribe":
      return {
        label: event.replace("_", " "),
        className: "bg-amber-500/10 text-amber-400 border-amber-500/20",
        Icon: AlertTriangle,
      };
    case "open":
      return {
        label: "open",
        className: "bg-purple-500/10 text-purple-400 border-purple-500/20",
        Icon: Eye,
      };
    case "click":
      return {
        label: "click",
        className: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
        Icon: MousePointerClick,
      };
    default:
      return {
        label: event,
        className: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
        Icon: Mail,
      };
  }
}

export default function AdminEmailPage() {
  const [page, setPage] = useState(0);
  const [template, setTemplate] = useState("all");
  const [status, setStatus] = useState("all");
  const [openMessage, setOpenMessage] = useState<EmailMessage | null>(null);

  const offset = page * PAGE_SIZE;
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(offset),
  });
  if (template !== "all") params.set("template", template);
  if (status !== "all") params.set("status", status);

  const { data, isLoading, isFetching, refetch } = useQuery<ListResponse>({
    queryKey: ["email-messages", page, template, status],
    queryFn: () =>
      apiFetch<ListResponse>(
        `/api/admin/email/messages?${params.toString()}`,
      ),
  });

  const { data: templates } = useQuery<string[]>({
    queryKey: ["email-templates"],
    queryFn: () => apiFetch<string[]>("/api/admin/email/templates"),
  });

  const { data: events } = useQuery<EmailEvent[]>({
    queryKey: ["email-events", openMessage?.id],
    queryFn: () =>
      apiFetch<EmailEvent[]>(
        `/api/admin/email/messages/${openMessage!.id}/events`,
      ),
    enabled: !!openMessage,
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;
  const isEmpty = !isLoading && data?.total === 0;

  return (
    <AdminLayout
      title="Email Log"
      crumbs={[{ label: "Site Config" }, { label: "Email Log" }]}
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          <RefreshCcw
            className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      }
    >
      <div className="space-y-4">
        <Card className="p-4 bg-zinc-900/40 border-zinc-800">
          <div className="flex items-start gap-3">
            <Mail className="w-4 h-4 text-zinc-400 mt-0.5 shrink-0" />
            <div className="text-sm text-zinc-400">
              Each row is one outbound transactional email. The status column
              reflects the most recent SendGrid webhook event we've received
              for that message — anything other than{" "}
              <span className="text-green-400">delivered</span> after a few
              minutes is worth investigating.
            </div>
          </div>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-zinc-400">Template</span>
            <Select
              value={template}
              onValueChange={(v) => {
                setTemplate(v);
                setPage(0);
              }}
            >
              <SelectTrigger className="w-56 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All templates</SelectItem>
                {templates?.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-zinc-400">Status</span>
            <Select
              value={status}
              onValueChange={(v) => {
                setStatus(v);
                setPage(0);
              }}
            >
              <SelectTrigger className="w-56 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {data && (
            <span className="text-sm text-zinc-500">
              {data.total} message{data.total !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {isEmpty ? (
          <Card className="p-12 flex flex-col items-center gap-3 text-center">
            <Mail className="w-10 h-10 text-zinc-500 opacity-60" />
            <p className="text-zinc-300 font-medium">No emails recorded yet</p>
            <p className="text-sm text-zinc-500 max-w-sm">
              Emails sent through SendGrid will appear here once the connector
              is configured and a transactional email is dispatched.
            </p>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800">
                  <TableHead className="text-zinc-400">Status</TableHead>
                  <TableHead className="text-zinc-400">Recipient</TableHead>
                  <TableHead className="text-zinc-400">Subject</TableHead>
                  <TableHead className="text-zinc-400">Template</TableHead>
                  <TableHead className="text-zinc-400">Sent</TableHead>
                  <TableHead className="text-zinc-400">Last event</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading &&
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i} className="border-zinc-800">
                      {Array.from({ length: 6 }).map((__, j) => (
                        <TableCell key={j}>
                          <div className="h-4 bg-zinc-800 rounded animate-pulse" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                {data?.items.map((m) => {
                  const badge = eventBadge(m.latestEvent);
                  return (
                    <TableRow
                      key={m.id}
                      className="border-zinc-800 hover:bg-zinc-800/30 cursor-pointer"
                      onClick={() => setOpenMessage(m)}
                    >
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-xs font-mono ${badge.className}`}
                        >
                          <badge.Icon className="w-3 h-3 mr-1" />
                          {badge.label}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className="max-w-xs truncate text-sm text-zinc-300"
                        title={m.toEmail}
                      >
                        {m.toEmail}
                      </TableCell>
                      <TableCell
                        className="max-w-md truncate text-sm text-zinc-300"
                        title={m.subject}
                      >
                        {m.subject}
                      </TableCell>
                      <TableCell className="text-sm text-zinc-400 font-mono">
                        {m.template}
                      </TableCell>
                      <TableCell className="text-sm text-zinc-500 whitespace-nowrap">
                        {timeAgo(m.createdAt)}
                      </TableCell>
                      <TableCell className="text-sm text-zinc-500 whitespace-nowrap">
                        {timeAgo(m.latestEventAt)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-800">
                <span className="text-sm text-zinc-500">
                  Page {page + 1} of {totalPages} · {data?.total ?? 0} total
                </span>
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </Card>
        )}
      </div>

      <Dialog
        open={openMessage !== null}
        onOpenChange={(o) => !o && setOpenMessage(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="truncate">
              {openMessage?.subject}
            </DialogTitle>
            <DialogDescription className="space-y-1">
              <div>
                To <span className="text-zinc-300">{openMessage?.toEmail}</span>
                {" · "}template{" "}
                <span className="font-mono text-zinc-300">
                  {openMessage?.template}
                </span>
              </div>
              <div className="font-mono text-xs text-zinc-500 break-all">
                {openMessage?.messageId}
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {events && events.length === 0 && (
              <div className="text-sm text-zinc-500 py-4 text-center">
                No webhook events received yet for this message.
              </div>
            )}
            {events?.map((e) => {
              const badge = eventBadge(e.event);
              return (
                <div
                  key={e.id}
                  className="flex items-start justify-between gap-3 py-2 border-b border-zinc-800 last:border-0"
                >
                  <div className="flex items-start gap-2 min-w-0">
                    <Badge
                      variant="outline"
                      className={`text-xs font-mono shrink-0 ${badge.className}`}
                    >
                      <badge.Icon className="w-3 h-3 mr-1" />
                      {badge.label}
                    </Badge>
                    {e.reason && (
                      <span className="text-xs text-zinc-400 break-words">
                        {e.reason}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-zinc-500 whitespace-nowrap shrink-0">
                    {new Date(e.eventAt).toLocaleString()}
                  </span>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
