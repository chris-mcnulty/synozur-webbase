import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetAdminPortalMessage, useSaveAdminPortalMessage, type PortalMessageInput } from "@workspace/api-client-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";

export default function PortalMessageEditor() {
  const qc = useQueryClient();
  const query = useGetAdminPortalMessage({ query: { queryKey: ["admin-portal-message"], staleTime: 0 } });
  const [form, setForm] = useState<PortalMessageInput | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => { if (query.data) setForm(current => current ?? query.data); }, [query.data]);
  const save = useSaveAdminPortalMessage({
    mutation: {
      onSuccess: data => {
        setForm(data);
        qc.setQueryData(["admin-portal-message"], data);
        setNotice(data.visible ? "Saved. The message is visible in Galaxy." : "Saved. The message is hidden in Galaxy.");
      },
    },
  });
  function change<K extends keyof PortalMessageInput>(key: K, value: PortalMessageInput[K]) {
    setForm(current => current ? { ...current, [key]: value } : current);
    setNotice(""); save.reset();
  }
  return (
    <AdminLayout title="Galaxy CEO message">
      <div className="max-w-3xl space-y-6">
        <p className="text-muted-foreground">Edit “A note from the CEO” on the Galaxy homepage. This message is shared across customer organizations. Save changes to apply them.</p>
        {query.isError ? <Card className="p-6 space-y-3"><p role="alert">The message could not be loaded.</p><Button onClick={() => void query.refetch()}>Retry</Button></Card> :
          !form ? <p>Loading…</p> : (
            <form className="space-y-6" onSubmit={e => { e.preventDefault(); save.mutate({ data: form }); }}>
              <Card className="p-6 space-y-5">
                <fieldset disabled={save.isPending} className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="ceo-message">Message</Label>
                    <Textarea id="ceo-message" rows={10} maxLength={10000} value={form.message} onChange={e => change("message", e.target.value)} />
                    <p className="text-xs text-muted-foreground">Plain text; paragraph breaks are preserved. {form.message.length.toLocaleString()} / 10,000 characters.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ceo-signature">Author / signature</Label>
                    <Input id="ceo-signature" maxLength={200} value={form.signature} onChange={e => change("signature", e.target.value)} placeholder="Name, CEO" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ceo-quarter">Quarter label</Label>
                    <Input id="ceo-quarter" maxLength={80} value={form.quarterLabel} onChange={e => change("quarterLabel", e.target.value)} placeholder="Q4 2026" />
                    <p className="text-xs text-muted-foreground">Optional. This stays as written until you change it.</p>
                  </div>
                  <label className="flex items-center gap-3">
                    <input type="checkbox" checked={form.visible} onChange={e => change("visible", e.target.checked)} />
                    Show message in Galaxy
                  </label>
                </fieldset>
                {form.visible && !form.message.trim() && <p role="alert" className="text-sm text-destructive">Enter a message before making it visible.</p>}
                {save.isError && <p role="alert" className="text-sm text-destructive">Could not save: {save.error.message}</p>}
                {notice && <p role="status" className="text-sm">{notice}</p>}
                <Button type="submit" disabled={save.isPending || (form.visible && !form.message.trim())}>{save.isPending ? "Saving…" : "Save message"}</Button>
              </Card>
              <section className="space-y-2">
                <h2 className="font-semibold">Preview {form.visible ? "" : "(hidden until enabled)"}</h2>
                <Card className="p-6 space-y-4 border-violet-500/30">
                  <div className="flex justify-between gap-4"><strong>A note from the CEO</strong><span>{form.quarterLabel}</span></div>
                  <p className="whitespace-pre-wrap break-words">{form.message || "Your message will appear here."}</p>
                  {form.signature && <p className="text-sm text-muted-foreground">— {form.signature}</p>}
                </Card>
              </section>
            </form>
          )}
      </div>
    </AdminLayout>
  );
}
