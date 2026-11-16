---
title: "Built-in Middleware"
---
## Overview

Each built-in middleware is a function that returns a `MiddlewareHandler`, so you register it with `app.use` and it takes part in the chain that [[Request Dispatch]] runs. The entries below are grouped by what they do. Each one is a separate module under `src/middleware`, and the page says only what its module names and comments state. The middleware that verify tokens have their own page, [[JWT Authentication]].

Sources: [src/middleware/combine/index.ts:1-18](repo://src/middleware/combine/index.ts#L1-L18), [src/middleware/cors/index.ts:1-3](repo://src/middleware/cors/index.ts#L1-L3)

## Authentication

- `basicAuth` checks HTTP Basic credentials, and `bearerAuth` checks a bearer token. Both are exported from their own modules.
- `jwt` and `jwk` verify tokens, described in [[JWT Authentication]].

Sources: [src/middleware/basic-auth/index.ts:1-3](repo://src/middleware/basic-auth/index.ts#L1-L3), [src/middleware/basic-auth/index.ts:80-80](repo://src/middleware/basic-auth/index.ts#L80-L80), [src/middleware/bearer-auth/index.ts:104-104](repo://src/middleware/bearer-auth/index.ts#L104-L104), [src/middleware/jwt/index.ts:3-3](repo://src/middleware/jwt/index.ts#L3-L3), [src/middleware/jwk/index.ts:1-1](repo://src/middleware/jwk/index.ts#L1-L1)

## Security headers and origin checks

- `cors` sets the CORS response headers.
- `csrf` protects against cross-site request forgery by validating request origins, as its module comment states.
- `ipRestriction` allows or denies requests by client IP address, using the rules its module defines.
- `secureHeaders` sets security-related response headers.

Sources: [src/middleware/cors/index.ts:63-63](repo://src/middleware/cors/index.ts#L63-L63), [src/middleware/csrf/index.ts:33-35](repo://src/middleware/csrf/index.ts#L33-L35), [src/middleware/csrf/index.ts:94-94](repo://src/middleware/csrf/index.ts#L94-L94), [src/middleware/ip-restriction/index.ts:2-2](repo://src/middleware/ip-restriction/index.ts#L2-L2), [src/middleware/ip-restriction/index.ts:218-218](repo://src/middleware/ip-restriction/index.ts#L218-L218), [src/middleware/secure-headers/index.ts:2-2](repo://src/middleware/secure-headers/index.ts#L2-L2)

## Response shaping and caching

- `cache` stores responses for reuse, and its module lists the status codes it caches by default.
- `compress` compresses the response body.
- `etag` adds an `ETag` header and answers unchanged content with 304. Its module lists the headers kept on a 304 response.
- `prettyJSON` formats JSON responses.
- `poweredBy` adds an identifying response header.

Sources: [src/middleware/cache/index.ts:13-13](repo://src/middleware/cache/index.ts#L13-L13), [src/middleware/cache/index.ts:64-64](repo://src/middleware/cache/index.ts#L64-L64), [src/middleware/compress/index.ts:70-70](repo://src/middleware/compress/index.ts#L70-L70), [src/middleware/etag/index.ts:16-21](repo://src/middleware/etag/index.ts#L16-L21), [src/middleware/etag/index.ts:79-79](repo://src/middleware/etag/index.ts#L79-L79), [src/middleware/pretty-json/index.ts:46-46](repo://src/middleware/pretty-json/index.ts#L46-L46), [src/middleware/powered-by/index.ts:30-30](repo://src/middleware/powered-by/index.ts#L30-L30)

## Request handling

- `bodyLimit` refuses request bodies above a size.
- `methodOverride` replaces the method of a request with a value sent by the client.
- `trimTrailingSlash` removes a trailing slash from the path.
- `timeout` ends a handler that runs too long.
- `language` detects the language of the request and stores it on the context.
- `requestId` adds a request identifier.

Sources: [src/middleware/body-limit/index.ts:50-50](repo://src/middleware/body-limit/index.ts#L50-L50), [src/middleware/method-override/index.ts:60-60](repo://src/middleware/method-override/index.ts#L60-L60), [src/middleware/trailing-slash/index.ts:44-44](repo://src/middleware/trailing-slash/index.ts#L40-L44), [src/middleware/timeout/index.ts:38-38](repo://src/middleware/timeout/index.ts#L38-L38), [src/middleware/language/index.ts:2-3](repo://src/middleware/language/index.ts#L2-L3), [src/middleware/request-id/index.ts:3-3](repo://src/middleware/request-id/index.ts#L3-L3)

## Logging and timing

- `logger` prints one line per request. It writes with `console.log` unless a print function is passed.
- `timing` records timing metrics and exports helpers to set them.

Sources: [src/middleware/logger/index.ts:81-81](repo://src/middleware/logger/index.ts#L81-L81), [src/middleware/timing/index.ts:4-4](repo://src/middleware/timing/index.ts#L4-L4)

## Files, rendering and context

- `serveStatic` serves files, and its module says it is not used directly: the adapter supplies `getContent` for the runtime. [[Runtime Adapters]] lists the adapters that do this.
- `jsxRenderer` wraps `c.render` output in a layout. [[JSX Server Rendering]] explains that rendering.
- `contextStorage` makes the current context available outside the handler.

Sources: [src/middleware/serve-static/index.ts:33-35](repo://src/middleware/serve-static/index.ts#L33-L35), [src/middleware/jsx-renderer/index.ts:116-116](repo://src/middleware/jsx-renderer/index.ts#L116-L116), [src/middleware/context-storage/index.ts:43-43](repo://src/middleware/context-storage/index.ts#L43-L43)

## Combining middleware

- `some` runs the first middleware that returns true.
- `every` runs each middleware and requires all to pass.
- `except` skips a middleware for the requests a condition selects.

Sources: [src/middleware/combine/index.ts:38-38](repo://src/middleware/combine/index.ts#L38-L38), [src/middleware/combine/index.ts:99-99](repo://src/middleware/combine/index.ts#L99-L99), [src/middleware/combine/index.ts:141-141](repo://src/middleware/combine/index.ts#L141-L141)

The module comment says middleware is applied in the order it is passed, and that a middleware which exits without returning a response passes control on.

Sources: [src/middleware/combine/index.ts:15-18](repo://src/middleware/combine/index.ts#L15-L18)

## Pages

- [[Validation]] describes the validator, which is also a middleware.
- [[Request Dispatch]] explains the calling convention every middleware uses.

Sources: [src/validator/validator.ts:89-93](repo://src/validator/validator.ts#L89-L93), [src/compose.ts:32-51](repo://src/compose.ts#L32-L51)
