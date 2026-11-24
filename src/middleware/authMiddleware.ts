import type { DatabaseSync } from 'node:sqlite';
import type { Request, Response, NextFunction } from 'express';
import { tokenHash } from '../services/authService.js';
import { requireValue } from './errorHandler.js';
import type { Row } from '../types/rows.js';

export function authMiddleware(db: DatabaseSync) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = req.header('Authorization') ?? '';
      requireValue(auth.startsWith('Bearer '), 401, 'Bearer token required');
      const user = db.prepare(`SELECT u.id,u.email,u.account_ref FROM sessions s JOIN users u ON u.id=s.user_id
        WHERE s.token_hash=? AND s.expires_at>?`).get(tokenHash(auth.slice(7)), Math.floor(Date.now() / 1000)) as Row | undefined;
      requireValue(user, 401, 'Invalid or expired token');
      res.locals.user = user;
      next();
    } catch (error) { next(error); }
  };
}
