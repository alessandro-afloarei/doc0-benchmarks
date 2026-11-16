---
type: concept
title: Middleware composition and security boundaries
description: Ordering middleware around endpoints and understanding authentication, browser policy, body limits, caching, timeout, and request observability contracts.
tags: [middleware, security, authentication, cache, observability]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:16:56.556Z
sources:
  - id: openwiki-source-c6eb362a94bf78796a7832b4
    resource: repo://src/middleware/body-limit/index.ts
  - id: openwiki-source-b506e9e559730c86c05d203e
    resource: repo://src/middleware/cache/index.ts
  - id: openwiki-source-963e270a8ebfb612b4c3d5d1
    resource: repo://src/middleware/cors/index.ts
  - id: openwiki-source-eb9e396aa8d9970d4262622e
    resource: repo://src/middleware/csrf/index.ts
  - id: openwiki-source-704fe270aa4812b037239378
    resource: repo://src/middleware/jwt/jwt.ts
  - id: openwiki-source-3a62e700d7a5e8fe8b34e1d0
    resource: repo://src/middleware/timeout/index.ts
generated: { by: "codex", at: "2026-11-16T06:16:56.556Z" }
---

# Middleware composition and security boundaries

Built-in middleware is published through separate package subpaths such as `hono/cors`, `hono/jwt`, and `hono/body-limit`. Each middleware participates in the same context/next chain as an endpoint. Register it before the handlers it must wrap, return early to stop processing, and await `next()` before inspecting downstream results. [Request lifecycle](../architecture/request-lifecycle.md) explains response finalization and error conversion.

## Compose policy around the route

A useful order is outer response policy and observation, then request guards and authentication, then validation and endpoint work. This is an application design choice: early responses skip downstream middleware, including its response mutations. Test the exact order when preflight, cache hits, authentication failures, or upgrades can stop the chain.

[Combine helpers](../../src/middleware/combine/index.ts) provide conditional composition. `some` tries alternatives until one succeeds, retaining the last failure when none do; it stops trying alternatives after downstream `next()` has been entered. `every` composes all handlers and treats a false condition as failure. `except` skips composed middleware when a configured path or condition matches. These helpers preserve the surrounding route's parameter index while composing internal handlers.

## Authentication and browser policy

[JWT middleware](../../src/middleware/jwt/jwt.ts) requires a secret and an explicit algorithm, and checks Web Crypto capability at construction. It reads a Bearer token from the configured header, falling back to configured cookies when the header is absent. Invalid credentials, a missing token, or verification failure produce HTTP 401 exceptions. Successful verification writes `jwtPayload` into context variables before continuing. Declare the corresponding variable type where application code consumes it. Basic and Bearer auth have separate middleware implementations for other credential schemes.

[CORS](../../src/middleware/cors/index.ts) computes allowed origins and methods from options. OPTIONS requests are answered with a 204 preflight response without entering downstream handlers; normal requests continue and receive the configured response headers. A specific origin policy appends `Vary: Origin`. Its default allowed origin is `*`; choose origins and credentials deliberately for the application's browser access policy.

[CSRF](../../src/middleware/csrf/index.ts) checks unsafe methods with form-compatible content types, treating a missing content type as text/plain. It allows the request when either its origin check or its valid Sec-Fetch-Site check succeeds, otherwise throws a 403 exception. Defaults permit the request URL's own origin and `same-origin` fetch-site. This policy has a different responsibility from CORS response headers; evaluate both when configuring browser-facing endpoints.

The [secure headers middleware](../../src/middleware/secure-headers/secure-headers.ts) builds configured security response headers, including content security policy. JSX streamed replacement scripts have their own nonce configuration described in [rendering](jsx-rendering.md).

## Body size enforcement

[bodyLimit](../../src/middleware/body-limit/index.ts) skips requests without a body. With Content-Length and no Transfer-Encoding, it compares the declared length to `maxSize` and proceeds without reading the body. With Transfer-Encoding present or no length, it reads and counts all bytes before the handler runs. Exceeding the limit calls `onError`, whose default throws a 413 exception.

For an accepted counted body, the middleware constructs a replacement raw request with replayable chunks. This up-front buffering means a handler cannot bypass the count by reading only one chunk, reading nothing, or swallowing read errors. It also means memory and latency scale with the accepted body. Install this guard before body-consuming validation or endpoint code.

## Cache ownership and variation

[cache](../../src/middleware/cache/index.ts) uses the runtime's global Cache API. If that API is unavailable when middleware is constructed, it returns a pass-through handler and optionally reports the absence. It is not a framework-owned in-memory cache.

Only GET requests without an Authorization header enter the lookup path. The default key is the request URL, extended with configured `vary` header values; `keyGenerator` and dynamic cache names customize storage boundaries. A hit returns immediately. On a miss, middleware awaits the endpoint and, by default, considers only status 200 cacheable.

Storage skips responses with Set-Cookie, private/no-store/no-cache directives, or response Vary fields not covered by configured key variation. A configured wildcard Vary is rejected. For accepted responses, `wait: true` awaits `cache.put`; the default background mode requires `c.executionCtx.waitUntil`. This is a runtime capability requirement, including in local tests.

## Time and observability

[timeout](../../src/middleware/timeout/index.ts) races downstream work against a timer, defaults to a 504 exception, and clears the timer afterward. The race does not cancel downstream work or its external side effects; application I/O needs its own cancellation mechanism.

[Logger](../../src/middleware/logger/index.ts) records the incoming request and downstream status/elapsed time around `next()`. [Request ID](../../src/middleware/request-id/request-id.ts) accepts a suitably bounded identifier or generates one, then stores it in context and optionally a response header. [Context storage](../../src/middleware/context-storage/index.ts) uses `node:async_hooks` to expose the current context to indirect callers; `getContext()` throws outside that storage scope. This middleware is distinct from JSX's optional async storage fallback.

Use the focused suites beside each middleware, especially [body-limit bypass cases](../../src/middleware/body-limit/index.test.ts), [cache variation tests](../../src/middleware/cache/index.test.ts), [CSRF tests](../../src/middleware/csrf/index.test.ts), and [JWT tests](../../src/middleware/jwt/index.test.ts). For long-lived responses and upgrades, continue to [streaming and WebSockets](../integrations/streaming-websockets.md).
