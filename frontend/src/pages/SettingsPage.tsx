import { FormEvent, InputHTMLAttributes, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { AppSettings } from '../lib/types';
import { Card, ErrorBanner, Field, Spinner, useToast } from '../components/ui';

type Service = 'jellyfin' | 'tracearr' | 'seerr';

export function SettingsPage() {
  const qc = useQueryClient();
  const { push: toast } = useToast();
  const query = useQuery({ queryKey: ['settings'], queryFn: () => api.get<AppSettings>('/api/settings/') });
  const [form, setForm] = useState<AppSettings | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; text: string }>>({});

  useEffect(() => {
    if (query.data && !form) setForm(query.data);
  }, [query.data, form]);

  const save = useMutation({
    mutationFn: (body: Partial<AppSettings>) => api.put<AppSettings>('/api/settings/', body),
    onSuccess: (data) => {
      qc.setQueryData(['settings'], data);
      setForm(data);
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['reminders'] });
      qc.invalidateQueries({ queryKey: ['profitability'] });
      qc.invalidateQueries({ queryKey: ['subscribers'] });
      toast('Settings saved', 'ok');
    },
    onError: (err: Error) => toast(err.message, 'error'),
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
      const lines = Object.entries(data.results).map(([c, r]) => `${c}: ${r}`);
      toast(lines.join(' · '), data.ok ? 'ok' : 'error');
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  if (query.isLoading || !form) return <Spinner label="Loading settings…" />;
  if (query.error) return <ErrorBanner error={query.error} />;

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
    save.mutate(form);
  };

  const connection = (service: Service, title: string, help: string, keyHelp: string) => {
    const result = testResult[service];
    const urlKey = `${service}_url` as const;
    const keyKey = `${service}_api_key` as const;
    const configuredKey = `${service}_configured` as const;
    return (
      <Card title={title} subtitle={help} actions={form[configuredKey] ? <span className="badge badge-active">configured</span> : <span className="badge badge-neutral">not configured</span>}>
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
        </div>
      </Card>
    );
  };

  return (
    <form className="stack" onSubmit={submit}>
      <div className="row-between">
        <p className="text-muted">Secrets are stored server-side and never shown again; leave a masked field untouched to keep it, or clear it to remove it.</p>
        <button className="btn btn-primary" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save settings'}
        </button>
      </div>

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
          <Field label="Monthly server cost" help="Optional. Allocated by watch-time share on the Profitability page.">
            {number('monthly_server_cost', { min: 0, step: 0.01 })}
          </Field>
          <Field label="Sync interval (minutes)" help="How often the scheduler refreshes users and usage.">
            {number('sync_interval_minutes', { min: 5 })}
          </Field>
        </div>
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
        <span className="small text-muted">{form.notification_channels.length ? `Configured: ${form.notification_channels.join(', ')} (save first to test new channels)` : 'Save a channel first.'}</span>
      </div>

      <h2 className="section-title">Account</h2>
      <PasswordCard />

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn btn-primary" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </form>
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
