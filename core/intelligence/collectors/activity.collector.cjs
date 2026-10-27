"use strict";

/**
 * Unified activity logger for AgroCore learning.
 * Writes AIE activity_events and, for knowledge-bearing events,
 * also the mill.db copilot_interactions table Nutrix AI RAG reads.
 */

const path = require("path");
const { randomUUID } = require("crypto");
const { getDb } = require("../db/aie.schema.cjs");

const KNOWLEDGE_KINDS = new Set([
  "post", "comment", "reply", "ai", "formula_save", "question",
  "premix_save", "analyze", "optimize"
]);

function millCopilotDb() {
  try {
    const Database = require("better-sqlite3");
    const dbPath = path.join(process.cwd(), "data", "mill.db");
    const db = new Database(dbPath);
    db.prepare(`CREATE TABLE IF NOT EXISTS copilot_interactions (
      id TEXT PRIMARY KEY, mill_id TEXT, usr TEXT, question TEXT, answer TEXT,
      grounding TEXT, feedback INTEGER, created_at TEXT
    )`).run();
    return db;
  } catch {
    return null;
  }
}

function logActivity({
  source = "nutrix",
  kind = "event",
  user_id = null,
  mill_id = null,
  species = null,
  title = "",
  text = "",
  metadata = {},
  skipMill = false
} = {}) {
  try {
    const db = getDb();
    const id = randomUUID();
    const created_at = new Date().toISOString();
    const titleS = String(title || "").slice(0, 500);
    const textS = String(text || "").slice(0, 12000);

    db.prepare(`
      INSERT INTO activity_events (
        id, source, kind, user_id, mill_id, species, title, body, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, source, kind, user_id, mill_id, species,
      titleS, textS, JSON.stringify(metadata || {}), created_at
    );

    if (KNOWLEDGE_KINDS.has(kind) && (titleS.length > 8 || textS.length > 20)) {
      try {
        db.prepare(`
          INSERT INTO qa_events (
            id, source, user_id, question, answer, query_type, species, resolved, asked_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
        `).run(
          randomUUID(), source, user_id,
          titleS || kind, textS, kind, species, created_at
        );
      } catch { /* qa table may lag schema */ }

      const mill = skipMill ? null : millCopilotDb();
      if (mill) {
        mill.prepare(`INSERT INTO copilot_interactions
          (id, mill_id, usr, question, answer, grounding, feedback, created_at)
          VALUES (?,?,?,?,?,?,?,?)`).run(
          randomUUID(),
          mill_id || null,
          user_id || source,
          titleS || kind,
          textS || titleS,
          JSON.stringify({ source, kind, ...(metadata || {}) }),
          kind === "like" ? null : 1,
          created_at
        );
        mill.close();
      }
    }
    return id;
  } catch (err) {
    console.error("[AIE] logActivity error:", err.message);
    return null;
  }
}

module.exports = { logActivity, KNOWLEDGE_KINDS };
