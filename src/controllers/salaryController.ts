import { createHmac, timingSafeEqual } from 'node:crypto';
import { prisma } from '../database/prisma.js';
import { env } from '../config/env.js';
import { receiveSalary, toSafeNumber } from '../services/moneyService.js';
import { ApiError, jsonObject, requireValue, safe, userOf } from '../middleware/errorHandler.js';

export function salaryController() {
  return {
    webhook: safe(async (req, res) => {
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
      const result = await receiveSalary(data.event_id, data.account_ref, data.amount, data.currency ?? 'NGN');
      res.status(result.duplicate ? 200 : 201).json(result);
    }),
    list: safe(async (_req, res) => {
      const rows = await prisma.salaryEvent.findMany({ where: { userId: userOf(res).id }, orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }], take: 100,
        select: { id: true, amount: true, currency: true, receivedAt: true } });
      res.json({ items: rows.map(row => ({ id: row.id, amount: toSafeNumber(row.amount), currency: row.currency, received_at: row.receivedAt })) });
    }),
    get: safe(async (req, res) => {
      const event = await prisma.salaryEvent.findFirst({ where: { id: String(req.params.id), userId: userOf(res).id },
        include: { allocations: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, ruleId: true, destinationId: true, amount: true, status: true, attempts: true, error: true } } } });
      requireValue(event, 404, 'Salary event not found');
      const allocations = event.allocations.map(row => ({ id: row.id, rule_id: row.ruleId, destination_id: row.destinationId,
        amount: toSafeNumber(row.amount), status: row.status, attempts: row.attempts, error: row.error }));
      const allocated = event.allocations.reduce((sum, row) => sum + row.amount, 0n);
      res.json({ id: event.id, amount: toSafeNumber(event.amount), currency: event.currency, received_at: event.receivedAt,
        allocations, unallocated: toSafeNumber(event.amount - allocated) });
    }),
    ledger: safe(async (_req, res) => {
      const rows = await prisma.ledgerEntry.findMany({ where: { userId: userOf(res).id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 200,
        select: { id: true, journalId: true, account: true, amount: true, createdAt: true } });
      res.json({ items: rows.map(row => ({ id: row.id, journal_id: row.journalId, account: row.account,
        amount: toSafeNumber(row.amount), created_at: row.createdAt })) });
    }),
  };
}
