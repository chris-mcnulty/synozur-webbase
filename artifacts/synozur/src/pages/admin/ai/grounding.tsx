import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, Upload, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useAdminAccess } from "@/components/admin/AdminGate";
import {
  api,
  GROUNDING_CATEGORIES,
  type GroundingCategory,
  type GroundingDocumentDto,
  type GroundingDocumentInput,
} from "@/lib/api";

const CATEGORY_LABELS: Record<GroundingCategory, string> = {
  methodology: "Methodology & Framework",
  best_practices: "Best Practices",
  terminology: "Key Terminology",
  examples: "Examples & Templates",
  about_synozur: "About Synozur",
  brand_voice: "Brand Voice",
  audience_personas: "Audience Personas",
  concierge_persona: "Concierge Persona",
};

const INSTRUCTIONAL: ReadonlySet<GroundingCategory> = new Set([
  "methodology",
  "best_practices",
  "terminology",
  "examples",
]);

interface DraftState {
  id: string | null;
  title: string;
  description: string;
  category: GroundingCategory;
  content: string;
  scopeTagsRaw: string;
  priority: number;
  isActive: boolean;
  conciergeEligible: boolean;
}

function emptyDraft(): DraftState {
  return {
    id: null,
    title: "",
    description: "",
    category: "methodology",
    content: "",
    scopeTagsRaw: "",
    priority: 0,
    isActive: true,
    conciergeEligible: true,
  };
}

function fromDto(d: GroundingDocumentDto): DraftState {
  return {
    id: d.id,
    title: d.title,
    description: d.description ?? "",
    category: d.category,
    content: d.content,
    scopeTagsRaw: (d.scopeTags ?? []).join(", "),
    priority: d.priority,
    isActive: d.isActive,
    conciergeEligible: d.conciergeEligible,
  };
}

function toInput(draft: DraftState): GroundingDocumentInput {
  const tags = draft.scopeTagsRaw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return {
    title: draft.title.trim(),
    description: draft.description.trim() || null,
    category: draft.category,
    content: draft.content,
    scopeTags: tags.length > 0 ? tags : null,
    priority: draft.priority,
    isActive: draft.isActive,
    conciergeEligible: draft.conciergeEligible,
  };
}

export default function AdminAiGrounding() {
  const { access } = useAdminAccess();
  const qc = useQueryClient();
  const { toast } = useToast();
  const canManage = !!access?.hasCapability("ai.grounding.manage");

  const listQ = useQuery({
    queryKey: ["admin-ai-grounding"],
    queryFn: () => api.listGroundingDocuments(),
    enabled: canManage,
  });
  const items = listQ.data?.items ?? [];

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DraftState>(emptyDraft());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const createMut = useMutation({
    mutationFn: (body: GroundingDocumentInput) =>
      api.createGroundingDocument(body),
    onSuccess: () => {
      toast({ title: "Grounding document created" });
      qc.invalidateQueries({ queryKey: ["admin-ai-grounding"] });
      setOpen(false);
    },
    onError: (e: Error) =>
      toast({
        title: "Create failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  const updateMut = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: Partial<GroundingDocumentInput>;
    }) => api.updateGroundingDocument(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-ai-grounding"] });
    },
    onError: (e: Error) =>
      toast({
        title: "Update failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deleteGroundingDocument(id),
    onSuccess: () => {
      toast({ title: "Document deleted" });
      qc.invalidateQueries({ queryKey: ["admin-ai-grounding"] });
    },
    onError: (e: Error) =>
      toast({
        title: "Delete failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  function openNew() {
    setDraft(emptyDraft());
    setOpen(true);
  }

  function openEdit(d: GroundingDocumentDto) {
    setDraft(fromDto(d));
    setOpen(true);
  }

  function handleSave() {
    if (!draft.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    if (!draft.content.trim()) {
      toast({ title: "Content is required", variant: "destructive" });
      return;
    }
    const body = toInput(draft);
    if (draft.id) {
      updateMut.mutate(
        { id: draft.id, body },
        {
          onSuccess: () => {
            toast({ title: "Document saved" });
            setOpen(false);
          },
        },
      );
    } else {
      createMut.mutate(body);
    }
  }

  function handleDelete(d: GroundingDocumentDto) {
    if (!window.confirm(`Delete "${d.title}"? This cannot be undone.`)) return;
    deleteMut.mutate(d.id);
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ""; // reset so re-uploading the same file works
    const ext = file.name.split(".").pop()?.toLowerCase();
    setUploading(true);
    try {
      let markdown = "";
      if (ext === "pdf") {
        markdown = (await api.parseGroundingPdf(file)).markdown;
      } else if (ext === "docx") {
        markdown = (await api.parseGroundingDocx(file)).markdown;
      } else if (ext === "md" || ext === "markdown" || ext === "txt") {
        markdown = await file.text();
      } else {
        toast({
          title: "Unsupported file type",
          description: "Upload a .pdf, .docx, .md, or .txt file.",
          variant: "destructive",
        });
        return;
      }
      setDraft((prev) => ({
        ...prev,
        content: prev.content
          ? `${prev.content}\n\n${markdown}`
          : markdown,
        title: prev.title || file.name.replace(/\.[^.]+$/, ""),
      }));
      toast({ title: "File imported" });
    } catch (err) {
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  }

  const grouped = useMemo(() => {
    const out: Record<string, GroundingDocumentDto[]> = {};
    for (const item of items) {
      const key = item.category;
      if (!out[key]) out[key] = [];
      out[key].push(item);
    }
    return out;
  }, [items]);

  if (!canManage) {
    return (
      <AdminLayout
        title="AI Grounding"
        crumbs={[{ label: "Admin", href: "/" }, { label: "AI Grounding" }]}
      >
        <Card className="p-6">
          <p className="text-sm text-muted-foreground">
            You need the <code>ai.grounding.manage</code> capability to manage
            grounding documents.
          </p>
        </Card>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout
      title="AI Grounding"
      crumbs={[{ label: "Admin", href: "/" }, { label: "AI Grounding" }]}
    >
      <div className="space-y-4">
        <Card className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                Standalone admin-authored documents injected wholesale into the
                system prompt of every AI call. Higher priority docs appear
                first; inactive docs are skipped. Categories are split into
                <em> instructional</em> (methodology, best practices,
                terminology, examples) and <em>contextual</em> (about Synozur,
                brand voice, audience personas, concierge persona).
              </p>
              <p className="text-xs text-muted-foreground">
                {items.length} document{items.length === 1 ? "" : "s"} ·{" "}
                {items.filter((d) => d.isActive).length} active
              </p>
            </div>
            <Button onClick={openNew} data-testid="button-new-grounding">
              <Plus className="mr-2 h-4 w-4" /> New document
            </Button>
          </div>
        </Card>

        {listQ.isLoading ? (
          <Card className="p-6">
            <p className="text-sm text-muted-foreground">Loading…</p>
          </Card>
        ) : items.length === 0 ? (
          <Card className="p-6 text-center space-y-2">
            <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="text-sm">No grounding documents yet.</p>
            <p className="text-xs text-muted-foreground">
              Add your first document to ground every AI call across the site.
            </p>
          </Card>
        ) : (
          GROUNDING_CATEGORIES.map((cat) => {
            const list = grouped[cat] ?? [];
            if (list.length === 0) return null;
            return (
              <Card key={cat} className="p-4">
                <div className="mb-3 flex items-center gap-2">
                  <h3 className="text-sm font-semibold">
                    {CATEGORY_LABELS[cat]}
                  </h3>
                  <Badge variant="outline" className="text-xs">
                    {INSTRUCTIONAL.has(cat) ? "Instructional" : "Contextual"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {list.length}
                  </span>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead className="w-32">Priority</TableHead>
                      <TableHead className="w-32">Scope</TableHead>
                      <TableHead className="w-28">Active</TableHead>
                      <TableHead className="w-32">Concierge</TableHead>
                      <TableHead className="w-32 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.map((d) => (
                      <TableRow key={d.id} data-testid={`grounding-row-${d.id}`}>
                        <TableCell>
                          <div className="font-medium">{d.title}</div>
                          {d.description && (
                            <div className="text-xs text-muted-foreground">
                              {d.description}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">{d.priority}</TableCell>
                        <TableCell>
                          {(d.scopeTags ?? []).length === 0 ? (
                            <span className="text-xs text-muted-foreground">
                              All
                            </span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {d.scopeTags.map((t) => (
                                <Badge
                                  key={t}
                                  variant="secondary"
                                  className="text-xs"
                                >
                                  {t}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={d.isActive}
                            onCheckedChange={(checked) =>
                              updateMut.mutate({
                                id: d.id,
                                body: { isActive: checked },
                              })
                            }
                            aria-label={`Toggle Active for ${d.title}`}
                            data-testid={`toggle-active-${d.id}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={d.conciergeEligible}
                            onCheckedChange={(checked) =>
                              updateMut.mutate({
                                id: d.id,
                                body: { conciergeEligible: checked },
                              })
                            }
                            aria-label={`Toggle Concierge eligibility for ${d.title}`}
                            data-testid={`toggle-concierge-${d.id}`}
                          />
                        </TableCell>
                        <TableCell className="text-right space-x-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEdit(d)}
                            aria-label={`Edit ${d.title}`}
                            title={`Edit ${d.title}`}
                            data-testid={`button-edit-${d.id}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(d)}
                            aria-label={`Delete ${d.title}`}
                            title={`Delete ${d.title}`}
                            data-testid={`button-delete-${d.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            );
          })
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {draft.id ? "Edit grounding document" : "New grounding document"}
            </DialogTitle>
            <DialogDescription>
              The document content is injected verbatim into the system prompt
              of every AI call where it matches scope.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="grounding-title">Title</Label>
              <Input
                id="grounding-title"
                value={draft.title}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, title: e.target.value }))
                }
                data-testid="input-grounding-title"
              />
            </div>
            <div>
              <Label htmlFor="grounding-description">
                Description{" "}
                <span className="text-xs text-muted-foreground">
                  (admin-only, not sent to model)
                </span>
              </Label>
              <Input
                id="grounding-description"
                value={draft.description}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, description: e.target.value }))
                }
                data-testid="input-grounding-description"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="grounding-category">Category</Label>
                <Select
                  value={draft.category}
                  onValueChange={(v) =>
                    setDraft((d) => ({
                      ...d,
                      category: v as GroundingCategory,
                    }))
                  }
                >
                  <SelectTrigger
                    id="grounding-category"
                    data-testid="select-grounding-category"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GROUNDING_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {CATEGORY_LABELS[c]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="grounding-priority">Priority</Label>
                <Input
                  id="grounding-priority"
                  type="number"
                  value={draft.priority}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      priority: parseInt(e.target.value, 10) || 0,
                    }))
                  }
                  data-testid="input-grounding-priority"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="grounding-scope">
                Scope tags{" "}
                <span className="text-xs text-muted-foreground">
                  (comma-separated; leave empty to inject for every call)
                </span>
              </Label>
              <Input
                id="grounding-scope"
                placeholder="e.g. financial-services, public-sector"
                value={draft.scopeTagsRaw}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, scopeTagsRaw: e.target.value }))
                }
                data-testid="input-grounding-scope"
              />
            </div>
            <div className="flex items-center gap-6">
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- Radix Switch renders its own associated <button role="switch"> child. */}
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={draft.isActive}
                  onCheckedChange={(checked) =>
                    setDraft((d) => ({ ...d, isActive: checked }))
                  }
                  data-testid="switch-grounding-active"
                />
                Active
              </label>
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- Radix Switch renders its own associated <button role="switch"> child. */}
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={draft.conciergeEligible}
                  onCheckedChange={(checked) =>
                    setDraft((d) => ({ ...d, conciergeEligible: checked }))
                  }
                  data-testid="switch-grounding-concierge"
                />
                Eligible for the Astra concierge
              </label>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label htmlFor="grounding-content">Content (Markdown)</Label>
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.docx,.md,.markdown,.txt"
                    onChange={handleFileUpload}
                    className="hidden"
                    data-testid="input-grounding-file"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    data-testid="button-grounding-upload"
                  >
                    <Upload className="mr-1 h-3 w-3" />
                    {uploading ? "Importing…" : "Import PDF / DOCX / MD"}
                  </Button>
                </div>
              </div>
              <Textarea
                id="grounding-content"
                value={draft.content}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, content: e.target.value }))
                }
                rows={14}
                className="font-mono text-sm"
                data-testid="textarea-grounding-content"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={createMut.isPending || updateMut.isPending}
              data-testid="button-grounding-save"
            >
              {draft.id ? "Save changes" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
