import type { DatabaseSync } from 'node:sqlite';
import { newId, now } from '../services/authService.js';
import { transaction } from '../database/sqlite.js';
import { jsonObject, requireValue, safe, userOf } from '../middleware/errorHandler.js';
import type { Row } from '../types/rows.js';

export function destinationController(db: DatabaseSync) {
  return {
    create: safe((req, res) => {
      const data = req.body;
      requireValue(jsonObject(data), 400, 'JSON object required');
      const { kind, name } = data;
      requireValue(kind === 'bank' || kind === 'savings', 422, 'Kind must be bank or savings');
      requireValue(typeof name === 'string' && name.length >= 1 && name.length <= 100, 422, 'Name required');
      let bankCode: string | null = null;
      let account: string | null = null;
      if (kind === 'bank') {
        requireValue(typeof data.bank_code === 'string' && /^\d{3}$/.test(data.bank_code), 422, 'Bank code must be 3 digits');
        requireValue(typeof data.account_number === 'string' && /^\d{10}$/.test(data.account_number), 422, 'Account number must be 10 digits');
        bankCode = data.bank_code;
        account = data.account_number;
      }
      const id = newId();
      transaction(db, () => db.prepare('INSERT INTO destinations VALUES (?,?,?,?,?,?,?,?)')
        .run(id, userOf(res).id, kind, name, bankCode, account, 1, now()));
      res.status(201).json({ id, kind, name, verified: true, verification_method: kind === 'bank' ? 'sandbox_format_only' : 'internal' });
    }),
    list: safe((_req, res) => {
      const rows = db.prepare('SELECT id,kind,name,bank_code,account_number,verified FROM destinations WHERE user_id=?').all(userOf(res).id) as Row[];
      res.json({ items: rows.map(row => ({ ...row, verified: Boolean(row.verified) })) });
    }),
  };
}
