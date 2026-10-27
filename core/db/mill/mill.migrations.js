// ============================================================
// Feed Mill Intelligence Engine — Migrations
// nutripilot-agrocore/core/db/mill/mill.migrations.js
// ============================================================

// Per-user mill.db is created and schema-inited on first signed-in Mill IQ request
// (same pattern as Nutrix nutrix.db). Do not open a shared mill.db at startup.

export function runMillMigrations() {
  console.log('[MillMigrations] Per-user mill.db opens on first Mill IQ request (same as Nutrix nutrix.db)');
  return { ok: true, applied: 0, current_version: 1, deferred: true };
}

export function getMillMigrationStatus() {
  return {
    ok: true,
    total_migrations: 1,
    applied_count: 0,
    pending_count: 0,
    current_version: 1,
    history: [],
    note: 'Schema applied per user on first mill.db open'
  };
}
