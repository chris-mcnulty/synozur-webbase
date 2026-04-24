import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Check, X, Pencil } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  useListAssetCategories,
  useCreateAssetCategory,
  useUpdateAssetCategory,
  useDeleteAssetCategory,
  getListAssetCategoriesQueryKey,
  type AssetCategory,
} from "@workspace/api-client-react";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function AssetCategoriesModal({ open, onClose }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: getListAssetCategoriesQueryKey() });

  const { data } = useListAssetCategories({ query: { enabled: open } as never });
  const categories = data?.items ?? [];

  const [newLabel, setNewLabel] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newSlugEdited, setNewSlugEdited] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftSlug, setDraftSlug] = useState("");
  const [draftSort, setDraftSort] = useState<string>("0");

  const create = useCreateAssetCategory({
    mutation: {
      onSuccess: () => {
        invalidate();
        setNewLabel("");
        setNewSlug("");
        setNewSlugEdited(false);
        toast({ title: "Category added" });
      },
      onError: (e: Error) =>
        toast({ title: "Failed", description: e.message, variant: "destructive" }),
    },
  });

  const update = useUpdateAssetCategory({
    mutation: {
      onSuccess: () => {
        invalidate();
        setEditingId(null);
        toast({ title: "Category updated" });
      },
      onError: (e: Error) =>
        toast({ title: "Failed", description: e.message, variant: "destructive" }),
    },
  });

  const del = useDeleteAssetCategory({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: "Category deleted" });
      },
      onError: (e: Error) =>
        toast({ title: "Failed", description: e.message, variant: "destructive" }),
    },
  });

  const beginEdit = (c: AssetCategory) => {
    setEditingId(c.id);
    setDraftLabel(c.label);
    setDraftSlug(c.slug);
    setDraftSort(String(c.sortOrder));
  };

  const submitCreate = () => {
    const label = newLabel.trim();
    const slug = (newSlugEdited ? newSlug : slugify(newLabel)).trim();
    if (!label || !slug) return;
    create.mutate({
      data: { label, slug, sortOrder: (categories.at(-1)?.sortOrder ?? 0) + 10 },
    });
  };

  const submitEdit = (c: AssetCategory) => {
    const label = draftLabel.trim();
    const slug = draftSlug.trim();
    if (!label || !slug) return;
    update.mutate({
      id: c.id,
      data: { label, slug, sortOrder: Number(draftSort) || 0 },
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Manage Asset Categories</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="border-b border-border pb-4">
            <div className="text-sm font-medium mb-2">Add a category</div>
            <div className="grid grid-cols-5 gap-2">
              <div className="col-span-3">
                <Label className="text-xs text-muted-foreground">Label</Label>
                <Input
                  value={newLabel}
                  onChange={(e) => {
                    setNewLabel(e.target.value);
                    if (!newSlugEdited) setNewSlug(slugify(e.target.value));
                  }}
                  placeholder="e.g. Case Study Hero"
                  data-testid="asset-category-new-label"
                />
              </div>
              <div className="col-span-2">
                <Label className="text-xs text-muted-foreground">Slug</Label>
                <Input
                  value={newSlug}
                  onChange={(e) => {
                    setNewSlug(e.target.value);
                    setNewSlugEdited(true);
                  }}
                  placeholder="case-study-hero"
                  data-testid="asset-category-new-slug"
                />
              </div>
            </div>
            <div className="mt-2 flex justify-end">
              <Button
                size="sm"
                onClick={submitCreate}
                disabled={!newLabel.trim() || create.isPending}
                data-testid="asset-category-create"
              >
                <Plus className="h-4 w-4 mr-1" /> Add
              </Button>
            </div>
          </div>

          <div className="max-h-[50vh] overflow-y-auto">
            {categories.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-8">
                No categories yet. Add one above to get started.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {categories.map((c) => {
                  const isEditing = editingId === c.id;
                  return (
                    <li
                      key={c.id}
                      className="py-2 flex items-center gap-2"
                      data-testid={`asset-category-row-${c.slug}`}
                    >
                      {isEditing ? (
                        <>
                          <Input
                            value={draftLabel}
                            onChange={(e) => setDraftLabel(e.target.value)}
                            className="h-8 flex-1"
                            placeholder="Label"
                          />
                          <Input
                            value={draftSlug}
                            onChange={(e) => setDraftSlug(e.target.value)}
                            className="h-8 w-36"
                            placeholder="slug"
                          />
                          <Input
                            value={draftSort}
                            onChange={(e) => setDraftSort(e.target.value)}
                            className="h-8 w-16"
                            placeholder="sort"
                            type="number"
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => submitEdit(c)}
                            disabled={update.isPending}
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingId(null)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{c.label}</div>
                            <div className="text-xs text-muted-foreground truncate">
                              {c.slug} · sort {c.sortOrder}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => beginEdit(c)}
                            data-testid={`asset-category-edit-${c.slug}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              if (
                                confirm(
                                  `Delete category "${c.label}"? Assets tagged with it will become uncategorized.`,
                                )
                              ) {
                                del.mutate({ id: c.id });
                              }
                            }}
                            data-testid={`asset-category-delete-${c.slug}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
