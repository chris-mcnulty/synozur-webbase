import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useAdminAccess } from "@/components/admin/AdminGate";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
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
import { Copy, Check, Plus, RefreshCw, ShieldOff, ShieldCheck, Eye, EyeOff } from "lucide-react";
import {
  trafficPropertiesApi,
  type TrafficProperty,
} from "@/lib/traffic-properties-api";
import { Link } from "wouter";

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="ml-2 text-muted-foreground hover:text-foreground transition-colors"
      onClick={() => {
        void navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      title="Copy to clipboard"
      data-testid="btn-copy-key"
    >
      {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}

function SecretDisplay({ secret }: { secret: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex items-center gap-2 mt-2 p-3 bg-muted rounded-md font-mono text-xs break-all">
      <span className="flex-1" data-testid="text-api-key">
        {visible ? secret : "•".repeat(Math.min(secret.length, 40))}
      </span>
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
      <CopyButton value={secret} />
    </div>
  );
}

export default function TrafficPropertiesPage() {
  const { access } = useAdminAccess();
  const enabled = !!access?.hasCapability("content.moderate");
  const qc = useQueryClient();
  const { toast } = useToast();

  const propsQ = useQuery({
    queryKey: ["traffic-properties"],
    queryFn: () => trafficPropertiesApi.list(),
    enabled,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ slug: "", name: "", baseUrl: "", notes: "" });
  const [revealedKey, setRevealedKey] = useState<{ slug: string; key: string } | null>(null);

  const createM = useMutation({
    mutationFn: () =>
      trafficPropertiesApi.create({
        slug: createForm.slug,
        name: createForm.name,
        baseUrl: createForm.baseUrl || null,
        notes: createForm.notes || null,
        generateApiKey: true,
      }),
    onSuccess: (res) => {
      toast({ title: `Created property ${res.slug}` });
      if (res.apiKey) setRevealedKey({ slug: res.slug, key: res.apiKey });
      setCreateOpen(false);
      setCreateForm({ slug: "", name: "", baseUrl: "", notes: "" });
      void qc.invalidateQueries({ queryKey: ["traffic-properties"] });
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const rotateM = useMutation({
    mutationFn: (id: string) => trafficPropertiesApi.rotateKey(id),
    onSuccess: (res, id) => {
      const slug = propsQ.data?.items.find((p) => p.id === id)?.slug ?? "";
      toast({ title: `Rotated key for ${slug}` });
      setRevealedKey({ slug, key: res.apiKey });
      setRotatingId(null);
      void qc.invalidateQueries({ queryKey: ["traffic-properties"] });
    },
    onError: (e: Error) => {
      setRotatingId(null);
      toast({ title: "Rotate failed", description: e.message, variant: "destructive" });
    },
  });

  const [confirmDeactivate, setConfirmDeactivate] = useState<TrafficProperty | null>(null);
  const setActiveM = useMutation({
    mutationFn: (args: { id: string; isActive: boolean }) =>
      trafficPropertiesApi.patch(args.id, { isActive: args.isActive }),
    onSuccess: (_res, vars) => {
      toast({ title: vars.isActive ? "Property reactivated" : "Property deactivated" });
      void qc.invalidateQueries({ queryKey: ["traffic-properties"] });
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  return (
    <AdminLayout
      title="Traffic Properties"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Marketing" }, { label: "Traffic Properties" }]}
      actions={
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/marketing/traffic-import">
              {/* eslint-disable-next-line jsx-a11y/anchor-is-valid -- wouter <Link> injects href into the inner <a>. */}
              <a>Import data</a>
            </Link>
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="btn-create-property">
            <Plus className="h-4 w-4 mr-1" /> New property
          </Button>
        </div>
      }
    >
      {!enabled ? (
        <Card className="p-6 bg-muted/30">
          <p className="text-sm">You don&apos;t have access to traffic properties.</p>
        </Card>
      ) : (
        <>
          <Card className="p-4 mb-4 text-sm text-muted-foreground">
            <p>
              Properties are the registry of distinct Synozur web properties whose traffic is reported in this admin.
              The built-in <code>synozur</code> property captures live first-party traffic from this app.
              Add a new property for each sister app or legacy export, then either issue an API key (for live ingest
              {/* eslint-disable-next-line jsx-a11y/anchor-is-valid -- wouter <Link> injects href into the inner <a>. */}
              from a sister app) or use the <Link href="/marketing/traffic-import"><a className="underline">Import</a></Link>{" "}
              page to upload JSON / CSV exports.
            </p>
          </Card>

          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2">Slug</th>
                  <th className="text-left px-4 py-2">Name</th>
                  <th className="text-left px-4 py-2">API key</th>
                  <th className="text-left px-4 py-2">Last ingested</th>
                  <th className="text-left px-4 py-2">Status</th>
                  <th className="text-right px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(propsQ.data?.items ?? []).map((p) => (
                  <tr key={p.id} className="border-t border-border" data-testid={`row-property-${p.slug}`}>
                    <td className="px-4 py-3 font-mono text-xs">{p.slug}</td>
                    <td className="px-4 py-3">
                      <div>{p.name}</div>
                      {p.baseUrl && <div className="text-xs text-muted-foreground">{p.baseUrl}</div>}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {p.isDefault ? (
                        <span className="text-muted-foreground italic">native (no key)</span>
                      ) : p.hasApiKey ? (
                        <span className="font-mono">{p.apiKeyPrefix}…</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {p.lastIngestedAt ? new Date(p.lastIngestedAt).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {p.isDefault ? (
                        <Badge variant="secondary">default</Badge>
                      ) : p.isActive ? (
                        <Badge>active</Badge>
                      ) : (
                        <Badge variant="outline">inactive</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!p.isDefault && (
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={rotatingId === p.id}
                            onClick={() => {
                              setRotatingId(p.id);
                              rotateM.mutate(p.id);
                            }}
                            data-testid={`btn-rotate-${p.slug}`}
                          >
                            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Rotate key
                          </Button>
                          {p.isActive ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setConfirmDeactivate(p)}
                              data-testid={`btn-deactivate-${p.slug}`}
                            >
                              <ShieldOff className="h-3.5 w-3.5 mr-1" /> Deactivate
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setActiveM.mutate({ id: p.id, isActive: true })}
                            >
                              <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Reactivate
                            </Button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {propsQ.data && propsQ.data.items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                      No properties yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New traffic property</DialogTitle>
            <DialogDescription>
              An API key will be generated and shown once. Use it as a Bearer token when POSTing to
              <code> /api/traffic/ingest</code>.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div>
              <Label>Slug</Label>
              <Input
                value={createForm.slug}
                onChange={(e) => setCreateForm({ ...createForm, slug: e.target.value })}
                placeholder="galaxy"
                data-testid="input-slug"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Lowercase letters, digits and dashes. This is the value stored on every traffic row.
              </p>
            </div>
            <div>
              <Label>Name</Label>
              <Input
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                placeholder="Galaxy"
                data-testid="input-name"
              />
            </div>
            <div>
              <Label>Base URL (optional)</Label>
              <Input
                value={createForm.baseUrl}
                onChange={(e) => setCreateForm({ ...createForm, baseUrl: e.target.value })}
                placeholder="https://galaxy.synozur.com"
              />
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Textarea
                value={createForm.notes}
                onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createM.mutate()}
              disabled={!createForm.slug || !createForm.name || createM.isPending}
              data-testid="btn-create-submit"
            >
              Create &amp; issue key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revealed key dialog */}
      <Dialog open={!!revealedKey} onOpenChange={(open) => { if (!open) setRevealedKey(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API key for {revealedKey?.slug}</DialogTitle>
            <DialogDescription>
              Copy this key now — it will not be shown again. Use it as
              <code> Authorization: Bearer {"<key>"}</code> when calling <code>/api/traffic/ingest</code>.
            </DialogDescription>
          </DialogHeader>
          {revealedKey && <SecretDisplay secret={revealedKey.key} />}
          <DialogFooter>
            <Button onClick={() => setRevealedKey(null)}>I&apos;ve saved it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deactivate confirm */}
      <AlertDialog open={!!confirmDeactivate} onOpenChange={(open) => { if (!open) setConfirmDeactivate(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {confirmDeactivate?.slug}?</AlertDialogTitle>
            <AlertDialogDescription>
              The API key will stop accepting new ingest batches. Existing data is preserved and remains visible
              in the dashboard. You can reactivate at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDeactivate) setActiveM.mutate({ id: confirmDeactivate.id, isActive: false });
                setConfirmDeactivate(null);
              }}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
