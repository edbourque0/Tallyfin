import { FormEvent, InputHTMLAttributes, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { channelList, money } from '../lib/format';
import type { AppSettings } from '../lib/types';
import { Card, ConnectionBadge, ErrorBanner, Field, Issue, Spinner, useToast } from '../components/ui';

type Service = 'jellyfin' | 'tracearr' | 'seerr';

/** Unsaved edits survive moving to another page and back (the router has no navigation blocker). */
let draft: AppSettings | null = null;

function comparable(v: AppSettings | null | undefined): string {
  if (!v) return '';
  const { connections: _c, ...rest } = v;
  void _c;
  return JSON.stringify(rest);
}

export function SettingsPage() {
  const qc = useQueryClient();
  const { push: toast } = useToast();
  const query = useQuery({ queryKey: ['settings'], queryFn: () => api.get<AppSettings>('/api/settings/') });
  const [form, setForm] = useState<AppSettings | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; text: string }>>({});

  const [restored, setRestored] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);

  useEffect(() => {
    if (query.data && !form) {
      if (draft && comparable(draft) !== comparable(query.data)) {
        setForm({ ...draft, connections: query.data.connections });
        setRestored(true);
      } else setForm(query.data);
    }
  }, [query.data, form]);

  const dirty = Boolean(form && query.data && comparable(form) !== comparable(query.data));
  useEffect(() => {
    if (!form) return; // not loaded yet: leave any saved draft alone
    draft = dirty ? form : null;
  }, [dirty, form]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = useMutation({
    mutationFn: (body: Partial<AppSettings>) => api.put<AppSettings>('/api/settings/', body),
    onSuccess: (data) => {
      qc.setQueryData(['settings'], data);
      setForm(data);
      draft = null;
      setRestored(false);
      setSaveError(null);
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['reminders'] });
      qc.invalidateQueries({ queryKey: ['profitability'] });
      qc.invalidateQueries({ queryKey: ['subscribers'] });
      toast('Settings saved.', 'ok');
    },
    onError: (err: Error) => setSaveError(err),
  });

  const test = useMutation({
    mutationFn: async (service: Service) => {
      const body = {
        url: form?.[`${service}_url` as const],
        api_key: form?.[`${service}_api_key` as const],
      };
      return { service, result: await api.post<{ ok: boolean; detail: string }>(`/api/settings/test/${service}/`, body) };
    },
    onSuccess: ({ service, result }) => setTestResult((r) => ({ ...r, [service]: { ok: true, text: result.detail } })),
    onError: (err: Error, service) => setTestResult((r) => ({ ...r, [service]: { ok: false, text: err.message } })),
  });

  const testNotify = useMutation({
    mutationFn: () => api.post<{ ok: boolean; results: Record<string, string> }>('/api/settings/test-notification/'),
    onSuccess: (data) => {
      const sent = Object.entries(data.results).filter(([, r]) => r === 'ok').map(([c]) => c);
      const failed = Object.values(data.results).filter((r) => r !== 'ok');
      if (failed.length === 0) toast(`Test notification sent to ${sent.join(', ')}.`, 'ok');
      else toast(`${failed.join('. ')}.${sent.length ? ` Sent to ${sent.join(', ')}.` : ''}`, 'error');
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  if (query.isLoading || !form) return <Spinner label="Loading settings…" />;
  if (query.error) return <ErrorBanner error={query.error} onRetry={() => query.refetch()} retrying={query.isFetching} />;

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));
  const text = (key: keyof AppSettings, props: InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input value={String(form[key] ?? '')} onChange={(e) => set(key, e.target.value as never)} {...props} />
  );
  const number = (key: keyof AppSettings, props: InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input type="number" value={String(form[key] ?? '')} onChange={(e) => set(key, Number(e.target.value) as never)} {...props} />
  );
  const secret = (key: keyof AppSettings, placeholder = '') => (
    <input type="password" value={String(form[key] ?? '')} onChange={(e) => set(key, e.target.value as never)} placeholder={placeholder} autoComplete="new-password" />
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const { connections: _ignored, ...values } = form;
    void _ignored;
    save.mutate(values as AppSettings);
  };

  const connection = (service: Service, title: string, help: string, keyHelp: string) => {
    const result = testResult[service];
    const urlKey = `${service}_url` as const;
    const keyKey = `${service}_api_key` as const;
    const conn = query.data?.connections?.[service];
    return (
      <Card title={title} subtitle={help} actions={<ConnectionBadge connection={conn} />}>
        <div className="stack">
          <div className="field-row">
            <Field label="URL">{text(urlKey, { placeholder: `http://${service}:port`, type: 'url' })}</Field>
            <Field label="API key" help={keyHelp}>
              {secret(keyKey)}
            </Field>
          </div>
          <div className="row">
            <button type="button" className="btn btn-sm" onClick={() => test.mutate(service)} disabled={test.isPending || !form[urlKey]}>
              Test connection
            </button>
            {result && <span className={`small ${result.ok ? 'text-good' : 'text-critical'}`}>{result.text}</span>}
          </div>
          {conn?.state === 'error' && !result?.ok && (
            <Issue compact message={`Last sync: ${conn.message}`} kind={conn.kind} detail={conn.detail} settings={false} />
          )}
        </div>
      </Card>
    );
  };

  return (
    <div className="stack">
      <form className="stack" onSubmit={submit}>
        <p className="text-muted">Keys and passwords are stored on the server and never shown again. Leave a masked field as it is to keep it, or clear it to remove it.</p>
        {restored && (
          <Issue kind="no_match" message="Your unsaved changes from earlier are back. Save them, or discard to start over." />
        )}

        <h2 className="section-title">Connections</h2>
        <div className="grid grid-3">
          {connection('jellyfin', 'Jellyfin', 'Source of your user list, avatars and now-playing.', 'Dashboard → Administration → API Keys')}
          {connection('tracearr', 'Tracearr', 'Watch time, plays, transcodes and last-watched per user.', 'Settings → API Keys (starts with trr_pub_)')}
          {connection('seerr', 'Seerr / Jellyseerr', 'Media requests per user.', 'Settings → General → API Key')}
        </div>

        <h2 className="section-title">Billing</h2>
        <Card>
          <div className="field-row">
            <Field label="Default currency" help="ISO code used for new plans and totals.">
              {text('currency', { maxLength: 8 })}
            </Field>
            <Field label="Due-soon window (days)" help="Subscribers whose payment is due within this many days are flagged.">
              {number('due_soon_days', { min: 0 })}
            </Field>
            <Field label="Grace period (days)" help="Days after the due date before a subscriber counts as overdue.">
              {number('grace_days', { min: 0 })}
            </Field>
            <Field label="Sync interval (minutes)" help="How often the scheduler refreshes users and usage.">
              {number('sync_interval_minutes', { min: 5 })}
            </Field>
          </div>
        </Card>

        <h2 className="section-title">Running cost</h2>
        <Card subtitle="Used on the Profitability page: the monthly cost is split between subscribers by their share of watch time.">
          <div className="field-row">
            <Field label={`Electricity price (${form.currency || 'USD'} per kWh)`} help="From your utility bill, e.g. 0.12.">
              {number('electricity_price_per_kwh', { min: 0, step: 0.0001 })}
            </Field>
            <Field label="Server power draw (watts)" help="Average draw of the machine while running, e.g. 120.">
              {number('server_watts', { min: 0, step: 1 })}
            </Field>
            <Field label="Hours on per day" help="24 for an always-on server.">
              {number('server_hours_per_day', { min: 0, max: 24, step: 0.5 })}
            </Field>
            <Field label="Other monthly costs" help="Optional: domain, storage, anything not electricity.">
              {number('monthly_server_cost', { min: 0, step: 0.01 })}
            </Field>
          </div>
          <CostPreview form={form} />
        </Card>

        <h2 className="section-title">Reminders</h2>
        <Card>
          <div className="stack">
            <label className="check">
              <input type="checkbox" checked={form.reminders_enabled} onChange={(e) => set('reminders_enabled', e.target.checked)} /> Send a daily reminder digest
            </label>
            <div className="field-row">
              <Field label="Send time" help="Local server time (TZ of the backend container).">
                <input type="time" value={form.reminder_time} onChange={(e) => set('reminder_time', e.target.value)} />
              </Field>
              <Field label="Days before due date" help="Comma-separated, e.g. 7,3,1.">
                {text('reminder_days_before')}
              </Field>
              <Field label="Repeat overdue every (days)" help="After the first overdue notice. 0 = only once.">
                {number('reminder_overdue_every_days', { min: 0 })}
              </Field>
            </div>
          </div>
        </Card>

        <h2 className="section-title">Access enforcement</h2>
        <Card>
          <div className="stack">
            <label className="check">
              <input type="checkbox" checked={form.auto_disable_enabled} onChange={(e) => set('auto_disable_enabled', e.target.checked)} /> Automatically disable the Jellyfin account and log out every session when a subscription lapses
            </label>
            <p className="help">
              Applies to billed subscribers once they are past the grace period, and to exempt accounts whose “exempt until” date has passed. Jellyfin administrators are never
              disabled, and accounts you disabled manually are never re-enabled automatically. The scheduler checks every few minutes; you can also apply it from the Reminders page.
            </p>
            <div className="field-row">
              <Field label="Extra days overdue before disabling" help="Counted after the grace period. 0 = as soon as they count as overdue.">
                {number('auto_disable_after_days', { min: 0 })}
              </Field>
              <Field label="Message shown on their screens" help="Sent to their active Jellyfin sessions right before they are logged out.">
                {text('disable_message', { maxLength: 300 })}
              </Field>
            </div>
            <label className="check">
              <input type="checkbox" checked={form.auto_reenable_on_payment} onChange={(e) => set('auto_reenable_on_payment', e.target.checked)} /> Restore access automatically once a payment puts them back in good standing
            </label>
            <label className="check">
              <input type="checkbox" checked={form.notify_on_access_change} onChange={(e) => set('notify_on_access_change', e.target.checked)} /> Notify me on the configured channels when accounts are disabled or restored
            </label>
          </div>
        </Card>

        <h2 className="section-title">Notification channels</h2>
        <div className="grid grid-2">
          <Card title="Discord" subtitle="Server settings → Integrations → Webhooks">
            <Field label="Webhook URL">{secret('discord_webhook_url', 'https://discord.com/api/webhooks/…')}</Field>
          </Card>
          <Card title="Telegram" subtitle="Create a bot with @BotFather and get your chat id from @userinfobot">
            <div className="field-row">
              <Field label="Bot token">{secret('telegram_bot_token')}</Field>
              <Field label="Chat id">{text('telegram_chat_id')}</Field>
            </div>
          </Card>
          <Card title="ntfy" subtitle="Self-hosted or ntfy.sh">
            <div className="field-row">
              <Field label="Server URL">{text('ntfy_url', { placeholder: 'https://ntfy.sh' })}</Field>
              <Field label="Topic">{text('ntfy_topic')}</Field>
              <Field label="Access token (optional)">{secret('ntfy_token')}</Field>
            </div>
          </Card>
          <Card title="Gotify">
            <div className="field-row">
              <Field label="Server URL">{text('gotify_url')}</Field>
              <Field label="App token">{secret('gotify_token')}</Field>
            </div>
          </Card>
          <Card title="Email (SMTP)">
            <div className="field-row">
              <Field label="Host">{text('email_host')}</Field>
              <Field label="Port">{number('email_port', { min: 1 })}</Field>
              <Field label="Username">{text('email_user')}</Field>
              <Field label="Password">{secret('email_password')}</Field>
              <Field label="From">{text('email_from', { placeholder: 'subs@example.com' })}</Field>
              <Field label="To (comma-separated)">{text('email_to')}</Field>
            </div>
            <label className="check" style={{ marginTop: 10 }}>
              <input type="checkbox" checked={form.email_use_tls} onChange={(e) => set('email_use_tls', e.target.checked)} /> Use STARTTLS (uncheck for port 465 SSL)
            </label>
          </Card>
          <Card title="Generic webhook" subtitle="POST JSON {title, message, items} to any URL (n8n, Home Assistant…)">
            <Field label="URL">{secret('webhook_url', 'https://…')}</Field>
          </Card>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={() => testNotify.mutate()} disabled={testNotify.isPending || form.notification_channels.length === 0}>
            Send test notification
          </button>
          <span className="small text-muted">
            {form.notification_channels.length
              ? `Sends to ${channelList(form.notification_channels)}.${dirty ? ' Save first to include new channels.' : ''}`
              : 'Save a channel first.'}
          </span>
        </div>

        <div className={`savebar ${dirty || saveError ? 'is-dirty' : ''}`} role="region" aria-label="Save settings">
          {saveError ? (
            <ErrorBanner error={saveError} title="Not saved" />
          ) : (
            <span className="small text-muted">{dirty ? 'You have unsaved changes.' : 'All changes saved.'}</span>
          )}
          <div className="row">
            {dirty && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setForm(query.data ?? null);
                  draft = null;
                  setRestored(false);
                  setSaveError(null);
                }}
              >
                Discard
              </button>
            )}
            <button className="btn btn-primary" disabled={save.isPending || !dirty}>
              {save.isPending && <div className="spinner" />}
              {save.isPending ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </div>
      </form>

      <h2 className="section-title">Account</h2>
      <PasswordCard />
    </div>
  );
}

function CostPreview({ form }: { form: AppSettings }) {
  const hours = Math.min(Math.max(Number(form.server_hours_per_day) || 0, 0), 24);
  const kwh = ((Number(form.server_watts) || 0) / 1000) * hours * 30.4375;
  const electricity = kwh * (Number(form.electricity_price_per_kwh) || 0);
  const other = Number(form.monthly_server_cost) || 0;
  const total = electricity + other;
  const cur = form.currency || 'USD';
  return (
    <p className="help" style={{ marginTop: 12 }}>
      ≈ <strong>{kwh.toFixed(1)} kWh</strong> per month → <strong>{money(electricity, cur)}</strong> electricity
      {other > 0 ? ` + ${money(other, cur)} other` : ''} = <strong>{money(total, cur)}</strong> running cost per month
      {total === 0 ? ' (margin stays hidden until a cost is set)' : ''}
    </p>
  );
}

function PasswordCard() {
  const { push: toast } = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const change = useMutation({
    mutationFn: () => api.post('/api/auth/password/', { current_password: current, new_password: next }),
    onSuccess: () => {
      toast('Password changed', 'ok');
      setCurrent('');
      setNext('');
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });
  return (
    <Card title="Change password">
      <div className="field-row">
        <Field label="Current password">
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </Field>
        <Field label="New password">
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={8} />
        </Field>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button type="button" className="btn btn-sm" disabled={!current || next.length < 8 || change.isPending} onClick={() => change.mutate()}>
          Update password
        </button>
      </div>
    </Card>
  );
}
