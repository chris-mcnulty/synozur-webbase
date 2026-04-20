import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";

import Home from "@/pages/home";
import About from "@/pages/about";
import ServicesOverview from "@/pages/services-overview";
import ServiceDetail from "@/pages/service-detail";
import SolutionDetail from "@/pages/solution-detail";
import Clients from "@/pages/clients";
import CaseStudies from "@/pages/case-studies";
import CaseStudyDetail from "@/pages/case-study-detail";
import Applications from "@/pages/applications";
import ApplicationDetail from "@/pages/application-detail";
import Workshops from "@/pages/workshops";
import WorkshopDetail from "@/pages/workshop-detail";
import Team from "@/pages/team";
import Partners from "@/pages/partners";
import Insights from "@/pages/insights";
import InsightDetail from "@/pages/insight-detail";
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
import AdminSubmissionsList from "@/pages/admin/submissions";
import AdminSiteSettings from "@/pages/admin/site-settings";
import AdminDashboard from "@/pages/admin/dashboard";
import AdminPostsList from "@/pages/admin/posts-list";
import PostEditor from "@/pages/admin/post-editor";
import PostPreview from "@/pages/admin/post-preview";
import PostAnalytics from "@/pages/admin/post-analytics";
import MediaLibrary from "@/pages/admin/media";
import TaxonomyPage from "@/pages/admin/taxonomy";
import CommentsModeration from "@/pages/admin/comments";
import UsersAndRoles from "@/pages/admin/users";
import AdminServicesList from "@/pages/admin/services-list";
import ServiceEdit from "@/pages/admin/service-edit";
import ServiceMethodologiesPage from "@/pages/admin/service-methodologies";
import AdminSolutionsList from "@/pages/admin/solutions-list";
import SolutionEdit from "@/pages/admin/solution-edit";
import SolutionCapabilitiesPage from "@/pages/admin/solution-capabilities";
import AdminTeamList from "@/pages/admin/team-list";
import TeamForm from "@/pages/admin/team-form";
import AdminCollateralList from "@/pages/admin/collateral-list";
import CollateralEdit from "@/pages/admin/collateral-edit";
import { AdminGate } from "@/components/admin/AdminGate";
import Library from "@/pages/library";
import LibraryDetail from "@/pages/library-detail";
import Webinars from "@/pages/webinars";
import WebinarDetail from "@/pages/webinar-detail";
import Items from "@/pages/items";
import ItemDetail from "@/pages/item-detail";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function AdminRoutes() {
  return (
    <AdminGate>
      <Switch>
        <Route path="/" component={AdminDashboard} />
        <Route path="/posts" component={AdminPostsList} />
        <Route path="/posts/new">
          <PostEditor />
        </Route>
        <Route path="/posts/:id/edit">
          {(params) => <PostEditor id={params.id} />}
        </Route>
        <Route path="/posts/:id/preview">
          {(params) => <PostPreview id={params.id} />}
        </Route>
        <Route path="/posts/:id/analytics">
          {(params) => <PostAnalytics id={params.id} />}
        </Route>
        <Route path="/media" component={MediaLibrary} />
        <Route path="/taxonomy" component={TaxonomyPage} />
        <Route path="/comments" component={CommentsModeration} />
        <Route path="/users" component={UsersAndRoles} />
        <Route path="/services" component={AdminServicesList} />
        <Route path="/services/new">
          <ServiceEdit />
        </Route>
        <Route path="/services/:id/edit">
          {(params) => <ServiceEdit id={params.id} />}
        </Route>
        <Route path="/services/:id/methodologies">
          {(params) => <ServiceMethodologiesPage id={params.id} />}
        </Route>
        <Route path="/solutions" component={AdminSolutionsList} />
        <Route path="/solutions/new">
          <SolutionEdit />
        </Route>
        <Route path="/solutions/:id/edit">
          {(params) => <SolutionEdit id={params.id} />}
        </Route>
        <Route path="/solutions/:id/capabilities">
          {(params) => <SolutionCapabilitiesPage id={params.id} />}
        </Route>
        <Route path="/collateral" component={AdminCollateralList} />
        <Route path="/collateral/new">
          <CollateralEdit />
        </Route>
        <Route path="/collateral/:id/edit">
          {(params) => <CollateralEdit id={params.id} />}
        </Route>
        <Route path="/site-settings" component={AdminSiteSettings} />
        <Route path="/events" component={AdminEventsList} />
        <Route path="/submissions" component={AdminSubmissionsList} />
        <Route path="/events/new">
          <EventForm />
        </Route>
        <Route path="/events/:id">
          {(params) => <EventForm id={params.id} />}
        </Route>
        <Route path="/team-members" component={AdminTeamList} />
        <Route path="/team-members/new">
          <TeamForm />
        </Route>
        <Route path="/team-members/:id">
          {(params) => <TeamForm id={params.id} />}
        </Route>
        <Route component={NotFound} />
      </Switch>
    </AdminGate>
  );
}

function Router() {
  return (
    <Switch>
      {/* Admin routes render outside the marketing site Layout. */}
      <Route path="/admin" nest>
        <AdminRoutes />
      </Route>
      <Route>
        <Layout>
          <Switch>
            <Route path="/" component={Home} />
            <Route path="/about" component={About} />
            <Route path="/services-overview/default" component={ServicesOverview} />
            <Route path="/services-overview/:slug" component={ServicesOverview} />
            <Route path="/services/:slug" component={ServiceDetail} />
            <Route path="/solutions/:slug" component={SolutionDetail} />
            <Route path="/clients" component={Clients} />
            <Route path="/case-studies" component={CaseStudies} />
            <Route path="/case-studies/:slug" component={CaseStudyDetail} />
            <Route path="/applications" component={Applications} />
            <Route path="/applications/:slug" component={ApplicationDetail} />
            <Route path="/workshops" component={Workshops} />
            <Route path="/workshops/:slug" component={WorkshopDetail} />
            <Route path="/library" component={Library} />
            <Route path="/library/:slug" component={LibraryDetail} />
            <Route path="/webinars" component={Webinars} />
            <Route path="/webinars/:slug" component={WebinarDetail} />
            <Route path="/items" component={Items} />
            <Route path="/items/:slug" component={ItemDetail} />
            <Route path="/team" component={Team} />
            <Route path="/partners" component={Partners} />
            <Route path="/insights" component={Insights} />
            <Route path="/insights/:slug" component={InsightDetail} />
            <Route path="/polaris" component={Polaris} />
            <Route path="/contact" component={Contact} />
            <Route path="/start" component={Start} />
            <Route path="/events" component={Events} />
            <Route path="/privacy" component={Privacy} />
            <Route path="/terms" component={Terms} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            <Route component={NotFound} />
          </Switch>
        </Layout>
      </Route>
    </Switch>
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
