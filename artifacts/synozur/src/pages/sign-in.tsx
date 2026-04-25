import { useState, useEffect } from "react";
import { Link, useSearch, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Meta } from "@/lib/meta";
import { useAuth } from "@/context/auth";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

export default function SignInPage() {
  const { isSignedIn, isLoaded, refresh } = useAuth();
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);
  const returnTo = params.get("returnTo") ?? "/admin";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [entraAvailable, setEntraAvailable] = useState(false);

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      navigate(returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/admin");
    }
  }, [isLoaded, isSignedIn, returnTo, navigate]);

  useEffect(() => {
    void fetch(`${BASE_PATH}/api/auth/config`, { credentials: "include" })
      .then((r) => r.json())
      .then((d: { entraConfigured?: boolean }) => setEntraAvailable(!!d.entraConfigured))
      .catch(() => undefined);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${BASE_PATH}/api/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Sign-in failed. Please try again.");
        return;
      }
      await refresh();
      navigate(returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/admin");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleEntraSignIn() {
    const url = new URL(`${BASE_PATH}/api/auth/sign-in`, window.location.origin);
    url.searchParams.set("returnTo", returnTo);
    window.location.assign(url.toString());
  }

  if (!isLoaded) return null;

  return (
    <div className="min-h-[80vh] flex items-center justify-center py-16 px-4">
      <Meta title="Sign in" noindex />
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Sign in</h1>
          <p className="text-muted-foreground text-sm">
            Access your Synozur Alliance account.
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email address</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              disabled={loading}
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link
                href="/forgot-password"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Forgot password?
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={loading}
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading} data-testid="button-sign-in">
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        {entraAvailable && (
          <>
            <div className="relative my-5">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-background px-2 text-muted-foreground">or</span>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleEntraSignIn}
            >
              Continue with Microsoft
            </Button>
          </>
        )}

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link
            href={`/sign-up${returnTo !== "/admin" ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`}
            className="font-medium text-foreground hover:underline"
          >
            Create one
          </Link>
        </p>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          <Link href="/">Return home</Link>
        </p>
      </div>
    </div>
  );
}
