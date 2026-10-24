import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../lib/api';
import { hours, money, percent, relative } from '../lib/format';
import type { Profitability, ProfitabilityRow } from '../lib/types';
import { Banner, Card, EmptyState, ErrorBanner, Progress, Spinner, StatTile, StatusBadge, useSort } from '../components/ui';

type View = 'paying' | 'all';

export function ProfitabilityPage() {
  const query = useQuery({ queryKey: ['profitability'], queryFn: () => api.get<Profitability>('/api/profitability/') });
  const [view, setView] = useState<View>('paying');

  const rows = useMemo(() => {
    const all = query.data?.rows ?? [];
    return view === 'paying' ? all.filter((r) => r.is_paying) : all;
  }, [query.data, view]);
  const { sorted, toggle, indicator } = useSort<ProfitabilityRow>(rows, 'rank');

  if (query.isLoading) return <Spinner label="Crunching numbers…" />;
  if (query.error) return <ErrorBanner error={query.error} />;
  const data = query.data!;
  const cur = data.currency;
  const hasCost = data.monthly_server_cost > 0;
  const hasUsage = data.rows.some((r) => r.has_usage_data);

  const chartRows = data.rows
    .filter((r) => r.is_paying && r.has_usage_data)
    .map((r) => ({ name: r.name, value: hasCost ? r.margin : (r.revenue_per_hour ?? 0), hours: r.hours_30d, revenue: r.monthly_revenue }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 25);

  return (
    <div className="stack">
      {!hasUsage && (
        <Banner kind="info">
          Usage figures come from Tracearr. <Link to="/settings">Connect it in Settings</Link> and run a sync to compare revenue against real watch time.
        </Banner>
      )}
      <div className="grid grid-kpi">
        <StatTile label="Monthly recurring revenue" value={money(data.totals.mrr, cur)} hint={`${data.totals.paying} paying of ${data.totals.subscribers}`} />
        <StatTile label="Watch time (30d)" value={hours(data.totals.hours_30d)} hint={`${data.totals.plays_30d} plays · ${data.totals.requests_30d} requests`} />
        <StatTile label="Revenue per hour watched" value={data.totals.avg_revenue_per_hour != null ? money(data.totals.avg_revenue_per_hour, cur) : '—'} hint="MRR ÷ total hours, last 30 days" />
        <StatTile
          label="Free usage (30d)"
          value={hours(data.totals.free_hours_30d)}
          hint={data.totals.free_hours_30d > 0 ? 'watched by non-paying users' : 'no free riders'}
          hintKind={data.totals.free_hours_30d > 0 ? 'critical' : 'good'}
        />
        {hasCost ? (
          <StatTile
            label="Monthly margin"
            value={money(data.totals.margin, cur)}
            hint={`after ${money(data.monthly_server_cost, cur)} running cost (${data.cost_breakdown.kwh_per_month} kWh${data.cost_breakdown.other_costs > 0 ? ` + ${money(data.cost_breakdown.other_costs, cur)} other` : ''})`}
            hintKind={data.totals.margin >= 0 ? 'good' : 'critical'}
          />
        ) : (
          <StatTile label="Monthly margin" value="—" hint={<Link to="/settings">Enter your electricity price and server wattage</Link>} small />
        )}
      </div>

      <div className="grid grid-2">
        <Card
          title={hasCost ? 'Margin per subscriber' : 'Revenue per hour watched'}
          subtitle={hasCost ? 'Monthly revenue minus the running cost allocated by share of watch time' : 'Higher = pays more for each hour they actually watch (last 30 days)'}
        >
          {chartRows.length === 0 ? (
            <EmptyState title="No paying subscribers with usage data yet" />
          ) : (
            <div style={{ width: '100%', height: Math.max(180, chartRows.length * 30 + 30) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartRows} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
                  <CartesianGrid horizontal={false} stroke="var(--grid)" />
                  <XAxis type="number" tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={{ stroke: 'var(--border-strong)' }} tickLine={false} tickFormatter={(v: number) => money(v, cur)} />
                  <YAxis type="category" dataKey="name" width={110} tick={{ fill: 'var(--text-2)', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: 'var(--surface-3)', border: '1px solid var(--border-strong)', borderRadius: 8, fontSize: 12.5 }}
                    labelStyle={{ color: 'var(--muted)' }}
                    itemStyle={{ color: 'var(--text)' }}
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                    formatter={(value, _name, item) => {
                      const payload = (item as { payload?: { hours: number; revenue: number } }).payload;
                      const extra = payload ? ` (${money(payload.revenue, cur)}/mo · ${hours(payload.hours)})` : '';
                      return [`${money(Number(value), cur)}${extra}`, hasCost ? 'Margin' : 'Per hour'];
                    }}
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={18}>
                    {chartRows.map((r) => (
                      <Cell key={r.name} fill={hasCost && r.value < 0 ? 'var(--critical)' : 'var(--series-1)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {hasCost && <div className="small text-muted" style={{ marginTop: 8 }}>Red bars are subscribers whose allocated cost exceeds what they pay.</div>}
        </Card>

        <Card title="How to read this">
          <div className="stack small text-2">
            <p>
              <strong>Revenue per hour</strong> divides a subscriber's monthly plan value by the hours they watched in the last 30 days. A high number means they pay a lot for little usage (cheap to serve); a low number means heavy use for the price.
            </p>
            <p>
              <strong>Usage share</strong> is their part of all watch time. The monthly <Link to="/settings">running cost</Link> (electricity = server watts × hours on per day × 30.44 days × price per kWh, plus any other costs) is split by that share: <strong>allocated cost</strong> = running cost × share, and <strong>margin</strong> = revenue − allocated cost. The total margin is revenue minus the whole running cost.
            </p>
            <p>
              <strong>Transcode %</strong> flags users who cost CPU rather than just bandwidth. <strong>Requests</strong> are Seerr requests, a proxy for how much new content they drive you to add.
            </p>
            <p>
              Users marked exempt or without a plan still appear in the “Everyone” view so you can spot heavy free usage.
            </p>
          </div>
        </Card>
      </div>

      <div className="row-between">
        <div className="pill-tabs">
          <button className={view === 'paying' ? 'active' : ''} onClick={() => setView('paying')}>
            Paying subscribers
          </button>
          <button className={view === 'all' ? 'active' : ''} onClick={() => setView('all')}>
            Everyone
          </button>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="num sortable" onClick={() => toggle('rank')}>#{indicator('rank')}</th>
              <th className="sortable" onClick={() => toggle('name')}>Subscriber{indicator('name')}</th>
              <th>Plan</th>
              <th className="num sortable" onClick={() => toggle('monthly_revenue', 'desc')}>Revenue / mo{indicator('monthly_revenue')}</th>
              <th className="num sortable" onClick={() => toggle('paid_last_12m', 'desc')}>Paid 12m{indicator('paid_last_12m')}</th>
              <th className="num sortable" onClick={() => toggle('hours_30d', 'desc')}>Hours 30d{indicator('hours_30d')}</th>
              <th className="sortable" onClick={() => toggle('usage_share_pct', 'desc')}>Usage share{indicator('usage_share_pct')}</th>
              <th className="num sortable" onClick={() => toggle('plays_30d', 'desc')}>Plays{indicator('plays_30d')}</th>
              <th className="num sortable" onClick={() => toggle('transcode_pct', 'desc')}>Transcode{indicator('transcode_pct')}</th>
              <th className="num sortable" onClick={() => toggle('requests_30d', 'desc')}>Requests{indicator('requests_30d')}</th>
              <th className="num sortable" onClick={() => toggle('revenue_per_hour', 'desc')}>Per hour{indicator('revenue_per_hour')}</th>
              {hasCost && <th className="num sortable" onClick={() => toggle('margin', 'desc')}>Margin{indicator('margin')}</th>}
              <th className="sortable" onClick={() => toggle('last_watched_at', 'desc')}>Last watched{indicator('last_watched_at')}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.subscriber_id}>
                <td className="num text-muted">{r.rank}</td>
                <td>
                  <div className="strong">
                    <Link to={`/subscribers/${r.subscriber_id}`}>{r.name}</Link>
                  </div>
                  <StatusBadge status={r.status} />
                </td>
                <td>{r.plan ?? <span className="text-muted">—</span>}</td>
                <td className="num">{r.is_paying ? money(r.monthly_revenue, cur) : <span className="text-muted">free</span>}</td>
                <td className="num">{money(r.paid_last_12m, cur)}</td>
                <td className="num">{r.has_usage_data ? hours(r.hours_30d) : <span className="text-muted">—</span>}</td>
                <td>
                  <div className="row" style={{ flexWrap: 'nowrap' }}>
                    <Progress value={r.usage_share_pct} max={100} />
                    <span className="small mono">{percent(r.usage_share_pct)}</span>
                  </div>
                </td>
                <td className="num">{r.has_usage_data ? r.plays_30d : '—'}</td>
                <td className="num">{r.has_usage_data && r.plays_30d > 0 ? percent(r.transcode_pct) : '—'}</td>
                <td className="num">{r.requests_30d}</td>
                <td className="num">{r.revenue_per_hour != null ? money(r.revenue_per_hour, cur) : r.is_paying && r.has_usage_data ? <span className="text-good" title="Pays but did not watch anything">no usage</span> : '—'}</td>
                {hasCost && <td className={`num ${r.margin < 0 ? 'text-critical' : ''}`}>{money(r.margin, cur)}</td>}
                <td className="small text-muted">{r.last_watched_at ? relative(r.last_watched_at) : r.has_usage_data ? 'never' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
