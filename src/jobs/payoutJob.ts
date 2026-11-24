import type { DatabaseSync } from 'node:sqlite';
import { processPending } from '../services/moneyService.js';

export function runPayoutJob(db: DatabaseSync): number {
  return processPending(db);
}
