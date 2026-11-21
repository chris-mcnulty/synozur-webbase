import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { FileText, Headphones, ScrollText, ArrowRight, Lock } from "lucide-react";
import { PortalSiteHeader } from "@/components/portal-site-header";
import { PortalSiteFooter } from "@/components/portal-site-footer";
import { SharedAccessNotice } from "@/components/shared-access-notice";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/auth";
import { isAuthError, listPrivatePages, type PrivatePage } from "@/lib/private-pages-api";

export default function PrivatePagesList() {
  const { user } = useAuth();
  const isShared = user?.authProvider === "shared_org";
  const [items, setItems] = useState<PrivatePage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) { setError(null); setItems(null); }
    try {
      setItems(await listPrivatePages());
    } catch (e) {
      setItems(null);
      setError(isAuthError(e) ? "Private pages are not available to this session." : "Private pages could not be loaded.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Revalidate so unpublished pages and revoked sessions drop off promptly.
  useEffect(() => {
    const tick = () => void load(true);
    const t = window.setInterval(tick, 30_000);
    window.addEventListener("focus", tick);
    return () => { window.clearInterval(t); window.removeEventListener("focus", tick); };
  }, [load]);

  return (
    <div className="min-h-screen flex flex-col">
      <PortalSiteHeader />
      <main className="flex-1 bg-background/95">
        <div className="container mx-auto px-4 md:px-6 py-10 max-w-4xl space-y-8">
          <header className="space-y-2">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2">
              <Lock className="h-3 w-3" /> Confidential
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">Private pages</h1>
            <p className="text-muted-foreground max-w-xl">
              Briefings prepared by Synozur for your organization. Not indexed, not shared outside your workspace.
            </p>
          </header>
          {isShared && <SharedAccessNotice />}

          {error ? (
            <Card className="p-8 text-center space-y-4">
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button variant="outline" onClick={() => void load()}>Try again</Button>
            </Card>
          ) : items === null ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
            </div>
          ) : items.length === 0 ? (
            <Card className="p-10 text-center space-y-2 border-dashed">
              <FileText className="h-8 w-8 mx-auto text-muted-foreground/60" />
              <p className="font-medium">Nothing published yet</p>
              <p className="text-sm text-muted-foreground">Pages appear here once your Synozur team publishes them.</p>
            </Card>
          ) : (
            <ol className="divide-y divide-border rounded-xl border border-border bg-card overflow-hidden">
              {items.map((p, i) => {
                const has = (k: string) => p.assets.some((a) => a.kind === k);
                return (
                  <li key={p.id}>
                    <Link
                      href={`/pages/${p.id}`}
                      className="group flex items-center gap-5 px-5 py-4 hover:bg-muted/60 transition-colors"
                      data-testid={`private-page-${p.id}`}
                    >
                      <span className="font-mono text-xs text-muted-foreground w-6">{String(i + 1).padStart(2, "0")}</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{p.title}</div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                          {has("html") && <span className="inline-flex items-center gap-1"><FileText className="h-3 w-3" />Page</span>}
                          {has("audio") && <span className="inline-flex items-center gap-1"><Headphones className="h-3 w-3" />Audio</span>}
                          {has("transcript") && <span className="inline-flex items-center gap-1"><ScrollText className="h-3 w-3" />Script</span>}
                        </div>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-1 transition-transform" />
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </main>
      <PortalSiteFooter />
    </div>
  );
}
