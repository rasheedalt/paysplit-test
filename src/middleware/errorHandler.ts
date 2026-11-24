import type { NextFunction, Request, Response } from 'express';
import { DomainError } from '../errors/DomainError.js';
import type { Row } from '../types/rows.js';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function requireValue(condition: unknown, status: number, message: string): asserts condition {
  if (!condition) throw new ApiError(status, message);
}
export const safe = (action: (req: Request, res: Response) => void) => (req: Request, res: Response, next: NextFunction) => {
  try { action(req, res); } catch (error) { next(error); }
};
export const jsonObject = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value);
export const userOf = (res: Response): Row => res.locals.user as Row;

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ApiError) return res.status(error.status).json({ error: error.message });
  if (error instanceof DomainError) return res.status(422).json({ error: error.message });
  if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ error: 'Invalid JSON' });
  if (jsonObject(error) && error.type === 'entity.too.large') return res.status(413).json({ error: 'Body must be 1–65536 bytes' });
  console.error(error);
  return res.status(500).json({ error: 'Internal server error' });
}
