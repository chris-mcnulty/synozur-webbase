import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  Plus,
  Trash2,
  RefreshCw,
  Headphones,
  Mic2,
  Save,
  Ban,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AdminLayout } from "@/components/admin/AdminLayout";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";

const VOICE_OPTIONS: { value: string; label: string }[] = [
  { value: "alloy",   label: "Alloy — neutral" },
  { value: "ash",     label: "Ash — authoritative" },
  { value: "coral",   label: "Coral — warm" },
  { value: "echo",    label: "Echo — deep" },
  { value: "fable",   label: "Fable — expressive" },
  { value: "nova",    label: "Nova — upbeat" },
  { value: "onyx",    label: "Onyx — deep, authoritative" },
  { value: "sage",    label: "Sage — calm" },
  { value: "shimmer", label: "Shimmer — bright" },
];

// Curated Azure AI Speech neural voices. Keep in sync with VALID_AZURE_VOICES
// in artifacts/api-server/src/lib/azureTts.ts.
const AZURE_VOICE_OPTIONS: { value: string; label: string }[] = [
  { value: "en-US-AndrewMultilingualNeural",      label: "Andrew — warm, conversational (US)" },
  { value: "en-US-BrianMultilingualNeural",       label: "Brian — casual, friendly (US)" },
  { value: "en-US-GuyNeural",                     label: "Guy — confident, newscast (US)" },
  { value: "en-US-DavisNeural",                   label: "Davis — calm, measured (US)" },
  { value: "en-US-SteffanNeural",                 label: "Steffan — deep, narration (US)" },
  { value: "en-US-TonyNeural",                    label: "Tony — energetic (US)" },
  { value: "en-US-AvaMultilingualNeural",         label: "Ava — natural, expressive (US)" },
  { value: "en-US-EmmaMultilingualNeural",        label: "Emma — light, friendly (US)" },
  { value: "en-US-JennyNeural",                   label: "Jenny — warm (US)" },
  { value: "en-US-AriaNeural",                    label: "Aria — polished, newscast (US)" },
  { value: "en-US-MichelleNeural",                label: "Michelle — professional (US)" },
  { value: "en-US-Andrew:DragonHDLatestNeural",   label: "Andrew — Dragon HD (US)" },
  { value: "en-US-Ava:DragonHDLatestNeural",      label: "Ava — Dragon HD (US)" },
  { value: "en-US-Emma:DragonHDLatestNeural",     label: "Emma — Dragon HD (US)" },
  { value: "en-US-Steffan:DragonHDLatestNeural",  label: "Steffan — Dragon HD (US)" },
  { value: "en-US-Aria:DragonHDLatestNeural",     label: "Aria — Dragon HD (US)" },
  { value: "en-GB-RyanNeural",                    label: "Ryan — British male (UK)" },
  { value: "en-GB-SoniaNeural",                   label: "Sonia — British female (UK)" },
  { value: "en-AU-NatashaNeural",                 label: "Natasha — Australian female (AU)" },
];

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "approved":
    case "delivered":
      return "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-200";
    case "processing":
      return "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200";
    case "purged":
    case "revoked":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200";
  }
}

type Settings = {
  briefingMailbox: string | null;
  briefingDeleteInbound: boolean;
  briefingPodcastFormat: string;
  briefingPodcastTone: string;
  briefingPodcastVoice: string;
  briefingPodcastHostVoice: string;
  briefingPodcastCohostVoice: string;
  briefingPodcastAzureVoice: string;
  briefingPodcastAzureHostVoice: string;
  briefingPodcastAzureCohostVoice: string;
  ttsEngine: "azure" | "openai";
};

export default function AdminBriefingPodcast() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ── Settings ──────────────────────────────────────────────────────────────
  const [mailboxInput, setMailboxInput] = useState("");
  const [mailboxEditing, setMailboxEditing] = useState(false);

  const settingsQuery = useQuery({
    queryKey: ["briefing-podcast-settings"],
    queryFn: () => api.getBriefingPodcastSettings(),
  });

  const serverSettings = settingsQuery.data as Settings | undefined;
  const serverMailbox     = serverSettings?.briefingMailbox          ?? null;
  const deleteInbound     = serverSettings?.briefingDeleteInbound    ?? false;
  const podcastFormat     = serverSettings?.briefingPodcastFormat    ?? "single";
  const podcastTone       = serverSettings?.briefingPodcastTone      ?? "conversational";
  const podcastVoice      = serverSettings?.briefingPodcastVoice     ?? "onyx";
  const podcastHostVoice  = serverSettings?.briefingPodcastHostVoice ?? "onyx";
  const podcastCohostVoice = serverSettings?.briefingPodcastCohostVoice ?? "nova";
  const ttsEngine         = serverSettings?.ttsEngine ?? "openai";
  const isAzure           = ttsEngine === "azure";
  const azureVoice        = serverSettings?.briefingPodcastAzureVoice       ?? "en-US-AndrewMultilingualNeural";
  const azureHostVoice    = serverSettings?.briefingPodcastAzureHostVoice   ?? "en-US-AndrewMultilingualNeural";
  const azureCohostVoice  = serverSettings?.briefingPodcastAzureCohostVoice ?? "en-US-AvaMultilingualNeural";

  // Pick the active engine's voice config so the UI shows what's actually used.
  const voiceOptions      = isAzure ? AZURE_VOICE_OPTIONS : VOICE_OPTIONS;
  const activeVoice       = isAzure ? azureVoice : podcastVoice;
  const activeHostVoice   = isAzure ? azureHostVoice : podcastHostVoice;
  const activeCohostVoice = isAzure ? azureCohostVoice : podcastCohostVoice;
  const voiceField        = isAzure ? "briefingPodcastAzureVoice" : "briefingPodcastVoice";
  const hostVoiceField    = isAzure ? "briefingPodcastAzureHostVoice" : "briefingPodcastHostVoice";
  const cohostVoiceField  = isAzure ? "briefingPodcastAzureCohostVoice" : "briefingPodcastCohostVoice";

  useEffect(() => {
    if (!mailboxEditing && serverMailbox !== null) {
      setMailboxInput(serverMailbox);
    }
  }, [serverMailbox, mailboxEditing]);

  const updateSettings = useMutation({
    mutationFn: (patch: Partial<Omit<Settings, "briefingMailbox"> & { briefingMailbox?: string | null }>) =>
      api.updateBriefingPodcastSettings(patch),
    onSuccess: () => {
      toast({ title: "Settings saved" });
      setMailboxEditing(false);
      void queryClient.invalidateQueries({ queryKey: ["briefing-podcast-settings"] });
    },
    onError: (err: unknown) =>
      toast({
        title: "Could not save settings",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      }),
  });

  // ── Approved senders ──────────────────────────────────────────────────────
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [orgLabel, setOrgLabel] = useState("");
  const [retainRecording, setRetainRecording] = useState(true);

  const clientsQuery = useQuery({
    queryKey: ["briefing-podcast-clients"],
    queryFn: () => api.listBriefingPodcastClients(),
  });

  const historyQuery = useQuery({
    queryKey: ["briefing-podcasts"],
    queryFn: () => api.listBriefingPodcasts(50),
  });

  const addClient = useMutation({
    mutationFn: () =>
      api.upsertBriefingPodcastClient({
        email: email.trim(),
        displayName: displayName.trim() || null,
        organizationLabel: orgLabel.trim() || null,
        status: "approved",
        retainRecording,
      }),
    onSuccess: () => {
      toast({ title: "Sender approved" });
      setEmail("");
      setDisplayName("");
      setOrgLabel("");
      setRetainRecording(true);
      void queryClient.invalidateQueries({ queryKey: ["briefing-podcast-clients"] });
    },
    onError: (err: unknown) =>
      toast({
        title: "Could not approve sender",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      }),
  });

  const patchClient = useMutation({
    mutationFn: (args: { id: string; patch: { status?: "approved" | "revoked"; retainRecording?: boolean } }) =>
      api.patchBriefingPodcastClient(args.id, args.patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["briefing-podcast-clients"] });
    },
    onError: (err: unknown) =>
      toast({
        title: "Could not update sender",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      }),
  });

  const removeClient = useMutation({
    mutationFn: (id: string) => api.deleteBriefingPodcastClient(id),
    onSuccess: () => {
      toast({ title: "Sender removed" });
      void queryClient.invalidateQueries({ queryKey: ["briefing-podcast-clients"] });
    },
  });

  const purge = useMutation({
    mutationFn: (id: string) => api.purgeBriefingPodcast(id),
    onSuccess: () => {
      toast({ title: "Recording purged" });
      void queryClient.invalidateQueries({ queryKey: ["briefing-podcasts"] });
    },
  });

  const clients = clientsQuery.data?.clients ?? [];
  const podcasts = historyQuery.data?.podcasts ?? [];

  return (
    <AdminLayout
      title="Briefing Podcast"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Briefing Podcast" }]}
    >
      <div className="space-y-10">
        <p className="text-sm text-muted-foreground">
          Approve external senders who can email a briefing and receive an
          audio version back, and review generated recordings.
        </p>

        {/* ── Settings ──────────────────────────────────────────────────── */}
        <section className="space-y-6">
          <div className="flex items-center gap-2">
            <Headphones className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Settings</h2>
          </div>

          {/* Watched mailbox */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Watched mailbox</p>
            <p className="text-xs text-muted-foreground">
              Inbound briefing emails are received at this M365 address. Graph
              change notifications deliver them to the webhook automatically.
            </p>
            <div className="flex items-end gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium">Mailbox address</span>
                <Input
                  type="email"
                  placeholder="briefing@synozur.com"
                  value={mailboxInput}
                  onChange={(e) => {
                    setMailboxInput(e.target.value);
                    setMailboxEditing(true);
                  }}
                  className="w-72"
                />
              </div>
              <Button
                onClick={() =>
                  updateSettings.mutate({ briefingMailbox: mailboxInput.trim() || null })
                }
                disabled={!mailboxEditing || updateSettings.isPending}
                variant="outline"
              >
                {updateSettings.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save
              </Button>
            </div>
            {serverMailbox && (
              <p className="text-xs text-muted-foreground">
                Currently watching: <span className="font-mono">{serverMailbox}</span>
              </p>
            )}
          </div>

          {/* Delete inbound messages */}
          <div className="flex items-start justify-between gap-6 rounded-lg border p-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">Delete inbound messages after processing</p>
              <p className="text-xs text-muted-foreground max-w-lg">
                When on, each inbound briefing email is deleted from the watched
                mailbox after it has been fetched — keeping the inbox clean. Leave
                off while testing so you can inspect what arrives.
              </p>
            </div>
            <Switch
              checked={deleteInbound}
              disabled={updateSettings.isPending || settingsQuery.isLoading}
              onCheckedChange={(checked) =>
                updateSettings.mutate({ briefingDeleteInbound: checked })
              }
            />
          </div>
        </section>

        {/* ── Podcast style ──────────────────────────────────────────────── */}
        <section className="space-y-6">
          <div className="flex items-center gap-2">
            <Mic2 className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Podcast style</h2>
          </div>
          <p className="text-sm text-muted-foreground -mt-2">
            Controls how Claude writes the script and which voice(s) are used when
            generating audio. Changes take effect on the next briefing.
          </p>
          <p className="text-xs text-muted-foreground -mt-4">
            Active speech engine:{" "}
            <span className="font-medium text-foreground">
              {isAzure ? "Azure AI Speech (Neural)" : "OpenAI (gpt-audio)"}
            </span>
            . The voice options below match this engine.
          </p>

          {/* Format + Tone */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <p className="text-sm font-medium">Format</p>
              <Select
                value={podcastFormat}
                onValueChange={(v) =>
                  updateSettings.mutate({ briefingPodcastFormat: v })
                }
                disabled={settingsQuery.isLoading || updateSettings.isPending}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">Single narrator</SelectItem>
                  <SelectItem value="dialogue">Two-speaker dialogue (Host + Co-host)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Tone</p>
              <Select
                value={podcastTone}
                onValueChange={(v) =>
                  updateSettings.mutate({ briefingPodcastTone: v })
                }
                disabled={settingsQuery.isLoading || updateSettings.isPending}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="formal">Formal — precise and concise</SelectItem>
                  <SelectItem value="conversational">Conversational — warm and approachable</SelectItem>
                  <SelectItem value="energetic">Energetic — upbeat and punchy</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Voice config — single narrator */}
          {podcastFormat === "single" && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Voice</p>
              <Select
                value={activeVoice}
                onValueChange={(v) =>
                  updateSettings.mutate({ [voiceField]: v })
                }
                disabled={settingsQuery.isLoading || updateSettings.isPending}
              >
                <SelectTrigger className="w-72">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {voiceOptions.map((v) => (
                    <SelectItem key={v.value} value={v.value}>
                      {v.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Voice config — dialogue */}
          {podcastFormat === "dialogue" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <p className="text-sm font-medium">Host voice</p>
                <Select
                  value={activeHostVoice}
                  onValueChange={(v) =>
                    updateSettings.mutate({ [hostVoiceField]: v })
                  }
                  disabled={settingsQuery.isLoading || updateSettings.isPending}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {voiceOptions.map((v) => (
                      <SelectItem key={v.value} value={v.value}>
                        {v.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">Co-host voice</p>
                <Select
                  value={activeCohostVoice}
                  onValueChange={(v) =>
                    updateSettings.mutate({ [cohostVoiceField]: v })
                  }
                  disabled={settingsQuery.isLoading || updateSettings.isPending}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {voiceOptions.map((v) => (
                      <SelectItem key={v.value} value={v.value}>
                        {v.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </section>

        {/* ── Approved senders ──────────────────────────────────────────── */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Approved senders</h2>
          <p className="text-sm text-muted-foreground">
            Only these addresses may submit a briefing to the watched mailbox
            and get a podcast in return. Other senders are ignored.
          </p>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium">Email</span>
              <Input
                type="email"
                placeholder="client@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-64"
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium">Name (optional)</span>
              <Input
                placeholder="Jane Client"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-48"
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium">Org / note (optional)</span>
              <Input
                placeholder="Acme Corp"
                value={orgLabel}
                onChange={(e) => setOrgLabel(e.target.value)}
                className="w-48"
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium">Retain recording</span>
              <div className="flex h-10 items-center">
                <Switch
                  checked={retainRecording}
                  onCheckedChange={setRetainRecording}
                />
              </div>
            </div>
            <Button
              onClick={() => addClient.mutate()}
              disabled={!email.trim() || addClient.isPending}
            >
              {addClient.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Approve
            </Button>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Org / note</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Retain</TableHead>
                <TableHead>Approved</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">
                    No approved senders yet.
                  </TableCell>
                </TableRow>
              ) : (
                clients.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-sm">{c.email}</TableCell>
                    <TableCell>{c.displayName ?? "—"}</TableCell>
                    <TableCell>{c.organizationLabel ?? "—"}</TableCell>
                    <TableCell>
                      <span
                        className={`rounded px-2 py-0.5 text-xs ${statusBadgeClass(c.status)}`}
                      >
                        {c.status}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={c.retainRecording}
                        onCheckedChange={(checked) =>
                          patchClient.mutate({ id: c.id, patch: { retainRecording: checked } })
                        }
                        disabled={patchClient.isPending}
                      />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDateTime(c.approvedAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {/* Revoke / Re-approve toggle */}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            patchClient.mutate({
                              id: c.id,
                              patch: { status: c.status === "approved" ? "revoked" : "approved" },
                            })
                          }
                          disabled={patchClient.isPending}
                          aria-label={c.status === "approved" ? "Revoke sender" : "Re-approve sender"}
                          title={c.status === "approved" ? "Revoke" : "Re-approve"}
                        >
                          {c.status === "approved" ? (
                            <Ban className="h-4 w-4 text-amber-500" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          )}
                        </Button>
                        {/* Permanent delete */}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeClient.mutate(c.id)}
                          disabled={removeClient.isPending}
                          aria-label="Remove sender"
                          title="Remove permanently"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </section>

        {/* ── Generated recordings ──────────────────────────────────────── */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent recordings</h2>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void historyQuery.refetch()}
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Recipient</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {podcasts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    No recordings yet.
                  </TableCell>
                </TableRow>
              ) : (
                podcasts.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-sm">
                      {p.recipientEmail}
                    </TableCell>
                    <TableCell className="max-w-xs truncate">{p.subject}</TableCell>
                    <TableCell>
                      <span
                        className={`rounded px-2 py-0.5 text-xs ${statusBadgeClass(p.status)}`}
                      >
                        {p.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDateTime(p.createdAt)}
                    </TableCell>
                    <TableCell>
                      {p.status === "delivered" && p.speItemId ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => purge.mutate(p.id)}
                          disabled={purge.isPending}
                          aria-label="Purge recording"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </section>
      </div>
    </AdminLayout>
  );
}
