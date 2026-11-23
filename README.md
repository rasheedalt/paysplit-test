# PaySplit backend sandbox

PaySplit routes a verified salary event through user rules, records every movement, and processes transfers or savings allocations. This repository is a **sandbox API**: bank verification checks format only and payouts move no real money. Do not use it to hold or move customer funds.

## Run locally

Requires Python 3.12. No third-party packages.

```sh
export PAYSPLIT_WEBHOOK_SECRET="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
export PAYSPLIT_DB="$PWD/paysplit.db"
python3 -m paysplit.api
```

In another terminal, run scheduler worker:

```sh
python3 -m paysplit.worker
```

API listens on `http://127.0.0.1:8000`. Set `HOST` and `PORT` for deployment. Set `PAYSPLIT_EMBEDDED_WORKER=1` to process payouts every 60 seconds inside API process. `GET /health` and `GET /openapi.json` need no token. Other user endpoints need bearer token.

Run focused integration tests and end-to-end demo:

```sh
python3 -m unittest discover -s tests -v
python3 scripts/demo.py
```

Demo prints registration, rule setup, a signed 600,000 NGN salary event, idempotent replay, payout state, and ledger. See [demo narration](docs/demo.md) for a 3–5 minute walkthrough. [OpenAPI specification](openapi.json) describes endpoints. [curl examples](docs/curl.md) exercise them.

## Money and execution model

Amounts are integer **kobo**. Percentage rule values are **basis points** (1000 = 10%). Each percentage applies to gross salary; fixed amounts apply once. For 600,000 NGN, rules of 10%, 100,000 NGN, 50,000 NGN, and 200,000 NGN allocate 410,000 NGN. The remaining 190,000 NGN stays available. If allocations exceed income, the whole event is rejected before any ledger entry. Rule changes affect future salary events only.

A trusted salary source posts a signed webhook. The signature is HMAC-SHA256 over `timestamp + "." + raw JSON body`, using `PAYSPLIT_WEBHOOK_SECRET`. Timestamp must be within five minutes. Provider event ID is unique; exact replay returns the same event, while conflicting replay is rejected. One SQLite transaction stores the salary event, allocation snapshot, and balanced journal postings. Worker processes pending allocations, retries simulated failures, and posts completion or refund journals. Bank accounts ending `0000` simulate a failed payout. Savings allocations remain internal.

Passwords use scrypt with random salt. Session tokens are random, stored as SHA-256 hashes, and expire after 24 hours. Queries scope records to authenticated user. API limits request bodies to 64 KiB. Deploy only behind HTTPS. Secrets must come from host environment. This sandbox has no rate limiter, real bank name enquiry, transfer provider, reconciliation, or durable hosted database. Those are required before production money movement.

## Deployable package

`Dockerfile` runs one API instance with embedded worker. Mount a persistent volume at `/data` and set a unique `PAYSPLIT_WEBHOOK_SECRET` environment variable of at least 32 characters. The image uses Python standard library only. Example:

```sh
docker build -t paysplit .
docker run --rm -p 8000:8000 -v paysplit-data:/data -e PAYSPLIT_WEBHOOK_SECRET="your-random-secret-at-least-32-characters" paysplit
```

A free host without persistent volume loses users, rules, and ledger on restart. Do not publish that setup as a money service. A public repository, hosted URL, and video demo require connected accounts and publication approval; they are not included in this local checkout.

## Approach and tool choices

See [tool choices](docs/tool-choices.md). Current design keeps one clear path from signed income through deterministic split, atomic money record, and scheduled sandbox payout. It avoids provider-specific integrations until provider credentials and settlement contracts exist.
