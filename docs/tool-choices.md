# Tool choices

- **Node.js 24 and TypeScript 5.9:** requested runtime and typed implementation. Node's built-in SQLite module avoids a native database add-on; it remains experimental.
- **Express 5:** small HTTP routing layer, JSON parsing, and middleware. Domain logic stays in `src/core.ts`.
- **SQLite:** transaction boundaries, uniqueness constraints, and balanced append-only ledger in one portable file. Suitable for single-instance sandbox, not a multi-instance production ledger.
- **Node test runner and fetch:** integration tests exercise real HTTP requests and database behavior.
- **Docker:** repeatable API package for host with persistent storage and HTTPS termination.
- **Local sandbox:** bank verification and payouts are deterministic simulations. No bank credentials or real transfer API are available.
- **Platform status:** local Docker deployment is prepared. No public host, domain, public repository, or recording account was provided, so no live URL or video was published.
