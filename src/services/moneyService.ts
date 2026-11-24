import type { DatabaseSync } from 'node:sqlite';
import { transaction } from '../database/sqlite.js';
import { DomainError } from '../errors/DomainError.js';
import type { Row, Rule } from '../types/rows.js';
import { newId, now } from './authService.js';

function journal(db: DatabaseSync, userId: string, entries: [string, number][]): void {
  if (entries.reduce((sum, [, amount]) => sum + amount, 0) !== 0) throw new Error('Unbalanced journal');
  const journalId = newId();
  const timestamp = now();
  const insert = db.prepare('INSERT INTO ledger VALUES (?,?,?,?,?,?)');
  for (const [account, amount] of entries) insert.run(newId(), journalId, userId, account, amount, timestamp);
}

export function makeAllocations(amount: number, rules: Rule[]): Array<[Rule, number]> {
  const shares: Array<[Rule, number]> = rules.map(rule => [rule, rule.kind === 'fixed' ? rule.value : Number(BigInt(amount) * BigInt(rule.value) / 10000n)]);
  const total = shares.reduce((sum, [, share]) => sum + share, 0);
  if (!Number.isSafeInteger(total) || total > amount) throw new DomainError('Rules exceed salary amount');
  return shares.filter(([, share]) => share > 0);
}

export function receiveSalary(db: DatabaseSync, providerEventId: unknown, accountRef: unknown, amount: unknown, currency: unknown = 'NGN'): { id: string; duplicate: boolean } {
  if (typeof providerEventId !== 'string' || providerEventId.length < 1 || providerEventId.length > 128) throw new DomainError('Event ID must be 1–128 characters');
  if (typeof accountRef !== 'string') throw new DomainError('Account reference required');
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) throw new DomainError('Salary amount must be positive integer kobo');
  if (currency !== 'NGN') throw new DomainError('Only NGN supported');
  return transaction(db, () => {
    const previous = db.prepare('SELECT id,user_id,amount,currency FROM salary_events WHERE provider_event_id=?').get(providerEventId) as Row | undefined;
    if (previous) {
      const owner = db.prepare('SELECT account_ref FROM users WHERE id=?').get(previous.user_id) as Row;
      if (owner.account_ref !== accountRef || previous.amount !== amount || previous.currency !== currency) throw new DomainError('Event ID already used with different salary data');
      return { id: previous.id, duplicate: true };
    }
    const user = db.prepare('SELECT id FROM users WHERE account_ref=?').get(accountRef) as Row | undefined;
    if (!user) throw new DomainError('Unknown account reference');
    const rules = db.prepare(`SELECT r.*,d.verified FROM rules r JOIN destinations d ON d.id=r.destination_id
      WHERE r.user_id=? AND r.active=1 ORDER BY r.created_at,r.id`).all(user.id) as Rule[];
    if (rules.some(rule => !rule.verified)) throw new DomainError('Active rule has unverified destination');
    const allocations = makeAllocations(amount, rules);
    const id = newId();
    db.prepare('INSERT INTO salary_events VALUES (?,?,?,?,?,?)').run(id, providerEventId, user.id, amount, currency, now());
    journal(db, user.id, [['external:salary', -amount], ['available', amount]]);
    const insert = db.prepare('INSERT INTO allocations (id,salary_event_id,rule_id,destination_id,amount,status,created_at) VALUES (?,?,?,?,?,?,?)');
    for (const [rule, share] of allocations) {
      const allocationId = newId();
      insert.run(allocationId, id, rule.id, rule.destination_id, share, 'pending', now());
      journal(db, user.id, [['available', -share], [`pending:${allocationId}`, share]]);
    }
    return { id, duplicate: false };
  });
}

export function processPending(db: DatabaseSync, limit = 100): number {
  let processed = 0;
  for (; processed < limit; processed++) {
    const found = transaction(db, () => {
      const allocation = db.prepare(`SELECT a.*,e.user_id,d.kind,d.account_number FROM allocations a
        JOIN salary_events e ON e.id=a.salary_event_id JOIN destinations d ON d.id=a.destination_id
        WHERE a.status='pending' AND a.next_attempt_at<=? ORDER BY a.created_at,a.id LIMIT 1`).get(Math.floor(Date.now() / 1000)) as Row | undefined;
      if (!allocation) return false;
      const failed = allocation.kind === 'bank' && allocation.account_number.endsWith('0000');
      const attempts = allocation.attempts + 1;
      if (failed && attempts < 3) {
        db.prepare('UPDATE allocations SET attempts=?,next_attempt_at=?,error=? WHERE id=?')
          .run(attempts, Math.floor(Date.now() / 1000) + 60 * attempts, 'Sandbox payout failure', allocation.id);
      } else if (failed) {
        db.prepare("UPDATE allocations SET status='failed',attempts=?,error=? WHERE id=?")
          .run(attempts, 'Sandbox payout failure', allocation.id);
        journal(db, allocation.user_id, [[`pending:${allocation.id}`, -allocation.amount], ['available', allocation.amount]]);
      } else {
        db.prepare("UPDATE allocations SET status='completed',attempts=?,error=NULL WHERE id=?").run(attempts, allocation.id);
        journal(db, allocation.user_id, [[`pending:${allocation.id}`, -allocation.amount],
          [`${allocation.kind === 'savings' ? 'savings' : 'sent'}:${allocation.destination_id}`, allocation.amount]]);
      }
      return true;
    });
    if (!found) break;
  }
  return processed;
}
