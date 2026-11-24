import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

export const newId = () => randomUUID();
export const now = () => new Date().toISOString();
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

export function passwordHash(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function passwordValid(password: string, stored: string): boolean {
  try {
    const [saltHex, expectedHex] = stored.split(':');
    if (!saltHex || !expectedHex || !/^[0-9a-f]{32}$/.test(saltHex) || !/^[0-9a-f]{128}$/.test(expectedHex)) return false;
    const expected = Buffer.from(expectedHex, 'hex');
    const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
