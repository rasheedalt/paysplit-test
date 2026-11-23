# Tool choices

- **Python 3.12 standard library:** no external package fetch or runtime dependency. `http.server` provides the JSON API; `hashlib`, `hmac`, and `secrets` implement authentication and webhook verification.
- **SQLite:** transaction boundaries, uniqueness constraints, and a balanced append-only ledger in one portable file. Good for a single-instance sandbox, not a multi-instance production ledger.
- **`unittest` and `urllib`:** integration tests exercise real HTTP requests and database behavior without third-party packages.
- **Docker:** repeatable API package for a host with persistent storage and HTTPS termination.
- **Local sandbox:** bank verification and payouts are deterministic simulations. No bank credentials or real transfer API are available.
- **Platform status:** local Docker deployment is prepared. No public host, domain, public repository, or recording account was provided, so no live URL or video was published.
