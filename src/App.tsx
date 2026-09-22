import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RequirePermission } from '@/components/common/AdminOnly';
import { Navigate, Route, BrowserRouter as Router, Routes, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AppShell } from '@/components/layout/AppShell';
import { ThemeProvider, useTheme } from '@/hooks/useTheme';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { SessionProvider } from '@/hooks/useSession';

import LoginPage from '@/routes/Login';
import AcceptInvitePage from '@/routes/AcceptInvite';
import OverviewPage from '@/routes/Overview';
import SimsPage from '@/routes/Sims';
import SimDetailPage from '@/routes/SimDetail';
import AgentsPage from '@/routes/Agents';
import AgentDetailPage from '@/routes/AgentDetail';
import AccountsPage from '@/routes/Accounts';
import AccountDetailPage from '@/routes/AccountDetail';
import DomainsPage from '@/routes/Domains';
import GrowthPage from '@/routes/Growth';
import PakistanCompetitorsPage from '@/routes/PakistanCompetitors';
import ReservesPage from '@/routes/Reserves';
import AssignmentsPage from '@/routes/Assignments';
import CredentialsPage from '@/routes/Credentials';
import BrandsPage from '@/routes/Brands';
import BrandDetailPage from '@/routes/BrandDetail';
import ReportsPage from '@/routes/Reports';
import TeamReportsPage from '@/routes/TeamReports';
import AdsMonitoringPage from '@/routes/AdsMonitoring';
import AdsCampaignDetailPage from '@/routes/AdsCampaignDetail';
import SharedSpielPage from '@/routes/SharedSpiel';
import ImportPage from '@/routes/Import';
import AuditPage from '@/routes/Audit';
import NotFoundPage from '@/routes/NotFound';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

/** Keeps unauthenticated people out of the workspace once there is a real
 *  session to check. While the mock API is serving, `status` is `disabled` and
 *  this lets everything through, exactly as before. */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'disabled') return <>{children}</>;
  if (status === 'loading') {
    return (
      <div className="grid min-h-dvh place-items-center bg-background">
        <p className="text-[13px] text-muted-foreground">Checking your session…</p>
      </div>
    );
  }
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}

function AppToaster() {
  const { resolved } = useTheme();
  return <Toaster theme={resolved} position="bottom-right" closeButton richColors />;
}

export function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <Router>
          <AuthProvider>
            <SessionProvider>
              <Routes>
                {/* Outside the shell: reachable without a session. */}
                <Route path="/login" element={<LoginPage />} />
                <Route path="/accept-invite" element={<AcceptInvitePage />} />

                <Route element={<RequireAuth><AppShell /></RequireAuth>}>
                  <Route index element={<OverviewPage />} />
                  <Route path="sims" element={<SimsPage />} />
                  <Route path="sims/:id" element={<SimDetailPage />} />
                  <Route path="agents" element={<AgentsPage />} />
                  <Route path="agents/:id" element={<AgentDetailPage />} />
                  <Route path="accounts" element={<AccountsPage />} />
                  <Route path="accounts/:id" element={<AccountDetailPage />} />
                  <Route path="domains" element={<RequirePermission permission="access:domains"><DomainsPage /></RequirePermission>} />
                  <Route path="growth" element={<GrowthPage />} />
                  <Route path="pakistan-competitors" element={<PakistanCompetitorsPage />} />
                  <Route path="ads-monitoring" element={<AdsMonitoringPage />} />
                  <Route path="ads-monitoring/:campaignId" element={<AdsCampaignDetailPage />} />
                  <Route path="reserves" element={<ReservesPage />} />
                  <Route path="assignments" element={<AssignmentsPage />} />
                  <Route path="credentials" element={<RequirePermission permission="access:credential-refs"><CredentialsPage /></RequirePermission>} />
                  <Route path="brands" element={<BrandsPage />} />
                  <Route path="brands/:id" element={<BrandDetailPage />} />
                  <Route path="reports" element={<ReportsPage />} />
                  <Route path="team-reports" element={<TeamReportsPage />} />
                  <Route path="shared-spiel" element={<SharedSpielPage />} />
                  <Route path="import" element={<RequirePermission permission="access:import"><ImportPage /></RequirePermission>} />
                  <Route path="audit" element={<RequirePermission permission="access:roles-audit"><AuditPage /></RequirePermission>} />
                  <Route path="404" element={<NotFoundPage />} />
                  <Route path="*" element={<Navigate to="/404" replace />} />
                </Route>
              </Routes>
              <AppToaster />
            </SessionProvider>
          </AuthProvider>
        </Router>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
