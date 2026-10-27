import express from 'express';
import { getUserNpDb } from '../../../core/db/turso/turso.adapter.js';
import { randomUUID } from 'crypto';
import { learn } from '../lib/learn-hook.js';
// NOTE: release-builder helpers are imported dynamically inside the export handler
// so this module still loads on deployments whose nutrix.release.route.js does not
// export them (older builds). Avoids crashing the whole API at startup.

const router = express.Router();

// â”€â”€ Schema bootstrap (runs once per Turso DB, no-op on local SQLite) â”€â”€â”€â”€â”€â”€â”€â”€
async function ensureSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS formulas (
      id TEXT PRIMARY KEY,
      formula_id TEXT NOT NULL,
      formula_name TEXT NOT NULL,
      species TEXT,
      type TEXT,
      production TEXT,
      breed TEXT,
      phase TEXT,
      plant_id TEXT,
      formula_rows TEXT NOT NULL DEFAULT '[]',
      target_profile TEXT DEFAULT '[]',
      nutrient_profile TEXT DEFAULT '{}',
      cost_per_kg REAL DEFAULT 0,
      batch_size REAL DEFAULT 1000,
      batch_unit TEXT DEFAULT 'kg',
      status TEXT DEFAULT 'active',
      version INTEGER DEFAULT 1,
      reviewed_by TEXT,
      reviewed_at TEXT,
      approved_by TEXT,
      approved_at TEXT,
      ratio_rows TEXT DEFAULT '[]',
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      month_year TEXT DEFAULT (strftime('%Y-%m', 'now')),
      workspace TEXT DEFAULT 'nutrix'
    )
  `);
  await ensureVersionsTable(db);
  await ensureWorkspaceColumn(db);
}

// â”€â”€ Version history / audit trail â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function ensureVersionsTable(db) {
  await db.exec(`CREATE TABLE IF NOT EXISTS formula_versions (
    id TEXT PRIMARY KEY,
    formula_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    formula_name TEXT,
    formula_rows TEXT,
    target_profile TEXT,
    nutrient_profile TEXT,
    cost_per_kg REAL,
    status TEXT,
    changed_by TEXT,
    changed_at TEXT,
    note TEXT
  )`);
}

// Add approval-workflow columns if the formulas table predates them.
async function ensureWorkflowColumns(db) {
  for (const col of ['reviewed_by TEXT', 'reviewed_at TEXT', 'approved_by TEXT', 'approved_at TEXT', 'ratio_rows TEXT DEFAULT \'[]\'']) {
    try { await db.run(`ALTER TABLE formulas ADD COLUMN ${col}`, []); }
    catch (_e) { /* column already exists */ }
  }
}

async function ensureWorkspaceColumn(db) {
  try { await db.run(`ALTER TABLE formulas ADD COLUMN workspace TEXT DEFAULT 'nutrix'`, []); }
  catch (_e) { /* column already exists */ }
  try {
    await db.run(`UPDATE formulas SET workspace = 'nutrix' WHERE workspace IS NULL OR TRIM(workspace) = ''`, []);
  } catch (_e) { /* ignore */ }
}

function requestedWorkspace(req, body) {
  const raw = String(
    (body && body.workspace) ||
    req.query?.workspace ||
    req.headers['x-nutrix-workspace'] ||
    ''
  ).toLowerCase().trim();
  if (raw === 'nutrixlite' || raw === 'lite') return 'nutrixlite';
  return 'nutrix';
}

function storedWorkspace(row) {
  const w = String(row?.workspace || '').toLowerCase().trim();
  if (w === 'nutrixlite' || w === 'lite') return 'nutrixlite';
  return 'nutrix';
}

function workspaceSql() {
  return `COALESCE(NULLIF(TRIM(IFNULL(workspace,'')), ''), 'nutrix')`;
}

async function getFormulaInWorkspace(db, id, want) {
  const row = await db.get('SELECT * FROM formulas WHERE id = ?', [id]);
  if (!row) return null;
  if (storedWorkspace(row) !== want) return null;
  return row;
}

// Snapshot a freshly-saved formula row into the version history (audit trail).
async function snapshotFormula(db, row, changedBy, note) {
  if (!row) return;
  try {
    await ensureVersionsTable(db);
    await db.run(`INSERT INTO formula_versions
      (id, formula_id, version, formula_name, formula_rows, target_profile,
       nutrient_profile, cost_per_kg, status, changed_by, changed_at, note)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [randomUUID(), row.id, row.version, row.formula_name,
       row.formula_rows, row.target_profile, row.nutrient_profile,
       row.cost_per_kg, row.status, changedBy, new Date().toISOString(), note || null]
    );
  } catch (e) {
    console.error('[Formulas] snapshot failed:', e.message);
  }
}

// â”€â”€ GET /v1/formulas â€” list all formulas for user â”€â”€â”€â”€â”€â”€â”€
router.get('/v1/formulas', async (req, res) => {
  try {
    const db = getUserNpDb(req);
    await ensureSchema(db);
    const { status, species } = req.query;
    const ws = requestedWorkspace(req);
    let sql = `SELECT * FROM formulas WHERE ${workspaceSql()} = ?`;
    const params = [ws];
    if (status) { sql += ' AND status = ?'; params.push(status); }
    if (species) { sql += ' AND species = ?'; params.push(species); }
    sql += ' ORDER BY updated_at DESC';
    const rows = await db.all(sql, params);
    rows.forEach(r => {
      r.formula_rows   = JSON.parse(r.formula_rows   || '[]');
      r.target_profile = JSON.parse(r.target_profile || '[]');
      r.ratio_rows     = JSON.parse(r.ratio_rows     || '[]');
      r.nutrient_profile = JSON.parse(r.nutrient_profile || '{}');
    });
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error('[Formulas] list error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

function _costJumpInc(r) {
  return Number(r?.optimized_inclusion ?? r?.inclusion ?? 0) || 0;
}
function _costJumpPx(r) {
  return Number(r?.cost ?? r?.price ?? 0) || 0;
}
function _costJumpKey(r) {
  return String(r?.ingredient_id || r?.ingredient_code || r?.ingredient_name || '').trim().toLowerCase();
}
function _isDraftFormulaName(name) {
  const n = String(name || '').trim().toLowerCase();
  return !n || n === 'new formula' || n === 'untitled' || n === 'untitled formula' || n === 'draft' || n.startsWith('draft ');
}

router.get('/v1/formulas/_cost-jumps', async (req, res) => {
  try {
    const db = getUserNpDb(req);
    await ensureSchema(db);
    await ensureVersionsTable(db);
    const ws = requestedWorkspace(req);
    const formulas = await db.all(
      `SELECT id, formula_name, species, phase, production, cost_per_kg, status
       FROM formulas WHERE COALESCE(status,'') != 'deleted' AND ${workspaceSql()} = ?`,
      [ws]
    );
    const out = [];
    for (const f of formulas || []) {
      if (_isDraftFormulaName(f.formula_name)) continue;
      const vers = await db.all(
        `SELECT version, cost_per_kg, formula_rows, changed_at, changed_by
         FROM formula_versions WHERE formula_id = ?
         ORDER BY version DESC, changed_at DESC LIMIT 2`,
        [f.id]
      );
      if (!vers || vers.length < 2) continue;
      let currRows = [], prevRows = [];
      try { currRows = JSON.parse(vers[0].formula_rows || '[]'); } catch { currRows = []; }
      try { prevRows = JSON.parse(vers[1].formula_rows || '[]'); } catch { prevRows = []; }
      if (!Array.isArray(currRows)) currRows = [];
      if (!Array.isArray(prevRows)) prevRows = [];
      const prevMap = new Map(prevRows.map(r => [_costJumpKey(r), r]));
      const seen = new Set();
      const drivers = [];
      for (const r of currRows) {
        const k = _costJumpKey(r);
        if (!k) continue;
        seen.add(k);
        const p = prevMap.get(k);
        const inc = _costJumpInc(r);
        const pinc = p ? _costJumpInc(p) : 0;
        const px = _costJumpPx(r);
        const ppx = p ? _costJumpPx(p) : 0;
        const dInc = inc - pinc;
        const dPx = px - ppx;
        const impact = (inc * px - pinc * ppx) / 100;
        if (Math.abs(dInc) < 0.03 && Math.abs(dPx) < 1e-6 && Math.abs(impact) < 1e-6) continue;
        const why = [];
        if (Math.abs(dPx) > 1e-6) why.push('price');
        if (Math.abs(dInc) >= 0.03) why.push('inclusion');
        if (!p) why.push('added');
        drivers.push({
          name: r.ingredient_name || k,
          dInc: Math.round(dInc * 1000) / 1000,
          dPx: Math.round(dPx * 10000) / 10000,
          impact: Math.round(impact * 10000) / 10000,
          why: why.join('+') || 'change',
        });
      }
      for (const r of prevRows) {
        const k = _costJumpKey(r);
        if (!k || seen.has(k)) continue;
        const pinc = _costJumpInc(r);
        const ppx = _costJumpPx(r);
        drivers.push({
          name: r.ingredient_name || k,
          dInc: Math.round(-pinc * 1000) / 1000,
          dPx: 0,
          impact: Math.round((-pinc * ppx) / 100 * 10000) / 10000,
          why: 'removed',
        });
      }
      drivers.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
      const costNow = Number(vers[0].cost_per_kg);
      const costPrev = Number(vers[1].cost_per_kg);
      out.push({
        id: f.id,
        name: f.formula_name,
        species: f.species || '',
        phase: f.phase || f.production || '',
        costNow: Number.isFinite(costNow) ? costNow : null,
        costPrev: Number.isFinite(costPrev) ? costPrev : null,
        dCost: Number.isFinite(costNow) && Number.isFinite(costPrev)
          ? Math.round((costNow - costPrev) * 10000) / 10000 : null,
        changedAt: (vers[0].changed_at || '').toString().slice(0, 16).replace('T', ' '),
        by: vers[0].changed_by || '',
        vNow: vers[0].version,
        vPrev: vers[1].version,
        drivers: drivers.slice(0, 10),
      });
    }
    out.sort((a, b) => Math.abs(b.dCost || 0) - Math.abs(a.dCost || 0));
    res.json({ success: true, data: out });
  } catch (e) {
    console.error('[Formulas] cost-jumps error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/v1/formulas/:id', async (req, res) => {
  try {
    const db = getUserNpDb(req);
    await ensureSchema(db);
    const row = await getFormulaInWorkspace(db, req.params.id, requestedWorkspace(req));
    if (!row) return res.status(404).json({ success: false, error: 'Formula not found' });
    row.formula_rows     = JSON.parse(row.formula_rows   || '[]');
    row.target_profile   = JSON.parse(row.target_profile || '[]');
    row.ratio_rows       = JSON.parse(row.ratio_rows     || '[]');
    row.nutrient_profile = JSON.parse(row.nutrient_profile || '{}');
    res.json({ success: true, data: row });
  } catch (e) {
    console.error('[Formulas] get error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// â”€â”€ GET /v1/formulas/:id/export â€” export formula as PDF/XLSX/CSV â”€
router.get('/v1/formulas/:id/export', async (req, res) => {
  try {
    const { buildReleaseData, buildPdfBuffer, buildCsvString, buildXlsxBuffer } =
      await import('../../../api/routes/nutrix.release.route.js');
    if (typeof buildReleaseData !== 'function') {
      return res.status(501).json({ success: false, error: 'Export builder not available in this build.' });
    }
    const db = getUserNpDb(req);
    await ensureSchema(db);
    const row = await getFormulaInWorkspace(db, req.params.id, requestedWorkspace(req));
    if (!row) return res.status(404).json({ success: false, error: 'Formula not found' });

    const formulaRows = JSON.parse(row.formula_rows || '[]');
    const nutrientProfile = JSON.parse(row.nutrient_profile || '{}');
    const batchTonnes = (Number(row.batch_size) || 1000) / 1000;

    const releaseData = buildReleaseData({
      formula_name: row.formula_name,
      formula_code: row.formula_id,
      version: `v${row.version}`,
      species: row.species,
      type: row.type,
      production: row.production,
      phase: row.phase,
      batch_tonnes: batchTonnes,
      formula_rows: formulaRows.map(r => ({
        ingredient_id: r.ingredient_id,
        ingredient_name: r.ingredient_name,
        inclusion: r.inclusion,
        cost: r.cost,
      })),
      nutrient_profile: nutrientProfile,
      total_cost: row.cost_per_kg,
    });

    const format = String(req.query.format || 'pdf').toLowerCase();
    const filenameBase = (row.formula_name || 'formula').replace(/[^a-z0-9]/gi, '_');

    if (format === 'pdf') {
      const pdf = await buildPdfBuffer(releaseData);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.pdf"`);
      return res.send(pdf);
    }
    if (format === 'xlsx') {
      const buffer = buildXlsxBuffer(releaseData);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.xlsx"`);
      return res.send(buffer);
    }
    if (format === 'csv') {
      const csv = buildCsvString(releaseData);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.csv"`);
      return res.send(csv);
    }
    return res.status(400).json({ success: false, error: 'Invalid format. Use pdf, xlsx, or csv.' });
  } catch (e) {
    console.error('[Formulas] export error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// â”€â”€ POST /v1/formulas â€” save or update formula â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/v1/formulas', async (req, res) => {
  try {
    const db   = getUserNpDb(req);
    await ensureSchema(db);
    const user = req.nutrixUser || 'default';
    const body = req.body;
    if (!body.formula_name) {
      return res.status(400).json({ success: false, error: 'formula_name is required' });
    }
    const now = new Date().toISOString();
    const ws = requestedWorkspace(req, body);
    const existing = body.id
      ? await getFormulaInWorkspace(db, body.id, ws)
      : null;
    if (body.id && !existing) {
      const other = await db.get('SELECT id FROM formulas WHERE id = ?', [body.id]);
      if (other) return res.status(404).json({ success: false, error: 'Formula not found' });
    }
    await ensureWorkflowColumns(db);
    if (existing) {
      await db.run(`
        UPDATE formulas SET
          formula_id       = ?,
          formula_name     = ?,
          species          = ?,
          type             = ?,
          production       = ?,
          breed            = ?,
          phase            = ?,
          plant_id         = ?,
          formula_rows     = ?,
          target_profile   = ?,
          ratio_rows       = ?,
          nutrient_profile = ?,
          cost_per_kg      = ?,
          batch_size       = ?,
          batch_unit       = ?,
          status           = ?,
          version          = version + 1,
          updated_at       = ?
        WHERE id = ?
      `, [
        body.formula_id      || existing.formula_id,
        body.formula_name,
        body.species         || existing.species,
        body.type            || existing.type,
        body.production      || existing.production,
        body.breed           || existing.breed,
        body.phase           || existing.phase,
        body.plant_id        || existing.plant_id,
        JSON.stringify(body.formula_rows     || []),
        JSON.stringify(body.target_profile   || []),
        JSON.stringify(body.ratio_rows       || []),
        JSON.stringify(body.nutrient_profile || {}),
        body.cost_per_kg     ?? existing.cost_per_kg,
        body.batch_size      ?? existing.batch_size,
        body.batch_unit      || existing.batch_unit,
        body.status          || existing.status,
        now,
        existing.id
      ]);
      const updated = await db.get('SELECT * FROM formulas WHERE id = ?', [existing.id]);
      updated.ratio_rows = JSON.parse(updated.ratio_rows || '[]');
      await snapshotFormula(db, updated, user, body.version_note);
      learn({
        source: 'nutrix', kind: 'formula_save', user_id: user, mill_id: body.plant_id || null,
        species: body.species || updated.species,
        title: `Saved formula ${body.formula_name}`,
        text: JSON.stringify({
          formula_id: body.formula_id, species: body.species, breed: body.breed, phase: body.phase,
          cost_per_kg: body.cost_per_kg, rows: (body.formula_rows || []).slice(0, 80)
        }).slice(0, 8000),
        metadata: { action: 'updated', formula_id: body.formula_id }
      });
      return res.json({ success: true, data: updated, action: 'updated' });
    } else {
      const id = randomUUID();
      await db.run(`
        INSERT INTO formulas (
          id, formula_id, formula_name, species, type, production,
          breed, phase, plant_id, formula_rows, target_profile, ratio_rows,
          nutrient_profile, cost_per_kg, batch_size, batch_unit,
          status, version, created_by, created_at, updated_at, workspace
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)
      `, [
        id,
        body.formula_id   || id.substring(0, 8).toUpperCase(),
        body.formula_name,
        body.species      || null,
        body.type         || null,
        body.production   || null,
        body.breed        || null,
        body.phase        || null,
        body.plant_id     || null,
        JSON.stringify(body.formula_rows     || []),
        JSON.stringify(body.target_profile   || []),
        JSON.stringify(body.ratio_rows       || []),
        JSON.stringify(body.nutrient_profile || {}),
        body.cost_per_kg  ?? 0,
        body.batch_size   ?? 1000,
        body.batch_unit   || 'kg',
        'active',
        user,
        now,
        now,
        ws
      ]);
      const inserted = await db.get('SELECT * FROM formulas WHERE id = ?', [id]);
      inserted.ratio_rows = JSON.parse(inserted.ratio_rows || '[]');
      await snapshotFormula(db, inserted, user, body.version_note || 'Created');
      learn({
        source: 'nutrix', kind: 'formula_save', user_id: user, mill_id: body.plant_id || null,
        species: body.species || null,
        title: `Created formula ${body.formula_name}`,
        text: JSON.stringify({
          formula_id: body.formula_id, species: body.species, breed: body.breed, phase: body.phase,
          cost_per_kg: body.cost_per_kg, rows: (body.formula_rows || []).slice(0, 80)
        }).slice(0, 8000),
        metadata: { action: 'created' }
      });
      return res.json({ success: true, data: inserted, action: 'created' });
    }
  } catch (e) {
    console.error('[Formulas] save error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// PATCH /v1/formulas/:id/market-price — selling / market price (stored on nutrient_profile)
router.patch('/v1/formulas/:id/market-price', async (req, res) => {
  try {
    const db = getUserNpDb(req);
    await ensureSchema(db);
    const row = await getFormulaInWorkspace(db, req.params.id, requestedWorkspace(req));
    if (!row) return res.status(404).json({ success: false, error: 'Formula not found' });
    let np = {};
    try {
      np = (row.nutrient_profile && typeof row.nutrient_profile === 'object')
        ? row.nutrient_profile
        : JSON.parse(row.nutrient_profile || '{}') || {};
    } catch { np = {}; }
    const raw = req.body?.market_price;
    const n = Number(raw);
    np.market_price = (raw == null || raw === '' || !Number.isFinite(n) || n <= 0) ? null : n;
    await db.run(
      'UPDATE formulas SET nutrient_profile = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(np), new Date().toISOString(), req.params.id]
    );
    res.json({ success: true, id: req.params.id, market_price: np.market_price });
  } catch (e) {
    console.error('[Formulas] market-price error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// â”€â”€ PATCH /v1/formulas/:id/status â€” toggle active/inactive
router.patch('/v1/formulas/:id/status', async (req, res) => {
  try {
    const db = getUserNpDb(req);
    await ensureSchema(db);
    const { status } = req.body;
    if (!['active', 'inactive', 'archived'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status' });
    }
    const owned = await getFormulaInWorkspace(db, req.params.id, requestedWorkspace(req));
    if (!owned) return res.status(404).json({ success: false, error: 'Formula not found' });
    const result = await db.run(
      'UPDATE formulas SET status = ?, updated_at = ? WHERE id = ?',
      [status, new Date().toISOString(), req.params.id]
    );
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: 'Formula not found' });
    }
    res.json({ success: true, id: req.params.id, status });
  } catch (e) {
    console.error('[Formulas] status error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// â”€â”€ DELETE /v1/formulas/:id â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.delete('/v1/formulas/:id', async (req, res) => {
  try {
    const db = getUserNpDb(req);
    await ensureSchema(db);
    const owned = await getFormulaInWorkspace(db, req.params.id, requestedWorkspace(req));
    if (!owned) return res.status(404).json({ success: false, error: 'Formula not found' });
    const result = await db.run('DELETE FROM formulas WHERE id = ?', [req.params.id]);
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: 'Formula not found' });
    }
    res.json({ success: true, deleted: req.params.id });
  } catch (e) {
    console.error('[Formulas] delete error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// â”€â”€ GET /v1/formulas/active â€” list only active formulas â”€
router.get('/v1/formulas/active', async (req, res) => {
  try {
    const db = getUserNpDb(req);
    await ensureSchema(db);
    const ws = requestedWorkspace(req);
    const rows = await db.all(
      `SELECT * FROM formulas WHERE status = 'active' AND ${workspaceSql()} = ? ORDER BY updated_at DESC`, [ws]
    );
    rows.forEach(r => {
      r.formula_rows     = JSON.parse(r.formula_rows   || '[]');
      r.target_profile   = JSON.parse(r.target_profile || '[]');
      r.ratio_rows       = JSON.parse(r.ratio_rows     || '[]');
      r.nutrient_profile = JSON.parse(r.nutrient_profile || '{}');
    });
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error('[Formulas] active list error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// â”€â”€ POST /v1/formulas/copy-to-month â€” copy active formulas to next month
router.post('/v1/formulas/copy-to-month', async (req, res) => {
  try {
    const db = getUserNpDb(req);
    await ensureSchema(db);
    const { from_month, to_month } = req.body;
    if (!from_month || !to_month) {
      return res.status(400).json({ success: false, error: 'from_month and to_month required' });
    }
    const ws = requestedWorkspace(req, req.body);
    const formulas = await db.all(
      `SELECT * FROM formulas WHERE month_year = ? AND status = 'active' AND ${workspaceSql()} = ?`, [from_month, ws]
    );
    if (!formulas.length) {
      return res.status(404).json({ success: false, error: `No active formulas found in ${from_month}` });
    }
    const existing = await db.get(
      `SELECT COUNT(*) as count FROM formulas WHERE month_year = ? AND ${workspaceSql()} = ?`, [to_month, ws]
    );
    if (existing.count > 0) {
      return res.status(409).json({
        success: false,
        error: `${to_month} already has ${existing.count} formula(s). Delete them first.`
      });
    }
    const now = new Date().toISOString();
    const copied = [];
    await db.transaction(async (tx) => {
      for (const f of formulas) {
        const newId = randomUUID();
        await tx.execute({
          sql: `INSERT INTO formulas (
            id, formula_id, formula_name, species, type, production,
            breed, phase, plant_id, formula_rows, target_profile,
            nutrient_profile, cost_per_kg, batch_size, batch_unit,
            status, version, created_by, created_at, updated_at, month_year, workspace
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?)`,
          args: [newId, f.formula_id, f.formula_name, f.species, f.type, f.production,
                 f.breed, f.phase, f.plant_id, f.formula_rows, f.target_profile,
                 f.nutrient_profile, f.cost_per_kg, f.batch_size, f.batch_unit,
                 'active', f.created_by, now, now, to_month, ws]
        });
        copied.push({ id: newId, formula_name: f.formula_name });
      }
    });
    res.json({ success: true, copied: copied.length, from_month, to_month, formulas: copied });
  } catch (e) {
    console.error('[Formulas] copy-to-month error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});


function parseJsonSafe(v, fallback) {
  if (v == null || v === '') return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

function asJsonText(v, fallback) {
  if (v == null || v === '') return JSON.stringify(fallback);
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return JSON.stringify(fallback); }
}

async function copyFormulaToPeriod(db, src, opts) {
  const monthYear = String(opts.monthYear || new Date().toISOString().substring(0, 7));
  const user = opts.user || 'default';
  const now = new Date().toISOString();
  const newId = randomUUID();
  const np = { ...parseJsonSafe(src.nutrient_profile, {}) };
  np.copied_from_id = src.id;
  np.copied_from_period = src.month_year || null;
  let batchSize = src.batch_size;
  if (opts.plannedTons != null && Number.isFinite(Number(opts.plannedTons))) {
    np.planned_tons = Number(opts.plannedTons);
    batchSize = Number(opts.plannedTons) * 1000;
  }
  await db.run(`INSERT INTO formulas (
    id, formula_id, formula_name, species, type, production, breed, phase, plant_id,
    formula_rows, target_profile, nutrient_profile, cost_per_kg, batch_size, batch_unit,
    status, version, created_by, created_at, updated_at, month_year, ratio_rows, workspace
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?)`, [
    newId, src.formula_id, opts.formulaName || src.formula_name, src.species, src.type,
    src.production, src.breed, src.phase, src.plant_id,
    asJsonText(src.formula_rows, []), asJsonText(src.target_profile, []),
    JSON.stringify(np), src.cost_per_kg, batchSize, src.batch_unit,
    'draft', user, now, now, monthYear, asJsonText(src.ratio_rows, []),
    storedWorkspace(src)
  ]);
  const inserted = await db.get('SELECT * FROM formulas WHERE id = ?', [newId]);
  await snapshotFormula(db, inserted, user, `Copied from ${src.month_year || '—'} → ${monthYear}`);
  return inserted;
}

// POST /v1/formulas/open-period — copy a plant book into the next month or week
router.post('/v1/formulas/open-period', async (req, res) => {
  try {
    const db = getUserNpDb(req);
    await ensureSchema(db);
    await ensureWorkflowColumns(db);
    const user = req.nutrixUser || 'default';
    const fromPeriod = String(req.body?.from_period || req.body?.from_month || '').trim();
    const toPeriod = String(req.body?.to_period || req.body?.to_month || req.body?.month_year || '').trim();
    const plantId = String(req.body?.plant_id || '').trim();
    if (!fromPeriod || !toPeriod) {
      return res.status(400).json({ success: false, error: 'from_period and to_period are required' });
    }
    if (fromPeriod === toPeriod) {
      return res.status(400).json({ success: false, error: 'Choose a different target period.' });
    }
    const ws = requestedWorkspace(req, req.body);
    let sources = await db.all(
      `SELECT * FROM formulas WHERE month_year = ? AND IFNULL(status,'') != 'deleted' AND ${workspaceSql()} = ?`,
      [fromPeriod, ws]
    );
    if (plantId) {
      sources = sources.filter(f => !f.plant_id || f.plant_id === plantId);
    }
    const wanted = Array.isArray(req.body?.formula_ids) ? req.body.formula_ids.filter(Boolean) : null;
    if (wanted && wanted.length) sources = sources.filter(f => wanted.includes(f.id) || wanted.includes(f.formula_id));
    if (!sources.length) {
      return res.status(404).json({ success: false, error: `No formulas in ${fromPeriod} to copy.` });
    }
    let existing = await db.all(
      `SELECT formula_id FROM formulas WHERE month_year = ? AND IFNULL(status,'') != 'deleted' AND ${workspaceSql()} = ?`,
      [toPeriod, ws]
    );
    if (plantId) {
      const plantRows = await db.all(
        `SELECT formula_id, plant_id FROM formulas WHERE month_year = ? AND IFNULL(status,'') != 'deleted' AND ${workspaceSql()} = ?`,
        [toPeriod, ws]
      );
      existing = plantRows.filter(f => !f.plant_id || f.plant_id === plantId);
    }
    const taken = new Set((existing || []).map(r => r.formula_id));
    const plannedMap = req.body?.planned_tons && typeof req.body.planned_tons === 'object' ? req.body.planned_tons : {};
    const copyTons = req.body?.copy_tons !== false;
    const skipExisting = req.body?.skip_existing !== false;
    const copied = [];
    const skipped = [];
    for (const src of sources) {
      if (skipExisting && taken.has(src.formula_id)) {
        skipped.push({ id: src.id, formula_id: src.formula_id, reason: 'exists' });
        continue;
      }
      const planned = copyTons
        ? (plannedMap[src.id] ?? plannedMap[src.formula_id] ?? parseJsonSafe(src.nutrient_profile, {}).planned_tons ?? (Number(src.batch_size) > 0 ? Number(src.batch_size) / 1000 : null))
        : null;
      const inserted = await copyFormulaToPeriod(db, src, { monthYear: toPeriod, user, plannedTons: planned });
      taken.add(src.formula_id);
      copied.push({ id: inserted.id, formula_id: inserted.formula_id, formula_name: inserted.formula_name, planned_tons: planned });
    }
    res.json({
      success: true,
      from_period: fromPeriod,
      to_period: toPeriod,
      copied: copied.length,
      skipped: skipped.length,
      formulas: copied,
      skipped_formulas: skipped
    });
  } catch (e) {
    console.error('[Formulas] open-period error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /v1/formulas/:id/copy — copy one formula into a month or week (as a draft)
router.post('/v1/formulas/:id/copy', async (req, res) => {
  try {
    const db = getUserNpDb(req);
    await ensureSchema(db);
    await ensureWorkflowColumns(db);
    const user = req.nutrixUser || 'default';
    const src = await getFormulaInWorkspace(db, req.params.id, requestedWorkspace(req, req.body));
    if (!src) return res.status(404).json({ success: false, error: 'Formula not found' });
    const monthYear = String(req.body?.month_year || req.body?.to_period || new Date().toISOString().substring(0, 7));
    const planned = req.body?.planned_tons != null ? Number(req.body.planned_tons) : null;
    const inserted = await copyFormulaToPeriod(db, src, {
      monthYear, user, plannedTons: Number.isFinite(planned) ? planned : null,
      formulaName: req.body?.formula_name
    });
    res.json({ success: true, data: inserted });
  } catch (e) {
    console.error('[Formulas] copy error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// â”€â”€ PATCH /v1/formulas/:id/workflow â€” approval workflow status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// draft â†’ review â†’ approved â†’ released (records reviewer/approver + timestamp)
router.patch('/v1/formulas/:id/workflow', async (req, res) => {
  try {
    const db = getUserNpDb(req);
    await ensureSchema(db);
    const user = req.nutrixUser || 'default';
    await ensureWorkflowColumns(db);
    const status = String(req.body?.status || '');
    if (!['draft', 'review', 'approved', 'released'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid workflow status' });
    }
    const owned = await getFormulaInWorkspace(db, req.params.id, requestedWorkspace(req, req.body));
    if (!owned) return res.status(404).json({ success: false, error: 'Formula not found' });
    const now = new Date().toISOString();
    let sql = 'UPDATE formulas SET status = ?, updated_at = ?';
    const args = [status, now];
    if (status === 'review')   { sql += ', reviewed_by = ?, reviewed_at = ?'; args.push(user, now); }
    if (status === 'approved') { sql += ', approved_by = ?, approved_at = ?'; args.push(user, now); }
    sql += ' WHERE id = ?'; args.push(req.params.id);
    const result = await db.run(sql, args);
    if (result.changes === 0) return res.status(404).json({ success: false, error: 'Formula not found' });
    const updated = await db.get('SELECT * FROM formulas WHERE id = ?', [req.params.id]);
    await snapshotFormula(db, updated, user, `Status â†’ ${status}`);
    res.json({ success: true, data: updated });
  } catch (e) {
    console.error('[Formulas] workflow error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// â”€â”€ GET /v1/formulas/:id/versions â€” list version history (audit trail) â”€â”€â”€â”€â”€â”€
router.get('/v1/formulas/:id/versions', async (req, res) => {
  try {
    const db = getUserNpDb(req);
    await ensureSchema(db);
    await ensureVersionsTable(db);
    const rows = await db.all(`SELECT id, version, formula_name, cost_per_kg, status, changed_by, changed_at, note
      FROM formula_versions WHERE formula_id = ? ORDER BY version DESC, changed_at DESC`, [req.params.id]);
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// â”€â”€ GET /v1/formulas/:id/versions/:version â€” full snapshot â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/v1/formulas/:id/versions/:version', async (req, res) => {
  try {
    const db = getUserNpDb(req);
    await ensureSchema(db);
    await ensureVersionsTable(db);
    const row = await db.get(`SELECT * FROM formula_versions WHERE formula_id = ? AND version = ?
      ORDER BY changed_at DESC LIMIT 1`, [req.params.id, Number(req.params.version)]);
    if (!row) return res.status(404).json({ success: false, error: 'Version not found' });
    res.json({ success: true, data: {
      ...row,
      formula_rows: JSON.parse(row.formula_rows || '[]'),
      target_profile: JSON.parse(row.target_profile || '[]'),
      nutrient_profile: JSON.parse(row.nutrient_profile || '{}'),
    }});
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// â”€â”€ POST /v1/formulas/:id/restore â€” restore a prior version as a new version â”€
// ── GET /v1/formulas/:id/price-history ─ ingredient price snapshots across versions ─
router.get('/v1/formulas/:id/price-history', async (req, res) => {
  try {
    const db = getUserNpDb(req);
    await ensureSchema(db);
    await ensureVersionsTable(db);
    const current = await db.get('SELECT * FROM formulas WHERE id = ?', [req.params.id]);
    if (!current) return res.status(404).json({ success: false, error: 'Formula not found' });
    const versions = await db.all(
      `SELECT version, cost_per_kg, formula_rows, changed_at, changed_by
       FROM formula_versions WHERE formula_id = ?
       ORDER BY version ASC, changed_at ASC`,
      [req.params.id]
    );
    const ingMap = new Map();
    const addRows = (rows, label, date, costPerKg) => {
      for (const row of (rows || [])) {
        const key = String(row.ingredient_id || row.ingredient_code || row.ingredient_name || '').trim().toLowerCase();
        if (!key) continue;
        if (!ingMap.has(key)) ingMap.set(key, { name: row.ingredient_name || key, snapshots: [] });
        ingMap.get(key).snapshots.push({ v: label, date, cost: Number(row.cost ?? 0), inclusion: Number(row.optimized_inclusion ?? row.inclusion ?? 0), costPerKg });
      }
    };
    for (const ver of versions) {
      let rows = []; try { rows = JSON.parse(ver.formula_rows || '[]'); } catch { rows = []; }
      addRows(rows, `v${ver.version}`, ver.changed_at, ver.cost_per_kg);
    }
    let currentRows = []; try { currentRows = JSON.parse(current.formula_rows || '[]'); } catch { currentRows = []; }
    addRows(currentRows, 'current', current.updated_at, current.cost_per_kg);
    const ingredients = [];
    for (const [, val] of ingMap) {
      if (val.snapshots.some(s => s.inclusion > 0 || s.cost > 0)) ingredients.push(val);
    }
    const versionsMeta = [
      ...versions.map(v => ({ v: `v${v.version}`, date: v.changed_at, by: v.changed_by, cost_per_kg: v.cost_per_kg })),
      { v: 'current', date: current.updated_at, by: '', cost_per_kg: current.cost_per_kg }
    ];
    res.json({ success: true, data: { formula_name: current.formula_name, versions: versionsMeta, ingredients } });
  } catch (e) {
    console.error('[Formulas] price-history error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/v1/formulas/:id/restore', async (req, res) => {
  try {
    const db = getUserNpDb(req);
    await ensureSchema(db);
    const user = req.nutrixUser || 'default';
    await ensureVersionsTable(db);
    const version = Number(req.body?.version);
    const snap = await db.get(`SELECT * FROM formula_versions WHERE formula_id = ? AND version = ?
      ORDER BY changed_at DESC LIMIT 1`, [req.params.id, version]);
    if (!snap) return res.status(404).json({ success: false, error: 'Version not found' });
    const now = new Date().toISOString();
    await db.run(`UPDATE formulas SET
      formula_rows = ?, target_profile = ?, nutrient_profile = ?, cost_per_kg = ?,
      formula_name = ?, version = version + 1, updated_at = ? WHERE id = ?`,
      [snap.formula_rows, snap.target_profile, snap.nutrient_profile, snap.cost_per_kg,
       snap.formula_name, now, req.params.id]
    );
    const updated = await db.get('SELECT * FROM formulas WHERE id = ?', [req.params.id]);
    await snapshotFormula(db, updated, user, `Restored from v${version}`);
    res.json({ success: true, data: updated });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;

