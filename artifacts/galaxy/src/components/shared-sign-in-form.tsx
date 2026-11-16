import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth, SHARED_SIGNOUT_FLAG } from "@/context/auth";
import { getOauthClient } from "@/lib/oauthClient";

// Shared organization sign-in. Credentials live only in component state and
// are cleared after every attempt; never logged or persisted.
export function SharedSignInForm() {
  const { refresh } = useAuth();
  const [, navigate] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/shared/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-Galaxy-Request": "1" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      setPassword("");
      const json = res.ok ? ((await res.json().catch(() => null)) as { ok?: boolean } | null) : null;
      if (!json?.ok) {
        setError(res.status === 429 ? "Too many attempts. Try again later." : "Those credentials were not accepted.");
        return;
      }
      try { sessionStorage.removeItem(SHARED_SIGNOUT_FLAG); } catch { /* ignore */ }
      getOauthClient().clearTokens();
      await refresh();
      navigate("/pages");
    } catch {
      setPassword("");
      setError("Sign-in failed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="text-left space-y-3 pt-5 border-t border-border" autoComplete="off">
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Shared organization access</p>
        <p className="text-xs text-muted-foreground">Read-only access to private pages using an organization login.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="shared-username">Username</Label>
        <Input id="shared-username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" data-testid="input-shared-username" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="shared-password">Password</Label>
        <Input id="shared-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" data-testid="input-shared-password" />
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" variant="outline" className="w-full" disabled={busy || !username.trim() || !password} data-testid="button-shared-sign-in">
        {busy ? "Signing in…" : "Sign in with organization login"}
      </Button>
    </form>
  );
}
