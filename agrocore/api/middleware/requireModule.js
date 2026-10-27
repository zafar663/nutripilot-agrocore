import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || (() => { throw new Error('[requireModule] JWT_SECRET env var is required'); })();

// Legacy module keys → canonical keys, so older/not-yet-refreshed JWTs keep working.
const MODULE_ALIASES = {
  'formulation': 'nutrix',
  'prices': 'nutrix',
  'lab': 'nutrix',
  'feed-mill': 'milliq',
  'purchaser': 'vendorpulse',
  'farm-pulse': 'farmpulse',
};

/**
 * Per-module access enforcement.
 *
 * Reads the authenticated user from req.user (set by apiKeyAuth where present)
 * or, as a fallback, decodes the Bearer JWT directly — so this works regardless
 * of whether a global auth middleware is mounted. The JWT is authoritative — its
 * `modules` claim cannot be forged client-side, so editing localStorage does not
 * grant API access.
 *
 * Behaviour:
 *  - No authenticated user (no/invalid token) → fall through unchanged, preserving
 *    the existing default-user / public-portal behaviour (e.g. Nutrix Lite links).
 *  - Authenticated user with the module (or 'admin') → allowed.
 *  - Authenticated user without the module → 403.
 *
 * @param {string} moduleKey  Canonical module key: nutrix | milliq | vendorpulse | farmpulse | liveiq | admin
 */
export function requireModule(...moduleKeys) {
  return function (req, res, next) {
    let user = req.user;

    // Fallback: decode the JWT ourselves if no upstream middleware set req.user.
    if (!user) {
      const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
      if (token) {
        try { user = jwt.verify(token, JWT_SECRET); } catch (_e) { user = null; }
      }
    }

    // No authenticated user — authGate already blocks unauthenticated requests to protected
    // routes, so reaching here without a user means it's a legitimately public path; pass through.
    if (!user) return next();

    const raw = Array.isArray(user.modules) ? user.modules : [];
    const modules = raw.map(k => MODULE_ALIASES[k] || k);
    if (modules.includes('admin') || moduleKeys.some(m => modules.includes(m))) {
      return next();
    }

    return res.status(403).json({
      success: false,
      error: `Your subscription does not include the "${moduleKeys[0]}" module. Contact sales to upgrade.`,
      module: moduleKeys[0],
    });
  };
}
