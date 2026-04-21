import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

// Canonical set of entity types that can carry polymorphic taxonomy.
// Must stay in sync with TAXONOMY_ENTITY_TYPES in lib/db/src/schema/taxonomy.ts.
export type TaxonomyEntityType =
  | "post"
  | "video"
  | "white_paper"
  | "workshop"
  | "application"
  | "case_study"
  | "polaris_episode"
  | "collateral"
  | "service"
  | "solution";

interface TaxonomyTerm {
  id: string;
  slug: string;
  name: string;
}

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
const apiUrl = (path: string) => `${BASE_PATH}/api${path}`;

async function json<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function toSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 96);
}

interface Props {
  entityType: TaxonomyEntityType;
  entityId: string | null; // null when the entity hasn't been saved yet
  canWrite: boolean;
  /** Allow creation of new taxonomy terms inline. Defaults to true for tags. */
  allowCreateTags?: boolean;
}

/**
 * Shared admin control for the polymorphic taxonomy tables (#99).
 * Renders category and tag pickers backed by `/api/cms/taxonomy/:type/:id/...`
 * and can be dropped into any artifact edit form. When `entityId` is null
 * (create-new case) the control disables itself and prompts the editor to
 * save the parent record first.
 */
export function TaxonomyPicker({
  entityType,
  entityId,
  canWrite,
  allowCreateTags = true,
}: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const allCatsQ = useQuery({
    queryKey: ["cms-categories"],
    queryFn: () => json<TaxonomyTerm[]>(apiUrl("/cms/categories")),
  });
  const allTagsQ = useQuery({
    queryKey: ["cms-tags"],
    queryFn: () => json<TaxonomyTerm[]>(apiUrl("/cms/tags")),
  });

  const entityCatsQ = useQuery({
    queryKey: ["cms-taxonomy", entityType, entityId, "categories"],
    enabled: !!entityId,
    queryFn: () =>
      json<{ items: TaxonomyTerm[] }>(
        apiUrl(`/cms/taxonomy/${entityType}/${entityId}/categories`),
      ),
  });
  const entityTagsQ = useQuery({
    queryKey: ["cms-taxonomy", entityType, entityId, "tags"],
    enabled: !!entityId,
    queryFn: () =>
      json<{ items: TaxonomyTerm[] }>(
        apiUrl(`/cms/taxonomy/${entityType}/${entityId}/tags`),
      ),
  });

  const selectedCatIds = useMemo(
    () => new Set((entityCatsQ.data?.items ?? []).map((t) => t.id)),
    [entityCatsQ.data],
  );
  const selectedTagIds = useMemo(
    () => new Set((entityTagsQ.data?.items ?? []).map((t) => t.id)),
    [entityTagsQ.data],
  );

  const setCatsMut = useMutation({
    mutationFn: (ids: string[]) =>
      json<{ items: TaxonomyTerm[] }>(
        apiUrl(`/cms/taxonomy/${entityType}/${entityId}/categories`),
        { method: "PUT", body: JSON.stringify({ ids }) },
      ),
    onSuccess: (data) => {
      qc.setQueryData(
        ["cms-taxonomy", entityType, entityId, "categories"],
        data,
      );
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const setTagsMut = useMutation({
    mutationFn: (ids: string[]) =>
      json<{ items: TaxonomyTerm[] }>(
        apiUrl(`/cms/taxonomy/${entityType}/${entityId}/tags`),
        { method: "PUT", body: JSON.stringify({ ids }) },
      ),
    onSuccess: (data) => {
      qc.setQueryData(
        ["cms-taxonomy", entityType, entityId, "tags"],
        data,
      );
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const createTagMut = useMutation({
    mutationFn: (name: string) =>
      json<TaxonomyTerm>(apiUrl("/cms/tags"), {
        method: "POST",
        body: JSON.stringify({ name, slug: toSlug(name) }),
      }),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["cms-tags"] });
      const next = [...selectedTagIds, created.id];
      setTagsMut.mutate(next);
    },
    onError: (e: Error) =>
      toast({ title: "Couldn't create tag", description: e.message, variant: "destructive" }),
  });

  const toggleCategory = (id: string) => {
    if (!entityId) return;
    const next = new Set(selectedCatIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCatsMut.mutate([...next]);
  };

  const toggleTag = (id: string) => {
    if (!entityId) return;
    const next = new Set(selectedTagIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setTagsMut.mutate([...next]);
  };

  const [newTagInput, setNewTagInput] = useState("");

  const handleCreateTag = () => {
    const name = newTagInput.trim();
    if (!name) return;
    const existing = (allTagsQ.data ?? []).find(
      (t) => t.slug === toSlug(name) || t.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing) {
      if (!selectedTagIds.has(existing.id)) toggleTag(existing.id);
    } else {
      createTagMut.mutate(name);
    }
    setNewTagInput("");
  };

  if (!entityId) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        Save this record first to manage categories and tags.
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="taxonomy-picker">
      <div>
        <Label className="text-sm font-medium">Categories</Label>
        {allCatsQ.isLoading ? (
          <div className="text-xs text-muted-foreground mt-2">Loading…</div>
        ) : (allCatsQ.data ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground mt-2">
            No categories defined yet. Manage the list from Admin → Taxonomy.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2 mt-2">
            {(allCatsQ.data ?? []).map((cat) => {
              const active = selectedCatIds.has(cat.id);
              return (
                <button
                  key={cat.id}
                  type="button"
                  disabled={!canWrite || setCatsMut.isPending}
                  onClick={() => toggleCategory(cat.id)}
                  className={
                    "text-xs rounded-full px-3 py-1 border transition-colors " +
                    (active
                      ? "bg-primary/10 border-primary/40 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/40")
                  }
                  data-testid={`taxonomy-category-${cat.slug}`}
                >
                  {cat.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <Label className="text-sm font-medium">Tags</Label>
        <div className="flex flex-wrap gap-2 mt-2">
          {(entityTagsQ.data?.items ?? []).map((tag) => (
            <Badge
              key={tag.id}
              variant="secondary"
              className="inline-flex items-center gap-1"
              data-testid={`taxonomy-tag-selected-${tag.slug}`}
            >
              {tag.name}
              {canWrite && (
                <button
                  type="button"
                  onClick={() => toggleTag(tag.id)}
                  aria-label={`Remove tag ${tag.name}`}
                  className="hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
        {canWrite && (
          <div className="mt-3 space-y-2">
            <div className="flex gap-2">
              <Input
                value={newTagInput}
                onChange={(e) => setNewTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleCreateTag();
                  }
                }}
                placeholder={allowCreateTags ? "Add a tag…" : "Search tags"}
                data-testid="taxonomy-tag-input"
              />
              {allowCreateTags && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleCreateTag}
                  disabled={!newTagInput.trim() || createTagMut.isPending}
                  data-testid="button-add-taxonomy-tag"
                >
                  <Plus className="h-4 w-4 mr-1" /> Add
                </Button>
              )}
            </div>
            <TagSuggestions
              allTags={allTagsQ.data ?? []}
              selected={selectedTagIds}
              query={newTagInput}
              onPick={(id) => toggleTag(id)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function TagSuggestions({
  allTags,
  selected,
  query,
  onPick,
}: {
  allTags: TaxonomyTerm[];
  selected: Set<string>;
  query: string;
  onPick: (id: string) => void;
}) {
  const needle = query.trim().toLowerCase();
  const matches = useMemo(() => {
    const pool = needle
      ? allTags.filter(
          (t) =>
            t.name.toLowerCase().includes(needle) ||
            t.slug.toLowerCase().includes(needle),
        )
      : allTags;
    return pool.filter((t) => !selected.has(t.id)).slice(0, 10);
  }, [allTags, selected, needle]);

  // Collapse suggestions when nothing to show to keep the form tight.
  if (matches.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {matches.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onPick(t.id)}
          className="text-xs rounded-full border border-border px-2 py-0.5 text-muted-foreground hover:border-primary/40 hover:text-foreground"
          data-testid={`taxonomy-tag-suggest-${t.slug}`}
        >
          {t.name}
        </button>
      ))}
    </div>
  );
}
