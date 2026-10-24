import { FormEvent, useState } from 'react';
import { api } from '../lib/api';
import { ErrorBanner, Field } from '../components/ui';
import { Logo, Wordmark } from '../components/Logo';

export function LoginPage({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/login/', { username, password });
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <form className="card stack" onSubmit={submit}>
        <div className="brand" style={{ padding: 0 }}>
          <div className="brand-logo">
            <Logo size={40} />
          </div>
          <div>
            <div className="brand-name">
              <Wordmark />
            </div>
            <div className="brand-sub">Sign in to continue</div>
          </div>
        </div>
        <ErrorBanner error={error} />
        <Field label="Username">
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" required />
        </Field>
        <Field label="Password">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </Field>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

export function SetupPage({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError(new Error('Passwords do not match.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/setup/', { username, password });
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <form className="card stack" onSubmit={submit}>
        <div className="brand" style={{ padding: 0 }}>
          <div className="brand-logo">
            <Logo size={40} />
          </div>
          <div>
            <div className="brand-name">
              Welcome to <Wordmark />
            </div>
            <div className="brand-sub">Create the admin account for this instance</div>
          </div>
        </div>
        <p className="text-muted small">You can connect Jellyfin, Tracearr and Seerr afterwards in Settings.</p>
        <ErrorBanner error={error} />
        <Field label="Username">
          <input value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="username" />
        </Field>
        <Field label="Password" help="At least 8 characters.">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
        </Field>
        <Field label="Confirm password">
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
        </Field>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create admin account'}
        </button>
      </form>
    </div>
  );
}
