import type { PrismaClient } from '@prisma/client';
import { processPending } from '../services/moneyService.js';

export function runPayoutJob(prisma: PrismaClient): Promise<number> {
  return processPending(prisma);
}
