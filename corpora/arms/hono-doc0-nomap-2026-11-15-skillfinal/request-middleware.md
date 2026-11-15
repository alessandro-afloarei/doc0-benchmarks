---
title: "Request Handling Middleware"
---
## Overview

These built-in middleware act on the way in: they limit or rewrite the incoming request, attach information to the [[Context]] for handlers, or decide which other middleware run. Each is a factory returning a `MiddlewareHandler`, registered with `app.use()` or per route, and each relies on the onion order described in [[Request Lifecycle and Middleware Composition]].

Sources: [src/types.ts:83-88](repo://src/types.ts#L83-L88), [src/compose.ts:15-73](repo://src/compose.ts#L15-L73)

| Middleware | Import | Purpose |
| --- | --- | --- |
| `bodyLimit` | `hono/body-limit` | refuse bodies over a byte size |
| `methodOverride` | `hono/method-override` | treat a `POST` as another method named in a form field, header or query |
| `trimTrailingSlash`, `appendTrailingSlash` | `hono/trailing-slash` | redirect to the other slash form |
| `timeout` | `hono/timeout` | fail a request that takes too long |
| `languageDetector` | `hono/language` | pick a supported language and store it |
| `requestId` | `hono/request-id` | assign and echo a request ID |
| `contextStorage` | `hono/context-storage` | make `c` reachable outside handlers |
| `some`, `every`, `except` | `hono/combine` | combine middleware with conditions |

Sources: [package.json:84-88](repo://package.json#L84-L88), [package.json:119-123](repo://package.json#L119-L123), [package.json:139-143](repo://package.json#L139-L143), [package.json:219-223](repo://package.json#L219-L223), [package.json:234-238](repo://package.json#L234-L238), [package.json:249-268](repo://package.json#L249-L268)

## bodyLimit

`bodyLimit({ maxSize, onError })` lets requests without a body through. When the request has `Content-Length` and no `Transfer-Encoding`, it trusts the length and calls `onError` if it exceeds `maxSize`. Otherwise (chunked or unknown length) it reads the whole body up front, counting bytes and stopping at the limit, then replaces `c.req.raw` with a new `Request` whose body replays the chunks, so the check is final before the handler runs, whatever the handler does with the body. The default `onError` throws `HTTPException(413)` with `Payload Too Large`.

Sources: [src/middleware/body-limit/index.ts:10-111](repo://src/middleware/body-limit/index.ts#L10-L111)

## methodOverride

`methodOverride({ app, form | header | query })` lets clients that can only send `POST` reach `PUT` or `DELETE` routes. `GET` requests pass through. Otherwise it reads the method from the form field (default `_method`, for multipart or URL-encoded bodies), from the named header, or from the named query parameter, builds a new `Request` with that method (removing the field, header or query parameter), and returns `app.fetch(newRequest, c.env, executionCtx)`. The rewritten request is dispatched from the start through the app passed in the options, so the middleware must be given the app itself.

Sources: [src/middleware/method-override/index.ts:11-33](repo://src/middleware/method-override/index.ts#L11-L33), [src/middleware/method-override/index.ts:60-148](repo://src/middleware/method-override/index.ts#L60-L148)

## Trailing slashes

`trimTrailingSlash()` and `appendTrailingSlash()` answer a `GET` or `HEAD` that ends up `404` with a `301` redirect to the same URL without (or with) the trailing slash. The root path `/` is never trimmed, and `appendTrailingSlash` accepts a `skip(path)` function for paths that should keep no slash.

Sources: [src/middleware/trailing-slash/index.ts:44-74](repo://src/middleware/trailing-slash/index.ts#L44-L74), [src/middleware/trailing-slash/index.ts:128-158](repo://src/middleware/trailing-slash/index.ts#L128-L158)

With `alwaysRedirect: true` they redirect before running the handlers instead of waiting for a `404`, which the option's comment recommends for routes with wildcards, since a wildcard route would otherwise answer the non-canonical URL.

Sources: [src/middleware/trailing-slash/index.ts:8-17](repo://src/middleware/trailing-slash/index.ts#L8-L17), [src/middleware/trailing-slash/index.ts:46-57](repo://src/middleware/trailing-slash/index.ts#L46-L57)

## timeout

`timeout(duration, exception)` races `next()` against a timer. If the timer wins it rejects with the exception, by default `HTTPException(504)` with `Gateway Timeout`, or with the result of a function of the context, and the app's error handler produces the response. The timer is cleared either way. The handler is not cancelled: its promise keeps running, only the response no longer waits for it.

Sources: [src/middleware/timeout/index.ts:10-58](repo://src/middleware/timeout/index.ts#L10-L58)

## languageDetector

### Detection order

`languageDetector(options)` tries detectors in `order` (default `querystring`, `cookie`, `header`; `path` is also available) and stores the first supported language as `c.get('language')`, or `fallbackLanguage` when none is found. Each candidate is trimmed, optionally converted by `convertDetectedLanguage`, and compared with `supportedLanguages` (case-insensitively by default); `en-US` falls back to `en` by dropping trailing subtags, following RFC 4647 lookup as the code comment notes. The `Accept-Language` header is parsed with quality values and its entries are tried in turn.

Sources: [src/middleware/language/language.ts:51-123](repo://src/middleware/language/language.ts#L51-L123), [src/middleware/language/language.ts:128-182](repo://src/middleware/language/language.ts#L128-L182), [src/middleware/language/language.ts:229-258](repo://src/middleware/language/language.ts#L229-L258)

### Caching and validation

When a language was detected (not the fallback) and `caches` includes `cookie`, it is written to the `language` cookie with secure defaults: `SameSite=Strict`, `Secure`, `HttpOnly` and a one-year `Max-Age`. Options are validated when the middleware is created: the fallback must be among the supported languages, the path index must be non-negative, and every entry of `order` must be a known detector.

Sources: [src/middleware/language/language.ts:51-68](repo://src/middleware/language/language.ts#L51-L68), [src/middleware/language/language.ts:190-224](repo://src/middleware/language/language.ts#L190-L224), [src/middleware/language/language.ts:283-300](repo://src/middleware/language/language.ts#L283-L300)

## requestId

`requestId({ headerName, limitLength, generator })` reuses the incoming `X-Request-Id` header when it is at most 255 characters and contains only word characters, `-` and `=`; otherwise it calls the generator, by default `crypto.randomUUID()`. The ID is stored as `c.get('requestId')` and set on the response header of the same name. An empty `headerName` disables both the header read and the header write.

Sources: [src/middleware/request-id/request-id.ts:9-59](repo://src/middleware/request-id/request-id.ts#L9-L59)

## contextStorage

`contextStorage()` runs the rest of the chain inside `AsyncLocalStorage.run(c, next)` from `node:async_hooks`, so code that has no `c` parameter can call `getContext()` (which throws `Context is not available` outside a request) or `tryGetContext()` (which returns `undefined`). It requires a runtime that provides `node:async_hooks`.

Sources: [src/middleware/context-storage/index.ts:6-59](repo://src/middleware/context-storage/index.ts#L6-L59)

## Combining middleware

### some

`some(...middleware)` runs its arguments in order until one succeeds. An argument may be a middleware or a condition `(c) => boolean`. A condition returning `true` calls `next()` and stops; `false` moves on. A middleware that returns or calls `next()` without throwing stops the search; one that throws before calling `next()` moves on to the next argument. If none succeeds, the last error is thrown. The doc comment's example skips rate limiting for clients with a valid bearer token: `some(bearerAuth({ token }), myRateLimit({ limit: 100 }))`.

Sources: [src/middleware/combine/index.ts:14-69](repo://src/middleware/combine/index.ts#L14-L69)

### every

`every(...middleware)` runs all of its arguments in sequence with the app's own `compose`, each one's `next` leading to the following one and the last to the real `next`. A condition returning `false` throws `Unmet condition`. It saves and restores `c.req.routeIndex` around each step so path parameters still refer to the route the combined middleware was registered on.

Sources: [src/middleware/combine/index.ts:99-117](repo://src/middleware/combine/index.ts#L99-L117), [src/compose.ts:42-45](repo://src/compose.ts#L42-L45)

### except

`except(condition, ...middleware)` skips the middleware when the condition holds. String conditions are route patterns, matched against `c.req.path` with a private `TrieRouter`, so `except('/public/*', auth)` exempts a subtree; functions are tested too. Internally it is `some(anyConditionHolds, every(...middleware))`.

Sources: [src/middleware/combine/index.ts:141-165](repo://src/middleware/combine/index.ts#L141-L165)
