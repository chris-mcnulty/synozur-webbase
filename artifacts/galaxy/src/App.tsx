import * as React from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { ErrorBoundary } from "@/components/error-boundary";
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
import NebulaReportsPage from "@/pages/nebula-reports";
import NebulaReportDetailPage from "@/pages/nebula-report-detail";
import NebulaWorkspacesPage from "@/pages/nebula-workspaces";
import OrionModelsPage from "@/pages/orion-models";
import OrionCoursesPage from "@/pages/orion-courses";
import OrionResultsPage from "@/pages/orion-results";
import ConstellationProjectsPage from "@/pages/constellation-projects";
import ConstellationProjectPage from "@/pages/constellation-project";
import ConstellationInvoicesPage from "@/pages/constellation-invoices";
import { PortalSiteHeader } from "@/components/portal-site-header";
import { PortalSiteFooter } from "@/components/portal-site-footer";
import { Skeleton } from "@/components/ui/skeleton";
import AcceptInvitePage from "@/pages/accept-invite";
import OAuthCallback from "@/pages/oauth-callback";
import {
  PortalSourceApp,
  type PortalSourceApp as PortalSourceAppType,
} from "@workspace/api-client-react";

const BASE = (import.meta.env.BASE_URL as string).replace(/\/$/, "");

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
      <Route path="/reports">
        <Gated><NebulaReportsPage /></Gated>
      </Route>
      <Route path="/reports/:spaceId">
        {(params) => (
          <Gated><NebulaReportDetailPage spaceId={params.spaceId} /></Gated>
        )}
      </Route>
      <Route path="/workspaces">
        <Gated><NebulaWorkspacesPage /></Gated>
      </Route>
      <Route path="/assessments">
        <Gated><OrionModelsPage /></Gated>
      </Route>
      <Route path="/learning">
        <Gated><OrionCoursesPage /></Gated>
      </Route>
      <Route path="/benchmarks">
        <Gated><OrionResultsPage /></Gated>
      </Route>
      <Route path="/projects">
        <Gated><ConstellationProjectsPage /></Gated>
      </Route>
      <Route path="/projects/:id">
        {(params) => (
          <Gated><ConstellationProjectPage id={params.id!} /></Gated>
        )}
      </Route>
      <Route path="/invoices">
        <Gated><ConstellationInvoicesPage /></Gated>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ThemeProvider>
            {/* Fixed galaxy background — sits behind all pages, never remounts on navigation */}
            <div className="fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
              <img
                src={`${BASE}/galaxy-hero.jpg`}
                alt=""
                className="absolute inset-0 w-full h-full object-cover object-center"
              />
              <div className="absolute inset-0 bg-black/30 dark:bg-black/70" />
            </div>
            <AuthProvider>
              <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                <AppRouter />
              </WouterRouter>
              <Toaster />
            </AuthProvider>
          </ThemeProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
