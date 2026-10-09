export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_NAME: string;
  SESSION_TTL_SECONDS: string;
  MAX_TARGETS: string;
  MAX_PINGS_PER_TICK: string;
  BOOTSTRAP_SECRET?: string;
}
export interface Target {
  id: string; name: string; url: string; interval_minutes: number; enabled: number;
  next_run_at: string; last_run_at: string | null; last_status: number | null;
  last_duration_ms: number | null; last_error: string | null; created_at: string; updated_at: string;
}
