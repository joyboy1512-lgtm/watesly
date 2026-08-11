import { Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";
import AppLayout from "./components/AppLayout";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import InboxPage from "./pages/InboxPage";
import KnowledgePage from "./pages/KnowledgePage";
import TeamPage from "./pages/TeamPage";
import OrganizationsPage from "./pages/OrganizationsPage";
import ChannelsPage from "./pages/ChannelsPage";
import ChannelMacDetailPage from "./pages/ChannelMacDetailPage";
import TemplatesPage from "./pages/TemplatesPage";
import CampaignsPage from "./pages/CampaignsPage";
import ContactsPage from "./pages/ContactsPage";
import ContactCreatePage from "./pages/ContactCreatePage";
import ContactImportPage from "./pages/ContactImportPage";
import ContactDetailPage from "./pages/ContactDetailPage";
import QuickRepliesPage from "./pages/QuickRepliesPage";
import CrmPage from "./pages/CrmPage";
import DealCreatePage from "./pages/DealCreatePage";
import DealDetailPage from "./pages/DealDetailPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import ReportsPage from "./pages/ReportsPage";
import DeveloperPage from "./pages/DeveloperPage";
import CatalogPage from "./pages/CatalogPage";
import CatalogCreatePage from "./pages/CatalogCreatePage";
import CatalogGroupEditPage from "./pages/CatalogGroupEditPage";
import CatalogCategoryCreatePage from "./pages/CatalogCategoryCreatePage";
import CatalogOrdersPage from "./pages/CatalogOrdersPage";
import CatalogOrderDetailPage from "./pages/CatalogOrderDetailPage";
import WhatsAppConnectPage from "./pages/WhatsAppConnectPage";
import SuperAdminPage from "./pages/SuperAdminPage";
import SiteContentPage from "./pages/SiteContentPage";
import AssignmentsPage from "./pages/AssignmentsPage";
import AutomationsPage from "./pages/AutomationsPage";
import TrustCenterPage from "./pages/TrustCenterPage";
import CoreHealthPage from "./pages/CoreHealthPage";
import LandingPage from "./pages/LandingPage";
import RegisterPage from "./pages/RegisterPage";
import AcceptInvitationPage from "./pages/AcceptInvitationPage";
import LegalPage from "./pages/LegalPage";
import PricingPage from "./pages/PricingPage";
import BillingPage from "./pages/BillingPage";
import { useAuth } from "./hooks/useAuth";

function FallbackRedirect() {
  const { accessToken } = useAuth();
  return <Navigate to={accessToken ? "/dashboard" : "/"} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/invite" element={<AcceptInvitationPage />} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/privacy" element={<LegalPage kind="privacy" />} />
      <Route path="/terms" element={<LegalPage kind="terms" />} />
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/contacts" element={<ContactsPage />} />
        <Route path="/contacts/new" element={<ContactCreatePage />} />
        <Route path="/contacts/import" element={<ContactImportPage />} />
        <Route path="/contacts/:id" element={<ContactDetailPage />} />
        <Route path="/quick-replies" element={<QuickRepliesPage />} />
        <Route path="/crm" element={<CrmPage />} />
        <Route path="/crm/new" element={<DealCreatePage />} />
        <Route path="/crm/:id" element={<DealDetailPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/developer" element={<DeveloperPage />} />
        <Route path="/catalog" element={<CatalogPage />} />
        <Route path="/catalog/new" element={<CatalogCreatePage />} />
        <Route path="/catalog/group/:groupKey/edit" element={<CatalogGroupEditPage />} />
        <Route path="/catalog/category/new" element={<CatalogCategoryCreatePage />} />
        <Route path="/catalog/orders" element={<CatalogOrdersPage />} />
        <Route path="/catalog/orders/:id" element={<CatalogOrderDetailPage />} />
        <Route path="/team" element={<TeamPage />} />
        <Route path="/assignments" element={<AssignmentsPage />} />
        <Route path="/organizations" element={<OrganizationsPage />} />
        <Route path="/channels" element={<ChannelsPage />} />
        <Route path="/channels/:channelId/mac" element={<ChannelMacDetailPage />} />
        <Route path="/billing" element={<BillingPage />} />
        <Route path="/templates" element={<TemplatesPage />} />
        <Route path="/campaigns" element={<CampaignsPage />} />
        <Route path="/automations" element={<AutomationsPage />} />
        <Route path="/trust-center" element={<TrustCenterPage />} />
        <Route path="/core-health" element={<CoreHealthPage />} />
        <Route path="/whatsapp-connect" element={<WhatsAppConnectPage />} />
        <Route path="/admin" element={<SuperAdminPage />} />
        <Route path="/admin/site-content" element={<SiteContentPage />} />
      </Route>
      <Route path="*" element={<FallbackRedirect />} />
    </Routes>
  );
}
