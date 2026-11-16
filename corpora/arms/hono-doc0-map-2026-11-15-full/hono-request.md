---
title: "HonoRequest"
---
## Overview

`c.req` is a `HonoRequest`: a thin wrapper around the Web-standard `Request` that adds what a router-based framework needs and the Fetch API lacks. It knows the route's path parameters, parses query strings without building a `URL` object, parses form bodies into plain objects, and caches body reads so several middleware can read the same body. The original request stays available as `c.req.raw`.

Sources: [src/request.ts:36-80](repo://src/request.ts#L36-L80)

The context creates the wrapper lazily on first access to `c.req`, passing the raw request, the routing path and the router's match result (see [[Context]]).

Sources: [src/context.ts:366-369](repo://src/context.ts#L366-L369)

## Properties

### Fields and getters

| Member | Type | Description |
| --- | --- | --- |
| `raw` | `Request` | The original request. Reading its body directly bypasses the body cache. |
| `path` | `string` | The routing path computed by the app's `getPath` (pathname without query, decoded). Defaults to `/`. |
| `url` | `string` | `raw.url`, the full URL including the query string. |
| `method` | `string` | `raw.method`. |
| `routeIndex` | `number` | Index of the handler currently running in the match result. Set by compose. |
| `bodyCache` | `Partial<Body>` | Promises for body reads already performed, keyed by `json`, `text`, `arrayBuffer`, `blob` or `formData`. |
| `matchedRoutes` | `RouterRoute[]` | Deprecated: every route matched for this request, in order. |
| `routePath` | `string` | Deprecated: the registered path of the route currently running. |

Sources: [src/request.ts:20-27](repo://src/request.ts#L20-L27), [src/request.ts:51-80](repo://src/request.ts#L51-L80), [src/request.ts:369-387](repo://src/request.ts#L369-L387), [src/request.ts:420-442](repo://src/request.ts#L420-L442)

### matchedRoutes and routePath

Both getters map the match result to the `RouterRoute` records stored at registration time. `routePath` indexes that list with `routeIndex`, so inside an `app.use()` middleware without a path it returns `/*` and inside the final handler it returns that handler's pattern, for example `/posts/:id`. Both are deprecated in favour of the `matchedRoutes` and `routePath` functions in `hono/route`, which read the same data through the `GET_MATCH_RESULT` symbol getter.

Sources: [src/request.ts:389-442](repo://src/request.ts#L389-L442), [src/helper/route/index.ts:32-58](repo://src/helper/route/index.ts#L32-L58), [src/request/constants.ts:1](repo://src/request/constants.ts#L1)

## Path parameters

### param()

`c.req.param('id')` returns one parameter and `c.req.param()` returns all of them as an object. The overloads use the route path type `P`: a required `:id` returns `string`, an optional `:id?` returns `string | undefined`, and `param()` returns a typed record.

Sources: [src/request.ts:94-104](repo://src/request.ts#L94-L104)

```ts
app.get('/posts/:id/comments/:commentId?', (c) => {
  const id = c.req.param('id') // string
  const commentId = c.req.param('commentId') // string | undefined
  const all = c.req.param() // typed record of both parameters
  return c.json({ id, commentId, all })
})
```

Sources: [src/request.ts:94-104](repo://src/request.ts#L94-L104)

### How parameters are resolved

The match result holds one parameter map per matched handler. `#getDecodedParam` reads the map at `routeIndex`, so a handler sees the parameter names of its own route. A `*` middleware that runs before `/posts/:id` therefore gets `undefined` from `param('id')`.

Sources: [src/request.ts:106-110](repo://src/request.ts#L106-L110), [src/compose.ts:42-44](repo://src/compose.ts#L42-L44)

The map value is either the value itself or an index into a shared stash, depending on the router's `Result` format. `#getParamValue` checks for the stash (`matchResult[1]`) and indexes into it when present. Values are percent-decoded only when they contain `%`, using `tryDecode`, which decodes as much as possible and leaves invalid sequences as written instead of throwing.

Sources: [src/request.ts:106-128](repo://src/request.ts#L106-L128), [src/router.ts:98](repo://src/router.ts#L98), [src/utils/url.ts:81-93](repo://src/utils/url.ts#L81-L93)

```ts
#getParamValue(paramKey: any): string | undefined {
  return this.#matchResult[1] ? this.#matchResult[1][paramKey as any] : paramKey
}
```

Sources: [src/request.ts:126-128](repo://src/request.ts#L126-L128)

`param()` without a key iterates the keys of the current handler's map and skips any whose value is `undefined`, so an absent optional parameter does not appear in the object.

Sources: [src/request.ts:112-124](repo://src/request.ts#L112-L124)

## Query strings and headers

### query() and queries()

`c.req.query('q')` returns the first value of `q` or `undefined`; `c.req.query()` returns an object with the first value of every key. `c.req.queries('tag')` returns every value as an array, and `c.req.queries()` returns an object of arrays.

Sources: [src/request.ts:148-171](repo://src/request.ts#L148-L171), [src/utils/url.ts:302-315](repo://src/utils/url.ts#L302-L315)

```ts
// GET /search?q=hono&tag=a&tag=b
c.req.query('q') // 'hono'
c.req.query('tag') // 'a'
c.req.queries('tag') // ['a', 'b']
```

Sources: [src/request.ts:148-171](repo://src/request.ts#L148-L171)

Both read `c.req.url` through `_getQueryParam`, which scans the string rather than creating a `URL` or `URLSearchParams`. For a single key without `%` or `+`, it searches for `?key` or `&key` and returns as soon as it finds `=`; a key followed by `&` or the end of the URL returns `''`. Otherwise it walks every `&`-separated pair, decoding names and values only when the URL contains `%` or `+`. Decoding turns `+` into a space before `decodeURIComponent`.

Sources: [src/utils/url.ts:209-300](repo://src/utils/url.ts#L209-L300)

### header()

`c.req.header('Content-Type')` returns one header (lookup is case-insensitive, as in `Headers.get`) or `undefined` instead of `null`. Without an argument it returns every header as a record whose keys are the lowercase names the Fetch API produces.

Sources: [src/request.ts:185-198](repo://src/request.ts#L185-L198)

## Reading the body

### Body methods and the cache

A `Request` body is a stream that can be read once. Middleware such as a validator and the route handler both often need it, so `HonoRequest` exposes its own `json()`, `text()`, `arrayBuffer()`, `bytes()`, `blob()` and `formData()` that go through `#cachedBody`.

Sources: [src/request.ts:220-331](repo://src/request.ts#L220-L331)

| Method | Cache key used | Result |
| --- | --- | --- |
| `json()` | `text` | `JSON.parse` of the cached text, parsed again on each call. |
| `text()` | `text` | `Promise<string>` |
| `arrayBuffer()` | `arrayBuffer` | `Promise<ArrayBuffer>` |
| `bytes()` | `arrayBuffer` | `Uint8Array` view over the cached buffer. |
| `blob()` | `blob` | `Promise<Blob>` |
| `formData()` | `formData` | `Promise<FormData>` |

Sources: [src/request.ts:253-331](repo://src/request.ts#L253-L331)

### How #cachedBody works

`#cachedBody(key)` follows three steps.

Sources: [src/request.ts:220-239](repo://src/request.ts#L220-L239)

1. If `bodyCache[key]` exists, return that promise.
2. If any other key is cached, wait for that body and convert it with `new Response(body)[key]()`. A cached `json` value is turned back into a string with `JSON.stringify` first. The converted result is not stored.
3. Otherwise read `raw[key]()` and store the promise under `key`.

Sources: [src/request.ts:220-239](repo://src/request.ts#L220-L239)

```ts
#cachedBody = (key: keyof Body) => {
  const { bodyCache, raw } = this
  const cachedBody = bodyCache[key]

  if (cachedBody) {
    return cachedBody
  }

  const anyCachedKey = Object.keys(bodyCache)[0]
  if (anyCachedKey) {
    return (bodyCache[anyCachedKey as keyof Body] as Promise<BodyInit>).then((body) => {
      if (anyCachedKey === 'json') {
        body = JSON.stringify(body)
      }
      return new Response(body)[key]()
    })
  }

  return (bodyCache[key] = raw[key]())
}
```

Sources: [src/request.ts:220-239](repo://src/request.ts#L220-L239)

Because the promise is cached rather than the value, two concurrent reads share one stream read. `json()` uses the `text` key so a later `text()` call returns the same body without a conversion.

Sources: [src/request.ts:238](repo://src/request.ts#L238), [src/request.ts:253-255](repo://src/request.ts#L253-L255)

> [!WARNING]
> Reading `c.req.raw.json()` or `c.req.raw.text()` directly consumes the stream without filling `bodyCache`. Any later `c.req.*` body call, or `cloneRawRequest`, then fails because the body is already used.

Sources: [src/request.ts:476-487](repo://src/request.ts#L476-L487)

### cloneRawRequest()

`cloneRawRequest(c.req)` returns a new `Request` that can be forwarded to another service. If the raw body is unused it simply calls `raw.clone()`. If it was consumed, it rebuilds the request from the first cached body and copies `cache`, `credentials`, headers, `integrity`, `keepalive`, method, `mode`, `redirect`, `referrer`, `referrerPolicy` and `signal`. With a consumed body and an empty cache it throws an `HTTPException(500)`.

Sources: [src/request.ts:444-505](repo://src/request.ts#L444-L505)

## parseBody()

### Supported content types

`c.req.parseBody(options?)` parses form submissions into a plain object. It looks only at the `Content-Type` media type: `multipart/form-data` and `application/x-www-form-urlencoded` are parsed, and anything else (including JSON) returns `{}`. Use `c.req.json()` for JSON bodies.

Sources: [src/request.ts:212-218](repo://src/request.ts#L212-L218), [src/utils/body.ts:97-113](repo://src/utils/body.ts#L97-L113)

The form is read through the request's `arrayBuffer()` (so it is cached) and converted with `bufferToFormData`. When the argument is a `HonoRequest`, the resulting `FormData` promise is also stored in `bodyCache.formData`, so a later `c.req.formData()` or the form [[Validator]] reuses it instead of reading the stream again.

Sources: [src/utils/body.ts:123-141](repo://src/utils/body.ts#L123-L141), [src/validator/validator.ts:115-121](repo://src/validator/validator.ts#L115-L121)

### Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `all` | `boolean` | `false` | When `true`, a key sent several times becomes an array. When `false`, the last value wins. |
| `dot` | `boolean` | `false` | When `true`, keys such as `obj.key1` become nested objects. |

Sources: [src/utils/body.ts:43-75](repo://src/utils/body.ts#L43-L75), [src/utils/body.ts:101](repo://src/utils/body.ts#L101)

A key ending in `[]` is always collected into an array, even without `all`. With `dot`, nested keys are split on `.`; a key containing a `__proto__.` segment is ignored to prevent prototype pollution, and the result objects are created with `Object.create(null)`.

Sources: [src/utils/body.ts:151-242](repo://src/utils/body.ts#L151-L242)

```ts
// body: tags[]=a&tags[]=b&user.name=hono
const body = await c.req.parseBody({ dot: true })
// { 'tags[]': ['a', 'b'], user: { name: 'hono' } }
```

Sources: [src/utils/body.ts:151-206](repo://src/utils/body.ts#L151-L206)

The return type follows the options: with `all` the values may be arrays, with `dot` they may be nested objects, and otherwise each value is `string | File`.

Sources: [src/utils/body.ts:23-41](repo://src/utils/body.ts#L23-L41)

## Validated data

### valid() and addValidatedData()

`c.req.valid(target)` returns the data a validator middleware stored for `json`, `form`, `query`, `param`, `header` or `cookie`. The validator calls `c.req.addValidatedData(target, data)` after its check succeeds. The return type comes from the route's `I` input type, so the handler gets the validated shape without a cast. See [[Validator]].

Sources: [src/request.ts:339-354](repo://src/request.ts#L339-L354), [src/types.ts:2683-2690](repo://src/types.ts#L2683-L2690), [src/validator/validator.ts:160-170](repo://src/validator/validator.ts#L160-L170)

```ts
app.post('/posts', validator('json', (value) => value as { title: string }), (c) => {
  const { title } = c.req.valid('json')
  return c.json({ title }, 201)
})
```

Sources: [src/request.ts:351-354](repo://src/request.ts#L351-L354)
