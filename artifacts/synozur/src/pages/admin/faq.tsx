import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GripVertical, Pencil, Plus, Trash2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { RichTextEditor } from "@/components/admin/RichTextEditor";
import { uploadAndRegisterImage } from "@/components/admin/MediaPickerModal";
import { useAdminAccess } from "@/components/admin/AdminGate";
import {
  api,
  type FaqCategoryDto,
  type FaqItemDto,
  type FaqStatus,
} from "@/lib/api";

interface CategoryDraft {
  id: string;
  name: string;
  description: string;
  status: FaqStatus;
}

interface ItemDraft {
  id: string | null;
  categoryId: string;
  question: string;
  answerHtml: string;
  status: FaqStatus;
  seoTitle: string;
  seoDescription: string;
}

function emptyItemDraft(categoryId: string): ItemDraft {
  return {
    id: null,
    categoryId,
    question: "",
    answerHtml: "",
    status: "published",
    seoTitle: "",
    seoDescription: "",
  };
}

export default function AdminFaq() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { access } = useAdminAccess();
  const canWrite = !!access?.isEditorOrAbove;

  const categoriesQ = useQuery({
    queryKey: ["admin-faq-categories"],
    queryFn: () => api.adminListFaqCategories(),
  });

  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);

  const itemsQ = useQuery({
    queryKey: ["admin-faq-items", selectedCategoryId],
    queryFn: () => api.adminListFaqItems(selectedCategoryId ?? undefined),
    enabled: !!selectedCategoryId,
  });

  const categories = categoriesQ.data?.items ?? [];
  const items = itemsQ.data?.items ?? [];

  // Auto-select the first category when data arrives.
  useEffect(() => {
    if (!selectedCategoryId && categories.length > 0) {
      setSelectedCategoryId(categories[0]!.id);
    }
  }, [categories, selectedCategoryId]);

  return (
    <AdminLayout
      title="FAQ"
      crumbs={[{ label: "Admin", href: "/" }, { label: "FAQ" }]}
    >
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
        <CategoriesPanel
          categories={categories}
          isLoading={categoriesQ.isLoading}
          selectedId={selectedCategoryId}
          onSelect={setSelectedCategoryId}
          canWrite={canWrite}
          onChanged={() => {
            qc.invalidateQueries({ queryKey: ["admin-faq-categories"] });
            qc.invalidateQueries({ queryKey: ["faq"] });
          }}
          onDelete={() => {
            setSelectedCategoryId(null);
            qc.invalidateQueries({ queryKey: ["admin-faq-categories"] });
            qc.invalidateQueries({ queryKey: ["faq"] });
          }}
          toast={toast}
        />

        <ItemsPanel
          categoryId={selectedCategoryId}
          items={items}
          isLoading={itemsQ.isLoading}
          canWrite={canWrite}
          onChanged={() => {
            qc.invalidateQueries({ queryKey: ["admin-faq-items", selectedCategoryId] });
            qc.invalidateQueries({ queryKey: ["faq"] });
          }}
          toast={toast}
        />
      </div>
    </AdminLayout>
  );
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

function CategoriesPanel({
  categories,
  isLoading,
  selectedId,
  onSelect,
  canWrite,
  onChanged,
  onDelete,
  toast,
}: {
  categories: FaqCategoryDto[];
  isLoading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  canWrite: boolean;
  onChanged: () => void;
  onDelete: () => void;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const [localOrder, setLocalOrder] = useState<FaqCategoryDto[]>(categories);
  const [dragId, setDragId] = useState<string | null>(null);
  const [editing, setEditing] = useState<CategoryDraft | null>(null);

  useEffect(() => {
    setLocalOrder(categories);
  }, [categories]);

  const reorderMutation = useMutation({
    mutationFn: (ids: string[]) => api.adminReorderFaqCategories(ids),
    onSuccess: onChanged,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.adminDeleteFaqCategory(id),
    onSuccess: () => {
      toast({ title: "Category deleted" });
      onDelete();
    },
  });

  const handleDrop = async (targetId: string) => {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      return;
    }
    const from = localOrder.findIndex((c) => c.id === dragId);
    const to = localOrder.findIndex((c) => c.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...localOrder];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    setLocalOrder(next);
    setDragId(null);
    reorderMutation.mutate(next.map((c) => c.id));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Categories
        </h2>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            setEditing({ id: "", name: "", description: "", status: "published" })
          }
          disabled={!canWrite}
          data-testid="button-new-faq-category"
        >
          <Plus className="h-3.5 w-3.5 mr-1" /> New
        </Button>
      </div>
      <div className="rounded-md border border-border divide-y divide-border bg-card">
        {isLoading ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
        ) : localOrder.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No categories yet.
          </div>
        ) : (
          localOrder.map((c) => (
            <div
              key={c.id}
              draggable={canWrite}
              onDragStart={() => setDragId(c.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void handleDrop(c.id);
              }}
              className={`flex items-center gap-2 px-3 py-2 ${
                selectedId === c.id ? "bg-primary/5" : ""
              } ${dragId === c.id ? "opacity-60" : ""}`}
              data-testid={`faq-category-row-${c.slug}`}
            >
              <button
                type="button"
                className="text-muted-foreground cursor-grab disabled:opacity-30"
                disabled={!canWrite}
                aria-label="Drag to reorder"
              >
                <GripVertical className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="flex-1 text-left text-sm truncate"
                onClick={() => onSelect(c.id)}
              >
                <div className="font-medium truncate">{c.name}</div>
                <div className="text-xs text-muted-foreground">
                  {c.status === "draft" ? "Draft" : "Published"}
                </div>
              </button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() =>
                  setEditing({
                    id: c.id,
                    name: c.name,
                    description: c.description ?? "",
                    status: c.status,
                  })
                }
                disabled={!canWrite}
                data-testid={`faq-category-edit-${c.slug}`}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  if (
                    confirm(
                      `Delete category "${c.name}"? All questions inside will be removed.`,
                    )
                  ) {
                    deleteMutation.mutate(c.id);
                  }
                }}
                disabled={!canWrite}
                data-testid={`faq-category-delete-${c.slug}`}
              >
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          ))
        )}
      </div>

      <CategoryDialog
        draft={editing}
        onClose={() => setEditing(null)}
        onSaved={onChanged}
      />
    </div>
  );
}

function CategoryDialog({
  draft,
  onClose,
  onSaved,
}: {
  draft: CategoryDraft | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [local, setLocal] = useState<CategoryDraft | null>(draft);

  useEffect(() => {
    setLocal(draft);
  }, [draft]);

  const createMutation = useMutation({
    mutationFn: () =>
      api.adminCreateFaqCategory({
        name: local!.name,
        description: local!.description || null,
        status: local!.status,
      }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });
  const updateMutation = useMutation({
    mutationFn: () =>
      api.adminUpdateFaqCategory(local!.id, {
        name: local!.name,
        description: local!.description || null,
        status: local!.status,
      }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });

  if (!local) return null;

  const isEdit = !!local.id;
  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={!!draft} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit category" : "New category"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="faq-cat-name">Name</Label>
            <Input
              id="faq-cat-name"
              value={local.name}
              onChange={(e) => setLocal({ ...local, name: e.target.value })}
              data-testid="faq-category-name"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="faq-cat-desc">Description</Label>
            <Textarea
              id="faq-cat-desc"
              rows={3}
              value={local.description}
              onChange={(e) => setLocal({ ...local, description: e.target.value })}
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={local.status === "published"}
              onCheckedChange={(v) =>
                setLocal({ ...local, status: v ? "published" : "draft" })
              }
            />
            <Label>Published</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={() => (isEdit ? updateMutation.mutate() : createMutation.mutate())}
            disabled={saving || !local.name.trim()}
            data-testid="faq-category-save"
          >
            <Save className="h-3.5 w-3.5 mr-1" />
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

function ItemsPanel({
  categoryId,
  items,
  isLoading,
  canWrite,
  onChanged,
  toast,
}: {
  categoryId: string | null;
  items: FaqItemDto[];
  isLoading: boolean;
  canWrite: boolean;
  onChanged: () => void;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const [localOrder, setLocalOrder] = useState<FaqItemDto[]>(items);
  const [dragId, setDragId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ItemDraft | null>(null);

  useEffect(() => {
    setLocalOrder(items);
  }, [items]);

  const reorderMutation = useMutation({
    mutationFn: (ids: string[]) =>
      api.adminReorderFaqItems(categoryId!, ids),
    onSuccess: onChanged,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.adminDeleteFaqItem(id),
    onSuccess: () => {
      toast({ title: "Question deleted" });
      onChanged();
    },
  });

  const handleDrop = async (targetId: string) => {
    if (!dragId || dragId === targetId || !categoryId) {
      setDragId(null);
      return;
    }
    const from = localOrder.findIndex((c) => c.id === dragId);
    const to = localOrder.findIndex((c) => c.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...localOrder];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    setLocalOrder(next);
    setDragId(null);
    reorderMutation.mutate(next.map((c) => c.id));
  };

  if (!categoryId) {
    return (
      <div className="rounded-md border border-dashed border-border p-12 text-center text-muted-foreground">
        Select a category on the left to manage its questions.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Questions
        </h2>
        <Button
          size="sm"
          onClick={() => setEditing(emptyItemDraft(categoryId))}
          disabled={!canWrite}
          data-testid="button-new-faq-item"
        >
          <Plus className="h-3.5 w-3.5 mr-1" /> New question
        </Button>
      </div>
      <div className="rounded-md border border-border divide-y divide-border bg-card">
        {isLoading ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
        ) : localOrder.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No questions yet.
          </div>
        ) : (
          localOrder.map((it) => (
            <div
              key={it.id}
              draggable={canWrite}
              onDragStart={() => setDragId(it.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void handleDrop(it.id);
              }}
              className={`flex items-center gap-2 px-3 py-2 ${
                dragId === it.id ? "opacity-60" : ""
              }`}
              data-testid={`faq-item-row-${it.slug}`}
            >
              <button
                type="button"
                className="text-muted-foreground cursor-grab disabled:opacity-30"
                disabled={!canWrite}
                aria-label="Drag to reorder"
              >
                <GripVertical className="h-4 w-4" />
              </button>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{it.question}</div>
                <div className="text-xs text-muted-foreground">
                  {it.status === "draft" ? "Draft" : "Published"} · /{it.slug}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() =>
                  setEditing({
                    id: it.id,
                    categoryId: it.categoryId,
                    question: it.question,
                    answerHtml: it.answerHtml,
                    status: it.status,
                    seoTitle: it.seoTitle ?? "",
                    seoDescription: it.seoDescription ?? "",
                  })
                }
                disabled={!canWrite}
                data-testid={`faq-item-edit-${it.slug}`}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  if (confirm(`Delete question "${it.question}"?`)) {
                    deleteMutation.mutate(it.id);
                  }
                }}
                disabled={!canWrite}
                data-testid={`faq-item-delete-${it.slug}`}
              >
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          ))
        )}
      </div>

      <ItemDialog
        draft={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          onChanged();
          setEditing(null);
        }}
      />
    </div>
  );
}

function ItemDialog({
  draft,
  onClose,
  onSaved,
}: {
  draft: ItemDraft | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [local, setLocal] = useState<ItemDraft | null>(draft);

  useEffect(() => {
    setLocal(draft);
  }, [draft]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!local) return null;
      if (local.id) {
        return api.adminUpdateFaqItem(local.id, {
          question: local.question,
          answerHtml: local.answerHtml,
          status: local.status,
          seoTitle: local.seoTitle || null,
          seoDescription: local.seoDescription || null,
        });
      }
      return api.adminCreateFaqItem({
        categoryId: local.categoryId,
        question: local.question,
        answerHtml: local.answerHtml,
        status: local.status,
        seoTitle: local.seoTitle || null,
        seoDescription: local.seoDescription || null,
      });
    },
    onSuccess: onSaved,
  });

  if (!local) return null;
  const isEdit = !!local.id;

  return (
    <Dialog open={!!draft} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit question" : "New question"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="faq-item-q">Question</Label>
            <Input
              id="faq-item-q"
              value={local.question}
              onChange={(e) => setLocal({ ...local, question: e.target.value })}
              data-testid="faq-item-question"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Answer</Label>
            <RichTextEditor
              value={local.answerHtml}
              onChange={({ html }) => setLocal({ ...local, answerHtml: html })}
              onUploadImage={uploadAndRegisterImage}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="faq-item-seo-title">SEO title</Label>
              <Input
                id="faq-item-seo-title"
                value={local.seoTitle}
                onChange={(e) => setLocal({ ...local, seoTitle: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Switch
                checked={local.status === "published"}
                onCheckedChange={(v) =>
                  setLocal({ ...local, status: v ? "published" : "draft" })
                }
              />
              <Label>Published</Label>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="faq-item-seo-desc">SEO description</Label>
            <Textarea
              id="faq-item-seo-desc"
              rows={2}
              value={local.seoDescription}
              onChange={(e) =>
                setLocal({ ...local, seoDescription: e.target.value })
              }
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saveMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !local.question.trim()}
            data-testid="faq-item-save"
          >
            <Save className="h-3.5 w-3.5 mr-1" />
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
