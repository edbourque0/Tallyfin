import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../lib/api';
import { dateShort, daysLabel, money, monthLabel, relative } from '../lib/format';
import type { Dashboard } from '../lib/types';
import { Avatar, Banner, Card, EmptyState, ErrorBanner, Spinner, StatTile, StatusBadge } from '../components/ui';

const TOOLTIP_STYLE = {
  contentStyle: { background: 'var(--surface-3)', border: '1px solid var(--border-strong)', borderRadius: 8, fontSize: 12.5 },
  labelStyle: { color: 'var(--muted)' },
  itemStyle: { color: 'var(--text)' },
};

export function DashboardPage() {
  const query = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<Dashboard>('/api/dashboard/'),
    refetchInterval: 60_000,
  });

  if (query.isLoading) return <Spinner label="Loading dashboard…" />;
  if (query.error) return <ErrorBanner error={query.error} />;
  const d = query.data!;
  const cur = d.currency;
  const chartData = d.revenue_by_month.map((m) => ({ ...m, label: monthLabel(m.month) }));
  const overdue = d.attention.filter((s) => s.status === 'overdue' || s.status === 'expired');
  const dueSoon = d.attention.filter((s) => s.status === 'due_soon');

  return (
    <div className="stack">
      {!d.configured.jellyfin && (
        <Banner kind="info">
          Jellyfin is not connected yet. <Link to="/settings">Open Settings</Link> to add your server URL and API key, then run a sync to import your users.
        </Banner>
      )}
      {d.configured.jellyfin && d.configured.notifications.length === 0 && (
        <Banner kind="warn">
          No notification channel is configured, so due-date reminders only show here. <Link to="/settings">Add Discord, ntfy, Telegram, email…</Link>
        </Banner>
      )}

      <div className="grid grid-kpi">
        <StatTile label="Paying subscribers" value={d.counts.paying} hint={`${d.counts.total} Jellyfin users`} />
        <StatTile label="Monthly recurring revenue" value={money(d.mrr, cur)} hint={`${money(d.collected_this_month, cur)} collected this month`} />
        <StatTile
          label="Overdue"
          value={(d.counts.overdue ?? 0) + (d.counts.expired ?? 0)}
          hint={d.counts.expired ? `${d.counts.expired} expired exemption${d.counts.expired === 1 ? '' : 's'}` : d.counts.overdue ? 'needs follow-up' : 'all caught up'}
          hintKind={d.counts.overdue || d.counts.expired ? 'critical' : 'good'}
        />
        <StatTile label="Due soon" value={d.counts.due_soon ?? 0} hint="within the due-soon window" />
        <StatTile label="Without a plan" value={d.counts.unassigned ?? 0} hint={`${d.counts.exempt ?? 0} exempt`} />
      </div>

      <div className="grid grid-2">
        <Card title="Needs attention" subtitle="Overdue and upcoming payments" actions={<Link className="btn btn-sm" to="/reminders">Reminders</Link>}>
          {d.attention.length === 0 ? (
            <EmptyState title="Nothing due">Everyone with a plan is paid up beyond the due-soon window.</EmptyState>
          ) : (
            <div className="list">
              {[...overdue, ...dueSoon].map((s) => (
                <div className="list-item" key={s.id}>
                  <div className="row">
                    <Avatar name={s.name} url={s.avatar_url} />
                    <div>
                      <div className="primary">
                        <Link to={`/subscribers/${s.id}`}>{s.name}</Link>
                      </div>
                      <div className="secondary">
                        {s.status === 'expired'
                          ? `exemption ended ${dateShort(s.exempt_until)}${s.is_disabled ? ' · access disabled' : ''}`
                          : `${s.plan?.name} · ${money(s.plan?.price, s.plan?.currency ?? cur)} · due ${dateShort(s.next_payment_date)}${s.is_disabled ? ' · access disabled' : ''}`}
                      </div>
                    </div>
                  </div>
                  <div className="row">
                    <span className={`small ${s.status === 'due_soon' ? 'text-warning' : 'text-critical'}`}>{daysLabel(s.days_until_due)}</span>
                    <StatusBadge status={s.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Revenue" subtitle="Payments received per month, last 12 months">
          <div className="chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--grid)" />
                <XAxis dataKey="label" tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={{ stroke: 'var(--border-strong)' }} tickLine={false} />
                <YAxis tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={44} tickFormatter={(v: number) => money(v, cur).replace(/\.00$/, '')} />
                <Tooltip {...TOOLTIP_STYLE} cursor={{ fill: 'rgba(255,255,255,0.04)' }} formatter={(value) => [money(Number(value), cur), 'Collected']} />
                <Bar dataKey="amount" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="row-between small text-muted" style={{ marginTop: 8 }}>
            <span>Last 30 days: {money(d.collected_last_30d, cur)}</span>
            <Link to="/payments">All payments</Link>
          </div>
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title="Now playing" subtitle={d.now_playing.ok ? `${d.now_playing.streams.length} active stream${d.now_playing.streams.length === 1 ? '' : 's'}` : d.now_playing.error ?? ''}>
          {d.now_playing.streams.length === 0 ? (
            <EmptyState title="Nobody is watching right now" />
          ) : (
            <div className="list">
              {d.now_playing.streams.map((s, i) => (
                <div className="list-item" key={`${s.user_id}-${i}`}>
                  <div>
                    <div className="primary">{s.user_name}</div>
                    <div className="secondary">
                      {s.series ? `${s.series} — ` : ''}
                      {s.title}
                      {s.season != null && s.episode != null ? ` (S${s.season}E${s.episode})` : ''}
                    </div>
                  </div>
                  <div className="small text-muted" style={{ textAlign: 'right' }}>
                    <div>{s.client}</div>
                    <div>
                      {s.play_method ?? ''}
                      {s.paused ? ' · paused' : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Recent payments" actions={<Link className="btn btn-sm" to="/payments">Ledger</Link>}>
          {d.recent_payments.length === 0 ? (
            <EmptyState title="No payments recorded yet">Open a subscriber and use “Record payment”.</EmptyState>
          ) : (
            <div className="list">
              {d.recent_payments.map((p) => (
                <div className="list-item" key={p.id}>
                  <div>
                    <div className="primary">
                      <Link to={`/subscribers/${p.subscriber}`}>{p.subscriber_name}</Link>
                    </div>
                    <div className="secondary">
                      {dateShort(p.paid_at)}
                      {p.plan_name ? ` · ${p.plan_name}` : ''}
                      {p.method ? ` · ${p.method}` : ''}
                    </div>
                  </div>
                  <div className="strong mono">{money(p.amount, p.currency)}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="small text-muted">
        {d.last_sync ? (
          <>
            Last sync {relative(d.last_sync.finished_at ?? d.last_sync.started_at)} ({d.last_sync.ok ? 'ok' : 'with errors'})
            {Object.entries(d.last_sync.result)
              .filter(([, r]) => !r.ok)
              .map(([name, r]) => (
                <span key={name} className="text-critical">
                  {' '}
                  · {name}: {r.error}
                </span>
              ))}
          </>
        ) : (
          'Never synced yet.'
        )}
      </div>
    </div>
  );
}
