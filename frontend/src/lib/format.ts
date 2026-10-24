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
