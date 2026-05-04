import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { ActivityTab } from "@/components/admin/ActivityTab";
import { api } from "@/lib/api";
import { useListCmsUsers, type CmsUser } from "@workspace/api-client-react";
import type { TeamMemberInput } from "@workspace/api-zod/types";

interface Props {
  id?: string;
}

const EMPTY: TeamMemberInput = {
  name: "",
  slug: "",
  jobTitle: "",
  shortDescription: null,
  longDescription: null,
  imageUrl: null,
  website: null,
  email: null,
  phone: null,
  linkedinUrl: null,
  active: true,
  manualSort: "",
  tags: [],
  userId: null,
};

export default function TeamForm({ id }: Props) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const isNew = !id;
  const memberId = id ? Number(id) : null;

  const [form, setForm] = useState<TeamMemberInput>(EMPTY);
  const [tagsInput, setTagsInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: existing, isLoading } = useQuery({
    queryKey: ["admin-team-member", memberId],
    queryFn: () => api.getTeamMember(memberId!),
    enabled: memberId != null,
  });

  const { data: usersData } = useListCmsUsers();

  useEffect(() => {
    if (existing) {
      setForm({
        name: existing.name,
        slug: existing.slug,
        jobTitle: existing.jobTitle,
        shortDescription: existing.shortDescription ?? null,
        longDescription: existing.longDescription ?? null,
        imageUrl: existing.imageUrl ?? null,
        website: existing.website ?? null,
        email: existing.email ?? null,
        phone: existing.phone ?? null,
        linkedinUrl: existing.linkedinUrl ?? null,
        active: existing.active,
        manualSort: existing.manualSort,
        tags: existing.tags ?? [],
        userId: (existing as { userId?: string | null }).userId ?? null,
      });
      setTagsInput((existing.tags ?? []).join(", "));
    }
  }, [existing]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const payload: TeamMemberInput = { ...form, tags };
      if (isNew) return api.createTeamMember(payload);
      return api.updateTeamMember(memberId!, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-team-members"] });
      qc.invalidateQueries({ queryKey: ["admin-team-member", memberId] });
      qc.invalidateQueries({ queryKey: ["public-team-members"] });
      navigate("/people/team-members");
    },
    onError: (e: Error) => setError(e.message),
  });

  if (!isNew && isLoading) {
    return (
      <AdminLayout title="Loading…">
        <div className="text-muted-foreground">Loading…</div>
      </AdminLayout>
    );
  }

  const linkedUser = usersData?.find((u: CmsUser) => u.id === form.userId);

  return (
    <AdminLayout
      title={isNew ? "New Team Member" : `Edit ${form.name}`}
      crumbs={[
        { label: "Admin", href: "/" },
        { label: "Team", href: "/people/team-members" },
        { label: isNew ? "New" : "Edit" },
      ]}
    >
      <button
        onClick={() => navigate("/people/team-members")}
        className="flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
        data-testid="button-back"
      >
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to team
      </button>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          saveMutation.mutate();
        }}
        className="space-y-6 max-w-3xl"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              data-testid="input-name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="slug">Slug (auto-generated if empty)</Label>
            <Input
              id="slug"
              value={form.slug ?? ""}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
              data-testid="input-slug"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="jobTitle">Job Title</Label>
          <Input
            id="jobTitle"
            value={form.jobTitle ?? ""}
            onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
            data-testid="input-jobTitle"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="shortDescription">Short Description (HTML allowed)</Label>
          <Textarea
            id="shortDescription"
            rows={3}
            value={form.shortDescription ?? ""}
            onChange={(e) =>
              setForm({ ...form, shortDescription: e.target.value || null })
            }
            data-testid="input-shortDescription"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="longDescription">Long Description (raw)</Label>
          <Textarea
            id="longDescription"
            rows={6}
            value={form.longDescription ?? ""}
            onChange={(e) =>
              setForm({ ...form, longDescription: e.target.value || null })
            }
            data-testid="input-longDescription"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="imageUrl">Photo URL</Label>
            <Input
              id="imageUrl"
              value={form.imageUrl ?? ""}
              onChange={(e) => setForm({ ...form, imageUrl: e.target.value || null })}
              placeholder="/images/team/josh-brantley.png"
              data-testid="input-imageUrl"
            />
            {form.imageUrl && (
              <img
                src={form.imageUrl}
                alt="Preview"
                className="mt-2 w-32 h-32 rounded-md object-cover border border-border"
              />
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="manualSort">Manual Sort Key</Label>
            <Input
              id="manualSort"
              value={form.manualSort ?? ""}
              onChange={(e) => setForm({ ...form, manualSort: e.target.value })}
              placeholder="1k"
              data-testid="input-manualSort"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={form.email ?? ""}
              onChange={(e) => setForm({ ...form, email: e.target.value || null })}
              data-testid="input-email"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              value={form.phone ?? ""}
              onChange={(e) => setForm({ ...form, phone: e.target.value || null })}
              data-testid="input-phone"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="website">Website</Label>
            <Input
              id="website"
              type="url"
              value={form.website ?? ""}
              onChange={(e) => setForm({ ...form, website: e.target.value || null })}
              data-testid="input-website"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="linkedinUrl">LinkedIn URL</Label>
            <Input
              id="linkedinUrl"
              type="url"
              value={form.linkedinUrl ?? ""}
              onChange={(e) =>
                setForm({ ...form, linkedinUrl: e.target.value || null })
              }
              data-testid="input-linkedinUrl"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="userId">Linked Synozur account</Label>
          <select
            id="userId"
            value={form.userId ?? ""}
            onChange={(e) => setForm({ ...form, userId: e.target.value || null })}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            data-testid="input-userId"
          >
            <option value="">— None —</option>
            {(usersData ?? []).map((u: CmsUser) => (
              <option key={u.id} value={u.id}>
                {u.displayName ?? u.email ?? u.id}
                {u.email && u.displayName ? ` (${u.email})` : ""}
              </option>
            ))}
          </select>
          {linkedUser && (
            <p className="text-xs text-muted-foreground">
              Linked to <strong>{linkedUser.displayName ?? linkedUser.email}</strong>.
              Blog posts by this account will surface this team member's job title, LinkedIn,
              and a link to this profile — but only while the member is active.
            </p>
          )}
          {!linkedUser && (
            <p className="text-xs text-muted-foreground">
              Link to a Synozur account to connect blog authorship. Set this member
              inactive when they leave — the link drops from their posts automatically,
              the posts themselves are untouched.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="tags">Tags (comma separated)</Label>
          <Input
            id="tags"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="Leader, Practitioner"
            data-testid="input-tags"
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            id="active"
            type="checkbox"
            checked={form.active ?? true}
            onChange={(e) => setForm({ ...form, active: e.target.checked })}
            data-testid="input-active"
          />
          <Label htmlFor="active">Active (show on public team page)</Label>
        </div>

        {error && (
          <div className="text-destructive text-sm" data-testid="text-form-error">
            {error}
          </div>
        )}

        <div className="flex items-center gap-3 pt-4">
          <Button
            type="submit"
            disabled={saveMutation.isPending}
            data-testid="button-save"
          >
            {saveMutation.isPending
              ? "Saving…"
              : isNew
                ? "Create Member"
                : "Save Changes"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate("/people/team-members")}
          >
            Cancel
          </Button>
        </div>
      </form>
      <div className="mt-6">
        <ActivityTab entity="team_member" entityId={id} />
      </div>
    </AdminLayout>
  );
}
