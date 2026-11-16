import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

// Private Galaxy pages + shared organization logins for one client org.
// orgId is passed explicitly; all state resets when it changes.

type AssetKind = "html" | "audio" | "transcript";
interface Asset { id: string; kind: AssetKind; filename: string; contentType: string; sizeBytes: number; state: "ready" }
interface Page {
  id: string; title: string; slug: string; status: string; revision: number;
  reviewedRevision: number | null; organizationId: string | null; assets: Asset[];
}
interface Account { id: string; username: string; disabled: boolean }
interface PasswordResult { account: Account; password: string }

const KIND_META: Record<AssetKind, { label: string; accept: string; max: number; ext: RegExp; required: boolean }> = {
  html: { label: "HTML", accept: ".html,.htm,text/html", max: 5 * 1024 * 1024, ext: /\.html?$/i, required: true },
  audio: { label: "MP3 audio", accept: ".mp3,audio/mpeg", max: 50 * 1024 * 1024, ext: /\.mp3$/i, required: false },
  transcript: { label: "DOCX script", accept: ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document", max: 10 * 1024 * 1024, ext: /\.docx$/i, required: false },
};

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${BASE}/api${path}`, {
    credentials: "include",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.method && init.method !== "GET" ? { "X-Galaxy-Request": "1" } : {}),
      ...(typeof init.body === "string" ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!r.ok) {
    let detail = r.statusText;
    try {
      const j = (await r.json()) as { error?: string; message?: string };
      detail = j.error ?? j.message ?? detail;
    } catch { /* ignore */ }
    throw new Error(`${r.status} ${detail}`);
  }
  return (r.status === 204 ? undefined : await r.json()) as T;
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function fmt(n: number) {
  return n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function statusBadge(p: Page) {
  if (p.organizationId === null) return <Badge variant="secondary">Unassigned draft</Badge>;
  const reviewed = p.reviewedRevision === p.revision;
  if (p.status === "published") return <Badge>Published</Badge>;
  if (p.status === "archived") return <Badge variant="secondary">Archived</Badge>;
  return <Badge variant="outline">{reviewed ? "Reviewed" : p.status === "draft" ? "Draft" : p.status}</Badge>;
}

export function PrivatePagesPanel({ orgId }: { orgId: string }) {
  const { toast } = useToast();
  const [pages, setPages] = useState<Page[] | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [newTitle, setNewTitle] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [edits, setEdits] = useState<Record<string, { title: string; slug: string }>>({});
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});
  const [newUsername, setNewUsername] = useState("");

  const [secret, setSecret] = useState<PasswordResult | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const orgRef = useRef(orgId);
  orgRef.current = orgId;

  const load = useCallback(async () => {
    const forOrg = orgId;
    setLoadError(null);
    try {
      const [p, a] = await Promise.all([
        call<{ items: Page[] }>(`/admin/private-pages/${forOrg}/pages`),
        call<{ items: Account[] }>(`/admin/private-pages/${forOrg}/accounts`),
      ]);
      if (orgRef.current !== forOrg) return;
      setPages(p.items);
      setAccounts(a.items);
    } catch (e) {
      if (orgRef.current !== forOrg) return;
      setLoadError((e as Error).message);
    }
  }, [orgId]);

  useEffect(() => {
    setPages(null); setAccounts(null); setEdits({}); setUploadErrors({});
    setNewTitle(""); setNewSlug(""); setNewUsername("");
    setSecret(null); setRevealed(false); setCopied(false);
    void load();
  }, [load]);

  async function run(key: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(key);
    try {
      await fn();
      if (ok) toast({ title: ok });
    } catch (e) {
      toast({ title: "Action failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
      await load();
    }
  }

  const createPage = () => run("create", async () => {
    await call(`/admin/private-pages/${orgId}/pages`, {
      method: "POST", body: JSON.stringify({ title: newTitle.trim(), slug: newSlug.trim() }),
    });
    setNewTitle(""); setNewSlug("");
  }, "Private page created");

  const patch = (p: Page, body: Record<string, unknown>, ok: string) =>
    run(`${p.id}:${String(body.action ?? "meta")}`, async () => {
      await call(`/admin/private-pages/${orgId}/pages/${p.id}`, {
        method: "PATCH", body: JSON.stringify({ ...body, revision: p.revision }),
      });
      if (!body.action) setEdits((e) => { const n = { ...e }; delete n[p.id]; return n; });
    }, ok);

  function upload(p: Page, kind: AssetKind, file: File | undefined) {
    if (!file) return;
    const meta = KIND_META[kind];
    const key = `${p.id}:${kind}`;
    if (!meta.ext.test(file.name)) {
      setUploadErrors((u) => ({ ...u, [key]: `Rejected: ${file.name} is not a ${meta.label} file.` }));
      return;
    }
    if (file.size > meta.max) {
      setUploadErrors((u) => ({ ...u, [key]: `Rejected: ${fmt(file.size)} exceeds the ${fmt(meta.max)} limit.` }));
      return;
    }
    setUploadErrors((u) => { const n = { ...u }; delete n[key]; return n; });
    void run(`upload:${key}`, async () => {
      try {
        await call(`/admin/private-pages/${orgId}/pages/${p.id}/assets/${kind}`, {
          method: "PUT",
          body: file,
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Filename": encodeURIComponent(file.name),
            "X-Page-Revision": String(p.revision),
          },
        });
      } catch (e) {
        setUploadErrors((u) => ({ ...u, [key]: `Upload rejected: ${(e as Error).message}` }));
        throw e;
      }
    }, `${meta.label} uploaded — page reset to draft`);
  }

  const createAccount = () => run("acct:create", async () => {
    const res = await call<PasswordResult>(`/admin/private-pages/${orgId}/accounts`, {
      method: "POST", body: JSON.stringify({ username: newUsername.trim() }),
    });
    setNewUsername("");
    openSecret(res);
  });
  const rotate = (a: Account) => {
    if (!confirm(`Rotate the password for ${a.username}? The current password stops working immediately.`)) return;
    void run(`acct:${a.id}:rotate`, async () => {
      openSecret(await call<PasswordResult>(`/admin/private-pages/${orgId}/accounts/${a.id}/rotate`, { method: "POST" }));
    });
  };
  const disable = (a: Account) => {
    if (!confirm(`Disable ${a.username}? Active shared sessions will be ended.`)) return;
    void run(`acct:${a.id}:disable`, () => call(`/admin/private-pages/${orgId}/accounts/${a.id}/disable`, { method: "POST" }), "Account disabled");
  };

  function openSecret(r: PasswordResult) {
    setRevealed(false); setCopied(false); setSecret(r);
  }
  function closeSecret() {
    setSecret(null); setRevealed(false); setCopied(false);
  }
  async function copySecret() {
    if (!secret) return;
    try { await navigator.clipboard.writeText(secret.password); setCopied(true); } catch { setCopied(false); }
  }

  const previewHref = (p: Page) => `/galaxy/pages/${p.id}?previewOrg=${encodeURIComponent(orgId)}`;

  return (
    <>
      <Card className="p-6 lg:col-span-3 space-y-5" data-testid="private-pages-panel">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Private Galaxy pages</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Any title, slug or file change resets the page to draft. Review the current revision, then publish.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()}>Refresh</Button>
        </div>

        {loadError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm flex items-center justify-between gap-3">
            <span>Could not load: {loadError}</span>
            <Button size="sm" variant="outline" onClick={() => void load()}>Retry</Button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-end pb-4 border-b">
          <div>
            <Label htmlFor="pp-title">Title</Label>
            <Input id="pp-title" value={newTitle} onChange={(e) => { setNewTitle(e.target.value); setNewSlug(slugify(e.target.value)); }} placeholder="Q3 operating model briefing" />
          </div>
          <div>
            <Label htmlFor="pp-slug">Slug</Label>
            <Input id="pp-slug" value={newSlug} onChange={(e) => setNewSlug(slugify(e.target.value))} className="font-mono text-xs" />
          </div>
          <Button onClick={() => void createPage()} disabled={busy === "create" || !newTitle.trim() || !newSlug.trim()} data-testid="button-create-private-page">
            {busy === "create" ? "Creating…" : "Create page"}
          </Button>
        </div>

        {pages === null && !loadError ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : pages && pages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No private pages for this organization yet.</p>
        ) : (
          <div className="space-y-4">
            {(pages ?? []).map((p) => {
              const ed = edits[p.id] ?? { title: p.title, slug: p.slug };
              const dirty = ed.title !== p.title || ed.slug !== p.slug;
              const reviewed = p.reviewedRevision === p.revision;
              const hasHtml = p.assets.some((a) => a.kind === "html");
              const archived = p.status === "archived";
              const unassigned = p.organizationId === null;
              return (
                <div key={p.id} className="rounded-lg border border-border p-4 space-y-4" data-testid={`private-page-row-${p.id}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    {statusBadge(p)}
                    <span className="text-xs text-muted-foreground font-mono">rev {p.revision}{p.reviewedRevision !== null ? ` · reviewed rev ${p.reviewedRevision}` : ""}</span>
                    {unassigned ? (
                      <Button size="sm" className="ml-auto" disabled={busy !== null}
                        onClick={() => { if (confirm("Assign this intake draft to this organization?")) void patch(p, { action: "assign" }, "Assigned to this organization"); }}>
                        Assign to this organization
                      </Button>
                    ) : (
                      <a href={previewHref(p)} target="_blank" rel="noopener noreferrer" className="ml-auto text-xs text-primary underline">
                        Private preview
                      </a>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
                    <div>
                      <Label htmlFor={`t-${p.id}`}>Title</Label>
                      <Input id={`t-${p.id}`} value={ed.title} onChange={(e) => setEdits((s) => ({ ...s, [p.id]: { ...ed, title: e.target.value } }))} />
                    </div>
                    <div>
                      <Label htmlFor={`s-${p.id}`}>Slug</Label>
                      <Input id={`s-${p.id}`} value={ed.slug} className="font-mono text-xs" onChange={(e) => setEdits((s) => ({ ...s, [p.id]: { ...ed, slug: slugify(e.target.value) } }))} />
                    </div>
                    <Button variant="outline" disabled={!dirty || !ed.title.trim() || !ed.slug.trim() || busy !== null}
                      onClick={() => void patch(p, { title: ed.title.trim(), slug: ed.slug.trim() }, "Saved — page reset to draft")}>
                      Save details
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <p className="md:col-span-3 text-xs text-muted-foreground leading-relaxed">
                      HTML must be self-contained: embed raster images inline (data URIs), attach at most one MP3, and use only approved local scripts.
                      External links and remote resources are disabled for confidentiality.
                    </p>
                    {(Object.keys(KIND_META) as AssetKind[]).map((kind) => {
                      const meta = KIND_META[kind];
                      const asset = p.assets.find((a) => a.kind === kind);
                      const key = `${p.id}:${kind}`;
                      const inputId = `file-${key}`;
                      return (
                        <div key={kind} className="rounded-md bg-muted/40 p-3 space-y-2 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{meta.label}</span>
                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              {meta.required ? "required" : "optional"} · max {fmt(meta.max)}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {asset ? `${asset.filename} · ${fmt(asset.sizeBytes)}` : "Not uploaded"}
                          </div>
                          <input
                            id={inputId}
                            type="file"
                            accept={meta.accept}
                            className="sr-only"
                            disabled={busy !== null || unassigned}
                            onChange={(e) => { upload(p, kind, e.target.files?.[0]); e.target.value = ""; }}
                          />
                          <Button asChild size="sm" variant="outline" className={`w-full ${unassigned ? "pointer-events-none opacity-50" : ""}`}>
                            <label htmlFor={inputId} className="cursor-pointer" aria-disabled={unassigned}>
                              {busy === `upload:${key}` ? "Uploading…" : asset ? "Replace" : "Upload"}
                            </label>
                          </Button>
                          {uploadErrors[key] && <p role="alert" className="text-xs text-destructive">{uploadErrors[key]}</p>}
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap pt-2 border-t">
                    {unassigned && <span className="text-xs text-muted-foreground">Assign this draft before uploading, previewing, reviewing or publishing.</span>}
                    {!unassigned && p.status !== "published" && !archived && (
                      <>
                        <Button size="sm" variant="outline" disabled={reviewed || !hasHtml || busy !== null}
                          onClick={() => void patch(p, { action: "review" }, `Revision ${p.revision} marked reviewed`)}>
                          {reviewed ? "Reviewed" : "Mark reviewed"}
                        </Button>
                        <Button size="sm" disabled={!reviewed || busy !== null}
                          onClick={() => void patch(p, { action: "publish" }, "Published to customer")}>
                          Publish
                        </Button>
                        {!hasHtml && <span className="text-xs text-muted-foreground">Upload HTML before review.</span>}
                      </>
                    )}
                    {p.status === "published" && (
                      <Button size="sm" variant="outline" disabled={busy !== null}
                        onClick={() => void patch(p, { action: "unpublish" }, "Unpublished")}>
                        Unpublish
                      </Button>
                    )}
                    {!archived && (
                      <Button size="sm" variant="ghost" className="text-destructive ml-auto" disabled={busy !== null}
                        onClick={() => { if (confirm("Archive this page? Customers lose access.")) void patch(p, { action: "archive" }, "Archived"); }}>
                        Archive
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="p-6 lg:col-span-3 space-y-4" data-testid="shared-accounts-panel">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Shared organization logins</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Read-only access to published private pages. Activity is not attributable to an individual. Passwords are shown once.
          </p>
        </div>
        <div className="flex items-end gap-3 flex-wrap pb-4 border-b">
          <div className="flex-1 min-w-[200px]">
            <Label htmlFor="sa-username">Username</Label>
            <Input id="sa-username" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} autoComplete="off" className="font-mono text-sm" />
          </div>
          <Button onClick={() => void createAccount()} disabled={busy !== null || !newUsername.trim()} data-testid="button-create-shared-account">
            {busy === "acct:create" ? "Creating…" : "Create login"}
          </Button>
        </div>
        {accounts === null && !loadError ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : accounts && accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No shared logins.</p>
        ) : (
          <ul className="divide-y divide-border">
            {(accounts ?? []).map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-2">
                <span className="font-mono text-sm flex-1">{a.username}</span>
                {a.disabled ? <Badge variant="secondary">Disabled</Badge> : <Badge variant="outline">Active</Badge>}
                {!a.disabled && (
                  <>
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => rotate(a)}>Rotate password</Button>
                    <Button size="sm" variant="ghost" className="text-destructive" disabled={busy !== null} onClick={() => disable(a)}>Disable</Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Dialog open={!!secret} onOpenChange={(o) => { if (!o) closeSecret(); }}>
        <DialogContent onInteractOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Password for {secret?.account.username}</DialogTitle>
            <DialogDescription>
              Shown once. Share it through a secure channel. Closing this dialog discards it permanently.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border bg-muted/50 px-3 py-3 font-mono text-sm break-all select-all" aria-live="polite">
            {secret ? (revealed ? secret.password : "•".repeat(Math.min(secret.password.length, 24))) : ""}
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setRevealed((r) => !r)}>{revealed ? "Hide" : "Reveal"}</Button>
            <Button variant="outline" onClick={() => void copySecret()}>{copied ? "Copied" : "Copy"}</Button>
            <Button onClick={closeSecret}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
