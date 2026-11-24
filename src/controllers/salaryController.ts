import { createHmac, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { env } from '../config/env.js';
import { receiveSalary } from '../services/moneyService.js';
import { ApiError, jsonObject, requireValue, safe, userOf } from '../middleware/errorHandler.js';
import type { Row } from '../types/rows.js';

export function salaryController(db: DatabaseSync) {
  return {
    webhook: safe((req, res) => {
      requireValue(Buffer.isBuffer(req.body) && req.body.length > 0, 400, 'JSON body required');
      requireValue(env.webhookSecret.length >= 32, 503, 'Webhook secret not configured');
      const stamp = req.header('X-PaySplit-Timestamp') ?? '';
      const signature = req.header('X-PaySplit-Signature') ?? '';
      requireValue(/^\d+$/.test(stamp) && Math.abs(Math.floor(Date.now() / 1000) - Number(stamp)) <= 300, 401, 'Invalid webhook timestamp');
      const expected = createHmac('sha256', env.webhookSecret).update(stamp).update('.').update(req.body).digest('hex');
      const supplied = Buffer.from(signature, 'utf8');
      const target = Buffer.from(expected, 'utf8');
      requireValue(supplied.length === target.length && timingSafeEqual(supplied, target), 401, 'Invalid webhook signature');
      let data: unknown;
      try { data = JSON.parse(req.body.toString('utf8')); } catch { throw new ApiError(400, 'Invalid JSON'); }
      requireValue(jsonObject(data), 400, 'JSON object required');
      const result = receiveSalary(db, data.event_id, data.account_ref, data.amount, data.currency ?? 'NGN');
      res.status(result.duplicate ? 200 : 201).json(result);
    }),
    list: safe((_req, res) => {
      const rows = db.prepare('SELECT id,amount,currency,received_at FROM salary_events WHERE user_id=? ORDER BY received_at DESC,id DESC LIMIT 100').all(userOf(res).id);
      res.json({ items: rows });
    }),
    get: safe((req, res) => {
      const event = db.prepare('SELECT id,amount,currency,received_at FROM salary_events WHERE id=? AND user_id=?')
        .get(String(req.params.id), userOf(res).id) as Row | undefined;
      requireValue(event, 404, 'Salary event not found');
      const allocations = db.prepare('SELECT id,rule_id,destination_id,amount,status,attempts,error FROM allocations WHERE salary_event_id=? ORDER BY created_at,id').all(event.id) as Row[];
      res.json({ ...event, allocations, unallocated: event.amount - allocations.reduce((sum, row) => sum + row.amount, 0) });
    }),
    ledger: safe((_req, res) => {
      const rows = db.prepare('SELECT id,journal_id,account,amount,created_at FROM ledger WHERE user_id=? ORDER BY rowid DESC LIMIT 200').all(userOf(res).id);
      res.json({ items: rows });
    }),
  };
}
