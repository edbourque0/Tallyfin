export type DurationUnit = 'day' | 'week' | 'month' | 'year';

export interface Plan {
  id: number;
  name: string;
  description: string;
  price: number;
  currency: string;
  duration_value: number;
  duration_unit: DurationUnit;
  duration_label: string;
  monthly_price: number;
  is_active: boolean;
  sort_order: number;
  subscriber_count: number;
  created_at: string;
  updated_at: string;
}

export interface Usage {
  tracearr_user_id: string;
  tracearr_username: string;
  plays_7d: number;
  plays_30d: number;
  plays_all: number;
  watch_ms_7d: number;
  watch_ms_30d: number;
  watch_ms_all: number;
  hours_7d: number;
  hours_30d: number;
  hours_all: number;
  transcode_plays_30d: number;
  transcode_pct_30d: number;
  active_days_30d: number;
  last_watched_at: string | null;
  top_genres: { genre: string; plays: number }[];
  top_titles: { title: string; plays: number }[];
  tracearr_fetched_at: string | null;
  seerr_user_id: number | null;
  seerr_username: string;
  seerr_requests_total: number;
  seerr_requests_30d: number;
  seerr_last_request_at: string | null;
  seerr_fetched_at: string | null;
}

export type SubscriptionStatus =
  | 'active'
  | 'due_soon'
  | 'overdue'
  | 'unassigned'
  | 'exempt'
  | 'paused'
  | 'cancelled';

export type StatusOverride = '' | 'exempt' | 'paused' | 'cancelled';

export interface Subscriber {
  id: number;
  jellyfin_id: string;
  name: string;
  is_admin: boolean;
  is_disabled: boolean;
  is_hidden: boolean;
  last_login_at: string | null;
  last_activity_at: string | null;
  removed_from_jellyfin: boolean;
  avatar_url: string | null;
  plan: Plan | null;
  subscription_start: string | null;
  next_payment_date: string | null;
  status_override: StatusOverride;
  email: string;
  contact: string;
  notes: string;
  tracearr_user_id: string;
  seerr_user_id: number | null;
  usage: Usage | null;
  status: SubscriptionStatus;
  status_label: string;
  days_until_due: number | null;
  monthly_revenue: number;
  is_paying: boolean;
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: number;
  subscriber: number;
  subscriber_name: string;
  plan: number | null;
  plan_name: string | null;
  amount: number;
  currency: string;
  paid_at: string;
  period_start: string | null;
  period_end: string | null;
  method: string;
  note: string;
  created_at: string;
}

export interface ReminderLogEntry {
  id: number;
  subscriber: number;
  subscriber_name: string;
  kind: string;
  due_date: string;
  sent_at: string;
  channels: string;
}

export interface SubscriberDetail extends Subscriber {
  payments: Payment[];
  reminders: ReminderLogEntry[];
}

export interface Activity {
  tracearr: {
    ok: boolean;
    error: string | null;
    history: {
      id: string;
      title: string;
      media_type: string;
      year: number | null;
      started_at: string;
      stopped_at: string | null;
      duration_ms: number | null;
      percent_complete: number | null;
      watched: boolean;
      player: string | null;
      device: string | null;
      platform: string | null;
      is_transcode: boolean | null;
      resolution: string | null;
      server_name: string;
    }[];
  };
  seerr: {
    ok: boolean;
    error: string | null;
    requests: {
      id: number;
      type: string;
      tmdb_id: number | null;
      status: string;
      media_status: string;
      is_4k: boolean;
      seasons: number[];
      created_at: string;
      title: string;
    }[];
  };
}

export interface SyncRun {
  id: number;
  started_at: string;
  finished_at: string | null;
  ok: boolean;
  triggered_by: string;
  result: Record<string, { ok: boolean; error?: string; skipped?: boolean; [key: string]: unknown }>;
}

export interface UpcomingItem {
  subscriber_id: number;
  jellyfin_id: string;
  name: string;
  plan: string | null;
  amount: string | null;
  currency: string | null;
  due_date: string | null;
  days_until_due: number;
  status: SubscriptionStatus;
  kind: string;
}

export interface NowPlayingStream {
  user_id: string;
  user_name: string;
  title: string;
  series: string | null;
  type: string;
  season: number | null;
  episode: number | null;
  device: string;
  client: string;
  paused: boolean;
  play_method: string | null;
  position_ticks: number | null;
  runtime_ticks: number | null;
}

export interface Dashboard {
  currency: string;
  counts: Record<string, number>;
  mrr: number;
  collected_this_month: number;
  collected_last_30d: number;
  revenue_by_month: { month: string; amount: number }[];
  attention: Subscriber[];
  upcoming: UpcomingItem[];
  recent_payments: Payment[];
  now_playing: { ok: boolean; streams: NowPlayingStream[]; error: string | null };
  last_sync: SyncRun | null;
  sync_running: boolean;
  configured: { jellyfin: boolean; tracearr: boolean; seerr: boolean; notifications: string[] };
}

export interface ProfitabilityRow {
  rank: number;
  subscriber_id: number;
  jellyfin_id: string;
  name: string;
  plan: string | null;
  status: SubscriptionStatus;
  is_paying: boolean;
  monthly_revenue: number;
  paid_last_12m: number;
  paid_total: number;
  hours_30d: number;
  hours_all: number;
  plays_30d: number;
  active_days_30d: number;
  transcode_pct: number;
  requests_30d: number;
  requests_total: number;
  last_watched_at: string | null;
  has_usage_data: boolean;
  usage_share_pct: number;
  allocated_cost: number;
  margin: number;
  revenue_per_hour: number | null;
  requests_per_month_value: number | null;
}

export interface Profitability {
  currency: string;
  monthly_server_cost: number;
  totals: {
    subscribers: number;
    paying: number;
    mrr: number;
    hours_30d: number;
    plays_30d: number;
    requests_30d: number;
    margin: number;
    avg_revenue_per_hour: number | null;
    free_hours_30d: number;
  };
  rows: ProfitabilityRow[];
}

export interface AppSettings {
  jellyfin_url: string;
  jellyfin_api_key: string;
  tracearr_url: string;
  tracearr_api_key: string;
  seerr_url: string;
  seerr_api_key: string;
  currency: string;
  due_soon_days: number;
  grace_days: number;
  monthly_server_cost: number;
  sync_interval_minutes: number;
  reminders_enabled: boolean;
  reminder_time: string;
  reminder_days_before: string;
  reminder_overdue_every_days: number;
  discord_webhook_url: string;
  ntfy_url: string;
  ntfy_topic: string;
  ntfy_token: string;
  gotify_url: string;
  gotify_token: string;
  telegram_bot_token: string;
  telegram_chat_id: string;
  webhook_url: string;
  email_host: string;
  email_port: number;
  email_use_tls: boolean;
  email_user: string;
  email_password: string;
  email_from: string;
  email_to: string;
  last_sync_at: string | null;
  last_reminder_run_date: string | null;
  jellyfin_configured: boolean;
  tracearr_configured: boolean;
  seerr_configured: boolean;
  notification_channels: string[];
}

export interface RemindersOverview {
  enabled: boolean;
  channels: string[];
  reminder_time: string;
  days_before: number[];
  overdue_every_days: number;
  last_run_date: string | null;
  upcoming: UpcomingItem[];
  pending: UpcomingItem[];
  log: ReminderLogEntry[];
}

export interface AuthStatus {
  setup_required: boolean;
  authenticated: boolean;
  username: string | null;
}
