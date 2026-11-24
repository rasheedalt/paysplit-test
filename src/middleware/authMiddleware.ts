import { prisma } from '../database/prisma.js';
import type { Request, Response, NextFunction } from 'express';
import { tokenHash } from '../services/authService.js';
import { requireValue } from './errorHandler.js';

export function authMiddleware() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = req.header('Authorization') ?? '';
      requireValue(auth.startsWith('Bearer '), 401, 'Bearer token required');
      const session = await prisma.session.findFirst({
        where: { tokenHash: tokenHash(auth.slice(7)), expiresAt: { gt: Math.floor(Date.now() / 1000) } },
        include: { user: { select: { id: true, email: true, accountRef: true } } },
      });
      requireValue(session, 401, 'Invalid or expired token');
      res.locals.user = { id: session.user.id, email: session.user.email, account_ref: session.user.accountRef };
      next();
    } catch (error) { next(error); }
  };
}
