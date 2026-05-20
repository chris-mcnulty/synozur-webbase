import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { CollateralSolutionsEditor } from "@/components/admin/CollateralSolutionsEditor";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Save,
  Plus,
  Trash2,
  ExternalLink,
  Image as ImageIcon,
} from "lucide-react";
import {
  api,
  type CaseStudyDto,
  type CaseStudySectionDto,
  type CaseStudyMetricDto,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { ActivityTab } from "@/components/admin/ActivityTab";
import { useAdminAccess } from "@/components/admin/AdminGate";
import { OgImagePreview } from "@/components/admin/OgImagePreview";
import {
  MediaPickerModal,
  mediaUrl,
} from "@/components/admin/MediaPickerModal";
import { useToast } from "@/hooks/use-toast";
import type { MediaItem } from "@workspace/api-client-react";

interface Props {
  id?: string;
}

const STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "scheduled", label: "Scheduled" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
] as const;

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 96);
}

function toDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function sectionToForm(s: CaseStudySectionDto | undefined, defaultHeading = ""): { heading: string; body: string } {
  if (!s) return { heading: defaultHeading, body: "" };
  return {
    heading: s.heading,
    body: s.body.join("\n\n"),
  };
}

function formToSection(f: { heading: string; body: string }): CaseStudySectionDto {
  return {
    heading: f.heading,
    body: f.body.split("\n\n").map((s) => s.trim()).filter(Boolean),
  };
}

interface ApproachStep {
  heading: string;
  body: string;
}

interface FormState {
  title: string;
  slug: string;
  client: string;
  clientLabel: string;
  industry: string;
  established: string;
  tag: string;
  headline: string;
  summary: string;
  heroImage: string;
  clientLogo: string;
  atAGlance: string;
  whatWeDid: string;
  whyItWorked: string;
  challengeHeading: string;
  challengeBody: string;
  approach: ApproachStep[];
  outcomeHeading: string;
  outcomeBody: string;
  metrics: CaseStudyMetricDto[];
  quoteText: string;
  quoteAttribution: string;
  serviceId: string;
  solutionId: string;
  status: string;
  publishedAt: string;
  unpublishedAt: string;
  featured: boolean;
  featuredRank: string;
  seoTitle: string;
  seoDescription: string;
  ogImage: string;
  active: boolean;
}

const EMPTY: FormState = {
  title: "",
  slug: "",
  client: "",
  clientLabel: "",
  industry: "",
  established: "",
  tag: "",
  headline: "",
  summary: "",
  heroImage: "",
  clientLogo: "",
  atAGlance: "",
  whatWeDid: "",
  whyItWorked: "",
  challengeHeading: "The Challenge",
  challengeBody: "",
  approach: [],
  outcomeHeading: "The Outcome",
  outcomeBody: "",
  metrics: [],
  quoteText: "",
  quoteAttribution: "",
  serviceId: "",
  solutionId: "",
  status: "draft",
  publishedAt: "",
  unpublishedAt: "",
  featured: false,
  featuredRank: "",
  seoTitle: "",
  seoDescription: "",
  ogImage: "",
  active: true,
};

function fromDto(c: CaseStudyDto): FormState {
  const ch = sectionToForm(c.challenge, "The Challenge");
  const oc = sectionToForm(c.outcome, "The Outcome");
  return {
    title: c.title,
    slug: c.slug,
    client: c.client,
    clientLabel: c.clientLabel,
    industry: c.industry,
    established: c.established ?? "",
    tag: c.tag,
    headline: c.headline,
    summary: c.summary,
    heroImage: c.heroImage,
    clientLogo: c.clientLogo ?? "",
    atAGlance: c.atAGlance ?? "",
    whatWeDid: c.whatWeDid ?? "",
    whyItWorked: c.whyItWorked ?? "",
    challengeHeading: ch.heading,
    challengeBody: ch.body,
    approach: (c.approach ?? []).map((s) => ({
      heading: s.heading,
      body: s.body.join("\n\n"),
    })),
    outcomeHeading: oc.heading,
    outcomeBody: oc.body,
    metrics: c.metrics ?? [],
    quoteText: c.quote?.text ?? "",
    quoteAttribution: c.quote?.attribution ?? "",
    serviceId: c.serviceId ?? "",
    solutionId: c.solutionId ?? "",
    status: c.status,
    publishedAt: toDateInput(c.publishedAt),
    unpublishedAt: toDateInput(c.unpublishedAt),
    featured: c.featured,
    featuredRank: c.featuredRank == null ? "" : String(c.featuredRank),
    seoTitle: c.seoTitle ?? "",
    seoDescription: c.seoDescription ?? "",
    ogImage: c.ogImage ?? "",
    active: c.active,
  };
}

function toBody(f: FormState) {
  return {
    title: f.title,
    slug: f.slug || null,
    client: f.client,
    clientLabel: f.clientLabel || f.client,
    industry: f.industry,
    established: f.established || null,
    tag: f.tag,
    headline: f.headline,
    summary: f.summary,
    heroImage: f.heroImage,
    clientLogo: f.clientLogo || null,
    challenge: formToSection({ heading: f.challengeHeading, body: f.challengeBody }),
    approach: f.approach.map((s) => formToSection({ heading: s.heading, body: s.body })),
    outcome: formToSection({ heading: f.outcomeHeading, body: f.outcomeBody }),
    metrics: f.metrics,
    quote: { text: f.quoteText, attribution: f.quoteAttribution },
    atAGlance: f.atAGlance || null,
    whatWeDid: f.whatWeDid || null,
    whyItWorked: f.whyItWorked || null,
    serviceId: f.serviceId || null,
    solutionId: f.solutionId || null,
    status: f.status as CaseStudyDto["status"],
    publishedAt: f.publishedAt || null,
    unpublishedAt: f.unpublishedAt || null,
    featured: f.featured,
    featuredRank: f.featuredRank === "" ? null : Number(f.featuredRank),
    seoTitle: f.seoTitle || null,
    seoDescription: f.seoDescription || null,
    ogImage: f.ogImage || null,
    active: f.active,
  };
}

export default function CaseStudyEdit({ id }: Props) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { access } = useAdminAccess();
  const isNew = !id;
  const canWrite = !!access?.isEditorOrAbove;

  const servicesQ = useQuery({
    queryKey: ["admin-services-with-solutions"],
    queryFn: () => api.listServicesAdmin(),
  });
  const services = servicesQ.data?.items ?? [];

  const caseStudyQ = useQuery({
    queryKey: ["admin-case-study", id],
    queryFn: () => api.adminGetCaseStudy(id!),
    enabled: !!id,
  });

  const [form, setForm] = useState<FormState>(EMPTY);
  const [slugManual, setSlugManual] = useState(false);
  const [heroPickerOpen, setHeroPickerOpen] = useState(false);
  const [logoPickerOpen, setLogoPickerOpen] = useState(false);
  const [ogPickerOpen, setOgPickerOpen] = useState(false);

  useEffect(() => {
    if (caseStudyQ.data) {
      setForm(fromDto(caseStudyQ.data));
      setSlugManual(true);
    }
  }, [caseStudyQ.data]);

  const set = <K extends keyof FormState>(key: K, val: FormState[K]) => {
    setForm((f) => {
      const next = { ...f, [key]: val };
      if (key === "title" && !slugManual) {
        next.slug = slugify(val as string);
      }
      return next;
    });
  };

  const createMut = useMutation({
    mutationFn: (body: ReturnType<typeof toBody>) =>
      api.createCaseStudy(body as Parameters<typeof api.createCaseStudy>[0]),
    onSuccess: (created) => {
      toast({ title: "Case study created" });
      qc.invalidateQueries({ queryKey: ["admin-case-studies"] });
      navigate(`/products/case-studies/${created.id}/edit`);
    },
    onError: (e: Error) =>
      toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: (body: ReturnType<typeof toBody>) =>
      api.updateCaseStudy(id!, body),
    onSuccess: () => {
      toast({ title: "Case study saved" });
      qc.invalidateQueries({ queryKey: ["admin-case-studies"] });
      qc.invalidateQueries({ queryKey: ["admin-case-study", id] });
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const isSaving = createMut.isPending || updateMut.isPending;

  const onSave = () => {
    if (!canWrite) return;
    const body = toBody(form);
    if (isNew) createMut.mutate(body);
    else updateMut.mutate(body);
  };

  const addApproachStep = () =>
    set("approach", [...form.approach, { heading: "", body: "" }]);

  const updateApproachStep = (i: number, key: keyof ApproachStep, val: string) => {
    const next = form.approach.map((s, idx) =>
      idx === i ? { ...s, [key]: val } : s,
    );
    set("approach", next);
  };

  const removeApproachStep = (i: number) =>
    set("approach", form.approach.filter((_, idx) => idx !== i));

  const addMetric = () =>
    set("metrics", [...form.metrics, { label: "", value: "" }]);

  const updateMetric = (i: number, key: keyof CaseStudyMetricDto, val: string) => {
    const next = form.metrics.map((m, idx) =>
      idx === i ? { ...m, [key]: val } : m,
    );
    set("metrics", next);
  };

  const removeMetric = (i: number) =>
    set("metrics", form.metrics.filter((_, idx) => idx !== i));

  const selectedService = services.find((s) => s.id === form.serviceId);
  const solutionsForSelected = selectedService?.solutions ?? [];

  if (!isNew && caseStudyQ.isLoading) {
    return (
      <AdminLayout title="Loading…" crumbs={[{ label: "Admin", href: "/" }, { label: "Case Studies", href: "/products/case-studies" }, { label: "Loading…" }]}>
        <div className="text-muted-foreground py-12 text-center">Loading…</div>
      </AdminLayout>
    );
  }

  if (!isNew && caseStudyQ.isError) {
    return (
      <AdminLayout title="Not found" crumbs={[{ label: "Admin", href: "/" }, { label: "Case Studies", href: "/products/case-studies" }, { label: "Not found" }]}>
        <div className="text-destructive py-12 text-center">Case study not found.</div>
      </AdminLayout>
    );
  }

  const pageTitle = isNew ? "New Case Study" : (form.title || "Edit Case Study");

  return (
    <AdminLayout
      title={pageTitle}
      crumbs={[
        { label: "Admin", href: "/" },
        { label: "Case Studies", href: "/products/case-studies" },
        { label: pageTitle },
      ]}
      previewEntity={{
        kind: "case-study",
        id,
        slug: form.slug,
        isDraft: form.status !== "published",
      }}
    >
      <div className="flex items-center justify-between mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/products/case-studies")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div className="flex items-center gap-2">
          {!isNew && form.status === "published" && (
            <a
              href={`/case-studies/${form.slug}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline" size="sm">
                <ExternalLink className="h-4 w-4 mr-1" /> View live
              </Button>
            </a>
          )}
          <Button onClick={onSave} disabled={!canWrite || isSaving} size="sm">
            <Save className="h-4 w-4 mr-1" />
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">

          {/* Basic info */}
          <Card className="p-5 space-y-4">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              Basic Information
            </h3>
            <div className="space-y-1">
              <Label>Title *</Label>
              <Input
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
                disabled={!canWrite}
                placeholder="Client name — outcome tagline"
              />
            </div>
            <div className="space-y-1">
              <Label>Slug</Label>
              <Input
                value={form.slug}
                onChange={(e) => { setSlugManual(true); set("slug", e.target.value); }}
                disabled={!canWrite}
                placeholder="auto-generated from title"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Public URL: /case-studies/{form.slug || "…"}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Client</Label>
                <Input
                  value={form.client}
                  onChange={(e) => set("client", e.target.value)}
                  disabled={!canWrite}
                  placeholder="Acme Corp"
                />
              </div>
              <div className="space-y-1">
                <Label>Client label</Label>
                <Input
                  value={form.clientLabel}
                  onChange={(e) => set("clientLabel", e.target.value)}
                  disabled={!canWrite}
                  placeholder="Defaults to client name"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Industry</Label>
                <Input
                  value={form.industry}
                  onChange={(e) => set("industry", e.target.value)}
                  disabled={!canWrite}
                  placeholder="Financial Services"
                />
              </div>
              <div className="space-y-1">
                <Label>Established</Label>
                <Input
                  value={form.established}
                  onChange={(e) => set("established", e.target.value)}
                  disabled={!canWrite}
                  placeholder="1998"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Tag / Service area</Label>
              <Input
                value={form.tag}
                onChange={(e) => set("tag", e.target.value)}
                disabled={!canWrite}
                placeholder="Digital Transformation"
              />
            </div>
            <div className="space-y-1">
              <Label>Headline</Label>
              <Input
                value={form.headline}
                onChange={(e) => set("headline", e.target.value)}
                disabled={!canWrite}
                placeholder="Short impact statement shown on the case study detail page"
              />
            </div>
            <div className="space-y-1">
              <Label>Summary</Label>
              <Textarea
                value={form.summary}
                onChange={(e) => set("summary", e.target.value)}
                disabled={!canWrite}
                rows={3}
                placeholder="2–3 sentence overview shown in cards and previews"
              />
            </div>
          </Card>

          {/* Images */}
          <Card className="p-5 space-y-4">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              Images
            </h3>
            <div className="space-y-1">
              <Label>Hero image</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={form.heroImage}
                  onChange={(e) => set("heroImage", e.target.value)}
                  disabled={!canWrite}
                  placeholder="https://… or wix media path"
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  size="icon"
                  type="button"
                  onClick={() => setHeroPickerOpen(true)}
                  disabled={!canWrite}
                >
                  <ImageIcon className="h-4 w-4" />
                </Button>
              </div>
              {form.heroImage && (
                <img
                  src={mediaUrl(form.heroImage)}
                  alt=""
                  className="mt-2 h-24 w-full object-cover rounded border border-border"
                />
              )}
            </div>
            <div className="space-y-1">
              <Label>Client logo</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={form.clientLogo}
                  onChange={(e) => set("clientLogo", e.target.value)}
                  disabled={!canWrite}
                  placeholder="https://… or wix media path"
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  size="icon"
                  type="button"
                  onClick={() => setLogoPickerOpen(true)}
                  disabled={!canWrite}
                >
                  <ImageIcon className="h-4 w-4" />
                </Button>
              </div>
              {form.clientLogo && (
                <img
                  src={mediaUrl(form.clientLogo)}
                  alt=""
                  className="mt-2 h-12 w-auto rounded border border-border"
                />
              )}
            </div>
          </Card>

          {/* At a Glance / What We Did / Why It Worked */}
          <Card className="p-5 space-y-4">
            <div>
              <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                Summary Boxes
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                Short blurbs shown above the challenge section. Leave blank to hide a box.
              </p>
            </div>
            <div className="space-y-1">
              <Label>At a Glance</Label>
              <Textarea
                value={form.atAGlance}
                onChange={(e) => set("atAGlance", e.target.value)}
                disabled={!canWrite}
                rows={2}
                placeholder="1–2 sentence context about the client or situation"
              />
            </div>
            <div className="space-y-1">
              <Label>What We Did</Label>
              <Textarea
                value={form.whatWeDid}
                onChange={(e) => set("whatWeDid", e.target.value)}
                disabled={!canWrite}
                rows={2}
                placeholder="Brief summary of Synozur's engagement"
              />
            </div>
            <div className="space-y-1">
              <Label>Why It Worked</Label>
              <Textarea
                value={form.whyItWorked}
                onChange={(e) => set("whyItWorked", e.target.value)}
                disabled={!canWrite}
                rows={2}
                placeholder="Key factor that drove the outcome"
              />
            </div>
          </Card>

          {/* Challenge */}
          <Card className="p-5 space-y-4">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              Challenge Section
            </h3>
            <div className="space-y-1">
              <Label>Section heading</Label>
              <Input
                value={form.challengeHeading}
                onChange={(e) => set("challengeHeading", e.target.value)}
                disabled={!canWrite}
              />
            </div>
            <div className="space-y-1">
              <Label>Body paragraphs</Label>
              <Textarea
                value={form.challengeBody}
                onChange={(e) => set("challengeBody", e.target.value)}
                disabled={!canWrite}
                rows={5}
                placeholder="Separate paragraphs with a blank line"
              />
              <p className="text-xs text-muted-foreground">Separate paragraphs with a blank line.</p>
            </div>
          </Card>

          {/* Approach */}
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                Our Approach
              </h3>
              {canWrite && (
                <Button variant="outline" size="sm" onClick={addApproachStep}>
                  <Plus className="h-3 w-3 mr-1" /> Add step
                </Button>
              )}
            </div>
            {form.approach.length === 0 && (
              <p className="text-sm text-muted-foreground">No approach steps yet.</p>
            )}
            {form.approach.map((step, i) => (
              <div key={i} className="border border-border rounded-md p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground">Step {i + 1}</span>
                  {canWrite && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeApproachStep(i)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
                <div className="space-y-1">
                  <Label>Heading</Label>
                  <Input
                    value={step.heading}
                    onChange={(e) => updateApproachStep(i, "heading", e.target.value)}
                    disabled={!canWrite}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Body paragraphs</Label>
                  <Textarea
                    value={step.body}
                    onChange={(e) => updateApproachStep(i, "body", e.target.value)}
                    disabled={!canWrite}
                    rows={3}
                    placeholder="Separate paragraphs with a blank line"
                  />
                </div>
              </div>
            ))}
          </Card>

          {/* Outcome */}
          <Card className="p-5 space-y-4">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              Outcome Section
            </h3>
            <div className="space-y-1">
              <Label>Section heading</Label>
              <Input
                value={form.outcomeHeading}
                onChange={(e) => set("outcomeHeading", e.target.value)}
                disabled={!canWrite}
              />
            </div>
            <div className="space-y-1">
              <Label>Body paragraphs</Label>
              <Textarea
                value={form.outcomeBody}
                onChange={(e) => set("outcomeBody", e.target.value)}
                disabled={!canWrite}
                rows={5}
                placeholder="Separate paragraphs with a blank line"
              />
              <p className="text-xs text-muted-foreground">Separate paragraphs with a blank line.</p>
            </div>
          </Card>

          {/* Metrics */}
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                Metrics
              </h3>
              {canWrite && (
                <Button variant="outline" size="sm" onClick={addMetric}>
                  <Plus className="h-3 w-3 mr-1" /> Add metric
                </Button>
              )}
            </div>
            {form.metrics.length === 0 && (
              <p className="text-sm text-muted-foreground">No metrics yet.</p>
            )}
            <div className="space-y-2">
              {form.metrics.map((m, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={m.value}
                    onChange={(e) => updateMetric(i, "value", e.target.value)}
                    disabled={!canWrite}
                    placeholder="85%"
                    className="w-28"
                  />
                  <Input
                    value={m.label}
                    onChange={(e) => updateMetric(i, "label", e.target.value)}
                    disabled={!canWrite}
                    placeholder="Cost reduction"
                    className="flex-1"
                  />
                  {canWrite && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeMetric(i)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </Card>

          {/* Quote */}
          <Card className="p-5 space-y-4">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              Client Quote
            </h3>
            <div className="space-y-1">
              <Label>Quote text</Label>
              <Textarea
                value={form.quoteText}
                onChange={(e) => set("quoteText", e.target.value)}
                disabled={!canWrite}
                rows={3}
                placeholder="The quote displayed on the case study page"
              />
            </div>
            <div className="space-y-1">
              <Label>Attribution</Label>
              <Input
                value={form.quoteAttribution}
                onChange={(e) => set("quoteAttribution", e.target.value)}
                disabled={!canWrite}
                placeholder="Jane Smith, CEO, Acme Corp"
              />
            </div>
          </Card>

          {/* SEO */}
          <Card className="p-5 space-y-4">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              SEO
            </h3>
            <div className="space-y-1">
              <Label>SEO title</Label>
              <Input
                value={form.seoTitle}
                onChange={(e) => set("seoTitle", e.target.value)}
                disabled={!canWrite}
                placeholder="Defaults to case study title"
              />
            </div>
            <div className="space-y-1">
              <Label>SEO description</Label>
              <Textarea
                value={form.seoDescription}
                onChange={(e) => set("seoDescription", e.target.value)}
                disabled={!canWrite}
                rows={2}
                placeholder="Meta description (≤ 160 chars)"
              />
            </div>
            <div className="space-y-2">
              <Label>Auto-generated preview</Label>
              <OgImagePreview
                kind="case-study"
                id={isNew ? null : (caseStudyQ.data?.id ?? null)}
                updatedAt={caseStudyQ.data?.updatedAt}
                showOverrideHint
              />
            </div>
            <div className="space-y-1">
              <Label>OG image override</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={form.ogImage}
                  onChange={(e) => set("ogImage", e.target.value)}
                  disabled={!canWrite}
                  placeholder="https://… or wix media path"
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  size="icon"
                  type="button"
                  onClick={() => setOgPickerOpen(true)}
                  disabled={!canWrite}
                >
                  <ImageIcon className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">

          {/* Publishing */}
          <Card className="p-5 space-y-4">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              Publishing
            </h3>
            <div className="space-y-1">
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => set("status", v)}
                disabled={!canWrite}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Published at</Label>
              <Input
                type="date"
                value={form.publishedAt}
                onChange={(e) => set("publishedAt", e.target.value)}
                disabled={!canWrite}
              />
            </div>
            <div className="space-y-1">
              <Label>Unpublish at</Label>
              <Input
                type="date"
                value={form.unpublishedAt}
                onChange={(e) => set("unpublishedAt", e.target.value)}
                disabled={!canWrite}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label>Active</Label>
              <Switch
                checked={form.active}
                onCheckedChange={(v) => set("active", v)}
                disabled={!canWrite}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label>Featured</Label>
              <Switch
                checked={form.featured}
                onCheckedChange={(v) => set("featured", v)}
                disabled={!canWrite}
              />
            </div>
            {form.featured && (
              <div className="space-y-1">
                <Label>Featured rank</Label>
                <Input
                  type="number"
                  value={form.featuredRank}
                  onChange={(e) => set("featuredRank", e.target.value)}
                  disabled={!canWrite}
                  placeholder="1"
                  min={1}
                />
              </div>
            )}
          </Card>

          {/* Taxonomy */}
          <Card className="p-5 space-y-4">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              Taxonomy
            </h3>
            <div className="space-y-1">
              <Label>Service</Label>
              <Select
                value={form.serviceId || "__none__"}
                onValueChange={(v) => {
                  set("serviceId", v === "__none__" ? "" : v);
                  set("solutionId", "");
                }}
                disabled={!canWrite}
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
            <div className="space-y-1">
              <Label>Solution</Label>
              <Select
                value={form.solutionId || "__none__"}
                onValueChange={(v) => set("solutionId", v === "__none__" ? "" : v)}
                disabled={!canWrite || solutionsForSelected.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {solutionsForSelected.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </Card>

          {/* Linked solutions — many-to-many */}
          <Card className="p-5 space-y-3">
            <div>
              <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide mb-1">
                Linked solutions
              </h3>
              <p className="text-xs text-muted-foreground">
                Pin this case study to one or more solutions. It will appear in
                each solution's "Related resources" section. Save first if this
                is a new record.
              </p>
            </div>
            <CollateralSolutionsEditor
              sourceId={!isNew && id ? `case_study:${id}` : null}
              canWrite={canWrite}
            />
          </Card>
        </div>
      </div>

      {/* Media pickers */}
      <MediaPickerModal
        open={heroPickerOpen}
        onClose={() => setHeroPickerOpen(false)}
        onSelect={(item: MediaItem) => {
          set("heroImage", mediaUrl(item));
          setHeroPickerOpen(false);
        }}
        filter="image"
      />
      <MediaPickerModal
        open={logoPickerOpen}
        onClose={() => setLogoPickerOpen(false)}
        onSelect={(item: MediaItem) => {
          set("clientLogo", mediaUrl(item));
          setLogoPickerOpen(false);
        }}
        filter="image"
      />
      <MediaPickerModal
        open={ogPickerOpen}
        onClose={() => setOgPickerOpen(false)}
        onSelect={(item: MediaItem) => {
          set("ogImage", mediaUrl(item));
          setOgPickerOpen(false);
        }}
        filter="image"
      />
      <div className="mt-6">
        <ActivityTab entity="case_study" entityId={id} />
      </div>
    </AdminLayout>
  );
}
