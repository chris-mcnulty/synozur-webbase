// Quiet boundaries are candidates only: neither speech detection nor proof of
// authentic room tone. Never use full-track RMS as a noise-floor estimate.
const RATE = 44100;
const WINDOW = 4410; // 100 ms, decoded mono float PCM
type Check = {
  status: "review" | "warning" | "unmeasurable";
  detail: string;
  seconds: number | null;
  rmsDb: number | null;
};

function edge(pcm: Buffer, reverse: boolean): Check {
  const levels: number[] = [];
  for (let offset = 0; offset + WINDOW * 4 <= pcm.length; offset += WINDOW * 4) {
    let sum = 0;
    for (let i = 0; i < WINDOW; i++) {
      const sample = pcm.readFloatLE(offset + i * 4);
      if (!Number.isFinite(sample)) throw new Error("Invalid decoded audio.");
      sum += sample * sample;
    }
    levels.push(sum / WINDOW);
  }
  if (reverse) levels.reverse();
  const quiet: number[] = [];
  for (const power of levels) {
    if (power > 10 ** (-40 / 10)) break;
    quiet.push(power);
  }
  const seconds = quiet.length * WINDOW / RATE;
  // Exclude one window adjacent to possible speech/encoder ringing.
  const usable = quiet.slice(0, -1);
  const power = usable.reduce((sum, value) => sum + value, 0) / usable.length;
  if (usable.length < 5 || !Number.isFinite(power)) {
    return { status: "unmeasurable", seconds, rmsDb: null,
      detail: "Insufficient quiet edge audio to estimate background noise. Listen for the true speech boundary and room tone." };
  }
  if (power <= 1e-9) {
    return { status: "unmeasurable", seconds, rmsDb: null,
      detail: "Digital or near-digital silence detected (≤ −90 dBFS); this is not verified room tone and cannot establish a noise floor." };
  }
  const rmsDb = 10 * Math.log10(power);
  return { status: seconds < 1 || seconds > 5 ? "warning" : "review", seconds, rmsDb,
    detail: `${seconds >= 9.9 ? "At least " : ""}${seconds.toFixed(1)} s of quiet-edge audio estimated. ${seconds < 1 || seconds > 5 ? "Outside the recommended 1–5 s range. " : ""}Listen to confirm actual room tone, not quiet speech, music or an artificial noise bed.` };
}

export function analyzePublicationEdges(leadingPcm: Buffer, trailingPcm: Buffer) {
  const leadingRoomTone = edge(leadingPcm, false);
  const trailingRoomTone = edge(trailingPcm, true);
  const candidates = [leadingRoomTone.rmsDb, trailingRoomTone.rmsDb].filter((n): n is number => n !== null);
  // Conservative estimate: report the louder edge, not the quietest moment.
  const rmsDb = candidates.length ? Math.max(...candidates) : null;
  const noiseFloor: Check = {
    status: rmsDb === null ? "unmeasurable" : rmsDb > -60 ? "warning" : "review",
    seconds: null, rmsDb,
    detail: rmsDb === null
      ? "No usable non-silent quiet-edge sample. Noise floor is unknown, not passing."
      : `Louder available quiet-edge RMS estimate; ACX limit is ≤ −60 dB RMS. ${rmsDb > -60 ? "Estimated level exceeds the limit. " : ""}A person must verify that the sampled audio is representative non-speech room tone and listen for noise throughout the chapter.`,
  };
  return {
    method: "Advisory analysis of up to 10 s at each end of the decoded publication MP3, using 100 ms RMS windows below −40 dBFS. Boundary resolution is 0.1 s; quiet speech may be misclassified. Digital/near-digital silence is excluded from noise estimates. No audio or spacing is changed.",
    requirementsUrl: "https://help.acx.com/s/article/what-are-the-acx-audio-submission-requirements",
    noiseFloor, leadingRoomTone, trailingRoomTone,
  };
}
