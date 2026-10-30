import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Download,
  FileUp,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  XCircle,
  Lock,
  Clock,
  BookOpen,
} from "lucide-react";
import {
  getListChapterAudioQueryKey,
  useActionChapterAudio,
  useCreateChapterAudio,
  useExtractChapterAudio,
  useListChapterAudio,
  type ChapterAudioExtraction,
  type ChapterAudioJob,
} from "@workspace/api-client-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useAdminAccess } from "@/components/admin/AdminGate";
import { Meta } from "@/lib/meta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { CostAdminPanel, JobCostDetails, NarrationEstimate } from "@/components/admin/ChapterAudioCosts";
import { chapterStatusText, chapterStageLabel } from "@/lib/chapter-audio-status";
import { fetchChapterAudio } from "@/lib/chapter-audio-download";

export const CHAPTER_AUDIO_ROLES = ["admin", "site_admin", "editor", "content_author"] as const;
const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const WORDS_PER_MINUTE = 150;

export function hasChapterAudioRole(roles: readonly string[] | undefined | null): boolean {
  return !!roles?.some((r) => (CHAPTER_AUDIO_ROLES as readonly string[]).includes(r));
}

function countWords(s: string): number {
  const t = s.trim();
  return t ? t.split(/\s+/).length : 0;
}

function listening(words: number): string {
  const mins = Math.max(1, Math.round(words / WORDS_PER_MINUTE));
  if (words === 0) return "0 min";
  if (mins < 60) return `~${mins} min`;
  return `~${Math.floor(mins / 60)} h ${mins % 60} min`;
}

function errMessage(e: unknown, fallback: string): string {
  if (e && typeof e === "object") {
    const d = (e as { data?: unknown }).data;
    if (d && typeof d === "object" && typeof (d as { error?: unknown }).error === "string") {
      return (d as { error: string }).error;
    }
    if (e instanceof Error && e.message) return e.message;
  }
  return fallback;
}

function fmtDate(s: string): string {
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function voiceLabel(v: string): string {
  // e.g. en-US-Ava:DragonHDLatestNeural -> Ava (en-US)
  const m = v.match(/^([a-z]{2}-[A-Z]{2})-([A-Za-z0-9]+):/);
  if (!m) return v;
  const name = m[2] === "Andrew2" ? "Andrew 2 — Conversational"
    : m[2] === "Emma2" ? "Emma 2 — Conversational" : m[2];
  return `${name} (${m[1]})`;
}

const STATUS_STYLE: Record<string, string> = {
  queued: "bg-muted text-muted-foreground",
  processing: "bg-primary/15 text-primary",
  completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  failed: "bg-destructive/15 text-destructive",
  cancelled: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  expired: "bg-muted text-muted-foreground line-through",
  deleting: "bg-muted text-muted-foreground",
};

export default function ChapterAudioPage() {
  const { access, isLoading } = useAdminAccess();
  const roles: readonly string[] = access?.cmsUser?.roles ?? [];
  const allowed = hasChapterAudioRole(roles);

  return (
    <AdminLayout title="Chapter Audio" crumbs={[{ label: "Library" }, { label: "Chapter Audio" }]}>
      <Meta title="Chapter Audio" noindex />
      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : !allowed ? (
        <div className="max-w-lg mx-auto text-center py-16" data-testid="chapter-audio-denied">
          <Lock className="h-8 w-8 mx-auto text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">Permission denied</h2>
          <p className="text-sm text-muted-foreground">
            Chapter Audio is available to admins, site admins, editors and content authors only.
          </p>
        </div>
      ) : (
        <ChapterAudioWorkspace />
      )}
    </AdminLayout>
  );
}

function ChapterAudioWorkspace() {
  const list = useListChapterAudio({ query: { queryKey: getListChapterAudioQueryKey(), refetchInterval: 4000 } });
  const data = list.data;
  const qc = useQueryClient();
  const statusRef = useRef<HTMLDivElement>(null);
  const [lastSubmittedId, setLastSubmittedId] = useState<string | null>(() => {
    try { return sessionStorage.getItem("chapterAudio:lastSubmittedId"); } catch { return null; }
  });
  const currentJob = lastSubmittedId
    ? data?.jobs.find(job => job.id === lastSubmittedId)
    : data?.jobs[0];
  const onSubmitted = (job: ChapterAudioJob) => {
    setLastSubmittedId(job.id);
    try { sessionStorage.setItem("chapterAudio:lastSubmittedId", job.id); } catch { /* status still updates in this tab */ }
    qc.setQueryData<typeof data>(getListChapterAudioQueryKey(), previous =>
      previous ? { ...previous, jobs: [job, ...previous.jobs.filter(existing => existing.id !== job.id)].slice(0, 200) } : previous);
    requestAnimationFrame(() => statusRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <div ref={statusRef} className="xl:col-span-2 rounded-xl border border-border bg-card p-5" data-testid="chapter-audio-status-panel" role="status" aria-live="polite">
        <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Chapter status</p>
        {list.isLoading ? (
          <p className="text-sm text-muted-foreground mt-2">Checking chapter status…</p>
        ) : list.isError ? (
          <div className="mt-2"><p className="text-sm text-destructive">Could not check the queue. Your submission status is unknown.</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void list.refetch()}>Check again</Button></div>
        ) : currentJob ? (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">{lastSubmittedId ? "Your last submission" : "Latest staff narration"}</p>
              <p className="font-semibold">{currentJob.title}</p>
              <p className="text-sm text-muted-foreground" data-testid="chapter-audio-current-status">{chapterStatusText(currentJob)}</p>
              {currentJob.error && <p className="text-sm text-destructive mt-1">{currentJob.error}</p>}
            </div>
            <a href={`#chapter-job-${currentJob.id}`} className="text-sm text-primary underline underline-offset-2">
              View narration and actions
            </a>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground mt-2">
            {lastSubmittedId
              ? "Your last submission is no longer in the recent narrations list. Check the list below."
              : "No chapters are queued. Uploading a file only extracts its text; select Queue chapter for narration to submit it."}
          </p>
        )}
        <p className="text-xs text-muted-foreground mt-2">Status refreshes every 4 seconds while this page is open. You can leave and return to check later.</p>
      </div>
      <section>
        <header className="mb-5">
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Private editorial workspace</p>
          <h2 className="text-lg font-semibold mt-1">Narrate one reviewed chapter, word for word</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-prose">
            Text is read exactly as written by a Dragon HD voice. Nothing is rewritten or summarised.
            Uploaded files are used only for extraction and are not kept.
          </p>
        </header>
        {list.isLoading ? (
          <Skeleton className="h-[520px] w-full" />
        ) : list.isError || !data ? (
          <ErrorBox message={errMessage(list.error, "Could not load Chapter Audio.")} onRetry={() => void list.refetch()} />
        ) : (
          <NewNarrationForm
            onSubmitted={onSubmitted}
            voices={data.voices}
            configured={data.configured}
            maxWords={data.maxWords}
            retentionDays={data.retentionDays}
            pricingRateId={data.pricing.currentRate?.id ?? null}
          />
        )}
      </section>
      <section>
        <header className="mb-5 flex items-end justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Shared with staff</p>
            <h2 className="text-lg font-semibold mt-1">Narrations</h2>
          </div>
          {data && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" /> Expire {data.retentionDays} days after submission
            </span>
          )}
        </header>
        {list.isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
        ) : data ? (
          data.jobs.length === 0 ? (
            <div className="border border-dashed border-border rounded-lg p-10 text-center" data-testid="chapter-audio-empty">
              <BookOpen className="h-7 w-7 mx-auto text-muted-foreground mb-3" />
              <p className="font-medium">No narrations yet</p>
              <p className="text-sm text-muted-foreground mt-1">Submitted chapters appear here for every permitted staff member.</p>
            </div>
          ) : (
            <ul className="space-y-3" id="chapter-narrations">
              {data.jobs.map((j) => <JobRow key={j.id} job={j} />)}
            </ul>
          )
        ) : null}
      </section>
      {data?.pricing && <div className="xl:col-span-2"><CostAdminPanel pricing={data.pricing} /></div>}
    </div>
  );
}

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-5 text-sm" data-testid="chapter-audio-error">
      <p className="flex items-center gap-2 text-destructive font-medium"><AlertTriangle className="h-4 w-4" />{message}</p>
      <Button size="sm" variant="outline" className="mt-3" onClick={onRetry} data-testid="button-retry-load">Retry</Button>
    </div>
  );
}

function NewNarrationForm({ voices, configured, maxWords, retentionDays, pricingRateId, onSubmitted }: { voices: string[]; configured: boolean; maxWords: number; retentionDays: number; pricingRateId: string | null; onSubmitted: (job: ChapterAudioJob) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [notes, setNotes] = useState("");
  const [appendNotes, setAppendNotes] = useState(false);
  const [voice, setVoice] = useState<string>(voices[0] ?? "");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // The generated extract function JSON-stringifies the Blob body, so we
  // override mutationFn to stream the raw file bytes to the same endpoint.
  const extract = useExtractChapterAudio({
    mutation: {
      mutationFn: async ({ data, params }) => {
        const res = await fetch(`${BASE}/api/cms/chapter-audio/extract?filename=${encodeURIComponent(params.filename)}`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/octet-stream" },
          body: data,
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error((body && typeof body.error === "string" && body.error) || `Extraction failed (${res.status})`);
        return body as ChapterAudioExtraction;
      },
    },
  });
  const create = useCreateChapterAudio();

  const effectiveVoice = voice || voices[0] || "";
  const words = countWords(text) + (appendNotes && notes.trim() ? countWords(notes) + 2 : 0);
  const over = words > maxWords;
  const blank = !title.trim() || !text.trim();
  const disabled = blank || over || !configured || create.isPending || extract.isPending || !effectiveVoice;

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setExtractError(null);
    if (file.size > MAX_FILE_BYTES) { setExtractError("File exceeds the 10 MB limit."); return; }
    if (!/\.(txt|md|docx)$/i.test(file.name)) { setExtractError("Upload a .txt, .md or .docx file."); return; }
    extract.mutate(
      { data: file, params: { filename: file.name } },
      {
        onSuccess: (r) => {
          setText(r.text);
          setNotes(r.notes);
          setWarnings(r.warnings);
          if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, ""));
        },
        onError: (err) => setExtractError(errMessage(err, "Could not extract text. Your existing text is unchanged.")),
      },
    );
  };

  const submit = () => {
    setSubmitError(null);
    create.mutate(
      { data: { title: title.trim(), text, notes: notes || undefined, appendNotes, voice: effectiveVoice } },
      {
        onSuccess: (job) => {
          onSubmitted(job);
          toast({ title: "Narration queued", description: job.title });
          void qc.invalidateQueries({ queryKey: getListChapterAudioQueryKey() });
          setTitle(""); setText(""); setNotes(""); setWarnings([]); setAppendNotes(false); setExtractError(null);
        },
        onError: (err) => setSubmitError(errMessage(err, "Could not start narration.")),
      },
    );
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-5">
      {!configured && (
        <p className="rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-sm text-amber-800 dark:text-amber-200" data-testid="text-not-configured">
          Speech service is not configured. Narration is unavailable until an administrator connects it.
        </p>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="ca-title">Chapter title</Label>
        <Input id="ca-title" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Chapter 4 — The Long Middle" data-testid="input-title" />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="ca-text">Chapter text</Label>
          <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={extract.isPending} data-testid="button-upload">
            {extract.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <FileUp className="h-3.5 w-3.5 mr-1.5" />}
            Upload .txt, .md, .docx
          </Button>
          <input ref={fileRef} type="file" accept=".txt,.md,.docx" className="hidden" onChange={onFile} data-testid="input-file" />
        </div>
        <Textarea id="ca-text" value={text} onChange={(e) => { setText(e.target.value); setExtractError(null); }} rows={14}
          className="font-serif text-[15px] leading-relaxed" placeholder="Paste the reviewed chapter here, or upload a file. Extracted text stays editable."
          data-testid="input-text" />
        <p className="text-xs text-muted-foreground">Uploading fills this text box; it does not submit the chapter. Review the text, then select Queue chapter for narration below.</p>
        {extractError && <p className="text-sm text-destructive" data-testid="text-extract-error">{extractError}</p>}
        {warnings.length > 0 && (
          <ul className="text-xs text-amber-700 dark:text-amber-300 space-y-0.5" data-testid="list-warnings">
            {warnings.map((w, i) => <li key={i} className="flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />{w}</li>)}
          </ul>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ca-notes">Notes and endnotes</Label>
        <Textarea id="ca-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} placeholder="Footnotes or endnotes. Omitted from narration by default." data-testid="input-notes" />
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={appendNotes} onCheckedChange={(v) => setAppendNotes(v === true)} data-testid="checkbox-append-notes" />
          Append notes after the chapter
        </label>
      </div>

      <div className="space-y-1.5">
        <Label>Dragon HD voice</Label>
        <div className="flex gap-2">
          <Select value={effectiveVoice} onValueChange={setVoice} disabled={voices.length === 0}>
            <SelectTrigger className="flex-1" data-testid="select-voice"><SelectValue placeholder="No voices available" /></SelectTrigger>
            <SelectContent>
              {voices.map((v) => <SelectItem key={v} value={v}>{voiceLabel(v)}</SelectItem>)}
            </SelectContent>
          </Select>
          {effectiveVoice && <SamplePlayer key={effectiveVoice} voice={effectiveVoice} />}
        </div>
        <p className="text-xs text-muted-foreground">Sample is a standard passage, not your chapter.</p>
      </div>

      <NarrationEstimate text={text} notes={notes} appendNotes={appendNotes} voice={effectiveVoice} disabled={over} rateId={pricingRateId} />

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <div className="text-sm tabular-nums" data-testid="text-word-count">
          <span className={cn("font-semibold", over && "text-destructive")}>{words.toLocaleString()}</span>
          <span className="text-muted-foreground"> / {maxWords.toLocaleString()} words · {listening(words)} listening</span>
          {over && <p className="text-xs text-destructive">Over the limit{appendNotes ? " (including appended notes)" : ""}.</p>}
        </div>
        <Button id="chapter-queue-submit" onClick={submit} disabled={disabled} data-testid="button-generate">
          {create.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}{create.isPending ? "Submitting…" : "Queue chapter for narration"}
        </Button>
      </div>
      {blank && <p className="text-xs text-muted-foreground">Add a chapter title and text to enable the queue button.</p>}
      {submitError && <p className="text-sm text-destructive" data-testid="text-submit-error">{submitError}</p>}
      <p className="text-xs text-muted-foreground">Audio is stored privately and expires {retentionDays} days after submission. It is not published or emailed.</p>
    </div>
  );
}

function SamplePlayer({ voice }: { voice: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const src = `${BASE}/api/cms/chapter-audio/sample/${encodeURIComponent(voice)}`;
  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    setFailed(false);
    if (playing) a.pause();
    else void a.play().catch(() => setFailed(true));
  };
  return (
    <>
      <audio key={src} ref={audioRef} src={src} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => { setFailed(true); setPlaying(false); }} />
      <Button type="button" variant="outline" onClick={toggle} title={failed ? "Sample unavailable" : "Play sample"} data-testid="button-play-sample">
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        <span className="ml-1.5">{failed ? "Unavailable" : "Sample"}</span>
      </Button>
    </>
  );
}

function JobRow({ job }: { job: ChapterAudioJob }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const action = useActionChapterAudio();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showPlayer, setShowPlayer] = useState(false);
  const [playbackError, setPlaybackError] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const expired = new Date(job.expiresAt).getTime() < Date.now() || job.status === "expired";
  const pct = job.totalChunks > 0 ? Math.round((job.completedChunks / job.totalChunks) * 100) : 0;
  const audioUrl = `${BASE}/api/cms/chapter-audio/${encodeURIComponent(job.id)}/audio`;
  const busy = action.isPending;
  const download = async () => {
    setDownloadProgress(0);
    try {
      const blob = await fetchChapterAudio(audioUrl, job.audioBytes ?? 0, setDownloadProgress);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${job.title.replace(/[^\w -]/g, "").trim().slice(0, 100) || "chapter"}.mp3`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      toast({ title: "Could not download audio", description: errMessage(error, "Please try Download again. Your saved narration has not been changed."), variant: "destructive" });
    } finally { setDownloadProgress(null); }
  };

  const run = (a: "cancel" | "retry" | "delete") =>
    action.mutate({ id: job.id, action: a }, {
      onSuccess: () => { void qc.invalidateQueries({ queryKey: getListChapterAudioQueryKey() }); },
      onError: (err) => toast({ title: `Could not ${a}`, description: errMessage(err, "Request failed."), variant: "destructive" }),
      onSettled: () => setConfirmDelete(false),
    });

  const canCancel = job.status === "queued" || job.status === "processing";
  const canRetry = (job.status === "failed" || job.status === "cancelled") && !expired;
  const canDelete = job.status !== "deleting";
  const meta = useMemo(() => fmtDate(job.createdAt), [job.createdAt]);

  return (
    <li id={`chapter-job-${job.id}`} className="rounded-lg border border-border bg-card p-4" data-testid={`row-job-${job.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium truncate" data-testid={`text-job-title-${job.id}`}>{job.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {job.creatorName} · {voiceLabel(job.voice)} · {job.wordCount.toLocaleString()} words · {meta}
          </p>
        </div>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize", STATUS_STYLE[job.status])} data-testid={`status-job-${job.id}`}>
          {job.status}
        </span>
      </div>

      {(job.status === "processing" || job.status === "queued") && (
        <div className="mt-3">
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary origin-left transition-transform duration-500" style={{ transform: `scaleX(${pct / 100})` }} />
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 tabular-nums">{job.completedChunks} / {job.totalChunks || "?"} segments</p>
          {job.status === "processing" && job.processingStage && <p role="status" className="text-xs text-muted-foreground mt-1">{chapterStageLabel(job.processingStage)}</p>}
        </div>
      )}
      {job.error && <p className="mt-2 text-xs text-destructive" data-testid={`text-job-error-${job.id}`}>{job.error}</p>}
      {!!job.diagnostics?.length && (
        <details className="mt-3 text-xs" data-testid={`diagnostics-job-${job.id}`}>
          <summary className="cursor-pointer font-medium">
            Processing diagnostics ({job.diagnostics.length}){job.status === "completed" ? " — recovered; MP3 ready" : ""}
          </summary>
          <p className="mt-2 text-muted-foreground">Earlier failures remain visible after a successful retry. This history contains no manuscript text. Up to 20 recent failures are retained.</p>
          <ol className="mt-2 space-y-2">
            {job.diagnostics.map((entry, index) => (
              <li key={`${entry.at}-${index}`} className="rounded border border-border p-2">
                <span className="font-medium">{chapterStageLabel(entry.stage)}</span>
                {" · "}{new Date(entry.at).toLocaleString()}
                <div className="text-muted-foreground mt-1">
                  {entry.code} · attempt {entry.attempt} · {(entry.elapsedMs / 1000).toFixed(1)}s
                  {entry.willRetry ? " · automatic retry requested" : " · automatic retries stopped"}
                </div>
              </li>
            ))}
          </ol>
        </details>
      )}

      <JobCostDetails cost={job.cost} jobId={job.id} />

      {job.status === "completed" && showPlayer && (
        <audio controls autoPlay preload="metadata" src={audioUrl} className="w-full mt-3" data-testid={`audio-job-${job.id}`}
          onLoadStart={() => setPlaybackError(false)} onError={() => setPlaybackError(true)} />
      )}
      {playbackError && showPlayer && <p role="alert" className="mt-2 text-sm text-destructive">
        The player could not load the saved MP3. This is a playback/delivery error, not a new narration failure. Try Download below; do not regenerate the chapter.
      </p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {job.status === "completed" && !expired && (
          <>
            <Button size="sm" variant="outline" onClick={() => setShowPlayer((s) => !s)} data-testid={`button-play-${job.id}`}>
              {showPlayer ? <Pause className="h-3.5 w-3.5 mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}{showPlayer ? "Hide" : "Play"}
            </Button>
            <Button size="sm" variant="outline" disabled={downloadProgress !== null} onClick={() => void download()} data-testid={`link-download-${job.id}`}>
              <Download className="h-3.5 w-3.5 mr-1" />{downloadProgress === null ? "Download" : `Downloading ${downloadProgress}%`}
            </Button>
          </>
        )}
        {canCancel && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => run("cancel")} data-testid={`button-cancel-${job.id}`}>
            <XCircle className="h-3.5 w-3.5 mr-1" />Cancel
          </Button>
        )}
        {canRetry && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => run("retry")} data-testid={`button-retry-${job.id}`}>
            <RotateCcw className="h-3.5 w-3.5 mr-1" />Retry
          </Button>
        )}
        {canDelete && (
          <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={() => setConfirmDelete(true)} data-testid={`button-delete-${job.id}`}>
            <Trash2 className="h-3.5 w-3.5 mr-1" />Delete
          </Button>
        )}
        <span className="ml-auto text-[11px] text-muted-foreground">{expired ? "Expired" : `Expires ${fmtDate(job.expiresAt)}`}</span>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this narration?</AlertDialogTitle>
            <AlertDialogDescription>"{job.title}" and its audio will be permanently removed for all staff.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Keep</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); run("delete"); }} disabled={busy} data-testid="button-confirm-delete">
              {busy ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
