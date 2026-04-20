import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

export default function AdminSiteSettings() {
  const qc = useQueryClient();
  const [showSaved, setShowSaved] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-site-settings"],
    queryFn: () => api.getAdminSiteSettings(),
  });

  const [requireConsent, setRequireConsent] = useState<boolean | null>(null);

  useEffect(() => {
    if (data && requireConsent === null) {
      setRequireConsent(data.requireCookieConsent);
    }
  }, [data, requireConsent]);

  const updateMutation = useMutation({
    mutationFn: (next: boolean) => api.updateAdminSiteSettings({ requireCookieConsent: next }),
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: ["admin-site-settings"] });
      const prev = qc.getQueryData(["admin-site-settings"]);
      setRequireConsent(next);
      return { prev };
    },
    onError: (_err, _next, ctx) => {
      if (ctx?.prev) {
        const prevTyped = ctx.prev as { requireCookieConsent: boolean };
        setRequireConsent(prevTyped.requireCookieConsent);
      }
    },
    onSuccess: (result) => {
      qc.setQueryData(["admin-site-settings"], result);
      qc.invalidateQueries({ queryKey: ["public-site-settings"] });
      setShowSaved(true);
      setTimeout(() => setShowSaved(false), 2000);
    },
  });

  const current = requireConsent ?? data?.requireCookieConsent ?? false;

  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl">
      <div className="mb-6">
        <Link href="/admin">
          <Button variant="ghost" size="sm" data-testid="button-back-to-admin">
            <ArrowLeft className="h-4 w-4 mr-2" /> Back to admin
          </Button>
        </Link>
      </div>
      <h1 className="text-3xl font-bold mb-2">Site Settings</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Configure public site behavior. Changes take effect immediately.
      </p>

      {isLoading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : (
        <div className="rounded-md border border-border p-6 space-y-4">
          <div className="flex items-start justify-between gap-6">
            <div>
              <h2 className="text-lg font-semibold mb-1">Require cookie consent</h2>
              <p className="text-sm text-muted-foreground max-w-xl">
                When ON, visitors see a cookie consent banner and marketing tags
                (GA4, LinkedIn Insight, Meta Pixel) only load after they click Accept.
                When OFF, the banner is hidden and marketing tags load for everyone.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={current}
              disabled={updateMutation.isPending}
              onClick={() => updateMutation.mutate(!current)}
              data-testid="toggle-require-cookie-consent"
              className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50 ${
                current ? "bg-primary" : "bg-muted"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-background shadow ring-0 transition ${
                  current ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
          <div className="h-5 text-sm text-muted-foreground flex items-center gap-2">
            {showSaved && (
              <span className="inline-flex items-center gap-1 text-green-600" data-testid="text-saved-indicator">
                <Check className="h-4 w-4" /> Saved
              </span>
            )}
            {updateMutation.isError && (
              <span className="text-destructive">Failed to save. Please try again.</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
