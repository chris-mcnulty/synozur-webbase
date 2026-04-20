import { useState } from "react";
import { Plus, Trash2, Pencil, Check, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { AdminLayout } from "@/components/admin/AdminLayout";
import {
  useListCmsCategories,
  useCreateCmsCategory,
  useUpdateCmsCategory,
  useDeleteCmsCategory,
  useListCmsTags,
  useCreateCmsTag,
  useUpdateCmsTag,
  useDeleteCmsTag,
  type Category,
  type Tag,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-");
}

export default function TaxonomyPage() {
  return (
    <AdminLayout
      title="Taxonomy"
      crumbs={[{ label: "Admin", href: "/admin" }, { label: "Taxonomy" }]}
    >
      <Tabs defaultValue="categories">
        <TabsList>
          <TabsTrigger value="categories" data-testid="tab-categories">Categories</TabsTrigger>
          <TabsTrigger value="tags" data-testid="tab-tags">Tags</TabsTrigger>
        </TabsList>
        <TabsContent value="categories" className="mt-4">
          <CategoriesPanel />
        </TabsContent>
        <TabsContent value="tags" className="mt-4">
          <TagsPanel />
        </TabsContent>
      </Tabs>
    </AdminLayout>
  );
}

function CategoriesPanel() {
  const { toast } = useToast();
  const { data, isLoading, refetch } = useListCmsCategories();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editSlug, setEditSlug] = useState("");

  const create = useCreateCmsCategory({
    mutation: { onSuccess: () => { setName(""); refetch(); }, onError: (e: Error) => toast({ title: e.message, variant: "destructive" }) },
  });
  const update = useUpdateCmsCategory({
    mutation: { onSuccess: () => { setEditing(null); refetch(); }, onError: (e: Error) => toast({ title: e.message, variant: "destructive" }) },
  });
  const del = useDeleteCmsCategory({
    mutation: { onSuccess: () => refetch(), onError: (e: Error) => toast({ title: e.message, variant: "destructive" }) },
  });

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-4">
        <Input
          placeholder="New category name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid="input-new-category"
        />
        <Button
          onClick={() => name && create.mutate({ data: { slug: slugify(name), name } })}
          disabled={!name || create.isPending}
          data-testid="button-add-category"
        >
          <Plus className="h-4 w-4 mr-1" /> Add
        </Button>
      </div>
      {isLoading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : (
        <ul className="divide-y divide-border">
          {(data ?? []).map((c: Category) => (
            <li key={c.id} className="py-2 flex items-center gap-3" data-testid={`cat-row-${c.id}`}>
              {editing === c.id ? (
                <>
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="flex-1" data-testid={`input-edit-name-${c.id}`} />
                  <Input value={editSlug} onChange={(e) => setEditSlug(e.target.value)} className="flex-1 font-mono text-xs" data-testid={`input-edit-slug-${c.id}`} />
                  <Button size="icon" variant="ghost" onClick={() => update.mutate({ id: c.id, data: { name: editName, slug: editSlug } })}>
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => setEditing(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </>
              ) : (
                <>
                  <div className="flex-1">
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-muted-foreground font-mono">{c.slug}</div>
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => { setEditing(c.id); setEditName(c.name); setEditSlug(c.slug); }} data-testid={`edit-cat-${c.id}`}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => confirm(`Delete category "${c.name}"?`) && del.mutate({ id: c.id })} data-testid={`delete-cat-${c.id}`}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </>
              )}
            </li>
          ))}
          {(data ?? []).length === 0 && (
            <li className="py-6 text-center text-muted-foreground text-sm">No categories yet.</li>
          )}
        </ul>
      )}
    </Card>
  );
}

function TagsPanel() {
  const { toast } = useToast();
  const { data, isLoading, refetch } = useListCmsTags();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editSlug, setEditSlug] = useState("");

  const create = useCreateCmsTag({
    mutation: { onSuccess: () => { setName(""); refetch(); }, onError: (e: Error) => toast({ title: e.message, variant: "destructive" }) },
  });
  const update = useUpdateCmsTag({
    mutation: { onSuccess: () => { setEditing(null); refetch(); }, onError: (e: Error) => toast({ title: e.message, variant: "destructive" }) },
  });
  const del = useDeleteCmsTag({
    mutation: { onSuccess: () => refetch(), onError: (e: Error) => toast({ title: e.message, variant: "destructive" }) },
  });

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-4">
        <Input
          placeholder="New tag name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid="input-new-tag"
        />
        <Button
          onClick={() => name && create.mutate({ data: { slug: slugify(name), name } })}
          disabled={!name || create.isPending}
          data-testid="button-add-tag-tax"
        >
          <Plus className="h-4 w-4 mr-1" /> Add
        </Button>
      </div>
      {isLoading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : (
        <ul className="divide-y divide-border">
          {(data ?? []).map((t: Tag) => (
            <li key={t.id} className="py-2 flex items-center gap-3" data-testid={`tag-row-${t.id}`}>
              {editing === t.id ? (
                <>
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="flex-1" />
                  <Input value={editSlug} onChange={(e) => setEditSlug(e.target.value)} className="flex-1 font-mono text-xs" />
                  <Button size="icon" variant="ghost" onClick={() => update.mutate({ id: t.id, data: { name: editName, slug: editSlug } })}>
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => setEditing(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </>
              ) : (
                <>
                  <div className="flex-1">
                    <div className="font-medium">{t.name}</div>
                    <div className="text-xs text-muted-foreground font-mono">{t.slug}</div>
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => { setEditing(t.id); setEditName(t.name); setEditSlug(t.slug); }}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => confirm(`Delete tag "${t.name}"?`) && del.mutate({ id: t.id })}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </>
              )}
            </li>
          ))}
          {(data ?? []).length === 0 && (
            <li className="py-6 text-center text-muted-foreground text-sm">No tags yet.</li>
          )}
        </ul>
      )}
    </Card>
  );
}
