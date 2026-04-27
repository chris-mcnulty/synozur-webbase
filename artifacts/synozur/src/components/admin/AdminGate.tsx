import { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { CurrentUser } from "@workspace/api-client-react";
import { capabilitiesFromServer, computeCapabilities, type Capability } from "@/lib/capabilities";
import { useAuth } from "@/context/auth";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

// Server hands the SPA `effectiveCapabilities` on /api/auth/me as of #111.
// The generated CurrentUser type doesn't include the field yet (orval
// regen is a separate step), so we extend it locally.
type CurrentUserWithCapabilities = CurrentUser & {
  effectiveCapabilities?: readonly string[];
};

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
  const { isLoaded, isSignedIn, user } = useAuth();

  const { data: adminMe, isLoading: adminLoading } = useQuery({
    queryKey: ["admin-me"],
    queryFn: () => api.me(),
    enabled: isLoaded && isSignedIn,
    retry: false,
  });

  const { data: cmsUser, isLoading: cmsLoading } = useQuery<CurrentUserWithCapabilities | null>({
    queryKey: ["cms-me"],
    queryFn: async () => {
      try {
        const res = await fetch(`${BASE_PATH}/api/auth/me`, { credentials: "include" });
        if (!res.ok) return null;
        return (await res.json()) as CurrentUserWithCapabilities;
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

  // Widen to string[] — the generated `RoleName` enum is still on the legacy 4,
  // but the server sends back any of the 11 names from ROLE_NAMES.
  const roles: readonly string[] = cmsUser?.roles ?? [];
  const isAdmin = roles.includes("admin") || roles.includes("site_admin");
  const isEditorOrAbove = isAdmin || roles.includes("editor");
  const isAllowListed = !!adminMe?.authorized;
  // Prefer the server-hydrated capability set (#111). Fall back to the
  // legacy client-side computation for old deploys that don't return the
  // field yet, so the SPA stays functional through a rolling deploy.
  const capabilities = cmsUser?.effectiveCapabilities
    ? capabilitiesFromServer(cmsUser.effectiveCapabilities, isAllowListed)
    : computeCapabilities(roles, isAllowListed);
  const access: AdminAccess = {
    signedInEmail: adminMe?.email ?? cmsUser?.email ?? user?.email ?? null,
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
        <Link href="/sign-in?returnTo=/admin">
          <Button data-testid="button-go-sign-in">Sign in</Button>
        </Link>
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
        <a href={BASE_PATH ? `${BASE_PATH}/` : "/"}>
          <Button variant="outline">Return Home</Button>
        </a>
      </div>
    );
  }

  return <>{children}</>;
}
