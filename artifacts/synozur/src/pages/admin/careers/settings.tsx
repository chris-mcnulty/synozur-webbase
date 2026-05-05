import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { careersApi, type CareersSettings } from "@/lib/careers-api";

export default function CareersSettingsPage() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["admin-careers-settings"],
    queryFn: () => careersApi.adminGetSettings(),
  });
  const [form, setForm] = useState<CareersSettings>({
    mode: "native",
    externalUrl: null,
    eeoEnabled: true,
    defaultHiringManager: null,
  });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      careersApi.adminPatchSettings({
        mode: form.mode,
        externalUrl: form.externalUrl ?? null,
        eeoEnabled: form.eeoEnabled,
        defaultHiringManager: form.defaultHiringManager ?? null,
      }),
    onSuccess: () => {
      setSaved(true);
      setError(null);
      qc.invalidateQueries({ queryKey: ["admin-careers-settings"] });
      qc.invalidateQueries({ queryKey: ["careers", "settings"] });
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <AdminLayout title="Careers settings">
      <h1 className="text-2xl font-semibold mb-6">Careers settings</h1>
      <form
        className="space-y-5 max-w-xl"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div>
          <Label>Section mode</Label>
          <div className="flex gap-4 mt-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={form.mode === "native"}
                onChange={() => setForm({ ...form, mode: "native" })}
                data-testid="radio-mode-native"
              />
              Hosted natively (/careers in this app)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={form.mode === "redirect"}
                onChange={() => setForm({ ...form, mode: "redirect" })}
                data-testid="radio-mode-redirect"
              />
              301 redirect to external URL
            </label>
          </div>
        </div>
        <div>
          <Label>External careers URL</Label>
          <Input
            value={form.externalUrl ?? ""}
            onChange={(e) => setForm({ ...form, externalUrl: e.target.value || null })}
            placeholder="https://careers.example.com"
            data-testid="input-external-url"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Required when mode is "redirect". The path tail is preserved
            (e.g. /careers/jobs/foo → https://careers.example.com/jobs/foo).
          </p>
        </div>
        <div>
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- Radix Checkbox renders a button, not a native input the rule recognises. */}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={form.eeoEnabled}
              onCheckedChange={(v) => setForm({ ...form, eeoEnabled: v === true })}
              data-testid="checkbox-eeo-enabled"
            />
            Show voluntary EEO self-identification on apply form
          </label>
        </div>
        <div>
          <Label>Default hiring manager email (fallback)</Label>
          <Input
            type="email"
            value={form.defaultHiringManager ?? ""}
            onChange={(e) => setForm({ ...form, defaultHiringManager: e.target.value || null })}
            placeholder="hr@example.com"
            data-testid="input-default-hm"
          />
        </div>
        {error && <div className="text-destructive text-sm" data-testid="settings-error">{error}</div>}
        {saved && <div className="text-emerald-400 text-sm" data-testid="settings-saved">Saved.</div>}
        <Button type="submit" disabled={save.isPending} data-testid="button-save-settings">
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </form>
    </AdminLayout>
  );
}
