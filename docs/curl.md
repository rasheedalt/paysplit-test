# curl flow

Set local API and unique webhook secret in server environment. Amounts are kobo.

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

For signed webhook, run `npm run demo` or generate HMAC with this Node.js snippet. It uses same secret as server:

```sh
node --input-type=module <<'JS'
import { createHmac } from 'node:crypto';
const body = JSON.stringify({ event_id: 'pay-cycle-001', account_ref: process.env.ACCOUNT_REF, amount: 60000000, currency: 'NGN' });
const stamp = String(Math.floor(Date.now() / 1000));
const signature = createHmac('sha256', process.env.PAYSPLIT_WEBHOOK_SECRET).update(`${stamp}.${body}`).digest('hex');
const response = await fetch(`${process.env.BASE}/v1/webhooks/salary`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-PaySplit-Timestamp': stamp, 'X-PaySplit-Signature': signature },
  body,
});
console.log(response.status, await response.text());
JS
npm run worker -- --once
curl -s "$BASE/v1/salary-events" -H "Authorization: Bearer $TOKEN"
curl -s "$BASE/v1/ledger" -H "Authorization: Bearer $TOKEN"
```
