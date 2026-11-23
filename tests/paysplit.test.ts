import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { openDatabase, processPending, transaction, type Row } from '../src/core.js';

const db = openDatabase(':memory:');
process.env.PAYSPLIT_WEBHOOK_SECRET = 's'.repeat(32);
let server: Server;
let base: string;
before(async () => {
  server = createServer(createApp(db));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No TCP port');
  base = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  server.close();
  await once(server, 'close');
  db.close();
});

async function call(method: string, path: string, data?: object, token?: string, headers: Record<string, string> = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(data ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: data ? JSON.stringify(data) : undefined,
  });
  return { status: response.status, body: await response.json() as Row };
}
async function account() {
  const email = `${randomUUID()}@example.test`;
  const user = await call('POST', '/v1/users', { email, password: 'password12345' });
  assert.equal(user.status, 201);
  const session = await call('POST', '/v1/sessions', { email, password: 'password12345' });
  assert.equal(session.status, 201);
  return { user: user.body, token: session.body.access_token as string };
}
async function salary(body: object, valid = true) {
  const stamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', process.env.PAYSPLIT_WEBHOOK_SECRET!).update(`${stamp}.${JSON.stringify(body)}`).digest('hex');
  return call('POST', '/v1/webhooks/salary', body, undefined, { 'X-PaySplit-Timestamp': stamp, 'X-PaySplit-Signature': valid ? signature : 'bad' });
}

test('signed split, idempotency, payout, ledger, and ownership', async () => {
  const { user, token } = await account();
  const other = await account();
  const savings = (await call('POST', '/v1/destinations', { kind: 'savings', name: 'Emergency' }, token)).body;
  const bank = (await call('POST', '/v1/destinations', { kind: 'bank', name: 'Mother', bank_code: '001', account_number: '1234567890' }, token)).body;
  assert.equal((await call('POST', '/v1/rules', { destination_id: savings.id, kind: 'percent', value: 1000 }, token)).status, 201);
  assert.equal((await call('POST', '/v1/rules', { destination_id: bank.id, kind: 'fixed', value: 10000000 }, token)).status, 201);
  const payload = { event_id: randomUUID(), account_ref: user.account_ref, amount: 60000000, currency: 'NGN' };
  assert.equal((await salary(payload, false)).status, 401);
  const event = await salary(payload);
  assert.equal(event.status, 201);
  assert.deepEqual(await salary(payload), { status: 200, body: { id: event.body.id, duplicate: true } });
  let detail = (await call('GET', `/v1/salary-events/${event.body.id}`, undefined, token)).body;
  assert.deepEqual(detail.allocations.map((x: Row) => x.amount).sort((a: number, b: number) => a - b), [6000000, 10000000]);
  assert.equal(detail.unallocated, 44000000);
  assert.equal(processPending(db), 2);
  detail = (await call('GET', `/v1/salary-events/${event.body.id}`, undefined, token)).body;
  assert.deepEqual(new Set(detail.allocations.map((x: Row) => x.status)), new Set(['completed']));
  assert.equal((await call('GET', `/v1/salary-events/${event.body.id}`, undefined, other.token)).status, 404);
  const ledger = (await call('GET', '/v1/ledger', undefined, token)).body;
  const journals = new Map<string, number>();
  for (const entry of ledger.items) journals.set(entry.journal_id, (journals.get(entry.journal_id) ?? 0) + entry.amount);
  assert.ok([...journals.values()].every(total => total === 0));
  assert.equal((await salary({ ...payload, amount: 1 })).status, 422);
});

test('over-allocation rolls back entire event', async () => {
  const { user, token } = await account();
  const dest = (await call('POST', '/v1/destinations', { kind: 'savings', name: 'Reserve' }, token)).body;
  await call('POST', '/v1/rules', { destination_id: dest.id, kind: 'fixed', value: 101 }, token);
  assert.equal((await salary({ event_id: randomUUID(), account_ref: user.account_ref, amount: 100 })).status, 422);
  assert.deepEqual((await call('GET', '/v1/salary-events', undefined, token)).body.items, []);
});

test('failed payout retries then refunds available balance', async () => {
  const { user, token } = await account();
  const bank = (await call('POST', '/v1/destinations', { kind: 'bank', name: 'Failure case', bank_code: '001', account_number: '1234560000' }, token)).body;
  await call('POST', '/v1/rules', { destination_id: bank.id, kind: 'fixed', value: 50 }, token);
  const event = (await salary({ event_id: randomUUID(), account_ref: user.account_ref, amount: 100 })).body;
  let detail: Row = {};
  for (let attempt = 1; attempt <= 3; attempt++) {
    assert.equal(processPending(db), 1);
    detail = (await call('GET', `/v1/salary-events/${event.id}`, undefined, token)).body;
    assert.equal(detail.allocations[0].attempts, attempt);
    if (attempt < 3) transaction(db, () => db.prepare('UPDATE allocations SET next_attempt_at=0 WHERE id=?').run(detail.allocations[0].id));
  }
  assert.equal(detail.allocations[0].status, 'failed');
  const balance = db.prepare("SELECT SUM(amount) AS amount FROM ledger WHERE user_id=? AND account='available'").get(user.id) as Row;
  assert.equal(balance.amount, 100);
});
