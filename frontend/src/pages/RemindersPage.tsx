import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { channelList, dateShort, dateTime, daysLabel, money, plural, reminderKind } from '../lib/format';
import type { EnforcementOverview, EnforcementResult, RemindersOverview } from '../lib/types';
import { Banner, Card, ConfirmDialog, EmptyState, ErrorBanner, Issue, Modal, Spinner, StatusBadge, useToast } from '../components/ui';

interface RunResult {
  sent: number;
  dry_run?: boolean;
  title?: string;
  message?: string;
  warning?: string;
  channels?: Record<string, string>;
  skipped?: string;
}

export function RemindersPage() {
  const qc = useQueryClient();
  const { push: toast } = useToast();
  const [preview, setPreview] = useState<RunResult | null>(null);
  const query = useQuery({ queryKey: ['reminders'], queryFn: () => api.get<RemindersOverview>('/api/reminders/') });
  const enforcement = useQuery({ queryKey: ['enforcement'], queryFn: () => api.get<EnforcementOverview>('/api/enforcement/') });
  const [confirmApply, setConfirmApply] = useState(false);
  const syncNow = useMutation({
    mutationFn: () => api.post<{ started: boolean }>('/api/sync/'),
    onSuccess: (d) => {
      toast(d.started ? 'Sync started. This card updates when it finishes.' : 'A sync is already running.', 'info');
      window.setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['enforcement'] });
        qc.invalidateQueries({ queryKey: ['sync-status'] });
      }, 8000);
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });
  const applyEnforcement = useMutation({
    // Only the people shown in the confirmation are acted on, even if the list changed since.
    mutationFn: async (ids: number[]) => {
      const result = await api.post<EnforcementResult>('/api/enforcement/', { dry_run: false, subscriber_ids: ids });
      // Nothing applied at all (e.g. Jellyfin down): treat as a failure so the dialog stays open with Retry.
      if (result.skipped) throw new ApiError(200, result.skipped, result, 'not_configured');
      if (result.errors.length && !result.disabled.length && !result.enabled.length)
        throw new ApiError(200, failureSummary(result), result, result.failures?.[0]?.kind ?? 'error');
      return result;
    },
    onSuccess: (result) => {
      setConfirmApply(false);
      qc.invalidateQueries({ queryKey: ['enforcement'] });
      qc.invalidateQueries({ queryKey: ['subscribers'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      const parts: string[] = [];
      if (result.disabled.length) parts.push(`Turned off access for ${nameList(result.disabled.map((r) => r.name))}.`);
      if (result.enabled.length) parts.push(`Turned access back on for ${nameList(result.enabled.map((r) => r.name))}.`);
      if (result.errors.length) parts.push(failureSummary(result));
      toast(parts.join(' ') || 'Nothing changed.', result.errors.length ? 'error' : 'ok');
    },
  });

  const run = useMutation({
    mutationFn: (dry_run: boolean) => api.post<RunResult>('/api/reminders/', { dry_run }),
    onSuccess: (result, dry_run) => {
      if (dry_run) {
        setPreview(result);
        return;
      }
      qc.invalidateQueries({ queryKey: ['reminders'] });
      if (result.warning) toast(result.warning, 'error');
      else if (result.sent > 0) {
        const failed = Object.entries(result.channels ?? {}).filter(([, v]) => v !== 'ok');
        toast(
          failed.length
            ? `Reminder digest sent, with problems: ${failed.map(([, e]) => e).join('. ')}.`
            : `Reminder digest sent (${result.sent} subscribers).`,
          failed.length ? 'error' : 'ok',
        );
      } else toast('Nothing to send today', 'info');
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  if (query.isLoading) return <Spinner label="Loading reminders…" />;
  if (query.error) return <ErrorBanner error={query.error} onRetry={() => query.refetch()} retrying={query.isFetching} />;
  const d = query.data!;
  const toDisable = enforcement.data?.pending_disable ?? [];
  const toEnable = enforcement.data?.pending_enable ?? [];
  const applyLabel =
    toDisable.length && toEnable.length
      ? `Apply ${toDisable.length + toEnable.length} changes`
      : toDisable.length
        ? `Turn off ${toDisable.length} account${toDisable.length === 1 ? '' : 's'}`
        : toEnable.length
          ? `Turn ${toEnable.length} account${toEnable.length === 1 ? '' : 's'} back on`
          : 'Nothing to apply';

  return (
    <div className="stack">
      {!d.enabled && <Banner kind="warn">Reminders are disabled. Enable them in <Link to="/settings">Settings</Link>.</Banner>}
      {d.enabled && d.channels.length === 0 && (
        <Banner kind="warn">
          No notification channel configured: reminders are computed but cannot be delivered. <Link to="/settings">Add a channel in Settings</Link>.
        </Banner>
      )}

      {confirmApply && enforcement.data && (
        <ConfirmDialog
          title={toDisable.length ? `${applyLabel}?` : `Turn access back on for ${nameList(toEnable.map((p) => p.name))}?`}
          confirmLabel={applyLabel}
          tone={toDisable.length ? 'danger' : 'default'}
          pending={applyEnforcement.isPending}
          error={applyEnforcement.error}
          onConfirm={() => applyEnforcement.mutate([...toDisable, ...toEnable].map((p) => p.subscriber_id))}
          onClose={() => {
            setConfirmApply(false);
            applyEnforcement.reset();
          }}
        >
          {enforcement.data.jellyfin_connection?.state === 'error' && !applyEnforcement.isError && (
            <Issue compact message={`Heads up: the last sync couldn't reach Jellyfin, so this will probably fail. ${enforcement.data.jellyfin_connection.message ?? ''}`} kind="timeout" />
          )}
          {toDisable.length > 0 && (
            <div className="stack" style={{ gap: 8 }}>
              <p>
                {toDisable.length === 1 ? 'This person loses' : 'These people lose'} access to Jellyfin now. Anything they're watching stops and every device is
                signed out.
              </p>
              <ul className="confirm-people">
                {toDisable.map((p) => (
                  <li key={p.subscriber_id}>
                    <span className="strong">{p.name}</span>
                    <span className="small text-muted">{p.reason}</span>
                  </li>
                ))}
              </ul>
              {enforcement.data.disable_message && (
                <div className="quote">
                  <div className="small text-muted">They'll see this on screen</div>
                  <p>“{enforcement.data.disable_message}”</p>
                </div>
              )}
            </div>
          )}
          {toEnable.length > 0 && (
            <div className="stack" style={{ gap: 8 }}>
              <p>{toDisable.length ? 'Access comes back for:' : 'They can sign in to Jellyfin again right away.'}</p>
              {toDisable.length > 0 && (
                <ul className="confirm-people">
                  {toEnable.map((p) => (
                    <li key={p.subscriber_id}>
                      <span className="strong">{p.name}</span>
                      <span className="small text-muted">{p.reason}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {toDisable.length > 0 && (
            <p className="small text-muted">
              You can turn anyone back on from their page{enforcement.data.reenable_on_payment ? ', and recording a payment turns access back on automatically' : ''}.
            </p>
          )}
        </ConfirmDialog>
      )}

      <Card
        title="Access enforcement"
        subtitle={
          enforcement.data
            ? enforcement.data.enabled
              ? `Automatic: accounts are disabled once past the grace period${enforcement.data.after_days ? ` plus ${enforcement.data.after_days} days` : ''}, or when an exemption expires`
              : 'Automatic enforcement is off; you can still apply it manually here'
            : ''
        }
        actions={
          <div className="row">
            <Link className="btn btn-sm" to="/settings">
              Settings
            </Link>
            <button
              className={`btn btn-sm ${toDisable.length ? 'btn-danger' : ''}`}
              onClick={() => setConfirmApply(true)}
              disabled={applyEnforcement.isPending || !enforcement.data?.jellyfin_configured || (toDisable.length === 0 && toEnable.length === 0)}
            >
              {applyLabel}
              {toDisable.length + toEnable.length > 0 ? '…' : ''}
            </button>
          </div>
        }
      >
        {enforcement.data?.jellyfin_connection?.state === 'error' && (
          <div style={{ marginBottom: 16 }}>
            <Issue
              message={
                toDisable.length || toEnable.length
                  ? `Automatic enforcement is stuck: the last sync couldn't reach Jellyfin, so nobody below has been changed yet. ${enforcement.data.jellyfin_connection.message ?? ''}`
                  : `The last sync couldn't reach Jellyfin, so automatic enforcement can't act until it can. ${enforcement.data.jellyfin_connection.message ?? ''}`
              }
              kind={enforcement.data.jellyfin_connection.kind}
              detail={enforcement.data.jellyfin_connection.detail}
              onRetry={() => syncNow.mutate()}
              retrying={syncNow.isPending}
              retryLabel="Sync now"
            />
          </div>
        )}
        {enforcement.isLoading ? (
          <Spinner />
        ) : enforcement.error ? (
          <ErrorBanner error={enforcement.error} />
        ) : (
          <div className="grid grid-3">
            <div>
              <div className="section-title">Will be turned off</div>
              {enforcement.data!.pending_disable.length === 0 ? (
                <div className="small text-muted">Nobody</div>
              ) : (
                <div className="list">
                  {enforcement.data!.pending_disable.map((p) => (
                    <div className="list-item" key={p.subscriber_id}>
                      <div>
                        <div className="primary">
                          <Link to={`/subscribers/${p.subscriber_id}`}>{p.name}</Link>
                        </div>
                        <div className="secondary">{p.reason}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div className="section-title">Will be turned back on</div>
              {enforcement.data!.pending_enable.length === 0 ? (
                <div className="small text-muted">Nobody</div>
              ) : (
                <div className="list">
                  {enforcement.data!.pending_enable.map((p) => (
                    <div className="list-item" key={p.subscriber_id}>
                      <div>
                        <div className="primary">
                          <Link to={`/subscribers/${p.subscriber_id}`}>{p.name}</Link>
                        </div>
                        <div className="secondary">{p.reason}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div className="section-title">Recent changes</div>
              {enforcement.data!.events.length === 0 ? (
                <div className="small text-muted">No access changes yet</div>
              ) : (
                <div className="list">
                  {enforcement.data!.events.slice(0, 8).map((e) => (
                    <div className="list-item" key={e.id}>
                      <div>
                        <div className="primary">
                          <Link to={`/subscribers/${e.subscriber}`}>{e.subscriber_name}</Link>{' '}
                          <span className="text-muted">{e.action === 'disabled' ? 'turned off' : 'turned back on'}</span>
                        </div>
                        <div className="secondary">{e.reason}</div>
                      </div>
                      <div className="small text-muted">{dateTime(e.created_at)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      <div className="grid grid-2">
        <Card title="Schedule" actions={<Link className="btn btn-sm" to="/settings">Change</Link>}>
          <dl className="kv">
            <dt>Daily digest at</dt>
            <dd>{d.reminder_time} (server time)</dd>
            <dt>Before due date</dt>
            <dd>{d.days_before.length ? d.days_before.map((n) => plural(n, 'day')).join(', ') : 'No advance reminders'}</dd>
            <dt>On the due date</dt>
            <dd>Always</dd>
            <dt>When overdue</dt>
            <dd>{d.overdue_every_days ? `The first day, then every ${plural(d.overdue_every_days, 'day')}` : 'The first day only'}</dd>
            <dt>Sent to</dt>
            <dd>
              {d.channels.length ? (
                channelList(d.channels)
              ) : (
                <>
                  Nowhere yet. <Link to="/settings">Add a channel</Link>
                </>
              )}
            </dd>
            <dt>Last digest</dt>
            <dd>{d.last_run_date ? dateShort(d.last_run_date) : 'Not sent yet'}</dd>
          </dl>
        </Card>

        <Card
          title="Pending today"
          subtitle={d.channels.length ? 'What the next digest will contain' : 'Add a notification channel in Settings to send these'}
          actions={
            <div className="row">
              <button className="btn btn-sm" onClick={() => run.mutate(true)} disabled={run.isPending || d.pending.length === 0}>
                Preview
              </button>
              <button className="btn btn-sm btn-primary" onClick={() => run.mutate(false)} disabled={run.isPending || d.pending.length === 0 || d.channels.length === 0}>
                Send now
              </button>
            </div>
          }
        >
          {d.pending.length === 0 ? (
            <EmptyState title="Nothing to send today">Today's reminders have gone out, or nobody is due.</EmptyState>
          ) : (
            <div className="list">
              {d.pending.map((item) => (
                <div className="list-item" key={`${item.subscriber_id}-${item.kind}`}>
                  <div>
                    <div className="primary">
                      <Link to={`/subscribers/${item.subscriber_id}`}>{item.name}</Link>
                    </div>
                    <div className="secondary">
                      {item.plan} · {money(item.amount, item.currency ?? undefined)} · {reminderKind(item.kind).replace(/^Reminder: /, '')}
                    </div>
                  </div>
                  <StatusBadge status={item.status} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="Upcoming 30 days" subtitle="Everyone overdue or due within a month">
        {d.upcoming.length === 0 ? (
          <EmptyState title="No payments due in the next 30 days" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Subscriber</th>
                  <th>Plan</th>
                  <th className="num">Amount</th>
                  <th>Due</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {d.upcoming.map((item) => (
                  <tr key={item.subscriber_id}>
                    <td>
                      <Link to={`/subscribers/${item.subscriber_id}`}>{item.name}</Link>
                    </td>
                    <td>{item.plan}</td>
                    <td className="num">{money(item.amount, item.currency ?? undefined)}</td>
                    <td>
                      {dateShort(item.due_date)} <span className="small text-muted">({daysLabel(item.days_until_due)})</span>
                    </td>
                    <td>
                      <StatusBadge status={item.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Sent log" subtitle="Last 50 reminders">
        {d.log.length === 0 ? (
          <EmptyState title="No reminders sent yet" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Sent</th>
                  <th>Subscriber</th>
                  <th>Kind</th>
                  <th>Due date</th>
                  <th>Channels</th>
                </tr>
              </thead>
              <tbody>
                {d.log.map((entry) => (
                  <tr key={entry.id}>
                    <td>{dateTime(entry.sent_at)}</td>
                    <td>
                      <Link to={`/subscribers/${entry.subscriber}`}>{entry.subscriber_name}</Link>
                    </td>
                    <td>{reminderKind(entry.kind)}</td>
                    <td>{dateShort(entry.due_date)}</td>
                    <td className="small text-muted">{channelList(entry.channels)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {preview && (
        <Modal title="Digest preview" onClose={() => setPreview(null)}>
          <div className="strong">{preview.title}</div>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0, color: 'var(--muted-foreground)' }}>{preview.message}</pre>
        </Modal>
      )}
    </div>
  );
}

/** "Camille", "Camille and Jonathan", "Camille, Jonathan and Olivier". */
function nameList(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Group failures by cause: "Couldn't turn off Jonathan or Olivier R. Can't reach Jellyfin at jf.local." */
function failureSummary(result: EnforcementResult): string {
  const failures = result.failures ?? [];
  if (!failures.length) return result.errors.join(' ');
  const byCause = new Map<string, typeof failures>();
  for (const f of failures) byCause.set(`${f.action}|${f.message}`, [...(byCause.get(`${f.action}|${f.message}`) ?? []), f]);
  return Array.from(byCause.values())
    .map((group) => {
      const names = group.map((f) => f.name);
      const who = names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
      const verb = group[0].action === 'disable' ? 'turn off' : 'turn back on';
      const sep = /[.!?]$/.test(who) ? ' ' : '. ';
      return `Couldn't ${verb} ${who}${sep}${group[0].message}`;
    })
    .join(' ');
}
