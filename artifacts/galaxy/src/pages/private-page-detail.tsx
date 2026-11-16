import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Download, Eye } from "lucide-react";
import { PortalSiteHeader } from "@/components/portal-site-header";
import { PortalSiteFooter } from "@/components/portal-site-footer";
import { SharedAccessNotice } from "@/components/shared-access-notice";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/auth";
import {
  downloadBlob,
  formatBytes,
  getPrivateAudio,
  getPrivateHtml,
  getPrivatePage,
  getPrivateScript,
  getPrivateTranscriptFile,
  isAuthError,
  type PrivatePage,
} from "@/lib/private-pages-api";

export default function PrivatePageDetail({ id }: { id: string }) {
  const { user } = useAuth();
  const isShared = user?.authProvider === "shared_org";
  const previewOrg = new URLSearchParams(window.location.search).get("previewOrg");

  const [page, setPage] = useState<PrivatePage | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [script, setScript] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const revisionRef = useRef<number | null>(null);

  const clearAll = useCallback(() => {
    setPage(null);
    setHtml(null);
    setAudioBlob(null);
    setScript(null);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    clearAll();
    try {
      const p = await getPrivatePage(id, previewOrg);
      const kinds = new Set(p.assets.map((a) => a.kind));
      const [h, a, s] = await Promise.all([
        kinds.has("html") ? getPrivateHtml(id, previewOrg) : Promise.resolve(null),
        kinds.has("audio") ? getPrivateAudio(id, previewOrg) : Promise.resolve(null),
        kinds.has("transcript") ? getPrivateScript(id, previewOrg) : Promise.resolve(null),
      ]);
      revisionRef.current = p.revision;
      setFrameLoaded(false);
      setPage(p);
      setHtml(h);
      setAudioBlob(a);
      setScript(s);
    } catch (e) {
      clearAll();
      revisionRef.current = null;
      setError(isAuthError(e) ? "This page is no longer available to this session." : "This page could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [id, previewOrg, clearAll]);

  useEffect(() => { void load(); }, [load]);

  // Revalidate every 30s and on focus. Unpublish, cross-org or revoked
  // sessions (401/403/404) clear all displayed content and Blobs.
  useEffect(() => {
    const check = async () => {
      if (revisionRef.current === null) return;
      try {
        const p = await getPrivatePage(id, previewOrg);
        if (p.revision !== revisionRef.current) void load();
      } catch (e) {
        if (isAuthError(e)) {
          clearAll();
          revisionRef.current = null;
          setError("This page is no longer available to this session.");
        }
      }
    };
    const tick = () => void check();
    const t = window.setInterval(tick, 30_000);
    window.addEventListener("focus", tick);
    return () => { window.clearInterval(t); window.removeEventListener("focus", tick); };
  }, [id, previewOrg, load, clearAll]);

  useEffect(() => {
    if (!audioBlob) { setAudioUrl(null); return; }
    const u = URL.createObjectURL(audioBlob);
    setAudioUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [audioBlob]);

  // Send whenever both the frame has loaded and the blob is present,
  // regardless of which arrives first.
  useEffect(() => {
    if (!frameLoaded || !audioBlob) return;
    // Sandboxed frame has an opaque origin; "*" is the only valid target.
    iframeRef.current?.contentWindow?.postMessage({ type: "private-page-audio", blob: audioBlob }, "*");
  }, [frameLoaded, audioBlob]);
  const onFrameLoad = useCallback(() => setFrameLoaded(true), []);

  async function download(kind: "audio" | "transcript") {
    if (!page) return;
    const asset = page.assets.find((a) => a.kind === kind);
    try {
      if (kind === "audio") {
        const b = audioBlob ?? (await getPrivateAudio(id, previewOrg));
        downloadBlob(b, asset?.filename ?? "audio.mp3");
      } else {
        const b = await getPrivateTranscriptFile(id, previewOrg);
        downloadBlob(b, asset?.filename ?? "narration-script.docx");
      }
    } catch (e) {
      if (isAuthError(e)) { clearAll(); revisionRef.current = null; setError("This page is no longer available to this session."); }
    }
  }

  const audioAsset = page?.assets.find((a) => a.kind === "audio");
  const scriptAsset = page?.assets.find((a) => a.kind === "transcript");

  return (
    <div className="min-h-screen flex flex-col">
      <PortalSiteHeader />
      <main className="flex-1 bg-background/95">
        <div className="container mx-auto px-4 md:px-6 py-8 max-w-5xl space-y-6">
          <Link href="/pages" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Private pages
          </Link>
          {previewOrg && (
            <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-4 py-2 text-sm">
              <Eye className="h-4 w-4 text-primary" /> Staff preview. Customers only see this once published.
            </div>
          )}
          {isShared && <SharedAccessNotice />}

          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-9 w-2/3" />
              <Skeleton className="h-[480px] w-full" />
            </div>
          ) : error || !page ? (
            <Card className="p-8 text-center space-y-4">
              <p className="text-sm text-muted-foreground">{error ?? "Not found."}</p>
              <Button variant="outline" onClick={() => void load()}>Try again</Button>
            </Card>
          ) : (
            <>
              <h1 className="text-3xl font-semibold tracking-tight">{page.title}</h1>

              {audioUrl && (
                <Card className="p-4 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">Narration</p>
                    <Button size="sm" variant="ghost" onClick={() => void download("audio")}>
                      <Download className="h-4 w-4 mr-1.5" /> Audio{audioAsset ? ` (${formatBytes(audioAsset.sizeBytes)})` : ""}
                    </Button>
                  </div>
                  <audio controls src={audioUrl} className="w-full" aria-label="Page narration audio" preload="metadata" />
                </Card>
              )}

              {html !== null && (
                <iframe
                  ref={iframeRef}
                  title="Private page content"
                  srcDoc={html}
                  sandbox="allow-scripts"
                  referrerPolicy="no-referrer"
                  onLoad={onFrameLoad}
                  className="w-full min-h-[75vh] rounded-xl border border-border bg-card"
                />
              )}

              {script !== null && (
                <Card className="p-6 space-y-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <h2 className="text-sm font-semibold">
                      Supplied narration script — not a verified verbatim transcription
                    </h2>
                    <Button size="sm" variant="ghost" onClick={() => void download("transcript")}>
                      <Download className="h-4 w-4 mr-1.5" /> Download narration script{scriptAsset ? ` (${formatBytes(scriptAsset.sizeBytes)})` : ""}
                    </Button>
                  </div>
                  <div className="space-y-3 text-sm leading-relaxed text-foreground/85 max-w-prose">
                    {script.split(/\n{2,}/).map((para, i) => (
                      <p key={i} className="whitespace-pre-wrap">{para}</p>
                    ))}
                  </div>
                </Card>
              )}
            </>
          )}
        </div>
      </main>
      <PortalSiteFooter />
    </div>
  );
}
