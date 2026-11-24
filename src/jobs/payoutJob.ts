import { processPending } from '../services/moneyService.js';

export function runPayoutJob(): Promise<number> {
  return processPending();
}
