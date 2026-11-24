import { prisma } from '../database/prisma.js';
import { newId, now } from '../services/authService.js';
import { jsonObject, requireValue, safe, userOf } from '../middleware/errorHandler.js';

export function destinationController() {
  return {
    create: safe(async (req, res) => {
      const data = req.body;
      requireValue(jsonObject(data), 400, 'JSON object required');
      const { kind, name } = data;
      requireValue(kind === 'bank' || kind === 'savings', 422, 'Kind must be bank or savings');
      requireValue(typeof name === 'string' && name.length >= 1 && name.length <= 100, 422, 'Name required');
      let bankCode: string | null = null;
      let accountNumber: string | null = null;
      if (kind === 'bank') {
        requireValue(typeof data.bank_code === 'string' && /^\d{3}$/.test(data.bank_code), 422, 'Bank code must be 3 digits');
        requireValue(typeof data.account_number === 'string' && /^\d{10}$/.test(data.account_number), 422, 'Account number must be 10 digits');
        bankCode = data.bank_code;
        accountNumber = data.account_number;
      }
      const id = newId();
      await prisma.destination.create({ data: { id, userId: userOf(res).id, kind, name, bankCode, accountNumber, verified: true, createdAt: now() } });
      res.status(201).json({ id, kind, name, verified: true, verification_method: kind === 'bank' ? 'sandbox_format_only' : 'internal' });
    }),
    list: safe(async (_req, res) => {
      const rows = await prisma.destination.findMany({ where: { userId: userOf(res).id }, select: { id: true, kind: true, name: true, bankCode: true, accountNumber: true, verified: true } });
      res.json({ items: rows.map(row => ({ id: row.id, kind: row.kind, name: row.name, bank_code: row.bankCode, account_number: row.accountNumber, verified: row.verified })) });
    }),
  };
}
