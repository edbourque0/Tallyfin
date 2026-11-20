import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../lib/api';
import type { SubscriptionStatus } from '../lib/types';

// ---------------------------------------------------------------- toasts

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'error' | 'info';
  action?: ToastAction;
}

interface ToastOptions {
  /** Milliseconds before it disappears. Defaults: 4 s, 7 s for errors. */
  duration?: number;
  action?: ToastAction;
}

interface ToastApi {
  push: (text: string, kind?: Toast['kind'], options?: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi>({ push: () => 0, dismiss: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (text: string, kind: Toast['kind'] = 'info', options: ToastOptions = {}) => {
      const id = Date.now() + Math.random();
      setToasts((list) => [...list, { id, text, kind, action: options.action }]);
      window.setTimeout(() => dismiss(id), options.duration ?? (kind === 'error' ? 7000 : 4000));
      return id;
    },
    [dismiss],
  );
  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            <span className="toast-text">{t.text}</span>
            {t.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  t.action!.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button type="button" className="toast-close" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

// ---------------------------------------------------------------- basics

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="center">
      <div className="row">
        <div className="spinner" />
        {label && <span className="text-muted">{label}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- problems

/** Kinds that mean "the problem is in how a service is set up", so Settings is the useful next stop. */
const SETTINGS_KINDS = new Set(['unreachable', 'timeout', 'auth', 'not_found', 'bad_response', 'not_configured']);
/** Kinds that aren't failures, just missing setup: shown calm and grey, never red. */
const NEUTRAL_KINDS = new Set(['not_configured', 'no_match']);

const HINTS: Record<string, string> = {
  unreachable: 'Check that the server is running and that its URL in Settings is right.',
  timeout: 'The server may be busy or asleep. Try again in a moment.',
  auth: 'Paste a fresh API key in Settings.',
  network: 'Tallyfin itself is unreachable from this device.',
  server: '',
  crash: '',
};

const ISSUE_ICONS = {
  unplugged: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m19 5 3-3" /><path d="m2 22 3-3" /><path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z" />
      <path d="M7.5 13.5 10 11" /><path d="M10.5 16.5 13 14" /><path d="m12 6 6 6 2.3-2.3a2.4 2.4 0 0 0 0-3.4l-2.6-2.6a2.4 2.4 0 0 0-3.4 0Z" />
    </svg>
  ),
  key: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="7.5" cy="15.5" r="5.5" /><path d="m21 2-9.6 9.6" /><path d="m15.5 7.5 3 3L22 7l-3-3" />
    </svg>
  ),
  info: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />
    </svg>
  ),
  alert: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" />
    </svg>
  ),
};

function issueIcon(kind: string) {
  if (NEUTRAL_KINDS.has(kind)) return ISSUE_ICONS.info;
  if (kind === 'auth') return ISSUE_ICONS.key;
  if (kind === 'unreachable' || kind === 'timeout' || kind === 'network') return ISSUE_ICONS.unplugged;
  return ISSUE_ICONS.alert;
}

/**
 * The one way Tallyfin shows a failure: a plain sentence, a hint for this kind of failure,
 * the next steps (retry, Settings), and the raw cause folded away under "Technical details".
 */
export function Issue({
  message,
  kind = 'error',
  detail,
  onRetry,
  retrying,
  retryLabel = 'Try again',
  compact,
  settings,
}: {
  message: string;
  kind?: string | null;
  detail?: string | null;
  onRetry?: () => void;
  retrying?: boolean;
  retryLabel?: string;
  compact?: boolean;
  /** Show "Open Settings"; defaults to on for setup-related kinds. */
  settings?: boolean;
}) {
  const k = kind ?? 'error';
  const neutral = NEUTRAL_KINDS.has(k);
  const showSettings = settings ?? SETTINGS_KINDS.has(k);
  const hint = HINTS[k];
  return (
    <div className={`issue ${neutral ? 'issue-neutral' : ''} ${compact ? 'issue-compact' : ''}`} role={neutral ? undefined : 'alert'}>
      <span className="issue-icon">{issueIcon(k)}</span>
      <div className="issue-body">
        <p className="issue-message">{message}</p>
        {hint && !compact && <p className="issue-hint">{hint}</p>}
        {(onRetry || showSettings || detail) && (
          <div className="issue-actions">
            {onRetry && !neutral && (
              <button type="button" className="btn btn-sm" onClick={onRetry} disabled={retrying}>
                {retrying ? <div className="spinner" /> : null}
                {retrying ? 'Trying…' : retryLabel}
              </button>
            )}
            {showSettings && (
              <Link className="btn btn-sm btn-ghost" to="/settings">
                {neutral ? 'Set up in Settings' : 'Open Settings'}
              </Link>
            )}
            {detail && (
              <details className="issue-tech">
                <summary>Technical details</summary>
                <code>{detail}</code>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Page-level failure (a query that couldn't load). Pass onRetry so the person isn't stuck reloading. */
export function ErrorBanner({ error, title, onRetry, retrying }: { error: unknown; title?: string; onRetry?: () => void; retrying?: boolean }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  const kind = error instanceof ApiError ? error.kind : 'error';
  const technical = error instanceof ApiError ? error.technical : '';
  return (
    <Issue
      message={title ? `${title}: ${message}` : message}
      kind={kind}
      detail={technical}
      onRetry={onRetry}
      retrying={retrying}
      settings={kind === 'network' || kind === 'server' ? false : undefined}
    />
  );
}

export function Banner({ kind, children }: { kind: 'error' | 'warn' | 'info' | 'ok'; children: React.ReactNode }) {
  return <div className={`banner banner-${kind}`}>{children}</div>;
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className ?? ''}`}>
      {(title || actions) && (
        <div className="card-header">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <div className="card-sub">{subtitle}</div>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatTile({
  label,
  value,
  hint,
  hintKind,
  small,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  hintKind?: 'good' | 'critical';
  small?: boolean;
}) {
  return (
    <div className="card stat">
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${small ? 'small' : ''}`}>{value}</span>
      {hint !== undefined && <span className={`stat-hint ${hintKind ?? ''}`}>{hint}</span>}
    </div>
  );
}

const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  active: 'Active',
  due_soon: 'Due soon',
  overdue: 'Overdue',
  unassigned: 'No plan',
  exempt: 'Exempt',
  paused: 'Paused',
  cancelled: 'Cancelled',
  expired: 'Exemption expired',
};

export function StatusBadge({ status, label }: { status: SubscriptionStatus | string; label?: string }) {
  const text = label ?? STATUS_LABEL[status as SubscriptionStatus] ?? status;
  return (
    <span className={`badge badge-${status}`}>
      <span className="dot" aria-hidden />
      {text}
    </span>
  );
}

export function Avatar({ name, url, large }: { name: string; url?: string | null; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <div className={`avatar ${large ? 'lg' : ''}`} title={name}>
      {url && !failed ? <img src={url} alt="" onError={() => setFailed(true)} /> : initials || '?'}
    </div>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  // Focus moves into the dialog (an explicit [data-autofocus], else the first field), stays inside while
  // it is open, and returns to whatever opened it.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const body = dialog?.querySelector<HTMLElement>('.modal-body');
    const first =
      dialog?.querySelector<HTMLElement>('[data-autofocus]') ??
      body?.querySelector<HTMLElement>('input:not([type="hidden"]):not([disabled]), select, textarea') ??
      body?.querySelector<HTMLElement>(FOCUSABLE) ??
      dialog;
    first?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  const titleId = React.useId();
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={wide ? { width: 'min(760px, 100%)' } : undefined}
      >
        <div className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/**
 * Confirmation for actions that affect people or can't be taken back. The confirm button names the
 * consequence ("Disable 3 accounts"), never "OK"; focus starts on Cancel so Enter is the safe choice.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  tone = 'danger',
  pending,
  onConfirm,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  tone?: 'danger' | 'default';
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={pending ? () => {} : onClose}>
      <div className="confirm-body">{children}</div>
      <div className="form-actions">
        <button type="button" className="btn" onClick={onClose} disabled={pending} data-autofocus>
          Cancel
        </button>
        <button type="button" className={`btn ${tone === 'danger' ? 'btn-destructive' : 'btn-primary'}`} onClick={onConfirm} disabled={pending}>
          {pending && <div className="spinner" />}
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function Field({
  label,
  children,
  help,
}: {
  label: string;
  children: React.ReactNode;
  help?: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {help && <span className="help">{help}</span>}
    </label>
  );
}

export function Progress({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="bar-track" aria-hidden>
      <div className="bar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function useSort<T>(rows: T[], initialKey: keyof T, initialDir: 'asc' | 'desc' = 'asc') {
  const [key, setKey] = useState<keyof T>(initialKey);
  const [dir, setDir] = useState<'asc' | 'desc'>(initialDir);
  const sorted = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (av === bv) return 0;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return dir === 'asc' ? av - bv : bv - av;
      const cmp = String(av).localeCompare(String(bv), undefined, { sensitivity: 'base', numeric: true });
      return dir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [rows, key, dir]);
  const toggle = (next: keyof T, defaultDir: 'asc' | 'desc' = 'asc') => {
    if (next === key) setDir(dir === 'asc' ? 'desc' : 'asc');
    else {
      setKey(next);
      setDir(defaultDir);
    }
  };
  const indicator = (k: keyof T) => (k === key ? (dir === 'asc' ? ' ↑' : ' ↓') : '');
  const setSort = (next: keyof T, nextDir: 'asc' | 'desc') => {
    setKey(next);
    setDir(nextDir);
  };
  return { sorted, key, dir, toggle, setSort, indicator };
}

// ---------------------------------------------------------------- responsive helpers

/** Width of an element, kept current with a ResizeObserver (0 until first layout). Callback ref, so it follows remounts. */
export function useElementWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  React.useLayoutEffect(() => {
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width];
}
