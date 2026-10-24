import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { relative } from '../lib/format';
import { useToast } from './ui';
import { Logo, Wordmark } from './Logo';

const ICONS = {
  dashboard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
  ),
  plans: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg>
  ),
  payments: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" /><line x1="1" y1="10" x2="23" y2="10" /></svg>
  ),
  profit: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></svg>
  ),
  reminders: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
  ),
  sync: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
  ),
};

const NAV = [
  { to: '/', label: 'Dashboard', icon: ICONS.dashboard, end: true },
  { to: '/subscribers', label: 'Subscribers', icon: ICONS.users },
  { to: '/plans', label: 'Plans', icon: ICONS.plans },
  { to: '/payments', label: 'Payments', icon: ICONS.payments },
  { to: '/profitability', label: 'Profitability', icon: ICONS.profit },
  { to: '/reminders', label: 'Reminders', icon: ICONS.reminders },
  { to: '/settings', label: 'Settings', icon: ICONS.settings },
];

const TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/subscribers': 'Subscribers',
  '/plans': 'Plans',
  '/payments': 'Payments',
  '/profitability': 'Profitability',
  '/reminders': 'Reminders',
  '/settings': 'Settings',
};

interface SyncStatus {
  running: boolean;
  last_sync_at: string | null;
}

export function SyncButton() {
  const qc = useQueryClient();
  const { push: toast } = useToast();
  const status = useQuery({
    queryKey: ['sync-status'],
    queryFn: () => api.get<SyncStatus>('/api/sync/'),
    refetchInterval: (query) => (query.state.data?.running ? 2000 : 60_000),
  });
  const run = useMutation({
    mutationFn: () => api.post<{ started: boolean }>('/api/sync/'),
    onSuccess: (data) => {
      toast(data.started ? 'Sync started' : 'A sync is already running', 'info');
      qc.invalidateQueries({ queryKey: ['sync-status'] });
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  // When a sync finishes, refresh everything that depends on it.
  const running = status.data?.running ?? false;
  const wasRunning = React.useRef(false);
  React.useEffect(() => {
    if (wasRunning.current && !running) {
      qc.invalidateQueries();
      toast('Sync finished', 'ok');
    }
    wasRunning.current = running;
  }, [running, qc, toast]);

  return (
    <button
      className="btn"
      onClick={() => run.mutate()}
      disabled={running || run.isPending}
      title={status.data?.last_sync_at ? `Last sync ${relative(status.data.last_sync_at)}` : 'Never synced'}
    >
      {running ? <div className="spinner" /> : ICONS.sync}
      {running ? 'Syncing…' : 'Sync now'}
    </button>
  );
}

export function Layout({ username, onLogout, children }: { username: string | null; onLogout: () => void; children: React.ReactNode }) {
  const location = useLocation();
  const base = '/' + (location.pathname.split('/')[1] ?? '');
  const title = location.pathname.startsWith('/subscribers/') ? 'Subscriber' : (TITLES[base] ?? 'Jellyfin Subscriptions');

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">
            <Logo size={36} />
          </div>
          <div>
            <div className="brand-name">
              <Wordmark />
            </div>
            <div className="brand-sub">subscriptions for Jellyfin</div>
          </div>
        </div>
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            {item.icon}
            {item.label}
          </NavLink>
        ))}
        <div className="nav-footer">
          <span>Signed in as {username ?? '—'}</span>
          <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={onLogout}>
            Sign out
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <h1>{title}</h1>
          <div className="topbar-actions">
            <SyncButton />
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
