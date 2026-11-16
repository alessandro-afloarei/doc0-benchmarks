---
type: concept
title: Middleware policies and HTTP processing
description: How built-in middleware uses ordered request processing for browser policy, authentication, resource limits, and response caching.
tags: [middleware, security, cache, http]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:23:09.970Z
sources:
  - id: openwiki-source-c6eb362a94bf78796a7832b4
    resource: repo://src/middleware/body-limit/index.ts
  - id: openwiki-source-b506e9e559730c86c05d203e
    resource: repo://src/middleware/cache/index.ts
  - id: openwiki-source-963e270a8ebfb612b4c3d5d1
    resource: repo://src/middleware/cors/index.ts
  - id: openwiki-source-eb9e396aa8d9970d4262622e
    resource: repo://src/middleware/csrf/index.ts
  - id: openwiki-source-ef88a825b039e386354ea111
    resource: repo://src/middleware/etag/index.ts
  - id: openwiki-source-704fe270aa4812b037239378
    resource: repo://src/middleware/jwt/jwt.ts
  - id: openwiki-source-3a62e700d7a5e8fe8b34e1d0
    resource: repo://src/middleware/timeout/index.ts
generated: { by: "codex", at: "2026-11-16T17:23:09.970Z" }
---

# Middleware policies and HTTP processing

Built-in middleware is exported through separate package subpaths and runs through the same `(c, next)` contract as application middleware. Registration determines which handlers execute before an endpoint and which response transformations run while the stack unwinds. Start with the [lifecycle](../architecture/request-lifecycle.md) when changing ordering.

## Browser policy and authentication

CORS computes allowed origins and response headers. OPTIONS requests return a bodyless 204 directly; other requests continue downstream. A disallowed origin does not itself terminate normal endpoint execution: the middleware omits the allow-origin header. Configured non-wildcard origins also add `Vary: Origin`. Put preflight handling where it can execute before middleware that would reject the preflight.

CSRF checks a different boundary. For methods outside its safe-method set and form-compatible content types (defaulting missing content type to text/plain), it rejects with 403 only when neither the Sec-Fetch-Site check nor the Origin check allows the request. Defaults accept same-origin fetch metadata or an Origin matching the request URL. Custom origin and fetch-site predicates may be asynchronous. Missing headers do not pass their respective checks. Read the boolean condition carefully: the two checks provide alternative ways to allow a request.

JWT middleware requires a secret and explicit algorithm, plus Web Crypto key-import support. It first reads the configured authorization header, requiring a two-part Bearer value; only when that header is absent does it try the configured cookie. Missing or invalid tokens produce a 401 HTTPException with a Bearer challenge. Successful verification puts the payload in `c.set('jwtPayload', payload)` before calling the endpoint. That verified payload is request state, not a persistence layer or an application authorization policy.

## Resource limits

`bodyLimit({ maxSize })` runs before downstream body handling. With Content-Length and no Transfer-Encoding, it checks the declared length. With Transfer-Encoding or no length, it reads and counts all chunks before invoking downstream code, then reconstructs the raw request body for consumers. Oversized input uses the configured error handler or a default 413 exception. The buffering branch means handlers cannot evade the check by ignoring the body, reading only one chunk, or swallowing read errors; it also means accepted bodies are buffered.

`timeout(duration)` races `next()` against a rejecting timer and clears the timer afterward. The default exception is 504. The implementation does not abort the downstream operation, so a timeout response alone does not cancel an external fetch or database operation.

## Response processing and cache ownership

ETag middleware waits for downstream output, uses an existing ETag or hashes a cloned response body, and evaluates If-None-Match. A match replaces the response with a bodyless 304 and retains only its configured header set. Hashing consumes a cloned stream, which matters when combining it with streaming responses.

Cache middleware depends on the runtime's `globalThis.caches`. If unavailable when middleware is created, it reports that through its configured callback/log behavior and installs a pass-through. It bypasses non-GET requests and requests carrying Authorization. Configured `vary` headers contribute to cache keys, and `vary: '*'` is rejected. Cache writes depend on response eligibility; request/response policy checks and response headers must be considered alongside the configured status codes. See the implementation before changing cache-key or personalized-response behavior.

These features have different state owners: context variables live for a request, router/middleware closures live with the application, and cache entries live in the runtime cache service. [Runtime adapters](../integrations/runtime-adapters.md) explain where platform capabilities enter the application.

## Extension and verification

Custom middleware should return a response to stop processing or await `next()` to continue, then use the [context response API](request-context.md) for response changes. Context-storage middleware offers ambient access through `AsyncLocalStorage` from `node:async_hooks`; `getContext()` throws outside an active stored context, whereas `tryGetContext()` returns undefined. This optional import introduces a runtime capability requirement.

Focused suites live beside each implementation. Body-limit tests specifically exercise conflicting transfer headers and handlers that ignore, partially read, or swallow body errors. CORS, CSRF, JWT, timeout, cache, and ETag each have nearby tests for their own contract; preserve those distinctions when combining policies.
