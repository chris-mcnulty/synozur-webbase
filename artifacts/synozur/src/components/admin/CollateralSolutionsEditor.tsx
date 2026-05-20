import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { GripVertical, Trash2, Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface Props {
  // Generic collateral editor passes `collateralId` directly. Typed
  // editors (white paper, video, workshop, polaris episode) pass
  // `sourceId` instead — the component resolves it to a collateralId
  // via /cms/collateral/by-source/:sourceId.
  collateralId?: string | null;
  sourceId?: string | null;
  canWrite: boolean;
}

type LinkRow = {
  solutionId: string;
  displayOrder: number;
  active: boolean;
  solutionTitle: string;
  solutionSlug: string;
  parentServiceId: string | null;
  parentServiceTitle: string | null;
};

// Task #318 — Solutions multi-select for any library item. The save model
// mirrors `replaceSolutionHighlights`: edits are staged locally, then a
// single PUT replaces the row set. We keep ordering by array index so
// the public Related-resources grid renders in the order admins set
// here. Inactive rows stay in the list but are hidden from the public
// section.
export function CollateralSolutionsEditor({
  collateralId,
  sourceId,
  canWrite,
}: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const lookupQ = useQuery({
    queryKey: ["collateral-by-source", sourceId],
    queryFn: () => api.lookupCollateralBySource(sourceId!),
    enabled: !collateralId && !!sourceId,
    retry: false,
  });
  const resolvedId = collateralId ?? lookupQ.data?.collateralId ?? null;

  const solutionsQ = useQuery({
    queryKey: ["all-solutions-for-collateral-editor"],
    queryFn: () => api.listSolutions(),
  });

  const linksQ = useQuery({
    queryKey: ["cms-collateral-solutions", resolvedId],
    queryFn: () => api.listCollateralSolutions(resolvedId!),
    enabled: !!resolvedId,
  });

  const [draft, setDraft] = useState<LinkRow[] | null>(null);
  const [adding, setAdding] = useState<string>("");

  useEffect(() => {
    if (linksQ.data) {
      setDraft([...linksQ.data.items]);
    }
  }, [linksQ.data]);

  const saveMut = useMutation({
    mutationFn: (items: LinkRow[]) =>
      api.replaceCollateralSolutions(
        resolvedId!,
        items.map((r, i) => ({
          solutionId: r.solutionId,
          displayOrder: i,
          active: r.active,
        })),
      ),
    onSuccess: (resp) => {
      setDraft([...resp.items]);
      qc.invalidateQueries({
        queryKey: ["cms-collateral-solutions", resolvedId],
      });
      toast({ title: "Solutions updated" });
    },
    onError: (err: unknown) => {
      toast({
        title: "Failed to save",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    },
  });

  const allSolutions = solutionsQ.data?.items ?? [];
  const availableToAdd = useMemo(() => {
    const taken = new Set((draft ?? []).map((r) => r.solutionId));
    return allSolutions.filter((s) => !taken.has(s.id));
  }, [allSolutions, draft]);

  const isDirty = useMemo(() => {
    if (!draft || !linksQ.data) return false;
    const a = draft;
    const b = linksQ.data.items;
    if (a.length !== b.length) return true;
    return a.some(
      (r, i) =>
        r.solutionId !== b[i].solutionId || r.active !== b[i].active,
    );
  }, [draft, linksQ.data]);

  if (!collateralId && !sourceId) {
    return (
      <p className="text-sm text-muted-foreground">
        Save this item first, then attach solutions here.
      </p>
    );
  }

  if (!resolvedId) {
    if (lookupQ.isLoading) {
      return (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading library link…
        </div>
      );
    }
    return (
      <p className="text-sm text-muted-foreground">
        Sync this item to the library first to attach it to solutions.
      </p>
    );
  }

  if (linksQ.isLoading || !draft) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...draft];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setDraft(next);
  };

  const remove = (solutionId: string) => {
    setDraft((draft ?? []).filter((r) => r.solutionId !== solutionId));
  };

  const toggleActive = (solutionId: string, v: boolean) => {
    setDraft(
      (draft ?? []).map((r) =>
        r.solutionId === solutionId ? { ...r, active: v } : r,
      ),
    );
  };

  const add = () => {
    if (!adding) return;
    const sol = allSolutions.find((s) => s.id === adding);
    if (!sol) return;
    setDraft([
      ...(draft ?? []),
      {
        solutionId: sol.id,
        displayOrder: (draft ?? []).length,
        active: true,
        solutionTitle: sol.title,
        solutionSlug: sol.slug,
        parentServiceId: null,
        parentServiceTitle: null,
      },
    ]);
    setAdding("");
  };

  return (
    <div className="space-y-3" data-testid="collateral-solutions-editor">
      {draft.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Not linked to any solutions yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {draft.map((r, i) => (
            <li
              key={r.solutionId}
              className="flex items-center gap-2 rounded-md border border-border/60 bg-background/60 px-2 py-1.5"
              data-testid={`collateral-solution-row-${r.solutionSlug}`}
            >
              <div className="flex flex-col">
                <button
                  type="button"
                  aria-label="Move up"
                  onClick={() => move(i, -1)}
                  disabled={!canWrite || i === 0}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30 leading-none"
                >
                  ▲
                </button>
                <button
                  type="button"
                  aria-label="Move down"
                  onClick={() => move(i, 1)}
                  disabled={!canWrite || i === draft.length - 1}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30 leading-none"
                >
                  ▼
                </button>
              </div>
              <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {r.solutionTitle}
                </div>
                {r.parentServiceTitle && (
                  <div className="truncate text-[11px] text-muted-foreground">
                    {r.parentServiceTitle}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Label
                  htmlFor={`active-${r.solutionId}`}
                  className="text-[11px] uppercase tracking-wider text-muted-foreground"
                >
                  Active
                </Label>
                <Switch
                  id={`active-${r.solutionId}`}
                  checked={r.active}
                  onCheckedChange={(v) => toggleActive(r.solutionId, v)}
                  disabled={!canWrite}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => remove(r.solutionId)}
                disabled={!canWrite}
                aria-label="Remove"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {canWrite && availableToAdd.length > 0 && (
        <div className="flex items-center gap-2">
          <Select value={adding} onValueChange={setAdding}>
            <SelectTrigger
              className="flex-1"
              data-testid="collateral-solutions-add-trigger"
            >
              <SelectValue placeholder="Add a solution…" />
            </SelectTrigger>
            <SelectContent>
              {availableToAdd.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={add}
            disabled={!adding}
            data-testid="collateral-solutions-add-btn"
          >
            <Plus className="h-4 w-4 mr-1" />
            Add
          </Button>
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        {isDirty && (
          <span className="text-xs text-muted-foreground">Unsaved</span>
        )}
        <Button
          type="button"
          size="sm"
          onClick={() => saveMut.mutate(draft)}
          disabled={!canWrite || !isDirty || saveMut.isPending}
          data-testid="collateral-solutions-save"
        >
          {saveMut.isPending ? "Saving…" : "Save solutions"}
        </Button>
      </div>
    </div>
  );
}
