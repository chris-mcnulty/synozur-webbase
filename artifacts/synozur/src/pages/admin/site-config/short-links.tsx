import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  Copy,
  Download,
  Pencil,
  Plus,
  QrCode,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useAdminAccess } from "@/components/admin/AdminGate";
import { useToast } from "@/hooks/use-toast";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}${text ? `: ${text}` : ""}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

interface ShortLink {
  id: string;
  slug: string;
  targetUrl: string;
  title: string | null;
  notes: string | null;
  statusCode: number;
  active: boolean;
  tags: string[];
  hitCount: number;
  lastClickAt: string | null;
  rebrandlyId: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImageUrl: string | null;
  publicUrl: string;
  createdAt: string;
  updatedAt: string;
}

interface ListResponse {
  items: ShortLink[];
}

interface UpsertInput {
  slug: string;
  targetUrl: string;
  title?: string | null;
  notes?: string | null;
  statusCode?: 301 | 302 | 307 | 308;
  active?: boolean;
  tags?: string[];
  ogTitle?: string | null;
  ogDescription?: string | null;
  ogImageUrl?: string | null;
}

interface ShortLinkSettings {
  publicBase: string;
  publicHost: string;
  additionalHosts: string[];
  fallbackUrl: string | null;
  // Masked render of the configured Rebrandly API key (e.g. `••••dfa4`),
  // or null if no key is set. The raw key is never returned by the GET
  // endpoint — admins re-paste the full value to rotate.
  rebrandlyApiKeyMasked: string | null;
}

interface SettingsUpsertInput {
  publicBase: string | null;
  additionalHosts: string[];
  fallbackUrl: string | null;
  // Omit the field entirely to leave the existing key alone (so a normal
  // settings save doesn't clobber it). Empty string clears it. A non-empty
  // string replaces it.
  rebrandlyApiKey?: string;
}

interface ImportResponse {
  summary: {
    imported: number;
    updated: number;
    skipped: number;
    errors: { row: number; slug?: string; error: string }[];
  };
}

interface StatsResponse {
  windowDays: number;
  totalClicks: number;
  uniqueSessions: number;
  daily: { day: string; count: number }[];
  topReferrers: { referrer: string; count: number }[];
  topCountries: { country: string; count: number }[];
}

const STATUS_OPTIONS: { value: 301 | 302 | 307 | 308; label: string }[] = [
  { value: 302, label: "302 Temporary (default)" },
  { value: 301, label: "301 Permanent" },
  { value: 307, label: "307 Temporary (preserves method)" },
  { value: 308, label: "308 Permanent (preserves method)" },
];

function coerceStatus(value: unknown): 301 | 302 | 307 | 308 {
  const n = Number(value);
  if (n === 301 || n === 307 || n === 308) return n;
  return 302;
}

function emptyDraft(): UpsertInput {
  return {
    slug: "",
    targetUrl: "",
    title: "",
    notes: "",
    statusCode: 302,
    active: true,
    tags: [],
    ogTitle: "",
    ogDescription: "",
    ogImageUrl: "",
  };
}

function tagsToString(tags: string[] | undefined | null): string {
  return (tags ?? []).join(", ");
}

function parseTagString(input: string): string[] {
  return input
    .split(/[,;|]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

async function listLinks(): Promise<ListResponse> {
  return apiFetch<ListResponse>("/api/cms/short-links");
}

async function createLink(body: UpsertInput): Promise<ShortLink> {
  return apiFetch<ShortLink>("/api/cms/short-links", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function updateLink(id: string, body: Partial<UpsertInput>): Promise<ShortLink> {
  return apiFetch<ShortLink>(`/api/cms/short-links/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

async function deleteLink(id: string): Promise<void> {
  await apiFetch<undefined>(`/api/cms/short-links/${id}`, { method: "DELETE" });
}

async function importCsv(body: {
  csv: string;
  collisionPolicy: "skip" | "overwrite";
  defaultActive: boolean;
}): Promise<ImportResponse> {
  return apiFetch<ImportResponse>("/api/cms/short-links/import", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

interface RebrandlyImportResponse extends ImportResponse {
  totalFetched: number;
}

async function importRebrandly(body: {
  collisionPolicy: "skip" | "overwrite";
  defaultActive: boolean;
  domainId?: string;
}): Promise<RebrandlyImportResponse> {
  return apiFetch<RebrandlyImportResponse>(
    "/api/cms/short-links/import-rebrandly",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

async function fetchStats(id: string): Promise<StatsResponse> {
  return apiFetch<StatsResponse>(`/api/cms/short-links/${id}/stats`);
}

async function fetchSettings(): Promise<ShortLinkSettings> {
  return apiFetch<ShortLinkSettings>("/api/cms/short-links/settings");
}

async function saveSettings(body: SettingsUpsertInput): Promise<ShortLinkSettings> {
  return apiFetch<ShortLinkSettings>("/api/cms/short-links/settings", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export default function AdminShortLinks() {
  const { access } = useAdminAccess();
  const { toast } = useToast();
  const qc = useQueryClient();
  const canWrite = !!access?.isEditorOrAbove;

  const listQ = useQuery<ListResponse, Error>({
    queryKey: ["/api/cms/short-links"],
    queryFn: listLinks,
  });

  const [draft, setDraft] = useState<UpsertInput>(emptyDraft());
  const [draftTags, setDraftTags] = useState<string>("");
  const [editTarget, setEditTarget] = useState<ShortLink | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<UpsertInput>>({});
  const [editTags, setEditTags] = useState<string>("");
  const [importOpen, setImportOpen] = useState(false);
  const [importCsvText, setImportCsvText] = useState("");
  const [importPolicy, setImportPolicy] = useState<"skip" | "overwrite">(
    "skip",
  );
  const [statsTarget, setStatsTarget] = useState<ShortLink | null>(null);
  const [qrTarget, setQrTarget] = useState<ShortLink | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<{
    publicBase: string;
    additionalHosts: string;
    fallbackUrl: string;
    rebrandlyApiKey: string;
    // True once the editor has typed into the key field. We only send the
    // key on save when this flag is set so the existing value isn't
    // accidentally cleared by an empty input.
    rebrandlyApiKeyTouched: boolean;
  }>({
    publicBase: "",
    additionalHosts: "",
    fallbackUrl: "",
    rebrandlyApiKey: "",
    rebrandlyApiKeyTouched: false,
  });
  const [rebrandlyImportOpen, setRebrandlyImportOpen] = useState(false);
  const [rebrandlyDomainId, setRebrandlyDomainId] = useState("");
  const [rebrandlyPolicy, setRebrandlyPolicy] = useState<
    "skip" | "overwrite"
  >("skip");

  const settingsQ = useQuery<ShortLinkSettings, Error>({
    queryKey: ["/api/cms/short-links/settings"],
    queryFn: fetchSettings,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/api/cms/short-links"] });
  const invalidateSettings = () =>
    qc.invalidateQueries({ queryKey: ["/api/cms/short-links/settings"] });

  const settingsMut = useMutation({
    mutationFn: saveSettings,
    onSuccess: () => {
      toast({ title: "Settings saved" });
      setSettingsOpen(false);
      invalidateSettings();
      // Public-base change affects every link's `publicUrl` field, so
      // refetch the list too.
      invalidate();
    },
    onError: (e: Error) =>
      toast({ title: "Settings save failed", description: e.message, variant: "destructive" }),
  });

  const openSettings = () => {
    const s = settingsQ.data;
    setSettingsDraft({
      publicBase: s?.publicBase ?? "",
      additionalHosts: (s?.additionalHosts ?? []).join(", "),
      fallbackUrl: s?.fallbackUrl ?? "",
      // Show the masked value in the input as a placeholder hint via the
      // mask string in the dialog body; the field itself starts blank so
      // an admin who's just opening the dialog doesn't accidentally type
      // *into* the masked text.
      rebrandlyApiKey: "",
      rebrandlyApiKeyTouched: false,
    });
    setSettingsOpen(true);
  };

  const onSaveSettings = () => {
    const additional = settingsDraft.additionalHosts
      .split(/[,;\s]+/)
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
    const payload: SettingsUpsertInput = {
      publicBase: settingsDraft.publicBase.trim() || null,
      additionalHosts: additional,
      fallbackUrl: settingsDraft.fallbackUrl.trim() || null,
    };
    if (settingsDraft.rebrandlyApiKeyTouched) {
      payload.rebrandlyApiKey = settingsDraft.rebrandlyApiKey.trim();
    }
    settingsMut.mutate(payload);
  };

  const createMut = useMutation({
    mutationFn: createLink,
    onSuccess: () => {
      toast({ title: "Short link created" });
      setDraft(emptyDraft());
      setDraftTags("");
      invalidate();
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<UpsertInput> }) =>
      updateLink(id, body),
    onSuccess: () => {
      toast({ title: "Short link updated" });
      setEditTarget(null);
      invalidate();
    },
    onError: (e: Error) =>
      toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: deleteLink,
    onSuccess: () => {
      toast({ title: "Short link deleted" });
      invalidate();
    },
    onError: (e: Error) =>
      toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const importMut = useMutation({
    mutationFn: importCsv,
    onSuccess: (resp) => {
      const { imported, updated, skipped, errors } = resp.summary;
      toast({
        title: "Import complete",
        description: `Imported ${imported}, updated ${updated}, skipped ${skipped}, errors ${errors.length}.`,
      });
      setImportOpen(false);
      setImportCsvText("");
      invalidate();
    },
    onError: (e: Error) =>
      toast({ title: "Import failed", description: e.message, variant: "destructive" }),
  });

  const rebrandlyImportMut = useMutation({
    mutationFn: importRebrandly,
    onSuccess: (resp) => {
      const { imported, updated, skipped, errors } = resp.summary;
      toast({
        title: "Rebrandly import complete",
        description: `Fetched ${resp.totalFetched}; imported ${imported}, updated ${updated}, skipped ${skipped}, errors ${errors.length}.`,
      });
      setRebrandlyImportOpen(false);
      invalidate();
    },
    onError: (e: Error) =>
      toast({
        title: "Rebrandly import failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  const items = listQ.data?.items ?? [];

  const onAdd = () => {
    if (!draft.slug.trim() || !draft.targetUrl.trim()) {
      toast({ title: "Slug and target URL are required", variant: "destructive" });
      return;
    }
    createMut.mutate({
      slug: draft.slug.trim(),
      targetUrl: draft.targetUrl.trim(),
      title: draft.title?.trim() || null,
      notes: draft.notes?.trim() || null,
      statusCode: draft.statusCode,
      active: draft.active,
      tags: parseTagString(draftTags),
      ogTitle: draft.ogTitle?.trim() || null,
      ogDescription: draft.ogDescription?.trim() || null,
      ogImageUrl: draft.ogImageUrl?.trim() || null,
    });
  };

  const onEdit = (link: ShortLink) => {
    setEditDraft({
      slug: link.slug,
      targetUrl: link.targetUrl,
      title: link.title ?? "",
      notes: link.notes ?? "",
      statusCode: coerceStatus(link.statusCode),
      active: link.active,
      tags: link.tags,
      ogTitle: link.ogTitle ?? "",
      ogDescription: link.ogDescription ?? "",
      ogImageUrl: link.ogImageUrl ?? "",
    });
    setEditTags(tagsToString(link.tags));
    setEditTarget(link);
  };

  const onSaveEdit = () => {
    if (!editTarget) return;
    const slug = editDraft.slug?.trim() ?? "";
    const targetUrl = editDraft.targetUrl?.trim() ?? "";
    if (!slug || !targetUrl) {
      toast({ title: "Slug and target URL are required", variant: "destructive" });
      return;
    }
    updateMut.mutate({
      id: editTarget.id,
      body: {
        slug,
        targetUrl,
        title: editDraft.title?.toString().trim() || null,
        notes: editDraft.notes?.toString().trim() || null,
        statusCode: editDraft.statusCode ?? 302,
        active: editDraft.active ?? true,
        tags: parseTagString(editTags),
        ogTitle: editDraft.ogTitle?.toString().trim() || null,
        ogDescription: editDraft.ogDescription?.toString().trim() || null,
        ogImageUrl: editDraft.ogImageUrl?.toString().trim() || null,
      },
    });
  };

  const onCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied to clipboard" });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const onImport = () => {
    if (!importCsvText.trim()) {
      toast({ title: "Paste a CSV first", variant: "destructive" });
      return;
    }
    importMut.mutate({
      csv: importCsvText,
      collisionPolicy: importPolicy,
      defaultActive: true,
    });
  };

  const onImportRebrandly = () => {
    if (!settingsQ.data?.rebrandlyApiKeyMasked) {
      toast({
        title: "Rebrandly API key isn't configured",
        description:
          "Open Edit settings and paste a Rebrandly API key first.",
        variant: "destructive",
      });
      return;
    }
    rebrandlyImportMut.mutate({
      collisionPolicy: rebrandlyPolicy,
      defaultActive: true,
      domainId: rebrandlyDomainId.trim() || undefined,
    });
  };

  return (
    <AdminLayout
      title="Branded short links"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Short links" }]}
    >
      <div className="space-y-6">
        {!canWrite && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
            You have read-only access. Only editors and admins can change short links.
          </div>
        )}

        {/* Service settings card. Lets admins change the public base URL,
            additional hostnames, and the 404 fallback link without a deploy. */}
        <Card className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="text-sm font-semibold">Short-link service</div>
              <div className="text-xs text-muted-foreground space-y-0.5">
                <div>
                  Public base:{" "}
                  <code className="font-mono">
                    {settingsQ.data?.publicBase ?? "https://aka.synozur.com"}
                  </code>
                </div>
                <div>
                  Additional hosts:{" "}
                  <code className="font-mono">
                    {settingsQ.data?.additionalHosts.length
                      ? settingsQ.data.additionalHosts.join(", ")
                      : "(none)"}
                  </code>
                </div>
                <div>
                  404 fallback URL:{" "}
                  <code className="font-mono">
                    {settingsQ.data?.fallbackUrl ?? "(none — show plain 404)"}
                  </code>
                </div>
              </div>
            </div>
            {canWrite && (
              // Disabled until the settings query resolves — otherwise
              // the dialog seeds blank values from `settingsQ.data` and
              // a save would clobber publicBase / fallbackUrl / hosts
              // back to null.
              <Button
                variant="outline"
                size="sm"
                onClick={openSettings}
                disabled={!settingsQ.data}
              >
                {settingsQ.isLoading ? "Loading…" : "Edit settings"}
              </Button>
            )}
          </div>
        </Card>

        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Each link is served from{" "}
            <code className="font-mono">
              {settingsQ.data?.publicHost ?? "aka.synozur.com"}/&lt;slug&gt;
            </code>
            . QR codes are branded with the Synozur mark.
          </p>
          {canWrite && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setRebrandlyImportOpen(true)}
              >
                <Upload className="h-4 w-4 mr-1" />
                Import from Rebrandly API
              </Button>
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <Upload className="h-4 w-4 mr-1" />
                Import CSV
              </Button>
            </div>
          )}
        </div>

        {canWrite && (
          <Card className="p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-[180px_1fr_140px_auto] gap-3 items-end">
              <div>
                <Label htmlFor="slug">Slug</Label>
                <Input
                  id="slug"
                  placeholder="holidayswp"
                  value={draft.slug}
                  onChange={(e) => setDraft((d) => ({ ...d, slug: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="targetUrl">Target URL</Label>
                <Input
                  id="targetUrl"
                  placeholder="https://example.com/long/url"
                  value={draft.targetUrl}
                  onChange={(e) => setDraft((d) => ({ ...d, targetUrl: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="statusCode">Status</Label>
                <select
                  id="statusCode"
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={draft.statusCode}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, statusCode: coerceStatus(e.target.value) }))
                  }
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <Button onClick={onAdd} disabled={createMut.isPending}>
                <Plus className="h-4 w-4 mr-1" />
                {createMut.isPending ? "Adding…" : "Add"}
              </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="title">Title (optional)</Label>
                <Input
                  id="title"
                  placeholder="Holidays WP"
                  value={draft.title ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="tags">Tags (comma-separated)</Label>
                <Input
                  id="tags"
                  placeholder="campaign, holiday-2025"
                  value={draftTags}
                  onChange={(e) => setDraftTags(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="notes">Notes (optional)</Label>
              <Input
                id="notes"
                placeholder="Print-collateral QR for the December campaign"
                value={draft.notes ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
              />
            </div>

            {/* OG override fields. When any are set, social-bot crawlers
                hitting the short URL get an HTML preview built from these
                values instead of the 302 — humans still get the redirect. */}
            <details className="rounded-md border border-input/60 px-3 py-2">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Social preview (optional)
              </summary>
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="og-title">OG title</Label>
                    <Input
                      id="og-title"
                      placeholder="Holidays at Synozur — 2025 calendar"
                      value={draft.ogTitle ?? ""}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, ogTitle: e.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="og-image">OG image URL or path</Label>
                    <Input
                      id="og-image"
                      placeholder="https://… or /images/og/holidays.png"
                      value={draft.ogImageUrl ?? ""}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, ogImageUrl: e.target.value }))
                      }
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="og-description">OG description</Label>
                  <Textarea
                    id="og-description"
                    rows={2}
                    placeholder="Short copy that appears under the title in unfurls."
                    value={draft.ogDescription ?? ""}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        ogDescription: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>
            </details>
          </Card>
        )}

        <Card className="p-0 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Slug</TableHead>
                <TableHead>Target</TableHead>
                <TableHead className="w-[80px]">Hits</TableHead>
                <TableHead className="w-[140px]">Last click</TableHead>
                <TableHead className="w-[80px]">Active</TableHead>
                <TableHead className="w-[220px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listQ.isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : listQ.isError ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-destructive">
                    Failed to load short links: {listQ.error?.message}
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    No short links yet. Add one above or import from Rebrandly.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">
                      <button
                        type="button"
                        onClick={() => onCopy(r.publicUrl)}
                        className="hover:underline"
                        title={`Copy ${r.publicUrl}`}
                      >
                        {r.slug}
                      </button>
                    </TableCell>
                    <TableCell className="font-mono text-xs max-w-[420px] truncate">
                      <a
                        href={r.targetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                        title={r.targetUrl}
                      >
                        {r.targetUrl}
                      </a>
                    </TableCell>
                    <TableCell>{r.hitCount}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.lastClickAt
                        ? new Date(r.lastClickAt).toLocaleString()
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={r.active}
                        disabled={!canWrite || updateMut.isPending}
                        onCheckedChange={(v) =>
                          updateMut.mutate({ id: r.id, body: { active: v } })
                        }
                      />
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onCopy(r.publicUrl)}
                        title="Copy short URL"
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setQrTarget(r)}
                        title="QR code"
                      >
                        <QrCode className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setStatsTarget(r)}
                        title="Stats"
                      >
                        <BarChart3 className="h-4 w-4" />
                      </Button>
                      {canWrite && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onEdit(r)}
                            title="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              if (
                                !confirm(
                                  `Delete short link /${r.slug}? Existing QR codes pointing to it will 404.`,
                                )
                              ) {
                                return;
                              }
                              deleteMut.mutate(r.id);
                            }}
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      {/* Edit dialog */}
      <Dialog
        open={!!editTarget}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit short link</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="edit-slug">Slug</Label>
              <Input
                id="edit-slug"
                value={editDraft.slug ?? ""}
                onChange={(e) => setEditDraft((d) => ({ ...d, slug: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="edit-targetUrl">Target URL</Label>
              <Input
                id="edit-targetUrl"
                value={editDraft.targetUrl ?? ""}
                onChange={(e) => setEditDraft((d) => ({ ...d, targetUrl: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="edit-statusCode">Status</Label>
              <select
                id="edit-statusCode"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={editDraft.statusCode ?? 302}
                onChange={(e) =>
                  setEditDraft((d) => ({ ...d, statusCode: coerceStatus(e.target.value) }))
                }
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="edit-title">Title (optional)</Label>
              <Input
                id="edit-title"
                value={(editDraft.title as string | undefined) ?? ""}
                onChange={(e) => setEditDraft((d) => ({ ...d, title: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="edit-tags">Tags (comma-separated)</Label>
              <Input
                id="edit-tags"
                value={editTags}
                onChange={(e) => setEditTags(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="edit-notes">Notes (optional)</Label>
              <Input
                id="edit-notes"
                value={(editDraft.notes as string | undefined) ?? ""}
                onChange={(e) => setEditDraft((d) => ({ ...d, notes: e.target.value }))}
              />
            </div>
            <details className="rounded-md border border-input/60 px-3 py-2">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Social preview (optional)
              </summary>
              <div className="mt-3 space-y-3">
                <div>
                  <Label htmlFor="edit-og-title">OG title</Label>
                  <Input
                    id="edit-og-title"
                    value={(editDraft.ogTitle as string | undefined) ?? ""}
                    onChange={(e) =>
                      setEditDraft((d) => ({ ...d, ogTitle: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="edit-og-description">OG description</Label>
                  <Textarea
                    id="edit-og-description"
                    rows={2}
                    value={
                      (editDraft.ogDescription as string | undefined) ?? ""
                    }
                    onChange={(e) =>
                      setEditDraft((d) => ({
                        ...d,
                        ogDescription: e.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="edit-og-image">OG image URL or path</Label>
                  <Input
                    id="edit-og-image"
                    value={(editDraft.ogImageUrl as string | undefined) ?? ""}
                    onChange={(e) =>
                      setEditDraft((d) => ({ ...d, ogImageUrl: e.target.value }))
                    }
                  />
                </div>
              </div>
            </details>
            <div className="flex items-center gap-2">
              <Switch
                id="edit-active"
                checked={editDraft.active ?? true}
                onCheckedChange={(v) => setEditDraft((d) => ({ ...d, active: v }))}
              />
              <Label htmlFor="edit-active">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>
              Cancel
            </Button>
            <Button onClick={onSaveEdit} disabled={updateMut.isPending}>
              {updateMut.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rebrandly API import dialog */}
      <Dialog
        open={rebrandlyImportOpen}
        onOpenChange={(open) => {
          if (!open) setRebrandlyImportOpen(false);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import from Rebrandly API</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Fetches every link in the configured Rebrandly account and
              upserts it into the local table. Slug, target URL, title,
              description, lifetime click count, and last-click timestamp
              all carry over. Per-day analytics start fresh from the
              first scan after cutover.
            </p>
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              <strong>Heads-up:</strong> existing printed QR codes that
              encode <code className="font-mono">aka.synozur.com/&lt;slug&gt;</code>{" "}
              will keep working seamlessly after a DNS cutover. QR codes
              that encode <code className="font-mono">rebrand.ly/...</code>{" "}
              go dead the moment Rebrandly is disabled and need to be
              reprinted.
            </div>
            <div>
              <Label htmlFor="rebrandly-policy">On slug collision</Label>
              <select
                id="rebrandly-policy"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={rebrandlyPolicy}
                onChange={(e) =>
                  setRebrandlyPolicy(
                    e.target.value === "overwrite" ? "overwrite" : "skip",
                  )
                }
              >
                <option value="skip">Skip (keep existing)</option>
                <option value="overwrite">Overwrite existing</option>
              </select>
            </div>
            <div>
              <Label htmlFor="rebrandly-domain-id">
                Rebrandly domain ID (optional)
              </Label>
              <Input
                id="rebrandly-domain-id"
                placeholder="leave blank to import every domain"
                value={rebrandlyDomainId}
                onChange={(e) => setRebrandlyDomainId(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Scopes the import to a single Rebrandly branded domain
                (look up the ID in Rebrandly → Domains → API).
              </p>
            </div>
            {!settingsQ.data?.rebrandlyApiKeyMasked && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                No Rebrandly API key is configured. Open{" "}
                <strong>Edit settings</strong> and paste one first.
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRebrandlyImportOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={onImportRebrandly}
              disabled={
                rebrandlyImportMut.isPending ||
                !settingsQ.data?.rebrandlyApiKeyMasked
              }
            >
              {rebrandlyImportMut.isPending ? "Importing…" : "Import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import dialog */}
      <Dialog
        open={importOpen}
        onOpenChange={(open) => {
          if (!open) setImportOpen(false);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import from Rebrandly CSV</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Paste a Rebrandly CSV export below. Recognised columns: <code>slug</code> /
              <code>slashtag</code>, <code>destination</code> / <code>targetUrl</code>,
              <code>title</code>, <code>notes</code>, <code>tags</code>, <code>id</code>.
            </p>
            <div>
              <Label htmlFor="import-policy">On slug collision</Label>
              <select
                id="import-policy"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={importPolicy}
                onChange={(e) =>
                  setImportPolicy(e.target.value === "overwrite" ? "overwrite" : "skip")
                }
              >
                <option value="skip">Skip (keep existing)</option>
                <option value="overwrite">Overwrite existing</option>
              </select>
            </div>
            <div>
              <Label htmlFor="import-csv">CSV</Label>
              <Textarea
                id="import-csv"
                rows={12}
                placeholder="slug,destination,title,tags&#10;holidayswp,https://example.com/holidays,Holidays WP,campaign|holiday-2025"
                value={importCsvText}
                onChange={(e) => setImportCsvText(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
            <Button onClick={onImport} disabled={importMut.isPending}>
              {importMut.isPending ? "Importing…" : "Import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* QR dialog */}
      <Dialog
        open={!!qrTarget}
        onOpenChange={(open) => {
          if (!open) setQrTarget(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>QR code · /{qrTarget?.slug}</DialogTitle>
          </DialogHeader>
          {qrTarget && (
            <div className="space-y-3 flex flex-col items-center">
              <img
                src={`/api/cms/short-links/${qrTarget.id}/qr.png?size=512`}
                alt={`QR for ${qrTarget.publicUrl}`}
                className="w-64 h-64 rounded border bg-white"
              />
              <code className="text-xs text-muted-foreground">{qrTarget.publicUrl}</code>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  asChild
                >
                  <a
                    href={`/api/cms/short-links/${qrTarget.id}/qr.png?size=1024`}
                    download={`${qrTarget.slug}-qr.png`}
                  >
                    <Download className="h-4 w-4 mr-1" />
                    Download (1024×1024)
                  </a>
                </Button>
                <Button variant="outline" onClick={() => onCopy(qrTarget.publicUrl)}>
                  <Copy className="h-4 w-4 mr-1" />
                  Copy URL
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Stats dialog */}
      <StatsDialog target={statsTarget} onClose={() => setStatsTarget(null)} />

      {/* Settings dialog */}
      <Dialog
        open={settingsOpen}
        onOpenChange={(open) => {
          if (!open) setSettingsOpen(false);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Short-link service settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="settings-publicBase">Public base URL</Label>
              <Input
                id="settings-publicBase"
                placeholder="https://aka.synozur.com"
                value={settingsDraft.publicBase}
                onChange={(e) =>
                  setSettingsDraft((s) => ({ ...s, publicBase: e.target.value }))
                }
              />
              <p className="text-xs text-muted-foreground mt-1">
                Embedded in QR codes and copy-to-clipboard. Leave blank to use
                the default <code className="font-mono">https://aka.synozur.com</code>.
              </p>
            </div>
            <div>
              <Label htmlFor="settings-additionalHosts">
                Additional hostnames (comma-separated)
              </Label>
              <Input
                id="settings-additionalHosts"
                placeholder="aka.localhost, go.synozur.com"
                value={settingsDraft.additionalHosts}
                onChange={(e) =>
                  setSettingsDraft((s) => ({
                    ...s,
                    additionalHosts: e.target.value,
                  }))
                }
              />
              <p className="text-xs text-muted-foreground mt-1">
                Hostnames besides the one parsed from the public base URL that
                the redirect middleware should treat as a short-link host.
                Useful for staging aliases or local-dev.
              </p>
            </div>
            <div>
              <Label htmlFor="settings-fallbackUrl">404 fallback URL</Label>
              <Input
                id="settings-fallbackUrl"
                placeholder="https://www.synozur.com"
                value={settingsDraft.fallbackUrl}
                onChange={(e) =>
                  setSettingsDraft((s) => ({ ...s, fallbackUrl: e.target.value }))
                }
              />
              <p className="text-xs text-muted-foreground mt-1">
                Surfaced as a "Go to ___" button on the 404 page when an
                unknown slug is requested. Leave blank to suppress the button.
              </p>
            </div>
            <div>
              <Label htmlFor="settings-rebrandly-key">
                Rebrandly API key
              </Label>
              <div className="flex gap-2">
                <Input
                  id="settings-rebrandly-key"
                  type="password"
                  autoComplete="off"
                  placeholder={
                    settingsQ.data?.rebrandlyApiKeyMasked
                      ? `Currently set: ${settingsQ.data.rebrandlyApiKeyMasked}`
                      : "Paste your Rebrandly API key"
                  }
                  value={settingsDraft.rebrandlyApiKey}
                  onChange={(e) =>
                    setSettingsDraft((s) => ({
                      ...s,
                      rebrandlyApiKey: e.target.value,
                      rebrandlyApiKeyTouched: true,
                    }))
                  }
                />
                {settingsQ.data?.rebrandlyApiKeyMasked && (
                  // Explicit clear control. Marks the field touched and
                  // empty so onSaveSettings sends `rebrandlyApiKey: ""`,
                  // which the server treats as a deliberate clear.
                  // Avoids the previous "type a single space" trick.
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      setSettingsDraft((s) => ({
                        ...s,
                        rebrandlyApiKey: "",
                        rebrandlyApiKeyTouched: true,
                      }))
                    }
                  >
                    Clear key
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Used by the "Import from Rebrandly API" flow. Leave this
                field blank on save to keep the existing key; type a new
                value to rotate it; or use <strong>Clear key</strong> to
                remove it.
                {settingsDraft.rebrandlyApiKeyTouched &&
                  settingsDraft.rebrandlyApiKey === "" &&
                  settingsQ.data?.rebrandlyApiKeyMasked && (
                    <span className="block text-destructive mt-1">
                      Saving will clear the stored key.
                    </span>
                  )}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsOpen(false)}>
              Cancel
            </Button>
            <Button onClick={onSaveSettings} disabled={settingsMut.isPending}>
              {settingsMut.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}

function StatsDialog({
  target,
  onClose,
}: {
  target: ShortLink | null;
  onClose: () => void;
}) {
  const statsQ = useQuery<StatsResponse, Error>({
    queryKey: target ? [`/api/cms/short-links/${target.id}/stats`] : ["stats-disabled"],
    queryFn: () => fetchStats(target!.id),
    enabled: !!target,
  });

  const max = useMemo(
    () => statsQ.data?.daily.reduce((m, d) => Math.max(m, d.count), 0) ?? 0,
    [statsQ.data],
  );

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Stats · /{target?.slug}</DialogTitle>
        </DialogHeader>
        {statsQ.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : statsQ.isError ? (
          <p className="text-sm text-destructive">Failed to load stats: {statsQ.error.message}</p>
        ) : statsQ.data ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="text-xs text-muted-foreground">Total clicks</div>
                <div className="text-2xl font-semibold">{statsQ.data.totalClicks}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">
                  Unique sessions ({statsQ.data.windowDays}d)
                </div>
                <div className="text-2xl font-semibold">{statsQ.data.uniqueSessions}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Window</div>
                <div className="text-2xl font-semibold">{statsQ.data.windowDays}d</div>
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">
                Daily clicks (last {statsQ.data.windowDays} days)
              </div>
              <div className="flex items-end gap-1 h-24 border rounded p-2 bg-muted/20">
                {statsQ.data.daily.length === 0 ? (
                  <div className="text-xs text-muted-foreground self-center w-full text-center">
                    No clicks in window yet.
                  </div>
                ) : (
                  statsQ.data.daily.map((d) => (
                    <div
                      key={d.day}
                      title={`${d.day}: ${d.count}`}
                      className="bg-primary/70 hover:bg-primary rounded-sm flex-1 min-w-[6px]"
                      style={{
                        height: `${max ? Math.max(4, Math.round((d.count / max) * 100)) : 4}%`,
                      }}
                    />
                  ))
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-muted-foreground mb-1">Top referrers</div>
                <ul className="text-sm space-y-1">
                  {statsQ.data.topReferrers.length === 0 ? (
                    <li className="text-muted-foreground">—</li>
                  ) : (
                    statsQ.data.topReferrers.map((r) => (
                      <li key={r.referrer} className="flex justify-between gap-2">
                        <span className="truncate">{r.referrer}</span>
                        <span className="font-mono text-xs">{r.count}</span>
                      </li>
                    ))
                  )}
                </ul>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Top countries</div>
                <ul className="text-sm space-y-1">
                  {statsQ.data.topCountries.length === 0 ? (
                    <li className="text-muted-foreground">—</li>
                  ) : (
                    statsQ.data.topCountries.map((r) => (
                      <li key={r.country} className="flex justify-between gap-2">
                        <span className="truncate">{r.country}</span>
                        <span className="font-mono text-xs">{r.count}</span>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
