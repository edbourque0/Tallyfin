import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Logo } from './components/Logo';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, UNAUTHORIZED_EVENT } from './lib/api';
import type { AuthStatus } from './lib/types';
import { Layout } from './components/Layout';
import { ErrorBanner, Spinner } from './components/ui';
import { LoginPage, SetupPage } from './pages/AuthPages';
import { DashboardPage } from './pages/DashboardPage';
import { SubscribersPage } from './pages/SubscribersPage';
import { SubscriberDetailPage } from './pages/SubscriberDetailPage';
import { PlansPage } from './pages/PlansPage';
import { PaymentsPage } from './pages/PaymentsPage';
import { ProfitabilityPage } from './pages/ProfitabilityPage';
import { RemindersPage } from './pages/RemindersPage';
import { SettingsPage } from './pages/SettingsPage';

export default function App() {
  const qc = useQueryClient();
  const auth = useQuery({
    queryKey: ['auth'],
    queryFn: () => api.get<AuthStatus>('/api/auth/status/'),
    staleTime: Infinity,
  });

  useEffect(() => {
    const handler = () => qc.invalidateQueries({ queryKey: ['auth'] });
    window.addEventListener(UNAUTHORIZED_EVENT, handler);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler);
  }, [qc]);

  const logout = useMutation({
    mutationFn: () => api.post('/api/auth/logout/'),
    onSuccess: () => {
      qc.clear();
      qc.invalidateQueries({ queryKey: ['auth'] });
    },
  });

  if (auth.isLoading) return <Spinner label="Loading…" />;
  if (auth.error) {
    return (
      <div className="auth">
        <div className="card stack">
          <div className="row" style={{ gap: 10 }}>
            <Logo size={32} />
            <h2>Tallyfin can't load</h2>
          </div>
          <ErrorBanner error={auth.error} onRetry={() => auth.refetch()} retrying={auth.isFetching} />
        </div>
      </div>
    );
  }

  const status = auth.data!;
  const refresh = () => qc.invalidateQueries({ queryKey: ['auth'] });
  if (status.setup_required) return <SetupPage onDone={refresh} />;
  if (!status.authenticated) return <LoginPage onDone={refresh} />;

  return (
    <Layout username={status.username} onLogout={() => logout.mutate()}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/subscribers" element={<SubscribersPage />} />
        <Route path="/subscribers/:id" element={<SubscriberDetailPage />} />
        <Route path="/plans" element={<PlansPage />} />
        <Route path="/payments" element={<PaymentsPage />} />
        <Route path="/profitability" element={<ProfitabilityPage />} />
        <Route path="/reminders" element={<RemindersPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
