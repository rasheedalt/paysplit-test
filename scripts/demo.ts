import { createHmac, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { execFileSync } from 'node:child_process';
import type { Row } from '../src/types/rows.js';

const port = 8765;
const base = `http://127.0.0.1:${port}`;
const dir = mkdtempSync(path.join(os.tmpdir(), 'paysplit-demo-'));
const databaseFile = path.join(dir, 'demo.db');
writeFileSync(databaseFile, '');

const env = {
  ...process.env,
  DATABASE_URL: `file:${databaseFile}`,
  PAYSPLIT_WEBHOOK_SECRET: `demo-secret-${'x'.repeat(32)}`,
  PORT: String(port),
};

execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
  env,
  stdio: 'pipe',
});
const server = spawn(process.execPath, ['dist/src/server.js'], { env, stdio: 'ignore' });

async function call(
  method: string,
  route: string,
  data?: object,
  token?: string,
  headers: Record<string, string> = {}
): Promise<Row> {
  const response = await fetch(base + route, {
    method,
    headers: {
      ...(data ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const body = (await response.json()) as Row;
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(body)}`);
  return body;
}

function show(label: string, value: unknown) {
  console.log(`\n${label}\n${JSON.stringify(value, null, 2)}`);
}

try {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await call('GET', '/health');
      break;
    } catch {
      await delay(100);
    }
  }
  const email = `demo-${randomUUID().slice(0, 8)}@example.test`;
  const user = await call('POST', '/v1/users', { email, password: 'demo-password-123' });
  const session = await call('POST', '/v1/sessions', { email, password: 'demo-password-123' });
  const token = session.access_token;

  show('Registered user and salary account', user);

  const mother = await call(
    'POST',
    '/v1/destinations',
    { kind: 'bank', name: 'Mother', bank_code: '001', account_number: '1234567890' },
    token
  );
  const brother = await call(
    'POST',
    '/v1/destinations',
    { kind: 'bank', name: 'Brother', bank_code: '001', account_number: '1234567891' },
    token
  );

  const savings = await call(
    'POST',
    '/v1/destinations',
    { kind: 'savings', name: 'Savings' },
    token
  );
  for (const [dest, kind, value] of [
    [mother, 'fixed', 10000000],
    [brother, 'fixed', 5000000],
    [savings, 'fixed', 20000000],
    [savings, 'percent', 1000],
  ] as const) {
    await call('POST', '/v1/rules', { destination_id: dest.id, kind, value }, token);
  }
  show('Configured rules', await call('GET', '/v1/rules', undefined, token));

  const salary = {
    event_id: `salary-${randomUUID()}`,
    account_ref: user.account_ref,
    amount: 60000000,
    currency: 'NGN',
  };

  const stamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', env.PAYSPLIT_WEBHOOK_SECRET)
    .update(`${stamp}.${JSON.stringify(salary)}`)
    .digest('hex');

  const headers = { 'X-PaySplit-Timestamp': stamp, 'X-PaySplit-Signature': signature };
  const event = await call('POST', '/v1/webhooks/salary', salary, undefined, headers);
  show('Signed salary accepted', event);
  show('Idempotent replay', await call('POST', '/v1/webhooks/salary', salary, undefined, headers));
  show('Split before payout', await call('GET', `/v1/salary-events/${event.id}`, undefined, token));

  const worker = spawn(process.execPath, ['dist/src/worker.js', '--once'], {
    env,
    stdio: 'inherit',
  });

  await new Promise<void>((resolve, reject) =>
    worker.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`Worker exited ${code}`))
    )
  );
  show('Split after payout', await call('GET', `/v1/salary-events/${event.id}`, undefined, token));
  
  const ledger = await call('GET', '/v1/ledger', undefined, token);
  show('Money record', {
    posting_count: ledger.items.length,
    journal_count: new Set(ledger.items.map((x: Row) => x.journal_id)).size,
  });
} finally {
  server.kill();
  rmSync(dir, { recursive: true, force: true });
}
