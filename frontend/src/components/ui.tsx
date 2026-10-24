import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { SubscriptionStatus } from '../lib/types';

// ---------------------------------------------------------------- toasts

interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'error' | 'info';
}

const ToastContext = createContext<{ push: (text: string, kind?: Toast['kind']) => void }>({ push: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { id, text, kind }]);
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), kind === 'error' ? 7000 : 4000);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
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

export function ErrorBanner({ error, title }: { error: unknown; title?: string }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="banner banner-error">
      {title ? <strong>{title}: </strong> : null}
      {message}
    </div>
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={wide ? { width: 'min(760px, 100%)' } : undefined}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
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
  return { sorted, key, dir, toggle, indicator };
}
