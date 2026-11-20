/**
 * Every failed request becomes an ApiError whose `message` is a sentence the admin can act on.
 * `kind` drives the next step offered in the UI (retry, open Settings…); `technical` is the raw cause,
 * shown only behind a "Technical details" disclosure.
 */
export class ApiError extends Error {
  status: number;
  data: unknown;
  kind: string;
  technical: string;

  constructor(status: number, message: string, data: unknown, kind = 'error', technical = '') {
    super(message);
    this.status = status;
    this.data = data;
    this.kind = kind;
    this.technical = technical;
  }
}

/** "next_payment_date" -> "Next payment date". */
function fieldLabel(key: string): string {
  const words = key.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function ensurePeriod(text: string): string {
  const t = text.trim();
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

export const UNAUTHORIZED_EVENT = 'api:unauthorized';

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&') + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

function extractMessage(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  if (typeof record.detail === 'string') return record.detail;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    const text = Array.isArray(value) ? value.filter((v) => typeof v === 'string').join(' ') : typeof value === 'string' ? value : '';
    if (!text) continue;
    parts.push(key === 'non_field_errors' ? ensurePeriod(text) : `${fieldLabel(key)}: ${ensurePeriod(text.charAt(0).toLowerCase() + text.slice(1))}`);
  }
  return parts.length ? parts.join(' ') : null;
}

function fallbackMessage(status: number): string {
  if (status === 502 || status === 503 || status === 504)
    return `Tallyfin's server isn't responding (HTTP ${status}). It may be restarting; try again in a moment.`;
  if (status >= 500) return `Tallyfin's server hit an error (HTTP ${status}). Try again; if it keeps happening, check the backend log.`;
  if (status === 404) return 'That item no longer exists. It may have been deleted.';
  if (status === 403) return "You don't have permission to do that.";
  if (status === 429) return 'Too many requests. Wait a moment and try again.';
  return `The request failed (HTTP ${status}).`;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRFToken'] = getCookie('csrftoken') ?? '';

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch (err) {
    throw new ApiError(
      0,
      "Can't reach Tallyfin. Check your connection, or that the server is running, and try again.",
      null,
      'network',
      err instanceof Error ? err.message : String(err),
    );
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const extracted = extractMessage(data);
    const message = extracted ?? fallbackMessage(response.status);
    if (response.status === 401 || (response.status === 403 && /credentials|authenticat/i.test(message))) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
    const kind = typeof record.kind === 'string' ? record.kind : response.status >= 500 ? 'server' : 'error';
    const technical =
      typeof record.technical === 'string' && record.technical
        ? record.technical
        : extracted
          ? ''
          : `${method} ${path} -> HTTP ${response.status} ${response.statusText}`.trim();
    throw new ApiError(response.status, message, data, kind, technical);
  }
  return data as T;
}

/** Fire-and-forget DELETE that survives the page closing (used to flush pending "undo" deletes). */
function deleteOnUnload(path: string): void {
  try {
    void fetch(path, {
      method: 'DELETE',
      keepalive: true,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-CSRFToken': getCookie('csrftoken') ?? '' },
    });
  } catch {
    /* the page is going away; nothing useful to report */
  }
}

export const api = {
  deleteOnUnload,
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  del: <T>(path: string) => request<T>('DELETE', path),
};
