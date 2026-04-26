import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import { ThemeProvider } from "@/context/theme";
import { captureAttributionOnLoad } from "@/lib/attribution";

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
import Models from "@/pages/models";
import ModelDetail from "@/pages/model-detail";
import Workshops from "@/pages/workshops";
import WorkshopDetail from "@/pages/workshop-detail";
import Team from "@/pages/team";
import TeamDetail from "@/pages/team-detail";
import Partners from "@/pages/partners";
import Insights from "@/pages/insights";
import InsightDetail from "@/pages/insight-detail";
import Polaris from "@/pages/polaris";
import Contact from "@/pages/contact";
import Start from "@/pages/start";
import Events from "@/pages/events";
import EventDetail from "@/pages/event-detail";
import Privacy from "@/pages/privacy";
import Terms from "@/pages/terms";
import SignInPage from "@/pages/sign-in";
import SignUpPage from "@/pages/sign-up";
import VerifyEmailPage from "@/pages/verify-email";
import ForgotPasswordPage from "@/pages/forgot-password";
import ResetPasswordPage from "@/pages/reset-password";
import AdminDashboard from "@/pages/admin/dashboard";
import AdminPostsList from "@/pages/admin/insights/posts-list";
import PostEditor from "@/pages/admin/insights/post-editor";
import PostPreview from "@/pages/admin/insights/post-preview";
import PostAnalytics from "@/pages/admin/insights/post-analytics";
import TaxonomyPage from "@/pages/admin/insights/taxonomy";
import CommentsModeration from "@/pages/admin/insights/comments";
import UsersAndRoles from "@/pages/admin/access/users";
import EntraMappingsPage from "@/pages/admin/access/entra";
import OrganizationsPage from "@/pages/admin/access/organizations";
import SecurityLogPage from "@/pages/admin/access/security-log";
import HubspotAdminPage from "@/pages/admin/marketing/hubspot";
import AdminServicesList from "@/pages/admin/products/services-list";
import ServiceEdit from "@/pages/admin/products/service-edit";
import ServiceMethodologiesPage from "@/pages/admin/products/service-methodologies";
import AdminSolutionsList from "@/pages/admin/products/solutions-list";
import SolutionEdit from "@/pages/admin/products/solution-edit";
import SolutionCapabilitiesPage from "@/pages/admin/products/solution-capabilities";
import AdminTeamList from "@/pages/admin/people/team-list";
import TeamForm from "@/pages/admin/people/team-form";
import AdminEventsList from "@/pages/admin/people/events-list";
import EventForm from "@/pages/admin/people/event-form";
import AssetsLibrary from "@/pages/admin/library/assets";
import AdminCollateralList from "@/pages/admin/library/collateral-list";
import CollateralEdit from "@/pages/admin/library/collateral-edit";
import AdminCollateralAudit from "@/pages/admin/library/audit";
import AdminCarouselPage from "@/pages/admin/library/carousel";
import AdminVideosList from "@/pages/admin/library/videos-list";
import VideoEdit from "@/pages/admin/library/video-edit";
import AdminWhitePapersList from "@/pages/admin/library/white-papers-list";
import WhitePaperEdit from "@/pages/admin/library/white-paper-edit";
import AdminWixRedirects from "@/pages/admin/site-config/redirects";
import AdminWorkshopsList from "@/pages/admin/library/workshops-list";
import WorkshopEdit from "@/pages/admin/library/workshop-edit";
import AdminPolarisEpisodesList from "@/pages/admin/library/polaris-episodes-list";
import PolarisEpisodeEdit from "@/pages/admin/library/polaris-episode-edit";
import AdminCaseStudiesList from "@/pages/admin/products/case-studies-list";
import AdminApplicationsList from "@/pages/admin/products/applications-list";
import ApplicationEdit from "@/pages/admin/products/application-edit";
import AdminModelsList from "@/pages/admin/products/models-list";
import AdminModelEdit from "@/pages/admin/products/model-edit";
import AdminFaq from "@/pages/admin/products/faq";
import AdminListPageCopy from "@/pages/admin/site-config/list-page-copy";
import AdminSiteSettings from "@/pages/admin/site-config/site-settings";
import AdminActiveSessions from "@/pages/admin/account/sessions";
import AdminSubmissionsList from "@/pages/admin/audience/submissions";
import MarketingTraffic from "@/pages/admin/marketing/traffic";
import MarketingSeo from "@/pages/admin/marketing/seo";
import MarketingSeoAudit from "@/pages/admin/marketing/seo-audit";
import { AdminGate } from "@/components/admin/AdminGate";
import { IdleWarningDialog } from "@/components/idle-warning-dialog";
import Library from "@/pages/library";
import LibraryDetail from "@/pages/library-detail";
import Webinars from "@/pages/webinars";
import WebinarDetail from "@/pages/webinar-detail";
import Videos from "@/pages/videos";
import VideoDetail from "@/pages/video-detail";
import WhitePapers from "@/pages/white-papers";
import WhitePaperDetail from "@/pages/white-paper-detail";
import Items from "@/pages/items";
import ItemDetail from "@/pages/item-detail";
import Faq from "@/pages/faq";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function AdminRoutes() {
  return (
    <AdminGate>
      <Switch>
        <Route path="/" component={AdminDashboard} />

        {/* Insights section */}
        <Route path="/insights/posts" component={AdminPostsList} />
        <Route path="/insights/posts/new">
          <PostEditor />
        </Route>
        <Route path="/insights/posts/:id/edit">
          {(params) => <PostEditor id={params.id} />}
        </Route>
        <Route path="/insights/posts/:id/preview">
          {(params) => <PostPreview id={params.id} />}
        </Route>
        <Route path="/insights/posts/:id/analytics">
          {(params) => <PostAnalytics id={params.id} />}
        </Route>
        <Route path="/insights/media"><Redirect to="/library/assets" /></Route>
        <Route path="/insights/taxonomy" component={TaxonomyPage} />
        <Route path="/insights/comments" component={CommentsModeration} />

        {/* Redirects from pre-reorg flat paths */}
        <Route path="/posts"><Redirect to="/insights/posts" /></Route>
        <Route path="/posts/new"><Redirect to="/insights/posts/new" /></Route>
        <Route path="/posts/:id/edit">
          {(params) => <Redirect to={`/insights/posts/${params.id}/edit`} />}
        </Route>
        <Route path="/posts/:id/preview">
          {(params) => <Redirect to={`/insights/posts/${params.id}/preview`} />}
        </Route>
        <Route path="/posts/:id/analytics">
          {(params) => <Redirect to={`/insights/posts/${params.id}/analytics`} />}
        </Route>
        <Route path="/media"><Redirect to="/library/assets" /></Route>
        <Route path="/taxonomy"><Redirect to="/insights/taxonomy" /></Route>
        <Route path="/comments"><Redirect to="/insights/comments" /></Route>

        {/* Products section */}
        <Route path="/products/services" component={AdminServicesList} />
        <Route path="/products/services/new">
          <ServiceEdit />
        </Route>
        <Route path="/products/services/:id/edit">
          {(params) => <ServiceEdit id={params.id} />}
        </Route>
        <Route path="/products/services/:id/methodologies">
          {(params) => <ServiceMethodologiesPage id={params.id} />}
        </Route>
        <Route path="/products/solutions" component={AdminSolutionsList} />
        <Route path="/products/solutions/new">
          <SolutionEdit />
        </Route>
        <Route path="/products/solutions/:id/edit">
          {(params) => <SolutionEdit id={params.id} />}
        </Route>
        <Route path="/products/solutions/:id/capabilities">
          {(params) => <SolutionCapabilitiesPage id={params.id} />}
        </Route>
        <Route path="/products/case-studies" component={AdminCaseStudiesList} />
        <Route path="/products/applications" component={AdminApplicationsList} />
        <Route path="/products/models" component={AdminModelsList} />
        <Route path="/products/models/new">
          <AdminModelEdit />
        </Route>
        <Route path="/products/models/:id/edit">
          {(params) => <AdminModelEdit id={params.id} />}
        </Route>
        <Route path="/products/faq" component={AdminFaq} />

        {/* Products redirects */}
        <Route path="/services"><Redirect to="/products/services" /></Route>
        <Route path="/services/new"><Redirect to="/products/services/new" /></Route>
        <Route path="/services/:id/edit">
          {(params) => <Redirect to={`/products/services/${params.id}/edit`} />}
        </Route>
        <Route path="/services/:id/methodologies">
          {(params) => <Redirect to={`/products/services/${params.id}/methodologies`} />}
        </Route>
        <Route path="/solutions"><Redirect to="/products/solutions" /></Route>
        <Route path="/solutions/new"><Redirect to="/products/solutions/new" /></Route>
        <Route path="/solutions/:id/edit">
          {(params) => <Redirect to={`/products/solutions/${params.id}/edit`} />}
        </Route>
        <Route path="/solutions/:id/capabilities">
          {(params) => <Redirect to={`/products/solutions/${params.id}/capabilities`} />}
        </Route>
        <Route path="/case-studies"><Redirect to="/products/case-studies" /></Route>
        <Route path="/applications"><Redirect to="/products/applications" /></Route>
        <Route path="/models"><Redirect to="/products/models" /></Route>
        <Route path="/faq"><Redirect to="/products/faq" /></Route>

        {/* Library section */}
        <Route path="/library/assets" component={AssetsLibrary} />
        <Route path="/library/collateral" component={AdminCollateralList} />
        <Route path="/library/collateral/new">
          <CollateralEdit />
        </Route>
        <Route path="/library/collateral/:id/edit">
          {(params) => <CollateralEdit id={params.id} />}
        </Route>
        <Route path="/library/audit" component={AdminCollateralAudit} />
        <Route path="/library/carousel" component={AdminCarouselPage} />
        <Route path="/library/videos" component={AdminVideosList} />
        <Route path="/library/videos/new">
          <VideoEdit />
        </Route>
        <Route path="/library/videos/:id/edit">
          {(params) => <VideoEdit id={params.id} />}
        </Route>
        <Route path="/library/white-papers" component={AdminWhitePapersList} />
        <Route path="/library/white-papers/new">
          <WhitePaperEdit />
        </Route>
        <Route path="/library/white-papers/:id/edit">
          {(params) => <WhitePaperEdit id={params.id} />}
        </Route>
        <Route path="/library/workshops" component={AdminWorkshopsList} />
        <Route path="/library/workshops/new">
          <WorkshopEdit />
        </Route>
        <Route path="/library/workshops/:id/edit">
          {(params) => <WorkshopEdit id={params.id} />}
        </Route>
        <Route path="/library/polaris-episodes" component={AdminPolarisEpisodesList} />
        <Route path="/library/polaris-episodes/new">
          <PolarisEpisodeEdit />
        </Route>
        <Route path="/library/polaris-episodes/:id/edit">
          {(params) => <PolarisEpisodeEdit id={params.id} />}
        </Route>
        <Route path="/case-studies" component={AdminCaseStudiesList} />
        <Route path="/applications" component={AdminApplicationsList} />
        <Route path="/applications/new">
          <ApplicationEdit />
        </Route>
        <Route path="/applications/:id/edit">
          {(params) => <ApplicationEdit id={params.id} />}
        </Route>
        <Route path="/models" component={AdminModelsList} />
        <Route path="/faq" component={AdminFaq} />
        <Route path="/list-page-copy" component={AdminListPageCopy} />
        <Route path="/traffic"><Redirect to="/marketing/traffic" /></Route>

        {/* Library redirects */}
        <Route path="/collateral"><Redirect to="/library/collateral" /></Route>
        <Route path="/collateral/new"><Redirect to="/library/collateral/new" /></Route>
        <Route path="/collateral/:id/edit">
          {(params) => <Redirect to={`/library/collateral/${params.id}/edit`} />}
        </Route>
        <Route path="/videos"><Redirect to="/library/videos" /></Route>
        <Route path="/videos/new"><Redirect to="/library/videos/new" /></Route>
        <Route path="/videos/:id/edit">
          {(params) => <Redirect to={`/library/videos/${params.id}/edit`} />}
        </Route>
        <Route path="/white-papers"><Redirect to="/library/white-papers" /></Route>
        <Route path="/white-papers/new"><Redirect to="/library/white-papers/new" /></Route>
        <Route path="/white-papers/:id/edit">
          {(params) => <Redirect to={`/library/white-papers/${params.id}/edit`} />}
        </Route>
        <Route path="/workshops"><Redirect to="/library/workshops" /></Route>
        <Route path="/workshops/new"><Redirect to="/library/workshops/new" /></Route>
        <Route path="/workshops/:id/edit">
          {(params) => <Redirect to={`/library/workshops/${params.id}/edit`} />}
        </Route>
        <Route path="/polaris-episodes"><Redirect to="/library/polaris-episodes" /></Route>
        <Route path="/polaris-episodes/new"><Redirect to="/library/polaris-episodes/new" /></Route>
        <Route path="/polaris-episodes/:id/edit">
          {(params) => <Redirect to={`/library/polaris-episodes/${params.id}/edit`} />}
        </Route>

        {/* People section */}
        <Route path="/people/team-members" component={AdminTeamList} />
        <Route path="/people/team-members/new">
          <TeamForm />
        </Route>
        <Route path="/people/team-members/:id">
          {(params) => <TeamForm id={params.id} />}
        </Route>
        <Route path="/people/events" component={AdminEventsList} />
        <Route path="/people/events/new">
          <EventForm />
        </Route>
        <Route path="/people/events/:id">
          {(params) => <EventForm id={params.id} />}
        </Route>

        {/* People redirects */}
        <Route path="/team-members"><Redirect to="/people/team-members" /></Route>
        <Route path="/team-members/new"><Redirect to="/people/team-members/new" /></Route>
        <Route path="/team-members/:id">
          {(params) => <Redirect to={`/people/team-members/${params.id}`} />}
        </Route>
        <Route path="/events"><Redirect to="/people/events" /></Route>
        <Route path="/events/new"><Redirect to="/people/events/new" /></Route>
        <Route path="/events/:id">
          {(params) => <Redirect to={`/people/events/${params.id}`} />}
        </Route>

        {/* Audience section */}
        <Route path="/audience/submissions" component={AdminSubmissionsList} />
        <Route path="/submissions"><Redirect to="/audience/submissions" /></Route>

        {/* Site config section */}
        <Route path="/site-config/site-settings" component={AdminSiteSettings} />
        <Route path="/site-config/list-page-copy" component={AdminListPageCopy} />
        <Route path="/site-config/redirects" component={AdminWixRedirects} />
        <Route path="/site-settings"><Redirect to="/site-config/site-settings" /></Route>
        <Route path="/list-page-copy"><Redirect to="/site-config/list-page-copy" /></Route>
        <Route path="/wix-redirects"><Redirect to="/site-config/redirects" /></Route>

        {/* Marketing section */}
        <Route path="/marketing/traffic" component={MarketingTraffic} />
        <Route path="/marketing/seo" component={MarketingSeo} />
        <Route path="/marketing/seo-audit" component={MarketingSeoAudit} />

        {/* Access section */}
        <Route path="/access/users" component={UsersAndRoles} />
        <Route path="/access/entra" component={EntraMappingsPage} />
        <Route path="/access/organizations" component={OrganizationsPage} />
        <Route path="/access/security-log" component={SecurityLogPage} />
        <Route path="/users"><Redirect to="/access/users" /></Route>

        {/* Marketing integrations */}
        <Route path="/integrations/hubspot" component={HubspotAdminPage} />

        {/* Account section */}
        <Route path="/account/sessions" component={AdminActiveSessions} />

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
            <Route path="/models" component={Models} />
            <Route path="/models/:slug" component={ModelDetail} />
            <Route path="/workshops" component={Workshops} />
            <Route path="/workshops/:slug" component={WorkshopDetail} />
            <Route path="/library" component={Library} />
            <Route path="/library/:slug" component={LibraryDetail} />
            <Route path="/webinars" component={Webinars} />
            <Route path="/webinars/:slug" component={WebinarDetail} />
            <Route path="/videos" component={Videos} />
            <Route path="/videos/:slug" component={VideoDetail} />
            <Route path="/white-papers" component={WhitePapers} />
            <Route path="/white-papers/:slug" component={WhitePaperDetail} />
            <Route path="/items" component={Items} />
            <Route path="/items/:slug" component={ItemDetail} />
            <Route path="/faq" component={Faq} />
            <Route path="/team" component={Team} />
            <Route path="/team/:slug" component={TeamDetail} />
            <Route path="/partners" component={Partners} />
            <Route path="/insights" component={Insights} />
            <Route path="/insights/:slug" component={InsightDetail} />
            <Route path="/polaris" component={Polaris} />
            <Route path="/contact" component={Contact} />
            <Route path="/start" component={Start} />
            <Route path="/events" component={Events} />
            <Route path="/events/:slug" component={EventDetail} />
            <Route path="/privacy" component={Privacy} />
            <Route path="/terms" component={Terms} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            <Route path="/verify-email" component={VerifyEmailPage} />
            <Route path="/forgot-password" component={ForgotPasswordPage} />
            <Route path="/reset-password" component={ResetPasswordPage} />
            <Route component={NotFound} />
          </Switch>
        </Layout>
      </Route>
    </Switch>
  );
}

function App() {
  useEffect(() => {
    captureAttributionOnLoad();
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
          <IdleWarningDialog />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
