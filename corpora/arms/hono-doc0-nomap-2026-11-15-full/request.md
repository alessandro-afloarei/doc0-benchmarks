---
title: "HonoRequest"
---
## Overview

`c.req` is a `HonoRequest`, a thin wrapper around the standard `Request`. It adds three things that the raw object lacks. Path parameters come from the router's match result. Query and header access avoids building a `URL`. The body is cached, so several middleware can read it. The original request stays available as `c.req.raw`, and `url` and `method` are getters that read it.

Sources: [src/request.ts:36-80](repo://src/request.ts#L36-L80), [src/request.ts:356-387](repo://src/request.ts#L356-L387)

The [[Context]] creates the wrapper the first time `c.req` is read, passing the matched path and the router's `Result`. `HonoRequest` is exported only as a type from `hono`. The `hono/request` entry point exports the `cloneRawRequest` utility.

Sources: [src/context.ts:363-369](repo://src/context.ts#L363-L369), [src/index.ts:39-44](repo://src/index.ts#L39-L44), [src/request.ts:476-505](repo://src/request.ts#L476-L505)

| Member | Returns | Notes |
| --- | --- | --- |
| `raw` | `Request` | The untouched request. Reading its body directly bypasses the cache. |
| `path` | `string` | The path the router matched (after `getPath` and strict handling). |
| `url`, `method` | `string` | Read from `raw`. |
| `param(key?)` | `string` or record | Path parameters for the current handler. |
| `query(key?)`, `queries(key?)` | `string` / `string[]` or records | Query string values. |
| `header(name?)` | `string` or record | Request headers. |
| `json()`, `text()`, `arrayBuffer()`, `bytes()`, `blob()`, `formData()` | `Promise` | Cached body readers. |
| `parseBody(options?)` | `Promise<BodyData>` | Form bodies as a plain object. |
| `valid(target)` | validated data | Output of the [[Validator]]. |
| `routeIndex` | `number` | Index of the handler currently running, set by `compose`. |

Sources: [src/request.ts:36-128](repo://src/request.ts#L36-L128), [src/request.ts:130-218](repo://src/request.ts#L130-L218), [src/request.ts:241-354](repo://src/request.ts#L241-L354), [src/request.ts:389-442](repo://src/request.ts#L389-L442)

## Path parameters

The router returns a `Result` in one of two forms. In the first, each matched handler has a map from parameter name to an index into a shared `ParamStash` array (`RegExpRouter`). In the second, each handler has its parameter values directly (`TrieRouter`, `LinearRouter`, `PatternRouter`). `#getParamValue` handles both. When `matchResult[1]` exists it looks the index up in the stash, and otherwise it uses the value as is.

Sources: [src/router.ts:54-98](repo://src/router.ts#L54-L98), [src/request.ts:126-128](repo://src/request.ts#L126-L128)

`param(key)` reads from `matchResult[0][this.routeIndex]`, the entry of the handler that is currently running. `compose` updates `routeIndex` before each handler. Middleware registered on `/u/:id/*` therefore sees `{ id }`, while the final `/u/:id/:name` handler sees `{ id, name }`. A value is decoded with `decodeURIComponent` only when it contains `%`, and `tryDecode` leaves malformed sequences undecoded rather than throwing. `param()` with no key returns every parameter of the current handler and skips `undefined` values, such as an optional parameter that did not match.

Sources: [src/request.ts:94-124](repo://src/request.ts#L94-L124), [src/compose.ts:42-47](repo://src/compose.ts#L42-L47), [src/utils/url.ts:80-93](repo://src/utils/url.ts#L80-L93)

```ts
app.get('/posts/:id/comments/:commentId', (c) => {
  const id = c.req.param('id')                 // typed as string from the path literal
  const { id: postId, commentId } = c.req.param()
  return c.json({ postId, commentId })
})
```

Sources: [src/request.ts:82-104](repo://src/request.ts#L82-L104)

The type of `param` is derived from the route path literal `P`. Required keys return `string`, keys declared with a trailing `?` return `string | undefined`, and a non-literal path accepts any string key.

Sources: [src/request.ts:94-101](repo://src/request.ts#L94-L101)

## Query strings

`query()` and `queries()` call `getQueryParam` and `getQueryParams` on the raw URL string and never construct a `URL` or `URLSearchParams`. For a single key without `%` or `+`, `_getQueryParam` searches for `?key` or `&key` and slices out the value. It only falls back to a full parse if the URL contains encoded characters. The full parse walks every `&`-separated pair and decodes names and values with `_decodeURI` (`+` becomes a space, and `%` escapes are decoded with `tryDecode`).

Sources: [src/request.ts:130-171](repo://src/request.ts#L130-L171), [src/utils/url.ts:208-300](repo://src/utils/url.ts#L208-L300)

| Call | `?a=1&a=2&b=x+y&c` returns |
| --- | --- |
| `query('a')` | `'1'` (first occurrence wins) |
| `query()` | `{ a: '1', b: 'x y', c: '' }` |
| `queries('a')` | `['1', '2']` |
| `queries()` | `{ a: ['1', '2'], b: ['x y'], c: [''] }` |
| `query('missing')` | `undefined` |

Sources: [src/utils/url.ts:219-315](repo://src/utils/url.ts#L219-L315)

## Headers

`header(name)` returns `raw.headers.get(name)`, turning `null` into `undefined`. The lookup is case-insensitive like any `Headers` object. `header()` with no argument copies all headers into a plain record. Its keys are lower-case, because `Headers` iteration normalizes them.

Sources: [src/request.ts:173-198](repo://src/request.ts#L173-L198)

```ts
app.get('/', (c) => {
  const ua = c.req.header('User-Agent')
  const all = c.req.header() // { 'user-agent': '...', accept: '...' }
  return c.json({ ua, count: Object.keys(all).length })
})
```

Sources: [src/request.ts:173-198](repo://src/request.ts#L173-L198)

## Reading the body

### Body caching

A `Request` body can be consumed only once. A validator that reads the JSON body would otherwise leave nothing for the handler. `HonoRequest` therefore routes every body reader through `#cachedBody(key)`, which stores the pending promise in the public `bodyCache` object:

Sources: [src/request.ts:20-27](repo://src/request.ts#L20-L27), [src/request.ts:220-239](repo://src/request.ts#L220-L239)

1. If `bodyCache[key]` is already set, return it.
2. If any other format was cached, wait for it and convert it with `new Response(body)[key]()`. A cached `json` value is first turned back into a string with `JSON.stringify`.
3. Otherwise call `raw[key]()` and store the promise under `key`.

Sources: [src/request.ts:20-27](repo://src/request.ts#L20-L27), [src/request.ts:220-239](repo://src/request.ts#L220-L239)

`json()` is built on the `text` cache and runs `JSON.parse` on every call, so each call returns a new object. `bytes()` wraps the `arrayBuffer` cache in a `Uint8Array`. `text()`, `arrayBuffer()`, `blob()` and `formData()` each cache under their own name.

Sources: [src/request.ts:241-331](repo://src/request.ts#L241-L331)

```ts
app.post('/entry', async (c) => {
  const data = await c.req.json<{ title: string }>()
  const raw = await c.req.text() // served from the cache, no second read of the stream
  return c.json({ title: data.title, size: raw.length })
})
```

Sources: [src/request.ts:241-271](repo://src/request.ts#L241-L271)

> [!WARNING]
> Reading `c.req.raw.json()` or another raw body method directly consumes the stream without filling `bodyCache`. Later `c.req` readers then fail because the body was already used.

Sources: [src/request.ts:220-239](repo://src/request.ts#L220-L239), [src/request.ts:476-487](repo://src/request.ts#L476-L487)

### parseBody

`parseBody(options?)` handles HTML form bodies. It reads the media type from `Content-Type`. Only `multipart/form-data` and `application/x-www-form-urlencoded` are parsed, and any other type (including JSON) returns `{}`. `parseFormData` reads the body through the cached `arrayBuffer()` and converts it with `bufferToFormData`. It stores the resulting promise in `bodyCache.formData`, so a later `c.req.formData()` reuses it.

Sources: [src/request.ts:200-218](repo://src/request.ts#L200-L218), [src/utils/body.ts:97-141](repo://src/utils/body.ts#L97-L141)

| Option | Type | Default | Effect |
| --- | --- | --- | --- |
| `all` | `boolean` | `false` | Fields with several values become arrays. When `false`, the last value wins. Keys ending in `[]` are always arrays, whatever this option says. |
| `dot` | `boolean` | `false` | Keys like `obj.key1` become nested objects `{ obj: { key1 } }`. Paths that contain a `__proto__.` segment are skipped. |

Sources: [src/utils/body.ts:43-75](repo://src/utils/body.ts#L43-L75), [src/utils/body.ts:151-242](repo://src/utils/body.ts#L151-L242)

```ts
// body: a=1&a=2&o.x=y&t[]=z
const body = await c.req.parseBody({ all: true, dot: true })
// { a: ['1', '2'], 'o': { x: 'y' }, 't[]': ['z'] }
const file = (await c.req.parseBody())['avatar'] // string | File
```

Sources: [src/utils/body.ts:151-206](repo://src/utils/body.ts#L151-L206)

### cloneRawRequest

`cloneRawRequest(c.req)` from `hono/request` returns a fresh `Request` to forward upstream. If the body is unused, it returns `raw.clone()`. Otherwise it rebuilds the request from the first entry in `bodyCache`, copying the method, headers and the other `RequestInit` fields. When the body was consumed and nothing was cached, it throws an `HTTPException` with status 500.

Sources: [src/request.ts:445-505](repo://src/request.ts#L445-L505)

## Validated data

The validator middleware reads its target (`json`, `form`, `query`, `param`, `header` or `cookie`) through the same `c.req` methods, runs the validation function and calls `c.req.addValidatedData(target, result)`. The handler reads the result with `c.req.valid(target)`. Its type comes from the route's `Input` (`I['out']`), which the validator adds to the handler chain. The `form` target reuses `bodyCache.formData` when `parseBody` has already filled it.

Sources: [src/request.ts:333-354](repo://src/request.ts#L333-L354), [src/validator/validator.ts:89-170](repo://src/validator/validator.ts#L89-L170)

```ts
import { validator } from 'hono/validator'

app.post(
  '/posts',
  validator('json', (value, c) => (typeof value.title === 'string' ? value : c.text('Invalid', 400))),
  (c) => c.json(c.req.valid('json'), 201)
)
```

Sources: [src/validator/validator.ts:89-170](repo://src/validator/validator.ts#L89-L170), [src/request.ts:351-354](repo://src/request.ts#L351-L354)

## Route introspection

`matchedRoutes` returns the `RouterRoute` of every handler matched for this request, in execution order. `routePath` returns the registered path of the handler that is running (`matchedRoutes[routeIndex].path`). Both getters are deprecated in favour of `matchedRoutes(c)`, `routePath(c, index?)`, `baseRoutePath(c, index?)` and `basePath(c, index?)` from `hono/route`. Those helpers read the same match result through the `GET_MATCH_RESULT` symbol getter and accept an `Array.prototype.at`-style index.

Sources: [src/request.ts:389-442](repo://src/request.ts#L389-L442), [src/helper/route/index.ts:32-82](repo://src/helper/route/index.ts#L32-L82)

```ts
import { routePath } from 'hono/route'

app.use('*', async (c, next) => {
  console.log(routePath(c))     // '*'
  console.log(routePath(c, -1)) // '/posts/:id'
  await next()
})
app.get('/posts/:id', (c) => c.text(routePath(c))) // '/posts/:id'
```

Sources: [src/helper/route/index.ts:36-59](repo://src/helper/route/index.ts#L36-L59)
