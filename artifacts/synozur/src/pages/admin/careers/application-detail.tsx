import { useState, useCallback } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { careersApi } from "@/lib/careers-api";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

const STATUSES = ["new", "reviewing", "interview", "offer", "rejected"] as const;

interface Props {
  id: string;
}

export default function CareersApplicationDetail({ id }: Props) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin-careers-application", id],
    queryFn: () => careersApi.adminGetApplication(id),
  });
  const [note, setNote] = useState("");
  const [localRating, setLocalRating] = useState<number | null>(null);

  const patchStatus = useMutation({
    mutationFn: (status: (typeof STATUSES)[number]) =>
      careersApi.adminPatchApplication(id, { status }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["admin-careers-application", id] }),
  });
  const addNote = useMutation({
    mutationFn: () => careersApi.adminAddNote(id, note),
    onSuccess: () => {
      setNote("");
      qc.invalidateQueries({ queryKey: ["admin-careers-application", id] });
    },
  });
  const rescore = useMutation({
    mutationFn: () => careersApi.adminRescore(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["admin-careers-application", id] }),
  });
  const setRating = useMutation({
    mutationFn: (rating: number | null) =>
      careersApi.adminSetRecruiterRating(id, rating),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["admin-careers-application", id] }),
  });

  // Debounce the rating save so we don't fire on every slider tick
  const ratingTimer = useState<ReturnType<typeof setTimeout> | null>(null);
  const handleRatingChange = useCallback(
    (val: number) => {
      setLocalRating(val);
      if (ratingTimer[0]) clearTimeout(ratingTimer[0]);
      ratingTimer[1](
        setTimeout(() => {
          setRating.mutate(val);
        }, 600),
      );
    },
    [ratingTimer, setRating],
  );

  if (isLoading || !data) {
    return <AdminLayout title="Application"><div>Loading…</div></AdminLayout>;
  }
  const a = data.application;

  const displayRating = localRating ?? a.recruiterRating;

  return (
    <AdminLayout title={`Application — ${a.fullName}`}>
      <Link href="/careers/applications">
        {/* eslint-disable-next-line jsx-a11y/anchor-is-valid -- wouter <Link> injects href into the inner <a>. */}
        <a className="text-sm text-muted-foreground hover:text-foreground">← All applications</a>
      </Link>
      <h1 className="text-2xl font-semibold mt-2 mb-1" data-testid="app-name">{a.fullName}</h1>
      <div className="text-sm text-muted-foreground mb-6">{a.email}{a.phone ? ` · ${a.phone}` : ""}</div>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          {data.job && (
            <div className="rounded border border-border bg-card p-4 text-sm">
              {/* eslint-disable-next-line jsx-a11y/anchor-is-valid -- wouter <Link> injects href into the inner <a>. */}
              Applied for: <Link href={`/careers/jobs/${data.job.id}/edit`}><a className="font-medium text-fuchsia-300">{data.job.title}</a></Link> <span className="text-muted-foreground">({data.job.requisitionNumber})</span>
            </div>
          )}
          <section>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase mb-2">Cover letter</h2>
            <div className="whitespace-pre-wrap text-sm">{a.coverLetter || <span className="text-muted-foreground">—</span>}</div>
          </section>
          <section>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase mb-2">Experience</h2>
            <div className="whitespace-pre-wrap text-sm">{a.experience || <span className="text-muted-foreground">—</span>}</div>
          </section>
          <section>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase mb-2">Education</h2>
            <div className="whitespace-pre-wrap text-sm">{a.education || <span className="text-muted-foreground">—</span>}</div>
          </section>

          {/* Notes */}
          <section>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase mb-3">Notes ({data.notes.length})</h2>
            <div className="space-y-3">
              {data.notes.map((n) => (
                <div key={n.id} className="rounded border border-border bg-card p-3 text-sm" data-testid={`note-${n.id}`}>
                  <div className="text-xs text-muted-foreground mb-1">{new Date(n.createdAt).toLocaleString()}</div>
                  <div className="whitespace-pre-wrap">{n.body}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 space-y-2">
              <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note…" data-testid="input-note" />
              <Button
                type="button"
                disabled={!note.trim() || addNote.isPending}
                onClick={() => addNote.mutate()}
                data-testid="button-add-note"
              >
                Add note
              </Button>
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          {/* Status */}
          <div className="rounded border border-border bg-card p-4">
            <div className="text-xs uppercase text-muted-foreground mb-2">Status</div>
            <select
              className="w-full bg-background border border-border rounded px-3 py-2 text-sm"
              value={a.status}
              onChange={(e) => patchStatus.mutate(e.target.value as (typeof STATUSES)[number])}
              data-testid="select-app-status"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* AI Match Score */}
          <div className="rounded border border-border bg-card p-4">
            <div className="text-xs uppercase text-muted-foreground mb-2">AI match</div>
            <div className="text-2xl font-semibold" data-testid="ai-score">
              {a.aiMatchScore != null ? `${a.aiMatchScore}/100` : "—"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">{a.aiMatchReasoning ?? ""}</div>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => rescore.mutate()} data-testid="button-rescore">
              {rescore.isPending ? "Scoring…" : "Re-run AI score"}
            </Button>
          </div>

          {/* Recruiter Rating */}
          <div className="rounded border border-border bg-card p-4">
            <div className="text-xs uppercase text-muted-foreground mb-2">
              Recruiter rating
              {setRating.isPending && <span className="ml-2 text-[10px] text-muted-foreground">Saving…</span>}
            </div>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={displayRating ?? 0}
                onChange={(e) => handleRatingChange(Number(e.target.value))}
                className="flex-1 accent-fuchsia-500"
                data-testid="slider-recruiter-rating"
              />
              <span className="text-lg font-semibold w-10 text-right tabular-nums" data-testid="recruiter-rating-value">
                {displayRating ?? "—"}
              </span>
            </div>
            {displayRating != null && (
              <button
                type="button"
                onClick={() => { setLocalRating(null); setRating.mutate(null); }}
                className="text-xs text-muted-foreground hover:text-foreground mt-1"
              >
                Clear
              </button>
            )}
          </div>

          {/* Résumé */}
          {data.resume && (
            <div className="rounded border border-border bg-card p-4 text-sm">
              <div className="text-xs uppercase text-muted-foreground mb-2">Résumé</div>
              <a
                href={`${BASE_PATH}/api/storage${`/objects${data.resume.id}`}`}
                onClick={(e) => {
                  e.preventDefault();
                  window.open(
                    `${BASE_PATH}/api/storage${data.resume?.publicUrl ?? ""}`,
                    "_blank",
                  );
                }}
                className="text-fuchsia-300 hover:underline"
                data-testid="resume-link"
              >
                {data.resume.originalName ?? "Download résumé"}
              </a>
            </div>
          )}

          {/* LinkedIn */}
          {a.linkedinUrl && (
            <div className="rounded border border-border bg-card p-4 text-sm">
              <div className="text-xs uppercase text-muted-foreground mb-2">LinkedIn</div>
              <a
                href={a.linkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-fuchsia-300 hover:underline break-all"
              >
                {a.linkedinUrl}
              </a>
            </div>
          )}

          {/* Self-ID */}
          <div className="rounded border border-border bg-card p-4 text-xs space-y-1">
            <div className="text-xs uppercase text-muted-foreground mb-2">Self-id</div>
            <div>Race: {a.eeoRace ?? <span className="text-muted-foreground">—</span>}</div>
            <div>Gender: {a.eeoGender ?? <span className="text-muted-foreground">—</span>}</div>
            <div>Veteran: {a.eeoVeteran ?? <span className="text-muted-foreground">—</span>}</div>
            <div>Disability: {a.eeoDisability ?? <span className="text-muted-foreground">—</span>}</div>
          </div>

          {/* Authorization */}
          {(a.workAuthorized != null || a.requireSponsorship != null) && (
            <div className="rounded border border-border bg-card p-4 text-xs space-y-1">
              <div className="text-xs uppercase text-muted-foreground mb-2">Authorization</div>
              <div>Authorized: {a.workAuthorized ? "Yes" : "No"}</div>
              <div>Sponsorship: {a.requireSponsorship ? "Yes" : "No"}</div>
            </div>
          )}
        </aside>
      </div>
    </AdminLayout>
  );
}
