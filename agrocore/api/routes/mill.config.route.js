// ============================================================
// Feed Mill Intelligence Engine — Mill Configuration Route
// nutripilot-agrocore/agrocore/api/routes/mill.config.route.js
// ============================================================

import express from 'express';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import {
  createMill,
  updateMill,
  getMillById,
  getMillByCode,
  getAllMills,
  deactivateMill,
  getMillConnectorSummary
} from '../../../core/services/mill/mill.config.service.cjs';
import { getInboundPulse, getMillDb, upsertInboundIndex, currentMillUser } from '../../../core/db/mill/mill.db.js';
import { zipStore } from '../../../mill-edge-kit/zip-store.mjs';

const KIT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../mill-edge-kit');
const KIT_DIST = path.join(KIT_DIR, 'dist');
const KIT_FILES = ['index.js', 'package.json', 'INSTALL.bat', 'START.bat', 'INSTALL.command', 'START.command', 'README.txt'];
const KIT_LOCKED = new Set(['index.js']);
let cachedNodeExe = null;

function millEdgeNodeRuntime() {
  if (cachedNodeExe && cachedNodeExe.length > 1000000) return cachedNodeExe;
  const nodeExe = path.join(KIT_DIR, 'runtime', 'node.exe');
  if (fs.existsSync(nodeExe) && fs.statSync(nodeExe).size > 1000000) {
    cachedNodeExe = fs.readFileSync(nodeExe);
  }
  return cachedNodeExe;
}

function ensureInboundTable(db) {
  db.prepare(`CREATE TABLE IF NOT EXISTS mill_inbound_map (
    mill_id TEXT PRIMARY KEY, format TEXT DEFAULT 'json',
    batch_field TEXT DEFAULT 'batch_number', lines_path TEXT DEFAULT 'ingredients',
    code_field TEXT DEFAULT 'code', actual_field TEXT DEFAULT 'actual_kg', unit_field TEXT,
    ingest_token TEXT, updated_at TEXT
  )`).run();
}

function millWebhookAndToken(millId) {
  const db = getMillDb();
  ensureInboundTable(db);
  let cfg = db.prepare('SELECT * FROM mill_inbound_map WHERE mill_id = ?').get(millId);
  if (!cfg) {
    cfg = {
      mill_id: millId, format: 'json', batch_field: 'batch_number', lines_path: 'ingredients',
      code_field: 'code', actual_field: 'actual_kg', unit_field: '',
      ingest_token: randomUUID().replace(/-/g, '').slice(0, 20),
      updated_at: new Date().toISOString()
    };
    db.prepare(`INSERT INTO mill_inbound_map (mill_id, format, batch_field, lines_path, code_field, actual_field, unit_field, ingest_token, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(cfg.mill_id, cfg.format, cfg.batch_field, cfg.lines_path, cfg.code_field, cfg.actual_field, cfg.unit_field, cfg.ingest_token, cfg.updated_at);
  }
  upsertInboundIndex(millId, currentMillUser(), cfg.ingest_token);
  return {
    ingest_token: cfg.ingest_token,
    webhook_url: `https://agrocoreprime.com/v1/inbound/batch/${millId}?token=${cfg.ingest_token}`
  };
}

const router = express.Router();

// ── GET /v1/mill/config ──────────────────────────────────────
// All active mills
router.get('/', (req, res) => {
  try {
    const { all } = req.query;
    const owner = (req.nutrixUser || '').toLowerCase() || null;
    const result = getAllMills(all !== 'true', owner);
    if (result?.mills?.length) {
      result.mills = result.mills.map((m) => ({ ...m, mill_edge: getInboundPulse(m.id) }));
    }
    return res.json(result);
  } catch (err) {
    console.error('[MillConfig] / error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /v1/mill/config ─────────────────────────────────────
// Create a new mill configuration
router.post('/', (req, res) => {
  try {
    const {
      mill_name,
      mill_code,
      location,
      country,
      timezone,
      currency,
      weight_unit,
      large_weight_unit,
      price_basis,
      contact_name,
      contact_phone,
      contact_email,
      capacity_tons_per_day,
      default_batch_size_tons,
      cost_per_minute_downtime,
      operating_hours,
      shift_count,
      connector_type,
      export_format,
      watch_folder_path,
      import_folder_path,
      api_base_url,
      api_key,
      recipe_endpoint,
      actuals_webhook_url,
      opc_server_url,
      opc_namespace,
      opc_tag_map_json,
      edge_agent_id,
      notes
    } = req.body;

    if (!mill_name) {
      return res.status(400).json({
        ok: false,
        error: 'mill_name is required'
      });
    }
    if (!req.nutrixUser) {
      return res.status(401).json({ ok: false, error: 'Sign in to create a plant. Plants are private to your account.' });
    }

    const result = createMill({
      mill_name,
      mill_code:               mill_code               || null,
      location:                location                || null,
      country:                 country                 || null,
      timezone:                timezone                || 'UTC',
      currency:                currency                || 'USD',
      weight_unit:             weight_unit             || 'kg',
      large_weight_unit:       large_weight_unit       || 'metric_ton',
      price_basis:             price_basis             || 'per_kg',
      contact_name:            contact_name            || null,
      contact_phone:           contact_phone           || null,
      contact_email:           contact_email           || null,
      capacity_tons_per_day:   capacity_tons_per_day   ? Number(capacity_tons_per_day)   : null,
      default_batch_size_tons: default_batch_size_tons ? Number(default_batch_size_tons) : 10,
      cost_per_minute_downtime: cost_per_minute_downtime ? Number(cost_per_minute_downtime) : 8.50,
      operating_hours:         operating_hours         ? Number(operating_hours)         : 16,
      shift_count:             shift_count             ? Number(shift_count)             : 2,
      connector_type:          connector_type          || 'manual_entry',
      export_format:           export_format           || 'csv',
      watch_folder_path:       watch_folder_path       || null,
      import_folder_path:      import_folder_path      || null,
      api_base_url:            api_base_url            || null,
      api_key:                 api_key                 || null,
      recipe_endpoint:         recipe_endpoint         || null,
      actuals_webhook_url:     actuals_webhook_url     || null,
      opc_server_url:          opc_server_url          || null,
      opc_namespace:           opc_namespace           ? Number(opc_namespace) : 2,
      opc_tag_map_json:        opc_tag_map_json        || null,
      edge_agent_id:           edge_agent_id           || null,
      notes:                   notes                   || null,
      owner_username:          String(req.nutrixUser || '').toLowerCase()
    });

    if (!result.ok) return res.status(400).json(result);
    return res.status(201).json(result);

  } catch (err) {
    console.error('[MillConfig] POST / error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/config/edge-kit/:mill_id ────────────────────
// Unique mill-edge zip for this mill (webhook already filled). Must be before /edge/:mill_id.
router.get('/edge-kit/:mill_id', (req, res) => {
  try {
    const mill = getMillById(req.params.mill_id);
    if (!mill.ok) return res.status(404).json(mill);
    const owner = String(req.nutrixUser || '').toLowerCase();
    if (String(mill.mill.owner_username || '').toLowerCase() !== owner) {
      return res.status(404).json({ ok: false, error: 'Mill not found' });
    }
    const { webhook_url } = millWebhookAndToken(req.params.mill_id);
    const watch = mill.mill.watch_folder_path || 'C:/Batching/Export';
    const unit = mill.mill.weight_unit || 'kg';
    const config = {
      webhook_url,
      mill_unit: unit,
      watch_folder: watch,
      sent_folder: './watch/sent',
      fail_folder: './watch/failed',
      recursive: true,
      filename_prefix: '',
      poll_ms: 4000,
      pull_command: '',
      extensions: ['.csv', '.json', '.txt', '.xml']
    };
    const files = KIT_FILES.map((name) => {
      const full = KIT_LOCKED.has(name) ? path.join(KIT_DIST, name) : path.join(KIT_DIR, name);
      if (!fs.existsSync(full)) {
        throw new Error(KIT_LOCKED.has(name)
          ? 'mill-edge download is not packed. Run node protect.mjs in mill-edge-kit.'
          : `mill-edge kit missing ${name}`);
      }
      return { name: `mill-edge/${name}`, data: fs.readFileSync(full) };
    });
    files.push({ name: 'mill-edge/config.json', data: Buffer.from(JSON.stringify(config, null, 2), 'utf8') });
    const nodeRuntime = millEdgeNodeRuntime();
    if (nodeRuntime) files.push({ name: 'mill-edge/runtime/node.exe', data: nodeRuntime });
    const zip = zipStore(files);
    const code = String(mill.mill.mill_code || mill.mill.mill_name || 'mill').replace(/[^\w.-]+/g, '_').slice(0, 40);
    const filename = `mill-edge-${code}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Length', String(zip.length));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    return res.end(zip);
  } catch (err) {
    console.error('[MillConfig] /edge-kit error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/config/edge/:mill_id ────────────────────────
router.get('/edge/:mill_id', (req, res) => {
  try {
    const mill = getMillById(req.params.mill_id);
    if (!mill.ok) return res.status(404).json(mill);
    return res.json({ ok: true, mill_id: req.params.mill_id, pulse: getInboundPulse(req.params.mill_id) });
  } catch (err) {
    console.error('[MillConfig] /edge error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/config/connector/:mill_id ───────────────────
// Connector summary for Send to Mill UI
// Must be before /:mill_id route
router.get('/connector/:mill_id', (req, res) => {
  try {
    const result = getMillConnectorSummary(req.params.mill_id);
    return res.json(result);
  } catch (err) {
    console.error('[MillConfig] /connector error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/config/code/:mill_code ──────────────────────
// Get mill by short code — used by Send to Mill tab
router.get('/code/:mill_code', (req, res) => {
  try {
    const result = getMillByCode(req.params.mill_code);
    if (!result.ok) return res.status(404).json(result);
    const owner = String(req.nutrixUser || '').toLowerCase();
    if (String(result.mill.owner_username || '').toLowerCase() !== owner) {
      return res.status(404).json({ ok: false, error: `Mill code ${req.params.mill_code} not found` });
    }
    return res.json(result);
  } catch (err) {
    console.error('[MillConfig] /code error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/config/:mill_id ─────────────────────────────
// Get single mill by ID
router.get('/:mill_id', (req, res) => {
  try {
    const result = getMillById(req.params.mill_id);
    if (!result.ok) return res.status(404).json(result);
    const owner = String(req.nutrixUser || '').toLowerCase();
    if (String(result.mill.owner_username || '').toLowerCase() !== owner) {
      return res.status(404).json({ ok: false, error: 'Mill not found' });
    }
    return res.json(result);
  } catch (err) {
    console.error('[MillConfig] /:mill_id error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── PATCH /v1/mill/config/:mill_id ──────────────────────────
// Update mill configuration
router.patch('/:mill_id', (req, res) => {
  try {
    const existing = getMillById(req.params.mill_id);
    if (!existing.ok) return res.status(404).json(existing);
    const owner = String(req.nutrixUser || '').toLowerCase();
    if (String(existing.mill.owner_username || '').toLowerCase() !== owner) {
      return res.status(403).json({ ok: false, error: 'This plant belongs to another account.' });
    }
    const result = updateMill(req.params.mill_id, req.body);
    if (!result.ok) return res.status(400).json(result);
    return res.json(result);
  } catch (err) {
    console.error('[MillConfig] PATCH error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── DELETE /v1/mill/config/:mill_id ─────────────────────────
// Soft delete — sets is_active = 0
router.delete('/:mill_id', (req, res) => {
  try {
    const existing = getMillById(req.params.mill_id);
    if (!existing.ok) return res.status(404).json(existing);
    const owner = String(req.nutrixUser || '').toLowerCase();
    if (String(existing.mill.owner_username || '').toLowerCase() !== owner) {
      return res.status(403).json({ ok: false, error: 'This plant belongs to another account.' });
    }
    const result = deactivateMill(req.params.mill_id);
    if (!result.ok) return res.status(404).json(result);
    return res.json(result);
  } catch (err) {
    console.error('[MillConfig] DELETE error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;