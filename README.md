# PaySplit backend sandbox

PaySplit routes verified salary events through user rules, records every movement, and processes transfers or savings allocations. This is a **sandbox API**: bank verification checks format only and payouts move no real money. Do not use it to hold or move customer funds.

## Run locally

Requires Node.js 24 or later. Prisma 6 manages a local SQLite database.

```sh
npm ci
cp .env.example .env
# Set PAYSPLIT_WEBHOOK_SECRET in .env using:
# node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))'
npm run build
npm run db:migrate
npm run dev
```

In another terminal, run scheduler worker:

```sh
npm run worker
```

`npm run db:migrate` applies Prisma migrations. `npm run dev` watches TypeScript and restarts API on changes; `npm start` runs compiled build. Both listen on `http://127.0.0.1:8000`. SQLite URL in `.env.example` points to `prisma/paysplit.db`; Prisma resolves relative file paths from `prisma/schema.prisma`. Set `HOST` and `PORT` for deployment. Set `PAYSPLIT_EMBEDDED_WORKER=1` to process payouts every 60 seconds inside API process. Open `http://127.0.0.1:8000/api-docs/` to test endpoints in Swagger UI. `GET /health`, `GET /openapi.json`, and Swagger UI need no token. Other user endpoints need bearer token.

Source follows LeasHub backend's boundaries at project scale: `src/app.ts` composes routes; `src/routes/` maps URLs; `src/controllers/` handles HTTP; `src/services/` owns auth and money logic; `src/database/` creates Prisma Client; `prisma/` owns schema and migrations; `src/middleware/` handles auth and errors; `src/jobs/` runs payouts; `src/config/` reads environment. Integration tests live in `tests/integration/`.

For an attachment-ready walkthrough, use [Run and test guide](docs/RUN_AND_TEST.md).

Run focused integration tests and end-to-end demo:

```sh
npm test
npm run demo
```

Demo creates a temporary user with password `demo-password-123` in a disposable database. It prints registration, rule setup, signed 600,000 NGN salary event, idempotent replay, payout state, and ledger summary. It does not create a user in your local API database. See [demo narration](docs/demo.md) for 3–5 minute walkthrough. [OpenAPI specification](openapi.json) describes endpoints. [curl examples](docs/curl.md) exercise them.

## Money and execution model

Amounts are integer **kobo**. Percentage rule values are **basis points** (1000 = 10%). Each percentage applies to gross salary; fixed amounts apply once. For 600,000 NGN, rules of 10%, 100,000 NGN, 50,000 NGN, and 200,000 NGN allocate 410,000 NGN. Remaining 190,000 NGN stays available. If allocations exceed income, whole event is rejected before any ledger entry. Rule changes affect future salary events only.

Trusted salary source posts signed webhook. Signature is HMAC-SHA256 over `timestamp + "." + raw JSON body`, using `PAYSPLIT_WEBHOOK_SECRET`. Timestamp must be within five minutes. Provider event ID is unique; exact replay returns same event, while conflicting replay is rejected. One Prisma transaction stores salary event, allocation snapshot, and balanced journal postings. Worker processes pending allocations, retries simulated failures, and posts completion or refund journals. Bank accounts ending `0000` simulate failed payout. Savings allocations remain internal.

Passwords use scrypt with random salt. Session tokens are random, stored as SHA-256 hashes, and expire after 24 hours. Queries scope records to authenticated user. API limits JSON bodies to 64 KiB. Deploy only behind HTTPS. Secrets must come from host environment. This sandbox has no rate limiter, real bank name enquiry, transfer provider, reconciliation, or durable hosted database. Those are required before production money movement.

## Existing SQLite database

Prisma models map to existing SQLite tables and columns. Existing user records, rules, and ledger entries remain readable. Back up existing database before cutover. If existing database is at project root, set `DATABASE_URL=file:../paysplit.db` in `.env`. Before first `npm start` against an existing nonempty database, mark initial migration as already applied:

```sh
node --env-file=.env node_modules/prisma/build/index.js migrate resolve --applied 20261124000000_init
npm run db:migrate
npm start
```

Baseline only a database with the previous PaySplit schema. Prisma returns `P3005` for nonempty databases without a baseline. Do not run old and new workers against the same file during cutover. To roll back code, use commit `a2fab48`; restore database backup if later migrations changed its schema.

## Deployable package

`Dockerfile` has separate migration and API images. Run migration image once against persistent volume before starting API image. Set unique `PAYSPLIT_WEBHOOK_SECRET` environment variable of at least 32 characters. Example:

```sh
docker build --target migrate -t paysplit-migrate .
docker run --rm -v paysplit-data:/data paysplit-migrate
docker build -t paysplit .
docker run --rm -p 8000:8000 -v paysplit-data:/data -e PAYSPLIT_WEBHOOK_SECRET="your-random-secret-at-least-32-characters" paysplit
```

A free host without persistent volume loses users, rules, and ledger on restart. Do not publish that setup as money service. Public repository, hosted URL, and video demo require connected accounts and publication approval; they are not included in local checkout.

## Approach and tool choices

See [tool choices](docs/tool-choices.md). Design keeps one path from signed income through deterministic split, atomic money record, and scheduled sandbox payout. It avoids provider-specific integration until provider credentials and settlement contracts exist.
