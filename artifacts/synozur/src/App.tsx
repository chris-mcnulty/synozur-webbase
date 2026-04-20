import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";

import Home from "@/pages/home";
import About from "@/pages/about";
import ServicesOverview from "@/pages/services-overview";
import ServiceDetail from "@/pages/service-detail";
import Clients from "@/pages/clients";
import CaseStudies from "@/pages/case-studies";
import CaseStudyDetail from "@/pages/case-study-detail";
import Applications from "@/pages/applications";
import ApplicationDetail from "@/pages/application-detail";
import Team from "@/pages/team";
import Partners from "@/pages/partners";
import Insights from "@/pages/insights";
import Polaris from "@/pages/polaris";
import Contact from "@/pages/contact";
import Start from "@/pages/start";
import Events from "@/pages/events";
import Privacy from "@/pages/privacy";
import Terms from "@/pages/terms";
import SignInPage from "@/pages/sign-in";
import SignUpPage from "@/pages/sign-up";
import AdminEventsList from "@/pages/admin";
import EventForm from "@/pages/admin/event-form";
import { AdminGate } from "@/components/admin/AdminGate";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/about" component={About} />
        <Route path="/services-overview/default" component={ServicesOverview} />
        <Route path="/services-overview/:slug" component={ServicesOverview} />
        <Route path="/services/:slug" component={ServiceDetail} />
        <Route path="/clients" component={Clients} />
        <Route path="/case-studies" component={CaseStudies} />
        <Route path="/case-studies/:slug" component={CaseStudyDetail} />
        <Route path="/applications" component={Applications} />
        <Route path="/applications/:slug" component={ApplicationDetail} />
        <Route path="/team" component={Team} />
        <Route path="/partners" component={Partners} />
        <Route path="/insights" component={Insights} />
        <Route path="/polaris" component={Polaris} />
        <Route path="/contact" component={Contact} />
        <Route path="/start" component={Start} />
        <Route path="/events" component={Events} />
        <Route path="/privacy" component={Privacy} />
        <Route path="/terms" component={Terms} />
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/sign-up/*?" component={SignUpPage} />
        <Route path="/admin">
          <AdminGate>
            <AdminEventsList />
          </AdminGate>
        </Route>
        <Route path="/admin/events/new">
          <AdminGate>
            <EventForm />
          </AdminGate>
        </Route>
        <Route path="/admin/events/:id">
          {(params) => (
            <AdminGate>
              <EventForm id={params.id} />
            </AdminGate>
          )}
        </Route>
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
