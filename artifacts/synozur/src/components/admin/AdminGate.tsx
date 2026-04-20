import { ReactNode } from "react";
import { useUser } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

export function AdminGate({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useUser();
  const [, navigate] = useLocation();
  const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");

  const { data: me, isLoading: meLoading } = useQuery({
    queryKey: ["admin-me"],
    queryFn: () => api.me(),
    enabled: isLoaded && isSignedIn,
    retry: false,
  });

  if (!isLoaded || (isSignedIn && meLoading)) {
    return <div className="container mx-auto px-4 py-16">Loading…</div>;
  }

  if (!isSignedIn) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-md text-center">
        <h1 className="text-3xl font-bold mb-4">Admin Sign In</h1>
        <p className="text-muted-foreground mb-6">
          You need to sign in to access the admin area.
        </p>
        <Button onClick={() => navigate("/sign-in")} data-testid="button-go-sign-in">
          Go to Sign In
        </Button>
      </div>
    );
  }

  if (me && !me.authorized) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-lg text-center">
        <h1 className="text-2xl font-bold mb-3">Not Authorized</h1>
        <p className="text-muted-foreground mb-6">
          The account <span className="font-mono">{me.email}</span> is not on the
          admin allow-list. Please contact an administrator.
        </p>
        <Link href="/">
          <Button variant="outline">Return Home</Button>
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
