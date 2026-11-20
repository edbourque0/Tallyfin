import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { dateShort, dateTime, daysLabel, money } from '../lib/format';
import type { EnforcementOverview, EnforcementResult, RemindersOverview } from '../lib/types';
import { Banner, Card, ConfirmDialog, EmptyState, ErrorBanner, Modal, Spinner, StatusBadge, useToast } from '../components/ui';

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
  const applyEnforcement = useMutation({
    // Only the people shown in the confirmation are acted on, even if the list changed since.
    mutationFn: (ids: number[]) => api.post<EnforcementResult>('/api/enforcement/', { dry_run: false, subscriber_ids: ids }),
    onSuccess: (result) => {
      setConfirmApply(false);
      qc.invalidateQueries({ queryKey: ['enforcement'] });
      qc.invalidateQueries({ queryKey: ['subscribers'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      if (result.skipped) {
        toast(result.skipped, 'error');
        return;
      }
      const parts: string[] = [];
      if (result.disabled.length) parts.push(`Disabled ${nameList(result.disabled.map((r) => r.name))}.`);
      if (result.enabled.length) parts.push(`Restored ${nameList(result.enabled.map((r) => r.name))}.`);
      parts.push(...result.errors);
      toast(parts.join(' ') || 'Nothing changed.', result.errors.length ? 'error' : 'ok');
    },
    onError: (err: Error) => {
      setConfirmApply(false);
      toast(err.message, 'error');
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
        ? `Disable ${toDisable.length} account${toDisable.length === 1 ? '' : 's'}`
        : toEnable.length
          ? `Restore ${toEnable.length} account${toEnable.length === 1 ? '' : 's'}`
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
          title={toDisable.length ? `${applyLabel}?` : `Restore access for ${nameList(toEnable.map((p) => p.name))}?`}
          confirmLabel={applyLabel}
          tone={toDisable.length ? 'danger' : 'default'}
          pending={applyEnforcement.isPending}
          onConfirm={() => applyEnforcement.mutate([...toDisable, ...toEnable].map((p) => p.subscriber_id))}
          onClose={() => setConfirmApply(false)}
        >
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
              You can turn anyone back on from their page{enforcement.data.reenable_on_payment ? ', and recording a payment restores access automatically' : ''}.
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
        {enforcement.isLoading ? (
          <Spinner />
        ) : enforcement.error ? (
          <ErrorBanner error={enforcement.error} />
        ) : (
          <div className="grid grid-3">
            <div>
              <div className="section-title">Will be disabled</div>
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
              <div className="section-title">Will be restored</div>
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
                <div className="small text-muted">No accounts disabled or restored yet</div>
              ) : (
                <div className="list">
                  {enforcement.data!.events.slice(0, 8).map((e) => (
                    <div className="list-item" key={e.id}>
                      <div>
                        <div className="primary">
                          <Link to={`/subscribers/${e.subscriber}`}>{e.subscriber_name}</Link>{' '}
                          <span className={e.action === 'disabled' ? 'text-critical' : 'text-good'}>{e.action}</span>
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
            <dd>{d.days_before.length ? d.days_before.map((n) => `${n} day${n === 1 ? '' : 's'}`).join(', ') : 'none'}</dd>
            <dt>On the due date</dt>
            <dd>always</dd>
            <dt>When overdue</dt>
            <dd>first day, then every {d.overdue_every_days} days</dd>
            <dt>Channels</dt>
            <dd>{d.channels.length ? d.channels.join(', ') : <span className="text-critical">none</span>}</dd>
            <dt>Last run</dt>
            <dd>{d.last_run_date ? dateShort(d.last_run_date) : 'never'}</dd>
          </dl>
        </Card>

        <Card
          title="Pending today"
          subtitle="What the next digest will contain"
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
            <EmptyState title="Nothing pending">Every reminder due today has already been sent, or nobody is due.</EmptyState>
          ) : (
            <div className="list">
              {d.pending.map((item) => (
                <div className="list-item" key={`${item.subscriber_id}-${item.kind}`}>
                  <div>
                    <div className="primary">
                      <Link to={`/subscribers/${item.subscriber_id}`}>{item.name}</Link>
                    </div>
                    <div className="secondary">
                      {item.plan} · {money(item.amount, item.currency ?? undefined)} · {item.kind.replace(/_/g, ' ')}
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
                    <td>{entry.kind.replace(/_/g, ' ')}</td>
                    <td>{dateShort(entry.due_date)}</td>
                    <td className="small text-muted">{entry.channels}</td>
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
