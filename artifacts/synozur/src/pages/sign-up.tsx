import { useState, useEffect } from "react";
import { Link, useSearch, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Meta } from "@/lib/meta";
import { useAuth } from "@/context/auth";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

export default function SignUpPage() {
  const { isSignedIn, isLoaded, refresh } = useAuth();
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);
  const returnTo = params.get("returnTo") ?? "/admin";

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [registered, setRegistered] = useState(false);

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      navigate(returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/admin");
    }
  }, [isLoaded, isSignedIn, returnTo, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);

    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${BASE_PATH}/api/auth/register`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
          displayName: displayName.trim() || undefined,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Registration failed. Please try again.");
        return;
      }
      await refresh();
      setRegistered(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!isLoaded) return null;

  if (registered) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center py-16 px-4">
        <Meta title="Account created" noindex />
        <div className="w-full max-w-sm text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <svg className="h-7 w-7 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold mb-2">Account created</h1>
          <p className="text-muted-foreground text-sm mb-2">
            Welcome to The Synozur Alliance. We&apos;ve sent a verification email to{" "}
            <strong className="text-foreground">{email}</strong>.
          </p>
          <p className="text-muted-foreground text-sm mb-6">
            Please check your inbox and click the link to verify your address.
          </p>
          <Button asChild className="w-full">
            <Link href={returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/admin"}>
              Continue to your account
            </Link>
          </Button>
          <p className="mt-4 text-xs text-muted-foreground">
            Didn&apos;t receive the email?{" "}
            <button
              type="button"
              className="underline hover:no-underline"
              onClick={() => {
                void fetch(`${BASE_PATH}/api/auth/resend-verification`, {
                  method: "POST",
                  credentials: "include",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ email }),
                });
              }}
            >
              Resend it
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center py-16 px-4">
      <Meta title="Create an account" noindex />
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Create an account</h1>
          <p className="text-muted-foreground text-sm">
            Join The Synozur Alliance portal.
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="displayName">Full name</Label>
            <Input
              id="displayName"
              type="text"
              autoComplete="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
              disabled={loading}
            />
          </div>
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
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              disabled={loading}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm">Confirm password</Label>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat password"
              disabled={loading}
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Creating account…" : "Create account"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href={`/sign-in${returnTo !== "/admin" ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`}
            className="font-medium text-foreground hover:underline"
          >
            Sign in
          </Link>
        </p>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          <Link href="/">Return home</Link>
        </p>
      </div>
    </div>
  );
}
