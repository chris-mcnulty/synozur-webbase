import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCmsOrionTraffic,
  getGetCmsOrionTrafficQueryKey,
  getCmsOrionTraffic,
  type OrionTrafficSnapshot,
} from "@workspace/api-client-react";
import { computeOrionWindow, type OrionRangePreset } from "@/lib/orion-traffic-window";
import { applySnapshot } from "@/lib/traffic-selection";

function utcDayKey(now: Date) {
  return now.toISOString().slice(0, 10);
}

/** Stable UTC window shared by local queries and the Orion snapshot. */
export function useTrafficWindow(rangePreset: OrionRangePreset) {
  const [dayKey, setDayKey] = useState(() => utcDayKey(new Date()));
  useEffect(() => {
    const now = new Date();
    const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 1);
    const t = window.setTimeout(() => setDayKey(utcDayKey(new Date())), Math.max(1000, next - now.getTime()));
    return () => window.clearTimeout(t);
  }, [dayKey]);
  return useMemo(() => computeOrionWindow(rangePreset, new Date(`${dayKey}T12:00:00Z`)), [rangePreset, dayKey]);
}

export function useOrionSnapshot(params: { from: string; to: string }, enabled: boolean) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => getGetCmsOrionTrafficQueryKey(params), [params]);
  const q = useGetCmsOrionTraffic(params, {
    query: { queryKey, enabled, refetchInterval: enabled ? 60000 : false, staleTime: 0, retry: 1 },
  });
  const [refreshing, setRefreshing] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  useEffect(() => setManualError(null), [queryKey, q.data?.fetchedAt]);

  async function refresh() {
    setRefreshing(true);
    setManualError(null);
    try {
      const result = await getCmsOrionTraffic({ ...params, refresh: true });
      queryClient.setQueryData<OrionTrafficSnapshot>(queryKey, (prev) => applySnapshot(prev, result));
    } catch (e) {
      setManualError(e instanceof Error ? e.message : "Refresh request failed");
    } finally {
      setRefreshing(false);
    }
  }

  const snap = q.data;
  const bgError = q.isError && !!snap;
  const isStale = !!snap && (snap.stale || !!snap.refreshError || !!manualError || bgError);
  return {
    params, enabled, snap, isLoading: enabled && q.isLoading, isError: q.isError && !snap,
    bgError, isStale, manualError, refreshing, refresh, retry: () => q.refetch(),
  };
}

export type OrionSnapshotState = ReturnType<typeof useOrionSnapshot>;
