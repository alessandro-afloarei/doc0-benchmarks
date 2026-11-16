---
title: "RPC Client"
---
## Overview

`hc` from `hono/client` is a client generated from nothing but a server app's type. Given `typeof app`, it exposes each route as a chain of properties ending in a `$get`, `$post`… method whose argument and response are typed from the app's schema. At run time it is a `Proxy` that records property names as path segments and calls `fetch` when a `$method` is invoked. The schema it reads is the one described in [[Route Types and Factory]], filled by route registrations and the [[Validator]].

Sources: [src/client/index.ts:1-17](repo://src/client/index.ts#L1-L17), [src/client/client.ts:133-232](repo://src/client/client.ts#L133-L232)

```ts
// server
const route = app.post(
  '/posts',
  validator('json', (value) => value as { title: string }),
  (c) => c.json({ ok: true }, 201)
)
export type AppType = typeof route

// client
import { hc } from 'hono/client'
const client = hc<AppType>('http://localhost:8787')
const res = await client.posts.$post({ json: { title: 'Hello' } })
const data = await res.json() // { ok: boolean }
```

Sources: [src/client/client.ts:133-136](repo://src/client/client.ts#L133-L136), [src/client/types.ts:67-81](repo://src/client/types.ts#L67-L81)

## From property access to a request

### The Proxy

`createProxy(callback, path)` wraps an empty function in a `Proxy`. Reading any string property returns a new proxy with the key appended to `path`; reading `then` returns `undefined`, so a proxy is never mistaken for a promise when awaited. Calling the proxy invokes the callback with the collected path and the call arguments.

Sources: [src/client/client.ts:15-31](repo://src/client/client.ts#L15-L31)

### The callback

The callback in `hc` looks at the last path elements:

Sources: [src/client/client.ts:137-232](repo://src/client/client.ts#L137-L232), [src/client/utils.ts:11-16](repo://src/client/utils.ts#L11-L16), [src/client/utils.ts:46-53](repo://src/client/utils.ts#L46-L53)

1. `toString` and `valueOf` return the function, or the segment name when preceded by `name`, so the proxy can be printed.
2. A last element starting with `$` is popped and becomes the method (`$get` → `get`).
3. The remaining segments are joined with `/` and appended to the base URL with one slash between them.
4. `$url` and `$path` return without any request: `$url(args)` gives a `URL` with parameters and query filled in, and `$path(args)` the same as a path string relative to the base URL.
5. `$ws(args)` turns the URL's `http` into `ws`, adds the query, and opens a `WebSocket`, or calls the `webSocket` option to build one.
6. Any other method creates a `ClientRequestImpl` and calls its `fetch` with the first argument and the merged options.

Sources: [src/client/client.ts:137-232](repo://src/client/client.ts#L137-L232), [src/client/utils.ts:11-16](repo://src/client/utils.ts#L11-L16), [src/client/utils.ts:46-53](repo://src/client/utils.ts#L46-L53)

Because a path segment is a property name, `/posts/:id` is reached as `client.posts[':id']`, and the root `/` as `client.index`. `removeIndexString` deletes a trailing `/index` before the request, keeping a single `/` when it is the whole path.

Sources: [src/client/types.ts:294-309](repo://src/client/types.ts#L294-L309), [src/client/utils.ts:55-60](repo://src/client/utils.ts#L55-L60)

## Building the request

`ClientRequestImpl.fetch(args, options)` maps the argument object to parts of the request:

Sources: [src/client/client.ts:53-118](repo://src/client/client.ts#L53-L118), [src/client/utils.ts:18-44](repo://src/client/utils.ts#L18-L44)

| Argument key | Effect |
| --- | --- |
| `param` | Each `/:name` (with optional `{pattern}` and `?`) is replaced by the value, or removed when the value is empty |
| `query` | Serialised with `buildSearchParams`; arrays become repeated keys, `undefined` values are skipped |
| `json` | `JSON.stringify` as the body, `Content-Type: application/json` |
| `form` | A `FormData` body; array values are appended once per item |
| `header` | Copied into the request headers |
| `cookie` | Each pair serialised with `path=/` and joined into a `Cookie` header |

Sources: [src/client/client.ts:53-118](repo://src/client/client.ts#L53-L118), [src/client/utils.ts:18-44](repo://src/client/utils.ts#L18-L44)

The body is only attached when the method is not `GET` or `HEAD`. The request goes through `options.fetch` or the global `fetch`, called with the URL as a string so libraries that intercept `fetch` see a plain URL. `options.init` is spread last, so it can override anything the client set.

Sources: [src/client/client.ts:119-128](repo://src/client/client.ts#L119-L128), [src/client/types.ts:32-41](repo://src/client/types.ts#L32-L41)

## Options

`ClientRequestOptions` can be passed to `hc` for every call and as the second argument of each call. `deepMerge` combines them, the per-call value winning; when both give `headers`, they are merged into one function that resolves both and spreads the per-call headers last. `headers` may be an object or a function returning one, possibly async, which is evaluated on each request.

Sources: [src/client/client.ts:214-230](repo://src/client/client.ts#L214-L230), [src/client/utils.ts:62-82](repo://src/client/utils.ts#L62-L82), [src/client/types.ts:32-65](repo://src/client/types.ts#L32-L65)

| Option | Purpose |
| --- | --- |
| `fetch` | Replaces the global `fetch`; also accepts an app's `request` method |
| `headers` | Headers or a function returning them |
| `init` | A `RequestInit` spread over the generated one |
| `buildSearchParams` | Custom query serialisation, for example bracket notation |
| `webSocket` | Factory used by `$ws` instead of `new WebSocket` |

Sources: [src/client/types.ts:28-65](repo://src/client/types.ts#L28-L65)

## Types

### Client shape

`Client<T, Prefix>` reads the schema `S` out of the app type and, for each path key, builds nested objects with `PathToChain`: each `/` becomes a level, and an empty last segment becomes `index`. At the leaf, `ClientRequest` adds one method per schema method, expanding `$all` into every standard method. A method whose input has required keys requires its argument; otherwise the argument is optional.

Sources: [src/client/types.ts:11-26](repo://src/client/types.ts#L11-L26), [src/client/types.ts:67-81](repo://src/client/types.ts#L67-L81), [src/client/types.ts:294-318](repo://src/client/types.ts#L294-L318)

### ClientResponse

Each method returns `ClientResponse<Output, Status, Format>`, a `Response` look-alike whose `status` is the literal status and whose `ok` is `true` for success codes and `false` for others. `json()` returns the output type for a `json` endpoint, and `text()` the literal string for a `text` one. When a route can answer several ways (a 201 from the handler, a 400 from the validator), the response is a union, and checking `res.status` or `res.ok` narrows it.

Sources: [src/client/types.ts:120-154](repo://src/client/types.ts#L120-L154)

### Inference helpers

`InferRequestType<typeof client.posts.$post>` gives the argument type of a method, and `InferResponseType<typeof ..., 200>` the output type, optionally for one status only. `ApplyGlobalResponse<App, Def>` adds responses that every route can return, such as those of a global error handler, and `PickResponseByStatusCode<App, 200>` keeps only the given statuses, for apps that handle errors centrally.

Sources: [src/client/types.ts:239-279](repo://src/client/types.ts#L239-L279), [src/client/types.ts:332-393](repo://src/client/types.ts#L332-L393)

## parseResponse

`parseResponse(promise)` awaits a client response and returns its body: parsed as JSON when the content type is `application/json` or `application/*+json`, as text otherwise, and nothing for 101, 204, 205 and 304. When the response is not `ok` it throws a `DetailedError` whose message is the status and status text, with `statusCode` and `detail.data` holding the parsed body. Its return type keeps only the non-error variants of the response union.

Sources: [src/client/utils.ts:84-114](repo://src/client/utils.ts#L84-L114), [src/client/fetch-result-please.ts:7-95](repo://src/client/fetch-result-please.ts#L7-L95)

## testClient

`testClient(app, env, executionCtx, options)` from `hono/testing` builds an `hc` client for `http://localhost` whose `fetch` calls `app.request` with the given bindings and execution context. Tests get the typed client without a network or a server, and the request runs through the full lifecycle described in [[Request Lifecycle and Middleware]].

Sources: [src/helper/testing/index.ts:13-27](repo://src/helper/testing/index.ts#L13-L27), [src/hono-base.ts:499-517](repo://src/hono-base.ts#L499-L517)
