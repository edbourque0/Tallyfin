import { differenceInCalendarDays, format, formatDistanceToNowStrict, parseISO } from 'date-fns';

export function money(amount: number | string | null | undefined, currency = 'USD'): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const value = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (Number.isNaN(value)) return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export function hours(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (value === 0) return '0 h';
  if (value < 1) return `${Math.round(value * 60)} min`;
  return `${value.toFixed(value >= 100 ? 0 : 1)} h`;
}

export function dateShort(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return format(parseISO(value), 'MMM d, yyyy');
  } catch {
    return value;
  }
}

export function dateTime(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return format(parseISO(value), 'MMM d, yyyy HH:mm');
  } catch {
    return value;
  }
}

export function relative(value: string | null | undefined): string {
  if (!value) return 'never';
  try {
    return `${formatDistanceToNowStrict(parseISO(value))} ago`;
  } catch {
    return value;
  }
}

export function daysLabel(days: number | null | undefined): string {
  if (days === null || days === undefined) return '—';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 0) return `in ${days} days`;
  return `${-days} days ago`;
}

export function monthLabel(yyyyMm: string): string {
  const [year, month] = yyyyMm.split('-').map(Number);
  return format(new Date(year, month - 1, 1), 'MMM yy');
}

export function today(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

export function daysBetween(from: string, to: string): number {
  return differenceInCalendarDays(parseISO(to), parseISO(from));
}

export function percent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined) return '—';
  return `${value.toFixed(digits)}%`;
}

/** Reminder log kinds ("due_in_7", "due_today", "overdue_3") as words. */
export function reminderKind(kind: string): string {
  const due = /^due_in_(\d+)$/.exec(kind);
  if (due) return `Reminder: due in ${due[1]} day${due[1] === '1' ? '' : 's'}`;
  if (kind === 'due_today') return 'Reminder: due today';
  const late = /^overdue_(\d+)$/.exec(kind);
  if (late) return `Reminder: ${late[1]} day${late[1] === '1' ? '' : 's'} overdue`;
  if (kind === 'overdue') return 'Overdue reminder';
  const t = kind.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const CHANNEL_NAMES: Record<string, string> = {
  discord: 'Discord',
  ntfy: 'ntfy',
  gotify: 'Gotify',
  telegram: 'Telegram',
  webhook: 'Webhook',
  email: 'Email',
};

/** "discord,ntfy" -> "Discord, ntfy". Empty means it was only shown in Tallyfin. */
export function channelList(raw: string | string[] | null | undefined): string {
  const parts = (Array.isArray(raw) ? raw : (raw ?? '').split(',')).map((c) => c.trim()).filter(Boolean);
  return parts.length ? parts.map((c) => CHANNEL_NAMES[c] ?? c).join(', ') : 'In Tallyfin only';
}

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}
