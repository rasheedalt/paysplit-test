"""PaySplit domain, persistence, and sandbox payment processing."""
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = os.environ.get("PAYSPLIT_DB", "paysplit.db")


def now():
    return datetime.now(timezone.utc).isoformat()


def connect():
    db = sqlite3.connect(DB_PATH, timeout=30, isolation_level=None)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    db.execute("PRAGMA busy_timeout=30000")
    return db


def init_db():
    with connect() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
          account_ref TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS destinations (
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL,
          name TEXT NOT NULL, bank_code TEXT, account_number TEXT, verified INTEGER NOT NULL,
          created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS rules (
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), destination_id TEXT NOT NULL REFERENCES destinations(id),
          kind TEXT NOT NULL, value INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS salary_events (
          id TEXT PRIMARY KEY, provider_event_id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL REFERENCES users(id),
          amount INTEGER NOT NULL, currency TEXT NOT NULL, received_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS allocations (
          id TEXT PRIMARY KEY, salary_event_id TEXT NOT NULL REFERENCES salary_events(id),
          rule_id TEXT NOT NULL REFERENCES rules(id), destination_id TEXT NOT NULL REFERENCES destinations(id),
          amount INTEGER NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
          next_attempt_at INTEGER NOT NULL DEFAULT 0, error TEXT, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS ledger (
          id TEXT PRIMARY KEY, journal_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
          account TEXT NOT NULL, amount INTEGER NOT NULL, created_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS ledger_user_idx ON ledger(user_id, created_at);
        CREATE INDEX IF NOT EXISTS allocations_due_idx ON allocations(status, next_attempt_at);
        """)


@contextmanager
def transaction():
    db = connect()
    try:
        db.execute("BEGIN IMMEDIATE")
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def new_id():
    return str(uuid.uuid4())


def password_hash(password, salt=None):
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1)
    return salt.hex() + ":" + digest.hex()


def password_valid(password, stored):
    try:
        salt_hex, expected = stored.split(":", 1)
        actual = password_hash(password, bytes.fromhex(salt_hex)).split(":", 1)[1]
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def journal(db, user_id, entries):
    assert sum(amount for _, amount in entries) == 0
    journal_id = new_id()
    timestamp = now()
    db.executemany("INSERT INTO ledger VALUES (?,?,?,?,?,?)", [
        (new_id(), journal_id, user_id, account, amount, timestamp) for account, amount in entries
    ])


def make_allocations(amount, rules):
    """Fixed amounts and basis-point percentages of gross salary; no rounding drift."""
    values = []
    for rule in rules:
        share = rule["value"] if rule["kind"] == "fixed" else amount * rule["value"] // 10000
        values.append((rule, share))
    if sum(share for _, share in values) > amount:
        raise ValueError("Rules exceed salary amount")
    return [(rule, share) for rule, share in values if share > 0]


def receive_salary(provider_event_id, account_ref, amount, currency="NGN"):
    if not isinstance(provider_event_id, str) or not (1 <= len(provider_event_id) <= 128):
        raise ValueError("Event ID must be 1–128 characters")
    if not isinstance(account_ref, str):
        raise ValueError("Account reference required")
    if not isinstance(amount, int) or isinstance(amount, bool) or amount <= 0:
        raise ValueError("Salary amount must be positive integer kobo")
    if currency != "NGN":
        raise ValueError("Only NGN supported")
    with transaction() as db:
        previous = db.execute("SELECT id, user_id, amount, currency FROM salary_events WHERE provider_event_id=?", (provider_event_id,)).fetchone()
        if previous:
            owner = db.execute("SELECT account_ref FROM users WHERE id=?", (previous["user_id"],)).fetchone()
            if owner["account_ref"] != account_ref or previous["amount"] != amount or previous["currency"] != currency:
                raise ValueError("Event ID already used with different salary data")
            return previous["id"], True
        user = db.execute("SELECT id FROM users WHERE account_ref=?", (account_ref,)).fetchone()
        if not user:
            raise ValueError("Unknown account reference")
        rules = db.execute("""SELECT r.*, d.verified FROM rules r JOIN destinations d ON d.id=r.destination_id
            WHERE r.user_id=? AND r.active=1 ORDER BY r.created_at, r.id""", (user["id"],)).fetchall()
        if any(not rule["verified"] for rule in rules):
            raise ValueError("Active rule has unverified destination")
        allocations = make_allocations(amount, rules)
        event_id = new_id()
        db.execute("INSERT INTO salary_events VALUES (?,?,?,?,?,?)", (event_id, provider_event_id, user["id"], amount, currency, now()))
        journal(db, user["id"], [("external:salary", -amount), ("available", amount)])
        for rule, share in allocations:
            allocation_id = new_id()
            db.execute("INSERT INTO allocations (id,salary_event_id,rule_id,destination_id,amount,status,created_at) VALUES (?,?,?,?,?,?,?)",
                       (allocation_id, event_id, rule["id"], rule["destination_id"], share, "pending", now()))
            journal(db, user["id"], [("available", -share), ("pending:" + allocation_id, share)])
        return event_id, False


def process_pending(limit=100):
    processed = 0
    for _ in range(limit):
        with transaction() as db:
            allocation = db.execute("""SELECT a.*, e.user_id, d.kind, d.account_number FROM allocations a
                JOIN salary_events e ON e.id=a.salary_event_id JOIN destinations d ON d.id=a.destination_id
                WHERE a.status='pending' AND a.next_attempt_at<=? ORDER BY a.created_at, a.id LIMIT 1""", (int(time.time()),)).fetchone()
            if not allocation:
                break
            # Sandbox adapter is deterministic. No external money moves.
            failed = allocation["kind"] == "bank" and allocation["account_number"].endswith("0000")
            attempts = allocation["attempts"] + 1
            if failed and attempts < 3:
                db.execute("UPDATE allocations SET attempts=?, next_attempt_at=?, error=? WHERE id=?",
                           (attempts, int(time.time()) + 60 * attempts, "Sandbox payout failure", allocation["id"]))
            elif failed:
                db.execute("UPDATE allocations SET status='failed', attempts=?, error=? WHERE id=?",
                           (attempts, "Sandbox payout failure", allocation["id"]))
                journal(db, allocation["user_id"], [("pending:" + allocation["id"], -allocation["amount"]), ("available", allocation["amount"])])
            else:
                db.execute("UPDATE allocations SET status='completed', attempts=?, error=NULL WHERE id=?", (attempts, allocation["id"]))
                journal(db, allocation["user_id"], [("pending:" + allocation["id"], -allocation["amount"]),
                    (("savings:" if allocation["kind"] == "savings" else "sent:") + allocation["destination_id"], allocation["amount"])])
            processed += 1
    return processed


def rowdict(row):
    return dict(row) if row else None
