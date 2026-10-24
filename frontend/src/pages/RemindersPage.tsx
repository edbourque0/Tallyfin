import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { dateShort, dateTime, daysLabel, money } from '../lib/format';
import type { RemindersOverview } from '../lib/types';
import { Banner, Card, EmptyState, ErrorBanner, Modal, Spinner, StatusBadge, useToast } from '../components/ui';

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
        toast(failed.length ? `Sent, but ${failed.map(([c, e]) => `${c}: ${e}`).join('; ')}` : `Reminder digest sent (${result.sent} subscribers)`, failed.length ? 'error' : 'ok');
      } else toast('Nothing to send today', 'info');
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  if (query.isLoading) return <Spinner label="Loading reminders…" />;
  if (query.error) return <ErrorBanner error={query.error} />;
  const d = query.data!;

  return (
    <div className="stack">
      {!d.enabled && <Banner kind="warn">Reminders are disabled. Enable them in <Link to="/settings">Settings</Link>.</Banner>}
      {d.enabled && d.channels.length === 0 && (
        <Banner kind="warn">
          No notification channel configured: reminders are computed but cannot be delivered. <Link to="/settings">Add a channel in Settings</Link>.
        </Banner>
      )}

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
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0, color: 'var(--text-2)' }}>{preview.message}</pre>
        </Modal>
      )}
    </div>
  );
}
