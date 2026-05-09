import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, RefreshCw, Save, Trash2, Image as ImageIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { ActivityTab } from "@/components/admin/ActivityTab";
import { TaxonomyPicker } from "@/components/admin/TaxonomyPicker";
import { useAdminAccess } from "@/components/admin/AdminGate";
import { MediaPickerModal, mediaUrl } from "@/components/admin/MediaPickerModal";
import { useToast } from "@/hooks/use-toast";
import type { MediaItem } from "@workspace/api-client-react";
import {
  emptyWorkshopInput,
  workshopsApi,
  type WorkshopDto,
  type WorkshopInput,
} from "@/lib/api-workshops";
import { api, type BookingDto } from "@/lib/api";

interface Props {
  id?: string;
}

// ---- Small field primitives -------------------------------------------

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function StringListEditor({
  value,
  onChange,
  placeholder,
  rows = 1,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  rows?: number;
}) {
  const update = (idx: number, v: string) => {
    const next = [...value];
    next[idx] = v;
    onChange(next);
  };
  const remove = (idx: number) => {
    const next = [...value];
    next.splice(idx, 1);
    onChange(next);
  };
  const add = () => onChange([...value, ""]);
  return (
    <div className="space-y-2">
      {value.map((item, i) => (
        <div key={i} className="flex items-start gap-2">
          {rows > 1 ? (
            <Textarea
              rows={rows}
              value={item}
              placeholder={placeholder}
              onChange={(e) => update(i, e.target.value)}
              className="flex-1"
            />
          ) : (
            <Input
              value={item}
              placeholder={placeholder}
              onChange={(e) => update(i, e.target.value)}
              className="flex-1"
            />
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => remove(i)}
            aria-label="Remove item"
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add}>
        <Plus className="h-4 w-4 mr-1" /> Add
      </Button>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border p-5 space-y-4">
      <header>
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

// ---- Form --------------------------------------------------------------

export default function WorkshopEdit({ id }: Props) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const isNew = !id;

  const [form, setForm] = useState<WorkshopInput>(() => emptyWorkshopInput());
  const [error, setError] = useState<string | null>(null);
  const [showHeroPicker, setShowHeroPicker] = useState(false);
  const { access } = useAdminAccess();

  const existingQ = useQuery<WorkshopDto>({
    queryKey: ["admin-workshop", id],
    queryFn: () => workshopsApi.getAdmin(id!),
    enabled: !!id,
  });

  useEffect(() => {
    if (!existingQ.data) return;
    const w = existingQ.data;
    setForm({
      slug: w.slug,
      title: w.title,
      category: w.category,
      shortDescription: w.shortDescription,
      heroHeadline: w.heroHeadline,
      heroSubhead: w.heroSubhead,
      heroImage: w.heroImage,
      heroTrustBullets: w.heroTrustBullets,
      primaryCTA: w.primaryCTA,
      secondaryCTA: w.secondaryCTA,
      deliveryFormat: w.deliveryFormat,
      duration: w.duration,
      whoItsFor: w.whoItsFor,
      idealParticipants: w.idealParticipants,
      prerequisites: w.prerequisites,
      pain: w.pain,
      scope: w.scope,
      process: w.process,
      deliverables: w.deliverables,
      price: w.price,
      diagnostic: w.diagnostic,
      competitiveIntel: w.competitiveIntel,
      toolingNote: w.toolingNote,
      outcomes: w.outcomes,
      beforeExample: w.beforeExample,
      afterExample: w.afterExample,
      sampleDeliverables: w.sampleDeliverables,
      faq: w.faq,
      seo: w.seo,
      displayOrder: w.displayOrder,
      serviceId: w.serviceId ?? null,
      solutionId: w.solutionId ?? null,
      bookingId: w.bookingId ?? null,
      active: w.active,
    });
  }, [existingQ.data]);

  const bookingsQ = useQuery({ queryKey: ["admin-bookings"], queryFn: () => api.adminListBookings() });
  const allBookings: BookingDto[] = bookingsQ.data?.items ?? [];
  const selectableBookings: BookingDto[] = allBookings.filter((b) => {
    if (b.id === form.bookingId) return true;
    if (!b.active) return false;
    if (b.endsAt && new Date(b.endsAt) <= new Date()) return false;
    return true;
  });
  const isStaleSelection = (b: BookingDto): boolean =>
    !b.active || (!!b.endsAt && new Date(b.endsAt) <= new Date());

  const servicesQ = useQuery({
    queryKey: ["admin-services-with-solutions"],
    queryFn: () => api.listServicesAdmin(),
  });
  const services = servicesQ.data?.items ?? [];
  const solutionsForSelectedService = useMemo(
    () => services.find((s) => s.id === form.serviceId)?.solutions ?? [],
    [services, form.serviceId],
  );

  const syncMut = useMutation({
    mutationFn: () => workshopsApi.syncToCollateral(id!),
    onSuccess: () => toast({ title: "Synced to collateral library" }),
    onError: (e: Error) => toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      if (isNew) {
        return workshopsApi.create(form);
      }
      return workshopsApi.update(id!, form);
    },
    onSuccess: (w) => {
      toast({ title: isNew ? "Workshop created" : "Workshop saved" });
      qc.invalidateQueries({ queryKey: ["admin-workshops"] });
      qc.invalidateQueries({ queryKey: ["admin-workshop", w.id] });
      qc.invalidateQueries({ queryKey: ["public-workshops"] });
      navigate("/library/workshops");
    },
    onError: (e: Error) => setError(e.message),
  });

  const update = <K extends keyof WorkshopInput>(key: K, value: WorkshopInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  if (!isNew && existingQ.isLoading) {
    return (
      <AdminLayout title="Loading…">
        <div className="text-muted-foreground">Loading…</div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout
      title={isNew ? "New workshop" : `Edit: ${form.title}`}
      crumbs={[
        { label: "Admin", href: "/" },
        { label: "Workshops", href: "/library/workshops" },
        { label: isNew ? "New" : "Edit" },
      ]}
      previewEntity={{
        kind: "workshop",
        id,
        slug: form.slug,
        // Workshops have no status enum; the public route 410/404s when
        // the workshop is inactive, so `active=false` is the closest
        // equivalent to "draft" for preview purposes.
        isDraft: form.active === false,
      }}
    >
      <button
        onClick={() => navigate("/library/workshops")}
        className="flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to workshops
      </button>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          saveMut.mutate();
        }}
      >
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div className="space-y-6 min-w-0">
        <Section title="Basics">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Title *">
              <Input
                required
                value={form.title}
                onChange={(e) => update("title", e.target.value)}
                data-testid="input-title"
              />
            </Field>
            <Field label="Slug" hint="Auto-generated from title if blank">
              <Input
                value={form.slug ?? ""}
                onChange={(e) => update("slug", e.target.value)}
                placeholder="my-workshop"
                data-testid="input-slug"
              />
            </Field>
            <Field label="Category">
              <Input
                value={form.category}
                onChange={(e) => update("category", e.target.value)}
                placeholder="AI Strategy & Design"
              />
            </Field>
            <Field label="Display order" hint="Lower numbers sort first">
              <Input
                type="number"
                value={form.displayOrder ?? ""}
                onChange={(e) =>
                  update(
                    "displayOrder",
                    e.target.value === "" ? null : Number(e.target.value),
                  )
                }
              />
            </Field>
          </div>
          <Field label="Short description">
            <Textarea
              rows={3}
              value={form.shortDescription}
              onChange={(e) => update("shortDescription", e.target.value)}
            />
          </Field>
        </Section>

        <Section title="Hero">
          <Field label="Hero headline">
            <Input
              value={form.heroHeadline}
              onChange={(e) => update("heroHeadline", e.target.value)}
            />
          </Field>
          <Field label="Hero subhead">
            <Textarea
              rows={2}
              value={form.heroSubhead}
              onChange={(e) => update("heroSubhead", e.target.value)}
            />
          </Field>
          <Field label="Hero image" hint="Pick from the asset library or paste a URL.">
            <div className="flex items-start gap-3">
              <div className="w-48 h-36 rounded-md border border-border bg-muted overflow-hidden flex items-center justify-center shrink-0">
                {form.heroImage ? (
                  <img
                    src={form.heroImage}
                    alt="Hero preview"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <ImageIcon className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 space-y-2">
                <Input
                  value={form.heroImage}
                  placeholder="Image URL"
                  onChange={(e) => update("heroImage", e.target.value)}
                  data-testid="input-workshop-hero-image"
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowHeroPicker(true)}
                    data-testid="button-pick-workshop-hero"
                  >
                    {form.heroImage ? "Change" : "Pick image"}
                  </Button>
                  {form.heroImage && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => update("heroImage", "")}
                    >
                      <X className="h-4 w-4 mr-1" /> Remove
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </Field>
          <Field label="Hero trust bullets">
            <StringListEditor
              value={form.heroTrustBullets}
              onChange={(v) => update("heroTrustBullets", v)}
              placeholder="Short benefit statement"
            />
          </Field>
        </Section>

        <Section title="CTAs">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Primary CTA label">
              <Input
                value={form.primaryCTA.label}
                onChange={(e) =>
                  update("primaryCTA", { ...form.primaryCTA, label: e.target.value })
                }
              />
            </Field>
            <Field label="Primary CTA link">
              <Input
                value={form.primaryCTA.href}
                onChange={(e) =>
                  update("primaryCTA", { ...form.primaryCTA, href: e.target.value })
                }
              />
            </Field>
            <Field label="Secondary CTA label">
              <Input
                value={form.secondaryCTA?.label ?? ""}
                onChange={(e) =>
                  update("secondaryCTA", {
                    label: e.target.value,
                    href: form.secondaryCTA?.href ?? "",
                  })
                }
              />
            </Field>
            <Field label="Secondary CTA link">
              <Input
                value={form.secondaryCTA?.href ?? ""}
                onChange={(e) =>
                  update("secondaryCTA", {
                    label: form.secondaryCTA?.label ?? "",
                    href: e.target.value,
                  })
                }
              />
            </Field>
          </div>
          {form.secondaryCTA && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => update("secondaryCTA", null)}
            >
              Clear secondary CTA
            </Button>
          )}
        </Section>

        <Section title="Format, duration, audience">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Delivery format">
              <Input
                value={form.deliveryFormat}
                onChange={(e) => update("deliveryFormat", e.target.value)}
                placeholder="On-site or Virtual"
              />
            </Field>
            <Field label="Duration">
              <Input
                value={form.duration}
                onChange={(e) => update("duration", e.target.value)}
                placeholder="1 day"
              />
            </Field>
          </div>
          <Field label="Who it's for">
            <StringListEditor
              value={form.whoItsFor}
              onChange={(v) => update("whoItsFor", v)}
            />
          </Field>
          <Field label="Ideal participants">
            <StringListEditor
              value={form.idealParticipants}
              onChange={(v) => update("idealParticipants", v)}
            />
          </Field>
          <Field label="Prerequisites">
            <StringListEditor
              value={form.prerequisites}
              onChange={(v) => update("prerequisites", v)}
            />
          </Field>
        </Section>

        <Section title="Pain">
          <Field label="Header">
            <Input
              value={form.pain.header}
              onChange={(e) => update("pain", { ...form.pain, header: e.target.value })}
            />
          </Field>
          <Field label="Lead">
            <Textarea
              rows={2}
              value={form.pain.lead}
              onChange={(e) => update("pain", { ...form.pain, lead: e.target.value })}
            />
          </Field>
          <Field label="Pain tiles">
            <StringListEditor
              value={form.pain.tiles}
              onChange={(v) => update("pain", { ...form.pain, tiles: v })}
              rows={2}
            />
          </Field>
        </Section>

        <Section title="Scope">
          <Field label="Header">
            <Input
              value={form.scope.header}
              onChange={(e) =>
                update("scope", { ...form.scope, header: e.target.value })
              }
            />
          </Field>
          <Field label="Summary">
            <Textarea
              rows={3}
              value={form.scope.summary}
              onChange={(e) =>
                update("scope", { ...form.scope, summary: e.target.value })
              }
            />
          </Field>
          <Field label="Bullets">
            <StringListEditor
              value={form.scope.bullets}
              onChange={(v) => update("scope", { ...form.scope, bullets: v })}
            />
          </Field>
          <Field label="Included checklist">
            <StringListEditor
              value={form.scope.included}
              onChange={(v) => update("scope", { ...form.scope, included: v })}
            />
          </Field>
        </Section>

        <Section title="Process">
          <Field label="Header">
            <Input
              value={form.process.header}
              onChange={(e) =>
                update("process", { ...form.process, header: e.target.value })
              }
            />
          </Field>
          <Field label="Steps">
            <StringListEditor
              value={form.process.steps}
              onChange={(v) => update("process", { ...form.process, steps: v })}
              rows={2}
            />
          </Field>
        </Section>

        <Section title="Deliverables">
          <Field label="Header">
            <Input
              value={form.deliverables.header}
              onChange={(e) =>
                update("deliverables", { ...form.deliverables, header: e.target.value })
              }
            />
          </Field>
          <Field label="Core">
            <StringListEditor
              value={form.deliverables.core}
              onChange={(v) => update("deliverables", { ...form.deliverables, core: v })}
            />
          </Field>
          <Field label="Executive">
            <StringListEditor
              value={form.deliverables.executive}
              onChange={(v) =>
                update("deliverables", { ...form.deliverables, executive: v })
              }
            />
          </Field>
          <Field label="Enablement">
            <StringListEditor
              value={form.deliverables.enablement}
              onChange={(v) =>
                update("deliverables", { ...form.deliverables, enablement: v })
              }
            />
          </Field>
          <Field label="Add-ons">
            <StringListEditor
              value={form.deliverables.addOns}
              onChange={(v) =>
                update("deliverables", { ...form.deliverables, addOns: v })
              }
            />
          </Field>
        </Section>

        <Section title="Price & timeline">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Price label">
              <Input
                value={form.price.label}
                onChange={(e) =>
                  update("price", { ...form.price, label: e.target.value })
                }
              />
            </Field>
            <Field label="Starting at (number)">
              <Input
                type="number"
                value={form.price.startingAt ?? ""}
                onChange={(e) =>
                  update("price", {
                    ...form.price,
                    startingAt: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
            </Field>
            <Field label="Price display">
              <Input
                value={form.price.display}
                onChange={(e) =>
                  update("price", { ...form.price, display: e.target.value })
                }
                placeholder="Starting at $20,000"
              />
            </Field>
            <Field label="Timeline display">
              <Input
                value={form.price.timeline}
                onChange={(e) =>
                  update("price", { ...form.price, timeline: e.target.value })
                }
                placeholder="1 day"
              />
            </Field>
          </div>
          <Field label="What's included (short)">
            <StringListEditor
              value={form.price.whatIsIncluded}
              onChange={(v) =>
                update("price", { ...form.price, whatIsIncluded: v })
              }
            />
          </Field>
        </Section>

        <Section title="Diagnostic module (optional)">
          {form.diagnostic ? (
            <>
              <Field label="Header">
                <Input
                  value={form.diagnostic.header}
                  onChange={(e) =>
                    update("diagnostic", { ...form.diagnostic!, header: e.target.value })
                  }
                />
              </Field>
              <Field label="Summary">
                <Textarea
                  rows={2}
                  value={form.diagnostic.summary}
                  onChange={(e) =>
                    update("diagnostic", { ...form.diagnostic!, summary: e.target.value })
                  }
                />
              </Field>
              <Field label="What we assess">
                <StringListEditor
                  value={form.diagnostic.whatWeAssess}
                  onChange={(v) =>
                    update("diagnostic", { ...form.diagnostic!, whatWeAssess: v })
                  }
                />
              </Field>
              <Field label="Questionnaire preview">
                <StringListEditor
                  value={form.diagnostic.questionnairePreview}
                  onChange={(v) =>
                    update("diagnostic", {
                      ...form.diagnostic!,
                      questionnairePreview: v,
                    })
                  }
                />
              </Field>
              <Field label="Sample output link">
                <Input
                  value={form.diagnostic.sampleOutputLink ?? ""}
                  onChange={(e) =>
                    update("diagnostic", {
                      ...form.diagnostic!,
                      sampleOutputLink: e.target.value || null,
                    })
                  }
                />
              </Field>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => update("diagnostic", null)}
              >
                Remove diagnostic module
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                update("diagnostic", {
                  header: "Optional diagnostic module (recommended)",
                  summary: "",
                  whatWeAssess: [],
                  questionnairePreview: [],
                  sampleOutputLink: null,
                })
              }
            >
              <Plus className="h-4 w-4 mr-1" /> Add diagnostic module
            </Button>
          )}
        </Section>

        <Section title="Competitive intel module (optional)">
          {form.competitiveIntel ? (
            <>
              <Field label="Header">
                <Input
                  value={form.competitiveIntel.header}
                  onChange={(e) =>
                    update("competitiveIntel", {
                      ...form.competitiveIntel!,
                      header: e.target.value,
                    })
                  }
                />
              </Field>
              <Field label="Summary">
                <Textarea
                  rows={2}
                  value={form.competitiveIntel.summary}
                  onChange={(e) =>
                    update("competitiveIntel", {
                      ...form.competitiveIntel!,
                      summary: e.target.value,
                    })
                  }
                />
              </Field>
              <Field label="Outputs">
                <StringListEditor
                  value={form.competitiveIntel.outputs}
                  onChange={(v) =>
                    update("competitiveIntel", { ...form.competitiveIntel!, outputs: v })
                  }
                />
              </Field>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => update("competitiveIntel", null)}
              >
                Remove competitive intel module
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                update("competitiveIntel", {
                  header: "Competitive context (included)",
                  summary: "",
                  outputs: [],
                })
              }
            >
              <Plus className="h-4 w-4 mr-1" /> Add competitive intel module
            </Button>
          )}
        </Section>

        <Section title="Tooling note">
          <Field label="Tooling note (optional)">
            <Textarea
              rows={2}
              value={form.toolingNote ?? ""}
              onChange={(e) => update("toolingNote", e.target.value || null)}
            />
          </Field>
        </Section>

        <Section title="Outcomes">
          <Field label="Header">
            <Input
              value={form.outcomes.header}
              onChange={(e) =>
                update("outcomes", { ...form.outcomes, header: e.target.value })
              }
            />
          </Field>
          <Field label="Bullets">
            <StringListEditor
              value={form.outcomes.bullets}
              onChange={(v) => update("outcomes", { ...form.outcomes, bullets: v })}
            />
          </Field>
        </Section>

        <Section title="Before / After">
          <Field label="Before example">
            <Textarea
              rows={2}
              value={form.beforeExample}
              onChange={(e) => update("beforeExample", e.target.value)}
            />
          </Field>
          <Field label="After example">
            <Textarea
              rows={2}
              value={form.afterExample}
              onChange={(e) => update("afterExample", e.target.value)}
            />
          </Field>
        </Section>

        <Section title="Sample deliverables">
          <Field label="Header">
            <Input
              value={form.sampleDeliverables.header}
              onChange={(e) =>
                update("sampleDeliverables", {
                  ...form.sampleDeliverables,
                  header: e.target.value,
                })
              }
            />
          </Field>
          <Field label="Link (optional)">
            <Input
              value={form.sampleDeliverables.link ?? ""}
              onChange={(e) =>
                update("sampleDeliverables", {
                  ...form.sampleDeliverables,
                  link: e.target.value || null,
                })
              }
            />
          </Field>
          <Field label="Thumbnails (image URLs)">
            <StringListEditor
              value={form.sampleDeliverables.thumbs}
              onChange={(v) =>
                update("sampleDeliverables", { ...form.sampleDeliverables, thumbs: v })
              }
            />
          </Field>
        </Section>

        <Section title="FAQ">
          <Field label="Header">
            <Input
              value={form.faq.header}
              onChange={(e) => update("faq", { ...form.faq, header: e.target.value })}
            />
          </Field>
          <div className="space-y-3">
            {form.faq.items.map((item, i) => (
              <div
                key={i}
                className="rounded-md border border-border p-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Item {i + 1}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      const items = [...form.faq.items];
                      items.splice(i, 1);
                      update("faq", { ...form.faq, items });
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
                <Input
                  placeholder="Question"
                  value={item.q}
                  onChange={(e) => {
                    const items = [...form.faq.items];
                    items[i] = { ...item, q: e.target.value };
                    update("faq", { ...form.faq, items });
                  }}
                />
                <Textarea
                  rows={3}
                  placeholder="Answer"
                  value={item.a}
                  onChange={(e) => {
                    const items = [...form.faq.items];
                    items[i] = { ...item, a: e.target.value };
                    update("faq", { ...form.faq, items });
                  }}
                />
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                update("faq", {
                  ...form.faq,
                  items: [...form.faq.items, { q: "", a: "" }],
                })
              }
            >
              <Plus className="h-4 w-4 mr-1" /> Add FAQ item
            </Button>
          </div>
        </Section>

        <Section title="SEO">
          <Field label="SEO title">
            <Input
              value={form.seo.title}
              onChange={(e) => update("seo", { ...form.seo, title: e.target.value })}
            />
          </Field>
          <Field label="SEO meta description">
            <Textarea
              rows={2}
              value={form.seo.description}
              onChange={(e) =>
                update("seo", { ...form.seo, description: e.target.value })
              }
            />
          </Field>
        </Section>
        </div>{/* end left column */}

        <aside className="space-y-4">
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Active</Label>
              <Switch
                checked={form.active}
                onCheckedChange={(v) => update("active", v)}
                disabled={!access?.isEditorOrAbove}
              />
            </div>
          </Card>

          <Card className="p-4 space-y-3">
            <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">
              Related content
            </h3>
            <div>
              <Label className="text-sm font-medium">Related service</Label>
              <Select
                value={form.serviceId ?? "__none__"}
                onValueChange={(v) =>
                  update("serviceId", v === "__none__" ? null : v)
                }
                disabled={!access?.isEditorOrAbove || servicesQ.isLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {services.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(form.serviceId ? solutionsForSelectedService : services.flatMap((s) => s.solutions)).length > 0 && (
              <div>
                <Label className="text-sm font-medium">Related solution</Label>
                <Select
                  value={form.solutionId ?? "__none__"}
                  onValueChange={(v) =>
                    update("solutionId", v === "__none__" ? null : v)
                  }
                  disabled={!access?.isEditorOrAbove || servicesQ.isLoading}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {(form.serviceId
                      ? solutionsForSelectedService
                      : services.flatMap((s) => s.solutions)
                    ).map((sol) => (
                      <SelectItem key={sol.id} value={sol.id}>
                        {sol.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </Card>

          <Card className="p-4 space-y-3">
            <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">
              Booking
            </h3>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.bookingId ?? ""}
              onChange={(e) => update("bookingId", e.target.value || null)}
              disabled={!access?.isEditorOrAbove}
            >
              <option value="">No booking attached</option>
              {selectableBookings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                  {isStaleSelection(b) ? " (inactive)" : ""}
                </option>
              ))}
            </select>
          </Card>

          {!isNew && (
            <Card className="p-4">
              <TaxonomyPicker
                entityType="workshop"
                entityId={id ?? null}
                canWrite={!!access?.isEditorOrAbove}
              />
            </Card>
          )}

          {!isNew && (
            <Card className="p-4 space-y-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => syncMut.mutate()}
                disabled={syncMut.isPending || !access?.isEditorOrAbove}
                className="w-full justify-start"
                data-testid="button-sync-workshop-collateral"
                title="Push this workshop into the collateral library so it appears in filtered rails"
              >
                <RefreshCw className={`h-4 w-4 mr-1 ${syncMut.isPending ? "animate-spin" : ""}`} />
                {syncMut.isPending ? "Syncing…" : "Sync to library"}
              </Button>
            </Card>
          )}

          {error && (
            <div className="text-destructive text-sm" data-testid="text-form-error">
              {error}
            </div>
          )}

          <Card className="p-4 space-y-2">
            <Button
              type="submit"
              className="w-full"
              disabled={saveMut.isPending || !access?.isEditorOrAbove}
              data-testid="button-save"
            >
              <Save className="h-4 w-4 mr-1" />
              {saveMut.isPending ? "Saving…" : isNew ? "Create workshop" : "Save changes"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => navigate("/library/workshops")}
            >
              Cancel
            </Button>
          </Card>

          {!isNew && existingQ.data && (
            <Card className="p-4 space-y-2 text-xs text-muted-foreground">
              <div>
                Updated{" "}
                {new Date(existingQ.data.updatedAt).toLocaleString("en-US", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </div>
              <div className="font-mono break-all">{existingQ.data.id}</div>
            </Card>
          )}
        </aside>
        </div>{/* end grid */}
      </form>

      <MediaPickerModal
        open={showHeroPicker}
        onClose={() => setShowHeroPicker(false)}
        onSelect={(m: MediaItem) => {
          update("heroImage", mediaUrl(m));
          setShowHeroPicker(false);
        }}
        kind="image"
      />
      <div className="mt-6">
        <ActivityTab entity="workshop" entityId={id} />
      </div>
    </AdminLayout>
  );
}
