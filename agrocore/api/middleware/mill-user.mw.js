// Bind Mill IQ (and mill-backed Nutrix millmix/batching) to the signed-in user's mill.db.
import { runWithMillUser } from '../../../core/db/mill/mill.db.js';

const PREFIXES = [
  '/v1/mill',
  '/v1/batching',
  '/v1/batch-analysis',
  '/v1/inbound/config',
  '/v1/multimix',
  '/api/farmpulse',
];

function needsMillUser(p) {
  if (p.startsWith('/api/farmpulse/nutrient-library') || p.startsWith('/api/farmpulse/breed-standards')) return false;
  return PREFIXES.some(pre => p === pre || p.startsWith(pre + '/'));
}

export function millUserContext(req, res, next) {
  if (req.method === 'OPTIONS') return next();
  if (!needsMillUser(req.path)) return next();
  const signedIn = String(req.nutrixUser || '').toLowerCase().trim();
  if (!signedIn) {
    return res.status(401).json({ ok: false, error: 'Sign in required. This module’s data is private to your account.' });
  }
  if (String(req.user?.role || '').toLowerCase() === 'lab') {
    return res.status(403).json({ ok: false, error: 'Lab accounts use Lab Portal. Mill IQ is not available.' });
  }
  // Sub-users share the enterprise owner's mill / farmpulse files — never an empty personal mill.db.
  const owner = String(req.workspaceOwner || signedIn).toLowerCase().trim();
  req.nutrixUser = owner;
  runWithMillUser(owner, () => next());
}
