import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/context/auth";
import { PortalSiteHeader } from "@/components/portal-site-header";
import { PortalSiteFooter } from "@/components/portal-site-footer";

// Auto-initiates the OAuth flow on mount so users already signed in to
// synozur.com are passed through /oauth/authorize transparently — the server
// sees their session cookie and issues a code without prompting for a password.
// A manual button is shown after 3 s as a fallback for slow redirects.

export default function SignInRequired() {
  const { signIn } = useAuth();
  const [showManual, setShowManual] = useState(false);
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    const returnTo = window.location.pathname + window.location.search;
    signIn(returnTo);

    // If the redirect hasn't happened after 3 s, surface the manual button.
    const t = setTimeout(() => setShowManual(true), 3000);
    return () => clearTimeout(t);
  }, [signIn]);

  return (
    <div className="min-h-screen flex flex-col">
      <PortalSiteHeader hidePortalNav />
      <main className="flex-1 flex items-center justify-center bg-background px-6">
        <Card className="max-w-md w-full p-8 space-y-5 text-center">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Galaxy customer portal
            </p>
            <h1 className="text-2xl font-semibold">Signing you in…</h1>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Redirecting to sign in with your Synozur account.
          </p>
          {showManual && (
            <Button
              onClick={() => signIn(window.location.pathname + window.location.search)}
              className="w-full"
            >
              Sign in
            </Button>
          )}
        </Card>
      </main>
      <PortalSiteFooter />
    </div>
  );
}
