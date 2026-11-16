---
title: "Request Control Middleware"
---
## Overview

The middleware on this page change which code runs for a request rather than what the response looks like. `combine` builds one middleware out of several with boolean logic. `methodOverride` and the trailing-slash pair redirect or re-dispatch a request under another method or path. `timeout` bounds how long the chain may take, `languageDetector` decides a language before the handler runs, and `contextStorage` makes the Context reachable from code that was not passed `c`. They are registered with `app.use` like any middleware; the order rules they rely on are those of [[Request Lifecycle and Error Handling]].

Sources: [src/middleware/combine/index.ts:38-117](repo://src/middleware/combine/index.ts#L38-L117), [src/middleware/combine/index.ts:141-165](repo://src/middleware/combine/index.ts#L141-L165), [src/middleware/context-storage/index.ts:43-59](repo://src/middleware/context-storage/index.ts#L43-L59)

| Middleware | Import | For |
| --- | --- | --- |
| `some`, `every`, `except` | `hono/combine` | Combining middleware and conditions |
| `methodOverride({ app, ... })` | `hono/method-override` | HTML forms that need `PUT`, `PATCH` or `DELETE` |
| `trimTrailingSlash`, `appendTrailingSlash` | `hono/trailing-slash` | One canonical URL per page |
| `timeout(ms, exception?)` | `hono/timeout` | A 504 when the chain is too slow |
| `languageDetector(options)` | `hono/language` | Choosing a supported language |
| `contextStorage()` | `hono/context-storage` | `getContext()` from anywhere in the request |

Sources: [src/middleware/method-override/index.ts:60-61](repo://src/middleware/method-override/index.ts#L60-L61), [src/middleware/trailing-slash/index.ts:44-45](repo://src/middleware/trailing-slash/index.ts#L44-L45), [src/middleware/timeout/index.ts:38-42](repo://src/middleware/timeout/index.ts#L38-L42), [src/middleware/language/language.ts:283-300](repo://src/middleware/language/language.ts#L283-L300)

## combine

Each of the three accepts middleware and condition functions `(c) => boolean` in the same list.

Sources: [src/middleware/combine/index.ts:12-12](repo://src/middleware/combine/index.ts#L12-L12)

`some(...items)` runs the items in order until one succeeds. A middleware succeeds by finishing without throwing; a condition by returning `true`, after which `some` calls `next()` itself. A condition returning `false` or a middleware throwing moves on to the next item, unless the middleware had already called `next()`, in which case the error is final. When nothing succeeds, the last error is thrown. The code's example lets a valid bearer token skip a rate limiter.

Sources: [src/middleware/combine/index.ts:14-69](repo://src/middleware/combine/index.ts#L14-L69)

```ts
app.use('/api/*', some(
  bearerAuth({ token }),
  myRateLimit({ limit: 100 }),
))
```

Sources: [src/middleware/combine/index.ts:24-35](repo://src/middleware/combine/index.ts#L24-L35)

`every(...items)` runs all items as one chain with `compose`, so each middleware's `next()` leads to the next item and the last to the route's `next`. A condition returning `false` throws `Unmet condition`. It pins `c.req.routeIndex` to its own value inside the chain, so parameters keep referring to the route the combined middleware was registered on.

Sources: [src/middleware/combine/index.ts:99-117](repo://src/middleware/combine/index.ts#L99-L117)

`except(condition, ...middleware)` runs the middleware unless the condition holds. String conditions are path patterns matched with a private `TrieRouter`, so `except('/public/*', auth)` skips authentication for public paths. It is built as `some(conditionsHold, every(...middleware))`.

Sources: [src/middleware/combine/index.ts:141-165](repo://src/middleware/combine/index.ts#L141-L165)

## methodOverride

HTML forms can only send `GET` and `POST`. `methodOverride({ app })` reads the intended method from the request and dispatches a new request with that method through `app.fetch`, passing the bindings and the execution context. `GET` requests are never overridden.

Sources: [src/middleware/method-override/index.ts:60-66](repo://src/middleware/method-override/index.ts#L60-L66), [src/middleware/method-override/index.ts:140-148](repo://src/middleware/method-override/index.ts#L140-L148)

| Option | Method read from | Removed from the new request |
| --- | --- | --- |
| `form` (default, field `_method`) | A `multipart/form-data` or `application/x-www-form-urlencoded` body | The field |
| `header: 'X-HTTP-Method-Override'` | That header | The header |
| `query: '_method'` | That query parameter | The parameter |

Sources: [src/middleware/method-override/index.ts:11-33](repo://src/middleware/method-override/index.ts#L11-L33), [src/middleware/method-override/index.ts:67-136](repo://src/middleware/method-override/index.ts#L67-L136)

Because the new request goes through the whole app again, every middleware registered for it runs a second time, now under the new method. The form variant clones the raw request twice, so the body stays readable in the re-dispatched request.

Sources: [src/middleware/method-override/index.ts:71-103](repo://src/middleware/method-override/index.ts#L71-L103)

## Trailing slashes

`trimTrailingSlash()` and `appendTrailingSlash()` act on `GET` and `HEAD` only. By default they wait for the handler and redirect with `301` only when the response is `404`: trim removes one trailing slash, except from `/`; append adds one. With `alwaysRedirect: true` they redirect before the handler runs, whether or not the route exists. `appendTrailingSlash` also takes `skip(path)` to exempt paths, such as files with extensions.

Sources: [src/middleware/trailing-slash/index.ts:44-74](repo://src/middleware/trailing-slash/index.ts#L44-L74), [src/middleware/trailing-slash/index.ts:128-158](repo://src/middleware/trailing-slash/index.ts#L128-L158)

These work with the default `strict: true` app option, where `/a` and `/a/` are different routes; with `strict: false` the app already matches both, as [[Application and Routing]] explains.

Sources: [src/hono-base.ts:170-172](repo://src/hono-base.ts#L170-L172)

## timeout

`timeout(duration, exception)` races the rest of the chain against a timer. If the timer wins, the middleware throws `exception`: an `HTTPException`, a function of the Context returning one, or by default `HTTPException(504, { message: 'Gateway Timeout' })`. The timer is cleared in either case. The handler is not cancelled: its promise keeps running, and its eventual result is ignored.

Sources: [src/middleware/timeout/index.ts:10-58](repo://src/middleware/timeout/index.ts#L10-L58)

## languageDetector

`languageDetector(options)` tries detectors in `order`, `querystring`, `cookie` and `header` by default, with `path` also available. The first that yields a supported language wins; otherwise `fallbackLanguage`, `en` by default, is used. The result is stored as `c.var.language`.

Sources: [src/middleware/language/language.ts:51-68](repo://src/middleware/language/language.ts#L51-L68), [src/middleware/language/language.ts:229-300](repo://src/middleware/language/language.ts#L229-L300)

| Detector | Reads | Option |
| --- | --- | --- |
| `querystring` | `?lang=` | `lookupQueryString` |
| `cookie` | The `language` cookie | `lookupCookie` |
| `header` | `Accept-Language`, highest quality first | `lookupFromHeaderKey` |
| `path` | A path segment | `lookupFromPathIndex` (0) |

Sources: [src/middleware/language/language.ts:128-182](repo://src/middleware/language/language.ts#L128-L182)

Each candidate is trimmed, passed through `convertDetectedLanguage` when given, and matched against `supportedLanguages`, case-insensitively unless `ignoreCase` is `false`. A tag without an exact match is shortened from the right, `en-US` to `en`, following RFC 4647 lookup as the comment notes. A detected language is saved in the cookie with `cookieOptions`, `SameSite=Strict`, `Secure`, `HttpOnly` and one year by default, unless `caches` is `false`.

Sources: [src/middleware/language/language.ts:84-123](repo://src/middleware/language/language.ts#L84-L123), [src/middleware/language/language.ts:212-224](repo://src/middleware/language/language.ts#L212-L224)

Options are validated at creation: the fallback must be one of the supported languages, the path index must not be negative, and `order` may name only the four detectors.

Sources: [src/middleware/language/language.ts:195-207](repo://src/middleware/language/language.ts#L195-L207)

## contextStorage

`contextStorage()` runs the rest of the chain inside `AsyncLocalStorage.run(c, next)`. Code called during the request, such as a data-access module, can then call `getContext()` to obtain the Context and read `c.env` or `c.var` without receiving `c` as an argument. `getContext()` throws `Context is not available` outside a request; `tryGetContext()` returns `undefined` instead.

Sources: [src/middleware/context-storage/index.ts:10-59](repo://src/middleware/context-storage/index.ts#L10-L59)

The module imports `AsyncLocalStorage` from `node:async_hooks`, so it works only on runtimes that provide that module.

Sources: [src/middleware/context-storage/index.ts:6-10](repo://src/middleware/context-storage/index.ts#L6-L10)
