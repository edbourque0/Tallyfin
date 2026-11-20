import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { dateShort, daysLabel, hours, money, relative } from '../lib/format';
import type { AppSettings, Plan, Subscriber } from '../lib/types';
import { Avatar, Card, EmptyState, ErrorBanner, Spinner, StatusBadge, useElementWidth, useSort } from '../components/ui';
import { PaymentModal, SubscriptionModal } from '../components/SubscriberModals';

/** Below this content width the table becomes a list of people; below COMPACT_BELOW it drops the usage columns. */
const LIST_BELOW = 720;
const COMPACT_BELOW = 1040;
const TIGHT_BELOW = 840;

const SORTS: { value: string; label: string; key: keyof Row; dir: 'asc' | 'desc' }[] = [
  { value: 'name', label: 'Name', key: 'name', dir: 'asc' },
  { value: 'due', label: 'Next payment', key: 'due', dir: 'asc' },
  { value: 'status', label: 'Status', key: 'status', dir: 'asc' },
  { value: 'revenue', label: 'Monthly revenue', key: 'revenue', dir: 'desc' },
];

const EDIT_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

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
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();
  const asList = width > 0 && width < LIST_BELOW;
  const compact = width > 0 && width < COMPACT_BELOW;
  const tight = width > 0 && width < TIGHT_BELOW;

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
        case 'overdue':
          return r.status === 'overdue' || r.status === 'expired';
        case 'due_soon':
        case 'unassigned':
        case 'exempt':
          return r.status === filter;
        default:
          return true;
      }
    });
  }, [rows, search, planFilter, filter]);

  const { sorted, toggle, setSort, key: sortKey, indicator } = useSort<Row>(filtered, 'name');

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: rows.length, paying: 0, due_soon: 0, overdue: 0, unassigned: 0, exempt: 0 };
    for (const r of rows) {
      if (r.sub.is_paying) c.paying++;
      if (r.status === 'due_soon') c.due_soon++;
      if (r.status === 'overdue' || r.status === 'expired') c.overdue++;
      if (r.status === 'unassigned') c.unassigned++;
      if (r.status === 'exempt') c.exempt++;
    }
    return c;
  }, [rows]);

  if (subs.isLoading || plans.isLoading)
    return (
      <div ref={wrapRef}>
        <Spinner label="Loading subscribers…" />
      </div>
    );
  if (subs.error)
    return (
      <div ref={wrapRef}>
        <ErrorBanner error={subs.error} onRetry={() => subs.refetch()} retrying={subs.isFetching} />
      </div>
    );

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'paying', label: 'Paying' },
    { key: 'due_soon', label: 'Due soon' },
    { key: 'overdue', label: 'Overdue' },
    { key: 'unassigned', label: 'No plan' },
    { key: 'exempt', label: 'Exempt' },
  ];

  return (
    <div className="stack" ref={wrapRef}>
      <div className="toolbar">
        <div className="scroll-strip">
          <div className="pill-tabs" role="group" aria-label="Filter subscribers">
            {FILTERS.map((f) => (
              <button key={f.key} className={filter === f.key ? 'active' : ''} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
                {f.label} <span className="text-muted">{counts[f.key]}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="toolbar-controls">
          <input
            className="search"
            type="search"
            placeholder="Search users…"
            aria-label="Search users"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select value={planFilter} onChange={(e) => setPlanFilter(e.target.value)} aria-label="Filter by plan">
            <option value="">All plans</option>
            {(plans.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {asList && (
            <select
              value={SORTS.find((o) => o.key === sortKey)?.value ?? 'name'}
              onChange={(e) => {
                const o = SORTS.find((x) => x.value === e.target.value)!;
                setSort(o.key, o.dir);
              }}
              aria-label="Sort by"
            >
              {SORTS.map((o) => (
                <option key={o.value} value={o.value}>
                  Sort: {o.label}
                </option>
              ))}
            </select>
          )}
          <label className="check small text-muted">
            <input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} /> Removed users
          </label>
        </div>
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState title="No subscribers yet">
            Connect Jellyfin in <Link to="/settings">Settings</Link> and run a sync to import your users.
          </EmptyState>
        </Card>
      ) : asList ? (
        <ul className="people" aria-label="Subscribers">
          {sorted.length === 0 && (
            <li className="people-empty">
              <EmptyState title="No one matches">Try another filter or clear the search.</EmptyState>
            </li>
          )}
          {sorted.map((r) => {
            const s = r.sub;
            const dueTone = s.status === 'overdue' || s.status === 'expired' ? 'text-critical' : s.status === 'due_soon' ? 'text-warning' : 'text-muted';
            return (
              <li className="person" key={s.id}>
                <Link className="person-main" to={`/subscribers/${s.id}`}>
                  <Avatar name={s.name} url={s.avatar_url} />
                  <div className="person-text">
                    <div className="person-name">{s.name}</div>
                    <div className="person-meta">
                      <StatusBadge status={s.status} label={s.status_label} />
                      {s.next_payment_date && s.is_paying ? (
                        <span className={`small ${dueTone}`}>
                          {dateShort(s.next_payment_date)} · {daysLabel(s.days_until_due)}
                        </span>
                      ) : s.plan ? (
                        <span className="small text-muted">{s.plan.name}</span>
                      ) : null}
                    </div>
                  </div>
                </Link>
                <div className="person-actions">
                  {s.plan && (
                    <button className="btn btn-sm" onClick={() => setPaying(s)}>
                      Payment
                    </button>
                  )}
                  <button className="icon-btn" onClick={() => setEditing(s)} aria-label={`Edit ${s.name}`} title="Edit">
                    {EDIT_ICON}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className={`table-wrap subs-table ${compact ? 'compact' : ''} ${tight ? 'tight' : ''}`}>
          <table>
            <thead>
              <tr>
                <th className="sortable" onClick={() => toggle('name')}>User{indicator('name')}</th>
                <th className="sortable" onClick={() => toggle('plan')}>Plan{indicator('plan')}</th>
                <th className="sortable" onClick={() => toggle('status')}>Status{indicator('status')}</th>
                <th className="sortable" onClick={() => toggle('due')}>Next payment{indicator('due')}</th>
                <th className="sortable col-usage" onClick={() => toggle('lastWatched', 'desc')}>Last watched{indicator('lastWatched')}</th>
                <th className="num sortable col-usage" onClick={() => toggle('hours30', 'desc')}>30d watched{indicator('hours30')}</th>
                <th className="num sortable col-usage" onClick={() => toggle('plays30', 'desc')}>Plays{indicator('plays30')}</th>
                <th className="num sortable col-usage" onClick={() => toggle('requests30', 'desc')}>Requests{indicator('requests30')}</th>
                <th className="num sortable col-revenue" onClick={() => toggle('revenue', 'desc')}>/ month{indicator('revenue')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={10}>
                    <EmptyState title="No one matches">Try another filter or clear the search.</EmptyState>
                  </td>
                </tr>
              )}
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
                            {s.is_admin && <span className="tag">admin</span>} {s.is_disabled && <span className="tag">{s.access_disabled_by_app ? 'disabled by Tallyfin' : 'disabled'}</span>}{' '}
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
                          <div className="nowrap">{dateShort(s.next_payment_date)}</div>
                          <div className={`small ${s.status === 'overdue' ? 'text-critical' : s.status === 'due_soon' ? 'text-warning' : 'text-muted'}`}>{daysLabel(s.days_until_due)}</div>
                        </div>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className={`col-usage ${r.lastWatched ? '' : 'muted'}`}>{r.lastWatched ? relative(r.lastWatched) : s.usage?.tracearr_user_id ? 'never' : '—'}</td>
                    <td className="num col-usage">{s.usage?.tracearr_user_id ? hours(r.hours30) : <span className="text-muted">—</span>}</td>
                    <td className="num col-usage">{s.usage?.tracearr_user_id ? r.plays30 : <span className="text-muted">—</span>}</td>
                    <td className="num col-usage">{s.usage?.seerr_user_id != null ? r.requests30 : <span className="text-muted">—</span>}</td>
                    <td className="num col-revenue">{s.is_paying ? money(r.revenue, s.plan?.currency ?? currency) : <span className="text-muted">—</span>}</td>
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
