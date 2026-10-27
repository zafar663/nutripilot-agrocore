import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { getAuthDb } from '../../core/db/auth/auth.db.js';

const JWT_SECRET = process.env.JWT_SECRET || (() => { throw new Error('[apiKeyAuth] JWT_SECRET env var is required'); })();

// In-memory token bucket, keyed by api_keys.id — resets every 60s.
const rateBuckets = new Map();

function checkRateLimit(keyId, limitPerMin) {
  const now = Date.now();
  const bucket = rateBuckets.get(keyId);
  if (!bucket || now - bucket.windowStart >= 60000) {
    rateBuckets.set(keyId, { count: 1, windowStart: now });
    return true;
  }
  if (bucket.count >= limitPerMin) return false;
  bucket.count++;
  return true;
}

// Accepts either a JWT (sets req.user from the token) or an API key
// (Authorization: Bearer np_...). Falls through unchanged when neither is present,
// so existing unauthenticated/default-user behavior keeps working.
export function apiKeyAuth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return next();

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    if (decoded.email) {
      const email = decoded.email.toLowerCase();
      req.headers['x-nutrix-user'] = email;
      // Authoritative per-user identity used by all data routes
      req.nutrixUser = decoded.super_admin ? (req.headers['x-nutrix-user'] || email) : email;
    }
    return next();
  } catch (_e) {
    // Not a valid JWT — fall through to API key check below.
  }

  if (!token.startsWith('np_')) return next();

  try {
    const db = getAuthDb();
    const keyHash = crypto.createHash('sha256').update(token).digest('hex');
    const record = db.prepare('SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL').get(keyHash);
    if (!record) {
      return res.status(401).json({ success: false, error: 'Invalid or revoked API key' });
    }
    if (!checkRateLimit(record.id, record.rate_limit_per_min)) {
      return res.status(429).json({ success: false, error: 'API rate limit exceeded' });
    }
    db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(record.id);
    req.user = { id: record.user_id, email: record.user_id, apiKey: true, scopes: JSON.parse(record.scopes || '[]') };
    req.headers['x-nutrix-user'] = record.user_id;
    req.nutrixUser = record.user_id;
    return next();
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}
