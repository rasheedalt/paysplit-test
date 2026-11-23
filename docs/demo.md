# 3–5 minute demo narration

1. Run `npm run demo`. Show registration and account reference. Explain salary source uses account reference, while client holds bearer token.
2. Show four rules: 10% of gross, 100,000 NGN to Mother, 50,000 NGN to Brother, and 200,000 NGN to Savings. All API amounts are kobo.
3. Show signed webhook for 600,000 NGN. Show duplicate webhook returns same event. Explain event ID and HMAC prevent duplicate allocation and unauthorized injection.
4. Show pending allocations, then worker output. Show completed allocations and 190,000 NGN unallocated. Explain worker runs every minute when enabled.
5. Show ledger summary. Each journal sums to zero. Explain sandbox bank verification and payouts; no real money moved.

Suggested recording length: 3–5 minutes. Script is executable demo, not video file.
