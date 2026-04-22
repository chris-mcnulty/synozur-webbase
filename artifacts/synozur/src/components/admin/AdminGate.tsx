import { ReactNode } from "react";
import { useUser } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { CurrentUser } from "@workspace/api-client-react";
import { computeCapabilities, type Capability } from "@/lib/capabilities";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

export type AdminAccess = {
  signedInEmail: string | null;
  cmsUser: CurrentUser | null;
  hasCmsRole: boolean;
  isAdmin: boolean;
  isEditorOrAbove: boolean;
  isAllowListed: boolean;
  capabilities: Set<Capability>;
  hasCapability: (cap: Capability) => boolean;
};

export function useAdminAccess(): {
  access: AdminAccess | null;
  isLoading: boolean;
  signedIn: boolean;
} {
  const { isLoaded, isSignedIn } = useUser();

  const { data: adminMe, isLoading: adminLoading } = useQuery({
    queryKey: ["admin-me"],
    queryFn: () => api.me(),
    enabled: isLoaded && isSignedIn,
    retry: false,
  });

  const { data: cmsUser, isLoading: cmsLoading } = useQuery<CurrentUser | null>({
    queryKey: ["cms-me"],
    queryFn: async () => {
      try {
        const res = await fetch(`${BASE_PATH}/api/auth/me`, { credentials: "include" });
        if (!res.ok) return null;
        return (await res.json()) as CurrentUser;
      } catch {
        return null;
      }
    },
    enabled: isLoaded && isSignedIn,
    retry: false,
  });

  if (!isLoaded) return { access: null, isLoading: true, signedIn: false };
  if (!isSignedIn) return { access: null, isLoading: false, signedIn: false };
  if (adminLoading || cmsLoading) {
    return { access: null, isLoading: true, signedIn: true };
  }

  const roles = cmsUser?.roles ?? [];
  const isAdmin = roles.includes("admin");
  const isEditorOrAbove = isAdmin || roles.includes("editor");
  const isAllowListed = !!adminMe?.authorized;
  const capabilities = computeCapabilities(roles, isAllowListed);
  const access: AdminAccess = {
    signedInEmail: adminMe?.email ?? cmsUser?.email ?? null,
    cmsUser: cmsUser ?? null,
    hasCmsRole: roles.length > 0,
    isAdmin,
    isEditorOrAbove,
    isAllowListed,
    capabilities,
    hasCapability: (cap) => capabilities.has(cap),
  };
  return { access, isLoading: false, signedIn: true };
}

export function AdminGate({ children }: { children: ReactNode }) {
  const [, navigate] = useLocation();
  const { access, isLoading, signedIn } = useAdminAccess();

  if (isLoading) {
    return (
      <div className="dark min-h-screen bg-background text-foreground flex items-center justify-center" data-testid="admin-loading">
        Loading…
      </div>
    );
  }

  if (!signedIn) {
    return (
      <div className="dark min-h-screen bg-background text-foreground flex flex-col items-center justify-center px-4 text-center">
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

  const authorized =
    access?.isAllowListed || access?.hasCmsRole || false;

  if (!authorized) {
    return (
      <div className="dark min-h-screen bg-background text-foreground flex flex-col items-center justify-center px-4 text-center" data-testid="admin-request-access">
        <h1 className="text-2xl font-bold mb-3">Request Access</h1>
        <p className="text-muted-foreground mb-2">
          The account{" "}
          <span className="font-mono">{access?.signedInEmail ?? ""}</span> is
          signed in but does not yet have admin access.
        </p>
        <p className="text-muted-foreground mb-6">
          Please ask an administrator to grant you a role (contributor, author,
          editor, or admin).
        </p>
        <Link href="/">
          <Button variant="outline">Return Home</Button>
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
