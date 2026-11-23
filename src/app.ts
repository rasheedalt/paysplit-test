import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { DomainError, newId, now, passwordHash, passwordValid, receiveSalary, tokenHash, transaction, type Row } from './core.js';

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function requireValue(condition: unknown, status: number, message: string): asserts condition {
  if (!condition) throw new ApiError(status, message);
}
const safe = (action: (req: Request, res: Response) => void) => (req: Request, res: Response, next: NextFunction) => {
  try { action(req, res); } catch (error) { next(error); }
};
const jsonObject = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value);
const userOf = (res: Response): Row => res.locals.user as Row;

export function createApp(db: DatabaseSync) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/openapi.json', (_req, res) => {
    res.type('json').send(readFileSync(path.resolve(process.cwd(), 'openapi.json')));
  });

  app.post('/v1/webhooks/salary', express.raw({ type: 'application/json', limit: '64kb' }), safe((req, res) => {
    requireValue(Buffer.isBuffer(req.body) && req.body.length > 0, 400, 'JSON body required');
    const secret = process.env.PAYSPLIT_WEBHOOK_SECRET ?? '';
    requireValue(secret.length >= 32, 503, 'Webhook secret not configured');
    const stamp = req.header('X-PaySplit-Timestamp') ?? '';
    const signature = req.header('X-PaySplit-Signature') ?? '';
    requireValue(/^\d+$/.test(stamp) && Math.abs(Math.floor(Date.now() / 1000) - Number(stamp)) <= 300, 401, 'Invalid webhook timestamp');
    const expected = createHmac('sha256', secret).update(stamp).update('.').update(req.body).digest('hex');
    const supplied = Buffer.from(signature, 'utf8');
    const target = Buffer.from(expected, 'utf8');
    requireValue(supplied.length === target.length && timingSafeEqual(supplied, target), 401, 'Invalid webhook signature');
    let data: unknown;
    try { data = JSON.parse(req.body.toString('utf8')); } catch { throw new ApiError(400, 'Invalid JSON'); }
    requireValue(jsonObject(data), 400, 'JSON object required');
    const result = receiveSalary(db, data.event_id, data.account_ref, data.amount, data.currency ?? 'NGN');
    res.status(result.duplicate ? 200 : 201).json(result);
  }));
  app.use(express.json({ limit: '64kb', strict: true }));

  app.post('/v1/users', safe((req, res) => {
    const data = req.body;
    requireValue(jsonObject(data), 400, 'JSON object required');
    const { email, password } = data;
    requireValue(typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254, 422, 'Valid email required');
    requireValue(typeof password === 'string' && password.length >= 12 && password.length <= 128, 422, 'Password must be 12–128 characters');
    const id = newId();
    const accountRef = `PS-${newId()}`;
    try {
      transaction(db, () => db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run(id, email.toLowerCase(), passwordHash(password), accountRef, now()));
    } catch (error) {
      if (String(error).includes('UNIQUE constraint failed: users.email')) throw new ApiError(409, 'Email already registered');
      throw error;
    }
    res.status(201).json({ id, email: email.toLowerCase(), account_ref: accountRef });
  }));
  app.post('/v1/sessions', safe((req, res) => {
    const data = req.body;
    requireValue(jsonObject(data), 400, 'JSON object required');
    const { email, password } = data;
    requireValue(typeof email === 'string' && typeof password === 'string', 422, 'Email and password required');
    const user = db.prepare('SELECT * FROM users WHERE email=?').get(email.toLowerCase()) as Row | undefined;
    requireValue(user && passwordValid(password, user.password_hash), 401, 'Invalid credentials');
    const token = newId() + newId();
    const expires = Math.floor(Date.now() / 1000) + 86400;
    transaction(db, () => db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(tokenHash(token), user.id, expires));
    res.status(201).json({ access_token: token, token_type: 'Bearer', expires_at: expires });
  }));

  app.use('/v1', (req, res, next) => {
    try {
      const auth = req.header('Authorization') ?? '';
      requireValue(auth.startsWith('Bearer '), 401, 'Bearer token required');
      const user = db.prepare(`SELECT u.id,u.email,u.account_ref FROM sessions s JOIN users u ON u.id=s.user_id
        WHERE s.token_hash=? AND s.expires_at>?`).get(tokenHash(auth.slice(7)), Math.floor(Date.now() / 1000)) as Row | undefined;
      requireValue(user, 401, 'Invalid or expired token');
      res.locals.user = user;
      next();
    } catch (error) { next(error); }
  });
  app.get('/v1/me', (_req, res) => res.json(userOf(res)));
  app.post('/v1/destinations', safe((req, res) => {
    const data = req.body;
    requireValue(jsonObject(data), 400, 'JSON object required');
    const { kind, name } = data;
    requireValue(kind === 'bank' || kind === 'savings', 422, 'Kind must be bank or savings');
    requireValue(typeof name === 'string' && name.length >= 1 && name.length <= 100, 422, 'Name required');
    let bankCode: string | null = null;
    let account: string | null = null;
    if (kind === 'bank') {
      requireValue(typeof data.bank_code === 'string' && /^\d{3}$/.test(data.bank_code), 422, 'Bank code must be 3 digits');
      requireValue(typeof data.account_number === 'string' && /^\d{10}$/.test(data.account_number), 422, 'Account number must be 10 digits');
      bankCode = data.bank_code;
      account = data.account_number;
    }
    const id = newId();
    transaction(db, () => db.prepare('INSERT INTO destinations VALUES (?,?,?,?,?,?,?,?)')
      .run(id, userOf(res).id, kind, name, bankCode, account, 1, now()));
    res.status(201).json({ id, kind, name, verified: true, verification_method: kind === 'bank' ? 'sandbox_format_only' : 'internal' });
  }));
  app.get('/v1/destinations', (_req, res) => {
    const rows = db.prepare('SELECT id,kind,name,bank_code,account_number,verified FROM destinations WHERE user_id=?').all(userOf(res).id) as Row[];
    res.json({ items: rows.map(row => ({ ...row, verified: Boolean(row.verified) })) });
  });
  app.post('/v1/rules', safe((req, res) => {
    const data = req.body;
    requireValue(jsonObject(data), 400, 'JSON object required');
    const { destination_id: destinationId, kind, value } = data;
    requireValue(kind === 'fixed' || kind === 'percent', 422, 'Kind must be fixed or percent');
    requireValue(Number.isSafeInteger(value) && (kind === 'fixed' ? value > 0 : value >= 1 && value <= 10000), 422, 'Value must be positive kobo or 1–10000 basis points');
    const id = transaction(db, () => {
      const dest = db.prepare('SELECT id FROM destinations WHERE id=? AND user_id=? AND verified=1').get(destinationId, userOf(res).id);
      requireValue(dest, 422, 'Verified destination required');
      if (kind === 'percent') {
        const total = db.prepare("SELECT COALESCE(SUM(value),0) AS total FROM rules WHERE user_id=? AND kind='percent' AND active=1").get(userOf(res).id) as Row;
        requireValue(total.total + value <= 10000, 422, 'Percent rules exceed 100%');
      }
      const ruleId = newId();
      db.prepare('INSERT INTO rules (id,user_id,destination_id,kind,value,created_at) VALUES (?,?,?,?,?,?)')
        .run(ruleId, userOf(res).id, destinationId, kind, value, now());
      return ruleId;
    });
    res.status(201).json({ id, destination_id: destinationId, kind, value, active: true });
  }));
  app.get('/v1/rules', (_req, res) => {
    const rows = db.prepare('SELECT id,destination_id,kind,value,active FROM rules WHERE user_id=? ORDER BY created_at,id').all(userOf(res).id) as Row[];
    res.json({ items: rows.map(row => ({ ...row, active: Boolean(row.active) })) });
  });
  app.delete('/v1/rules/:id', safe((req, res) => {
    const id = String(req.params.id);
    const result = transaction(db, () => db.prepare('UPDATE rules SET active=0 WHERE id=? AND user_id=? AND active=1').run(id, userOf(res).id));
    requireValue(result.changes === 1, 404, 'Active rule not found');
    res.json({ id, active: false });
  }));
  app.get('/v1/salary-events', (_req, res) => {
    const rows = db.prepare('SELECT id,amount,currency,received_at FROM salary_events WHERE user_id=? ORDER BY received_at DESC,id DESC LIMIT 100').all(userOf(res).id);
    res.json({ items: rows });
  });
  app.get('/v1/salary-events/:id', safe((req, res) => {
    const event = db.prepare('SELECT id,amount,currency,received_at FROM salary_events WHERE id=? AND user_id=?')
      .get(String(req.params.id), userOf(res).id) as Row | undefined;
    requireValue(event, 404, 'Salary event not found');
    const allocations = db.prepare('SELECT id,rule_id,destination_id,amount,status,attempts,error FROM allocations WHERE salary_event_id=? ORDER BY created_at,id').all(event.id) as Row[];
    res.json({ ...event, allocations, unallocated: event.amount - allocations.reduce((sum, row) => sum + row.amount, 0) });
  }));
  app.get('/v1/ledger', (_req, res) => {
    const rows = db.prepare('SELECT id,journal_id,account,amount,created_at FROM ledger WHERE user_id=? ORDER BY rowid DESC LIMIT 200').all(userOf(res).id);
    res.json({ items: rows });
  });
  app.use((_req, _res, next) => next(new ApiError(404, 'Route not found')));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ApiError) return res.status(error.status).json({ error: error.message });
    if (error instanceof DomainError) return res.status(422).json({ error: error.message });
    if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ error: 'Invalid JSON' });
    if (jsonObject(error) && error.type === 'entity.too.large') return res.status(413).json({ error: 'Body must be 1–65536 bytes' });
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}
