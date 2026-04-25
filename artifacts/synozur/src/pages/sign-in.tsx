import { useEffect } from "react";
import { Link, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Meta } from "@/lib/meta";
import { useAuth } from "@/context/auth";

// Native sign-in landing. Replaces the previous Clerk-hosted sign-in
// component. Visiting `/sign-in` either auto-redirects to Entra (the
// expected path) or — when Entra is unconfigured — shows a hint.

export default function SignInPage() {
  const { signIn, isSignedIn, isLoaded } = useAuth();
  const search = useSearch();

  const params = new URLSearchParams(search);
  const returnTo = params.get("returnTo") ?? "/admin";

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      signIn(returnTo);
    }
  }, [isLoaded, isSignedIn, returnTo, signIn]);

  return (
    <div className="min-h-[80vh] flex items-center justify-center py-16 px-4">
      <Meta title="Sign in" noindex />
      <div className="text-center max-w-md">
        <h1 className="text-3xl font-bold mb-3">Sign in</h1>
        <p className="text-muted-foreground mb-6">
          You're being redirected to Microsoft to complete sign-in. If nothing
          happens, click the button below.
        </p>
        <Button onClick={() => signIn(returnTo)} data-testid="button-sign-in">
          Continue with Microsoft
        </Button>
        <p className="mt-8 text-xs text-muted-foreground">
          <Link href="/">Return home</Link>
        </p>
      </div>
    </div>
  );
}
