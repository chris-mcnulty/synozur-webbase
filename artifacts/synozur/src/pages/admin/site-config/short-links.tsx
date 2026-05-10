import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Copy,
  Download,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  Pencil,
  Plus,
  QrCode,
  Search as SearchIcon,
  Settings as SettingsIcon,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { MediaPickerModal, mediaUrl } from "@/components/admin/MediaPickerModal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
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

type StatusCode = 301 | 302 | 307 | 308;

interface UpsertInput {
  slug: string;
  targetUrl: string;
  title?: string | null;
  notes?: string | null;
  statusCode?: StatusCode;
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

const STATUS_OPTIONS: { value: StatusCode; label: string; hint: string }[] = [
  { value: 302, label: "302 Temporary", hint: "Default — browsers may re-resolve" },
  { value: 301, label: "301 Permanent", hint: "Cached aggressively by clients" },
  { value: 307, label: "307 Temporary", hint: "Preserves HTTP method" },
  { value: 308, label: "308 Permanent", hint: "Preserves HTTP method" },
];

function coerceStatus(value: unknown): StatusCode {
  const n = Number(value);
  if (n === 301 || n === 307 || n === 308) return n;
  return 302;
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

function buildPreviewUrl(publicBase: string | undefined, slug: string): string {
  const base = (publicBase ?? "https://aka.synozur.com").replace(/\/+$/, "");
  const cleanSlug = slug.trim().replace(/^\/+/, "");
  return cleanSlug ? `${base}/${cleanSlug}` : `${base}/`;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const diff = Date.now() - t;
  if (diff < 60_000) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
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

interface TargetPreview {
  finalUrl: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  // True if the server stripped an og:image because its host failed the
  // private-host check. The UI surfaces this so the admin knows why no
  // image is shown even though the page had one.
  imageBlocked?: boolean;
  sources: {
    title: "og" | "title" | null;
    description: "og" | null;
    imageUrl: "og" | null;
  };
}

async function fetchTargetPreview(url: string): Promise<TargetPreview> {
  return apiFetch<TargetPreview>("/api/cms/short-links/preview-target", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

function StatusBadge({ code }: { code: number }) {
  const permanent = code === 301 || code === 308;
  return (
    <Badge
      variant={permanent ? "secondary" : "outline"}
      className="font-mono text-[10px] tracking-tight"
    >
      {code}
    </Badge>
  );
}

function CollisionPolicySelect({
  value,
  onChange,
  id,
}: {
  value: "skip" | "overwrite";
  onChange: (v: "skip" | "overwrite") => void;
  id?: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v === "overwrite" ? "overwrite" : "skip")}
    >
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="skip">Skip (keep existing)</SelectItem>
        <SelectItem value="overwrite">Overwrite existing</SelectItem>
      </SelectContent>
    </Select>
  );
}

function StatusSelect({
  value,
  onChange,
  id,
}: {
  value: StatusCode;
  onChange: (v: StatusCode) => void;
  id?: string;
}) {
  return (
    <Select
      value={String(value)}
      onValueChange={(v) => onChange(coerceStatus(v))}
    >
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STATUS_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={String(opt.value)}>
            <div className="flex flex-col">
              <span>{opt.label}</span>
              <span className="text-[10px] text-muted-foreground">
                {opt.hint}
              </span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface ShortLinkFormFields {
  slug: string;
  targetUrl: string;
  statusCode: StatusCode;
  title: string;
  notes: string;
  active: boolean;
  tagsText: string;
  ogTitle: string;
  ogDescription: string;
  ogImageUrl: string;
}

// Shared form body for the Add and Edit dialogs. Keeps the two flows visually
// identical so editors don't have to re-learn a different layout when going
// from create to edit.
function OgImagePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (url: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <>
      <div className="mt-1 flex items-center gap-2">
        {value && (
          <>
            <img
              src={value}
              alt=""
              className="h-14 w-24 rounded object-cover border border-border shrink-0"
            />
            <span className="text-xs text-muted-foreground font-mono truncate flex-1">
              {value}
            </span>
            <button
              type="button"
              onClick={() => onChange("")}
              className="shrink-0 rounded p-1 hover:bg-muted text-muted-foreground"
              title="Remove image"
            >
              <X className="h-4 w-4" />
            </button>
          </>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => setPickerOpen(true)}
        >
          <ImageIcon className="h-4 w-4 mr-1" />
          {value ? "Change" : "Choose image…"}
        </Button>
      </div>
      {value && (
        <Input
          className="mt-1 font-mono text-xs"
          placeholder="https://… or /images/og/holidays.png"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      <MediaPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(m) => {
          onChange(mediaUrl(m));
          setPickerOpen(false);
        }}
      />
    </>
  );
}

function ShortLinkFormBody({
  values,
  onChange,
  publicBase,
  showActiveSwitch,
  idPrefix,
}: {
  values: ShortLinkFormFields;
  onChange: (next: Partial<ShortLinkFormFields>) => void;
  publicBase: string | undefined;
  showActiveSwitch: boolean;
  idPrefix: string;
}) {
  const preview = buildPreviewUrl(publicBase, values.slug);
  const { toast } = useToast();
  const [fetchedPreview, setFetchedPreview] = useState<TargetPreview | null>(
    null,
  );
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewMut = useMutation({
    mutationFn: fetchTargetPreview,
    onSuccess: (resp) => {
      setFetchedPreview(resp);
      setPreviewError(null);
      const found = [
        resp.title ? "title" : null,
        resp.description ? "description" : null,
        resp.imageUrl ? "image" : null,
      ].filter(Boolean);
      if (found.length === 0) {
        toast({
          title: "No metadata found",
          description: "Target page doesn't expose OG / Twitter / title tags.",
        });
      }
    },
    onError: (e: Error) => {
      setFetchedPreview(null);
      setPreviewError(e.message);
    },
  });

  const onFetchPreview = () => {
    const url = values.targetUrl.trim();
    if (!url) {
      toast({
        title: "Enter a target URL first",
        variant: "destructive",
      });
      return;
    }
    previewMut.mutate(url);
  };

  const onApplyAll = () => {
    if (!fetchedPreview) return;
    const next: Partial<ShortLinkFormFields> = {};
    if (fetchedPreview.title) {
      // Populate the visible Title — and also OG title so unfurls
      // explicitly carry it. Don't clobber values the editor already
      // typed unless they're empty.
      if (!values.title.trim()) next.title = fetchedPreview.title;
      if (!values.ogTitle.trim()) next.ogTitle = fetchedPreview.title;
    }
    if (fetchedPreview.description && !values.ogDescription.trim()) {
      next.ogDescription = fetchedPreview.description;
    }
    if (fetchedPreview.imageUrl && !values.ogImageUrl.trim()) {
      next.ogImageUrl = fetchedPreview.imageUrl;
    }
    if (Object.keys(next).length === 0) {
      toast({
        title: "Nothing new to apply",
        description: "All matched fields already have a value.",
      });
      return;
    }
    onChange(next);
    toast({
      title: "Applied target metadata",
      description: `Filled: ${Object.keys(next).join(", ")}.`,
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_180px]">
        <div>
          <Label htmlFor={`${idPrefix}-slug`}>Slug</Label>
          <Input
            id={`${idPrefix}-slug`}
            placeholder="holidayswp"
            value={values.slug}
            onChange={(e) => onChange({ slug: e.target.value })}
            autoComplete="off"
            spellCheck={false}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Public URL:{" "}
            <code className="font-mono text-foreground">{preview}</code>
          </p>
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-statusCode`}>Redirect type</Label>
          <StatusSelect
            id={`${idPrefix}-statusCode`}
            value={values.statusCode}
            onChange={(v) => onChange({ statusCode: v })}
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={`${idPrefix}-targetUrl`}>Target URL</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 -mr-2 px-2 text-xs"
            onClick={onFetchPreview}
            disabled={previewMut.isPending || !values.targetUrl.trim()}
            title="Fetch the target page and read its title, description, and OG image"
          >
            {previewMut.isPending ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1 h-3.5 w-3.5" />
            )}
            {previewMut.isPending ? "Fetching…" : "Fetch from target"}
          </Button>
        </div>
        <Input
          id={`${idPrefix}-targetUrl`}
          placeholder="https://example.com/long/url"
          value={values.targetUrl}
          onChange={(e) => onChange({ targetUrl: e.target.value })}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {previewError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Couldn't fetch target metadata: {previewError}
        </div>
      )}

      {fetchedPreview && (
        <TargetPreviewPanel
          preview={fetchedPreview}
          values={values}
          onApplyAll={onApplyAll}
          onApplyField={(field, value) => onChange({ [field]: value })}
          onDismiss={() => setFetchedPreview(null)}
        />
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <Label htmlFor={`${idPrefix}-title`}>Title (optional)</Label>
          <Input
            id={`${idPrefix}-title`}
            placeholder="Holidays WP"
            value={values.title}
            onChange={(e) => onChange({ title: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-tags`}>Tags (comma-separated)</Label>
          <Input
            id={`${idPrefix}-tags`}
            placeholder="campaign, holiday-2025"
            value={values.tagsText}
            onChange={(e) => onChange({ tagsText: e.target.value })}
          />
        </div>
      </div>

      <div>
        <Label htmlFor={`${idPrefix}-notes`}>Notes (optional)</Label>
        <Input
          id={`${idPrefix}-notes`}
          placeholder="Print-collateral QR for the December campaign"
          value={values.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
        />
      </div>

      {showActiveSwitch && (
        <div className="flex items-center gap-2">
          <Switch
            id={`${idPrefix}-active`}
            checked={values.active}
            onCheckedChange={(v) => onChange({ active: v })}
          />
          <Label htmlFor={`${idPrefix}-active`} className="cursor-pointer">
            Active
          </Label>
          <span className="text-xs text-muted-foreground">
            Inactive links return a 404 instead of redirecting.
          </span>
        </div>
      )}

      {/* OG override fields. When any are set, social-bot crawlers hitting
          the short URL get an HTML preview built from these values instead
          of the redirect — humans still get the redirect. */}
      <details className="rounded-md border border-input/60 px-3 py-2">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Social preview (optional)
        </summary>
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <Label htmlFor={`${idPrefix}-og-title`}>OG title</Label>
              <Input
                id={`${idPrefix}-og-title`}
                placeholder="Holidays at Synozur — 2025 calendar"
                value={values.ogTitle}
                onChange={(e) => onChange({ ogTitle: e.target.value })}
              />
            </div>
            <div>
              <Label>OG image</Label>
              <OgImagePicker
                value={values.ogImageUrl}
                onChange={(url) => onChange({ ogImageUrl: url })}
              />
            </div>
          </div>
          <div>
            <Label htmlFor={`${idPrefix}-og-description`}>OG description</Label>
            <Textarea
              id={`${idPrefix}-og-description`}
              rows={2}
              placeholder="Short copy that appears under the title in unfurls."
              value={values.ogDescription}
              onChange={(e) => onChange({ ogDescription: e.target.value })}
            />
          </div>
        </div>
      </details>
    </div>
  );
}

function OgPreviewCard({
  imageUrl,
  title,
  description,
  targetUrl,
}: {
  imageUrl: string;
  title: string;
  description: string;
  targetUrl: string;
}) {
  let domain = "";
  try {
    domain = new URL(targetUrl).hostname;
  } catch {
    // ignore
  }
  return (
    <div className="rounded-md border border-border overflow-hidden bg-muted/30 text-sm max-w-sm">
      {imageUrl && (
        <div className="aspect-[1200/628] w-full bg-muted overflow-hidden">
          <img src={imageUrl} alt="" className="h-full w-full object-cover" />
        </div>
      )}
      <div className="px-3 py-2 space-y-0.5">
        {domain && (
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide truncate">
            {domain}
          </p>
        )}
        <p className="font-semibold leading-snug text-sm truncate">
          {title || "(no title)"}
        </p>
        {description && (
          <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
            {description}
          </p>
        )}
      </div>
    </div>
  );
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

  const settingsQ = useQuery<ShortLinkSettings, Error>({
    queryKey: ["/api/cms/short-links/settings"],
    queryFn: fetchSettings,
  });

  // Add dialog
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<ShortLinkFormFields>({
    slug: "",
    targetUrl: "",
    statusCode: 302,
    title: "",
    notes: "",
    active: true,
    tagsText: "",
    ogTitle: "",
    ogDescription: "",
    ogImageUrl: "",
  });

  // Edit dialog
  const [editTarget, setEditTarget] = useState<ShortLink | null>(null);
  const [editForm, setEditForm] = useState<ShortLinkFormFields>({
    slug: "",
    targetUrl: "",
    statusCode: 302,
    title: "",
    notes: "",
    active: true,
    tagsText: "",
    ogTitle: "",
    ogDescription: "",
    ogImageUrl: "",
  });

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<ShortLink | null>(null);

  // Filter
  const [search, setSearch] = useState("");

  // Imports
  const [importOpen, setImportOpen] = useState(false);
  const [importCsvText, setImportCsvText] = useState("");
  const [importPolicy, setImportPolicy] = useState<"skip" | "overwrite">(
    "skip",
  );
  const [rebrandlyImportOpen, setRebrandlyImportOpen] = useState(false);
  const [rebrandlyDomainId, setRebrandlyDomainId] = useState("");
  const [rebrandlyPolicy, setRebrandlyPolicy] = useState<
    "skip" | "overwrite"
  >("skip");

  // Sub-dialogs
  const [statsTarget, setStatsTarget] = useState<ShortLink | null>(null);
  const [qrTarget, setQrTarget] = useState<ShortLink | null>(null);

  // Settings dialog
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

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["/api/cms/short-links"] });
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
      toast({
        title: "Settings save failed",
        description: e.message,
        variant: "destructive",
      }),
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
      setAddOpen(false);
      setAddForm({
        slug: "",
        targetUrl: "",
        statusCode: 302,
        title: "",
        notes: "",
        active: true,
        tagsText: "",
        ogTitle: "",
        ogDescription: "",
        ogImageUrl: "",
      });
      invalidate();
    },
    onError: (e: Error) =>
      toast({
        title: "Save failed",
        description: e.message,
        variant: "destructive",
      }),
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
      toast({
        title: "Update failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  const deleteMut = useMutation({
    mutationFn: deleteLink,
    onSuccess: () => {
      toast({ title: "Short link deleted" });
      setDeleteTarget(null);
      invalidate();
    },
    onError: (e: Error) =>
      toast({
        title: "Delete failed",
        description: e.message,
        variant: "destructive",
      }),
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
      toast({
        title: "Import failed",
        description: e.message,
        variant: "destructive",
      }),
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

  // ---- CSV export -----------------------------------------------------------
  function escapeCsvField(value: string): string {
    if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
    return value;
  }

  function downloadCsv() {
    const headers = [
      "slug", "publicUrl", "targetUrl", "statusCode", "active",
      "hitCount", "lastClickAt", "title", "tags", "notes",
      "ogTitle", "ogDescription", "ogImageUrl", "createdAt", "updatedAt",
    ];
    const rows = items.map((r) =>
      [
        r.slug,
        r.publicUrl,
        r.targetUrl,
        String(r.statusCode),
        r.active ? "true" : "false",
        String(r.hitCount),
        r.lastClickAt ?? "",
        r.title ?? "",
        (r.tags ?? []).join("; "),
        r.notes ?? "",
        r.ogTitle ?? "",
        r.ogDescription ?? "",
        r.ogImageUrl ?? "",
        r.createdAt,
        r.updatedAt,
      ]
        .map(escapeCsvField)
        .join(","),
    );
    const csv = [headers.join(","), ...rows].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `short-links-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---- Sort -----------------------------------------------------------------
  const [sortKey, setSortKey] = useState<"slug" | "createdAt" | "hitCount">("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function toggleSort(key: "slug" | "createdAt" | "hitCount") {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "slug" ? "asc" : "desc");
    }
  }

  const summary = useMemo(() => {
    let active = 0;
    let totalHits = 0;
    for (const r of items) {
      if (r.active) active += 1;
      totalHits += r.hitCount;
    }
    return {
      total: items.length,
      active,
      inactive: items.length - active,
      totalHits,
    };
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((r) => {
      if (r.slug.toLowerCase().includes(q)) return true;
      if (r.targetUrl.toLowerCase().includes(q)) return true;
      if ((r.title ?? "").toLowerCase().includes(q)) return true;
      if ((r.notes ?? "").toLowerCase().includes(q)) return true;
      if (r.tags.some((t) => t.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [items, search]);

  const onOpenAdd = () => {
    setAddForm({
      slug: "",
      targetUrl: "",
      statusCode: 302,
      title: "",
      notes: "",
      active: true,
      tagsText: "",
      ogTitle: "",
      ogDescription: "",
      ogImageUrl: "",
    });
    setAddOpen(true);
  };

  const onAdd = () => {
    if (!addForm.slug.trim() || !addForm.targetUrl.trim()) {
      toast({
        title: "Slug and target URL are required",
        variant: "destructive",
      });
      return;
    }
    createMut.mutate({
      slug: addForm.slug.trim(),
      targetUrl: addForm.targetUrl.trim(),
      title: addForm.title.trim() || null,
      notes: addForm.notes.trim() || null,
      statusCode: addForm.statusCode,
      active: addForm.active,
      tags: parseTagString(addForm.tagsText),
      ogTitle: addForm.ogTitle.trim() || null,
      ogDescription: addForm.ogDescription.trim() || null,
      ogImageUrl: addForm.ogImageUrl.trim() || null,
    });
  };

  const onEdit = (link: ShortLink) => {
    setEditForm({
      slug: link.slug,
      targetUrl: link.targetUrl,
      statusCode: coerceStatus(link.statusCode),
      title: link.title ?? "",
      notes: link.notes ?? "",
      active: link.active,
      tagsText: tagsToString(link.tags),
      ogTitle: link.ogTitle ?? "",
      ogDescription: link.ogDescription ?? "",
      ogImageUrl: link.ogImageUrl ?? "",
    });
    setEditTarget(link);
  };

  const onSaveEdit = () => {
    if (!editTarget) return;
    const slug = editForm.slug.trim();
    const targetUrl = editForm.targetUrl.trim();
    if (!slug || !targetUrl) {
      toast({
        title: "Slug and target URL are required",
        variant: "destructive",
      });
      return;
    }
    updateMut.mutate({
      id: editTarget.id,
      body: {
        slug,
        targetUrl,
        title: editForm.title.trim() || null,
        notes: editForm.notes.trim() || null,
        statusCode: editForm.statusCode,
        active: editForm.active,
        tags: parseTagString(editForm.tagsText),
        ogTitle: editForm.ogTitle.trim() || null,
        ogDescription: editForm.ogDescription.trim() || null,
        ogImageUrl: editForm.ogImageUrl.trim() || null,
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

  const publicHostLabel = settingsQ.data?.publicHost ?? "aka.synozur.com";
  const publicBaseLabel = settingsQ.data?.publicBase ?? "https://aka.synozur.com";

  return (
    <AdminLayout
      title="Branded short links"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Short links" }]}
    >
      <div className="space-y-5">
        {!canWrite && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
            You have read-only access. Only editors and admins can change short
            links.
          </div>
        )}

        {/* Service summary card. Shows scale-at-a-glance counts and the
            current public-base configuration. Settings live behind the
            Edit settings dialog so the page itself stays focused on the
            list. */}
        <Card className="p-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0 space-y-3">
              <div>
                <div className="text-sm font-semibold">Short-link service</div>
                <div className="text-xs text-muted-foreground">
                  Each link is served from{" "}
                  <code className="font-mono">
                    {publicHostLabel}/&lt;slug&gt;
                  </code>
                  . QR codes are branded with the Synozur mark.
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <SummaryChip label="Links" value={summary.total} />
                <SummaryChip label="Active" value={summary.active} tone="active" />
                {summary.inactive > 0 && (
                  <SummaryChip
                    label="Inactive"
                    value={summary.inactive}
                    tone="muted"
                  />
                )}
                <SummaryChip
                  label="Total clicks"
                  value={summary.totalHits}
                  tone="muted"
                />
              </div>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-[auto_1fr]">
                <dt>Public base</dt>
                <dd>
                  <code className="font-mono">{publicBaseLabel}</code>
                </dd>
                <dt>Additional hosts</dt>
                <dd>
                  <code className="font-mono">
                    {settingsQ.data?.additionalHosts.length
                      ? settingsQ.data.additionalHosts.join(", ")
                      : "(none)"}
                  </code>
                </dd>
                <dt>404 fallback</dt>
                <dd>
                  <code className="font-mono">
                    {settingsQ.data?.fallbackUrl ?? "(none — show plain 404)"}
                  </code>
                </dd>
              </dl>
            </div>
            {canWrite && (
              // Disabled until the settings query resolves — otherwise the
              // dialog seeds blank values from `settingsQ.data` and a save
              // would clobber publicBase / fallbackUrl / hosts back to null.
              <Button
                variant="outline"
                size="sm"
                onClick={openSettings}
                disabled={!settingsQ.data}
              >
                <SettingsIcon className="mr-1 h-4 w-4" />
                {settingsQ.isLoading ? "Loading…" : "Edit settings"}
              </Button>
            )}
          </div>
        </Card>

        {/* Toolbar: search filter on the left, primary actions on the right. */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full md:max-w-sm">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search slug, title, target, tag…"
              aria-label="Search short links"
              className="pl-8 pr-9"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {canWrite && (
            <div className="flex flex-wrap gap-2">
              {items.length > 0 && (
                <Button variant="outline" size="sm" onClick={downloadCsv}>
                  <Download className="mr-1 h-4 w-4" />
                  Export CSV
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRebrandlyImportOpen(true)}
              >
                <Upload className="mr-1 h-4 w-4" />
                Import from Rebrandly API
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setImportOpen(true)}
              >
                <Upload className="mr-1 h-4 w-4" />
                Import CSV
              </Button>
              <Button size="sm" onClick={onOpenAdd}>
                <Plus className="mr-1 h-4 w-4" />
                Add short link
              </Button>
            </div>
          )}
        </div>

        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[220px]">
                  <button
                    type="button"
                    className="flex items-center gap-1 hover:text-foreground"
                    onClick={() => toggleSort("slug")}
                  >
                    Link
                    {sortKey === "slug" ? (
                      sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronsUpDown className="h-3 w-3 opacity-40" />
                    )}
                  </button>
                </TableHead>
                <TableHead className="min-w-[260px]">Target</TableHead>
                <TableHead className="w-[80px]">Code</TableHead>
                <TableHead className="w-[80px] text-right">
                  <button
                    type="button"
                    className="flex items-center gap-1 hover:text-foreground ml-auto"
                    onClick={() => toggleSort("hitCount")}
                  >
                    Hits
                    {sortKey === "hitCount" ? (
                      sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronsUpDown className="h-3 w-3 opacity-40" />
                    )}
                  </button>
                </TableHead>
                <TableHead className="w-[140px]">Last click</TableHead>
                <TableHead className="w-[120px]">
                  <button
                    type="button"
                    className="flex items-center gap-1 hover:text-foreground"
                    onClick={() => toggleSort("createdAt")}
                  >
                    Created
                    {sortKey === "createdAt" ? (
                      sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronsUpDown className="h-3 w-3 opacity-40" />
                    )}
                  </button>
                </TableHead>
                <TableHead className="w-[80px]">Active</TableHead>
                <TableHead className="w-[180px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listQ.isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : listQ.isError ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-destructive">
                    Failed to load short links: {listQ.error?.message}
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-10 text-center text-muted-foreground"
                  >
                    No short links yet.
                    {canWrite && (
                      <>
                        {" "}
                        <button
                          type="button"
                          className="font-medium text-primary underline-offset-4 hover:underline"
                          onClick={onOpenAdd}
                        >
                          Add the first one
                        </button>{" "}
                        or import from Rebrandly.
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ) : filteredItems.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-10 text-center text-muted-foreground"
                  >
                    No links match{" "}
                    <code className="font-mono">{search}</code>.{" "}
                    <button
                      type="button"
                      className="font-medium text-primary underline-offset-4 hover:underline"
                      onClick={() => setSearch("")}
                    >
                      Clear search
                    </button>
                    .
                  </TableCell>
                </TableRow>
              ) : (
                [...filteredItems].sort((a, b) => {
                  let cmp = 0;
                  if (sortKey === "slug") cmp = a.slug.localeCompare(b.slug);
                  else if (sortKey === "hitCount") cmp = a.hitCount - b.hitCount;
                  else cmp = a.createdAt.localeCompare(b.createdAt);
                  return sortDir === "asc" ? cmp : -cmp;
                }).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="align-top">
                      <div className="flex flex-col gap-1">
                        <div className="text-sm font-medium">
                          {r.title?.trim() ? (
                            r.title
                          ) : (
                            <span className="font-mono">/{r.slug}</span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => onCopy(r.publicUrl)}
                          className="group inline-flex items-center gap-1 self-start font-mono text-xs text-muted-foreground hover:text-foreground"
                          title={`Copy ${r.publicUrl}`}
                          aria-label={`Copy ${r.publicUrl} to clipboard`}
                        >
                          <span className="break-all text-left">
                            {r.publicUrl}
                          </span>
                          <Copy className="h-3 w-3 opacity-0 group-hover:opacity-70" />
                        </button>
                        {r.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-0.5">
                            {r.tags.map((t) => (
                              <Badge
                                key={t}
                                variant="outline"
                                className="text-[10px] font-normal"
                              >
                                {t}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <a
                        href={r.targetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group inline-flex max-w-full items-center gap-1 font-mono text-xs hover:underline"
                        title={r.targetUrl}
                      >
                        <span className="truncate">{r.targetUrl}</span>
                        <ExternalLink className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-70" />
                      </a>
                      {r.notes && (
                        <div
                          className="mt-1 truncate text-xs text-muted-foreground"
                          title={r.notes}
                        >
                          {r.notes}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      <StatusBadge code={r.statusCode} />
                    </TableCell>
                    <TableCell className="text-right align-top tabular-nums">
                      {r.hitCount.toLocaleString()}
                    </TableCell>
                    <TableCell
                      className="align-top text-xs text-muted-foreground"
                      title={r.lastClickAt ? new Date(r.lastClickAt).toLocaleString() : undefined}
                    >
                      {formatRelative(r.lastClickAt)}
                    </TableCell>
                    <TableCell
                      className="align-top text-xs text-muted-foreground"
                      title={r.createdAt ? new Date(r.createdAt).toLocaleString() : undefined}
                    >
                      {r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell className="align-top">
                      <Switch
                        checked={r.active}
                        disabled={!canWrite || updateMut.isPending}
                        onCheckedChange={(v) =>
                          updateMut.mutate({ id: r.id, body: { active: v } })
                        }
                        aria-label={
                          r.active
                            ? `Deactivate ${r.slug}`
                            : `Activate ${r.slug}`
                        }
                      />
                    </TableCell>
                    <TableCell className="space-x-0.5 text-right align-top">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setQrTarget(r)}
                        title="QR code"
                        aria-label={`Show QR code for ${r.slug}`}
                      >
                        <QrCode className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setStatsTarget(r)}
                        title="Stats"
                        aria-label={`Show click stats for ${r.slug}`}
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
                            aria-label={`Edit ${r.slug}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteTarget(r)}
                            title="Delete"
                            aria-label={`Delete ${r.slug}`}
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
          {/* Footer count line keeps users oriented when filtering. */}
          {!listQ.isLoading && !listQ.isError && items.length > 0 && (
            <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
              <span>
                Showing {filteredItems.length.toLocaleString()} of{" "}
                {items.length.toLocaleString()}
              </span>
              {search && (
                <button
                  type="button"
                  className="font-medium text-primary underline-offset-4 hover:underline"
                  onClick={() => setSearch("")}
                >
                  Clear filter
                </button>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* Add dialog */}
      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          if (!open) setAddOpen(false);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add short link</DialogTitle>
            <DialogDescription>
              Pick a slug and a target URL. Title, tags, and the social-preview
              fields are optional.
            </DialogDescription>
          </DialogHeader>
          <ShortLinkFormBody
            idPrefix="add"
            values={addForm}
            onChange={(next) => setAddForm((s) => ({ ...s, ...next }))}
            publicBase={settingsQ.data?.publicBase}
            showActiveSwitch
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button onClick={onAdd} disabled={createMut.isPending}>
              <Plus className="mr-1 h-4 w-4" />
              {createMut.isPending ? "Adding…" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog
        open={!!editTarget}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Edit{" "}
              <span className="font-mono">/{editTarget?.slug}</span>
            </DialogTitle>
            <DialogDescription>
              Changing the slug will change every published QR / link that
              points at this row.
            </DialogDescription>
          </DialogHeader>
          <ShortLinkFormBody
            idPrefix="edit"
            values={editForm}
            onChange={(next) => setEditForm((s) => ({ ...s, ...next }))}
            publicBase={settingsQ.data?.publicBase}
            showActiveSwitch
          />
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

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete <span className="font-mono">/{deleteTarget?.slug}</span>?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Existing QR codes and printed collateral pointing at this slug
              will start returning a 404. Click history is also removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                if (deleteTarget) deleteMut.mutate(deleteTarget.id);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
            <DialogDescription>
              Fetches every link in the configured Rebrandly account and
              upserts it. Slug, target URL, title, description, lifetime
              click count, and last-click timestamp carry over. Per-day
              analytics start fresh from the first scan after cutover.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              <strong>Heads-up:</strong> existing printed QR codes that encode{" "}
              <code className="font-mono">aka.synozur.com/&lt;slug&gt;</code>{" "}
              keep working seamlessly after a DNS cutover. QR codes that encode{" "}
              <code className="font-mono">rebrand.ly/...</code> go dead the
              moment Rebrandly is disabled and need to be reprinted.
            </div>
            <div>
              <Label htmlFor="rebrandly-policy">On slug collision</Label>
              <CollisionPolicySelect
                id="rebrandly-policy"
                value={rebrandlyPolicy}
                onChange={setRebrandlyPolicy}
              />
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
              <p className="mt-1 text-xs text-muted-foreground">
                Scopes the import to a single Rebrandly branded domain (look
                up the ID in Rebrandly → Domains → API).
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

      {/* CSV import dialog */}
      <Dialog
        open={importOpen}
        onOpenChange={(open) => {
          if (!open) setImportOpen(false);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import from Rebrandly CSV</DialogTitle>
            <DialogDescription>
              Paste a Rebrandly CSV export below. Recognised columns:{" "}
              <code>slug</code> / <code>slashtag</code>, <code>destination</code>{" "}
              / <code>targetUrl</code>, <code>title</code>, <code>notes</code>,{" "}
              <code>tags</code>, <code>id</code>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="import-policy">On slug collision</Label>
              <CollisionPolicySelect
                id="import-policy"
                value={importPolicy}
                onChange={setImportPolicy}
              />
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
            <DialogTitle>
              QR code · <span className="font-mono">/{qrTarget?.slug}</span>
            </DialogTitle>
            <DialogDescription>
              Branded with the Synozur mark. Use the 1024×1024 download for
              print collateral.
            </DialogDescription>
          </DialogHeader>
          {qrTarget && (
            <div className="flex flex-col items-center space-y-3">
              <img
                src={`/api/cms/short-links/${qrTarget.id}/qr.png?size=512`}
                alt={`QR for ${qrTarget.publicUrl}`}
                className="h-64 w-64 rounded border bg-white"
              />
              <code className="break-all text-center text-xs text-muted-foreground">
                {qrTarget.publicUrl}
              </code>
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="outline" size="sm" asChild>
                  <a
                    href={`/api/cms/short-links/${qrTarget.id}/qr.png?size=1024`}
                    download={`${qrTarget.slug}-qr.png`}
                  >
                    <Download className="mr-1 h-4 w-4" />
                    Download (1024×1024)
                  </a>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onCopy(qrTarget.publicUrl)}
                >
                  <Copy className="mr-1 h-4 w-4" />
                  Copy URL
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <a
                    href={qrTarget.publicUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="mr-1 h-4 w-4" />
                    Open
                  </a>
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
            <DialogDescription>
              Affects every short link served by this app. Changes apply
              immediately on save — no redeploy needed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <SettingsSection
              title="Public URL"
              description="What admins copy and what gets baked into QR codes."
            >
              <div>
                <Label htmlFor="settings-publicBase">Public base URL</Label>
                <Input
                  id="settings-publicBase"
                  placeholder="https://aka.synozur.com"
                  value={settingsDraft.publicBase}
                  onChange={(e) =>
                    setSettingsDraft((s) => ({
                      ...s,
                      publicBase: e.target.value,
                    }))
                  }
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Leave blank to use the default{" "}
                  <code className="font-mono">https://aka.synozur.com</code>.
                </p>
              </div>
              <div>
                <Label htmlFor="settings-additionalHosts">
                  Additional hostnames
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
                <p className="mt-1 text-xs text-muted-foreground">
                  Comma-separated. Hostnames besides the one parsed from the
                  public base URL that the redirect middleware should treat as
                  a short-link host. Useful for staging aliases or local-dev.
                </p>
              </div>
            </SettingsSection>

            <Separator />

            <SettingsSection
              title="404 fallback"
              description="Where unknown slugs send visitors."
            >
              <div>
                <Label htmlFor="settings-fallbackUrl">404 fallback URL</Label>
                <Input
                  id="settings-fallbackUrl"
                  placeholder="https://www.synozur.com"
                  value={settingsDraft.fallbackUrl}
                  onChange={(e) =>
                    setSettingsDraft((s) => ({
                      ...s,
                      fallbackUrl: e.target.value,
                    }))
                  }
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Surfaced as a "Go to ___" button on the 404 page when an
                  unknown slug is requested. Leave blank to suppress the button.
                </p>
              </div>
            </SettingsSection>

            <Separator />

            <SettingsSection
              title="Rebrandly API"
              description="Used by the Import-from-Rebrandly flow only."
            >
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
                <p className="mt-1 text-xs text-muted-foreground">
                  Leave blank on save to keep the existing key; type a new
                  value to rotate it; or use <strong>Clear key</strong> to
                  remove it.
                </p>
                {settingsDraft.rebrandlyApiKeyTouched &&
                  settingsDraft.rebrandlyApiKey === "" &&
                  settingsQ.data?.rebrandlyApiKeyMasked && (
                    <p className="mt-1 text-xs text-destructive">
                      Saving will clear the stored key.
                    </p>
                  )}
              </div>
            </SettingsSection>
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

function SummaryChip({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "active" | "muted";
}) {
  const toneClass =
    tone === "active"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
      : tone === "muted"
        ? "border-input/60 bg-muted/40 text-muted-foreground"
        : "border-input bg-background";
  return (
    <div
      className={`inline-flex items-baseline gap-2 rounded-md border px-2.5 py-1 text-xs ${toneClass}`}
    >
      <span className="font-semibold tabular-nums text-foreground">
        {value.toLocaleString()}
      </span>
      <span className="text-[11px] uppercase tracking-wide">{label}</span>
    </div>
  );
}

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      {children}
    </div>
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
    queryKey: target
      ? [`/api/cms/short-links/${target.id}/stats`]
      : ["stats-disabled"],
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
          <DialogTitle>
            Stats · <span className="font-mono">/{target?.slug}</span>
          </DialogTitle>
          {target?.publicUrl && (
            <DialogDescription>
              <code className="break-all font-mono">{target.publicUrl}</code>
            </DialogDescription>
          )}
        </DialogHeader>
        {statsQ.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : statsQ.isError ? (
          <p className="text-sm text-destructive">
            Failed to load stats: {statsQ.error.message}
          </p>
        ) : statsQ.data ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <StatTile
                label="Total clicks"
                value={statsQ.data.totalClicks.toLocaleString()}
              />
              <StatTile
                label={`Unique sessions (${statsQ.data.windowDays}d)`}
                value={statsQ.data.uniqueSessions.toLocaleString()}
              />
              <StatTile label="Window" value={`${statsQ.data.windowDays}d`} />
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">
                Daily clicks (last {statsQ.data.windowDays} days)
              </div>
              <div className="flex h-24 items-end gap-1 rounded border bg-muted/20 p-2">
                {statsQ.data.daily.length === 0 ? (
                  <div className="w-full self-center text-center text-xs text-muted-foreground">
                    No clicks in window yet.
                  </div>
                ) : (
                  statsQ.data.daily.map((d) => (
                    <div
                      key={d.day}
                      title={`${d.day}: ${d.count}`}
                      className="min-w-[6px] flex-1 rounded-sm bg-primary/70 hover:bg-primary"
                      style={{
                        height: `${
                          max ? Math.max(4, Math.round((d.count / max) * 100)) : 4
                        }%`,
                      }}
                    />
                  ))
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <RankedList
                label="Top referrers"
                items={statsQ.data.topReferrers.map((r) => ({
                  key: r.referrer,
                  label: r.referrer,
                  count: r.count,
                }))}
              />
              <RankedList
                label="Top countries"
                items={statsQ.data.topCountries.map((r) => ({
                  key: r.country,
                  label: r.country,
                  count: r.count,
                }))}
              />
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

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function TargetPreviewPanel({
  preview,
  values,
  onApplyAll,
  onApplyField,
  onDismiss,
}: {
  preview: TargetPreview;
  values: ShortLinkFormFields;
  onApplyAll: () => void;
  onApplyField: (
    field: "title" | "ogTitle" | "ogDescription" | "ogImageUrl",
    value: string,
  ) => void;
  onDismiss: () => void;
}) {
  // We deliberately do NOT auto-load `<img src={preview.imageUrl}>`.
  // The image URL comes from untrusted target metadata, so auto-loading
  // would let the admin's browser issue arbitrary outbound requests
  // (and bypass the server-side SSRF guard). The editor has to click
  // "Show preview" to load it, which keeps the choice explicit.
  const [imagePreviewLoaded, setImagePreviewLoaded] = useState(false);
  const titleAvailable = !!preview.title;
  const descAvailable = !!preview.description;
  const imageAvailable = !!preview.imageUrl;
  const nothing = !titleAvailable && !descAvailable && !imageAvailable;
  const titleSourceLabel =
    preview.sources.title === "og"
      ? "og:title"
      : preview.sources.title === "title"
        ? "<title>"
        : null;

  return (
    <div className="rounded-md border bg-muted/30 p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" />
            Found at target
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {preview.finalUrl}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          {!nothing && (
            <Button
              type="button"
              size="sm"
              variant="default"
              onClick={onApplyAll}
            >
              Apply all
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onDismiss}
            aria-label="Dismiss preview"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {nothing ? (
        <p className="mt-2 text-xs text-muted-foreground">
          The target page didn't expose any OG, Twitter, or {"<title>"} tags.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {titleAvailable && (
            <PreviewField
              label={`Title${titleSourceLabel ? ` · ${titleSourceLabel}` : ""}`}
              value={preview.title!}
              alreadySet={
                values.title.trim() === preview.title!.trim() &&
                values.ogTitle.trim() === preview.title!.trim()
              }
              onApply={() => {
                if (!values.title.trim()) onApplyField("title", preview.title!);
                if (!values.ogTitle.trim())
                  onApplyField("ogTitle", preview.title!);
              }}
            />
          )}
          {descAvailable && (
            <PreviewField
              label="Description · og:description"
              value={preview.description!}
              alreadySet={
                values.ogDescription.trim() === preview.description!.trim()
              }
              onApply={() =>
                onApplyField("ogDescription", preview.description!)
              }
            />
          )}
          {imageAvailable && (
            <div>
              <div className="text-xs font-medium text-muted-foreground">
                Image · og:image
              </div>
              <div className="mt-1 flex items-start gap-3">
                {imagePreviewLoaded ? (
                  <img
                    src={preview.imageUrl!}
                    alt="Target OG preview"
                    className="h-16 w-28 shrink-0 rounded border bg-background object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setImagePreviewLoaded(true)}
                    className="flex h-16 w-28 shrink-0 items-center justify-center rounded border border-dashed text-[10px] text-muted-foreground hover:bg-muted/40"
                    title="Loads the image from the target host in your browser"
                  >
                    Show preview
                  </button>
                )}
                <div className="min-w-0 flex-1">
                  <code className="block break-all text-xs text-muted-foreground">
                    {preview.imageUrl}
                  </code>
                  <div className="mt-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      disabled={
                        values.ogImageUrl.trim() === preview.imageUrl!.trim()
                      }
                      onClick={() =>
                        onApplyField("ogImageUrl", preview.imageUrl!)
                      }
                    >
                      {values.ogImageUrl.trim() === preview.imageUrl!.trim()
                        ? "Already set"
                        : "Use this"}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
          {preview.imageBlocked && !imageAvailable && (
            <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-200">
              Target had an og:image, but its host was filtered as private
              / loopback.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PreviewField({
  label,
  value,
  alreadySet,
  onApply,
}: {
  label: string;
  value: string;
  alreadySet: boolean;
  onApply: () => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          disabled={alreadySet}
          onClick={onApply}
        >
          {alreadySet ? "Already set" : "Use this"}
        </Button>
      </div>
      <div className="mt-1 line-clamp-2 break-words text-sm">{value}</div>
    </div>
  );
}

function RankedList({
  label,
  items,
}: {
  label: string;
  items: { key: string; label: string; count: number }[];
}) {
  return (
    <div>
      <div className="mb-1 text-xs text-muted-foreground">{label}</div>
      <ul className="space-y-1 text-sm">
        {items.length === 0 ? (
          <li className="text-muted-foreground">—</li>
        ) : (
          items.map((r) => (
            <li key={r.key} className="flex justify-between gap-2">
              <span className="truncate">{r.label}</span>
              <span className="font-mono text-xs tabular-nums">{r.count}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
