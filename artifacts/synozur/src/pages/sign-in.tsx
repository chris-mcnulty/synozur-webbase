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
  const returnTo = params.get("returnTo") ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);
  const [entraAvailable, setEntraAvailable] = useState(false);

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      navigate(returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/");
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
    if (loading || rateLimited) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${BASE_PATH}/api/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, rememberMe }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (res.status === 429) {
        setRateLimited(true);
        const retryAfter = Number(res.headers.get("Retry-After") ?? 0);
        const waitSecs = retryAfter > 0 ? retryAfter : 15 * 60;
        const mins = Math.ceil(waitSecs / 60);
        setError(`Too many failed sign-in attempts. Please wait ${mins} minute${mins === 1 ? "" : "s"} before trying again.`);
        setTimeout(() => {
          setRateLimited(false);
          setError(null);
        }, waitSecs * 1000);
        return;
      }
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Sign-in failed. Please try again.");
        return;
      }
      await refresh();
      navigate(returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/");
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
          <div
            role="alert"
            aria-live="assertive"
            data-testid="sign-in-error"
            className="mb-4 rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive"
          >
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
              disabled={loading || rateLimited}
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
              disabled={loading || rateLimited}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              id="remember-me"
              type="checkbox"
              data-testid="checkbox-remember-me"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              disabled={loading || rateLimited}
              className="h-4 w-4 rounded border-input accent-primary cursor-pointer"
            />
            <Label htmlFor="remember-me" className="cursor-pointer font-normal text-sm">
              Remember me for 30 days
            </Label>
          </div>
          <Button type="submit" className="w-full" disabled={loading || rateLimited} data-testid="button-sign-in">
            {loading ? "Signing in…" : rateLimited ? "Too many attempts" : "Sign in"}
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
              data-testid="button-sign-in-microsoft"
              onClick={handleEntraSignIn}
            >
              Continue with Microsoft
            </Button>
          </>
        )}

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link
            href={`/sign-up${returnTo && returnTo !== "/" ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`}
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
