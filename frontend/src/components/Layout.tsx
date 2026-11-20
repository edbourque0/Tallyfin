import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { relative } from '../lib/format';
import type { Connections } from '../lib/types';
import { useToast } from './ui';
import { Logo, Wordmark } from './Logo';
import { Avatar } from './ui';
import { useTheme } from '../lib/theme';

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
  sun: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></svg>
  ),
  moon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></svg>
  ),
  logout: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
  ),
  more: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="5" cy="12" r="1.25" /><circle cx="12" cy="12" r="1.25" /><circle cx="19" cy="12" r="1.25" /></svg>
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
  { to: '/reminders', label: 'Reminders & access', icon: ICONS.reminders },
  { to: '/settings', label: 'Settings', icon: ICONS.settings },
];

/** Phone/tablet bottom bar: the four places Ed goes most, then "More" for the rest. */
const TAB_PATHS = ['/', '/subscribers', '/payments', '/reminders'];
const TABS = NAV.filter((n) => TAB_PATHS.includes(n.to)).map((n) => ({
  ...n,
  short: n.to === '/' ? 'Home' : n.to === '/reminders' ? 'Reminders' : n.label,
}));
const MORE = NAV.filter((n) => !TAB_PATHS.includes(n.to));

const TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/subscribers': 'Subscribers',
  '/plans': 'Plans',
  '/payments': 'Payments',
  '/profitability': 'Profitability',
  '/reminders': 'Reminders & access',
  '/settings': 'Settings',
};

interface SyncStatus {
  running: boolean;
  last_sync_at: string | null;
  connections: Connections;
}

const SERVICE_NAMES: Record<string, string> = { jellyfin: 'Jellyfin', tracearr: 'Tracearr', seerr: 'Seerr' };

export function SyncButton() {
  const qc = useQueryClient();
  const { push: toast } = useToast();
  const status = useQuery({
    queryKey: ['sync-status'],
    queryFn: () => api.get<SyncStatus>('/api/sync/'),
    refetchInterval: (query) => (query.state.data?.running ? 2000 : 60_000),
  });
  // The sync we started and are waiting on: identified by the last_sync_at it should replace.
  const awaiting = React.useRef<{ since: string | null } | null>(null);
  const run = useMutation({
    mutationFn: () => api.post<{ started: boolean }>('/api/sync/'),
    onMutate: () => {
      awaiting.current = { since: status.data?.last_sync_at ?? null };
    },
    onSuccess: (data) => {
      if (!data.started) {
        toast('A sync is already running.', 'info');
        awaiting.current = null;
      }
      qc.invalidateQueries({ queryKey: ['sync-status'] });
    },
    onError: (err: Error) => {
      awaiting.current = null;
      toast(err.message, 'error');
    },
  });

  const running = status.data?.running ?? false;
  const failing = Object.entries(status.data?.connections ?? {}).filter(([, c]) => c.state === 'error');
  const wasRunning = React.useRef(false);
  React.useEffect(() => {
    const data = status.data;
    if (!data) return;
    // Finished = it was running and stopped (scheduler syncs too), or the one we started already has a new timestamp.
    const ours = awaiting.current && !data.running && data.last_sync_at !== awaiting.current.since;
    if ((wasRunning.current && !data.running) || ours) {
      awaiting.current = null;
      qc.invalidateQueries();
      // Say what actually happened: a sync that couldn't reach a service did not "finish" fine.
      const problems = Object.values(data.connections ?? {}).filter((c) => c.state === 'error');
      if (problems.length) toast(`Sync finished with problems. ${problems.map((c) => c.message).join(' ')}`, 'error');
      else toast('Sync finished. Everything is up to date.', 'ok');
    }
    wasRunning.current = data.running;
  }, [status.data, qc, toast]);

  return (
    <button
      className="btn btn-sm sync-btn"
      onClick={() => run.mutate()}
      disabled={running || run.isPending}
      title={
        failing.length
          ? `Last sync had problems: ${failing.map(([name]) => SERVICE_NAMES[name] ?? name).join(', ')}`
          : status.data?.last_sync_at
            ? `Last sync ${relative(status.data.last_sync_at)}`
            : 'Never synced'
      }
      aria-label={running ? 'Syncing' : failing.length ? `Sync now (last sync had problems with ${failing.map(([name]) => SERVICE_NAMES[name] ?? name).join(', ')})` : 'Sync now'}
    >
      {running ? <div className="spinner" /> : ICONS.sync}
      <span className="btn-label">{running ? 'Syncing…' : 'Sync now'}</span>
      {!running && failing.length > 0 && <span className="sync-warn" aria-hidden />}
    </button>
  );
}

function MoreSheet({
  username,
  theme,
  onToggleTheme,
  onLogout,
  onClose,
}: {
  username: string | null;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onLogout: () => void;
  onClose: () => void;
}) {
  const firstLink = React.useRef<HTMLAnchorElement>(null);
  React.useEffect(() => {
    firstLink.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="More">
        <div className="sheet-grip" aria-hidden />
        <nav className="sheet-nav" aria-label="More pages">
          {MORE.map((item, i) => (
            <NavLink
              key={item.to}
              to={item.to}
              ref={i === 0 ? firstLink : undefined}
              onClick={onClose}
              className={({ isActive }) => `sheet-link ${isActive ? 'active' : ''}`}
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sheet-account">
          <Avatar name={username ?? '?'} />
          <div className="who">
            <div className="name">{username ?? '—'}</div>
            <div className="sub">Administrator</div>
          </div>
        </div>
        <div className="sheet-actions">
          <button className="btn" onClick={onToggleTheme}>
            {theme === 'dark' ? ICONS.sun : ICONS.moon}
            {theme === 'dark' ? 'Light theme' : 'Dark theme'}
          </button>
          <button className="btn" onClick={onLogout}>
            {ICONS.logout}
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

export function Layout({ username, onLogout, children }: { username: string | null; onLogout: () => void; children: React.ReactNode }) {
  const location = useLocation();
  const { theme, toggle } = useTheme();
  const base = '/' + (location.pathname.split('/')[1] ?? '');
  const isDetail = location.pathname.startsWith('/subscribers/');
  const detailId = isDetail ? Number(location.pathname.split('/')[2]) : null;
  // Read the subscriber's name from the page's own query (no extra request) for the breadcrumb.
  const detailName = useQuery({
    queryKey: ['subscriber', detailId],
    queryFn: () => api.get<{ name: string }>(`/api/subscribers/${detailId}/`),
    enabled: false,
    select: (d) => d.name,
  }).data;
  const title = isDetail ? 'Subscriber' : (TITLES[base] ?? 'Tallyfin');
  const section = TITLES[base] ?? 'Tallyfin';
  const [moreOpen, setMoreOpen] = React.useState(false);
  const closeMore = React.useCallback(() => setMoreOpen(false), []);
  const moreActive = MORE.some((m) => base === m.to);
  React.useEffect(() => setMoreOpen(false), [location.pathname]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">
            <Logo size={30} />
          </div>
          <div>
            <div className="brand-name">
              <Wordmark />
            </div>
            <div className="brand-sub">Subscriptions for Jellyfin</div>
          </div>
        </div>
        <div className="nav-section">
          <span className="caps-label">Manage</span>
        </div>
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            {item.icon}
            {item.label}
          </NavLink>
        ))}
        <div className="nav-footer">
          <Avatar name={username ?? '?'} />
          <div className="who">
            <div className="name">{username ?? '—'}</div>
            <div className="sub">Administrator</div>
          </div>
          <button
            className="icon-btn"
            onClick={toggle}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
          >
            {theme === 'dark' ? ICONS.sun : ICONS.moon}
          </button>
          <button className="icon-btn" onClick={onLogout} aria-label="Sign out" title="Sign out">
            {ICONS.logout}
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <NavLink to="/" className={`topbar-logo ${isDetail ? 'mark-only' : ''}`} aria-label="Tallyfin home">
            <Logo size={26} />
            <Wordmark className="topbar-word" />
          </NavLink>
          <nav aria-label="Breadcrumb" className={`crumb ${isDetail ? '' : 'topbar-section'}`}>
            {isDetail ? (
              <>
                <NavLink to="/subscribers" style={{ color: 'inherit', textDecoration: 'none' }}>
                  Subscribers
                </NavLink>{' '}
                / {detailName ?? 'Subscriber'}
              </>
            ) : (
              <>
                <span className="crumb-root">Tallyfin / </span>
                {section}
              </>
            )}
          </nav>
          <div className="topbar-actions">
            <SyncButton />
          </div>
        </header>
        <main className="content">
          {!isDetail && <h1 className="page-title">{title}</h1>}
          {children}
        </main>
      </div>

      <nav className="tabbar" aria-label="Main">
        {TABS.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
            {item.icon}
            <span>{item.short}</span>
          </NavLink>
        ))}
        <button
          type="button"
          className={`tab ${moreActive || moreOpen ? 'active' : ''}`}
          onClick={() => setMoreOpen((o) => !o)}
          aria-expanded={moreOpen}
          aria-haspopup="dialog"
        >
          {ICONS.more}
          <span>More</span>
        </button>
      </nav>
      {moreOpen && <MoreSheet username={username} theme={theme} onToggleTheme={toggle} onLogout={onLogout} onClose={closeMore} />}
    </div>
  );
}
