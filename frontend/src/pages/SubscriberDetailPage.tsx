import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { dateShort, dateTime, daysLabel, hours, money, relative } from '../lib/format';
import type { Activity, AppSettings, Plan, Subscriber, SubscriberDetail } from '../lib/types';
import { Avatar, Card, EmptyState, ErrorBanner, Spinner, StatusBadge, useToast } from '../components/ui';
import { invalidateSubscriberData, PaymentModal, SubscriptionModal } from '../components/SubscriberModals';

export function SubscriberDetailPage() {
  const { id } = useParams();
  const subscriberId = Number(id);
  const qc = useQueryClient();
  const { push: toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);

  const detail = useQuery({
    queryKey: ['subscriber', subscriberId],
    queryFn: () => api.get<SubscriberDetail>(`/api/subscribers/${subscriberId}/`),
  });
  const activity = useQuery({
    queryKey: ['subscriber', subscriberId, 'activity'],
    queryFn: () => api.get<Activity>(`/api/subscribers/${subscriberId}/activity/`),
    staleTime: 60_000,
  });
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api.get<Plan[]>('/api/plans/') });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<AppSettings>('/api/settings/') });
  const currency = settings.data?.currency ?? 'USD';

  const access = useMutation({
    mutationFn: (disabled: boolean) => api.post<Subscriber>(`/api/subscribers/${subscriberId}/jellyfin-access/`, { disabled }),
    onSuccess: (data) => {
      invalidateSubscriberData(qc, subscriberId);
      toast(data.is_disabled ? 'Jellyfin account disabled' : 'Jellyfin account enabled', 'ok');
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });
  const deletePayment = useMutation({
    mutationFn: (paymentId: number) => api.del(`/api/payments/${paymentId}/`),
    onSuccess: () => {
      invalidateSubscriberData(qc, subscriberId);
      toast('Payment deleted', 'ok');
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  if (detail.isLoading) return <Spinner label="Loading…" />;
  if (detail.error) return <ErrorBanner error={detail.error} />;
  const s = detail.data!;
  const u = s.usage;
  const planCurrency = s.plan?.currency ?? currency;

  return (
    <div className="stack">
      <div className="row-between">
        <div className="row">
          <Avatar name={s.name} url={s.avatar_url} large />
          <div>
            <div className="row">
              <h1 className="page-title" style={{ marginBottom: 0, fontSize: 32, lineHeight: "40px" }}>{s.name}</h1>
              <StatusBadge status={s.status} label={s.status_label} />
              {s.is_admin && <span className="tag">Jellyfin admin</span>}
              {s.is_disabled && <span className="tag">{s.access_disabled_by_app ? 'disabled by Tallyfin' : 'disabled in Jellyfin'}</span>}
              {s.removed_from_jellyfin && <span className="tag">removed from Jellyfin</span>}
            </div>
            <div className="small text-muted">
              Last login {relative(s.last_login_at)} · last activity {relative(s.last_activity_at)} · <code>{s.jellyfin_id}</code>
            </div>
          </div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setEditing(true)}>
            Edit subscription
          </button>
          <button className="btn btn-primary" onClick={() => setPaying(true)}>
            Record payment
          </button>
          {!s.removed_from_jellyfin && (
            <button
              className={`btn ${s.is_disabled ? '' : 'btn-danger'}`}
              disabled={access.isPending || !settings.data?.jellyfin_configured}
              onClick={() => {
                const verb = s.is_disabled ? 'enable' : 'disable';
                if (window.confirm(`${verb === 'disable' ? 'Disable' : 'Enable'} ${s.name}'s Jellyfin account? They will ${verb === 'disable' ? 'no longer' : 'again'} be able to sign in.`)) {
                  access.mutate(!s.is_disabled);
                }
              }}
            >
              {s.is_disabled ? 'Enable Jellyfin access' : 'Disable Jellyfin access'}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-3">
        <Card title="Subscription">
          <dl className="kv">
            <dt>Plan</dt>
            <dd>{s.plan ? `${s.plan.name} · ${money(s.plan.price, s.plan.currency)} / ${s.plan.duration_label}` : <span className="text-muted">No plan assigned</span>}</dd>
            <dt>Monthly value</dt>
            <dd>{s.is_paying ? money(s.monthly_revenue, planCurrency) : '—'}</dd>
            <dt>Next payment</dt>
            <dd>
              {s.next_payment_date ? (
                <>
                  {dateShort(s.next_payment_date)}{' '}
                  <span className={`small ${s.status === 'overdue' ? 'text-critical' : s.status === 'due_soon' ? 'text-warning' : 'text-muted'}`}>({daysLabel(s.days_until_due)})</span>
                </>
              ) : (
                '—'
              )}
            </dd>
            <dt>Subscribed since</dt>
            <dd>{dateShort(s.subscription_start)}</dd>
            <dt>Billing status</dt>
            <dd>{s.status_override ? s.status_override : 'billed normally'}</dd>
            {s.status_override === 'exempt' && (
              <>
                <dt>Exempt until</dt>
                <dd className={s.status === 'expired' ? 'text-critical' : ''}>{s.exempt_until ? dateShort(s.exempt_until) : 'indefinitely'}</dd>
              </>
            )}
            <dt>Contact</dt>
            <dd>{[s.contact, s.email].filter(Boolean).join(' · ') || '—'}</dd>
            <dt>Total paid</dt>
            <dd>{money(s.payments.reduce((sum, p) => sum + Number(p.amount), 0), planCurrency)}</dd>
          </dl>
          {s.notes && (
            <p className="small text-2" style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>
              {s.notes}
            </p>
          )}
        </Card>

        <Card title="Watching" subtitle={u?.tracearr_user_id ? `Tracearr · ${u.tracearr_username || u.tracearr_user_id}` : 'No Tracearr match'}>
          {u?.tracearr_user_id ? (
            <dl className="kv">
              <dt>Last 7 days</dt>
              <dd>
                {hours(u.hours_7d)} · {u.plays_7d} plays
              </dd>
              <dt>Last 30 days</dt>
              <dd>
                {hours(u.hours_30d)} · {u.plays_30d} plays · {u.active_days_30d} active days
              </dd>
              <dt>All time</dt>
              <dd>
                {hours(u.hours_all)} · {u.plays_all} plays
              </dd>
              <dt>Transcodes (30d)</dt>
              <dd>
                {u.transcode_plays_30d} ({u.transcode_pct_30d}%)
              </dd>
              <dt>Last watched</dt>
              <dd>{u.last_watched_at ? `${relative(u.last_watched_at)} (${dateTime(u.last_watched_at)})` : 'never'}</dd>
              {u.top_genres.length > 0 && (
                <>
                  <dt>Top genres</dt>
                  <dd>{u.top_genres.map((g) => g.genre).join(', ')}</dd>
                </>
              )}
              {u.top_titles.length > 0 && (
                <>
                  <dt>Top titles (30d)</dt>
                  <dd>{u.top_titles.map((t) => `${t.title} (${t.plays})`).join(', ')}</dd>
                </>
              )}
            </dl>
          ) : (
            <EmptyState title="No watch data">
              {settings.data?.tracearr_configured ? 'No Tracearr identity matched this Jellyfin user. Set the id manually in “Edit subscription”.' : 'Connect Tracearr in Settings to see watch time.'}
            </EmptyState>
          )}
        </Card>

        <Card title="Requests" subtitle={u?.seerr_user_id != null ? `Seerr · ${u.seerr_username || u.seerr_user_id}` : 'No Seerr match'}>
          {u?.seerr_user_id != null ? (
            <dl className="kv">
              <dt>Last 30 days</dt>
              <dd>{u.seerr_requests_30d} requests</dd>
              <dt>All time</dt>
              <dd>{u.seerr_requests_total} requests</dd>
              <dt>Last request</dt>
              <dd>{u.seerr_last_request_at ? relative(u.seerr_last_request_at) : 'never'}</dd>
            </dl>
          ) : (
            <EmptyState title="No request data">
              {settings.data?.seerr_configured ? 'No Seerr user matched this Jellyfin user.' : 'Connect Seerr in Settings to see requests.'}
            </EmptyState>
          )}
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title="Payments" subtitle={`${s.payments.length} recorded`}>
          {s.payments.length === 0 ? (
            <EmptyState title="No payments yet" />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Paid</th>
                    <th className="num">Amount</th>
                    <th>Period</th>
                    <th>Method</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {s.payments.map((p) => (
                    <tr key={p.id}>
                      <td>{dateShort(p.paid_at)}</td>
                      <td className="num strong">{money(p.amount, p.currency)}</td>
                      <td className="small">{p.period_start ? `${dateShort(p.period_start)} → ${dateShort(p.period_end)}` : '—'}</td>
                      <td className="small">
                        {p.method || '—'}
                        {p.note ? <div className="text-muted">{p.note}</div> : null}
                      </td>
                      <td>
                        <div className="actions">
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => window.confirm('Delete this payment? The due date is not changed automatically.') && deletePayment.mutate(p.id)}
                          >
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
        </Card>

        <Card title="Reminders sent" subtitle="Most recent first">
          {s.reminders.length === 0 ? (
            <EmptyState title="No reminders sent for this user" />
          ) : (
            <div className="list">
              {s.reminders.map((r) => (
                <div className="list-item" key={r.id}>
                  <div>
                    <div className="primary">{r.kind.replace(/_/g, ' ')}</div>
                    <div className="secondary">due {dateShort(r.due_date)}</div>
                  </div>
                  <div className="small text-muted">
                    {dateTime(r.sent_at)} · {r.channels || 'in-app'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-3">
        <Card
          title="Access history"
          subtitle={s.access_disabled_by_app && s.access_disabled_at ? `Disabled by Tallyfin ${relative(s.access_disabled_at)}` : 'Jellyfin account enable / disable events'}
        >
          {s.access_events.length === 0 ? (
            <EmptyState title="No access changes recorded" />
          ) : (
            <div className="list">
              {s.access_events.map((e) => (
                <div className="list-item" key={e.id}>
                  <div>
                    <div className={`primary ${e.action === 'disabled' ? 'text-critical' : 'text-good'}`}>
                      {e.action === 'disabled' ? 'Disabled' : 'Enabled'} {e.automatic ? 'automatically' : 'manually'}
                    </div>
                    <div className="secondary">
                      {e.reason}
                      {e.action === 'disabled' && (e.sessions_stopped > 0 || e.devices_removed > 0)
                        ? ` · ${e.sessions_stopped} stream(s) stopped, ${e.devices_removed} device(s) logged out`
                        : ''}
                    </div>
                  </div>
                  <div className="small text-muted">{dateTime(e.created_at)}</div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Recent plays" subtitle={activity.data?.tracearr.error ?? 'Live from Tracearr'}>
          {activity.isLoading ? (
            <Spinner />
          ) : !activity.data?.tracearr.ok || activity.data.tracearr.history.length === 0 ? (
            <EmptyState title="No recent plays" />
          ) : (
            <div className="list">
              {activity.data.tracearr.history.map((h) => (
                <div className="list-item" key={h.id}>
                  <div>
                    <div className="primary">{h.title}</div>
                    <div className="secondary">
                      {h.media_type}
                      {h.year ? ` · ${h.year}` : ''}
                      {h.player ? ` · ${h.player}` : ''}
                      {h.resolution ? ` · ${h.resolution}` : ''}
                      {h.is_transcode ? ' · transcode' : ''}
                    </div>
                  </div>
                  <div className="small text-muted" style={{ textAlign: 'right' }}>
                    <div>{relative(h.started_at)}</div>
                    <div>
                      {h.duration_ms ? hours(h.duration_ms / 3_600_000) : ''}
                      {h.percent_complete != null ? ` · ${Math.round(h.percent_complete)}%` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Recent requests" subtitle={activity.data?.seerr.error ?? 'Live from Seerr'}>
          {activity.isLoading ? (
            <Spinner />
          ) : !activity.data?.seerr.ok || activity.data.seerr.requests.length === 0 ? (
            <EmptyState title="No recent requests" />
          ) : (
            <div className="list">
              {activity.data.seerr.requests.map((r) => (
                <div className="list-item" key={r.id}>
                  <div>
                    <div className="primary">{r.title}</div>
                    <div className="secondary">
                      {r.type}
                      {r.seasons.length ? ` · seasons ${r.seasons.join(', ')}` : ''}
                      {r.is_4k ? ' · 4K' : ''} · {r.status} · {r.media_status}
                    </div>
                  </div>
                  <div className="small text-muted">{relative(r.created_at)}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="small text-muted">
        <Link to="/subscribers">← All subscribers</Link>
      </div>

      {editing && <SubscriptionModal subscriber={s} plans={plans.data ?? []} onClose={() => setEditing(false)} />}
      {paying && <PaymentModal subscriber={s} currency={currency} onClose={() => setPaying(false)} />}
    </div>
  );
}
