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
import Team from "@/pages/team";
import Partners from "@/pages/partners";
import Insights from "@/pages/insights";
import Polaris from "@/pages/polaris";
import Contact from "@/pages/contact";
import Start from "@/pages/start";
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
        <Route path="/team" component={Team} />
        <Route path="/partners" component={Partners} />
        <Route path="/insights" component={Insights} />
        <Route path="/polaris" component={Polaris} />
        <Route path="/contact" component={Contact} />
        <Route path="/start" component={Start} />
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
