import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { careersApi, type CareersJob } from "@/lib/careers-api";

interface Props {
  id?: string;
}

const TYPES = ["full_time", "part_time", "contract", "internship"] as const;
const STATUSES = ["draft", "published", "closed"] as const;

export default function CareersJobEdit({ id }: Props) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const isNew = !id;

  const { data: job } = useQuery({
    queryKey: ["admin-careers-job", id],
    queryFn: () => (id ? careersApi.adminGetJob(id) : null),
    enabled: !!id,
  });
  const { data: nextRn } = useQuery({
    queryKey: ["admin-careers-next-req"],
    queryFn: () => careersApi.adminNextRequisition(),
    enabled: isNew,
  });

  const [form, setForm] = useState({
    title: "",
    slug: "",
    requisitionNumber: "",
    department: "",
    location: "",
    employmentType: "full_time" as (typeof TYPES)[number],
    status: "draft" as (typeof STATUSES)[number],
    description: "",
    requirements: "",
    salaryRange: "",
    hiringManagerEmail: "",
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (job) {
      setForm({
        title: job.title,
        slug: job.slug,
        requisitionNumber: job.requisitionNumber,
        department: job.department,
        location: job.location,
        employmentType: job.employmentType,
        status: job.status,
        description: job.description,
        requirements: job.requirementsParagraphs.join("\n\n"),
        salaryRange: job.salaryRange ?? "",
        hiringManagerEmail: job.hiringManagerEmail ?? "",
      });
    } else if (nextRn && isNew && !form.requisitionNumber) {
      setForm((f) => ({ ...f, requisitionNumber: nextRn.requisitionNumber }));
    }
  }, [job, nextRn, isNew]);  

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        title: form.title,
        slug: form.slug || undefined,
        requisitionNumber: form.requisitionNumber,
        department: form.department,
        location: form.location,
        employmentType: form.employmentType,
        status: form.status,
        description: form.description,
        requirementsParagraphs: form.requirements
          .split(/\n\s*\n/)
          .map((s) => s.trim())
          .filter(Boolean),
        salaryRange: form.salaryRange || null,
        hiringManagerEmail: form.hiringManagerEmail || null,
      };
      let saved: CareersJob;
      if (isNew) saved = await careersApi.adminCreateJob(body);
      else saved = await careersApi.adminPatchJob(id!, body);
      return saved;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-careers-jobs"] });
      navigate("/careers/jobs");
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <AdminLayout
      title={isNew ? "New job" : "Edit job"}
      previewEntity={{
        kind: "job",
        id,
        slug: form.slug,
        isDraft: form.status !== "published",
      }}
    >
      <h1 className="text-2xl font-semibold mb-6">{isNew ? "New job posting" : "Edit job posting"}</h1>
      <form
        className="space-y-5 max-w-3xl"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          save.mutate();
        }}
      >
        <div>
          <Label>Title</Label>
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required data-testid="input-title" />
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label>Slug (optional)</Label>
            <Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} data-testid="input-slug" placeholder="auto-generated from title" />
          </div>
          <div>
            <Label>Requisition #</Label>
            <Input value={form.requisitionNumber} onChange={(e) => setForm({ ...form, requisitionNumber: e.target.value })} data-testid="input-req" />
          </div>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <Label>Department</Label>
            <Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} data-testid="input-department" />
          </div>
          <div>
            <Label>Location</Label>
            <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} data-testid="input-location" />
          </div>
          <div>
            <Label>Employment type</Label>
            <select
              className="w-full bg-background border border-border rounded px-3 py-2 text-sm"
              value={form.employmentType}
              onChange={(e) => setForm({ ...form, employmentType: e.target.value as (typeof TYPES)[number] })}
              data-testid="select-type"
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>{t.replace("_", " ")}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <Label>Description</Label>
          <Textarea rows={6} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="input-description" />
        </div>
        <div>
          <Label>Requirements (separate paragraphs with a blank line)</Label>
          <Textarea rows={6} value={form.requirements} onChange={(e) => setForm({ ...form, requirements: e.target.value })} data-testid="input-requirements" />
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label>Salary range (optional)</Label>
            <Input value={form.salaryRange} onChange={(e) => setForm({ ...form, salaryRange: e.target.value })} data-testid="input-salary" />
          </div>
          <div>
            <Label>Hiring manager email (optional)</Label>
            <Input type="email" value={form.hiringManagerEmail} onChange={(e) => setForm({ ...form, hiringManagerEmail: e.target.value })} data-testid="input-hm-email" />
          </div>
        </div>
        <div>
          <Label>Status</Label>
          <select
            className="w-full bg-background border border-border rounded px-3 py-2 text-sm max-w-xs"
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as (typeof STATUSES)[number] })}
            data-testid="select-status"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        {error && <div className="text-destructive text-sm" data-testid="job-error">{error}</div>}
        <div className="flex gap-3">
          <Button type="submit" disabled={save.isPending} data-testid="button-save-job">
            {save.isPending ? "Saving…" : isNew ? "Create" : "Save"}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate("/careers/jobs")}>
            Cancel
          </Button>
        </div>
      </form>
    </AdminLayout>
  );
}
