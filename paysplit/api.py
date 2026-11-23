"""Dependency-free HTTP API for PaySplit sandbox."""
import hashlib
import hmac
import json
import os
import re
import time
import threading
import logging
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from .core import connect, init_db, new_id, now, password_hash, password_valid, receive_salary, rowdict, transaction


class APIError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


def require(condition, status, message):
    if not condition:
        raise APIError(status, message)


class Handler(BaseHTTPRequestHandler):
    server_version = "PaySplit/0.1"

    def log_message(self, format, *args):
        # Avoid logging credentials or request bodies.
        pass

    def send_json(self, status, value):
        body = json.dumps(value, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def body(self):
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise APIError(400, "Invalid content length")
        require(0 < size <= 65536, 413, "Body must be 1–65536 bytes")
        raw = self.rfile.read(size)
        require(len(raw) == size, 400, "Incomplete body")
        try:
            value = json.loads(raw)
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise APIError(400, "Invalid JSON")
        require(isinstance(value, dict), 400, "JSON object required")
        return value, raw

    def user(self):
        auth = self.headers.get("Authorization", "")
        require(auth.startswith("Bearer "), 401, "Bearer token required")
        token_hash = hashlib.sha256(auth[7:].encode()).hexdigest()
        with connect() as db:
            user = db.execute("""SELECT u.id,u.email,u.account_ref FROM sessions s JOIN users u ON u.id=s.user_id
                WHERE s.token_hash=? AND s.expires_at>?""", (token_hash, int(time.time()))).fetchone()
        require(user is not None, 401, "Invalid or expired token")
        return dict(user)

    def dispatch(self):
        path = urlparse(self.path).path
        method = self.command
        if method == "GET" and path == "/health":
            return 200, {"status": "ok"}
        if method == "GET" and path == "/openapi.json":
            return 200, json.loads((Path(__file__).parent.parent / "openapi.json").read_text())
        if method == "POST" and path == "/v1/users":
            data, _ = self.body()
            email, password = data.get("email"), data.get("password")
            require(isinstance(email, str) and re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) and len(email) <= 254, 422, "Valid email required")
            require(isinstance(password, str) and 12 <= len(password) <= 128, 422, "Password must be 12–128 characters")
            user_id, account_ref = new_id(), "PS-" + new_id()
            try:
                with transaction() as db:
                    db.execute("INSERT INTO users VALUES (?,?,?,?,?)", (user_id, email.lower(), password_hash(password), account_ref, now()))
            except Exception as exc:
                if "UNIQUE constraint failed: users.email" in str(exc):
                    raise APIError(409, "Email already registered")
                raise
            return 201, {"id": user_id, "email": email.lower(), "account_ref": account_ref}
        if method == "POST" and path == "/v1/sessions":
            data, _ = self.body()
            email, password = data.get("email"), data.get("password")
            require(isinstance(email, str) and isinstance(password, str), 422, "Email and password required")
            with connect() as db:
                user = db.execute("SELECT * FROM users WHERE email=?", (email.lower(),)).fetchone()
            require(user is not None and password_valid(password, user["password_hash"]), 401, "Invalid credentials")
            token = new_id() + new_id()
            expires = int(time.time()) + 86400
            with transaction() as db:
                db.execute("INSERT INTO sessions VALUES (?,?,?)", (hashlib.sha256(token.encode()).hexdigest(), user["id"], expires))
            return 201, {"access_token": token, "token_type": "Bearer", "expires_at": expires}
        if method == "POST" and path == "/v1/webhooks/salary":
            data, raw = self.body()
            secret = os.environ.get("PAYSPLIT_WEBHOOK_SECRET", "")
            require(len(secret) >= 32, 503, "Webhook secret not configured")
            stamp = self.headers.get("X-PaySplit-Timestamp", "")
            signature = self.headers.get("X-PaySplit-Signature", "")
            require(stamp.isdigit() and abs(int(time.time()) - int(stamp)) <= 300, 401, "Invalid webhook timestamp")
            expected = hmac.new(secret.encode(), stamp.encode() + b"." + raw, hashlib.sha256).hexdigest()
            require(hmac.compare_digest(signature, expected), 401, "Invalid webhook signature")
            event_id, duplicate = receive_salary(data.get("event_id"), data.get("account_ref"), data.get("amount"), data.get("currency", "NGN"))
            return (200 if duplicate else 201), {"id": event_id, "duplicate": duplicate}
        user = self.user()
        if method == "GET" and path == "/v1/me":
            return 200, user
        if method == "POST" and path == "/v1/destinations":
            data, _ = self.body()
            kind, name = data.get("kind"), data.get("name")
            require(kind in ("bank", "savings"), 422, "Kind must be bank or savings")
            require(isinstance(name, str) and 1 <= len(name) <= 100, 422, "Name required")
            bank_code, account = data.get("bank_code"), data.get("account_number")
            if kind == "bank":
                require(isinstance(bank_code, str) and re.fullmatch(r"\d{3}", bank_code), 422, "Bank code must be 3 digits")
                require(isinstance(account, str) and re.fullmatch(r"\d{10}", account), 422, "Account number must be 10 digits")
            else:
                bank_code, account = None, None
            dest_id = new_id()
            with transaction() as db:
                db.execute("INSERT INTO destinations VALUES (?,?,?,?,?,?,?,?)", (dest_id, user["id"], kind, name, bank_code, account, 1, now()))
            return 201, {"id": dest_id, "kind": kind, "name": name, "verified": True, "verification_method": "sandbox_format_only" if kind == "bank" else "internal"}
        if method == "GET" and path == "/v1/destinations":
            with connect() as db:
                rows = db.execute("SELECT id,kind,name,bank_code,account_number,verified FROM destinations WHERE user_id=?", (user["id"],)).fetchall()
            return 200, {"items": [{**dict(x), "verified": bool(x["verified"])} for x in rows]}
        if method == "POST" and path == "/v1/rules":
            data, _ = self.body()
            dest_id, kind, value = data.get("destination_id"), data.get("kind"), data.get("value")
            require(kind in ("fixed", "percent"), 422, "Kind must be fixed or percent")
            require(type(value) is int and (value > 0 if kind == "fixed" else 1 <= value <= 10000), 422, "Value must be positive kobo or 1–10000 basis points")
            with transaction() as db:
                dest = db.execute("SELECT id FROM destinations WHERE id=? AND user_id=? AND verified=1", (dest_id, user["id"])).fetchone()
                require(dest is not None, 422, "Verified destination required")
                if kind == "percent":
                    total = db.execute("SELECT COALESCE(SUM(value),0) FROM rules WHERE user_id=? AND kind='percent' AND active=1", (user["id"],)).fetchone()[0]
                    require(total + value <= 10000, 422, "Percent rules exceed 100%")
                rule_id = new_id()
                db.execute("INSERT INTO rules (id,user_id,destination_id,kind,value,created_at) VALUES (?,?,?,?,?,?)",
                           (rule_id, user["id"], dest_id, kind, value, now()))
            return 201, {"id": rule_id, "destination_id": dest_id, "kind": kind, "value": value, "active": True}
        if method == "GET" and path == "/v1/rules":
            with connect() as db:
                rows = db.execute("SELECT id,destination_id,kind,value,active FROM rules WHERE user_id=? ORDER BY created_at,id", (user["id"],)).fetchall()
            return 200, {"items": [{**dict(x), "active": bool(x["active"])} for x in rows]}
        if method == "DELETE" and path.startswith("/v1/rules/"):
            rule_id = path.split("/")[-1]
            with transaction() as db:
                result = db.execute("UPDATE rules SET active=0 WHERE id=? AND user_id=? AND active=1", (rule_id, user["id"]))
                require(result.rowcount == 1, 404, "Active rule not found")
            return 200, {"id": rule_id, "active": False}
        if method == "GET" and path == "/v1/salary-events":
            with connect() as db:
                rows = db.execute("SELECT id,amount,currency,received_at FROM salary_events WHERE user_id=? ORDER BY received_at DESC,id DESC LIMIT 100", (user["id"],)).fetchall()
            return 200, {"items": [dict(x) for x in rows]}
        if method == "GET" and path.startswith("/v1/salary-events/"):
            event_id = path.split("/")[-1]
            with connect() as db:
                event = db.execute("SELECT id,amount,currency,received_at FROM salary_events WHERE id=? AND user_id=?", (event_id, user["id"])).fetchone()
                require(event is not None, 404, "Salary event not found")
                allocations = db.execute("SELECT id,rule_id,destination_id,amount,status,attempts,error FROM allocations WHERE salary_event_id=? ORDER BY created_at,id", (event_id,)).fetchall()
            return 200, {**dict(event), "allocations": [dict(x) for x in allocations], "unallocated": event["amount"] - sum(x["amount"] for x in allocations)}
        if method == "GET" and path == "/v1/ledger":
            with connect() as db:
                rows = db.execute("SELECT id,journal_id,account,amount,created_at FROM ledger WHERE user_id=? ORDER BY rowid DESC LIMIT 200", (user["id"],)).fetchall()
            return 200, {"items": [dict(x) for x in rows]}
        raise APIError(404, "Route not found")

    def handle_request(self):
        try:
            status, data = self.dispatch()
        except APIError as exc:
            status, data = exc.status, {"error": exc.message}
        except ValueError as exc:
            status, data = 422, {"error": str(exc)}
        except Exception:
            status, data = 500, {"error": "Internal server error"}
        self.send_json(status, data)

    do_GET = do_POST = do_DELETE = handle_request


def serve(host="127.0.0.1", port=8000):
    init_db()
    if os.environ.get("PAYSPLIT_EMBEDDED_WORKER") == "1":
        def work():
            from .core import process_pending
            while True:
                try:
                    process_pending()
                except Exception:
                    logging.exception("Payout worker failed")
                time.sleep(60)
        threading.Thread(target=work, daemon=True).start()
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    serve(os.environ.get("HOST", "127.0.0.1"), int(os.environ.get("PORT", "8000")))
