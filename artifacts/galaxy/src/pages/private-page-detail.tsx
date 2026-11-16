import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Eye, LogOut, RotateCw, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/auth";
import {
  downloadBlob,
  getPrivateAudio,
  getPrivateHtml,
  getPrivatePage,
  getPrivateTranscriptFile,
  isAuthError,
  PrivateApiError,
  type PrivatePage,
} from "@/lib/private-pages-api";

const UNAVAILABLE = "This page is no longer available to this session.";

export default function PrivatePageDetail({ id }: { id: string }) {
  const { user, refresh, signOut } = useAuth();
  const isShared = user?.authProvider === "shared_org";
  const previewOrg = new URLSearchParams(window.location.search).get("previewOrg");

  const [page, setPage] = useState<PrivatePage | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioReady, setAudioReady] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authLost, setAuthLost] = useState(false);
  const [loading, setLoading] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const revisionRef = useRef<number | null>(null);
  const loadSeq = useRef(0);

  const clearAll = useCallback(() => {
    setPage(null);
    setHtml(null);
    setAudioBlob(null);
    setAudioReady(false);
    setAttachmentError(null);
  }, []);

  const fail = useCallback(async (e: unknown) => {
    clearAll();
    revisionRef.current = null;
    const auth = isAuthError(e);
    setAuthLost(auth);
    setError(auth ? UNAVAILABLE : "This page could not be loaded.");
    if (e instanceof PrivateApiError && e.status === 401) await refresh();
  }, [clearAll, refresh]);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    setAuthLost(false);
    clearAll();
    try {
      const p = await getPrivatePage(id, previewOrg);
      const kinds = new Set(p.assets.map((a) => a.kind));
      const audioP = kinds.has("audio") ? getPrivateAudio(id, previewOrg) : Promise.resolve(null);
      audioP.catch(() => undefined);
      const h = kinds.has("html") ? await getPrivateHtml(id, previewOrg) : null;
      if (seq !== loadSeq.current) return;
      revisionRef.current = p.revision;
      setFrameLoaded(false);
      setPage(p);
      setHtml(h);
      setLoading(false);
      // Audio continues in parallel; HTML renders first.
      try {
        const a = await audioP;
        if (seq !== loadSeq.current) return;
        setAudioBlob(a);
        setAudioReady(true);
      } catch (e) {
        if (seq !== loadSeq.current) return;
        if (isAuthError(e)) await fail(e);
        else { setAttachmentError("Audio could not be loaded. Reload to retry."); setAudioReady(true); }
      }
    } catch (e) {
      if (seq !== loadSeq.current) return;
      await fail(e);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [id, previewOrg, clearAll, fail]);

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
        if (isAuthError(e)) await fail(e);
      }
    };
    const tick = () => void check();
    const t = window.setInterval(tick, 30_000);
    window.addEventListener("focus", tick);
    return () => { window.clearInterval(t); window.removeEventListener("focus", tick); };
  }, [id, previewOrg, load, fail]);

  const hasTranscript = !!page?.assets.some((a) => a.kind === "transcript");

  // Hand assets to the trusted in-frame bridge once frame + audio are ready.
  useEffect(() => {
    if (!frameLoaded || !audioReady) return;
    // Sandboxed frame has an opaque origin; "*" is the only valid target.
    iframeRef.current?.contentWindow?.postMessage(
      { type: "private-page-assets", ...(audioBlob ? { audioBlob } : {}), hasTranscript },
      "*",
    );
  }, [frameLoaded, audioReady, audioBlob, hasTranscript]);
  const onFrameLoad = useCallback(() => setFrameLoaded(true), []);

  const pageRef = useRef(page);
  pageRef.current = page;
  const audioRef = useRef(audioBlob);
  audioRef.current = audioBlob;

  const download = useCallback(async (kind: "audio" | "transcript") => {
    const p = pageRef.current;
    if (!p) return;
    const asset = p.assets.find((a) => a.kind === kind);
    if (!asset) return;
    try {
      if (kind === "audio") {
        const b = audioRef.current ?? (await getPrivateAudio(id, previewOrg));
        downloadBlob(b, asset.filename || "audio.mp3");
      } else {
        const b = await getPrivateTranscriptFile(id, previewOrg);
        downloadBlob(b, asset.filename || "narration-script.docx");
      }
    } catch (e) {
      if (isAuthError(e)) await fail(e);
      else setAttachmentError("The attachment could not be downloaded. Please try again.");
    }
  }, [id, previewOrg, fail]);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const win = iframeRef.current?.contentWindow;
      if (!win || ev.source !== win) return;
      const d = ev.data as { type?: unknown; kind?: unknown } | null;
      if (!d || typeof d !== "object" || d.type !== "private-page-download") return;
      if (d.kind !== "audio" && d.kind !== "transcript") return;
      void download(d.kind);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [download]);

  return (
    <div className="h-[100dvh] overflow-hidden flex flex-col bg-background">
      <header className="shrink-0 h-11 flex items-center gap-3 px-3 border-b border-border/70 bg-card/80 backdrop-blur text-sm">
        <Link href="/pages" aria-label="Back to private pages" className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground shrink-0">
          <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">Private pages</span>
        </Link>
        <span className="h-4 w-px bg-border shrink-0" />
        <span className="truncate font-medium min-w-0 flex-1">{page?.title ?? ""}</span>
        {previewOrg && (
          <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs text-primary shrink-0" title="Customers only see this once published.">
            <Eye className="h-3.5 w-3.5" /> Staff preview
          </span>
        )}
        {isShared && (
          <span className="hidden md:inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground shrink-0" title="You are signed in with a shared organization login.">
            <Users className="h-3.5 w-3.5" /> Shared access
          </span>
        )}
        {user && (
          <Button size="sm" variant="ghost" aria-label="Sign out" className="h-8 px-2 shrink-0" onClick={() => void signOut()}>
            <LogOut className="h-4 w-4 sm:mr-1.5" /> <span className="hidden sm:inline">Sign out</span>
          </Button>
        )}
      </header>
      {attachmentError && <div role="alert" className="shrink-0 px-3 py-2 text-sm bg-card border-b">{attachmentError} <button className="underline" onClick={() => void load()}>Reload</button></div>}

      <main className="flex-1 min-h-0 relative">
        {loading ? (
          <div className="p-4 space-y-3 h-full">
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-[calc(100%-3rem)] w-full" />
          </div>
        ) : error || !page ? (
          <div className="h-full flex items-center justify-center p-6">
            <div className="max-w-sm text-center space-y-4 rounded-xl border border-border bg-card p-8">
              <p className="text-sm text-foreground/80">{error ?? "This page was not found."}</p>
              <div className="flex justify-center gap-2 flex-wrap">
                <Button variant="outline" size="sm" onClick={() => void load()}>
                  <RotateCw className="h-4 w-4 mr-1.5" /> Reload
                </Button>
                {authLost && !user ? (
                  <Button size="sm" asChild><Link href="/pages">Sign in</Link></Button>
                ) : (
                  <Button size="sm" variant="ghost" asChild><Link href="/pages">Back to pages</Link></Button>
                )}
              </div>
            </div>
          </div>
        ) : html !== null ? (
          <iframe
            ref={iframeRef}
            title={page.title}
            srcDoc={html}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            onLoad={onFrameLoad}
            className="absolute inset-0 w-full h-full border-0 bg-card"
          />
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            This page has no content yet.
          </div>
        )}
      </main>
    </div>
  );
}
