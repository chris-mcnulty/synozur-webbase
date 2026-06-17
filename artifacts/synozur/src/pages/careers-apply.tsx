import { useEffect, useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useRoute, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Meta } from "@/lib/meta";
import { useAuth } from "@/context/auth";
import { careersApi } from "@/lib/careers-api";
import { Sparkles, Loader2 } from "lucide-react";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

interface Props {
  general?: boolean;
}

export default function CareersApplyPage({ general = false }: Props) {
  const [, navigate] = useLocation();
  const [, params] = useRoute<{ slug: string }>("/careers/jobs/:slug/apply");
  const slug = general ? null : params?.slug ?? null;
  const { isLoaded, isSignedIn } = useAuth();

  const { data: job, isLoading: jobLoading } = useQuery({
    queryKey: ["careers", "job", slug],
    queryFn: () => (slug ? careersApi.getJob(slug) : null),
    enabled: !!slug,
  });
  const { data: settings } = useQuery({
    queryKey: ["careers", "settings"],
    queryFn: () => careersApi.getSettings(),
  });

  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    linkedinUrl: "",
    education: "",
    experience: "",
    coverLetter: "",
    workAuthorized: false,
    requireSponsorship: false,
    eeoRace: "",
    eeoGender: "",
    eeoVeteran: "",
    eeoDisability: "",
    gdprConsent: false,
  });

  // Track which fields were auto-filled by AI so we can show a badge
  const [aiFilledFields, setAiFilledFields] = useState<Set<string>>(new Set());

  const [resumeMediaId, setResumeMediaId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [uploadName, setUploadName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keep a ref so the parse callback always has the latest mediaId
  const resumeMediaIdRef = useRef<string | null>(null);

  const submitMutation = useMutation({
    mutationFn: () =>
      careersApi.submitApplication({
        jobSlug: slug,
        ...form,
        resumeMediaId,
      }),
    onSuccess: (res) => {
      navigate(`/careers/applied?id=${res.id}`);
    },
    onError: (err: Error) => setError(err.message || "Submission failed"),
  });

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      const returnTo = encodeURIComponent(
        general
          ? "/careers/general-application"
          : `/careers/jobs/${slug ?? ""}/apply`,
      );
      navigate(`/sign-in?returnTo=${returnTo}`);
    }
  }, [isLoaded, isSignedIn, navigate, general, slug]);

  async function uploadResume(file: File) {
    setUploading(true);
    setError(null);
    setAiFilledFields(new Set());
    try {
      const contentType = file.type || "application/pdf";
      const startRes = await fetch(`${BASE_PATH}/api/careers/resume-upload-url`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType }),
      });
      if (!startRes.ok) {
        const j = await startRes.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error || "Could not start résumé upload");
      }
      const { uploadURL } = (await startRes.json()) as { uploadURL: string };
      const absURL = uploadURL.startsWith("/")
        ? `${window.location.origin}${uploadURL}`
        : uploadURL;
      const putRes = await fetch(absURL, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: file,
      });
      if (!putRes.ok) throw new Error("Résumé upload failed");
      const pathOnly = uploadURL.startsWith("http")
        ? new URL(uploadURL).pathname
        : uploadURL.split("?")[0] ?? uploadURL;
      const tokenMatch = pathOnly.match(/uploads?\/([^/?#]+)/);
      const token = tokenMatch?.[1];
      if (!token) throw new Error("Unexpected upload URL format");
      const storageKey = `/objects/uploads/${token}`;
      const regRes = await fetch(`${BASE_PATH}/api/careers/resume-register`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storageKey,
          mime: contentType,
          byteSize: file.size,
          originalName: file.name,
        }),
      });
      if (!regRes.ok) throw new Error("Could not save résumé");
      const reg = (await regRes.json()) as { id: string };
      setResumeMediaId(reg.id);
      resumeMediaIdRef.current = reg.id;
      setUploadName(file.name);

      // AI parse — runs immediately after upload registers the media row
      void parseResumeAi(reg.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function parseResumeAi(mediaId: string) {
    setParsing(true);
    try {
      const parsed = await careersApi.parseResume(mediaId);
      const filled = new Set<string>();
      setForm((prev) => {
        const next = { ...prev };
        if (parsed.fullName && !prev.fullName) {
          next.fullName = parsed.fullName;
          filled.add("fullName");
        }
        if (parsed.email && !prev.email) {
          next.email = parsed.email;
          filled.add("email");
        }
        if (parsed.phone && !prev.phone) {
          next.phone = parsed.phone;
          filled.add("phone");
        }
        if (parsed.linkedinUrl && !prev.linkedinUrl) {
          next.linkedinUrl = parsed.linkedinUrl;
          filled.add("linkedinUrl");
        }
        if (parsed.education && !prev.education) {
          next.education = parsed.education;
          filled.add("education");
        }
        if (parsed.experience && !prev.experience) {
          next.experience = parsed.experience;
          filled.add("experience");
        }
        return next;
      });
      setAiFilledFields(filled);
    } catch {
      // Parse failure is silent — the form still works, just not pre-filled
    } finally {
      setParsing(false);
    }
  }

  if (!isLoaded || !isSignedIn) {
    return <div className="px-4 py-16 max-w-3xl mx-auto" data-testid="apply-redirecting">Redirecting to sign in…</div>;
  }
  if (slug && jobLoading) return <div className="px-4 py-16 max-w-3xl mx-auto">Loading…</div>;

  const showEeo = settings?.eeoEnabled !== false;
  const heading = general
    ? "Join our talent network"
    : `Apply for ${job?.title ?? "this position"}`;

  function AiBadge({ field }: { field: string }) {
    if (!aiFilledFields.has(field)) return null;
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-violet-400 ml-2">
        <Sparkles size={10} /> Auto-filled from résumé
      </span>
    );
  }

  return (
    <div className="px-4 py-12 max-w-2xl mx-auto">
      <Meta title={heading} />
      <Link href={slug ? `/careers/jobs/${slug}` : "/careers"}>
        {/* eslint-disable-next-line jsx-a11y/anchor-is-valid -- wouter <Link> injects href into the inner <a>. */}
        <a className="text-sm text-muted-foreground hover:text-foreground">← Back</a>
      </Link>
      <h1 className="text-3xl font-bold mt-4 mb-6" data-testid="apply-heading">{heading}</h1>

      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!form.gdprConsent) {
            setError("Please confirm consent to continue.");
            return;
          }
          submitMutation.mutate();
        }}
        data-testid="apply-form"
      >
        <div>
          <Label htmlFor="apply-name">Full name <AiBadge field="fullName" /></Label>
          <Input id="apply-name" required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} data-testid="input-fullname" />
        </div>
        <div>
          <Label htmlFor="apply-email">Email <AiBadge field="email" /></Label>
          <Input id="apply-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="input-email" />
        </div>
        <div>
          <Label htmlFor="apply-phone">Phone (optional) <AiBadge field="phone" /></Label>
          <Input id="apply-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="input-phone" />
        </div>
        <div>
          <Label htmlFor="apply-linkedin">LinkedIn URL (optional) <AiBadge field="linkedinUrl" /></Label>
          <Input id="apply-linkedin" value={form.linkedinUrl} onChange={(e) => setForm({ ...form, linkedinUrl: e.target.value })} data-testid="input-linkedin" />
        </div>

        {/* Résumé upload — first so AI can pre-fill the fields below */}
        <div>
          <Label>Résumé (PDF or DOCX)</Label>
          <input
            type="file"
            accept=".pdf,.doc,.docx,application/pdf"
            data-testid="input-resume"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadResume(f);
            }}
            className="block mt-2 text-sm"
          />
          {uploading && <div className="text-xs text-muted-foreground mt-1">Uploading…</div>}
          {parsing && (
            <div className="flex items-center gap-1.5 text-xs text-violet-400 mt-1">
              <Loader2 size={11} className="animate-spin" /> Parsing résumé with AI…
            </div>
          )}
          {uploadName && resumeMediaId && !parsing && (
            <div className="text-xs text-emerald-400 mt-1" data-testid="resume-uploaded">
              ✓ {uploadName} attached
              {aiFilledFields.size > 0 && (
                <span className="text-violet-400 ml-2">· {aiFilledFields.size} field{aiFilledFields.size !== 1 ? "s" : ""} auto-filled</span>
              )}
            </div>
          )}
        </div>

        <div>
          <Label htmlFor="apply-education">Education <AiBadge field="education" /></Label>
          <Textarea id="apply-education" rows={2} value={form.education} onChange={(e) => setForm({ ...form, education: e.target.value })} data-testid="input-education" />
        </div>
        <div>
          <Label htmlFor="apply-experience">Experience <AiBadge field="experience" /></Label>
          <Textarea id="apply-experience" rows={4} value={form.experience} onChange={(e) => setForm({ ...form, experience: e.target.value })} data-testid="input-experience" />
        </div>
        <div>
          <Label htmlFor="apply-cover">Cover letter</Label>
          <Textarea id="apply-cover" rows={5} value={form.coverLetter} onChange={(e) => setForm({ ...form, coverLetter: e.target.value })} data-testid="input-cover" />
        </div>

        <div className="flex gap-6 flex-wrap">
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- Radix Checkbox renders a button, not a native input the rule recognises. */}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={form.workAuthorized} onCheckedChange={(v) => setForm({ ...form, workAuthorized: v === true })} data-testid="input-workauth" />
            Authorized to work in country of role
          </label>
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- Radix Checkbox renders a button, not a native input the rule recognises. */}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={form.requireSponsorship} onCheckedChange={(v) => setForm({ ...form, requireSponsorship: v === true })} data-testid="input-sponsor" />
            Will require visa sponsorship
          </label>
        </div>

        {showEeo && (
          <details className="border border-border rounded p-4">
            <summary className="cursor-pointer font-medium" data-testid="eeo-summary">
              Voluntary self-identification (optional)
            </summary>
            <div className="grid md:grid-cols-2 gap-4 mt-4">
              <div>
                <Label>Race / ethnicity</Label>
                <Input value={form.eeoRace} onChange={(e) => setForm({ ...form, eeoRace: e.target.value })} data-testid="input-eeo-race" />
              </div>
              <div>
                <Label>Gender</Label>
                <Input value={form.eeoGender} onChange={(e) => setForm({ ...form, eeoGender: e.target.value })} data-testid="input-eeo-gender" />
              </div>
              <div>
                <Label>Veteran status</Label>
                <Input value={form.eeoVeteran} onChange={(e) => setForm({ ...form, eeoVeteran: e.target.value })} data-testid="input-eeo-veteran" />
              </div>
              <div>
                <Label>Disability status</Label>
                <Input value={form.eeoDisability} onChange={(e) => setForm({ ...form, eeoDisability: e.target.value })} data-testid="input-eeo-disability" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Voluntary. Used for aggregated reporting only and never shared with hiring managers in identifiable form.
            </p>
          </details>
        )}

        {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- Radix Checkbox renders a button, not a native input the rule recognises. */}
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={form.gdprConsent}
            onCheckedChange={(v) => setForm({ ...form, gdprConsent: v === true })}
            required
            data-testid="input-consent"
          />
          <span>
            I consent to Synozur processing the information I've
            provided for the purpose of evaluating this application.
          </span>
        </label>

        {error && <div className="text-destructive text-sm" data-testid="apply-error">{error}</div>}

        <Button type="submit" size="lg" disabled={submitMutation.isPending} data-testid="button-submit">
          {submitMutation.isPending ? "Submitting…" : "Submit application"}
        </Button>
      </form>
    </div>
  );
}
