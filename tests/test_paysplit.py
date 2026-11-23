import hashlib
import hmac
import json
import os
import tempfile
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from paysplit import core
from paysplit.api import Handler


class PaySplitTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        core.DB_PATH = cls.temp.name + "/test.db"
        os.environ["PAYSPLIT_WEBHOOK_SECRET"] = "s" * 32
        core.init_db()
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.temp.cleanup()

    def request(self, method, path, body=None, token=None, headers=None):
        raw = json.dumps(body, separators=(",", ":")).encode() if body is not None else None
        request = Request(self.base + path, data=raw, method=method, headers={"Content-Type": "application/json", **({"Authorization": "Bearer " + token} if token else {}), **(headers or {})})
        try:
            with urlopen(request) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            return error.code, json.load(error)

    def user_and_token(self):
        email = core.new_id() + "@example.test"
        status, user = self.request("POST", "/v1/users", {"email": email, "password": "password12345"})
        self.assertEqual(status, 201)
        status, session = self.request("POST", "/v1/sessions", {"email": email, "password": "password12345"})
        self.assertEqual(status, 201)
        return user, session["access_token"]

    def signed_salary(self, body, signature_ok=True):
        raw = json.dumps(body, separators=(",", ":")).encode()
        stamp = str(int(time.time()))
        signature = hmac.new(os.environ["PAYSPLIT_WEBHOOK_SECRET"].encode(), stamp.encode() + b"." + raw, hashlib.sha256).hexdigest()
        return self.request("POST", "/v1/webhooks/salary", body, headers={"X-PaySplit-Timestamp": stamp, "X-PaySplit-Signature": signature if signature_ok else "bad"})

    def test_split_idempotency_ledger_and_ownership(self):
        user, token = self.user_and_token()
        other, other_token = self.user_and_token()
        _, savings = self.request("POST", "/v1/destinations", {"kind": "savings", "name": "Emergency"}, token)
        _, bank = self.request("POST", "/v1/destinations", {"kind": "bank", "name": "Mother", "bank_code": "001", "account_number": "1234567890"}, token)
        self.assertEqual(self.request("POST", "/v1/rules", {"destination_id": savings["id"], "kind": "percent", "value": 1000}, token)[0], 201)
        self.assertEqual(self.request("POST", "/v1/rules", {"destination_id": bank["id"], "kind": "fixed", "value": 10000000}, token)[0], 201)
        body = {"event_id": core.new_id(), "account_ref": user["account_ref"], "amount": 60000000, "currency": "NGN"}
        self.assertEqual(self.signed_salary(body, False)[0], 401)
        status, event = self.signed_salary(body)
        self.assertEqual(status, 201)
        self.assertEqual(self.signed_salary(body), (200, {"id": event["id"], "duplicate": True}))
        status, detail = self.request("GET", "/v1/salary-events/" + event["id"], token=token)
        self.assertEqual(sorted(x["amount"] for x in detail["allocations"]), [6000000, 10000000])
        self.assertEqual(detail["unallocated"], 44000000)
        self.assertEqual(core.process_pending(), 2)
        _, detail = self.request("GET", "/v1/salary-events/" + event["id"], token=token)
        self.assertEqual({x["status"] for x in detail["allocations"]}, {"completed"})
        self.assertEqual(self.request("GET", "/v1/salary-events/" + event["id"], token=other_token)[0], 404)
        _, ledger = self.request("GET", "/v1/ledger", token=token)
        journals = {}
        for item in ledger["items"]:
            journals[item["journal_id"]] = journals.get(item["journal_id"], 0) + item["amount"]
        self.assertTrue(all(amount == 0 for amount in journals.values()))
        self.assertEqual(self.signed_salary({**body, "amount": 1})[0], 422)

    def test_overallocation_rolls_back(self):
        user, token = self.user_and_token()
        _, dest = self.request("POST", "/v1/destinations", {"kind": "savings", "name": "Reserve"}, token)
        self.request("POST", "/v1/rules", {"destination_id": dest["id"], "kind": "fixed", "value": 101}, token)
        status, _ = self.signed_salary({"event_id": core.new_id(), "account_ref": user["account_ref"], "amount": 100})
        self.assertEqual(status, 422)
        self.assertEqual(self.request("GET", "/v1/salary-events", token=token)[1]["items"], [])

    def test_failed_payout_retries_then_refunds(self):
        user, token = self.user_and_token()
        _, bank = self.request("POST", "/v1/destinations", {"kind": "bank", "name": "Failure case", "bank_code": "001", "account_number": "1234560000"}, token)
        self.request("POST", "/v1/rules", {"destination_id": bank["id"], "kind": "fixed", "value": 50}, token)
        _, event = self.signed_salary({"event_id": core.new_id(), "account_ref": user["account_ref"], "amount": 100})
        for attempt in range(3):
            self.assertEqual(core.process_pending(), 1)
            _, detail = self.request("GET", "/v1/salary-events/" + event["id"], token=token)
            self.assertEqual(detail["allocations"][0]["attempts"], attempt + 1)
            if attempt < 2:
                self.assertEqual(detail["allocations"][0]["status"], "pending")
                with core.transaction() as db:
                    db.execute("UPDATE allocations SET next_attempt_at=0 WHERE id=?", (detail["allocations"][0]["id"],))
        self.assertEqual(detail["allocations"][0]["status"], "failed")
        with core.connect() as db:
            available = db.execute("SELECT SUM(amount) FROM ledger WHERE user_id=? AND account='available'", (user["id"],)).fetchone()[0]
        self.assertEqual(available, 100)


if __name__ == "__main__":
    unittest.main()
