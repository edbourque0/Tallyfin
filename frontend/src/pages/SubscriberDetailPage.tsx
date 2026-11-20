import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useDeletePayment, usePendingPaymentDeletes } from '../lib/undo';
import { channelList, dateShort, dateTime, daysLabel, hours, money, plural, reminderKind, relative } from '../lib/format';
import type { Activity, AppSettings, Plan, Subscriber, SubscriberDetail } from '../lib/types';
import { Avatar, Card, EmptyState, ErrorBanner, Spinner, StatusBadge, useToast, Issue, ConfirmDialog } from '../components/ui';
import { invalidateSubscriberData, PaymentModal, SubscriptionModal } from '../components/SubscriberModals';
import { PaymentList } from '../components/PaymentList';
import type { StatusOverride } from '../lib/types';

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

  const [confirmDisable, setConfirmDisable] = useState(false);
  const access = useMutation({
    mutationFn: (disabled: boolean) => api.post<Subscriber>(`/api/subscribers/${subscriberId}/jellyfin-access/`, { disabled }),
    onSuccess: (data) => {
      invalidateSubscriberData(qc, subscriberId);
      setConfirmDisable(false);
      toast(data.is_disabled ? `${data.name} can no longer sign in to Jellyfin.` : `${data.name} can sign in to Jellyfin again.`, 'ok');
    },
    onError: (err: Error, disabled) => {
      // Turning off happens in a dialog that stays open with the error; turning back on is a button on the page.
      if (!disabled) toast(err.message, 'error');
    },
  });
  const deletePayment = useDeletePayment();
  const pendingDeletes = usePendingPaymentDeletes();

  if (detail.isLoading) return <Spinner label="Loading…" />;
  if (detail.error) return <ErrorBanner error={detail.error} onRetry={() => detail.refetch()} retrying={detail.isFetching} />;
  const s = detail.data!;
  const u = s.usage;
  const planCurrency = s.plan?.currency ?? currency;
  const payments = s.payments.filter((p) => !pendingDeletes.has(p.id));
  const lastPayment = payments[0];
  const jellyfinReady = Boolean(settings.data?.jellyfin_configured);
  const jellyfinConn = settings.data?.connections?.jellyfin;
  const tracearrOn = Boolean(settings.data?.tracearr_configured);
  const seerrOn = Boolean(settings.data?.seerr_configured);
  const dueTone = s.status === 'overdue' || s.status === 'expired' ? 'text-critical' : s.status === 'due_soon' ? 'text-warning' : 'text-muted';
  const seen = [s.last_activity_at && `Active ${relative(s.last_activity_at)}`, s.last_login_at && `last signed in ${relative(s.last_login_at)}`].filter(Boolean);

  return (
    <div className="stack detail">
      <header className="detail-head">
        <Avatar name={s.name} url={s.avatar_url} large />
        <div className="detail-id">
          <div className="detail-title-row">
            <h1 className="detail-name">{s.name}</h1>
            <StatusBadge status={s.status} label={s.status_label} />
          </div>
          <div className="detail-tags">
            {s.is_admin && <span className="tag">Jellyfin admin</span>}
            {s.is_disabled && <span className="tag">{s.access_disabled_by_app ? 'Access off (Tallyfin)' : 'Disabled in Jellyfin'}</span>}
            {s.removed_from_jellyfin && <span className="tag">Removed from Jellyfin</span>}
            {seen.length > 0 && <span className="small text-muted">{seen.join(' · ')}</span>}
          </div>
        </div>
        <div className="detail-actions">
          <button className="btn" onClick={() => setEditing(true)}>
            Edit subscription
          </button>
          <button className="btn btn-primary detail-pay" onClick={() => setPaying(true)}>
            Record payment
          </button>
        </div>
      </header>

      <section className="card billing" aria-label="Billing">
        <div className="billing-fact">
          <span className="stat-label">Next payment</span>
          {s.is_paying && s.next_payment_date ? (
            <>
              <span className="billing-value">{dateShort(s.next_payment_date)}</span>
              <span className={`small ${dueTone}`}>{daysLabel(s.days_until_due)}</span>
            </>
          ) : s.status === 'exempt' || s.status === 'expired' ? (
            <>
              <span className="billing-value">Free account</span>
              <span className={`small ${s.status === 'expired' ? 'text-critical' : 'text-muted'}`}>
                {s.exempt_until ? `${s.status === 'expired' ? 'ended' : 'until'} ${dateShort(s.exempt_until)}` : 'no end date'}
              </span>
            </>
          ) : (
            <>
              <span className="billing-value text-muted">—</span>
              <span className="small text-muted">{s.plan ? OVERRIDE_LABEL[s.status_override] : 'No plan assigned'}</span>
            </>
          )}
        </div>
        <div className="billing-fact">
          <span className="stat-label">Plan</span>
          {s.plan ? (
            <>
              <span className="billing-value">{s.plan.name}</span>
              <span className="small text-muted">
                {money(s.plan.price, s.plan.currency)} every {s.plan.duration_label}
                {s.plan.duration_label !== 'month' && s.is_paying ? ` · ≈\u00a0${money(s.monthly_revenue, planCurrency)}/month` : ''}
              </span>
            </>
          ) : (
            <>
              <span className="billing-value text-muted">None</span>
              <button type="button" className="link-btn small" onClick={() => setEditing(true)}>
                Assign a plan
              </button>
            </>
          )}
        </div>
        <div className="billing-fact">
          <span className="stat-label">Last payment</span>
          {lastPayment ? (
            <>
              <span className="billing-value">{money(lastPayment.amount, lastPayment.currency)}</span>
              <span className="small text-muted">
                {dateShort(lastPayment.paid_at)}
                {lastPayment.method ? ` · ${lastPayment.method}` : ''}
              </span>
            </>
          ) : (
            <>
              <span className="billing-value text-muted">None yet</span>
              <span className="small text-muted">&nbsp;</span>
            </>
          )}
        </div>
        <div className="billing-fact">
          <span className="stat-label">Paid in total</span>
          <span className="billing-value">{money(payments.reduce((sum, p) => sum + Number(p.amount), 0), planCurrency)}</span>
          <span className="small text-muted">{s.subscription_start ? `since ${dateShort(s.subscription_start)}` : '\u00a0'}</span>
        </div>
      </section>

      <div className="detail-grid">
        <Card title="Payments" subtitle={payments.length ? `${payments.length} recorded` : undefined} className="detail-payments">
          {payments.length === 0 ? (
            <EmptyState title="No payments yet">Use “Record payment” when {s.name} pays you.</EmptyState>
          ) : (
            <PaymentList payments={payments} onDelete={(p) => deletePayment({ ...p, subscriber: s.id, subscriber_name: s.name })} />
          )}
        </Card>

        <div className="stack">
          {!s.removed_from_jellyfin && (
            <Card
              title="Jellyfin access"
              subtitle={
                s.is_disabled
                  ? s.access_disabled_by_app && s.access_disabled_at
                    ? `Turned off by Tallyfin ${relative(s.access_disabled_at)}`
                    : 'Turned off'
                  : `${s.name} can sign in`
              }
              actions={
                <button
                  className={`btn btn-sm ${s.is_disabled ? '' : 'btn-danger'}`}
                  disabled={access.isPending || !jellyfinReady}
                  title={jellyfinReady ? undefined : 'Connect Jellyfin in Settings first'}
                  onClick={() => (s.is_disabled ? access.mutate(false) : setConfirmDisable(true))}
                >
                  {access.isPending && s.is_disabled && <div className="spinner" />}
                  {s.is_disabled ? 'Turn access back on' : 'Turn off access…'}
                </button>
              }
            >
              {s.access_events.length === 0 ? (
                <p className="small text-muted">No changes recorded yet.</p>
              ) : (
                <div className="list">
                  {s.access_events.slice(0, 5).map((e) => (
                    <div className="list-item" key={e.id}>
                      <div>
                        <div className="primary">
                          {e.action === 'disabled' ? 'Turned off' : 'Turned back on'} {e.automatic ? 'automatically' : 'by you'}
                        </div>
                        <div className="secondary">
                          {e.reason}
                          {e.action === 'disabled' && (e.sessions_stopped > 0 || e.devices_removed > 0)
                            ? ` · ${plural(e.sessions_stopped, 'stream')} stopped, ${plural(e.devices_removed, 'device')} signed out`
                            : ''}
                        </div>
                      </div>
                      <div className="small text-muted nowrap">{dateShort(e.created_at)}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          <Card title="Reminders sent">
            {s.reminders.length === 0 ? (
              <p className="small text-muted">None sent to {s.name} yet.</p>
            ) : (
              <div className="list">
                {s.reminders.map((r) => (
                  <div className="list-item" key={r.id}>
                    <div>
                      <div className="primary">{reminderKind(r.kind)}</div>
                      <div className="secondary">for the payment due {dateShort(r.due_date)}</div>
                    </div>
                    <div className="small text-muted" style={{ textAlign: 'right' }}>
                      <div className="nowrap">{dateShort(r.sent_at)}</div>
                      <div>{channelList(r.channels)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Details">
            <dl className="kv">
              <dt>Billing</dt>
              <dd>{OVERRIDE_LABEL[s.status_override]}</dd>
              <dt>Contact</dt>
              <dd>{[s.contact, s.email].filter(Boolean).join(' · ') || <span className="text-muted">Not set</span>}</dd>
              {s.notes && (
                <>
                  <dt>Notes</dt>
                  <dd style={{ whiteSpace: 'pre-wrap' }}>{s.notes}</dd>
                </>
              )}
            </dl>
            <details className="advanced">
              <summary>Technical</summary>
              <dl className="kv">
                <dt>Jellyfin ID</dt>
                <dd>
                  <code>{s.jellyfin_id}</code>
                </dd>
                {s.tracearr_user_id && (
                  <>
                    <dt>Tracearr ID</dt>
                    <dd>
                      <code>{s.tracearr_user_id}</code>
                    </dd>
                  </>
                )}
                {s.seerr_user_id != null && (
                  <>
                    <dt>Seerr ID</dt>
                    <dd>
                      <code>{s.seerr_user_id}</code>
                    </dd>
                  </>
                )}
              </dl>
            </details>
          </Card>
        </div>
      </div>

      {!tracearrOn && !seerrOn ? (
        <Issue kind="not_configured" message="Watch time and requests show up here once Tracearr or Seerr is connected." />
      ) : (
        <div className="grid grid-2">
          {tracearrOn && (
            <Card title="Watching" subtitle={u?.tracearr_user_id ? `Tracearr · ${u.tracearr_username || u.tracearr_user_id}` : undefined}>
              {u?.tracearr_user_id ? (
                <dl className="kv">
                  <dt>Last 7 days</dt>
                  <dd>
                    {hours(u.hours_7d)} · {plural(u.plays_7d, 'play')}
                  </dd>
                  <dt>Last 30 days</dt>
                  <dd>
                    {hours(u.hours_30d)} · {plural(u.plays_30d, 'play')} · {plural(u.active_days_30d, 'active day')}
                  </dd>
                  <dt>All time</dt>
                  <dd>
                    {hours(u.hours_all)} · {plural(u.plays_all, 'play')}
                  </dd>
                  <dt>Transcodes (30d)</dt>
                  <dd>
                    {u.transcode_plays_30d} ({u.transcode_pct_30d}%)
                  </dd>
                  <dt>Last watched</dt>
                  <dd>{u.last_watched_at ? `${relative(u.last_watched_at)} (${dateTime(u.last_watched_at)})` : 'Not yet'}</dd>
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
                <Issue kind="no_match" message="No Tracearr user matched this Jellyfin account. Set the ID by hand in “Edit subscription”." />
              )}
            </Card>
          )}
          {seerrOn && (
            <Card title="Requests" subtitle={u?.seerr_user_id != null ? `Seerr · ${u.seerr_username || u.seerr_user_id}` : undefined}>
              {u?.seerr_user_id != null ? (
                <dl className="kv">
                  <dt>Last 30 days</dt>
                  <dd>{plural(u.seerr_requests_30d, 'request')}</dd>
                  <dt>All time</dt>
                  <dd>{plural(u.seerr_requests_total, 'request')}</dd>
                  <dt>Last request</dt>
                  <dd>{u.seerr_last_request_at ? relative(u.seerr_last_request_at) : 'Not yet'}</dd>
                </dl>
              ) : (
                <Issue kind="no_match" message="No Seerr user matched this Jellyfin account." />
              )}
            </Card>
          )}
          {tracearrOn && u?.tracearr_user_id && (
        <Card title="Recent plays" subtitle="Live from Tracearr">
          {activity.isLoading ? (
            <Spinner />
          ) : activity.error ? (
            <ErrorBanner error={activity.error} onRetry={() => activity.refetch()} retrying={activity.isFetching} />
          ) : activity.data && !activity.data.tracearr.ok ? (
            <Issue
              message={activity.data.tracearr.error ?? "Couldn't load recent plays."}
              kind={activity.data.tracearr.kind}
              detail={activity.data.tracearr.detail}
              onRetry={() => activity.refetch()}
              retrying={activity.isFetching}
            />
          ) : !activity.data || activity.data.tracearr.history.length === 0 ? (
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

          )}
          {seerrOn && u?.seerr_user_id != null && (
        <Card title="Recent requests" subtitle="Live from Seerr">
          {activity.isLoading ? (
            <Spinner />
          ) : activity.error ? (
            <EmptyState title="Not available right now" />
          ) : activity.data && !activity.data.seerr.ok ? (
            <Issue
              message={activity.data.seerr.error ?? "Couldn't load recent requests."}
              kind={activity.data.seerr.kind}
              detail={activity.data.seerr.detail}
              onRetry={() => activity.refetch()}
              retrying={activity.isFetching}
            />
          ) : !activity.data || activity.data.seerr.requests.length === 0 ? (
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
          )}
        </div>
      )}

      {/* Phones: the one thing you come here to do stays under your thumb. */}
      <div className="detail-sticky">
        <button className="btn btn-primary" onClick={() => setPaying(true)}>
          Record payment
        </button>
      </div>

      {confirmDisable && (
        <ConfirmDialog
          title={`Turn off ${s.name}'s Jellyfin access?`}
          confirmLabel="Turn off access"
          pending={access.isPending}
          error={access.isError && access.variables === true ? access.error : null}
          onConfirm={() => access.mutate(true)}
          onClose={() => {
            setConfirmDisable(false);
            access.reset();
          }}
        >
          {jellyfinConn?.state === 'error' && !access.isError && (
            <Issue compact message={`Heads up: the last sync couldn't reach Jellyfin, so this may fail. ${jellyfinConn.message ?? ''}`} kind="timeout" />
          )}
          <p>Anything {s.name} is watching stops now, every device they use is signed out, and they can't sign back in.</p>
          {settings.data?.disable_message && (
            <div className="quote">
              <div className="small text-muted">They'll see this on screen</div>
              <p>“{settings.data.disable_message}”</p>
            </div>
          )}
          <p className="small text-muted">
            You can turn access back on from this page at any time
            {settings.data?.auto_reenable_on_payment ? ', and recording a payment turns it back on automatically.' : '.'}
          </p>
        </ConfirmDialog>
      )}

      {editing && <SubscriptionModal subscriber={s} plans={plans.data ?? []} onClose={() => setEditing(false)} />}
      {paying && <PaymentModal subscriber={s} currency={currency} onClose={() => setPaying(false)} />}
    </div>
  );
}

const OVERRIDE_LABEL: Record<StatusOverride, string> = {
  '': 'Billed normally',
  exempt: 'Free account',
  paused: 'Paused (not billed)',
  cancelled: 'Cancelled',
};
