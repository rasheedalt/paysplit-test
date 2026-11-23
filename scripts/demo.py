"""Local end-to-end demo: registration, rules, signed salary, scheduled payout, ledger."""
import hashlib
import hmac
import json
import os
import subprocess
import sys
import tempfile
import time
import uuid
from urllib.request import Request, urlopen

PORT = 8765
BASE = f"http://127.0.0.1:{PORT}"


def call(method, path, data=None, token=None, headers=None):
    raw = json.dumps(data, separators=(",", ":")).encode() if data is not None else None
    request = Request(BASE + path, data=raw, method=method, headers={"Content-Type": "application/json", **({"Authorization": "Bearer " + token} if token else {}), **(headers or {})})
    with urlopen(request) as response:
        return json.load(response)


def show(label, value):
    print(f"\n{label}\n{json.dumps(value, indent=2)}", flush=True)


def main():
    with tempfile.TemporaryDirectory() as temp:
        env = {**os.environ, "PAYSPLIT_DB": temp + "/demo.db", "PAYSPLIT_WEBHOOK_SECRET": "demo-secret-" + "x" * 32, "PORT": str(PORT)}
        server = subprocess.Popen([sys.executable, "-m", "paysplit.api"], env=env)
        try:
            for _ in range(50):
                try:
                    call("GET", "/health")
                    break
                except Exception:
                    time.sleep(0.1)
            email = f"demo-{uuid.uuid4().hex[:8]}@example.test"
            user = call("POST", "/v1/users", {"email": email, "password": "demo-password-123"})
            session = call("POST", "/v1/sessions", {"email": email, "password": "demo-password-123"})
            token = session["access_token"]
            show("Registered user and salary account", user)
            mother = call("POST", "/v1/destinations", {"kind": "bank", "name": "Mother", "bank_code": "001", "account_number": "1234567890"}, token)
            brother = call("POST", "/v1/destinations", {"kind": "bank", "name": "Brother", "bank_code": "001", "account_number": "1234567891"}, token)
            savings = call("POST", "/v1/destinations", {"kind": "savings", "name": "Savings"}, token)
            for dest, kind, value in [(mother, "fixed", 10000000), (brother, "fixed", 5000000), (savings, "fixed", 20000000), (savings, "percent", 1000)]:
                call("POST", "/v1/rules", {"destination_id": dest["id"], "kind": kind, "value": value}, token)
            show("Configured rules", call("GET", "/v1/rules", token=token))
            salary = {"event_id": "salary-" + uuid.uuid4().hex, "account_ref": user["account_ref"], "amount": 60000000, "currency": "NGN"}
            raw = json.dumps(salary, separators=(",", ":")).encode()
            stamp = str(int(time.time()))
            signature = hmac.new(env["PAYSPLIT_WEBHOOK_SECRET"].encode(), stamp.encode() + b"." + raw, hashlib.sha256).hexdigest()
            headers = {"X-PaySplit-Timestamp": stamp, "X-PaySplit-Signature": signature}
            event = call("POST", "/v1/webhooks/salary", salary, headers=headers)
            show("Signed salary accepted", event)
            show("Idempotent replay", call("POST", "/v1/webhooks/salary", salary, headers=headers))
            show("Split before payout", call("GET", "/v1/salary-events/" + event["id"], token=token))
            subprocess.run([sys.executable, "-m", "paysplit.worker", "--once"], env=env, check=True)
            show("Split after payout", call("GET", "/v1/salary-events/" + event["id"], token=token))
            show("Money record", call("GET", "/v1/ledger", token=token))
        finally:
            server.terminate()
            server.wait(timeout=5)


if __name__ == "__main__":
    main()
