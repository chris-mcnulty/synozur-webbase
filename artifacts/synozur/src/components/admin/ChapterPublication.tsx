import { useState } from "react";
import { getGetChapterPublicationQueryKey, useGetChapterPublication, usePrepareChapterPublication } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { fetchChapterAudio } from "@/lib/chapter-audio-download";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

export function ChapterPublication({ id, title }: { id: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState("");
  const status = useGetChapterPublication(id, {
    query: {
      queryKey: getGetChapterPublicationQueryKey(id),
      enabled: open,
      refetchInterval: query => ["queued", "processing"].includes(query.state.data?.status ?? "") ? 3000 : 15000,
      staleTime: 0,
    },
  });
  const prepare = usePrepareChapterPublication({
    mutation: { onSuccess: () => { void status.refetch(); } },
  });
  const data = status.data;
  const working = data?.status === "queued" || data?.status === "processing";
  async function download() {
    setDownloadError("");
    setDownloadProgress(0);
    try {
      const blob = await fetchChapterAudio(`${BASE}/api/cms/chapter-audio/${encodeURIComponent(id)}/publication/audio`,
        data?.audioBytes ?? 0, setDownloadProgress);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${title.replace(/[^\w -]/g, "").trim().slice(0, 100) || "chapter"}-publication.mp3`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setDownloadError("The publication download was interrupted. Try downloading again; the original narration has not changed.");
    } finally { setDownloadProgress(null); }
  }
  return (
    <details className="mt-3 rounded border border-border p-3 text-sm" data-testid={`publication-${id}`}
      onToggle={event => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer font-medium">Publication export — 192 kbps / 44.1 kHz</summary>
      <p className="mt-2 text-xs text-muted-foreground">
        Creates a separate private MP3 from the saved recording, with measured RMS between −23 and −18 dB
        and peaks no higher than −3 dB. No new narration or speech charges. The original stays unchanged;
        both files expire on this chapter's existing expiry date. Re-encoding cannot restore detail lost in the original.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        This is not an ACX acceptance guarantee. Confirm ACX authorization for Dragon/AI narration before submission.
        Noise floor, room tone, spoken headers, credits and listening quality still require review.
      </p>
      <div role="status" aria-live="polite" className="mt-3">
        {status.isLoading && <p>Loading export status…</p>}
        {status.isError && <p className="text-destructive">Export status is unavailable. <button className="underline" onClick={() => void status.refetch()}>Try again</button></p>}
        {data?.status === "queued" && <p>Queued — waiting for the chapter worker. You can leave this page.</p>}
        {data?.status === "processing" && <p>Processing — mastering and verifying the publication copy. You can leave this page.</p>}
        {data?.status === "failed" && <p className="text-destructive">{data.error ?? "Export failed. The original recording is unchanged."}</p>}
        {data?.status === "ready" && data.report && (
          <p data-testid={`publication-report-${id}`}>
            Ready · {data.report.bitrateKbps} kbps CBR · {(data.report.sampleRate / 1000).toFixed(1)} kHz · mono
            {" · "}RMS {data.report.rmsDb.toFixed(1)} dB · peak {data.report.peakDb.toFixed(1)} dB
            {" · "}{Math.floor(data.report.durationSeconds / 60)}:{String(Math.floor(data.report.durationSeconds % 60)).padStart(2, "0")}
          </p>
        )}
      </div>
      {data?.status === "ready" ? (
        <Button className="mt-3" size="sm" variant="outline" disabled={downloadProgress !== null}
          onClick={() => void download()} data-testid={`download-publication-${id}`}>
          {downloadProgress === null ? "Download publication MP3" : `Downloading ${downloadProgress}%`}
        </Button>
      ) : (
        <Button className="mt-3" size="sm" variant="outline"
          disabled={!data || working || prepare.isPending || status.isError}
          onClick={() => prepare.mutate({ id })} data-testid={`prepare-publication-${id}`}>
          {prepare.isPending ? "Submitting…" : working ? "Export in progress" : data?.status === "failed" ? "Retry publication export" : "Prepare publication MP3"}
        </Button>
      )}
      {prepare.isError && <p role="alert" className="mt-2 text-destructive">Could not queue the export. Refresh its status before retrying. Your original is unchanged.</p>}
      {downloadError && <p role="alert" className="mt-2 text-destructive">{downloadError}</p>}
    </details>
  );
}
