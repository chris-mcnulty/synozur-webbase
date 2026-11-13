import React from "react";
import type { ChapterPublicationListeningChecks } from "@workspace/api-client-react";

const REQUIREMENTS = "https://help.acx.com/s/article/what-are-the-acx-audio-submission-requirements";
const checklist = [
  "Listen to the entire exported MP3 against the approved text: no missing, repeated or altered words; correct pronunciation and spoken chapter header.",
  "Listen on headphones for hiss, hum, clicks, pops, mouth noise, clipping, distortion, abrupt cuts and unnatural pauses throughout the chapter.",
  "Listen to both ends and confirm genuine, consistent room tone: ACX recommends 1–5 seconds at each end, never more than 5 seconds. Digital silence is not verified room tone.",
  "Check consistent volume, tone, spacing and mono format across all chapters. Verify any noise estimate against a representative non-speech sample.",
  "Confirm one chapter or section per file, separate opening and closing credit files, correct title/author/narrator credits, chapter labels and standard US alphabetical/numeric filenames.",
  "Prepare a retail sample from the audiobook, no longer than 5 minutes and without explicit material; review ACX's current sample guidance.",
  "Obtain explicit editorial approval before changing wording, headers, credits, pauses or leading/trailing spacing. Keep originals and review a separately edited copy; this export makes none of those changes.",
  "Confirm rights and explicit ACX authorization for this Dragon/AI narration before submission. Technical results and this checklist do not grant authorization or guarantee acceptance.",
  "Review the finished file with ACX Audio Lab and the current submission requirements before uploading.",
];

export function ChapterPublicationReview({ checks }: { checks?: ChapterPublicationListeningChecks }) {
  return (
    <section className="mt-3 space-y-3" aria-label="Publication listening and submission review">
      <h4 className="font-medium">Noise floor and room tone — human review required</h4>
      {checks ? (
        <>
          <p className="text-xs text-muted-foreground">{checks.method}</p>
          <dl className="space-y-2 text-xs">
            {([
              ["Noise floor (estimated; target ≤ −60 dB RMS)", checks.noiseFloor],
              ["Leading room tone (candidate; recommended 1–5 s)", checks.leadingRoomTone],
              ["Trailing room tone (candidate; recommended 1–5 s)", checks.trailingRoomTone],
            ] as const).map(([label, check]) => (
              <div key={label}>
                <dt className="font-medium">{label}</dt>
                <dd>
                  <strong>{check.status === "warning" ? "Warning" : check.status === "unmeasurable" ? "Not measurable" : "Listening review required"}</strong>
                  {check.seconds !== null && ` · ${check.seconds.toFixed(1)} s estimated`}
                  {check.rmsDb !== null && ` · ${check.rmsDb.toFixed(1)} dB RMS`}
                  <p>{check.detail}</p>
                </dd>
              </div>
            ))}
          </dl>
        </>
      ) : <p className="text-xs text-muted-foreground">Not checked: this older export has no noise-floor or room-tone measurements. Do not treat missing results as passing; review the downloaded file manually.</p>}
      <h4 className="font-medium">Human listening and submission checklist</h4>
      <p className="text-xs text-muted-foreground">Review aid only. Ticks stay on this screen only; they are not saved approvals or submission clearance.</p>
      <ul className="space-y-2 text-xs">
        {checklist.map(item => <li key={item}><label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5" />
          <span>{item}</span>
        </label></li>)}
      </ul>
      <p className="text-xs">
        <a href={REQUIREMENTS} target="_blank" rel="noopener noreferrer" className="underline">Official ACX requirements</a>
        {" · "}<a href="https://www.acx.com/audiolab/playground" target="_blank" rel="noopener noreferrer" className="underline">ACX Audio Lab</a>
        {" · "}Requirements consulted: October 31, 2026 (article updated April 15, 2026).
      </p>
    </section>
  );
}
