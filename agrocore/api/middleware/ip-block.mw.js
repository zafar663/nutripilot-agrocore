// Application-level IP firewall. Instantly 403s known-bad IPs, and AUTO-BLOCKS any IP
// that probes for classic attack paths (/.env, backups, /wp-admin, phpmyadmin, …).
// Owner / allow-listed / loopback IPs are never blocked. All blocks are visible and
// reversible from the Super Admin Traffic tab.
import Database from 'better-sqlite3';
import { clientIp, listAllowedIps } from './super-admin.mw.js';

function encodeOwner(email) { return String(email).replace(/@/g, '_at_').replace(/\./g, '_dot_'); }
const OWNER = process.env.SUPER_ADMIN_EMAIL || 'feednutritionmillconsulting@gmail.com';
const DB_PATH = process.env.NUTRIX_DB_PATH
  || `/var/www/nutripilot-agrocore/data/users/${encodeOwner(OWNER)}/nutrix.db`;

// Paths a legitimate user or our app never request — hitting these = a scanner/attacker.
const MALICIOUS = [
  /\/\.env/i, /\/\.git/i, /\/\.aws/i, /\/\.ssh/i, /\/\.svn/i, /\/\.htaccess/i, /\/\.DS_Store/i,
  /\/config\.(bak|old|json|php|yml|yaml)/i, /backup|\.bak\b|\.sql\b|dump\.sql/i,
  /\/wp-(admin|login|content|includes)/i, /xmlrpc\.php/i, /phpmyadmin|pma\//i,
  /\/vendor\/phpunit/i, /eval-stdin|allow_url_include/i, /\/actuator\b/i, /\/server-status/i,
  /\/cgi-bin\//i, /\/solr\//i, /\/boaform|\/goform/i, /\/\.well-known\/security/i, /\/shell|\/webshell/i,
];

function db() { return new Database(DB_PATH); }
function ensureBlockTable(d) {
  d.exec(`CREATE TABLE IF NOT EXISTS blocked_ips (
    ip TEXT PRIMARY KEY,
    reason TEXT,
    auto INTEGER DEFAULT 1,
    blocked_at TEXT DEFAULT (datetime('now')),
    hits INTEGER DEFAULT 1
  )`);
}

let _cache = new Set();
let _cacheTs = 0;
function refresh() {
  if (Date.now() - _cacheTs < 20000) return;   // 20s cache
  try { const d = db(); ensureBlockTable(d); _cache = new Set(d.prepare('SELECT ip FROM blocked_ips').all().map(r => r.ip)); d.close(); _cacheTs = Date.now(); }
  catch (_e) { /* keep old cache on error */ }
}
function protectedIps() {
  const { env, custom } = listAllowedIps();
  return new Set([...(env || []), ...(custom || []).map(r => r.ip), '127.0.0.1', '::1']);
}

export function isBlocked(ip) { refresh(); return !!ip && _cache.has(ip); }
export function blockIp(ip, reason, auto = 1) {
  if (!ip || protectedIps().has(ip)) return false;
  try {
    const d = db(); ensureBlockTable(d);
    d.prepare(`INSERT INTO blocked_ips (ip, reason, auto, blocked_at, hits) VALUES (?,?,?,datetime('now'),1)
      ON CONFLICT(ip) DO UPDATE SET hits = hits + 1`).run(ip, String(reason || '').slice(0, 120), auto ? 1 : 0);
    d.close(); _cache.add(ip); return true;
  } catch (_e) { return false; }
}
export function unblockIp(ip) {
  try { const d = db(); const r = d.prepare('DELETE FROM blocked_ips WHERE ip = ?').run(ip); d.close(); _cache.delete(ip); return r.changes > 0; }
  catch (_e) { return false; }
}
export function listBlocked() {
  try { const d = db(); ensureBlockTable(d); const rows = d.prepare('SELECT ip, reason, auto, blocked_at, hits FROM blocked_ips ORDER BY blocked_at DESC LIMIT 300').all(); d.close(); return rows; }
  catch (_e) { return []; }
}
function isMalicious(p) { return MALICIOUS.some(re => re.test(p)); }

export function ipBlockGate(req, res, next) {
  const ip = clientIp(req);
  if (isBlocked(ip)) return res.status(403).end();
  const p = req.path || req.url || '';
  if (isMalicious(p) && !protectedIps().has(ip)) {
    blockIp(ip, 'auto: probed ' + p.slice(0, 80), 1);
    return res.status(403).end();
  }
  return next();
}
