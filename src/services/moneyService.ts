import { Prisma, type PrismaClient } from '@prisma/client';
import { DomainError } from '../errors/DomainError.js';
import { newId, now } from './authService.js';

type RuleInput = { id: string; destinationId: string; kind: string; value: bigint; destination: { verified: boolean } };
type JournalEntry = [string, bigint];

export function toSafeNumber(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error('Amount exceeds JavaScript safe integer range');
  return result;
}

async function journal(tx: Prisma.TransactionClient, userId: string, entries: JournalEntry[]): Promise<void> {
  if (entries.reduce((sum, [, amount]) => sum + amount, 0n) !== 0n) throw new Error('Unbalanced journal');
  const journalId = newId();
  const timestamp = now();
  await tx.ledgerEntry.createMany({ data: entries.map(([account, amount]) => ({
    id: newId(), journalId, userId, account, amount, createdAt: timestamp,
  })) });
}

export function makeAllocations(amount: bigint, rules: RuleInput[]): Array<[RuleInput, bigint]> {
  const shares: Array<[RuleInput, bigint]> = rules.map(rule => [rule,
    rule.kind === 'fixed' ? rule.value : amount * rule.value / 10000n]);
  const total = shares.reduce((sum, [, share]) => sum + share, 0n);
  if (total > amount) throw new DomainError('Rules exceed salary amount');
  return shares.filter(([, share]) => share > 0n);
}

export async function receiveSalary(prisma: PrismaClient, providerEventId: unknown, accountRef: unknown, amount: unknown, currency: unknown = 'NGN'): Promise<{ id: string; duplicate: boolean }> {
  if (typeof providerEventId !== 'string' || providerEventId.length < 1 || providerEventId.length > 128) throw new DomainError('Event ID must be 1–128 characters');
  if (typeof accountRef !== 'string') throw new DomainError('Account reference required');
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) throw new DomainError('Salary amount must be positive integer kobo');
  if (currency !== 'NGN') throw new DomainError('Only NGN supported');
  const amountBig = BigInt(amount);
  const checkDuplicate = async () => {
    const previous = await prisma.salaryEvent.findUnique({ where: { providerEventId }, include: { user: { select: { accountRef: true } } } });
    if (!previous) return null;
    if (previous.user.accountRef !== accountRef || previous.amount !== amountBig || previous.currency !== currency) throw new DomainError('Event ID already used with different salary data');
    return { id: previous.id, duplicate: true };
  };
  const duplicate = await checkDuplicate();
  if (duplicate) return duplicate;
  try {
    return await prisma.$transaction(async tx => {
      const previous = await tx.salaryEvent.findUnique({ where: { providerEventId }, include: { user: { select: { accountRef: true } } } });
      if (previous) {
        if (previous.user.accountRef !== accountRef || previous.amount !== amountBig || previous.currency !== currency) throw new DomainError('Event ID already used with different salary data');
        return { id: previous.id, duplicate: true };
      }
      const user = await tx.user.findUnique({ where: { accountRef } });
      if (!user) throw new DomainError('Unknown account reference');
      const rules = await tx.rule.findMany({ where: { userId: user.id, active: true }, include: { destination: { select: { verified: true } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      if (rules.some(rule => !rule.destination.verified)) throw new DomainError('Active rule has unverified destination');
      const allocations = makeAllocations(amountBig, rules);
      const id = newId();
      await tx.salaryEvent.create({ data: { id, providerEventId, userId: user.id, amount: amountBig, currency, receivedAt: now() } });
      await journal(tx, user.id, [['external:salary', -amountBig], ['available', amountBig]]);
      for (const [rule, share] of allocations) {
        const allocationId = newId();
        await tx.allocation.create({ data: { id: allocationId, salaryEventId: id, ruleId: rule.id, destinationId: rule.destinationId, amount: share, status: 'pending', createdAt: now() } });
        await journal(tx, user.id, [['available', -share], [`pending:${allocationId}`, share]]);
      }
      return { id, duplicate: false };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const replay = await checkDuplicate();
      if (replay) return replay;
    }
    throw error;
  }
}

export async function processPending(prisma: PrismaClient, limit = 100): Promise<number> {
  let processed = 0;
  for (; processed < limit; processed++) {
    const found = await prisma.$transaction(async tx => {
      const allocation = await tx.allocation.findFirst({
        where: { status: 'pending', nextAttemptAt: { lte: Math.floor(Date.now() / 1000) } },
        include: { salaryEvent: { select: { userId: true } }, destination: { select: { kind: true, accountNumber: true } } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      if (!allocation) return false;
      const failed = allocation.destination.kind === 'bank' && allocation.destination.accountNumber?.endsWith('0000') === true;
      const attempts = allocation.attempts + 1;
      if (failed && attempts < 3) {
        const claimed = await tx.allocation.updateMany({ where: { id: allocation.id, status: 'pending', attempts: allocation.attempts },
          data: { attempts, nextAttemptAt: Math.floor(Date.now() / 1000) + 60 * attempts, error: 'Sandbox payout failure' } });
        return claimed.count === 1;
      }
      const claimed = await tx.allocation.updateMany({ where: { id: allocation.id, status: 'pending', attempts: allocation.attempts },
        data: failed ? { status: 'failed', attempts, error: 'Sandbox payout failure' } : { status: 'completed', attempts, error: null } });
      if (claimed.count !== 1) return false;
      await journal(tx, allocation.salaryEvent.userId, [[`pending:${allocation.id}`, -allocation.amount],
        [failed ? 'available' : `${allocation.destination.kind === 'savings' ? 'savings' : 'sent'}:${allocation.destinationId}`, allocation.amount]]);
      return true;
    });
    if (!found) break;
  }
  return processed;
}
