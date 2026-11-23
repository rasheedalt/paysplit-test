# curl flow

Set local API and a unique webhook secret in server environment. Amounts are kobo.

```sh
export BASE=http://127.0.0.1:8000
curl -s "$BASE/health"
curl -s -X POST "$BASE/v1/users" -H 'Content-Type: application/json' -d '{"email":"ada@example.test","password":"a-long-password-123"}'
# Copy account_ref from response.
curl -s -X POST "$BASE/v1/sessions" -H 'Content-Type: application/json' -d '{"email":"ada@example.test","password":"a-long-password-123"}'
# Copy access_token, then set TOKEN and ACCOUNT_REF.
export TOKEN='paste-access-token'
export ACCOUNT_REF='paste-account-ref'
curl -s -X POST "$BASE/v1/destinations" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"kind":"savings","name":"Emergency"}'
# Copy destination id, then set DEST_ID.
export DEST_ID='paste-destination-id'
curl -s -X POST "$BASE/v1/rules" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"destination_id\":\"$DEST_ID\",\"kind\":\"percent\",\"value\":1000}"
```

For signed webhook, run `python3 scripts/demo.py` or generate HMAC with this Python snippet. It uses same secret as server:

```sh
python3 - <<'PY'
import hashlib, hmac, json, os, time, urllib.request
body = json.dumps({"event_id": "pay-cycle-001", "account_ref": os.environ["ACCOUNT_REF"], "amount": 60000000, "currency": "NGN"}, separators=(",", ":")).encode()
stamp = str(int(time.time()))
sig = hmac.new(os.environ["PAYSPLIT_WEBHOOK_SECRET"].encode(), stamp.encode() + b"." + body, hashlib.sha256).hexdigest()
request = urllib.request.Request(os.environ["BASE"] + "/v1/webhooks/salary", body, {"Content-Type": "application/json", "X-PaySplit-Timestamp": stamp, "X-PaySplit-Signature": sig})
print(urllib.request.urlopen(request).read().decode())
PY
python3 -m paysplit.worker --once
curl -s "$BASE/v1/salary-events" -H "Authorization: Bearer $TOKEN"
curl -s "$BASE/v1/ledger" -H "Authorization: Bearer $TOKEN"
```
