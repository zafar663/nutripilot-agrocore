'use strict';

const { getMillDb } = require('../../db/mill/mill.db.cjs');
const { ensureShareSchema } = require('./mill.share.service.cjs');

async function maybeNotifyStockAlerts(mill_id, snapshot, toEmail) {
  if (!mill_id || !snapshot) return { sent: false };
  const n = (snapshot.reorder_count || 0) + (snapshot.critical_count || 0);
  if (n <= 0 || !toEmail) return { sent: false, reason: 'no alerts' };
  const db = getMillDb();
  ensureShareSchema(db);
  const row = db.prepare('SELECT last_sent_at FROM mill_stock_alert_log WHERE mill_id = ?').get(mill_id);
  const last = row?.last_sent_at ? new Date(row.last_sent_at).getTime() : 0;
  if (Date.now() - last < 12 * 3600 * 1000) return { sent: false, reason: 'throttled' };

  const lines = (snapshot.reorder_list || []).map((i) =>
    `  • ${i.ingredient_name}: ${Number(i.current_stock || 0).toFixed(1)} (min ${i.min_stock || 0})`
  ).join('\n');
  const text = `Mill IQ stock alert (${n} ingredient(s) below reorder / critical)\n\n${lines}\n\nOpen Mill IQ → Inventory to review.`;
  const html = `<p>Mill IQ stock alert: <strong>${n}</strong> ingredient(s) need attention.</p><pre>${lines}</pre><p>Open Mill IQ → Inventory.</p>`;

  try {
    const { sendMail } = await import('../../../agrocore/core/email/mailer.js');
    await sendMail({
      to: toEmail,
      subject: `Mill IQ stock alert — ${n} ingredient(s)`,
      text,
      html,
    });
    db.prepare(`
      INSERT INTO mill_stock_alert_log (mill_id, last_sent_at, last_payload)
      VALUES (?, datetime('now'), ?)
      ON CONFLICT(mill_id) DO UPDATE SET last_sent_at = datetime('now'), last_payload = excluded.last_payload
    `).run(mill_id, JSON.stringify({ n }));
    return { sent: true };
  } catch (e) {
    return { sent: false, error: e.message };
  }
}

module.exports = { maybeNotifyStockAlerts };
