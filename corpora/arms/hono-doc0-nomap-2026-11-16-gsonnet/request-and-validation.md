---
title: "Request Parsing and Validation"
---
## Overview

`c.req` is a `HonoRequest` (`src/request.ts`): a thin wrapper over the standard `Request` that adds route parameters, query and header access, cached body parsing, and storage for validated data. The `validator` middleware (`src/validator/validator.ts`) reads one part of the request, runs your function on it, and stores the result so handlers can read it with `c.req.valid(target)`. The `Context` that owns the request is described in [[Context and Responses]].

Sources: [src/request.ts:36-80](repo://src/request.ts#L36-L80), [src/validator/validator.ts:46-92](repo://src/validator/validator.ts#L46-L92)

## Route parameters

`HonoRequest` receives the router's match result and a `routeIndex`. `compose` sets `routeIndex` to the position of the handler it is about to call, so `c.req.param()` always reads the parameters of the route entry that is currently running, even when several routes matched. See [[Application and Request Dispatch]].

Sources: [src/request.ts:71-80](repo://src/request.ts#L71-L80), [src/compose.ts:42-45](repo://src/compose.ts#L42-L45)

`param(key)` looks up `matchResult[0][routeIndex][1][key]`. Router results come in two formats (see [[Routers and Router Selection]]): when the result has a second element (the parameter stash) the looked-up value is an index into the stash; otherwise it is the value itself. A value containing `%` is decoded with `tryDecodeURIComponent`, which does not throw on malformed input. `param()` without a key does the same for every key and skips undefined values.

Sources: [src/request.ts:102-129](repo://src/request.ts#L102-L129)

## Query, headers and URL

`query` and `queries` delegate to `getQueryParam` and `getQueryParams` on the URL, the second returning arrays. `header(name)` reads `raw.headers.get(name)` and returns `undefined` instead of `null`; with no name it returns an object of every header. `url` and `method` read the raw request; `path` is the path computed by `getPath`.

Sources: [src/request.ts:148-195](repo://src/request.ts#L148-L195)

`matchedRoutes` lists the `RouterRoute` of every matched handler and `routePath` the path registered for the current `routeIndex`.

Sources: [src/request.ts:420-443](repo://src/request.ts#L420-L443)

## Body access and caching

A request body can be read once. `#cachedBody(key)` makes the body methods safe to mix:

Sources: [src/request.ts:220-222](repo://src/request.ts#L220-L222)

1. If `bodyCache[key]` exists, return it.
2. If another format is cached, wait for it, turn it back into a body (`JSON.stringify` when the cached one was `json`) and convert with `new Response(body)[key]()`.
3. Otherwise read `raw[key]()` and store the promise in `bodyCache[key]`.

Sources: [src/request.ts:220-241](repo://src/request.ts#L220-L241)

`json()` reads the `text` form and runs `JSON.parse`, so `json()` and `text()` share one cached read. `text`, `arrayBuffer`, `blob` and `formData` use the cache directly and `bytes` wraps `arrayBuffer` in a `Uint8Array`.

Sources: [src/request.ts:253-320](repo://src/request.ts#L253-L320)

`parseBody(options)` calls `parseBody` from `src/utils/body.ts`. It only parses when the media type is `multipart/form-data` or `application/x-www-form-urlencoded`; any other type yields `{}`. It reads the buffer, converts it with `bufferToFormData`, and stores the form data in `bodyCache.formData` so `c.req.formData()` reuses it.

Sources: [src/utils/body.ts:97-141](repo://src/utils/body.ts#L97-L141)

Two options change the result shape. `all` collects repeated keys into arrays (a key ending in `[]` always yields an array). `dot` expands keys such as `a.b` into nested objects and ignores keys containing `__proto__.`.

Sources: [src/utils/body.ts:151-242](repo://src/utils/body.ts#L151-L242)

`cloneRawRequest(req)` returns `raw.clone()` when the body is unused. When the body was already consumed it rebuilds a `Request` from the first cached body format and the original request fields, and throws an `HTTPException` with status 500 when nothing was cached.

Sources: [src/request.ts:476-505](repo://src/request.ts#L476-L505)

## The validator middleware

### Extracting the value

`validator(target, fn)` returns a middleware. `target` is one of `json`, `form`, `query`, `param`, `header` or `cookie`; for `get` and `head` routes the type excludes `json` and `form`. It first extracts the value, then calls `fn(value, c)`:

Sources: [src/validator/validator.ts:90-93](repo://src/validator/validator.ts#L90-L93)

| Target | Value passed to `fn` |
| --- | --- |
| `json` | `await c.req.json()` when `Content-Type` matches the JSON pattern, else `{}` |
| `form` | an object built from `FormData` when `Content-Type` is multipart or urlencoded, else `{}` |
| `query` | `c.req.queries()` with single-item arrays collapsed to a string |
| `param` | `c.req.param()` |
| `header` | `c.req.header()` (lower-case keys) |
| `cookie` | `getCookie(c)` |

Sources: [src/validator/validator.ts:90-165](repo://src/validator/validator.ts#L90-L165), [src/validator/validator.ts:24-26](repo://src/validator/validator.ts#L24-L26)

For `form` the body is read once into `bodyCache.formData`. Repeated keys and keys ending in `[]` become arrays; other keys keep their single value.

Sources: [src/validator/validator.ts:105-143](repo://src/validator/validator.ts#L105-L143)

### Failure behaviour

Malformed JSON throws `HTTPException(400, { message: 'Malformed JSON in request body' })`, and a failing form parse throws a 400 with the text `Malformed FormData request.` plus the underlying message. When the content type does not match, the value stays `{}` and your function decides what to do. These exceptions go through the usual error handler.

Sources: [src/validator/validator.ts:94-127](repo://src/validator/validator.ts#L94-L127)

### Using the result

If `fn` returns a `Response`, the middleware returns it immediately and the chain stops, which is how validation libraries report errors. Otherwise the return value is stored with `c.req.addValidatedData(target, res)` and `next()` is called. A later handler reads it with `c.req.valid(target)`.

Sources: [src/validator/validator.ts:160-171](repo://src/validator/validator.ts#L160-L171)

```ts
c.req.addValidatedData(target, res as never)
return (await next()) as ExtractValidationResponse<VF>
```

Sources: [src/validator/validator.ts:160-171](repo://src/validator/validator.ts#L160-L171), [src/request.ts:339-354](repo://src/request.ts#L339-L354)

The generic parameters `V` (input and output shape) and `ExtractValidationResponse` let the app's route schema record the validated input and any error responses; see [[Type System and Typed Routes]]. The `InferInput` helpers in `src/validator/utils.ts` derive the input form of a validated output for the client; see [[RPC Client (hc)]].

Sources: [src/validator/validator.ts:46-90](repo://src/validator/validator.ts#L46-L90), [src/validator/utils.ts:1-30](repo://src/validator/utils.ts#L1-L30)
