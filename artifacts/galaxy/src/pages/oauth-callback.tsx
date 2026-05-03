import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/context/auth";
import { getOauthClient } from "@/lib/oauthClient";

// Lands here after /oauth/authorize redirects the browser back with
// `?code=...&state=...`. We exchange the code for tokens, refresh the auth
// state, and route the user to wherever they were trying to reach
// pre-redirect (default: /).

export default function OAuthCallback() {
  const [, setLocation] = useLocation();
  const { refresh } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const result = await getOauthClient().handleCallback(params);
        if (cancelled) return;
        await refresh();
        if (cancelled) return;
        const target = result.returnTo && result.returnTo.startsWith("/")
          ? result.returnTo
          : "/";
        setLocation(target);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Sign-in failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh, setLocation]);

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background px-6">
      <Card className="max-w-md w-full p-8 space-y-3 text-center">
        {error ? (
          <>
            <h1 className="text-lg font-semibold">Sign-in failed</h1>
            <p className="text-sm text-muted-foreground">{error}</p>
            <button
              className="text-sm underline"
              onClick={() => setLocation("/")}
            >
              Return home
            </button>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold">Finishing sign-in…</h1>
            <p className="text-sm text-muted-foreground">
              Hold tight — we're verifying your session.
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
