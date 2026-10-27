// ============================================================
// Feed Mill Intelligence Engine â€” Mill Configuration Service
// nutripilot-agrocore/core/services/mill/mill.config.service.cjs
// ============================================================

'use strict';

const { getMillDb } = require('../../db/mill/mill.db.cjs');
const { randomUUID } = require('crypto');

// â”€â”€ CREATE MILL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function createMill({
  mill_name,
  mill_code             = null,
  location              = null,
  country               = null,
  timezone              = 'UTC',
  currency              = 'USD',
  weight_unit           = 'kg',
  large_weight_unit     = 'metric_ton',
  price_basis           = 'per_kg',
  contact_name          = null,
  contact_phone         = null,
  contact_email         = null,
  capacity_tons_per_day = null,
  default_batch_size_tons = 10,
  cost_per_minute_downtime = 8.50,
  operating_hours       = 16,
  shift_count           = 2,
  connector_type        = 'manual_entry',
  export_format         = 'csv',
  watch_folder_path     = null,
  import_folder_path    = null,
  api_base_url          = null,
  api_key               = null,
  recipe_endpoint       = null,
  actuals_webhook_url   = null,
  opc_server_url        = null,
  opc_namespace         = 2,
  opc_tag_map_json      = null,
  edge_agent_id         = null,
  notes                 = null,
  owner_username        = null
}) {
  const db = getMillDb();

  // Validate connector type
  const validConnectors = ['manual_entry', 'file_exchange', 'rest_api', 'opc_ua'];
  if (!validConnectors.includes(connector_type)) {
    return { ok: false, error: `Invalid connector_type: ${connector_type}` };
  }

  // Validate export format
  const validFormats = ['csv', 'xml', 'xls', 'json'];
  if (!validFormats.includes(export_format)) {
    return { ok: false, error: `Invalid export_format: ${export_format}` };
  }

  // Check mill_code uniqueness
  if (mill_code) {
    const existing = db.prepare(
      'SELECT id FROM mill_configurations WHERE mill_code = ?'
    ).get(mill_code);
    if (existing) {
      return { ok: false, error: `Mill code ${mill_code} already exists` };
    }
  }

  const id = randomUUID();

  db.prepare(`
    INSERT INTO mill_configurations (
      id, mill_name, mill_code, location, country,
      timezone, currency, weight_unit, large_weight_unit, price_basis,
      contact_name, contact_phone, contact_email,
      capacity_tons_per_day, default_batch_size_tons,
      cost_per_minute_downtime, operating_hours, shift_count,
      connector_type, export_format,
      watch_folder_path, import_folder_path,
      api_base_url, api_key, recipe_endpoint, actuals_webhook_url,
      opc_server_url, opc_namespace, opc_tag_map_json, edge_agent_id,
      notes, owner_username
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?,
      ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?
    )
  `).run(
    id, mill_name, mill_code, location, country,
    timezone, currency, weight_unit, large_weight_unit, price_basis,
    contact_name, contact_phone, contact_email,
    capacity_tons_per_day, default_batch_size_tons,
    cost_per_minute_downtime, operating_hours, shift_count,
    connector_type, export_format,
    watch_folder_path, import_folder_path,
    api_base_url, api_key, recipe_endpoint, actuals_webhook_url,
    opc_server_url, opc_namespace, opc_tag_map_json, edge_agent_id,
    notes, owner_username
  );

  console.log(`[MillConfig] Mill created: ${mill_name} (${mill_code || id})`);
  return { ok: true, mill_id: id, mill_name, mill_code };
}

// â”€â”€ UPDATE MILL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function updateMill(mill_id, updates) {
  const db = getMillDb();

  const existing = db.prepare(
    'SELECT * FROM mill_configurations WHERE id = ?'
  ).get(mill_id);

  if (!existing) return { ok: false, error: 'Mill not found' };

  // Build update query dynamically from provided fields
  const allowedFields = [
    'mill_name', 'mill_code', 'location', 'country', 'timezone', 'currency',
    'weight_unit', 'large_weight_unit', 'price_basis',
    'contact_name', 'contact_phone', 'contact_email',
    'capacity_tons_per_day', 'default_batch_size_tons',
    'cost_per_minute_downtime', 'operating_hours', 'shift_count',
    'connector_type', 'export_format',
    'watch_folder_path', 'import_folder_path',
    'api_base_url', 'api_key', 'recipe_endpoint', 'actuals_webhook_url',
    'opc_server_url', 'opc_namespace', 'opc_tag_map_json', 'edge_agent_id',
    'is_active', 'notes'
  ];

  const fields = Object.keys(updates).filter(k => allowedFields.includes(k));

  if (fields.length === 0) {
    return { ok: false, error: 'No valid fields to update' };
  }

  const setClause = fields.map(f => `${f} = ?`).join(', ');
  const values    = fields.map(f => updates[f]);

  db.prepare(`
    UPDATE mill_configurations
    SET ${setClause}, updated_at = datetime('now')
    WHERE id = ?
  `).run(...values, mill_id);

  console.log(`[MillConfig] Mill updated: ${mill_id}`);
  return { ok: true, mill_id };
}

// â”€â”€ GET MILL BY ID â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getMillById(mill_id) {
  const db = getMillDb();

  const mill = db.prepare(
    'SELECT * FROM mill_configurations WHERE id = ?'
  ).get(mill_id);

  if (!mill) return { ok: false, error: 'Mill not found' };

  return { ok: true, mill: enrichMill(mill) };
}

// â”€â”€ GET MILL BY CODE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getMillByCode(mill_code) {
  const db = getMillDb();

  const mill = db.prepare(
    'SELECT * FROM mill_configurations WHERE mill_code = ?'
  ).get(mill_code);

  if (!mill) return { ok: false, error: `Mill code ${mill_code} not found` };

  return { ok: true, mill: enrichMill(mill) };
}

// â”€â”€ GET ALL MILLS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getAllMills(active_only = true, owner_username = null) {
  const db = getMillDb();

  // Strict per-user plants: never leak unowned / other users' mills as a shared default.
  if (!owner_username) {
    return { ok: true, mills: [], count: 0 };
  }
  const owner = String(owner_username).toLowerCase();
  const activeClause = active_only ? ' AND is_active = 1' : '';
  const rows = db.prepare(
    `SELECT * FROM mill_configurations WHERE LOWER(IFNULL(owner_username,'')) = ?${activeClause} ORDER BY mill_name`
  ).all(owner);

  return {
    ok: true,
    mills: rows.map(enrichMill),
    count: rows.length
  };
}

// â”€â”€ DELETE MILL (soft delete) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function deactivateMill(mill_id) {
  const db = getMillDb();

  const existing = db.prepare(
    'SELECT id, mill_name FROM mill_configurations WHERE id = ?'
  ).get(mill_id);

  if (!existing) return { ok: false, error: 'Mill not found' };

  db.prepare(`
    UPDATE mill_configurations
    SET is_active = 0, updated_at = datetime('now')
    WHERE id = ?
  `).run(mill_id);

  console.log(`[MillConfig] Mill deactivated: ${existing.mill_name}`);
  return { ok: true, mill_id, mill_name: existing.mill_name };
}

// â”€â”€ GET CONNECTOR SUMMARY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Returns what the Send to Mill UI needs to know about a mill
function getMillConnectorSummary(mill_id) {
  const db = getMillDb();

  const mill = db.prepare(
    'SELECT * FROM mill_configurations WHERE id = ?'
  ).get(mill_id);

  if (!mill) {
    // Return default manual config if mill not configured yet
    return {
      ok: true,
      configured: false,
      connector_type: 'manual_entry',
      export_format:  'csv',
      message:        'Mill not configured â€” defaulting to manual entry'
    };
  }

  // What actions to take on Send to Mill
  const actions = [];
  actions.push('create_batch');   // always create in AgroCore

  if (mill.connector_type === 'file_exchange') {
    actions.push(`download_${mill.export_format}`);
  } else if (mill.connector_type === 'rest_api') {
    actions.push('post_to_api');
  } else if (mill.connector_type === 'opc_ua') {
    actions.push('write_opc_tags');
  }

  return {
    ok: true,
    configured:       true,
    mill_id:          mill.id,
    mill_name:        mill.mill_name,
    mill_code:        mill.mill_code,
    connector_type:   mill.connector_type,
    export_format:    mill.export_format,
    default_batch_size_tons: mill.default_batch_size_tons,
    actions,
    // Only expose non-sensitive config to frontend
    has_api:          !!mill.api_base_url,
    has_opc:          !!mill.opc_server_url,
    has_file_config:  !!(mill.watch_folder_path || mill.import_folder_path)
  };
}

// â”€â”€ ENRICH MILL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Adds computed fields and masks sensitive data
function enrichMill(mill) {
  const connectorLabels = {
    manual_entry:  'Manual Entry',
    file_exchange: 'File Exchange',
    rest_api:      'REST API',
    opc_ua:        'OPC-UA'
  };

  const formatLabels = {
    csv:  'CSV (Universal)',
    xml:  'XML (BÃ¼hler/CPM)',
    xls:  'Excel (XLS)',
    json: 'JSON (AgroCore)'
  };

  return {
    ...mill,
    connector_label: connectorLabels[mill.connector_type] || mill.connector_type,
    format_label:    formatLabels[mill.export_format]     || mill.export_format,
    // Mask sensitive fields
    api_key:         mill.api_key ? 'â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢' : null,
    is_active:       mill.is_active === 1
  };
}

module.exports = {
  createMill,
  updateMill,
  getMillById,
  getMillByCode,
  getAllMills,
  deactivateMill,
  getMillConnectorSummary
};