---
title: "Logging, Timing and Request Context Middleware"
---
## Overview

These middleware do not change what a route answers. They record what happened (logger, timing), attach information to the request for later code (request ID, language, context storage), or rewrite the request before routing (method override). Most store their result as a context variable and augment `ContextVariableMap` or export a `...Variables` type, so `c.get(...)` is typed, as [[Context and Response Building]] describes.

Sources: [src/middleware/request-id/request-id.ts:9-11](repo://src/middleware/request-id/request-id.ts#L9-L11), [src/middleware/language/index.ts:1-12](repo://src/middleware/language/index.ts#L1-L12), [src/middleware/timing/timing.ts:10-15](repo://src/middleware/timing/timing.ts#L10-L15)

| Import | Does | Sets | Choose it when |
| --- | --- | --- | --- |
| `hono/logger` | Prints one line per request and per response | nothing | Development and simple production logs |
| `hono/timing` | Builds a `Server-Timing` header | `metric` | Measuring handler phases in browser dev tools |
| `hono/request-id` | Reuses or generates a request ID, echoes it in a header | `requestId` | Correlating logs across services |
| `hono/context-storage` | Makes the current `Context` reachable from any function | nothing | Code deep in a call stack needs `c.env` or variables |
| `hono/language` | Detects the user's language from query, cookie, header or path | `language` | Localised responses |
| `hono/method-override` | Lets HTML forms send `DELETE`, `PUT` or `PATCH` | nothing | Server-rendered forms that need more than `POST` |

Sources: [src/middleware/logger/index.ts:81-95](repo://src/middleware/logger/index.ts#L81-L95), [src/middleware/timing/timing.ts:76-126](repo://src/middleware/timing/timing.ts#L76-L126), [src/middleware/request-id/request-id.ts:41-59](repo://src/middleware/request-id/request-id.ts#L41-L59), [src/middleware/context-storage/index.ts:43-59](repo://src/middleware/context-storage/index.ts#L43-L59)

## logger

`logger(fn = console.log)` prints `<-- METHOD /path?query` when a request arrives and `--> METHOD /path?query STATUS 12ms` after `next()`, with times over a second shown in seconds. Status codes are coloured by class (5xx red, 4xx yellow, 3xx cyan, 2xx green) unless colour is disabled by `NO_COLOR` in the process environment, Deno's `noColor`, or a `NO_COLOR` binding on Cloudflare Workers. Passing a function routes the lines to any logger.

Sources: [src/middleware/logger/index.ts:9-95](repo://src/middleware/logger/index.ts#L9-L95), [src/utils/color.ts:14-56](repo://src/utils/color.ts#L14-L56)

Register it first so its timing covers every other middleware.

Sources: [src/middleware/logger/index.ts:87-93](repo://src/middleware/logger/index.ts#L87-L93)

## timing

### The middleware

`timing(options)` creates a per-request `metric` store of header entries and running timers, starts a `total` timer, and after `next()` ends the total and any timers still running (`autoEnd`), then appends `Server-Timing` with all entries. `enabled` (a boolean or a function of the context) can hide the header in production, and `crossOrigin` adds `Timing-Allow-Origin` so pages on other origins can read it. If a `metric` store already exists, for example because the middleware is registered twice, the inner one does nothing.

Sources: [src/middleware/timing/timing.ts:22-35](repo://src/middleware/timing/timing.ts#L22-L35), [src/middleware/timing/timing.ts:76-126](repo://src/middleware/timing/timing.ts#L76-L126)

### Recording metrics

Handlers record with exported functions that read `c.get('metric')`; each logs a warning instead of throwing when the middleware is missing.

Sources: [src/middleware/timing/timing.ts:149-160](repo://src/middleware/timing/timing.ts#L149-L160)

| Function | Records |
| --- | --- |
| `startTime(c, name, description?)` / `endTime(c, name, precision?)` | The elapsed milliseconds between the two calls, from `performance.now()` when available |
| `wrapTime(c, name, promise)` | The duration of a promise, ended even when it rejects |
| `setMetric(c, name, value, description?)` | A fixed value in milliseconds |
| `setMetric(c, name, description?)` | A value-less entry such as a region name |

Sources: [src/middleware/timing/timing.ts:149-257](repo://src/middleware/timing/timing.ts#L149-L257)

## request-id

`requestId({ headerName = 'X-Request-Id', limitLength = 255, generator })` reuses the incoming header's value when it is present, at most `limitLength` characters, and contains only word characters, `-` and `=`. Anything else is replaced by `generator(c)`, `crypto.randomUUID()` by default, so a client cannot inject arbitrary text into logs. The ID is stored as `c.get('requestId')` and set on the response header. An empty `headerName` disables both reading and echoing.

Sources: [src/middleware/request-id/request-id.ts:13-59](repo://src/middleware/request-id/request-id.ts#L13-L59)

## context-storage

`contextStorage()` runs the rest of the chain inside `AsyncLocalStorage.run(c, next)` from `node:async_hooks`. Any code called during the request, however deep, can then call `getContext<Env>()` to reach the same `Context`, including `c.env` and variables, without passing `c` down. `getContext` throws `Context is not available` outside a request; `tryGetContext` returns `undefined` instead.

Sources: [src/middleware/context-storage/index.ts:6-59](repo://src/middleware/context-storage/index.ts#L6-L59)

> [!NOTE]
> The import of `node:async_hooks` requires a runtime that provides it: Node.js, Deno, Bun, or Cloudflare Workers with Node.js compatibility enabled.

Sources: [src/middleware/context-storage/index.ts:6-10](repo://src/middleware/context-storage/index.ts#L6-L10)

## language

### Detection

`languageDetector(options)` runs detectors in `order` (default query string `lang`, then cookie `language`, then `Accept-Language`; a `path` detector reads the segment at `lookupFromPathIndex`) and stops at the first that yields a supported language. The result, or `fallbackLanguage`, is stored as `c.get('language')`. The options are validated at startup: the fallback must be among `supportedLanguages`, and the order may only name known detectors.

Sources: [src/middleware/language/language.ts:51-68](repo://src/middleware/language/language.ts#L51-L68), [src/middleware/language/language.ts:177-207](repo://src/middleware/language/language.ts#L177-L207), [src/middleware/language/language.ts:229-299](repo://src/middleware/language/language.ts#L229-L299)

### Matching and caching

Each candidate goes through `normalizeLanguage`: optional `convertDetectedLanguage`, case folding unless `ignoreCase` is false, an exact match against the supported list, then progressive truncation per RFC 4647 (`en-GB-oxendict` tries `en-GB`, then `en`). `Accept-Language` values are tried in order of their `q` weight, parsed by the shared `parseAccept`. When a language was detected and `caches` includes `cookie`, it is written back as a cookie (strict, secure, HTTP-only, one year by default) so later requests skip detection.

Sources: [src/middleware/language/language.ts:74-162](repo://src/middleware/language/language.ts#L74-L162), [src/middleware/language/language.ts:212-224](repo://src/middleware/language/language.ts#L212-L224), [src/utils/accept.ts:211-266](repo://src/utils/accept.ts#L211-L266)

## method-override

HTML forms can only send `GET` and `POST`. `methodOverride({ app, form | header | query })` reads the intended method from a form field (`_method` by default), a header, or a query parameter, rebuilds the request with that method and without the override field, and dispatches it again through `app.fetch` with the same bindings and execution context. The response of that second dispatch is returned. `GET` requests and requests without an override pass through.

Sources: [src/middleware/method-override/index.ts:11-33](repo://src/middleware/method-override/index.ts#L11-L33), [src/middleware/method-override/index.ts:60-148](repo://src/middleware/method-override/index.ts#L60-L148)

Because the request is re-dispatched, the middleware needs the `app` instance, and every middleware before it runs twice for an overridden request; register it on the paths where forms post (`app.use('/posts', methodOverride({ app }))`) and early in the chain. For form bodies it clones the request twice, reading one copy to find the field and building the new body from the other. The full dispatch path is described on [[Request Lifecycle and Middleware Composition]].

Sources: [src/middleware/method-override/index.ts:66-105](repo://src/middleware/method-override/index.ts#L66-L105), [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485)
