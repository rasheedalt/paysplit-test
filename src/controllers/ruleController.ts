import type { DatabaseSync } from 'node:sqlite';
import { newId, now } from '../services/authService.js';
import { transaction } from '../database/sqlite.js';
import { jsonObject, requireValue, safe, userOf } from '../middleware/errorHandler.js';
import type { Row } from '../types/rows.js';

export function ruleController(db: DatabaseSync) {
  return {
    create: safe((req, res) => {
      const data = req.body;
      requireValue(jsonObject(data), 400, 'JSON object required');
      const { destination_id: destinationId, kind, value } = data;
      requireValue(kind === 'fixed' || kind === 'percent', 422, 'Kind must be fixed or percent');
      requireValue(Number.isSafeInteger(value) && (kind === 'fixed' ? value > 0 : value >= 1 && value <= 10000), 422, 'Value must be positive kobo or 1–10000 basis points');
      const id = transaction(db, () => {
        const dest = db.prepare('SELECT id FROM destinations WHERE id=? AND user_id=? AND verified=1').get(destinationId, userOf(res).id);
        requireValue(dest, 422, 'Verified destination required');
        if (kind === 'percent') {
          const total = db.prepare("SELECT COALESCE(SUM(value),0) AS total FROM rules WHERE user_id=? AND kind='percent' AND active=1").get(userOf(res).id) as Row;
          requireValue(total.total + value <= 10000, 422, 'Percent rules exceed 100%');
        }
        const ruleId = newId();
        db.prepare('INSERT INTO rules (id,user_id,destination_id,kind,value,created_at) VALUES (?,?,?,?,?,?)')
          .run(ruleId, userOf(res).id, destinationId, kind, value, now());
        return ruleId;
      });
      res.status(201).json({ id, destination_id: destinationId, kind, value, active: true });
    }),
    list: safe((_req, res) => {
      const rows = db.prepare('SELECT id,destination_id,kind,value,active FROM rules WHERE user_id=? ORDER BY created_at,id').all(userOf(res).id) as Row[];
      res.json({ items: rows.map(row => ({ ...row, active: Boolean(row.active) })) });
    }),
    deactivate: safe((req, res) => {
      const id = String(req.params.id);
      const result = transaction(db, () => db.prepare('UPDATE rules SET active=0 WHERE id=? AND user_id=? AND active=1').run(id, userOf(res).id));
      requireValue(result.changes === 1, 404, 'Active rule not found');
      res.json({ id, active: false });
    }),
  };
}
