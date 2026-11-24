import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import path from 'node:path';

const url = process.env.DATABASE_URL;
if (!url?.startsWith('file:')) throw new Error('DATABASE_URL must be a SQLite file URL');
const filePart = url.slice(5);
if (!filePart || filePart === ':memory:')
  throw new Error('DATABASE_URL must name a persistent SQLite file');
const databasePath = path.isAbsolute(filePart)
  ? filePart
  : path.resolve(process.cwd(), 'prisma', filePart);
mkdirSync(path.dirname(databasePath), { recursive: true });
if (!existsSync(databasePath)) closeSync(openSync(databasePath, 'wx'));
execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
});
