import type { PrismaClient } from '@prisma/client';
import { newId, now } from '../services/authService.js';
import { jsonObject, requireValue, safe, userOf } from '../middleware/errorHandler.js';
import { toSafeNumber } from '../services/moneyService.js';

export function ruleController(prisma: PrismaClient) {
  return {
    create: safe(async (req, res) => {
      const data = req.body;
      requireValue(jsonObject(data), 400, 'JSON object required');
      const { destination_id: destinationId, kind, value } = data;
      requireValue(kind === 'fixed' || kind === 'percent', 422, 'Kind must be fixed or percent');
      requireValue(Number.isSafeInteger(value) && (kind === 'fixed' ? value > 0 : value >= 1 && value <= 10000), 422, 'Value must be positive kobo or 1–10000 basis points');
      const id = await prisma.$transaction(async tx => {
        const dest = await tx.destination.findFirst({ where: { id: destinationId, userId: userOf(res).id, verified: true }, select: { id: true } });
        requireValue(dest, 422, 'Verified destination required');
        if (kind === 'percent') {
          const aggregate = await tx.rule.aggregate({ where: { userId: userOf(res).id, kind: 'percent', active: true }, _sum: { value: true } });
          requireValue((aggregate._sum.value ?? 0n) + BigInt(value) <= 10000n, 422, 'Percent rules exceed 100%');
        }
        const ruleId = newId();
        await tx.rule.create({ data: { id: ruleId, userId: userOf(res).id, destinationId, kind, value: BigInt(value), createdAt: now() } });
        return ruleId;
      });
      res.status(201).json({ id, destination_id: destinationId, kind, value, active: true });
    }),
    list: safe(async (_req, res) => {
      const rows = await prisma.rule.findMany({ where: { userId: userOf(res).id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, destinationId: true, kind: true, value: true, active: true } });
      res.json({ items: rows.map(row => ({ id: row.id, destination_id: row.destinationId, kind: row.kind, value: toSafeNumber(row.value), active: row.active })) });
    }),
    deactivate: safe(async (req, res) => {
      const id = String(req.params.id);
      const result = await prisma.rule.updateMany({ where: { id, userId: userOf(res).id, active: true }, data: { active: false } });
      requireValue(result.count === 1, 404, 'Active rule not found');
      res.json({ id, active: false });
    }),
  };
}
