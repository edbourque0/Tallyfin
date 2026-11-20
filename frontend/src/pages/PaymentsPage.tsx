import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { dateShort, money } from '../lib/format';
import type { AppSettings, Payment } from '../lib/types';
import { Card, EmptyState, ErrorBanner, Spinner, StatTile } from '../components/ui';
import { useDeletePayment, usePendingPaymentDeletes } from '../lib/undo';

export function PaymentsPage() {
  const [search, setSearch] = useState('');
  const payments = useQuery({ queryKey: ['payments'], queryFn: () => api.get<Payment[]>('/api/payments/') });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<AppSettings>('/api/settings/') });
  const currency = settings.data?.currency ?? 'USD';

  const deletePayment = useDeletePayment();
  const pendingDeletes = usePendingPaymentDeletes();

  const list = useMemo(() => (payments.data ?? []).filter((p) => !pendingDeletes.has(p.id)), [payments.data, pendingDeletes]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? list.filter((p) => p.subscriber_name.toLowerCase().includes(q) || (p.note ?? '').toLowerCase().includes(q)) : list;
  }, [list, search]);

  const stats = useMemo(() => {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const year = String(now.getFullYear());
    let total = 0;
    let month = 0;
    let thisYear = 0;
    for (const p of list) {
      const amount = Number(p.amount);
      total += amount;
      if (p.paid_at.startsWith(ym)) month += amount;
      if (p.paid_at.startsWith(year)) thisYear += amount;
    }
    return { total, month, thisYear };
  }, [list]);

  if (payments.isLoading) return <Spinner label="Loading payments…" />;
  if (payments.error) return <ErrorBanner error={payments.error} onRetry={() => payments.refetch()} retrying={payments.isFetching} />;

  return (
    <div className="stack">
      <div className="grid grid-kpi">
        <StatTile label="Collected this month" value={money(stats.month, currency)} />
        <StatTile label="Collected this year" value={money(stats.thisYear, currency)} />
        <StatTile label="All time" value={money(stats.total, currency)} hint={`${list.length} payments`} />
      </div>
      <div className="row-between">
        <p className="text-muted">Every payment recorded, newest first. Record new payments from a subscriber's page.</p>
        <input className="search" placeholder="Search by user or note…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {filtered.length === 0 ? (
        <Card>
          <EmptyState title="No payments" />
        </Card>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Paid</th>
                <th>Subscriber</th>
                <th>Plan</th>
                <th className="num">Amount</th>
                <th>Period covered</th>
                <th>Method</th>
                <th>Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td>{dateShort(p.paid_at)}</td>
                  <td>
                    <Link to={`/subscribers/${p.subscriber}`}>{p.subscriber_name}</Link>
                  </td>
                  <td>{p.plan_name ?? <span className="text-muted">—</span>}</td>
                  <td className="num strong">{money(p.amount, p.currency)}</td>
                  <td className="small">{p.period_start ? `${dateShort(p.period_start)} → ${dateShort(p.period_end)}` : '—'}</td>
                  <td>{p.method || <span className="text-muted">—</span>}</td>
                  <td className="small text-2">{p.note}</td>
                  <td>
                    <div className="actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => deletePayment(p)} aria-label={`Delete ${money(p.amount, p.currency)} payment from ${p.subscriber_name}`}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
