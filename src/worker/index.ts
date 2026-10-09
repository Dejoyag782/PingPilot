import type { Env, Target } from "./types";
import { clearSessionCookie, constantTimeEqual, getCookie, intervalAllowed, json, passwordHash, randomHex, safeError, sessionCookie, sha256, validSameOrigin, validateTargetUrl } from "./security";

const DAY_MS = 24 * 60 * 60 * 1000;
const LOG_RETENTION_DAYS = 7;
const TIMEOUT_MS = 10_000;
const UUID = () => crypto.randomUUID();

async function currentAdmin(request: Request, env: Env) {
  const token = getCookie(request, "pp_session");
  if (!token) return null;
  const idHash = await sha256(token);
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    "SELECT admins.id, admins.username FROM sessions JOIN admins ON admins.id=sessions.admin_id WHERE sessions.id_hash=? AND sessions.expires_at > ?"
  ).bind(idHash, now).first<{id:string; username:string}>();
  return row || null;
}
async function requireAdmin(request: Request, env: Env): Promise<{ admin: { id: string; username: string } } | { response: Response }> {
  const admin = await currentAdmin(request, env);
  return admin ? { admin } : { response: json({ error: "Authentication required" }, 401) };
}
async function bodyJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    if (!(request.headers.get("content-type") || "").includes("application/json")) return null;
    return await request.json() as Record<string, unknown>;
  } catch { return null; }
}
function isApi(path: string) { return path === "/api" || path.startsWith("/api/"); }

async function api(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (method === "GET" && path === "/api/health") return json({ ok: true, service: "PingPilot" });

  if (method === "POST" && path === "/api/auth/login") {
    if (!validSameOrigin(request)) return json({ error: "Invalid origin" }, 403);
    const body = await bodyJson(request);
    if (!body || typeof body.username !== "string" || typeof body.password !== "string" || body.username.length > 40 || body.password.length > 200) {
      return json({ error: "Enter a valid username and password." }, 400);
    }
    // Deliberately return the same response for unknown usernames and incorrect passwords.
    const admin = await env.DB.prepare("SELECT id, username, password_hash, password_salt FROM admins WHERE username=?").bind(body.username).first<{id:string;username:string;password_hash:string;password_salt:string}>();
    const salt = admin?.password_salt || "pingpilot-invalid-user-salt";
    const computed = await passwordHash(body.password, salt);
    if (!admin || !constantTimeEqual(computed, admin.password_hash)) return json({ error: "Invalid username or password." }, 401);
    const token = randomHex(32);
    const ttl = Math.max(3600, Math.min(30 * 86400, Number(env.SESSION_TTL_SECONDS) || 604800));
    await env.DB.prepare("INSERT INTO sessions (id_hash, admin_id, expires_at) VALUES (?, ?, ?)").bind(await sha256(token), admin.id, new Date(Date.now() + ttl * 1000).toISOString()).run();
    return json({ user: { username: admin.username } }, 200, { "set-cookie": sessionCookie(token, ttl) });
  }

  if (method === "POST" && path === "/api/auth/logout") {
    if (!validSameOrigin(request)) return json({ error: "Invalid origin" }, 403);
    const token = getCookie(request, "pp_session");
    if (token) await env.DB.prepare("DELETE FROM sessions WHERE id_hash=?").bind(await sha256(token)).run();
    return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
  }

  if (method === "GET" && path === "/api/auth/me") {
    const admin = await currentAdmin(request, env);
    return admin ? json({ authenticated: true, user: { username: admin.username } }) : json({ authenticated: false }, 401);
  }

  if (!isApi(path)) return env.ASSETS.fetch(request);
  const auth = await requireAdmin(request, env);
  if ("response" in auth) return auth.response;
  if (!validSameOrigin(request)) return json({ error: "Invalid origin" }, 403);

  if (method === "GET" && path === "/api/dashboard") {
    const [totals, recent] = await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN enabled=1 THEN 1 ELSE 0 END) active,
        SUM(CASE WHEN enabled=1 AND last_run_at IS NOT NULL AND (last_status IS NULL OR last_status < 200 OR last_status >= 400 OR last_error IS NOT NULL) THEN 1 ELSE 0 END) failing FROM targets`).first(),
      env.DB.prepare("SELECT id,target_id,target_name,target_url,requested_at,finished_at,status_code,duration_ms,success,error FROM ping_logs ORDER BY requested_at DESC LIMIT 12").all()
    ]);
    return json({ totals: { total: totals?.total || 0, active: totals?.active || 0, failing: totals?.failing || 0 }, recent: recent.results });
  }

  if (method === "GET" && path === "/api/targets") {
    const rows = await env.DB.prepare("SELECT * FROM targets ORDER BY created_at DESC").all<Target>();
    return json({ targets: rows.results });
  }

  if (method === "POST" && path === "/api/targets") {
    const body = await bodyJson(request);
    if (!body) return json({ error: "Expected JSON body." }, 400);
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
    const targetUrl = validateTargetUrl(body.url);
    if (!name) return json({ error: "Name is required." }, 400);
    if (!targetUrl) return json({ error: "Enter a valid public HTTP or HTTPS URL." }, 400);
    if (!intervalAllowed(body.interval_minutes)) return json({ error: "Choose an available interval." }, 400);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM targets").first<{n:number}>();
    const maxTargets = Math.max(1, Math.min(500, Number(env.MAX_TARGETS) || 100));
    if ((count?.n || 0) >= maxTargets) return json({ error: `Limit reached (${maxTargets} URLs).` }, 400);
    const id = UUID();
    const now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO targets (id,name,url,interval_minutes,enabled,next_run_at,created_at,updated_at)
      VALUES (?,?,?,?,1,?,?,?)`).bind(id, name, targetUrl, body.interval_minutes, now, now, now).run();
    return json({ ok: true, id }, 201);
  }

  const targetMatch = path.match(/^\/api\/targets\/([0-9a-f-]+)$/i);
  if (targetMatch && method === "PATCH") {
    const body = await bodyJson(request);
    if (!body) return json({ error: "Expected JSON body." }, 400);
    const target = await env.DB.prepare("SELECT * FROM targets WHERE id=?").bind(targetMatch[1]).first<Target>();
    if (!target) return json({ error: "URL not found." }, 404);
    const name = body.name === undefined ? target.name : (typeof body.name === "string" ? body.name.trim().slice(0,100) : "");
    const targetUrl = body.url === undefined ? target.url : validateTargetUrl(body.url);
    const interval = body.interval_minutes === undefined ? target.interval_minutes : body.interval_minutes;
    const enabled = body.enabled === undefined ? target.enabled : (body.enabled === true ? 1 : body.enabled === false ? 0 : -1);
    if (!name || !targetUrl || !intervalAllowed(interval) || (enabled !== 0 && enabled !== 1)) return json({ error: "Invalid name, URL, interval, or enabled value." }, 400);
    const now = new Date().toISOString();
    await env.DB.prepare(`UPDATE targets SET name=?,url=?,interval_minutes=?,enabled=?,next_run_at=?,updated_at=? WHERE id=?`)
      .bind(name, targetUrl, interval, enabled, enabled ? now : target.next_run_at, now, target.id).run();
    return json({ ok: true });
  }
  if (targetMatch && method === "DELETE") {
    await env.DB.prepare("DELETE FROM targets WHERE id=?").bind(targetMatch[1]).run();
    return json({ ok: true });
  }
  const runMatch = path.match(/^\/api\/targets\/([0-9a-f-]+)\/run$/i);
  if (runMatch && method === "POST") {
    const target = await env.DB.prepare("SELECT * FROM targets WHERE id=?").bind(runMatch[1]).first<Target>();
    if (!target) return json({ error: "URL not found." }, 404);
    const result = await pingTarget(env, target);
    return json(result, 200);
  }
  if (method === "GET" && path === "/api/logs") {
    const targetId = url.searchParams.get("target_id");
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit")) || 100));
    const query = targetId
      ? env.DB.prepare("SELECT * FROM ping_logs WHERE target_id=? ORDER BY requested_at DESC LIMIT ?").bind(targetId, limit)
      : env.DB.prepare("SELECT * FROM ping_logs ORDER BY requested_at DESC LIMIT ?").bind(limit);
    return json({ logs: (await query.all()).results });
  }
  return json({ error: "Not found." }, 404);
}

async function pingTarget(env: Env, target: Target) {
  const started = Date.now();
  const requestedAt = new Date(started).toISOString();
  let statusCode: number | null = null;
  let error: string | null = null;
  let success = 0;
  try {
    const safeUrl = validateTargetUrl(target.url);
    if (!safeUrl) throw new Error("URL failed safety validation.");
    const response = await fetch(safeUrl, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": "PingPilot/1.0 (+scheduled URL monitoring)" }
    });
    statusCode = response.status;
    success = response.status >= 200 && response.status < 400 ? 1 : 0;
    await response.body?.cancel();
  } catch (e) { error = safeError(e); }
  const finishedAt = new Date().toISOString();
  const duration = Date.now() - started;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO ping_logs (id,target_id,target_name,target_url,requested_at,finished_at,status_code,duration_ms,success,error)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(UUID(), target.id, target.name, target.url, requestedAt, finishedAt, statusCode, duration, success, error),
    env.DB.prepare(`UPDATE targets SET last_run_at=?,last_status=?,last_duration_ms=?,last_error=?,next_run_at=?,updated_at=? WHERE id=?`)
      .bind(finishedAt, statusCode, duration, error, new Date(Date.now() + target.interval_minutes * 60_000).toISOString(), finishedAt, target.id)
  ]);
  return { ok: success === 1, status_code: statusCode, duration_ms: duration, error };
}

async function scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
  const now = new Date(controller.scheduledTime).toISOString();
  const max = Math.max(1, Math.min(100, Number(env.MAX_PINGS_PER_TICK) || 20));
  // Each cron invocation handles a bounded batch. Overdue URLs remain eligible for the next minute.
  const due = await env.DB.prepare(`SELECT * FROM targets WHERE enabled=1 AND next_run_at <= ? ORDER BY next_run_at ASC LIMIT ?`).bind(now, max).all<Target>();
  ctx.waitUntil((async () => {
    await Promise.all(due.results.map(target => pingTarget(env, target)));
    const cutoff = new Date(Date.now() - LOG_RETENTION_DAYS * DAY_MS).toISOString();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM ping_logs WHERE requested_at < ?").bind(cutoff),
      env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(new Date().toISOString())
    ]);
  })());
}

async function handleFetch(request: Request, env: Env): Promise<Response> {
  try {
    return await api(request, env);
  } catch (e) {
    // Log the detail for `wrangler tail`, but keep it out of the response body.
    console.error(e);
    return json({ error: "Internal server error." }, 500);
  }
}

export default {
  fetch: handleFetch,
  scheduled
};
