import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Download,
  ExternalLink,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useAdminAccess } from "@/components/admin/AdminGate";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  landingPagesApi,
  type LandingPageBlock,
  type LandingPageDto,
  type LandingPageStatus,
  type CardGridCard,
  type LandingPageCTA,
} from "@/lib/api-landing-pages";

// Editor for a single DB-backed landing page (e.g. /ai-training). The form is
// intentionally lightweight — each block type has its own subform — so we
// keep complexity per-type rather than building a generic block schema UI.

interface Props {
  id?: string;
}

interface Draft {
  slug: string;
  title: string;
  status: LandingPageStatus;
  seoTitle: string;
  seoDescription: string;
  seoCanonicalUrl: string;
  ogImageUrl: string;
  blocks: LandingPageBlock[];
  // Parallel array of stable client-only ids used as React keys. The DB
  // block payloads have no natural id, and using the array index as a key
  // would let input state lag behind after a reorder/remove (e.g. text
  // typed into card 2 would visually stick to whatever block lands at
  // index 2 after a move). Kept in lockstep with `blocks` on every
  // mutation and discarded on save.
  blockKeys: string[];
}

function newKey(): string {
  // Cheap, collision-free for editor lifetime — these keys never leave
  // the client. crypto.randomUUID is available in all targeted browsers
  // but guard for older test environments.
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const EMPTY_DRAFT: Draft = {
  slug: "",
  title: "",
  status: "draft",
  seoTitle: "",
  seoDescription: "",
  seoCanonicalUrl: "",
  ogImageUrl: "",
  blocks: [],
  blockKeys: [],
};

function toDraft(p: LandingPageDto): Draft {
  return {
    slug: p.slug,
    title: p.title,
    status: p.status,
    seoTitle: p.seoTitle ?? "",
    seoDescription: p.seoDescription ?? "",
    seoCanonicalUrl: p.seoCanonicalUrl ?? "",
    ogImageUrl: p.ogImageUrl ?? "",
    blocks: p.blocks,
    blockKeys: p.blocks.map(() => newKey()),
  };
}

const BLOCK_TEMPLATES: Record<LandingPageBlock["type"], () => LandingPageBlock> =
  {
    hero: () => ({
      type: "hero",
      eyebrow: "",
      title: "Headline",
      subtitle: "",
      theme: "nebula",
    }),
    richText: () => ({ type: "richText", heading: "", bodyHtml: "" }),
    cardGrid: () => ({
      type: "cardGrid",
      heading: "",
      intro: "",
      cards: [],
    }),
    cta: () => ({
      type: "cta",
      heading: "",
      body: "",
      buttons: [{ label: "Talk to us", href: "/contact", variant: "primary" }],
      theme: "nebula",
    }),
    image: () => ({ type: "image", url: "", alt: "", caption: "" }),
    faq: () => ({ type: "faq", heading: "", items: [] }),
  };

const BLOCK_LABELS: Record<LandingPageBlock["type"], string> = {
  hero: "Hero",
  richText: "Rich text",
  cardGrid: "Card grid",
  cta: "Call to action",
  image: "Image",
  faq: "FAQ",
};

export default function LandingPageEdit({ id }: Props) {
  const isNew = !id;
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { access } = useAdminAccess();
  const canWrite = !!access?.isEditorOrAbove;

  const existingQ = useQuery({
    queryKey: ["admin-landing-page", id],
    queryFn: () => landingPagesApi.getAdmin(id as string),
    enabled: !isNew,
  });

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [hydrated, setHydrated] = useState(isNew);

  useEffect(() => {
    if (existingQ.data && !hydrated) {
      setDraft(toDraft(existingQ.data));
      setHydrated(true);
    }
  }, [existingQ.data, hydrated]);

  const createMut = useMutation({
    mutationFn: () =>
      landingPagesApi.create({
        slug: draft.slug || null,
        title: draft.title,
        status: draft.status,
        blocks: draft.blocks,
        seoTitle: draft.seoTitle || null,
        seoDescription: draft.seoDescription || null,
        seoCanonicalUrl: draft.seoCanonicalUrl || null,
        ogImageUrl: draft.ogImageUrl || null,
      }),
    onSuccess: (row) => {
      toast({ title: "Landing page created" });
      qc.invalidateQueries({ queryKey: ["admin-landing-pages"] });
      setLocation(`/site-config/landing-pages/${row.id}/edit`);
    },
    onError: (e: Error) =>
      toast({
        title: "Create failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  const updateMut = useMutation({
    mutationFn: () =>
      landingPagesApi.update(id as string, {
        slug: draft.slug || null,
        title: draft.title,
        status: draft.status,
        blocks: draft.blocks,
        seoTitle: draft.seoTitle || null,
        seoDescription: draft.seoDescription || null,
        seoCanonicalUrl: draft.seoCanonicalUrl || null,
        ogImageUrl: draft.ogImageUrl || null,
      }),
    onSuccess: (row) => {
      toast({ title: "Landing page saved" });
      qc.invalidateQueries({ queryKey: ["admin-landing-pages"] });
      qc.invalidateQueries({ queryKey: ["admin-landing-page", id] });
      qc.invalidateQueries({ queryKey: ["landing-page", row.slug] });
    },
    onError: (e: Error) =>
      toast({
        title: "Save failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  const saving = createMut.isPending || updateMut.isPending;

  const onSave = () => {
    if (!canWrite) return;
    if (!draft.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    if (isNew) createMut.mutate();
    else updateMut.mutate();
  };

  const addBlock = (type: LandingPageBlock["type"]) =>
    setDraft((d) => ({
      ...d,
      blocks: [...d.blocks, BLOCK_TEMPLATES[type]()],
      blockKeys: [...d.blockKeys, newKey()],
    }));

  const updateBlock = (index: number, next: LandingPageBlock) =>
    setDraft((d) => ({
      ...d,
      blocks: d.blocks.map((b, i) => (i === index ? next : b)),
    }));

  const removeBlock = (index: number) =>
    setDraft((d) => ({
      ...d,
      blocks: d.blocks.filter((_, i) => i !== index),
      blockKeys: d.blockKeys.filter((_, i) => i !== index),
    }));

  const moveBlock = (index: number, dir: -1 | 1) =>
    setDraft((d) => {
      const target = index + dir;
      if (target < 0 || target >= d.blocks.length) return d;
      const nextBlocks = [...d.blocks];
      const nextKeys = [...d.blockKeys];
      [nextBlocks[index], nextBlocks[target]] = [nextBlocks[target], nextBlocks[index]];
      [nextKeys[index], nextKeys[target]] = [nextKeys[target], nextKeys[index]];
      return { ...d, blocks: nextBlocks, blockKeys: nextKeys };
    });

  const title = useMemo(
    () => (isNew ? "New landing page" : draft.title || "Landing page"),
    [isNew, draft.title],
  );

  const onExport = async () => {
    if (!id) return;
    try {
      const payload = await landingPagesApi.exportPage(id);
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `${payload.page.slug}.landing-page.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      toast({ title: "Exported", description: `${payload.page.slug}.landing-page.json` });
    } catch (e) {
      toast({
        title: "Export failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  };

  if (!isNew && existingQ.isLoading) {
    return (
      <AdminLayout title="Landing page" crumbs={[{ label: "Admin", href: "/" }]}>
        <div className="text-muted-foreground">Loading…</div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout
      title={title}
      crumbs={[
        { label: "Admin", href: "/" },
        { label: "Landing Pages", href: "/site-config/landing-pages" },
        { label: title },
      ]}
      actions={
        <div className="flex items-center gap-2">
          {!isNew && (
            <Button
              variant="outline"
              onClick={onExport}
              data-testid="button-export-landing-page"
            >
              <Download className="h-4 w-4 mr-2" /> Export
            </Button>
          )}
          {!isNew && draft.status === "published" && (
            <Button asChild variant="outline">
              <a
                href={`/${draft.slug}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="h-4 w-4 mr-2" /> View
              </a>
            </Button>
          )}
          <Button
            onClick={onSave}
            disabled={!canWrite || saving}
            data-testid="button-save-landing-page"
          >
            <Save className="h-4 w-4 mr-2" /> {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
        <div className="space-y-6">
          {/* Page-level fields */}
          <Card>
            <CardHeader>
              <CardTitle>Page</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="lp-title">Title</Label>
                <Input
                  id="lp-title"
                  value={draft.title}
                  onChange={(e) =>
                    setDraft({ ...draft, title: e.target.value })
                  }
                  disabled={!canWrite}
                  data-testid="input-title"
                />
              </div>
              <div>
                <Label htmlFor="lp-slug">Slug (URL path)</Label>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground font-mono text-sm">
                    /
                  </span>
                  <Input
                    id="lp-slug"
                    value={draft.slug}
                    onChange={(e) =>
                      setDraft({ ...draft, slug: e.target.value })
                    }
                    placeholder={isNew ? "derived from title" : ""}
                    disabled={!canWrite}
                    data-testid="input-slug"
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Lowercase letters, numbers, and hyphens. Will be uniquified
                  if it collides.
                </p>
              </div>
              <div>
                <Label htmlFor="lp-status">Status</Label>
                <Select
                  value={draft.status}
                  onValueChange={(v) =>
                    setDraft({ ...draft, status: v as LandingPageStatus })
                  }
                  disabled={!canWrite}
                >
                  <SelectTrigger id="lp-status" data-testid="select-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="published">Published</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Blocks */}
          <Card>
            <CardHeader>
              <CardTitle>Blocks</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {draft.blocks.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No blocks yet. Add a hero, then build up the page below.
                </p>
              )}
              {draft.blocks.map((block, i) => (
                <BlockEditor
                  key={draft.blockKeys[i] ?? i}
                  index={i}
                  total={draft.blocks.length}
                  block={block}
                  disabled={!canWrite}
                  onChange={(next) => updateBlock(i, next)}
                  onRemove={() => removeBlock(i)}
                  onMove={(dir) => moveBlock(i, dir)}
                />
              ))}
              <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                {(Object.keys(BLOCK_TEMPLATES) as LandingPageBlock["type"][]).map(
                  (t) => (
                    <Button
                      key={t}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => addBlock(t)}
                      disabled={!canWrite}
                      data-testid={`button-add-block-${t}`}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      {BLOCK_LABELS[t]}
                    </Button>
                  ),
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* SEO */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>SEO</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="lp-seo-title">SEO title</Label>
                <Input
                  id="lp-seo-title"
                  value={draft.seoTitle}
                  onChange={(e) =>
                    setDraft({ ...draft, seoTitle: e.target.value })
                  }
                  disabled={!canWrite}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Defaults to the page title.
                </p>
              </div>
              <div>
                <Label htmlFor="lp-seo-desc">Meta description</Label>
                <Textarea
                  id="lp-seo-desc"
                  rows={4}
                  value={draft.seoDescription}
                  onChange={(e) =>
                    setDraft({ ...draft, seoDescription: e.target.value })
                  }
                  disabled={!canWrite}
                />
              </div>
              <div>
                <Label htmlFor="lp-canonical">Canonical URL</Label>
                <Input
                  id="lp-canonical"
                  value={draft.seoCanonicalUrl}
                  onChange={(e) =>
                    setDraft({ ...draft, seoCanonicalUrl: e.target.value })
                  }
                  placeholder="Leave blank to use this page's URL"
                  disabled={!canWrite}
                />
              </div>
              <div>
                <Label htmlFor="lp-og">Social share image URL</Label>
                <Input
                  id="lp-og"
                  value={draft.ogImageUrl}
                  onChange={(e) =>
                    setDraft({ ...draft, ogImageUrl: e.target.value })
                  }
                  placeholder="https://…"
                  disabled={!canWrite}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}

// ---------------------------------------------------------------------------
// Block-level editors
// ---------------------------------------------------------------------------

interface BlockEditorProps {
  index: number;
  total: number;
  block: LandingPageBlock;
  disabled: boolean;
  onChange: (next: LandingPageBlock) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}

function BlockEditor({
  index,
  total,
  block,
  disabled,
  onChange,
  onRemove,
  onMove,
}: BlockEditorProps) {
  return (
    <div
      className="rounded-lg border border-border bg-card/50 p-4 space-y-3"
      data-testid={`block-${index}-${block.type}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono uppercase tracking-wide text-muted-foreground">
            #{index + 1}
          </span>
          <span className="text-sm font-medium">{BLOCK_LABELS[block.type]}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onMove(-1)}
            disabled={disabled || index === 0}
            aria-label="Move up"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onMove(1)}
            disabled={disabled || index === total - 1}
            aria-label="Move down"
          >
            <ArrowDown className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onRemove}
            disabled={disabled}
            aria-label="Remove block"
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>
      <BlockFields block={block} disabled={disabled} onChange={onChange} />
    </div>
  );
}

function BlockFields({
  block,
  disabled,
  onChange,
}: {
  block: LandingPageBlock;
  disabled: boolean;
  onChange: (next: LandingPageBlock) => void;
}) {
  switch (block.type) {
    case "hero":
      return (
        <div className="space-y-3">
          <FieldRow>
            <FormField label="Eyebrow">
              <Input
                value={block.eyebrow ?? ""}
                onChange={(e) =>
                  onChange({ ...block, eyebrow: e.target.value })
                }
                disabled={disabled}
              />
            </FormField>
            <FormField label="Theme">
              <Select
                value={block.theme ?? "nebula"}
                onValueChange={(v) =>
                  onChange({ ...block, theme: v as "nebula" | "light" })
                }
                disabled={disabled}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nebula">Nebula (dark)</SelectItem>
                  <SelectItem value="light">Light</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          </FieldRow>
          <FormField label="Title">
            <Input
              value={block.title}
              onChange={(e) => onChange({ ...block, title: e.target.value })}
              disabled={disabled}
            />
          </FormField>
          <FormField label="Subtitle">
            <Textarea
              rows={3}
              value={block.subtitle ?? ""}
              onChange={(e) =>
                onChange({ ...block, subtitle: e.target.value })
              }
              disabled={disabled}
            />
          </FormField>
        </div>
      );

    case "richText":
      return (
        <div className="space-y-3">
          <FormField label="Heading (optional)">
            <Input
              value={block.heading ?? ""}
              onChange={(e) =>
                onChange({ ...block, heading: e.target.value })
              }
              disabled={disabled}
            />
          </FormField>
          <FormField
            label="Body (HTML)"
            hint="Paste HTML or write paragraphs. The published page renders this as-is, so trust the source."
          >
            <Textarea
              rows={8}
              value={block.bodyHtml}
              onChange={(e) =>
                onChange({ ...block, bodyHtml: e.target.value })
              }
              disabled={disabled}
              className="font-mono text-xs"
            />
          </FormField>
        </div>
      );

    case "cardGrid":
      return (
        <CardGridFields
          block={block}
          disabled={disabled}
          onChange={onChange}
        />
      );

    case "cta":
      return (
        <CtaFields block={block} disabled={disabled} onChange={onChange} />
      );

    case "image":
      return (
        <div className="space-y-3">
          <FormField label="Image URL">
            <Input
              value={block.url}
              onChange={(e) => onChange({ ...block, url: e.target.value })}
              placeholder="https://…"
              disabled={disabled}
            />
          </FormField>
          <FieldRow>
            <FormField label="Alt text">
              <Input
                value={block.alt ?? ""}
                onChange={(e) => onChange({ ...block, alt: e.target.value })}
                disabled={disabled}
              />
            </FormField>
            <FormField label="Caption">
              <Input
                value={block.caption ?? ""}
                onChange={(e) =>
                  onChange({ ...block, caption: e.target.value })
                }
                disabled={disabled}
              />
            </FormField>
          </FieldRow>
        </div>
      );

    case "faq":
      return <FaqFields block={block} disabled={disabled} onChange={onChange} />;
  }
}

function CardGridFields({
  block,
  disabled,
  onChange,
}: {
  block: Extract<LandingPageBlock, { type: "cardGrid" }>;
  disabled: boolean;
  onChange: (next: LandingPageBlock) => void;
}) {
  const updateCard = (i: number, next: CardGridCard) =>
    onChange({
      ...block,
      cards: block.cards.map((c, idx) => (idx === i ? next : c)),
    });
  const removeCard = (i: number) =>
    onChange({ ...block, cards: block.cards.filter((_, idx) => idx !== i) });
  const addCard = () =>
    onChange({
      ...block,
      cards: [
        ...block.cards,
        { code: "", title: "Card title", description: "", url: "", source: "", level: "" },
      ],
    });

  return (
    <div className="space-y-3">
      <FieldRow>
        <FormField label="Heading">
          <Input
            value={block.heading ?? ""}
            onChange={(e) =>
              onChange({ ...block, heading: e.target.value })
            }
            disabled={disabled}
          />
        </FormField>
        <FormField label="Intro text">
          <Input
            value={block.intro ?? ""}
            onChange={(e) => onChange({ ...block, intro: e.target.value })}
            disabled={disabled}
          />
        </FormField>
      </FieldRow>
      <div className="space-y-2">
        {block.cards.map((c, i) => (
          <div
            key={i}
            className="rounded border border-border bg-background p-3 space-y-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Card {i + 1}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeCard(i)}
                disabled={disabled}
                aria-label="Remove card"
              >
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </div>
            <FieldRow>
              <FormField label="Code">
                <Input
                  value={c.code ?? ""}
                  onChange={(e) => updateCard(i, { ...c, code: e.target.value })}
                  disabled={disabled}
                />
              </FormField>
              <FormField label="Level">
                <Input
                  value={c.level ?? ""}
                  placeholder="Beginner | Intermediate | Advanced"
                  onChange={(e) => updateCard(i, { ...c, level: e.target.value })}
                  disabled={disabled}
                />
              </FormField>
            </FieldRow>
            <FormField label="Title">
              <Input
                value={c.title}
                onChange={(e) => updateCard(i, { ...c, title: e.target.value })}
                disabled={disabled}
              />
            </FormField>
            <FormField label="Description">
              <Textarea
                rows={2}
                value={c.description ?? ""}
                onChange={(e) =>
                  updateCard(i, { ...c, description: e.target.value })
                }
                disabled={disabled}
              />
            </FormField>
            <FieldRow>
              <FormField label="URL">
                <Input
                  value={c.url ?? ""}
                  onChange={(e) => updateCard(i, { ...c, url: e.target.value })}
                  placeholder="/path or https://…"
                  disabled={disabled}
                />
              </FormField>
              <FormField label="Source">
                <Input
                  value={c.source ?? ""}
                  onChange={(e) =>
                    updateCard(i, { ...c, source: e.target.value })
                  }
                  disabled={disabled}
                />
              </FormField>
            </FieldRow>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addCard}
          disabled={disabled}
        >
          <Plus className="h-3 w-3 mr-1" /> Add card
        </Button>
      </div>
    </div>
  );
}

function CtaFields({
  block,
  disabled,
  onChange,
}: {
  block: Extract<LandingPageBlock, { type: "cta" }>;
  disabled: boolean;
  onChange: (next: LandingPageBlock) => void;
}) {
  const updateBtn = (i: number, next: LandingPageCTA) =>
    onChange({
      ...block,
      buttons: block.buttons.map((b, idx) => (idx === i ? next : b)),
    });
  const removeBtn = (i: number) =>
    onChange({
      ...block,
      buttons: block.buttons.filter((_, idx) => idx !== i),
    });
  const addBtn = () =>
    onChange({
      ...block,
      buttons: [...block.buttons, { label: "Button", href: "/", variant: "secondary" }],
    });

  return (
    <div className="space-y-3">
      <FieldRow>
        <FormField label="Heading">
          <Input
            value={block.heading}
            onChange={(e) => onChange({ ...block, heading: e.target.value })}
            disabled={disabled}
          />
        </FormField>
        <FormField label="Theme">
          <Select
            value={block.theme ?? "nebula"}
            onValueChange={(v) =>
              onChange({ ...block, theme: v as "nebula" | "light" })
            }
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="nebula">Nebula (dark)</SelectItem>
              <SelectItem value="light">Light</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
      </FieldRow>
      <FormField label="Body">
        <Textarea
          rows={3}
          value={block.body ?? ""}
          onChange={(e) => onChange({ ...block, body: e.target.value })}
          disabled={disabled}
        />
      </FormField>
      <div className="space-y-2">
        {block.buttons.map((b, i) => (
          <div
            key={i}
            className="rounded border border-border bg-background p-3 space-y-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Button {i + 1}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeBtn(i)}
                disabled={disabled}
                aria-label="Remove button"
              >
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </div>
            <FieldRow>
              <FormField label="Label">
                <Input
                  value={b.label}
                  onChange={(e) => updateBtn(i, { ...b, label: e.target.value })}
                  disabled={disabled}
                />
              </FormField>
              <FormField label="Variant">
                <Select
                  value={b.variant ?? "primary"}
                  onValueChange={(v) =>
                    updateBtn(i, { ...b, variant: v as "primary" | "secondary" })
                  }
                  disabled={disabled}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="primary">Primary</SelectItem>
                    <SelectItem value="secondary">Secondary</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            </FieldRow>
            <FormField label="Href">
              <Input
                value={b.href}
                onChange={(e) => updateBtn(i, { ...b, href: e.target.value })}
                placeholder="/path or https://…"
                disabled={disabled}
              />
            </FormField>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addBtn}
          disabled={disabled}
        >
          <Plus className="h-3 w-3 mr-1" /> Add button
        </Button>
      </div>
    </div>
  );
}

function FaqFields({
  block,
  disabled,
  onChange,
}: {
  block: Extract<LandingPageBlock, { type: "faq" }>;
  disabled: boolean;
  onChange: (next: LandingPageBlock) => void;
}) {
  const updateItem = (i: number, next: { q: string; a: string }) =>
    onChange({
      ...block,
      items: block.items.map((it, idx) => (idx === i ? next : it)),
    });
  const removeItem = (i: number) =>
    onChange({ ...block, items: block.items.filter((_, idx) => idx !== i) });
  const addItem = () =>
    onChange({ ...block, items: [...block.items, { q: "", a: "" }] });

  return (
    <div className="space-y-3">
      <FormField label="Heading">
        <Input
          value={block.heading ?? ""}
          onChange={(e) => onChange({ ...block, heading: e.target.value })}
          disabled={disabled}
        />
      </FormField>
      <div className="space-y-2">
        {block.items.map((it, i) => (
          <div
            key={i}
            className="rounded border border-border bg-background p-3 space-y-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Item {i + 1}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeItem(i)}
                disabled={disabled}
                aria-label="Remove item"
              >
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </div>
            <FormField label="Question">
              <Input
                value={it.q}
                onChange={(e) => updateItem(i, { ...it, q: e.target.value })}
                disabled={disabled}
              />
            </FormField>
            <FormField label="Answer">
              <Textarea
                rows={3}
                value={it.a}
                onChange={(e) => updateItem(i, { ...it, a: e.target.value })}
                disabled={disabled}
              />
            </FormField>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addItem}
          disabled={disabled}
        >
          <Plus className="h-3 w-3 mr-1" /> Add item
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tiny helpers — keep the JSX above easy to scan.
// ---------------------------------------------------------------------------

function FormField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}
