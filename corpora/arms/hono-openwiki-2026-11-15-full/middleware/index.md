# Files

- [Built-in Middleware](overview.md) - Catalog of Hono's built-in middleware in src/middleware with the behaviors that matter in practice — serve-static, compress, etag, cache, body-limit, timeout, logger, timing, request-id, trailing-slash, method-override, combine (some/every/except), context-storage and others — plus conventions for writing new middleware.
- [Security and Authentication Middleware](security-and-auth.md) - Mechanisms, defaults and failure behavior of Hono's security middleware — basic-auth and bearer-auth with timing-safe comparison, jwt and jwk with the src/utils/jwt implementation and algorithm-confusion defenses, csrf via Origin/Sec-Fetch-Site, cors preflight handling, secure-headers with CSP nonces, and ip-restriction with CIDR matching.
