import { DatabaseSync } from 'node:sqlite';
import { env } from '../config/env.js';

const schema = `
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, account_ref TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS destinations (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL, name TEXT NOT NULL, bank_code TEXT, account_number TEXT, verified INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rules (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), destination_id TEXT NOT NULL REFERENCES destinations(id), kind TEXT NOT NULL, value INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS salary_events (id TEXT PRIMARY KEY, provider_event_id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL REFERENCES users(id), amount INTEGER NOT NULL, currency TEXT NOT NULL, received_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS allocations (id TEXT PRIMARY KEY, salary_event_id TEXT NOT NULL REFERENCES salary_events(id), rule_id TEXT NOT NULL REFERENCES rules(id), destination_id TEXT NOT NULL REFERENCES destinations(id), amount INTEGER NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0, error TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ledger (id TEXT PRIMARY KEY, journal_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), account TEXT NOT NULL, amount INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ledger_user_idx ON ledger(user_id, created_at);
CREATE INDEX IF NOT EXISTS allocations_due_idx ON allocations(status, next_attempt_at);
`;

export function openDatabase(path = env.databasePath): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=30000;');
  db.exec(schema);
  return db;
}

export function transaction<T>(db: DatabaseSync, action: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
