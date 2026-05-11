/* eslint-disable jsx-a11y/label-has-associated-control --
   Admin form labels are positioned above their inputs (a sibling pattern
   used elsewhere in the admin UI) rather than wrapping or `htmlFor`-ing
   them. Form inputs all have visible labels and are usable; this rule's
   strict structural requirement is at odds with the inline-form layout. */
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Save,
  Trash2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Image as ImageIcon,
  Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { MediaPickerModal } from "@/components/admin/MediaPickerModal";
import { resolveStoragePath } from "@/lib/media-url";
import type { MediaItem } from "@workspace/api-client-react";
import { api } from "@/lib/api";
import type {
  AdminExperiment,
  AdminExperimentVariant,
  ConversionPath,
  CreateVariantBody,
  UpdateVariantBody,
  PartnerItem,
  BookingLink,
  ExperimentStatus,
} from "@workspace/api-zod/types";
import { OverrideMap } from "@workspace/api-zod";
import { previewPathForPageKey } from "@/lib/experiments-bucket";

interface Props {
  id: string;
}

type Tab = "overview" | "variants" | "conversions" | "results";

function StatusPill({ status }: { status: ExperimentStatus }) {
  const styles: Record<ExperimentStatus, string> = {
    draft: "bg-zinc-700 text-zinc-200",
    running: "bg-emerald-600/30 text-emerald-300 border border-emerald-600/40",
    paused: "bg-amber-600/30 text-amber-300 border border-amber-600/40",
    ended: "bg-zinc-800 text-zinc-400 border border-zinc-700",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[status]}`}
    >
      {status}
    </span>
  );
}

export default function AdminExperimentDetail({ id }: Props) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-experiment", id],
    queryFn: () => api.getAdminExperiment(id),
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ["admin-experiment", id] });
    qc.invalidateQueries({ queryKey: ["admin-experiments"] });
  }

  if (isLoading || !data) {
    return (
      <AdminLayout
        title="Experiment"
        crumbs={[
          { label: "Admin", href: "/" },
          { label: "Site Config" },
          { label: "Experiments", href: "/site-config/experiments" },
          { label: "…" },
        ]}
      >
        <div className="text-muted-foreground">Loading…</div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout
      title={data.name}
      crumbs={[
        { label: "Admin", href: "/" },
        { label: "Site Config" },
        { label: "Experiments", href: "/site-config/experiments" },
        { label: data.name },
      ]}
    >
      <div className="flex items-center gap-3 mb-6">
        <StatusPill status={data.status} />
        <code className="text-xs text-muted-foreground">{data.key}</code>
        <span className="text-xs text-muted-foreground">
          page: <code>{data.pageKey}</code>
        </span>
        {data.status === "running" || data.status === "paused" ? (
          <Link
            href={`${previewPathForPageKey(data.pageKey)}?_exp=${encodeURIComponent(data.key)}:${
              encodeURIComponent(data.variants[0]?.key ?? "control")
            }`}
            target="_blank"
            className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            Preview as variant
          </Link>
        ) : null}
      </div>

      {errorMessage ? (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {errorMessage}
        </div>
      ) : null}

      <nav className="border-b border-border mb-6 flex gap-1">
        {(["overview", "variants", "conversions", "results"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>

      {tab === "overview" ? (
        <OverviewTab
          experiment={data}
          onError={setErrorMessage}
          onChange={refresh}
        />
      ) : null}
      {tab === "variants" ? (
        <VariantsTab
          experiment={data}
          onError={setErrorMessage}
          onChange={refresh}
        />
      ) : null}
      {tab === "conversions" ? (
        <ConversionsTab
          experiment={data}
          onError={setErrorMessage}
          onChange={refresh}
        />
      ) : null}
      {tab === "results" ? <ResultsTab experimentId={data.id} /> : null}
    </AdminLayout>
  );
}

// ---------- Overview ----------------------------------------------------

function OverviewTab({
  experiment,
  onError,
  onChange,
}: {
  experiment: AdminExperiment;
  onError: (msg: string | null) => void;
  onChange: () => void;
}) {
  const [name, setName] = useState(experiment.name);
  const [description, setDescription] = useState(experiment.description ?? "");
  const [trafficPercentage, setTrafficPercentage] = useState(
    experiment.trafficPercentage,
  );
  const [holdbackPercentage, setHoldbackPercentage] = useState(
    experiment.holdbackPercentage ?? 0,
  );
  const [autoStopAfterDays, setAutoStopAfterDays] = useState<number | null>(
    experiment.autoStopAfterDays ?? null,
  );
  const [autoStopOnSignificance, setAutoStopOnSignificance] = useState(
    experiment.autoStopOnSignificance ?? false,
  );
  const [minVisitorsForAutoStop, setMinVisitorsForAutoStop] = useState(
    experiment.minVisitorsForAutoStop ?? 1000,
  );

  const [, navigate] = useLocation();

  const updateMutation = useMutation({
    mutationFn: () =>
      api.updateAdminExperiment(experiment.id, {
        name,
        description: description.trim() ? description : null,
        trafficPercentage,
        holdbackPercentage,
        autoStopAfterDays,
        autoStopOnSignificance,
        minVisitorsForAutoStop,
      }),
    onSuccess: () => {
      onError(null);
      onChange();
    },
    onError: (err) =>
      onError(err instanceof Error ? err.message : "Update failed"),
  });

  const duplicateMutation = useMutation({
    mutationFn: () => api.duplicateAdminExperiment(experiment.id),
    onSuccess: (copy) => {
      onError(null);
      navigate(`/site-config/experiments/${copy.id}`);
    },
    onError: (err) =>
      onError(err instanceof Error ? err.message : "Duplicate failed"),
  });

  const startMutation = useMutation({
    mutationFn: () => api.startAdminExperiment(experiment.id),
    onSuccess: () => {
      onError(null);
      onChange();
    },
    onError: (err) =>
      onError(err instanceof Error ? err.message : "Start failed"),
  });
  const pauseMutation = useMutation({
    mutationFn: () => api.pauseAdminExperiment(experiment.id),
    onSuccess: onChange,
  });
  const endMutation = useMutation({
    mutationFn: () => api.endAdminExperiment(experiment.id),
    onSuccess: onChange,
  });

  const editable = experiment.status !== "ended";

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="rounded-md border border-border p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Name</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!editable}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={!editable}
            rows={3}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            Traffic percentage
            <span className="text-muted-foreground font-normal">
              {" "}
              (% of visitors entered into the experiment; the rest are
              out-of-test and see defaults with no assignment recorded)
            </span>
          </label>
          <Input
            type="number"
            min={0}
            max={100}
            value={trafficPercentage}
            onChange={(e) =>
              setTrafficPercentage(Math.max(0, Math.min(100, +e.target.value || 0)))
            }
            disabled={!editable}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            Holdback percentage
            <span className="text-muted-foreground font-normal">
              {" "}
              (of in-test visitors, the % held back from any treatment;
              they see defaults but ARE recorded for baseline comparison)
            </span>
          </label>
          <Input
            type="number"
            min={0}
            max={100}
            value={holdbackPercentage}
            onChange={(e) =>
              setHoldbackPercentage(Math.max(0, Math.min(100, +e.target.value || 0)))
            }
            disabled={!editable}
          />
        </div>
        <Button
          onClick={() => updateMutation.mutate()}
          disabled={!editable || updateMutation.isPending}
        >
          <Save className="h-4 w-4 mr-2" />
          Save
        </Button>
      </div>

      <div className="rounded-md border border-border p-6 space-y-4">
        <h3 className="font-semibold">Auto-stop policy</h3>
        <p className="text-sm text-muted-foreground">
          The scheduler sweeps running experiments hourly and ends any that
          satisfy the policy below. An audit_log entry records the reason.
        </p>
        <div>
          <label className="block text-sm font-medium mb-1">
            Stop after N days
            <span className="text-muted-foreground font-normal">
              {" "}
              (blank = no time limit)
            </span>
          </label>
          <Input
            type="number"
            min={1}
            max={365}
            value={autoStopAfterDays ?? ""}
            onChange={(e) => {
              const v = e.target.value.trim();
              setAutoStopAfterDays(v === "" ? null : Math.max(1, +v || 1));
            }}
            disabled={!editable}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={autoStopOnSignificance}
            onChange={(e) => setAutoStopOnSignificance(e.target.checked)}
            disabled={!editable}
          />
          Stop when a non-control variant reaches p&lt;0.05 vs control
        </label>
        <div>
          <label className="block text-sm font-medium mb-1">
            Minimum visitors per variant for significance auto-stop
          </label>
          <Input
            type="number"
            min={0}
            value={minVisitorsForAutoStop}
            onChange={(e) =>
              setMinVisitorsForAutoStop(Math.max(0, +e.target.value || 0))
            }
            disabled={!editable || !autoStopOnSignificance}
          />
        </div>
      </div>

      <div className="rounded-md border border-border p-6">
        <h3 className="font-semibold mb-3">Lifecycle</h3>
        <div className="flex flex-wrap gap-2">
          {experiment.status === "draft" || experiment.status === "paused" ? (
            <Button onClick={() => startMutation.mutate()}>
              {experiment.status === "draft" ? "Start" : "Resume"}
            </Button>
          ) : null}
          {experiment.status === "running" ? (
            <Button variant="secondary" onClick={() => pauseMutation.mutate()}>
              Pause
            </Button>
          ) : null}
          {experiment.status === "running" || experiment.status === "paused" ? (
            <Button
              variant="destructive"
              onClick={() => {
                if (confirm("End this experiment? This is irreversible.")) {
                  endMutation.mutate();
                }
              }}
            >
              End
            </Button>
          ) : null}
          <Button
            variant="outline"
            onClick={() => duplicateMutation.mutate()}
            disabled={duplicateMutation.isPending}
          >
            <Copy className="h-4 w-4 mr-2" />
            {duplicateMutation.isPending ? "Duplicating…" : "Duplicate as draft"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------- Variants ----------------------------------------------------

function VariantsTab({
  experiment,
  onError,
  onChange,
}: {
  experiment: AdminExperiment;
  onError: (msg: string | null) => void;
  onChange: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [draftKey, setDraftKey] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draftWeight, setDraftWeight] = useState(50);
  const [draftIsControl, setDraftIsControl] = useState(false);

  const createMutation = useMutation({
    mutationFn: (body: CreateVariantBody) =>
      api.createAdminVariant(experiment.id, body),
    onSuccess: () => {
      onError(null);
      onChange();
      setCreating(false);
      setDraftKey("");
      setDraftName("");
      setDraftWeight(50);
      setDraftIsControl(false);
    },
    onError: (err) =>
      onError(err instanceof Error ? err.message : "Create failed"),
  });

  const totalWeight = experiment.variants.reduce((a, v) => a + v.weight, 0);

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-border p-4">
        <div className="text-sm text-muted-foreground">
          Variant weights must sum to <strong>100</strong>. Currently:{" "}
          <strong className={totalWeight === 100 ? "text-emerald-400" : "text-amber-400"}>
            {totalWeight}
          </strong>
          . Exactly one variant must be marked control.
        </div>
      </div>

      {experiment.variants.map((v) => (
        <VariantCard
          key={v.id}
          experiment={experiment}
          variant={v}
          onError={onError}
          onChange={onChange}
        />
      ))}

      {experiment.status === "draft" || experiment.status === "paused" ? (
        <div className="rounded-md border border-dashed border-border p-4">
          {creating ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createMutation.mutate({
                  key: draftKey.trim(),
                  name: draftName.trim(),
                  weight: draftWeight,
                  isControl: draftIsControl,
                  overrides: {},
                });
              }}
              className="space-y-3"
            >
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Key</label>
                  <Input
                    value={draftKey}
                    onChange={(e) => setDraftKey(e.target.value)}
                    placeholder="variant_b"
                    pattern="[a-z0-9][a-z0-9_-]*"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Name</label>
                  <Input
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    placeholder="Variant B"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Weight (0–100)
                  </label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={draftWeight}
                    onChange={(e) => setDraftWeight(+e.target.value || 0)}
                  />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draftIsControl}
                      onChange={(e) => setDraftIsControl(e.target.checked)}
                    />
                    Mark as control
                  </label>
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={createMutation.isPending}>
                  Create variant
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setCreating(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <Button variant="ghost" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add variant
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function VariantCard({
  experiment,
  variant,
  onError,
  onChange,
}: {
  experiment: AdminExperiment;
  variant: AdminExperimentVariant;
  onError: (msg: string | null) => void;
  onChange: () => void;
}) {
  const [name, setName] = useState(variant.name);
  const [weight, setWeight] = useState(variant.weight);
  const [isControl, setIsControl] = useState(variant.isControl);
  const [overrides, setOverrides] = useState<Record<string, unknown>>(
    variant.overrides ?? {},
  );

  // Reset local draft when the upstream record changes (e.g. after a save
  // elsewhere). Prevents stale state if the admin tabs around.
  useEffect(() => {
    setName(variant.name);
    setWeight(variant.weight);
    setIsControl(variant.isControl);
    setOverrides(variant.overrides ?? {});
  }, [variant.id, variant.name, variant.weight, variant.isControl, variant.overrides]);

  // Local validation issues per override key. Recomputed on each
  // change so admins see a red ring immediately, not after hitting save.
  const validationIssues = useMemo<Record<string, string>>(() => {
    const result = OverrideMap.safeParse(overrides);
    if (result.success) return {};
    const issues: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.join(".");
      if (!issues[path]) issues[path] = issue.message;
    }
    return issues;
  }, [overrides]);

  const saveMutation = useMutation({
    mutationFn: (body: UpdateVariantBody) =>
      api.updateAdminVariant(variant.id, body),
    onSuccess: () => {
      onError(null);
      onChange();
    },
    onError: (err) =>
      onError(err instanceof Error ? err.message : "Save failed"),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteAdminVariant(variant.id),
    onSuccess: onChange,
    onError: (err) =>
      onError(err instanceof Error ? err.message : "Delete failed"),
  });

  const isRunning = experiment.status === "running";
  const editableMeta = experiment.status === "draft" || experiment.status === "paused";
  const hasIssues = Object.keys(validationIssues).length > 0;

  return (
    <div className="rounded-md border border-border">
      <div className="flex items-center gap-3 p-4 border-b border-border bg-muted/20">
        <code className="text-sm font-medium">{variant.key}</code>
        {variant.isControl ? (
          <span className="text-xs px-1.5 py-0.5 rounded bg-primary/20 text-primary">
            control
          </span>
        ) : null}
        <span className="text-sm text-muted-foreground ml-auto">
          weight: {variant.weight}
        </span>
        {experiment.status === "draft" ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (confirm(`Delete variant "${variant.name}"?`)) {
                deleteMutation.mutate();
              }
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!editableMeta}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Weight</label>
            <Input
              type="number"
              min={0}
              max={100}
              value={weight}
              onChange={(e) => setWeight(+e.target.value || 0)}
              disabled={!editableMeta}
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isControl}
                onChange={(e) => setIsControl(e.target.checked)}
                disabled={!editableMeta}
              />
              Control
            </label>
          </div>
        </div>

        <OverridesEditor
          overrides={overrides}
          onChange={setOverrides}
          issues={validationIssues}
          controlOverrides={
            variant.isControl
              ? null
              : (experiment.variants.find((v) => v.isControl)?.overrides ?? null)
          }
        />

        {hasIssues ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Fix {Object.keys(validationIssues).length} validation issue
            {Object.keys(validationIssues).length === 1 ? "" : "s"} above
            before saving.
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button
            onClick={() =>
              saveMutation.mutate(
                isRunning
                  ? { overrides }
                  : { name, weight, isControl, overrides },
              )
            }
            disabled={saveMutation.isPending || hasIssues}
          >
            <Save className="h-4 w-4 mr-2" />
            Save variant
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------- OverridesEditor --------------------------------------------

type FieldDef =
  | {
      kind: "text" | "boolean" | "url" | "longtext";
      key: string;
      label: string;
      help?: string;
      siteDefault?: string | boolean;
    }
  | { kind: "partners" }
  | { kind: "booking-links" };

const OVERRIDE_GROUPS: Array<{ title: string; fields: FieldDef[] }> = [
  {
    title: "Home page layout",
    fields: [
      {
        kind: "boolean",
        key: "home.layout",
        label: "Show Home B layout",
        help: 'When set to "Show", visitors on / see the Home B layout. Absent or "Hide" follows the site-settings toggle. Experiment overrides site settings.',
        siteDefault: false,
      },
    ],
  },
  {
    title: "Hero — Positioning",
    fields: [
      {
        kind: "boolean",
        key: "home.hero.positioning.visible",
        label: "Show positioning headline",
        siteDefault: true,
      },
      {
        kind: "text",
        key: "home.hero.positioning.text",
        label: "Headline text",
        help: "The full headline. Word matching `accentWord` will be styled with the nebula accent.",
        siteDefault: "The Transformation Company",
      },
      {
        kind: "text",
        key: "home.hero.positioning.accentWord",
        label: "Accent word",
        siteDefault: "Transformation",
      },
    ],
  },
  {
    title: "Hero — Copy",
    fields: [
      {
        kind: "longtext",
        key: "home.hero.tagline.text",
        label: "Tagline / narrative",
        siteDefault:
          "We help organizations move from intent to measurable progress—guiding leaders to their North Star with human\u2011centered, AI\u2011augmented transformation that\u2019s built for real\u2011world adoption.",
      },
      {
        kind: "longtext",
        key: "home.hero.narrative.text",
        label: "Narrative (additional)",
      },
    ],
  },
  {
    title: "Hero — Get Started CTA",
    fields: [
      {
        kind: "boolean",
        key: "home.hero.cta.visible",
        label: "Show hero CTA",
        siteDefault: true,
      },
      {
        kind: "text",
        key: "home.hero.cta.label",
        label: "Button label",
        siteDefault: "Get Started",
      },
      {
        kind: "url",
        key: "home.hero.cta.href",
        label: "Button href",
        siteDefault: "/start",
      },
    ],
  },
  {
    title: "Partners area",
    fields: [
      {
        kind: "boolean",
        key: "home.partners.visible",
        label: "Show partners section",
        siteDefault: true,
      },
      {
        kind: "text",
        key: "home.partners.heading",
        label: "Heading",
        siteDefault: "Trusted by",
      },
      {
        kind: "longtext",
        key: "home.partners.subtext",
        label: "Sub-text (optional)",
      },
      { kind: "partners" },
    ],
  },
  {
    title: "Booking links",
    fields: [
      {
        kind: "boolean",
        key: "home.booking.visible",
        label: "Show booking links block",
      },
      {
        kind: "text",
        key: "home.booking.heading",
        label: "Heading",
      },
      { kind: "booking-links" },
    ],
  },
  {
    title: "Site header",
    fields: [
      {
        kind: "boolean",
        key: "header.cta.visible",
        label: "Show upper-right Get Started",
        siteDefault: true,
      },
      {
        kind: "text",
        key: "header.cta.label",
        label: "Header CTA label",
        siteDefault: "Get Started",
      },
      {
        kind: "url",
        key: "header.cta.href",
        label: "Header CTA href",
        siteDefault: "/start",
      },
    ],
  },
  {
    title: "Services overview hero (page key: services)",
    fields: [
      { kind: "text", key: "services.hero.eyebrow", label: "Eyebrow" },
      { kind: "text", key: "services.hero.headline", label: "Headline" },
      { kind: "longtext", key: "services.hero.body", label: "Body" },
    ],
  },
  {
    title: "Applications hero (page key: applications)",
    fields: [
      { kind: "text", key: "applications.hero.eyebrow", label: "Eyebrow" },
      { kind: "text", key: "applications.hero.headline", label: "Headline" },
      { kind: "longtext", key: "applications.hero.body", label: "Body" },
    ],
  },
  {
    title: "Case studies hero (page key: case-studies)",
    fields: [
      { kind: "text", key: "case-studies.hero.eyebrow", label: "Eyebrow" },
      { kind: "text", key: "case-studies.hero.headline", label: "Headline" },
      { kind: "longtext", key: "case-studies.hero.body", label: "Body" },
    ],
  },
];

function OverridesEditor({
  overrides,
  onChange,
  issues,
  controlOverrides,
}: {
  overrides: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  issues: Record<string, string>;
  // null = this IS the control variant (no reference shown).
  // object = the control variant's saved overrides (may be empty {}).
  controlOverrides: Record<string, unknown> | null;
}) {
  function setKey(key: string, value: unknown) {
    const next = { ...overrides };
    if (value === undefined || value === "") {
      delete next[key];
    } else {
      next[key] = value;
    }
    onChange(next);
  }

  return (
    <div className="border border-border rounded-md divide-y divide-border">
      {OVERRIDE_GROUPS.map((group) => (
        <OverrideGroup
          key={group.title}
          title={group.title}
          fields={group.fields}
          overrides={overrides}
          setKey={setKey}
          issues={issues}
          controlOverrides={controlOverrides}
        />
      ))}
    </div>
  );
}

function OverrideGroup({
  title,
  fields,
  overrides,
  setKey,
  issues,
  controlOverrides,
}: {
  title: string;
  fields: FieldDef[];
  overrides: Record<string, unknown>;
  setKey: (key: string, value: unknown) => void;
  issues: Record<string, string>;
  controlOverrides: Record<string, unknown> | null;
}) {
  const [open, setOpen] = useState(false);
  const setCount = fields.filter((f) => "key" in f && f.key in overrides).length;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 text-left"
      >
        <span className="font-medium text-sm flex items-center gap-2">
          {open ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          {title}
        </span>
        {setCount > 0 ? (
          <span className="text-xs text-primary">{setCount} set</span>
        ) : null}
      </button>
      {open ? (
        <div className="px-4 pb-4 space-y-3">
          {fields.map((field, i) => {
            if (field.kind === "partners") {
              return (
                <PartnersEditor
                  key={`partners-${i}`}
                  value={
                    (overrides["home.partners.items"] as PartnerItem[] | undefined) ?? null
                  }
                  onChange={(v) => setKey("home.partners.items", v)}
                />
              );
            }
            if (field.kind === "booking-links") {
              return (
                <BookingLinksEditor
                  key={`booking-${i}`}
                  value={
                    (overrides["home.booking.links"] as BookingLink[] | undefined) ?? null
                  }
                  onChange={(v) => setKey("home.booking.links", v)}
                />
              );
            }
            return (
              <FieldRow
                key={field.key}
                field={field}
                value={overrides[field.key]}
                onChange={(v) => setKey(field.key, v)}
                error={issues[field.key]}
                controlOverrides={controlOverrides}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function FieldRow({
  field,
  value,
  onChange,
  error,
  controlOverrides,
}: {
  field: Extract<FieldDef, { key: string }>;
  value: unknown;
  onChange: (v: unknown) => void;
  error?: string;
  controlOverrides: Record<string, unknown> | null;
}) {
  // The "effective live value" for this field:
  //   - if controlOverrides is null → this IS the control, show nothing
  //   - if control has an override for this key → show that
  //   - otherwise → fall back to the hardcoded site default
  const effectiveLive: unknown =
    controlOverrides === null
      ? undefined
      : controlOverrides[field.key] !== undefined
        ? controlOverrides[field.key]
        : field.siteDefault;

  function formatLive(v: unknown): string {
    if (v === undefined || v === null || v === "") return "(empty — site default)";
    if (typeof v === "boolean") return v ? "Show" : "Hide";
    const s = String(v);
    return s.length > 100 ? s.slice(0, 100) + "…" : s;
  }

  const errorClass = error ? "border-destructive" : "";
  return (
    <div>
      <label className="flex items-center justify-between text-sm font-medium mb-1">
        <span>{field.label}</span>
        <code className="text-[10px] font-normal text-muted-foreground">
          {field.key}
        </code>
      </label>
      {field.kind === "boolean" ? (
        <select
          value={value === undefined ? "" : value === true ? "true" : "false"}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === "" ? undefined : v === "true");
          }}
          className={`rounded-md border border-input bg-background px-3 py-1.5 text-sm ${errorClass}`}
        >
          <option value="">— inherit default —</option>
          <option value="true">Show</option>
          <option value="false">Hide</option>
        </select>
      ) : field.kind === "longtext" ? (
        <textarea
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value || undefined)}
          rows={3}
          className={`w-full rounded-md border border-input bg-background px-3 py-2 text-sm ${errorClass}`}
        />
      ) : (
        <Input
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value || undefined)}
          className={errorClass}
        />
      )}
      {error ? (
        <p className="text-xs text-destructive mt-1">{error}</p>
      ) : field.help ? (
        <p className="text-xs text-muted-foreground mt-1">{field.help}</p>
      ) : null}
      {effectiveLive !== undefined ? (
        <div className="flex items-start gap-2 mt-1.5">
          <p className="text-[11px] text-muted-foreground flex-1 leading-relaxed">
            <span className="text-zinc-500">
              {controlOverrides && field.key in controlOverrides
                ? "Control: "
                : "Site default: "}
            </span>
            {formatLive(effectiveLive)}
          </p>
          {value !== effectiveLive ? (
            <button
              type="button"
              onClick={() => onChange(effectiveLive)}
              className="text-[11px] shrink-0 text-primary hover:underline mt-0.5"
            >
              Copy
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PartnersEditor({
  value,
  onChange,
}: {
  value: PartnerItem[] | null;
  onChange: (v: PartnerItem[] | undefined) => void;
}) {
  const items = value ?? [];
  const [pickerForRow, setPickerForRow] = useState<number | null>(null);

  function update(i: number, patch: Partial<PartnerItem>) {
    const next = items.map((it, idx) => (idx === i ? { ...it, ...patch } : it));
    onChange(next);
  }
  function addRow() {
    onChange([...items, { src: "", alt: "", href: null }]);
  }
  function removeRow(i: number) {
    const next = items.filter((_, idx) => idx !== i);
    onChange(next.length === 0 ? undefined : next);
  }
  function handleMediaPicked(media: MediaItem) {
    if (pickerForRow === null) return;
    update(pickerForRow, {
      src: resolveStoragePath(media.publicUrl ?? media.storageKey ?? ""),
      // Pre-fill alt text from the asset's alt field when present and
      // the row has no alt of its own, so admins don't have to retype.
      alt: items[pickerForRow]?.alt || media.altText || "",
    });
    setPickerForRow(null);
  }

  return (
    <div className="border border-border rounded-md p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Partner items</span>
        <span className="text-[10px] text-muted-foreground font-mono">
          home.partners.items
        </span>
      </div>
      {items.map((item, i) => (
        <div key={i} className="grid grid-cols-12 gap-2 items-end">
          <div className="col-span-5">
            <label className="block text-xs text-muted-foreground mb-1">
              Image URL
            </label>
            <div className="flex gap-1">
              <Input
                value={item.src}
                onChange={(e) => update(i, { src: e.target.value })}
                placeholder="/images/logos/example.png"
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setPickerForRow(i)}
                title="Pick from media library"
              >
                <ImageIcon className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <div className="col-span-3">
            <label className="block text-xs text-muted-foreground mb-1">
              Alt text
            </label>
            <Input
              value={item.alt}
              onChange={(e) => update(i, { alt: e.target.value })}
            />
          </div>
          <div className="col-span-3">
            <label className="block text-xs text-muted-foreground mb-1">
              Link href (optional)
            </label>
            <Input
              value={item.href ?? ""}
              onChange={(e) =>
                update(i, { href: e.target.value || null })
              }
            />
          </div>
          <div className="col-span-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => removeRow(i)}
              type="button"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ))}
      <Button type="button" size="sm" variant="ghost" onClick={addRow}>
        <Plus className="h-3.5 w-3.5 mr-1" />
        Add partner
      </Button>
      <MediaPickerModal
        open={pickerForRow !== null}
        onClose={() => setPickerForRow(null)}
        onSelect={handleMediaPicked}
        kind="image"
        title="Pick partner logo"
      />
    </div>
  );
}

function BookingLinksEditor({
  value,
  onChange,
}: {
  value: BookingLink[] | null;
  onChange: (v: BookingLink[] | undefined) => void;
}) {
  const items = value ?? [];

  function update(i: number, patch: Partial<BookingLink>) {
    const next = items.map((it, idx) => (idx === i ? { ...it, ...patch } : it));
    onChange(next);
  }
  function addRow() {
    onChange([
      ...items,
      { label: "", href: "", eventId: "booking.discovery" },
    ]);
  }
  function removeRow(i: number) {
    const next = items.filter((_, idx) => idx !== i);
    onChange(next.length === 0 ? undefined : next);
  }

  return (
    <div className="border border-border rounded-md p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Booking links</span>
        <span className="text-[10px] text-muted-foreground font-mono">
          home.booking.links
        </span>
      </div>
      {items.map((item, i) => (
        <div key={i} className="grid grid-cols-12 gap-2 items-end">
          <div className="col-span-3">
            <label className="block text-xs text-muted-foreground mb-1">
              Label
            </label>
            <Input
              value={item.label}
              onChange={(e) => update(i, { label: e.target.value })}
            />
          </div>
          <div className="col-span-4">
            <label className="block text-xs text-muted-foreground mb-1">
              Href
            </label>
            <Input
              value={item.href}
              onChange={(e) => update(i, { href: e.target.value })}
              placeholder="/booking/strategy-call"
            />
          </div>
          <div className="col-span-4">
            <label className="block text-xs text-muted-foreground mb-1">
              Event id (for conversions)
            </label>
            <Input
              value={item.eventId}
              onChange={(e) => update(i, { eventId: e.target.value })}
              placeholder="booking.strategy_call"
            />
          </div>
          <div className="col-span-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => removeRow(i)}
              type="button"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ))}
      <Button type="button" size="sm" variant="ghost" onClick={addRow}>
        <Plus className="h-3.5 w-3.5 mr-1" />
        Add booking link
      </Button>
    </div>
  );
}

// ---------- Conversions tab --------------------------------------------

function ConversionsTab({
  experiment,
  onError,
  onChange,
}: {
  experiment: AdminExperiment;
  onError: (msg: string | null) => void;
  onChange: () => void;
}) {
  const [paths, setPaths] = useState<ConversionPath[]>(
    experiment.conversionPaths ?? [],
  );

  useEffect(() => {
    setPaths(experiment.conversionPaths ?? []);
  }, [experiment.id, experiment.conversionPaths]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.updateAdminExperiment(experiment.id, { conversionPaths: paths }),
    onSuccess: () => {
      onError(null);
      onChange();
    },
    onError: (err) =>
      onError(err instanceof Error ? err.message : "Save failed"),
  });

  function update(i: number, patch: Partial<ConversionPath>) {
    setPaths(paths.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }
  function add(kind: ConversionPath["kind"]) {
    const defaults: Record<ConversionPath["kind"], ConversionPath> = {
      cta: {
        kind: "cta",
        value: "conversion.cta.get_started",
        label: "Get Started click",
      },
      booking: {
        kind: "booking",
        value: "booking.discovery",
        label: "Booking link click",
      },
      path: {
        kind: "path",
        value: "/services/ai-strategy-design",
        label: "Visit AI strategy & design",
      },
      carousel: {
        kind: "carousel",
        value: "conversion.carousel.click",
        label: "Carousel card click",
      },
    };
    setPaths([...paths, defaults[kind]]);
  }
  function remove(i: number) {
    setPaths(paths.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
        Conversion targets attributed to this experiment.
        <ul className="list-disc ml-5 mt-2 space-y-1">
          <li>
            <strong>CTA</strong> — value is the event id (e.g.{" "}
            <code>conversion.cta.get_started</code>).
          </li>
          <li>
            <strong>Booking</strong> — value is the booking link's eventId
            (configured on the variant's booking links).
          </li>
          <li>
            <strong>Path</strong> — value is a route prefix; visits to any
            URL starting with it count once per visitor per session.
          </li>
        </ul>
      </div>

      {paths.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-muted-foreground">
          No conversion targets yet.
        </div>
      ) : (
        <div className="space-y-2">
          {paths.map((p, i) => (
            <div
              key={i}
              className="grid grid-cols-12 gap-2 items-end border border-border rounded-md p-3"
            >
              <div className="col-span-2">
                <label className="block text-xs text-muted-foreground mb-1">
                  Kind
                </label>
                <select
                  value={p.kind}
                  onChange={(e) =>
                    update(i, { kind: e.target.value as ConversionPath["kind"] })
                  }
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                >
                  <option value="cta">CTA</option>
                  <option value="booking">Booking</option>
                  <option value="path">Path</option>
                </select>
              </div>
              <div className="col-span-4">
                <label className="block text-xs text-muted-foreground mb-1">
                  Value
                </label>
                <Input
                  value={p.value}
                  onChange={(e) => update(i, { value: e.target.value })}
                />
              </div>
              <div className="col-span-5">
                <label className="block text-xs text-muted-foreground mb-1">
                  Label
                </label>
                <Input
                  value={p.label}
                  onChange={(e) => update(i, { label: e.target.value })}
                />
              </div>
              <div className="col-span-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => remove(i)}
                  type="button"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" onClick={() => add("cta")}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add CTA
        </Button>
        <Button variant="ghost" size="sm" onClick={() => add("booking")}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add booking
        </Button>
        <Button variant="ghost" size="sm" onClick={() => add("path")}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add path
        </Button>
      </div>

      <Button
        onClick={() => saveMutation.mutate()}
        disabled={saveMutation.isPending}
      >
        <Save className="h-4 w-4 mr-2" />
        Save conversions
      </Button>
    </div>
  );
}

// ---------- Results tab -------------------------------------------------

// Required sample size per variant for a two-proportion z-test at
// α=0.05 two-tailed and power=0.80, given a baseline rate p and a
// relative MDE (e.g. 0.05 = "detect a 5% lift over baseline").
//
// Formula: n = (z_a/2 + z_b)^2 * (p1*(1-p1) + p2*(1-p2)) / (p1 - p2)^2
// with z_a/2 ≈ 1.96, z_b ≈ 0.8416.
function requiredSamplePerVariant(p: number, mdeRelative: number): number {
  if (p <= 0 || p >= 1 || mdeRelative <= 0) return Infinity;
  const p1 = p;
  const p2 = Math.min(0.999, p * (1 + mdeRelative));
  const numerator = (1.96 + 0.8416) ** 2 * (p1 * (1 - p1) + p2 * (1 - p2));
  const denominator = (p1 - p2) ** 2;
  return Math.ceil(numerator / denominator);
}

function ResultsTab({ experimentId }: { experimentId: string }) {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-experiment-results", experimentId],
    queryFn: () => api.getAdminExperimentResults(experimentId),
  });
  // Default MDE: 5% relative lift over baseline. Editor can dial it
  // up or down to see the required-N tradeoff in real time.
  const [mdePct, setMdePct] = useState(5);

  if (isLoading) return <div className="text-muted-foreground">Loading…</div>;
  if (!data) return null;

  const control = data.variants.find((v) => v.isControl);
  const baseline = control && control.visitors > 0 ? control.overall.rate : 0;
  const required =
    baseline > 0
      ? requiredSamplePerVariant(baseline, mdePct / 100)
      : Infinity;
  const minVisitorsAcrossVariants =
    data.variants.length > 0
      ? Math.min(...data.variants.map((v) => v.visitors))
      : 0;
  const progressPct =
    isFinite(required) && required > 0
      ? Math.min(100, (minVisitorsAcrossVariants / required) * 100)
      : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Counts derived from <code>experiment_assignments</code> and
          <code> traffic_events</code>. Forced assignments (URL or admin
          preview) are excluded.
        </p>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          Refresh
        </Button>
      </div>

      <div className="rounded-md border border-border p-4 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h3 className="font-semibold text-sm">Sample-size estimator</h3>
          <div className="flex items-center gap-2 text-sm">
            <label className="text-muted-foreground">
              MDE (relative lift over baseline):
            </label>
            <Input
              type="number"
              min={0.1}
              max={100}
              step={0.5}
              value={mdePct}
              onChange={(e) =>
                setMdePct(Math.max(0.1, +e.target.value || 0.1))
              }
              className="w-24"
            />
            <span className="text-muted-foreground">%</span>
          </div>
        </div>
        {baseline > 0 && isFinite(required) ? (
          <div className="text-sm space-y-1">
            <div>
              At baseline rate <strong>{(baseline * 100).toFixed(2)}%</strong>{" "}
              (control) and α=0.05, power=0.80, you need{" "}
              <strong>~{required.toLocaleString()}</strong> visitors per
              variant to detect a {mdePct}% relative lift.
            </div>
            <div className="text-xs text-muted-foreground">
              Smallest variant currently has{" "}
              {minVisitorsAcrossVariants.toLocaleString()} visitors —{" "}
              <strong>{progressPct.toFixed(0)}%</strong> of the way to the
              threshold.
            </div>
            <div className="h-1.5 bg-muted rounded overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Need control visitors and a non-zero conversion rate to compute
            a sample-size estimate.
          </p>
        )}
      </div>
      {data.variants.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-muted-foreground">
          No data yet.
        </div>
      ) : (
        <div className="rounded-md border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-left">
              <tr>
                <th className="px-3 py-2">Variant</th>
                <th className="px-3 py-2">Visitors</th>
                <th className="px-3 py-2">Conversions</th>
                <th className="px-3 py-2">Rate</th>
                <th className="px-3 py-2">vs control (z, p)</th>
              </tr>
            </thead>
            <tbody>
              {data.variants.map((v) => (
                <tr key={v.key} className="border-t border-border align-top">
                  <td className="px-3 py-2">
                    <div className="font-medium">{v.name}</div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {v.key}
                      {v.isControl ? " · control" : ""}
                    </div>
                  </td>
                  <td className="px-3 py-2">{v.visitors}</td>
                  <td className="px-3 py-2">
                    <div>{v.overall.count} total</div>
                    <ul className="text-xs text-muted-foreground mt-1 space-y-0.5">
                      {v.conversions.map((c, i) => (
                        <li key={i}>
                          {c.label}: {c.count} ({(c.rate * 100).toFixed(1)}%)
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="px-3 py-2">{(v.overall.rate * 100).toFixed(1)}%</td>
                  <td className="px-3 py-2 text-xs">
                    {v.isControl ? (
                      "—"
                    ) : v.significance ? (
                      <>
                        z = {v.significance.vsControl.toFixed(2)}, p ={" "}
                        {v.significance.pValue.toFixed(3)}
                        {Math.abs(v.significance.vsControl) > 1.96 ? (
                          <span className="ml-2 text-emerald-400">
                            significant
                          </span>
                        ) : (
                          <span className="ml-2 text-muted-foreground">
                            not significant
                          </span>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
