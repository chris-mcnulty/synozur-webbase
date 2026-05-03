import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

// #225 — Galaxy-side landing page for client-org invitation links. Lives in
// Galaxy because the post-acceptance experience belongs in the customer
// portal, not on the marketing site. The api-server creates a session
// cookie inline, so on success we land directly on Galaxy's home page.

export default function AcceptInvitePage() {
  const { toast } = useToast();
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get("token") ?? "");
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) {
      toast({ title: "Missing invitation token.", variant: "destructive" });
      return;
    }
    if (password.length < 8) {
      toast({ title: "Password must be at least 8 characters.", variant: "destructive" });
      return;
    }
    if (password !== confirm) {
      toast({ title: "Passwords do not match.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch(`/api/auth/accept-invite`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          token,
          password,
          displayName: displayName.trim() || undefined,
        }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? r.statusText);
      }
      setDone(true);
      toast({ title: "Welcome! You're signed in." });
      // Server set the session cookie, so a hard reload to Galaxy's root
      // hydrates the auth context with the new identity.
      const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") || "/";
      setTimeout(() => { window.location.href = base + "/"; }, 1000);
    } catch (err) {
      toast({
        title: "Couldn't accept invitation",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <Card className="p-8 max-w-md w-full space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">Accept your invitation</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Set a password to finish creating your account on the Synozur Galaxy portal.
          </p>
        </div>
        {!token ? (
          <p className="text-sm text-destructive">
            No invitation token in the URL. Check the email link and try again.
          </p>
        ) : done ? (
          <p className="text-sm">All set — taking you to the portal…</p>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div>
              <Label htmlFor="invite-name">Your name (optional)</Label>
              <Input
                id="invite-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Alex Rivera"
              />
            </div>
            <div>
              <Label htmlFor="invite-pw">Password</Label>
              <Input
                id="invite-pw"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
                data-testid="input-accept-invite-password"
              />
            </div>
            <div>
              <Label htmlFor="invite-pw-confirm">Confirm password</Label>
              <Input
                id="invite-pw-confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                minLength={8}
                required
              />
            </div>
            <Button
              type="submit"
              disabled={submitting}
              className="w-full"
              data-testid="button-accept-invite"
            >
              {submitting ? "Setting up…" : "Set password & continue"}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
