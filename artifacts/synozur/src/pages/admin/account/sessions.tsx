import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Monitor, Smartphone, Globe, Trash2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { api, type AdminSession } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

function parseDevice(userAgent: string | null): { label: string; icon: typeof Monitor } {
  if (!userAgent) return { label: "Unknown device", icon: Globe };
  const ua = userAgent.toLowerCase();
  if (ua.includes("mobile") || ua.includes("android") || ua.includes("iphone") || ua.includes("ipad")) {
    return { label: "Mobile / Tablet", icon: Smartphone };
  }
  if (ua.includes("windows")) return { label: "Windows", icon: Monitor };
  if (ua.includes("macintosh") || ua.includes("mac os")) return { label: "macOS", icon: Monitor };
  if (ua.includes("linux")) return { label: "Linux", icon: Monitor };
  return { label: "Desktop", icon: Monitor };
}

function parseBrowser(userAgent: string | null): string {
  if (!userAgent) return "";
  const ua = userAgent;
  if (ua.includes("Edg/")) return "Edge";
  if (ua.includes("Chrome/") && !ua.includes("Chromium/")) return "Chrome";
  if (ua.includes("Firefox/")) return "Firefox";
  if (ua.includes("Safari/") && !ua.includes("Chrome/")) return "Safari";
  if (ua.includes("OPR/") || ua.includes("Opera/")) return "Opera";
  return "";
}

function formatRelative(dateStr: string): string {
  const date = new Date(dateStr);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  if (diffSeconds < 60) return "Just now";
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function SessionRow({
  session,
  onRevoke,
  isRevoking,
}: {
  session: AdminSession;
  onRevoke: (id: string) => void;
  isRevoking: boolean;
}) {
  const { label: deviceLabel, icon: DeviceIcon } = parseDevice(session.userAgent);
  const browser = parseBrowser(session.userAgent);
  const deviceDisplay = browser ? `${deviceLabel} · ${browser}` : deviceLabel;

  return (
    <div
      className={`flex items-center gap-4 rounded-lg border p-4 ${
        session.isCurrent ? "border-primary/40 bg-primary/5" : "border-border"
      }`}
      data-testid={session.isCurrent ? "session-row-current" : "session-row"}
    >
      <div className="shrink-0 text-muted-foreground">
        <DeviceIcon className="h-6 w-6" />
      </div>

      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{deviceDisplay}</span>
          {session.isCurrent && (
            <span
              className="inline-flex items-center gap-1 text-xs font-medium text-primary px-2 py-0.5 rounded-full bg-primary/10"
              data-testid="badge-current-session"
            >
              <ShieldCheck className="h-3 w-3" /> This session
            </span>
          )}
          {session.rememberMe && (
            <span className="text-xs text-muted-foreground px-1.5 py-0.5 rounded bg-muted border border-border">
              Remember me
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground space-x-3">
          {session.ip && <span>IP: {session.ip}</span>}
          <span>Last active: {formatRelative(session.lastSeenAt)}</span>
          <span>Signed in: {formatRelative(session.createdAt)}</span>
        </div>
        {session.userAgent && (
          <div
            className="text-xs text-muted-foreground truncate max-w-lg"
            title={session.userAgent}
          >
            {session.userAgent}
          </div>
        )}
      </div>

      <div className="shrink-0">
        {session.isCurrent ? (
          <span className="text-xs text-muted-foreground italic">Current</span>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onRevoke(session.id)}
            disabled={isRevoking}
            data-testid={`button-revoke-session-${session.id.slice(0, 8)}`}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Sign out
          </Button>
        )}
      </div>
    </div>
  );
}

export default function AdminActiveSessions() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const { data: sessions, isLoading, isError } = useQuery({
    queryKey: ["admin-sessions"],
    queryFn: () => api.listSessions(),
    refetchOnWindowFocus: true,
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.revokeSession(id),
    onMutate: (id) => setRevokingId(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-sessions"] });
      toast({ title: "Session signed out" });
    },
    onError: () => {
      toast({ title: "Failed to sign out session", variant: "destructive" });
    },
    onSettled: () => setRevokingId(null),
  });

  const currentSession = sessions?.find((s) => s.isCurrent);
  const otherSessions = sessions?.filter((s) => !s.isCurrent) ?? [];

  return (
    <AdminLayout
      title="Active Sessions"
      crumbs={[
        { label: "Admin", href: "/" },
        { label: "Account" },
        { label: "Active Sessions" },
      ]}
    >
      <p className="text-sm text-muted-foreground mb-8 max-w-2xl">
        These are all of your currently active sign-in sessions. You can sign out any session you
        don't recognise. To end your current session, use the{" "}
        <strong>Sign out</strong> button in the sidebar.
      </p>

      {isLoading && (
        <div className="text-muted-foreground text-sm">Loading sessions…</div>
      )}

      {isError && (
        <div className="text-destructive text-sm">
          Failed to load sessions. Please try refreshing the page.
        </div>
      )}

      {sessions && (
        <div className="space-y-6 max-w-2xl">
          {currentSession && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Current session
              </h2>
              <SessionRow
                session={currentSession}
                onRevoke={(id) => revokeMutation.mutate(id)}
                isRevoking={revokingId === currentSession.id}
              />
            </div>
          )}

          {otherSessions.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Other sessions ({otherSessions.length})
              </h2>
              <div className="space-y-3" data-testid="other-sessions-list">
                {otherSessions.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    onRevoke={(id) => revokeMutation.mutate(id)}
                    isRevoking={revokingId === session.id}
                  />
                ))}
              </div>
            </div>
          )}

          {otherSessions.length === 0 && !isLoading && (
            <p className="text-sm text-muted-foreground" data-testid="text-no-other-sessions">
              No other active sessions.
            </p>
          )}
        </div>
      )}
    </AdminLayout>
  );
}
