// Lightweight request-traffic logger + summary for the Super Admin dashboard.
// Records one row per API request (method, normalised path, status, user, ip, time)
// into traffic_log, and provides an aggregated summary. Old rows are pruned so the
// table never grows unbounded.
import Database from 'better-sqlite3';

function encodeOwner(email) { return String(email).replace(/@/g, '_at_').replace(/\./g, '_dot_'); }
const OWNER = process.env.SUPER_ADMIN_EMAIL || 'feednutritionmillconsulting@gmail.com';
const DB_PATH = process.env.NUTRIX_DB_PATH
  || `/var/www/nutripilot-agrocore/data/users/${encodeOwner(OWNER)}/nutrix.db`;
const RETENTION_DAYS = 30;

function db() { return new Database(DB_PATH); }

export function ensureTrafficTable(d) {
  d.exec(`CREATE TABLE IF NOT EXISTS traffic_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT DEFAULT (datetime('now')),
    method TEXT,
    path TEXT,
    status INTEGER,
    user TEXT,
    ip TEXT
  )`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_traffic_ts ON traffic_log(ts)`);
  d.exec(`CREATE TABLE IF NOT EXISTS login_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT DEFAULT (datetime('now')),
    email TEXT,
    ip TEXT,
    ok INTEGER,
    reason TEXT
  )`);
}

// Record a sign-in attempt (success or failure) for the Super Admin dashboard.
export function logLoginEvent(email, ok, ip, reason) {
  try {
    const d = db(); ensureTrafficTable(d);
    d.prepare(`INSERT INTO login_events (ts, email, ip, ok, reason) VALUES (datetime('now'),?,?,?,?)`)
      .run(String(email || '').toLowerCase(), String(ip || ''), ok ? 1 : 0, reason || null);
    if (Math.random() < 0.02) d.prepare(`DELETE FROM login_events WHERE ts < datetime('now','-90 days')`).run();
    d.close();
  } catch (_e) { /* never block login on logging */ }
}

// Group an endpoint path into a product module, for the "usage by module" view.
function moduleOf(p) {
  if (/^\/v1\/(analyze|optimize|nutrix-ai|formulas|prices|multimix|nutrix|enzyme|batch-analysis|copilot)/.test(p)) return 'Nutrix';
  if (p.startsWith('/v1/mill')) return 'Mill IQ';
  if (p.startsWith('/api/farmpulse')) return 'Farm Pulse';
  if (/^\/v1\/(purchase|raw-materials|price-lists|suppliers|exchange-rates)/.test(p)) return 'VendorPulse';
  if (p.startsWith('/v1/admin')) return 'Admin';
  if (p.startsWith('/v1/super-admin')) return 'Super Admin';
  if (p.startsWith('/v1/auth')) return 'Auth / Login';
  if (p.startsWith('/v1/lite')) return 'Nutrix Lite';
  return 'Other';
}

// Collapse high-cardinality path segments (ids / uuids / dates) so grouping is useful.
function normalisePath(p) {
  return String(p || '').split('?')[0].split('/').map(seg => {
    if (!seg) return seg;
    if (/^[0-9]+$/.test(seg)) return ':id';
    if (/^[0-9a-fA-F]{8}-[0-9a-fA-F-]{20,}$/.test(seg)) return ':id';
    if (/^(usr|cs|fb|pr|nx)_/.test(seg)) return ':id';
    if (seg.length > 24) return ':id';
    return seg;
  }).join('/');
}

function clientIp(req) {
  let ip = req.headers['x-real-ip']
    || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress || '';
  return String(ip).replace(/^::ffff:/, '');
}

let _tableReady = false;
export function trafficLogger(req, res, next) {
  res.on('finish', () => {
    try {
      const p = req.path || req.url || '';
      // Don't log health pings or the traffic dashboard's own polling (keeps stats clean).
      if (p === '/v1/health' || p.startsWith('/v1/super-admin/traffic')) return;
      const d = db();
      if (!_tableReady) { ensureTrafficTable(d); _tableReady = true; }
      d.prepare(`INSERT INTO traffic_log (ts, method, path, status, user, ip) VALUES (datetime('now'),?,?,?,?,?)`)
        .run(req.method, normalisePath(p), res.statusCode,
          (req.user && req.user.email) ? req.user.email : (req.apiKey ? 'api-key' : 'anonymous'),
          clientIp(req));
      // Prune occasionally (~1% of requests) to bound table size.
      if (Math.random() < 0.01) {
        d.prepare(`DELETE FROM traffic_log WHERE ts < datetime('now', ?)`).run(`-${RETENTION_DAYS} days`);
      }
      d.close();
    } catch (_e) { /* never let logging affect the request */ }
  });
  next();
}

// Aggregated summary for the Super Admin "Traffic" tab.
function emptySummary(error) {
  return {
    total: 0, last_24h: 0, last_7d: 0, today: 0, users_24h: 0, errors_24h: 0,
    per_day: [], top_endpoints: [], top_users: [], status_breakdown: [], recent: [],
    active_now: [], suspicious_paths: [], suspicious_ips: [],
    logins_today: 0, logins_failed_24h: 0, recent_logins: [], by_module: [],
    error: error || null
  };
}

export function trafficSummary() {
  let d;
  try {
  d = db(); ensureTrafficTable(d);
  const one = (sql, ...args) => d.prepare(sql).get(...args);
  const all = (sql, ...args) => d.prepare(sql).all(...args);
  const num = (r) => (r && r.n) ? r.n : 0;

  const out = {
    total:           num(one(`SELECT COUNT(*) n FROM traffic_log`)),
    last_24h:        num(one(`SELECT COUNT(*) n FROM traffic_log WHERE ts >= datetime('now','-1 day')`)),
    last_7d:         num(one(`SELECT COUNT(*) n FROM traffic_log WHERE ts >= datetime('now','-7 day')`)),
    today:           num(one(`SELECT COUNT(*) n FROM traffic_log WHERE date(ts) = date('now')`)),
    users_24h:       num(one(`SELECT COUNT(DISTINCT user) n FROM traffic_log WHERE ts >= datetime('now','-1 day') AND user NOT IN ('anonymous','api-key')`)),
    errors_24h:      num(one(`SELECT COUNT(*) n FROM traffic_log WHERE status >= 400 AND ts >= datetime('now','-1 day')`)),
    per_day:         all(`SELECT date(ts) day, COUNT(*) count FROM traffic_log WHERE ts >= datetime('now','-14 day') GROUP BY day ORDER BY day`),
    top_endpoints:   all(`SELECT path, COUNT(*) count FROM traffic_log WHERE ts >= datetime('now','-7 day') GROUP BY path ORDER BY count DESC LIMIT 12`),
    top_users:       all(`SELECT user, COUNT(*) count FROM traffic_log WHERE ts >= datetime('now','-7 day') AND user NOT IN ('anonymous') GROUP BY user ORDER BY count DESC LIMIT 12`),
    status_breakdown: all(`SELECT (status/100)||'xx' bucket, COUNT(*) count FROM traffic_log WHERE ts >= datetime('now','-7 day') GROUP BY bucket ORDER BY bucket`),
    recent:          all(`SELECT ts, method, path, status, user, ip FROM traffic_log ORDER BY id DESC LIMIT 40`),

    // Who is active right now (activity in the last 15 minutes), by email.
    active_now:      all(`SELECT user AS email, COUNT(*) requests, MAX(ts) last_seen, MAX(ip) ip
                          FROM traffic_log
                          WHERE ts >= datetime('now','-15 minutes') AND user NOT IN ('anonymous','api-key')
                          GROUP BY user ORDER BY last_seen DESC`),

    // Suspicious / scanner activity: 4xx hits to paths that aren't part of the app, by anonymous callers.
    suspicious_paths: all(`SELECT path, COUNT(*) count, MAX(ip) ip FROM traffic_log
                           WHERE status = 404 AND user = 'anonymous' AND ts >= datetime('now','-7 day')
                           GROUP BY path ORDER BY count DESC LIMIT 10`),
    suspicious_ips:   all(`SELECT ip, COUNT(*) count FROM traffic_log
                           WHERE status IN (401,403,404) AND user = 'anonymous' AND ts >= datetime('now','-7 day')
                           GROUP BY ip ORDER BY count DESC LIMIT 8`),
  };

  // Sign-ins (from login_events).
  out.logins_today   = num(one(`SELECT COUNT(*) n FROM login_events WHERE ok=1 AND date(ts)=date('now')`));
  out.logins_failed_24h = num(one(`SELECT COUNT(*) n FROM login_events WHERE ok=0 AND ts >= datetime('now','-1 day')`));
  out.recent_logins  = all(`SELECT ts, email, ip, ok, reason FROM login_events ORDER BY id DESC LIMIT 25`);

  // Usage by product module (last 7 days) — grouped in JS from per-path counts.
  const paths = all(`SELECT path, COUNT(*) count FROM traffic_log WHERE ts >= datetime('now','-7 day') GROUP BY path`);
  const modMap = {};
  for (const r of paths) { const m = moduleOf(r.path); modMap[m] = (modMap[m] || 0) + r.count; }
  out.by_module = Object.entries(modMap).map(([module, count]) => ({ module, count })).sort((a, b) => b.count - a.count);

  d.close();
  return out;
  } catch (e) {
    try { d && d.close(); } catch (_e) {}
    return emptySummary(e.message);
  }
}

// Full activity for one user (email) — for the Super Admin drill-down.
export function userActivity(email) {
  const d = db(); ensureTrafficTable(d);
  const e = String(email || '').toLowerCase();
  const one = (sql) => d.prepare(sql).get(e);
  const all = (sql, lim) => d.prepare(sql).all(e);

  const summary = one(`SELECT COUNT(*) requests, MIN(ts) first_seen, MAX(ts) last_seen,
    COUNT(DISTINCT path) endpoints, COUNT(DISTINCT ip) ips,
    SUM(CASE WHEN status>=400 THEN 1 ELSE 0 END) errors
    FROM traffic_log WHERE user = ?`);
  const recent    = all(`SELECT ts, method, path, status, ip FROM traffic_log WHERE user = ? ORDER BY id DESC LIMIT 60`);
  const endpoints = all(`SELECT path, COUNT(*) count FROM traffic_log WHERE user = ? GROUP BY path ORDER BY count DESC LIMIT 15`);
  const ips       = all(`SELECT ip, COUNT(*) count, MAX(ts) last_seen FROM traffic_log WHERE user = ? GROUP BY ip ORDER BY count DESC LIMIT 8`);
  const logins    = d.prepare(`SELECT ts, ip, ok, reason FROM login_events WHERE email = ? ORDER BY id DESC LIMIT 15`).all(e);

  const paths = d.prepare(`SELECT path, COUNT(*) count FROM traffic_log WHERE user = ? GROUP BY path`).all(e);
  const modMap = {};
  for (const r of paths) { const m = moduleOf(r.path); modMap[m] = (modMap[m] || 0) + r.count; }
  const by_module = Object.entries(modMap).map(([module, count]) => ({ module, count })).sort((a, b) => b.count - a.count);

  d.close();
  return { email: e, summary, recent, endpoints, ips, logins, by_module };
}
