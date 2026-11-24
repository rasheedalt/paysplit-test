# Tool choices

- **Node.js 24 and TypeScript 5.9:** requested runtime and typed implementation.
- **Express 5:** small HTTP routing layer, JSON parsing, and middleware. Domain logic stays in `src/services/moneyService.ts`.
- **Prisma 6 with SQLite:** typed models, transactions, and versioned migrations while retaining existing data file. Suitable for single-instance sandbox, not a multi-instance production ledger.
- **Node test runner and fetch:** integration tests exercise real HTTP requests and database behavior.
- **Docker:** separate migration and API images. API image excludes Prisma CLI and needs persistent storage plus HTTPS termination.
- **Local sandbox:** bank verification and payouts are deterministic simulations. No bank credentials or real transfer API are available.
- **Platform status:** local Docker deployment is prepared. No public host, domain, public repository, or recording account was provided, so no live URL or video was published.
