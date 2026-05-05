import * as React from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/context/auth";
import { ThemeProvider } from "@/context/theme";
import Home from "@/pages/home";
import Documents from "@/pages/documents";
import AppsPage from "@/pages/apps";
import AppSurfacePage from "@/pages/app-surface";
import ArtifactDetailPage from "@/pages/artifact-detail";
import SignInRequired from "@/pages/sign-in-required";
import NotFound from "@/pages/not-found";
import { PortalSiteHeader } from "@/components/portal-site-header";
import { PortalSiteFooter } from "@/components/portal-site-footer";
import { Skeleton } from "@/components/ui/skeleton";
import AcceptInvitePage from "@/pages/accept-invite";
import OAuthCallback from "@/pages/oauth-callback";
import {
  PortalSourceApp,
  type PortalSourceApp as PortalSourceAppType,
} from "@workspace/api-client-react";

const SOURCE_APPS = Object.values(PortalSourceApp) as PortalSourceAppType[];

function isSourceApp(s: string | undefined): s is PortalSourceAppType {
  return !!s && (SOURCE_APPS as readonly string[]).includes(s);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Don't loop on 401/403 — the gate page renders from the same query
      // result, no point hammering the server.
      retry: (failureCount, error) => {
        const status = (error as { status?: number } | null)?.status;
        if (status === 401 || status === 403) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
  },
});

function AuthLoadingSkeleton() {
  return (
    <div className="min-h-screen flex flex-col">
      <PortalSiteHeader hidePortalNav />
      <main className="flex-1 flex items-center justify-center bg-background px-6">
        <div className="max-w-md w-full space-y-4">
          <Skeleton className="h-6 w-1/3 mx-auto" />
          <Skeleton className="h-10 w-2/3 mx-auto" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5 mx-auto" />
        </div>
      </main>
      <PortalSiteFooter />
    </div>
  );
}

function Gated({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <AuthLoadingSkeleton />;
  if (!isSignedIn) return <SignInRequired />;
  return <>{children}</>;
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/accept-invite" component={AcceptInvitePage} />
      <Route path="/oauth-callback" component={OAuthCallback} />
      <Route path="/">
        <Gated><Home /></Gated>
      </Route>
      <Route path="/documents">
        <Gated><Documents /></Gated>
      </Route>
      <Route path="/apps">{() => <Gated><AppsPage /></Gated>}</Route>
      <Route path="/apps/:sourceApp">
        {(params) => {
          const sa = params.sourceApp;
          if (!isSourceApp(sa)) return <NotFound />;
          return <Gated><AppSurfacePage sourceApp={sa} /></Gated>;
        }}
      </Route>
      <Route path="/apps/:sourceApp/:id">
        {(params) => {
          const sa = params.sourceApp;
          const id = params.id;
          if (!isSourceApp(sa) || !id) return <NotFound />;
          return (
            <Gated>
              <ArtifactDetailPage sourceApp={sa} id={id} />
            </Gated>
          );
        }}
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeProvider>
          <AuthProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <AppRouter />
            </WouterRouter>
            <Toaster />
          </AuthProvider>
        </ThemeProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
