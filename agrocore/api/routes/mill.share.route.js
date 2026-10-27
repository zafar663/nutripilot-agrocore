import express from 'express';
import { shareFromNutritionist, listSharedFormulas, listSharedIngredients, listSilos, upsertSilo } from '../../../core/services/mill/mill.share.service.cjs';
import { dailyPack, packToCsv } from '../../../core/services/mill/mill.pack.service.cjs';

const router = express.Router();

function millRoleOf(req) {
  const role = String(req.user?.role || '').toLowerCase();
  if (role === 'lab') return 'blocked';
  if (role === 'viewer') return 'viewer';
  if (role === 'mill_operator') return 'operator';
  return 'manager';
}

router.post('/from-nutritionist', (req, res) => {
  try {
    const { mill_id, kind, formula } = req.body || {};
    const result = shareFromNutritionist({
      mill_id,
      kind: kind === 'ingredients' ? 'ingredients' : 'formula',
      formula,
      released_by: req.user?.email || req.nutrixUser,
    });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/formulas/:mill_id', (req, res) => {
  try { return res.json(listSharedFormulas(req.params.mill_id)); }
  catch (err) { return res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/ingredients/:mill_id', (req, res) => {
  try { return res.json(listSharedIngredients(req.params.mill_id)); }
  catch (err) { return res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/silos/:mill_id', (req, res) => {
  try { return res.json(listSilos(req.params.mill_id)); }
  catch (err) { return res.status(500).json({ ok: false, error: err.message }); }
});

router.post('/silos', (req, res) => {
  try { return res.json(upsertSilo(req.body || {})); }
  catch (err) { return res.status(400).json({ ok: false, error: err.message }); }
});

router.get('/role', (req, res) => {
  const role = millRoleOf(req);
  if (role === 'blocked') return res.status(403).json({ ok: false, error: 'Lab accounts use Lab Portal, not Mill IQ.', role });
  return res.json({ ok: true, role, mill_manager: role === 'manager' });
});

router.get('/pack/:mill_id', (req, res) => {
  try {
    const pack = dailyPack(req.params.mill_id, req.query.date || null);
    if (req.query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="mill-pack-${pack.date}.csv"`);
      return res.send(packToCsv(pack));
    }
    return res.json(pack);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/pack/:mill_id/email', async (req, res) => {
  try {
    const pack = dailyPack(req.params.mill_id, req.body?.date || null);
    const to = req.body?.to || req.user?.email;
    if (!to) return res.status(400).json({ ok: false, error: 'No email address' });
    const csv = packToCsv(pack);
    const { sendMail } = await import('../../core/email/mailer.js');
    const mail = await sendMail({
      to,
      subject: `Mill IQ daily pack — ${pack.date}`,
      text: `Mill IQ pack for ${pack.date}\nBatches: ${(pack.batches || []).length}\nDeviation $: ${pack.deviation_cost}\nFlags: ${pack.flags}\n\n${csv}`,
      html: `<p>Mill IQ pack for <strong>${pack.date}</strong></p><p>Batches ${(pack.batches || []).length} · Deviation $${pack.deviation_cost} · Flags ${pack.flags}</p><pre>${csv}</pre>`,
    });
    return res.json({ ok: true, sent: mail.sent, to, date: pack.date });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export { millRoleOf };
export default router;
