import { Prisma } from '@prisma/client';
import { prisma } from '../database/prisma.js';
import { newId, now, passwordHash, passwordValid, tokenHash } from '../services/authService.js';
import { ApiError, jsonObject, requireValue, safe, userOf } from '../middleware/errorHandler.js';

export class AccountController {
  register = safe(async (req, res) => {
    const data = req.body;
    requireValue(jsonObject(data), 400, 'JSON object required');

    const { email, password } = data;

    requireValue(
      typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254,
      422,
      'Valid email required'
    );
    requireValue(
      typeof password === 'string' && password.length >= 12 && password.length <= 128,
      422,
      'Password must be 12–128 characters'
    );

    const id = newId();
    const accountRef = `PS-${newId()}`;
    try {
      await prisma.user.create({
        data: {
          id,
          email: email.toLowerCase(),
          passwordHash: passwordHash(password),
          accountRef,
          createdAt: now(),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ApiError(409, 'Email already registered');
      throw error;
    }
    res.status(201).json({ id, email: email.toLowerCase(), account_ref: accountRef });
  });

  login = safe(async (req, res) => {
    const data = req.body;
    requireValue(jsonObject(data), 400, 'JSON object required');
    const { email, password } = data;
    requireValue(
      typeof email === 'string' && typeof password === 'string',
      422,
      'Email and password required'
    );
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    requireValue(user && passwordValid(password, user.passwordHash), 401, 'Invalid credentials');
    const token = newId() + newId();
    const expires = Math.floor(Date.now() / 1000) + 86400;
    await prisma.session.create({
      data: { tokenHash: tokenHash(token), userId: user.id, expiresAt: expires },
    });
    res.status(201).json({ access_token: token, token_type: 'Bearer', expires_at: expires });
  });

  me = safe((_req, res) => res.json(userOf(res)));
}

export const accountController = new AccountController();
