import { PrismaClient } from '@prisma/client';

export function createPrismaClient(url?: string): PrismaClient {
  return new PrismaClient(url ? { datasourceUrl: url } : undefined);
}
