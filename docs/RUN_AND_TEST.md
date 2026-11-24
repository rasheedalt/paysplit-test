# PaySplit API: run and test guide

This guide is self-contained for a local sandbox run. PaySplit does not verify real bank ownership or transfer real money. API amounts are integer **kobo**; 100 kobo = 1 NGN.

## 1. Requirements

- Node.js 24 or later and npm.
- A terminal with `curl`.
- This repository checked out locally.

Open a terminal in the repository root. Check your tools:

```sh
node --version
npm --version
```

## 2. Install and configure

```sh
npm ci
cp .env.example .env
node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))'
```

Copy the generated value into `PAYSPLIT_WEBHOOK_SECRET=` in `.env`. Keep the value private. Leave `DATABASE_URL=file:./paysplit.db` and `PAYSPLIT_EMBEDDED_WORKER=0` for this walkthrough. Prisma resolves that database path inside `prisma/`.

Build the TypeScript code and apply database migrations:

```sh
npm run build
npm run db:migrate
```

Expected: TypeScript build succeeds, and Prisma reports initial migration applied or no pending migrations. These steps create `prisma/paysplit.db` on a fresh checkout. For an existing nonempty PaySplit database, back it up and follow the baseline instructions in `README.md` before running migrations.

## 3. Start API

Keep this terminal open:

```sh
npm run dev
```

Expected: `PaySplit listening on 127.0.0.1:8000`. The development command restarts API when TypeScript source changes. For compiled mode, use `npm start` instead.

Open a second terminal in the repository root. Check health and OpenAPI:

```sh
export BASE=http://127.0.0.1:8000
curl -i "$BASE/health"
curl -s "$BASE/openapi.json" > /tmp/paysplit-openapi.json
```

Expected health response: HTTP 200 with `{"status":"ok"}`. The second command saves API specification for inspection or import into an OpenAPI client.

Open `http://127.0.0.1:8000/api-docs/` in a browser to use Swagger UI. Expand `POST /v1/users`, select **Try it out**, enter an email and password of at least 12 characters, and select **Execute**. Then use `POST /v1/sessions` with the same credentials. Copy `access_token` from the response, select **Authorize** at the top, and paste the token. You can now execute protected endpoints. The salary webhook requires an HMAC signature; use the signed webhook example in section 5 or `npm run demo` for that call.

## 4. Run automated checks

In the second terminal:

```sh
npm test
npm run format:check
npm run demo
```

`npm test` builds code and runs three HTTP integration tests against a disposable database. Tests cover signed webhooks, split math, duplicate salary events, ledger balance, user isolation, over-allocation rollback, payout retries, and refunds. Expected: **3 passing tests**.

`npm run format:check` checks TypeScript formatting. `npm run demo` runs an independent end-to-end scenario on port 8765 and a disposable database. Expected demo result: 600,000 NGN salary; 410,000 NGN allocated; 190,000 NGN (`19000000` kobo) unallocated; four completed allocations; 18 ledger postings across nine balanced journals. Demo needs no running API on port 8000.

Demo user password is `demo-password-123`. Its email changes on every run and appears in demo output. The demo database is deleted afterward, so these credentials cannot log in to the local API on port 8000.

## 5. Exercise API manually

Keep `npm run dev` running in first terminal. Run following commands in second terminal. Replace each `paste-...` value with value from previous response.

### Register and log in

```sh
curl -s -X POST "$BASE/v1/users" \
  -H 'Content-Type: application/json' \
  -d '{"email":"pay-demo@example.test","password":"demo-password-123"}'
```

Expected: HTTP 201 JSON with `id`, `email`, and `account_ref`. If email already exists from an earlier run, use a new email. Copy `account_ref`:

```sh
export ACCOUNT_REF='paste-account-ref'
```

Log in with same email and password:

```sh
curl -s -X POST "$BASE/v1/sessions" \
  -H 'Content-Type: application/json' \
  -d '{"email":"pay-demo@example.test","password":"demo-password-123"}'
```

Expected: HTTP 201 JSON with `access_token`. Copy token:

```sh
export TOKEN='paste-access-token'
```

### Create destinations

Create two sandbox bank destinations and one internal savings destination:

```sh
curl -s -X POST "$BASE/v1/destinations" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"kind":"bank","name":"Mother","bank_code":"001","account_number":"1234567890"}'

curl -s -X POST "$BASE/v1/destinations" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"kind":"bank","name":"Brother","bank_code":"001","account_number":"1234567891"}'

curl -s -X POST "$BASE/v1/destinations" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"kind":"savings","name":"Savings"}'
```

Each response contains `id` and `verified: true`. Bank verification is format-only in this sandbox. Copy each ID:

```sh
export MOTHER_ID='paste-mother-destination-id'
export BROTHER_ID='paste-brother-destination-id'
export SAVINGS_ID='paste-savings-destination-id'
```

### Create four split rules

These rules allocate 10% of gross salary, 100,000 NGN to Mother, 50,000 NGN to Brother, and 200,000 NGN to Savings. Fixed amounts below are kobo. `1000` basis points means 10%.

```sh
curl -s -X POST "$BASE/v1/rules" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"destination_id\":\"$SAVINGS_ID\",\"kind\":\"percent\",\"value\":1000}"

curl -s -X POST "$BASE/v1/rules" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"destination_id\":\"$MOTHER_ID\",\"kind\":\"fixed\",\"value\":10000000}"

curl -s -X POST "$BASE/v1/rules" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"destination_id\":\"$BROTHER_ID\",\"kind\":\"fixed\",\"value\":5000000}"

curl -s -X POST "$BASE/v1/rules" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"destination_id\":\"$SAVINGS_ID\",\"kind\":\"fixed\",\"value\":20000000}"

curl -s "$BASE/v1/rules" -H "Authorization: Bearer $TOKEN"
```

Expected: four active rules.

### Submit signed salary event

Set a unique event ID. Reuse same ID to test idempotency:

```sh
export EVENT_ID="manual-paycycle-$(date +%s)"
```

This Node command reads webhook secret from `.env`, signs exact JSON bytes, and sends 600,000 NGN (`60000000` kobo). It is a local simulation of a trusted salary source:

```sh
node --env-file=.env --input-type=module <<'JS'
import { createHmac } from 'node:crypto';

const body = JSON.stringify({
  event_id: process.env.EVENT_ID,
  account_ref: process.env.ACCOUNT_REF,
  amount: 60000000,
  currency: 'NGN',
});
const timestamp = String(Math.floor(Date.now() / 1000));
const signature = createHmac('sha256', process.env.PAYSPLIT_WEBHOOK_SECRET)
  .update(`${timestamp}.${body}`)
  .digest('hex');
const response = await fetch(`${process.env.BASE}/v1/webhooks/salary`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-PaySplit-Timestamp': timestamp,
    'X-PaySplit-Signature': signature,
  },
  body,
});
console.log(response.status, await response.text());
JS
```

Expected first response: HTTP 201 with an event `id` and `duplicate: false`. Copy event ID:

```sh
export SALARY_EVENT_ID='paste-event-id'
```

Run same signed-event command again without changing `EVENT_ID` or amount. Expected: HTTP 200, same event `id`, `duplicate: true`.

Check split before payout:

```sh
curl -s "$BASE/v1/salary-events/$SALARY_EVENT_ID" -H "Authorization: Bearer $TOKEN"
```

Expected allocation amounts: `6000000`, `10000000`, `5000000`, and `20000000` kobo. `unallocated` is `19000000` kobo. Initial allocation status is `pending`.

### Run payout worker and inspect money record

```sh
npm run worker -- --once
curl -s "$BASE/v1/salary-events/$SALARY_EVENT_ID" -H "Authorization: Bearer $TOKEN"
curl -s "$BASE/v1/ledger" -H "Authorization: Bearer $TOKEN"
```

Expected worker output: `Processed 4 allocations`. Allocation status becomes `completed`. Ledger contains balanced debit and credit postings for salary receipt, four allocations, and four completions. No real transfer occurs.

### Check access control

```sh
curl -i "$BASE/v1/ledger"
```

Expected: HTTP 401 with `Bearer token required`.

## 6. Stop and troubleshoot

Stop development server with `Ctrl+C`. Stop continuous worker with `Ctrl+C` if you started one.

- `P3005`: database already contains tables but has no Prisma migration history. Back up database and follow baseline instructions in `README.md` only if it uses previous PaySplit schema.
- Webhook returns 503: set `PAYSPLIT_WEBHOOK_SECRET` in `.env` to at least 32 characters, then restart API.
- Webhook returns 401: verify secret, timestamp, and signature over exact JSON body bytes. Timestamps older than five minutes fail.
- Port 8000 busy: change `PORT` in `.env`, restart API, and update `BASE` in second terminal.
- `npm run worker -- --once` processes 0 allocations: check whether event already completed, embedded worker is enabled, or failed allocation awaits retry.

This guide covers local sandbox only. It does not provide a public deployment URL, real bank verification, real transfers, or a recorded video.
