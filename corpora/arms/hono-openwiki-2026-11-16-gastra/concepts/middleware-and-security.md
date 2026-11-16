---
type: concept
title: Middleware policies and security boundaries
description: How built-in middleware composes authentication, origin checks, body limits, cache policy, and response handling.
tags: [middleware, security, authentication, cache]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:52:30.504Z
sources:
  - id: openwiki-source-c72bb3bddcef3a3b371c5898
    resource: repo://src/adapter/aws-lambda/handler.ts
  - id: openwiki-source-5eb47cd472f110c959d254bb
    resource: repo://src/middleware/basic-auth/index.ts
  - id: openwiki-source-f8c757c8888f99d3f919731d
    resource: repo://src/middleware/bearer-auth/index.ts
  - id: openwiki-source-c6eb362a94bf78796a7832b4
    resource: repo://src/middleware/body-limit/index.ts
  - id: openwiki-source-b506e9e559730c86c05d203e
    resource: repo://src/middleware/cache/index.ts
  - id: openwiki-source-26f3dbc8c3bec492e1a3c1e9
    resource: repo://src/middleware/context-storage/index.ts
  - id: openwiki-source-963e270a8ebfb612b4c3d5d1
    resource: repo://src/middleware/cors/index.ts
  - id: openwiki-source-eb9e396aa8d9970d4262622e
    resource: repo://src/middleware/csrf/index.ts
  - id: openwiki-source-b4547eee3cf14a547d5b41a9
    resource: repo://src/middleware/jwk/jwk.ts
  - id: openwiki-source-704fe270aa4812b037239378
    resource: repo://src/middleware/jwt/jwt.ts
  - id: openwiki-source-bec7ff0540414557fa30d4ce
    resource: repo://src/middleware/secure-headers/secure-headers.ts
  - id: openwiki-source-3a62e700d7a5e8fe8b34e1d0
    resource: repo://src/middleware/timeout/index.ts
generated: { by: "codex", at: "2026-11-16T07:52:30.504Z" }
---

# Middleware policies and security boundaries

Middleware factories return ordinary Hono handlers. They share the [composition contract](../architecture/request-lifecycle.md): perform work before next, return a response to stop, or await next and inspect the resulting context. Register policies before the endpoints they should cover.

## Authentication and origin policy

| Policy | Repository behavior |
| --- | --- |
| Basic authentication | Accepts configured credentials or a `verifyUser` callback. |
| Bearer authentication | Accepts configured tokens or a `verifyToken` callback. It is not automatically JWT verification. |
| JWT | Requires a secret and explicit algorithm, verifies the selected bearer token or configured cookie, and stores the payload in `c.get('jwtPayload')`. Verification failure becomes 401. |
| JWK | Accepts keys and/or a JWKS URI, including context-dependent providers, and passes an allowed-algorithm list to verification. Missing credentials may pass only when `allow_anon` is enabled. |
| CORS | Sets cross-origin response headers and returns a 204 preflight response for OPTIONS. |
| CSRF | Checks applicable form-like requests against origin and Sec-Fetch-Site policy, rejecting with 403 only when neither check allows the request. |

See the [JWT implementation](../../src/middleware/jwt/jwt.ts), [JWK implementation](../../src/middleware/jwk/jwk.ts), [CORS](../../src/middleware/cors/index.ts), and [CSRF](../../src/middleware/csrf/index.ts).

JWT and JWK require Web Crypto key-import support. For JWT, an existing authorization header takes precedence over cookie fallback; malformed header structure does not silently fall back to a cookie. JWK propagates a plain `Error` from verification infrastructure instead of converting every failure to 401.

CSRF skips GET and HEAD. Its content-type scope includes URL-encoded forms, multipart forms, and text/plain; an absent content type is treated as text/plain. By default, the origin check compares with the request URL's origin and the fetch-site check permits same-origin. This middleware does not validate arbitrary JSON requests. CORS communicates browser access policy; it does not authenticate a caller.

## Body size and time limits

[bodyLimit](../../src/middleware/body-limit/index.ts) needs `maxSize`. With a body and only Content-Length, it checks the declared length and proceeds without rereading the bytes. With Transfer-Encoding or no length header, it buffers and counts the body before downstream execution, rejects overflow, and replaces `c.req.raw` with a replayable request. The default rejection is 413; `onError` customizes it.

This distinction matters at adapters: the AWS Lambda converter replaces Content-Length with the decoded body's actual byte length before dispatch. When implementing another adapter, preserve this size-check assumption. Place body limits before middleware that consumes the body. Buffered checking also has a memory cost proportional to the accepted payload.

[timeout](../../src/middleware/timeout/index.ts) races next against a timer, rejects with 504 by default, and clears the timer afterward. It does not abort the downstream operation. Cancellation of database work or outbound fetches remains an application responsibility.

## Cache ownership and privacy

[Cache middleware](../../src/middleware/cache/index.ts) delegates storage to runtime `caches`. If that API is missing at factory creation, it returns pass-through middleware and invokes the configured notification behavior.

Only GET requests without Authorization enter the cache flow. The default key is the URL; configured Vary request headers extend it, and `keyGenerator` can replace the base key. A hit returns immediately. After a miss, the default cacheable status is 200. Responses with Set-Cookie, private/no-store/no-cache directives, or Vary headers not covered by the configured variants are skipped.

Writes clone the response and either await `cache.put` with `wait: true` or schedule it through `c.executionCtx.waitUntil`. Choose the former when the runtime has CacheStorage but no suitable execution context. Authentication based on cookies or custom context needs application-specific cache-key and privacy decisions; the Authorization bypass alone does not model every identity source.

## Response policies and context access

[secureHeaders](../../src/middleware/secure-headers/secure-headers.ts) evaluates request-dependent header callbacks before next, then applies configured headers afterward and can remove X-Powered-By. This ordering lets nonce callbacks put data in the context before HTML rendering.

[contextStorage](../../src/middleware/context-storage/index.ts) uses `node:async_hooks` AsyncLocalStorage around downstream handlers. `tryGetContext()` can return undefined; `getContext()` throws when no context is available. This middleware introduces a runtime capability requirement beyond the core fetch boundary.

Focused regression entrypoints are [body-limit tests](../../src/middleware/body-limit/index.test.ts), [cache tests](../../src/middleware/cache/index.test.ts), [JWT tests](../../src/middleware/jwt/index.test.ts), and [CSRF tests](../../src/middleware/csrf/index.test.ts). For storage and runtime ownership, continue with [request context](request-and-context.md) and [adapters](../integrations/runtime-adapters.md).
