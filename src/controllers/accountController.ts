import type { DatabaseSync } from 'node:sqlite';
import { newId, now, passwordHash, passwordValid, tokenHash } from '../services/authService.js';
import { transaction } from '../database/sqlite.js';
import { ApiError, jsonObject, requireValue, safe, userOf } from '../middleware/errorHandler.js';
import type { Row } from '../types/rows.js';

export function accountController(db: DatabaseSync) {
  return {
    register: safe((req, res) => {
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
    }),
    login: safe((req, res) => {
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
    }),
    me: safe((_req, res) => res.json(userOf(res))),
  };
}
