export type OrionRangePreset = "7" | "30" | "90" | "183" | "ytd" | "365";

/** Stable UTC calendar boundaries prevent cache misses on every render/poll. */
export function computeOrionWindow(preset: OrionRangePreset, now: Date) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();
  const to = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
  const from = preset === "ytd"
    ? new Date(Date.UTC(year, 0, 1))
    : new Date(Date.UTC(year, month, day - (Number(preset) - 1)));
  return { from: from.toISOString(), to: to.toISOString() };
}
