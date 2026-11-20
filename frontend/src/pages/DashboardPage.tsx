import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../lib/api';
import { dateShort, daysLabel, money, monthLabel, relative } from '../lib/format';
import type { Dashboard, Subscriber } from '../lib/types';
import { PaymentModal } from '../components/SubscriberModals';
import { Logo } from '../components/Logo';
import { Avatar, Banner, Card, EmptyState, ErrorBanner, Issue, Spinner, StatTile, StatusBadge } from '../components/ui';

const TOOLTIP_STYLE = {
  contentStyle: { background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, boxShadow: 'var(--shadow-md)', color: 'var(--popover-foreground)' },
  labelStyle: { color: 'var(--muted-foreground)' },
  itemStyle: { color: 'var(--foreground)' },
};

export function DashboardPage() {
  const [paying, setPaying] = useState<Subscriber | null>(null);
  const query = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<Dashboard>('/api/dashboard/'),
    refetchInterval: 60_000,
  });

  if (query.isLoading) return <Spinner label="Loading dashboard…" />;
  if (query.error) return <ErrorBanner error={query.error} onRetry={() => query.refetch()} retrying={query.isFetching} />;
  const d = query.data!;
  const cur = d.currency;
  // Start the chart at the first month with a payment (keeping at least 4 months), not 9 empty ones.
  const firstPaid = d.revenue_by_month.findIndex((m) => m.amount > 0);
  const startAt = firstPaid < 0 ? 0 : Math.max(0, Math.min(firstPaid, d.revenue_by_month.length - 4));
  const chartData = d.revenue_by_month.slice(startAt).map((m) => ({ ...m, label: monthLabel(m.month) }));
  const overdue = d.attention.filter((s) => s.status === 'overdue' || s.status === 'expired');
  const dueSoon = d.attention.filter((s) => s.status === 'due_soon');
  const nextUp = d.upcoming.find((u) => u.days_until_due >= 0);
  // Sync failures not already explained by the Now playing card (Jellyfin down shows there).
  const syncProblems = Object.entries(d.last_sync?.result ?? {})
    .filter(([, r]) => !r.ok && !r.skipped && r.kind !== 'not_configured')
    .filter(([name, r]) => !(name === 'jellyfin' && !d.now_playing.ok && r.kind === d.now_playing.kind));
  const axisLabel = (v: number) => money(v, cur).replace(/\.00$/, '');
  const maxAmount = Math.max(0, ...chartData.map((m) => m.amount));
  const axisWidth = Math.max(40, axisLabel(maxAmount).length * 7 + 10);

  return (
    <div className="stack dash">
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

      <div className="grid grid-kpi dash-kpis">
        <StatTile label="Paying subscribers" value={d.counts.paying} hint={`${d.counts.total} Jellyfin users`} />
        <StatTile label="Monthly recurring revenue" value={money(d.mrr, cur)} hint={`${money(d.collected_this_month, cur)} collected so far in ${new Date().toLocaleString(undefined, { month: 'long' })}`} />
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
        <Card className="dash-attention" title="Needs attention" subtitle="Overdue and upcoming payments" actions={<Link className="btn btn-sm" to="/reminders">Reminders</Link>}>
          {d.attention.length === 0 ? (
            <div className="paid-up">
              <Logo size={44} />
              <div>
                <div className="paid-up-title">Everyone's paid up.</div>
                <div className="small text-muted">
                  {nextUp
                    ? `Next up: ${nextUp.name}, ${dateShort(nextUp.due_date)} (${daysLabel(nextUp.days_until_due)}).`
                    : 'Nobody is due in the next 30 days.'}
                </div>
              </div>
            </div>
          ) : (
            <div className="list">
              {[...overdue, ...dueSoon].map((s) => (
                <div className="attn-item" key={s.id}>
                  <Avatar name={s.name} url={s.avatar_url} />
                  <div className="attn-who">
                    <div className="primary">
                      <Link to={`/subscribers/${s.id}`}>{s.name}</Link>
                    </div>
                    <div className="secondary">
                      {s.status === 'expired'
                        ? `exemption ended ${dateShort(s.exempt_until)}${s.is_disabled ? ' · access disabled' : ''}`
                        : `${s.plan?.name} · ${money(s.plan?.price, s.plan?.currency ?? cur)} · due ${dateShort(s.next_payment_date)}${s.is_disabled ? ' · access disabled' : ''}`}
                    </div>
                  </div>
                  <div className="attn-status">
                    <span className="small text-muted">{s.status === 'expired' ? '' : s.status === 'due_soon' ? `due ${daysLabel(s.days_until_due)}` : `due ${daysLabel(s.days_until_due)}`}</span>
                    <StatusBadge status={s.status} />
                  </div>
                  <div className="attn-action">
                    {s.plan && s.status !== 'expired' && (
                      <button className="btn btn-sm" onClick={() => setPaying(s)} aria-label={`Record payment for ${s.name}`}>
                        Payment
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="dash-revenue" title="Revenue" subtitle={startAt > 0 ? 'Payments received per month, since your first one' : 'Payments received per month, last 12 months'}>
          <div className="chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
                <YAxis tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} axisLine={false} tickLine={false} width={axisWidth} tickFormatter={axisLabel} />
                <Tooltip {...TOOLTIP_STYLE} cursor={{ fill: 'var(--accent)', fillOpacity: 0.6 }} formatter={(value) => [money(Number(value), cur), 'Collected']} />
                <Bar dataKey="amount" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={28} />
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
        <Card
          className="dash-playing"
          title="Now playing"
          subtitle={
            d.now_playing.ok
              ? `${d.now_playing.streams.length} active stream${d.now_playing.streams.length === 1 ? '' : 's'}`
              : d.now_playing.kind === 'not_configured'
                ? 'Live from Jellyfin'
                : 'Unavailable right now'
          }
        >
          {!d.now_playing.ok ? (
            <Issue
              message={d.now_playing.error ?? "Couldn't load what's playing."}
              kind={d.now_playing.kind}
              detail={d.now_playing.detail}
              onRetry={() => query.refetch()}
              retrying={query.isFetching}
            />
          ) : d.now_playing.streams.length === 0 ? (
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

        <Card className="dash-recent" title="Recent payments" actions={<Link className="btn btn-sm" to="/payments">Ledger</Link>}>
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

      <div className="dash-footer stack" style={{ gap: 8 }}>
        <div className="small text-muted">
          {d.last_sync ? `Last sync ${relative(d.last_sync.finished_at ?? d.last_sync.started_at)}${syncProblems.length ? ', with problems:' : '.'}` : 'Never synced yet.'}
        </div>
        {syncProblems.map(([name, r]) => (
          <Issue key={name} compact message={r.error ?? `The ${name} sync failed.`} kind={r.kind} detail={r.detail} />
        ))}
      </div>

      {paying && <PaymentModal subscriber={paying} currency={cur} onClose={() => setPaying(null)} />}
    </div>
  );
}
