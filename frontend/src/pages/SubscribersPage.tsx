import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { dateShort, daysLabel, hours, money, relative } from '../lib/format';
import type { AppSettings, Plan, Subscriber } from '../lib/types';
import { Avatar, Card, EmptyState, ErrorBanner, Spinner, StatusBadge, useSort } from '../components/ui';
import { PaymentModal, SubscriptionModal } from '../components/SubscriberModals';

type Filter = 'all' | 'paying' | 'due_soon' | 'overdue' | 'unassigned' | 'exempt';

interface Row {
  sub: Subscriber;
  name: string;
  plan: string;
  status: string;
  due: string;
  daysUntil: number | null;
  lastWatched: string;
  hours30: number;
  plays30: number;
  requests30: number;
  revenue: number;
}

export function SubscribersPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [showRemoved, setShowRemoved] = useState(false);
  const [editing, setEditing] = useState<Subscriber | null>(null);
  const [paying, setPaying] = useState<Subscriber | null>(null);

  const subs = useQuery({
    queryKey: ['subscribers', showRemoved],
    queryFn: () => api.get<Subscriber[]>(`/api/subscribers/${showRemoved ? '?include_removed=1' : ''}`),
  });
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api.get<Plan[]>('/api/plans/') });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<AppSettings>('/api/settings/') });
  const currency = settings.data?.currency ?? 'USD';

  const rows = useMemo<Row[]>(
    () =>
      (subs.data ?? []).map((s) => ({
        sub: s,
        name: s.name,
        plan: s.plan?.name ?? '',
        status: s.status,
        due: s.next_payment_date ?? '',
        daysUntil: s.days_until_due,
        lastWatched: s.usage?.last_watched_at ?? '',
        hours30: s.usage?.hours_30d ?? 0,
        plays30: s.usage?.plays_30d ?? 0,
        requests30: s.usage?.seerr_requests_30d ?? 0,
        revenue: s.monthly_revenue,
      })),
    [subs.data],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q)) return false;
      if (planFilter && String(r.sub.plan?.id ?? '') !== planFilter) return false;
      switch (filter) {
        case 'paying':
          return r.sub.is_paying;
        case 'due_soon':
        case 'overdue':
        case 'unassigned':
        case 'exempt':
          return r.status === filter;
        default:
          return true;
      }
    });
  }, [rows, search, planFilter, filter]);

  const { sorted, toggle, indicator } = useSort<Row>(filtered, 'name');

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: rows.length, paying: 0, due_soon: 0, overdue: 0, unassigned: 0, exempt: 0 };
    for (const r of rows) {
      if (r.sub.is_paying) c.paying++;
      if (r.status === 'due_soon') c.due_soon++;
      if (r.status === 'overdue') c.overdue++;
      if (r.status === 'unassigned') c.unassigned++;
      if (r.status === 'exempt') c.exempt++;
    }
    return c;
  }, [rows]);

  if (subs.isLoading || plans.isLoading) return <Spinner label="Loading subscribers…" />;
  if (subs.error) return <ErrorBanner error={subs.error} />;

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'paying', label: 'Paying' },
    { key: 'due_soon', label: 'Due soon' },
    { key: 'overdue', label: 'Overdue' },
    { key: 'unassigned', label: 'No plan' },
    { key: 'exempt', label: 'Exempt' },
  ];

  return (
    <div className="stack">
      <div className="row-between">
        <div className="pill-tabs">
          {FILTERS.map((f) => (
            <button key={f.key} className={filter === f.key ? 'active' : ''} onClick={() => setFilter(f.key)}>
              {f.label} <span className="text-muted">{counts[f.key]}</span>
            </button>
          ))}
        </div>
        <div className="row">
          <select value={planFilter} onChange={(e) => setPlanFilter(e.target.value)} style={{ width: 'auto' }}>
            <option value="">All plans</option>
            {(plans.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input className="search" placeholder="Search users…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <label className="check small text-muted">
            <input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} /> removed users
          </label>
        </div>
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState title="No subscribers yet">
            Connect Jellyfin in <Link to="/settings">Settings</Link> and run a sync to import your users.
          </EmptyState>
        </Card>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="sortable" onClick={() => toggle('name')}>User{indicator('name')}</th>
                <th className="sortable" onClick={() => toggle('plan')}>Plan{indicator('plan')}</th>
                <th className="sortable" onClick={() => toggle('status')}>Status{indicator('status')}</th>
                <th className="sortable" onClick={() => toggle('due')}>Next payment{indicator('due')}</th>
                <th className="sortable" onClick={() => toggle('lastWatched', 'desc')}>Last watched{indicator('lastWatched')}</th>
                <th className="num sortable" onClick={() => toggle('hours30', 'desc')}>30d watched{indicator('hours30')}</th>
                <th className="num sortable" onClick={() => toggle('plays30', 'desc')}>Plays{indicator('plays30')}</th>
                <th className="num sortable" onClick={() => toggle('requests30', 'desc')}>Requests{indicator('requests30')}</th>
                <th className="num sortable" onClick={() => toggle('revenue', 'desc')}>/ month{indicator('revenue')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const s = r.sub;
                return (
                  <tr key={s.id}>
                    <td>
                      <div className="cell-user">
                        <Avatar name={s.name} url={s.avatar_url} />
                        <div>
                          <div className="name">
                            <Link to={`/subscribers/${s.id}`}>{s.name}</Link>
                          </div>
                          <div className="sub">
                            {s.is_admin && <span className="tag">admin</span>} {s.is_disabled && <span className="tag">disabled</span>}{' '}
                            {s.removed_from_jellyfin && <span className="tag">removed</span>} {s.contact || s.email || ''}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>{s.plan ? <span>{s.plan.name}</span> : <span className="text-muted">—</span>}</td>
                    <td>
                      <StatusBadge status={s.status} label={s.status_label} />
                    </td>
                    <td>
                      {s.next_payment_date && s.is_paying ? (
                        <div>
                          <div>{dateShort(s.next_payment_date)}</div>
                          <div className={`small ${s.status === 'overdue' ? 'text-critical' : s.status === 'due_soon' ? 'text-warning' : 'text-muted'}`}>{daysLabel(s.days_until_due)}</div>
                        </div>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className={r.lastWatched ? '' : 'muted'}>{r.lastWatched ? relative(r.lastWatched) : s.usage?.tracearr_user_id ? 'never' : '—'}</td>
                    <td className="num">{s.usage?.tracearr_user_id ? hours(r.hours30) : <span className="text-muted">—</span>}</td>
                    <td className="num">{s.usage?.tracearr_user_id ? r.plays30 : <span className="text-muted">—</span>}</td>
                    <td className="num">{s.usage?.seerr_user_id != null ? r.requests30 : <span className="text-muted">—</span>}</td>
                    <td className="num">{s.is_paying ? money(r.revenue, s.plan?.currency ?? currency) : <span className="text-muted">—</span>}</td>
                    <td>
                      <div className="actions">
                        <button className="btn btn-sm" onClick={() => setPaying(s)} disabled={!s.plan}>
                          Payment
                        </button>
                        <button className="btn btn-sm" onClick={() => setEditing(s)}>
                          Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && <SubscriptionModal subscriber={editing} plans={plans.data ?? []} onClose={() => setEditing(null)} />}
      {paying && <PaymentModal subscriber={paying} currency={currency} onClose={() => setPaying(null)} />}
    </div>
  );
}
